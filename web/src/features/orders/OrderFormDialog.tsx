import { useEffect, useMemo, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { useAppStore } from "@/store/useAppStore"
import { saveData, deleteFromCloud, deleteActivityLogForOrder } from "@/lib/cloudSync"
import { recordActivityChanges } from "@/lib/activity"
import { parseNum, fmtMoney, dateKey, addDays, calculateLineTotal, isHourlyUnit, orderTaxRate } from "@/lib/money"
import { normalizePayment } from "@/lib/normalize"
import type { Order, OrderLine, Payment, TaxType, OrderStatus } from "@/types/models"

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: "queue", label: "В очереди" },
  { value: "progress", label: "В работе" },
  { value: "review", label: "На согласовании" },
  { value: "done", label: "Завершён" },
  { value: "cancelled", label: "Отменён" },
]

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

  const defaults = { type: appSettings.types[0] || "Презентация", unit: appSettings.units[0] || "Слайд" }
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

  const baseTotal = useMemo(() => draft.lines.reduce((s, l) => s + calculateLineTotal(l), 0), [draft.lines])
  const taxRate = orderTaxRate(draft)
  const totalWithTax = Math.round(baseTotal * (1 + taxRate))

  const clientStats = useMemo(() => {
    const name = draft.client.trim().toLowerCase()
    if (!name) return { totalIn: 0, used: 0, available: 0 }
    const totalIn = advances.filter((a) => a.client.toLowerCase() === name).reduce((s, a) => s + parseNum(a.amount), 0)
    const used = orders
      .filter((o) => o.client.toLowerCase() === name && o.status !== "cancelled" && o.id !== draft.id)
      .reduce((s, o) => s + parseNum(o.advanceUsed), 0)
    return { totalIn, used, available: Math.max(0, totalIn - used) }
  }, [advances, orders, draft.client, draft.id])

  const advUsed = Math.min(parseNum(draft.advanceUsed), totalWithTax)
  const paymentsTotal = draft.payments.reduce((s, p) => s + parseNum(p.amount), 0)
  const remaining = Math.max(0, totalWithTax - advUsed - paymentsTotal)
  const advanceExceedsOrder = parseNum(draft.advanceUsed) > totalWithTax + 0.01

  function updateLine(id: string, patch: Partial<OrderLine>) {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
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
    const trueAvail = clientStats.available + (editingOrder ? parseNum(editingOrder.advanceUsed) : 0)
    setDraft((d) => ({ ...d, advanceUsed: Math.round(Math.min(trueAvail, totalWithTax)) }))
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
    const paidTotal = cleanPayments.reduce((s, p) => s + parseNum(p.amount), 0)
    const fullExact = cleanLines.reduce((s, l) => s + calculateLineTotal(l), 0) * (1 + orderTaxRate(finalOrder))
    finalOrder.paidAmount = paidTotal
    finalOrder.isPaid = Math.round(fullExact) > 0 && Math.max(0, Math.round(fullExact) - Math.min(finalOrder.advanceUsed, Math.round(fullExact)) - paidTotal) <= 0
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
      <DialogContent className="flex max-h-[88vh] w-full flex-col overflow-hidden sm:max-w-2xl">
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
                <Input list="clients-list" value={draft.client} onChange={(e) => setDraft((d) => ({ ...d, client: e.target.value }))} placeholder="Введите или выберите..." />
                <datalist id="clients-list">
                  {appSettings.clients.map((c) => <option key={c} value={c} />)}
                </datalist>
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
                <Input list="subjects-list" value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
                <datalist id="subjects-list">{appSettings.subjects.map((s) => <option key={s} value={s} />)}</datalist>
              </Field>
              <Field label="Класс">
                <Input list="classes-list" value={draft.grade} onChange={(e) => setDraft((d) => ({ ...d, grade: e.target.value }))} />
                <datalist id="classes-list">{appSettings.classes.map((c) => <option key={c} value={c} />)}</datalist>
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
                  <Input
                    inputMode="decimal"
                    value={draft.advanceUsed}
                    onChange={(e) => setDraft((d) => ({ ...d, advanceUsed: parseNum(e.target.value) }))}
                    className={advanceExceedsOrder ? "border-destructive" : undefined}
                    title={advanceExceedsOrder ? `Это больше, чем стоимость заказа (${fmtMoney(totalWithTax)}).` : undefined}
                  />
                </Field>
                <div>
                  <div className="text-[10.5px] font-bold text-muted-foreground">Остаток после аванса</div>
                  <div className="font-heading mt-0.5 text-[15px] font-bold">{fmtMoney(Math.max(0, totalWithTax - advUsed))}</div>
                </div>
              </div>
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
                      <Input inputMode="decimal" value={p.amount} onChange={(e) => updatePayment(p.id, { amount: parseNum(e.target.value) })} placeholder="Сумма ₽" />
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
                  <div key={line.id} className="rounded-lg border border-border p-2">
                    {/* desktop / wide dialog — one compact row */}
                    <div className="hidden items-center gap-1.5 sm:grid sm:grid-cols-[1.3fr_1fr_60px_80px_90px_80px_28px]">
                      <Input list="types-list" value={line.label} onChange={(e) => updateLine(line.id, { label: e.target.value })} placeholder="Тип" className="h-8" />
                      <Input list="units-list" value={line.type} onChange={(e) => updateLine(line.id, { type: e.target.value })} placeholder="Ед. изм." className="h-8" />
                      <Input inputMode="decimal" value={line.qty} onChange={(e) => updateLine(line.id, { qty: parseNum(e.target.value) })} className="h-8" />
                      <Input inputMode="decimal" value={line.pomoHours} onChange={(e) => updateLine(line.id, { pomoHours: parseNum(e.target.value) })} placeholder="0 ч" className="h-8" title={isHourlyUnit(line) ? "Часы — по ним считается стоимость (часовая единица)" : "Часы для учёта, на стоимость не влияют"} />
                      <Input inputMode="decimal" value={line.rate} onChange={(e) => updateLine(line.id, { rate: parseNum(e.target.value) })} className="h-8" />
                      <div className="text-center text-[12.5px] font-bold tabular-nums">{fmtMoney(calculateLineTotal(line))}</div>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeLine(line.id)}><Trash2 className="text-muted-foreground" /></Button>
                    </div>

                    {/* mobile — stacked, labeled fields so nothing needs to scroll sideways */}
                    <div className="flex flex-col gap-2 sm:hidden">
                      <div className="flex items-center gap-2">
                        <Input list="types-list" value={line.label} onChange={(e) => updateLine(line.id, { label: e.target.value })} placeholder="Тип" className="h-8 flex-1" />
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeLine(line.id)}><Trash2 className="text-muted-foreground" /></Button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <MiniField label="Ед. изм.">
                          <Input list="units-list" value={line.type} onChange={(e) => updateLine(line.id, { type: e.target.value })} className="h-8" />
                        </MiniField>
                        <MiniField label="Кол-во">
                          <Input inputMode="decimal" value={line.qty} onChange={(e) => updateLine(line.id, { qty: parseNum(e.target.value) })} className="h-8" />
                        </MiniField>
                        <MiniField label="Часы" title={isHourlyUnit(line) ? "Часы — по ним считается стоимость (часовая единица)" : "Часы для учёта, на стоимость не влияют"}>
                          <Input inputMode="decimal" value={line.pomoHours} onChange={(e) => updateLine(line.id, { pomoHours: parseNum(e.target.value) })} placeholder="0 ч" className="h-8" />
                        </MiniField>
                        <MiniField label="Цена, ₽">
                          <Input inputMode="decimal" value={line.rate} onChange={(e) => updateLine(line.id, { rate: parseNum(e.target.value) })} className="h-8" />
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
              <datalist id="types-list">{appSettings.types.map((t) => <option key={t} value={t} />)}</datalist>
              <datalist id="units-list">{appSettings.units.map((u) => <option key={u} value={u} />)}</datalist>

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
              <Button type="submit" className="bg-emphasis/90 font-extrabold text-emphasis-foreground hover:bg-emphasis">
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
