import { useEffect, useMemo, useState } from "react"
import { Plus, Trash2, Clock } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NumberInput } from "@/components/ui/number-input"
import { ComboInput } from "@/components/ui/combo-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { getVisibleCatalog, catalogWithCurrent } from "@/lib/catalog"
import { useAppStore } from "@/store/useAppStore"
import { saveData, deleteFromCloud, deleteActivityLogForOrder } from "@/lib/cloudSync"
import { recordActivityChanges } from "@/lib/activity"
import { cn } from "@/lib/utils"
import { parseNum, fmtMoney, dateKey, addDays, calculateLineTotal, isHourlyUnit, orderBaseTotal, draftPaymentState } from "@/lib/money"
import { getClientAdvanceStats } from "@/lib/advances"
import { normalizePayment } from "@/lib/normalize"
import type { Order, OrderLine, Payment, TaxType, OrderStatus } from "@/types/models"

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: "queue", label: "В очереди" },
  { value: "progress", label: "В работе" },
  { value: "review", label: "На согласовании" },
  { value: "done", label: "Завершён" },
  { value: "cancelled", label: "Отменён" },
]

// Галочка «позиция готова». Подпись объясняет смысл: сама по себе она ничего
// не считает, но переводит таймер на следующую позицию.
function LineReady({ line, onToggle }: { line: OrderLine; onToggle: () => void }) {
  return (
    <Checkbox
      checked={!!line.ready}
      onCheckedChange={onToggle}
      title={line.ready ? "Позиция готова — таймер идёт в следующую" : "Отметить готовой: таймер переключится на следующую позицию"}
    />
  )
}

function randId(prefix: string) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function blankLine(defaults: { type: string; unit: string }): OrderLine {
  return { id: randId("l"), label: defaults.type, type: defaults.unit, qty: 1, pomoHours: 0, rate: 0, ignorePrice: false, ready: false }
}

function emptyDraft(defaults: { type: string; unit: string }): Order {
  return {
    id: "",
    title: "",
    client: "",
    subject: "",
    grade: "",
    quarter: "",
    lesson: "",
    status: "queue",
    isPaid: false,
    priority: false,
    advanceUsed: 0,
    payments: [],
    paidAmount: 0,
    taxType: "none",
    start: dateKey(new Date()),
    deadline: dateKey(addDays(new Date(), 7)),
    estimatedHours: "",
    actualHours: "",
    lines: [{ ...blankLine(defaults), qty: 10, rate: 500 }],
    notes: "",
    createdAt: Date.now(),
    linkedLessonId: null,
    paidAt: null,
  }
}

export function OrderFormDialog({
  open,
  editingOrder,
  duplicateFrom,
  startInDeleteConfirm,
  onOpenChange,
}: {
  open: boolean
  editingOrder: Order | null
  duplicateFrom: Order | null
  startInDeleteConfirm?: boolean
  onOpenChange: (open: boolean) => void
}) {
  const appSettings = useAppStore((s) => s.appSettings)
  const advances = useAppStore((s) => s.advances)
  const orders = useAppStore((s) => s.orders)
  const planningBoards = useAppStore((s) => s.planningBoards)
  const setOrders = useAppStore((s) => s.setOrders)
  const setActivityLog = useAppStore((s) => s.setActivityLog)
  const setAppSettings = useAppStore((s) => s.setAppSettings)

  const defaults = { type: getVisibleCatalog(appSettings, "types")[0] || "Презентация", unit: getVisibleCatalog(appSettings, "units")[0] || "Слайд" }
  const [draft, setDraft] = useState<Order>(() => emptyDraft(defaults))
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editingOrder) {
      setDraft(JSON.parse(JSON.stringify(editingOrder)))
    } else if (duplicateFrom) {
      const o = duplicateFrom
      const durationDays = Math.max(1, Math.round((new Date(o.deadline).getTime() - new Date(o.start).getTime()) / 86400000) || 7)
      const newStart = o.deadline ? addDays(new Date(o.deadline), 1) : new Date()
      const lessonNumMatch = String(o.lesson || "").match(/^\d+$/)
      setDraft({
        ...emptyDraft(defaults),
        client: o.client,
        subject: o.subject,
        grade: o.grade,
        quarter: o.quarter,
        lesson: lessonNumMatch ? String(parseInt(o.lesson, 10) + 1) : o.lesson,
        start: dateKey(newStart),
        deadline: dateKey(addDays(newStart, durationDays)),
        estimatedHours: o.estimatedHours,
        taxType: o.taxType,
        lines: o.lines.length ? JSON.parse(JSON.stringify(o.lines)).map((l: OrderLine) => ({ ...l, ready: false })) : [],
      })
    } else {
      setDraft(emptyDraft(defaults))
    }
    setConfirmDelete(!!startInDeleteConfirm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingOrder, duplicateFrom, startInDeleteConfirm])

  const lessonOptions = useMemo(() => {
    const opts: { id: string; label: string }[] = []
    planningBoards.forEach((board) => {
      board.lessons.forEach((lesson) => {
        const label = `${board.subject ? board.subject + " · " : ""}${board.title}${board.quarter ? " · " + board.quarter : ""} — Урок ${lesson.num}`
        opts.push({ id: lesson.id, label })
      })
    })
    return opts
  }, [planningBoards])

  const baseTotal = orderBaseTotal(draft)

  // Раньше здесь стояли выражения, повторяющие orderPaymentState — третья
  // копия одной формулы, которая уже начинала расходиться с остальными.
  const pay = draftPaymentState(draft)
  const totalWithTax = pay.full
  const advUsed = pay.advUsed
  const remaining = pay.remaining
  // Сырая сумма платежей, без обрезки по стоимости заказа: «Получено деньгами»
  // должно показывать, сколько реально внесено, даже если это переплата.
  const paymentsTotal = draft.payments.reduce((s, p) => s + parseNum(p.amount), 0)

  // Тот же расчёт, что у Клиентов и Финансов — своя копия жила прямо здесь.
  const clientStats = useMemo(
    () => getClientAdvanceStats(draft.client, advances, orders, draft.id),
    [advances, orders, draft.client, draft.id]
  )

  const advanceExceedsOrder = parseNum(draft.advanceUsed) > totalWithTax + 0.01

  // Сколько аванса реально доступно под ЭТОТ заказ.
  //
  // Раньше сюда прибавлялось списание самого заказа — чтобы при редактировании
  // собственная сумма не выглядела как чужая и не «съедала» лимит. Но
  // getClientAdvanceStats уже исключает этот заказ из израсходованного
  // (последним аргументом передаётся его id), и прибавка считала его второй
  // раз: предупреждение о перерасходе включалось позже, чем следовало, а
  // «Списать всё» подставляло сумму больше внесённой.
  const advanceAvailableHere = clientStats.available
  // Ограничения на это не было вовсе: сумма резалась только стоимостью заказа,
  // а против реально внесённого аванса не проверялась. Списать можно было
  // больше, чем клиент когда-либо платил, и перерасход не было видно —
  // «Доступно» обрезается до нуля через Math.max(0, …) и всё выглядело нормально.
  const advanceOverdraft = Math.max(0, parseNum(draft.advanceUsed) - advanceAvailableHere)

  // Та же логика, что в таймере (useTimerStore.flushSegment): время идёт в
  // первую неготовую позицию, а если готовы все — в последнюю.
  const timerLineId = (draft.lines.find((l) => !l.ready) || draft.lines[draft.lines.length - 1])?.id

  function updateLine(id: string, patch: Partial<OrderLine>) {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  }

  /**
   * Отметка «готово» у позиции. Таймер капает время в ПЕРВУЮ неготовую
   * позицию заказа, поэтому этой галочкой его и переводят на следующую.
   *
   * Чекбокс был в ванильной версии, а в React-порт не попал: поле ready
   * осталось в данных, но выставить его стало нечем — время навсегда шло в
   * первую позицию.
   *
   * Пишем сразу в сохранённый заказ, не дожидаясь кнопки «Сохранить»:
   * таймер читает заказ из хранилища, а не черновик формы, и иначе не
   * переключился бы до закрытия окна. Так же было и в ванильной версии.
   */
  function toggleReady(id: string) {
    const next = !draft.lines.find((l) => l.id === id)?.ready
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ready: next } : l)) }))
    if (editingOrder) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === editingOrder.id
            ? { ...o, lines: o.lines.map((l) => (l.id === id ? { ...l, ready: next } : l)) }
            : o
        )
      )
      saveData()
    }
  }
  function addLine() {
    setDraft((d) => ({ ...d, lines: [...d.lines, blankLine(defaults)] }))
  }
  function removeLine(id: string) {
    setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }))
  }

  function updatePayment(id: string, patch: Partial<Payment>) {
    setDraft((d) => ({ ...d, payments: d.payments.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  }
  function addPayment(amount?: number) {
    const rest = amount ?? Math.max(0, Math.round(remaining * 100) / 100)
    setDraft((d) => ({ ...d, payments: [...d.payments, normalizePayment({ amount: rest || undefined, date: dateKey(new Date()), note: "" })] }))
  }
  function removePayment(id: string) {
    setDraft((d) => ({ ...d, payments: d.payments.filter((p) => p.id !== id) }))
  }
  function fillFullPayment() {
    if (remaining <= 0) return
    addPayment(Math.round(remaining * 100) / 100)
  }
  function fillMaxAdvance() {
    setDraft((d) => ({ ...d, advanceUsed: Math.round(Math.min(advanceAvailableHere, totalWithTax)) }))
  }

  function applyTemplate(templateId: string) {
    const t = appSettings.orderTemplates.find((x) => x.id === templateId)
    if (!t) return
    setDraft((d) => ({
      ...d,
      lines: t.lines.map((l) => ({ id: randId("l"), label: l.label, type: l.type, qty: l.qty, rate: l.rate, pomoHours: 0, ignorePrice: false, ready: false })),
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    let title = draft.title.trim()
    if (!title) title = [draft.subject, draft.grade, draft.quarter, draft.lesson && `Урок ${draft.lesson}`].filter(Boolean).join(", ")

    const nextSettings = { ...appSettings }
    let settingsChanged = false
    if (draft.subject && !nextSettings.subjects.includes(draft.subject)) { nextSettings.subjects = [...nextSettings.subjects, draft.subject]; settingsChanged = true }
    if (draft.grade && !nextSettings.classes.includes(draft.grade)) { nextSettings.classes = [...nextSettings.classes, draft.grade]; settingsChanged = true }
    if (settingsChanged) setAppSettings(nextSettings)

    const cleanPayments = draft.payments.filter((p) => parseNum(p.amount) > 0).map(normalizePayment)
    const cleanLines = draft.lines.filter((l) => l.label.trim() !== "" || parseNum(l.qty) || parseNum(l.pomoHours))

    const finalOrder: Order = {
      ...draft,
      id: editingOrder ? editingOrder.id : randId("o"),
      title,
      client: draft.client.trim(),
      quarter: draft.quarter.trim(),
      lesson: draft.lesson.trim(),
      payments: cleanPayments,
      advanceUsed: parseNum(draft.advanceUsed),
      lines: cleanLines,
      notes: draft.notes.trim(),
      createdAt: editingOrder ? editingOrder.createdAt : Date.now(),
    }
    // Считаем по УЖЕ ОЧИЩЕННЫМ позициям и платежам, а не по черновику: пустые
    // строки и нулевые платежи из формы в заказ не идут.
    // paidAmount — сырая сумма платежей, без обрезки по стоимости заказа:
    // это зеркало списка платежей (так же его пишет и cloudSync), переплату
    // терять нельзя. Обрезка живёт только в расчёте покрытия.
    finalOrder.paidAmount = cleanPayments.reduce((s, p) => s + parseNum(p.amount), 0)
    finalOrder.isPaid = draftPaymentState(finalOrder).isFullyPaid
    finalOrder.paidAt = cleanPayments.length ? cleanPayments[0].date || null : null

    const entry = recordActivityChanges(editingOrder, finalOrder)

    setOrders((prev) => {
      const idx = prev.findIndex((o) => o.id === finalOrder.id)
      return idx >= 0 ? prev.map((o, i) => (i === idx ? finalOrder : o)) : [...prev, finalOrder]
    })
    if (entry) setActivityLog((prev) => [...prev, entry])

    saveData()
    onOpenChange(false)
  }

  function handleDelete(wipeStats: boolean) {
    if (!editingOrder) return
    const id = editingOrder.id
    setOrders((prev) => prev.filter((o) => o.id !== id))
    deleteFromCloud("orders", id)
    if (wipeStats) {
      setActivityLog((prev) => prev.filter((e) => e.orderId !== id))
      deleteActivityLogForOrder(id)
    }
    saveData()
    setConfirmDelete(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-full flex-col overflow-x-hidden overflow-y-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingOrder ? "Изменить заказ" : "Новый заказ"}</DialogTitle>
        </DialogHeader>

        {confirmDelete ? (
          <div className="flex flex-col gap-3 overflow-y-auto px-1 py-2">
            <p className="text-[13px] text-muted-foreground">
              Заказ будет удалён безвозвратно. Выберите, что сделать со статистикой (часы), которая уже была по нему записана в журнал активности.
            </p>
            <Button variant="destructive" onClick={() => handleDelete(true)}>Удалить и очистить статистику по нему</Button>
            <Button variant="outline" onClick={() => handleDelete(false)}>Удалить, но оставить статистику как есть</Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Отмена</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 pb-1">
            <Field label="Название проекта (опционально)">
              <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Введите название или оставьте пустым" />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Клиент / заказчик">
                <ComboInput value={draft.client} onChange={(v) => setDraft((d) => ({ ...d, client: v }))} options={catalogWithCurrent(appSettings, "clients", draft.client)} placeholder="Введите или выберите..." />
              </Field>
              <Field label={<div className="flex items-center justify-between"><span>Статус</span>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-destructive normal-case">
                  <Checkbox checked={draft.priority} onCheckedChange={(c) => setDraft((d) => ({ ...d, priority: !!c }))} />
                  Приоритетный
                </label>
              </div>}>
                <Select value={draft.status} onValueChange={(v) => setDraft((d) => ({ ...d, status: v as OrderStatus }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Предмет">
                <ComboInput value={draft.subject} onChange={(v) => setDraft((d) => ({ ...d, subject: v }))} options={catalogWithCurrent(appSettings, "subjects", draft.subject)} />
              </Field>
              <Field label="Класс">
                <ComboInput value={draft.grade} onChange={(v) => setDraft((d) => ({ ...d, grade: v }))} options={catalogWithCurrent(appSettings, "classes", draft.grade)} />
              </Field>
              <Field label="Четверть">
                <Input value={draft.quarter} onChange={(e) => setDraft((d) => ({ ...d, quarter: e.target.value }))} placeholder="1 четверть" />
              </Field>
              <Field label="№ урока">
                <Input value={draft.lesson} onChange={(e) => setDraft((d) => ({ ...d, lesson: e.target.value }))} placeholder="12" />
              </Field>
            </div>

            {lessonOptions.length > 0 && (
              <Field label="Привязка к уроку в планировании">
                <Select
                  value={draft.linkedLessonId || "none"}
                  onValueChange={(v) => setDraft((d) => ({ ...d, linkedLessonId: v === "none" ? null : v }))}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Не привязывать (искать по тексту) —</SelectItem>
                    {lessonOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Дата начала">
                <Input type="date" required value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} />
              </Field>
              <Field label="Планируемый срок сдачи">
                <Input type="date" required value={draft.deadline} onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Оценка (часов)">
                <Input inputMode="decimal" value={draft.estimatedHours} onChange={(e) => setDraft((d) => ({ ...d, estimatedHours: e.target.value }))} placeholder="План. часы" />
              </Field>
              <Field label="Факт. часы">
                <Input inputMode="decimal" value={draft.actualHours} onChange={(e) => setDraft((d) => ({ ...d, actualHours: e.target.value }))} placeholder="Факт. часы" />
              </Field>
            </div>

            {/* Аванс */}
            <div className="rounded-xl border border-border bg-muted/60 p-4">
              <div className="mb-3 text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Аванс клиента по заказу</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-[10.5px] font-bold text-muted-foreground">Доступно у клиента</div>
                  <div className="font-heading mt-0.5 text-[15px] font-bold">{fmtMoney(clientStats.available)}</div>
                </div>
                <Field label="Списать на этот заказ">
                  <NumberInput
                    value={draft.advanceUsed}
                    onChange={(n) => setDraft((d) => ({ ...d, advanceUsed: n }))}
                    className={advanceExceedsOrder || advanceOverdraft > 0 ? "border-destructive" : undefined}
                    title={
                      advanceOverdraft > 0
                        ? `У клиента доступно только ${fmtMoney(advanceAvailableHere)} — не хватает ${fmtMoney(advanceOverdraft)}.`
                        : advanceExceedsOrder
                          ? `Это больше, чем стоимость заказа (${fmtMoney(totalWithTax)}).`
                          : undefined
                    }
                  />
                </Field>
                <div>
                  <div className="text-[10.5px] font-bold text-muted-foreground">Остаток после аванса</div>
                  <div className="font-heading mt-0.5 text-[15px] font-bold">{fmtMoney(Math.max(0, totalWithTax - advUsed))}</div>
                </div>
              </div>
              {advanceOverdraft > 0 && (
                <div className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] font-bold text-destructive">
                  Списано больше, чем внесено: у клиента доступно {fmtMoney(advanceAvailableHere)}, не хватает {fmtMoney(advanceOverdraft)}.
                  Внесите аванс на Финансах или уменьшите сумму.
                </div>
              )}
              <button type="button" onClick={fillMaxAdvance} className="mt-2 text-[11.5px] font-bold text-foreground hover:underline">
                Списать всё
              </button>
            </div>

            {/* Оплата */}
            <div className="rounded-xl border border-border bg-muted/60 p-4">
              <div className="mb-3 text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Оплата по заказу</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-[10.5px] font-bold text-muted-foreground">Стоимость заказа</div>
                  <div className="font-heading mt-0.5 text-[15px] font-bold">{fmtMoney(totalWithTax)}</div>
                </div>
                <div>
                  <div className="text-[10.5px] font-bold text-muted-foreground">Получено деньгами</div>
                  <div className="font-heading mt-0.5 text-[15px] font-bold">{fmtMoney(paymentsTotal)}</div>
                </div>
                <div>
                  <div className="text-[10.5px] font-bold text-muted-foreground">К доплате</div>
                  <div className="font-heading mt-0.5 text-[15px] font-bold">{fmtMoney(remaining)}</div>
                </div>
              </div>

              {draft.payments.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {draft.payments.map((p) => (
                    <div key={p.id} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.4fr_28px]">
                      <NumberInput value={p.amount} onChange={(n) => updatePayment(p.id, { amount: n })} placeholder="Сумма ₽" />
                      <Input type="date" value={p.date} onChange={(e) => updatePayment(p.id, { date: e.target.value })} />
                      <div className="col-span-2 flex gap-2 sm:contents">
                        <Input value={p.note} onChange={(e) => updatePayment(p.id, { note: e.target.value })} placeholder="Примечание" className="flex-1" />
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => removePayment(p.id)}><Trash2 className="text-muted-foreground" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-4 text-[11.5px] font-bold text-foreground">
                <button type="button" onClick={() => addPayment()} className="hover:underline">+ Добавить платёж</button>
                <button type="button" onClick={fillFullPayment} className="hover:underline">Получил всё</button>
              </div>
            </div>

            {/* Позиции */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <Label>Состав заказа</Label>
                {appSettings.orderTemplates.length > 0 && (
                  <Select onValueChange={applyTemplate}>
                    <SelectTrigger size="sm" className="w-auto"><SelectValue placeholder="Вставить шаблон..." /></SelectTrigger>
                    <SelectContent>
                      {appSettings.orderTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {draft.lines.map((line) => (
                  <div
                    key={line.id}
                    className={cn(
                      "rounded-lg border border-border p-2",
                      // Подсвечиваем позицию, в которую сейчас капает время: без
                      // этого механизм таймера никак не виден, и непонятно,
                      // куда попадут часы.
                      line.id === timerLineId && "border-cta/50 bg-cta/5"
                    )}
                  >
                    {line.id === timerLineId && (
                      <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-bold text-cta">
                        <Clock className="size-3" strokeWidth={2.5} />
                        Сюда таймер записывает время
                      </div>
                    )}
                    {/* desktop / wide dialog — one compact row */}
                    <div className="hidden items-center gap-1.5 sm:grid sm:grid-cols-[24px_1.3fr_1fr_60px_80px_90px_80px_28px]">
                      <LineReady line={line} onToggle={() => toggleReady(line.id)} />
                      <ComboInput value={line.label} onChange={(v) => updateLine(line.id, { label: v })} options={catalogWithCurrent(appSettings, "types", line.label)} placeholder="Тип" inputClassName="h-8" />
                      <ComboInput value={line.type} onChange={(v) => updateLine(line.id, { type: v })} options={catalogWithCurrent(appSettings, "units", line.type)} placeholder="Ед. изм." inputClassName="h-8" />
                      <NumberInput value={line.qty} onChange={(n) => updateLine(line.id, { qty: n })} className="h-8" />
                      <NumberInput value={line.pomoHours} onChange={(n) => updateLine(line.id, { pomoHours: n })} placeholder="0 ч" className="h-8" title={isHourlyUnit(line) ? "Часы — по ним считается стоимость (часовая единица)" : "Часы для учёта, на стоимость не влияют"} />
                      <NumberInput value={line.rate} onChange={(n) => updateLine(line.id, { rate: n })} className="h-8" />
                      <div className="text-center text-[12.5px] font-bold tabular-nums">{fmtMoney(calculateLineTotal(line))}</div>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeLine(line.id)}><Trash2 className="text-muted-foreground" /></Button>
                    </div>

                    {/* mobile — stacked, labeled fields so nothing needs to scroll sideways */}
                    <div className="flex flex-col gap-2 sm:hidden">
                      <div className="flex items-center gap-2">
                        <LineReady line={line} onToggle={() => toggleReady(line.id)} />
                        <ComboInput value={line.label} onChange={(v) => updateLine(line.id, { label: v })} options={catalogWithCurrent(appSettings, "types", line.label)} placeholder="Тип" className="flex-1" inputClassName="h-8" />
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeLine(line.id)}><Trash2 className="text-muted-foreground" /></Button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <MiniField label="Ед. изм.">
                          <ComboInput value={line.type} onChange={(v) => updateLine(line.id, { type: v })} options={catalogWithCurrent(appSettings, "units", line.type)} inputClassName="h-8" />
                        </MiniField>
                        <MiniField label="Кол-во">
                          <NumberInput value={line.qty} onChange={(n) => updateLine(line.id, { qty: n })} className="h-8" />
                        </MiniField>
                        <MiniField label="Часы" title={isHourlyUnit(line) ? "Часы — по ним считается стоимость (часовая единица)" : "Часы для учёта, на стоимость не влияют"}>
                          <NumberInput value={line.pomoHours} onChange={(n) => updateLine(line.id, { pomoHours: n })} placeholder="0 ч" className="h-8" />
                        </MiniField>
                        <MiniField label="Цена, ₽">
                          <NumberInput value={line.rate} onChange={(n) => updateLine(line.id, { rate: n })} className="h-8" />
                        </MiniField>
                      </div>
                      <div className="flex justify-between text-[12.5px] font-bold">
                        <span className="text-muted-foreground">Итого по позиции</span>
                        <span className="tabular-nums">{fmtMoney(calculateLineTotal(line))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addLine}><Plus />Добавить позицию</Button>

              <Field label="Налог для конечной цены" className="mt-3">
                <Select value={draft.taxType} onValueChange={(v) => setDraft((d) => ({ ...d, taxType: v as TaxType }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без налога</SelectItem>
                    <SelectItem value="individual">Физ. лицо (+4%)</SelectItem>
                    <SelectItem value="entity">Юр. лицо (+6%)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <div className="mt-3 flex justify-between text-[13px] font-bold">
                <span className="text-muted-foreground">Сумма позиций:</span>
                <span className="tabular-nums">{fmtMoney(baseTotal)}</span>
              </div>
              <div className="flex justify-between text-[13px] font-bold">
                <span className="text-muted-foreground">Конечная цена (с учётом налога):</span>
                <span className="tabular-nums">{fmtMoney(totalWithTax)}</span>
              </div>
            </div>

            <Field label="Заметки и требования">
              <Textarea value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Ссылка на ТЗ, правки..." rows={3} />
            </Field>

            <DialogFooter className="sticky bottom-0 -mx-1 mt-2 gap-2 border-t border-border bg-popover px-1 pt-3">
              {editingOrder && (
                <Button type="button" variant="destructive" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                  Удалить
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
              <Button type="submit" className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">{label}</Label>
      {children}
    </div>
  )
}

function MiniField({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div title={title}>
      <div className="mb-1 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{label}</div>
      {children}
    </div>
  )
}
