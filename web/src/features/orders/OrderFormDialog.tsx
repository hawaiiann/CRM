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
import { useTimerStore } from "@/store/useTimerStore"
import { saveData, deleteFromCloud, deleteActivityLogForOrder, applyHoursDelta } from "@/lib/cloudSync"
import { actualHours } from "@/lib/activity"
import { cn } from "@/lib/utils"
import { parseNum, parseHours, fmtMoney, fmtHours, dateKey, addDays, calculateLineTotal, isHourlyUnit, orderTotal, orderPriceBreakdown, lineTakesAi, URGENCY_OPTIONS, draftPaymentState } from "@/lib/money"
import { getClientAdvanceStats, clientAdvanceRows, orderUnallocatedAdvance, allocateGreedy } from "@/lib/advances"
import { fmtDeadline } from "@/lib/dates"
import { normalizePayment } from "@/lib/normalize"
import { confirmDialog } from "@/store/useDialogStore"
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
    advanceAllocations: [],
    payments: [],
    paidAmount: 0,
    taxType: "none",
    aiRate: 0,
    urgencyPct: 0,
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
  prefill,
  startInDeleteConfirm,
  onOpenChange,
}: {
  open: boolean
  editingOrder: Order | null
  duplicateFrom: Order | null
  /** Новый заказ с заранее заполненными полями — например, из урока планирования. */
  prefill?: Partial<Order> | null
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
  // За какой день записать в журнал разницу часов, набранную руками в этой
  // форме, и записывать ли вообще. Раньше любая правка «Факт. часов» или
  // часов у позиции молча уходила в журнал как отработанное СЕГОДНЯ — так и
  // появлялись «30 часов за день» после опечатки в поле.
  const [journalDate, setJournalDate] = useState(() => dateKey(new Date()))
  const [journalSkip, setJournalSkip] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editingOrder) {
      setDraft(JSON.parse(JSON.stringify(editingOrder)))
    } else if (duplicateFrom) {
      const o = duplicateFrom
      // Даты — по местному времени (new Date("ГГГГ-ММ-ДД") читает их как UTC), и
      // заказ «в тот же день» остаётся однодневным: раньше `|| 7` превращал
      // нулевую длительность в неделю.
      const local = (s: string) => { const [y, m, d] = (s || "").split("-").map(Number); return y && m && d ? new Date(y, m - 1, d) : null }
      const startD = local(o.start), endD = local(o.deadline)
      const durationDays = startD && endD ? Math.max(0, Math.round((endD.getTime() - startD.getTime()) / 86400000)) : 7
      const newStart = endD ? addDays(endD, 1) : new Date()
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
        // Ставка за нейросети — свойство работы, у следующего урока она та же.
        // Срочность — свойство конкретного заказа, её не переносим.
        aiRate: o.aiRate || 0,
        // Часы таймера у копии обнуляются: это время отработано по ОРИГИНАЛУ.
        // Раньше они копировались, и при сохранении копии вся сумма часов
        // записывалась в журнал как отработанная сегодня ещё раз.
        lines: o.lines.length ? JSON.parse(JSON.stringify(o.lines)).map((l: OrderLine) => ({ ...l, ready: false, pomoHours: 0 })) : [],
      })
    } else if (prefill) {
      setDraft({ ...emptyDraft(defaults), ...prefill })
    } else {
      setDraft(emptyDraft(defaults))
    }
    setConfirmDelete(!!startInDeleteConfirm)
    setJournalDate(dateKey(new Date()))
    setJournalSkip(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingOrder, duplicateFrom, prefill, startInDeleteConfirm])

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

  // Цена по шагам: позиции → нейросети → срочность → налог (lib/money.ts).
  const price = orderPriceBreakdown(draft)
  // Позиции, на которые вообще может идти надбавка за нейросети: штучные и
  // оплачиваемые. Отключённые (noAi) тоже здесь — их можно вернуть.
  const aiLines = draft.lines.filter((l) => !l.ignorePrice && !isHourlyUnit(l) && (l.label || l.type))

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

  // На сколько часов черновик отличается от сохранённого заказа — ровно эта
  // разница уйдёт в журнал при сохранении (за день из journalDate).
  const hoursDelta = Math.round((actualHours(draft) - (editingOrder ? actualHours(editingOrder) : 0)) * 10000) / 10000

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

  /**
   * Удаление позиции может «осиротить» уже учтённые деньги: аванс и платежи
   * на заказе не пересчитываются вслед за ценой, и если сумма позиций падает
   * ниже уже внесённого, разница молча выпадает из «Получено»/«К доплате»
   * (см. overpaid в paymentBreakdown, lib/money.ts). Деньги при этом никуда
   * не исчезают — просто переставали быть видны нигде, и обнаружить это
   * можно было только листая цифры вручную. Спрашиваем заранее, если именно
   * ЭТА позиция впервые создаёт или увеличивает переплату.
   */
  async function removeLine(id: string) {
    const line = draft.lines.find((l) => l.id === id)
    if (!line) return

    const nextLines = draft.lines.filter((l) => l.id !== id)
    const nextFull = Math.round(orderTotal({ ...draft, lines: nextLines }))
    const committed = parseNum(draft.advanceUsed) + paymentsTotal
    const newlyOrphaned = Math.round((Math.max(0, committed - nextFull) - pay.overpaid) * 100) / 100

    if (newlyOrphaned > 0.5) {
      const ok = await confirmDialog({
        title: "Удалить позицию?",
        body:
          `«${line.label || line.type}» — ${fmtMoney(calculateLineTotal(line))}.\n\n` +
          `По заказу уже учтено ${fmtMoney(committed)} (аванс + платежи). После удаления заказ подешевеет до ${fmtMoney(nextFull)}, ` +
          `и ${fmtMoney(newlyOrphaned)} перестанут попадать в «Получено» и «К доплате» — деньги никуда не денутся, просто заказ станет дешевле уже учтённой суммы.`,
        confirmLabel: "Удалить позицию",
        destructive: true,
      })
      if (!ok) return
    }

    setDraft((d) => ({ ...d, lines: nextLines }))
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
  // Списание по конкретным авансам. advanceUsed остаётся итогом (по нему
  // считаются деньги), advanceAllocations — разбивка; их разница — списание
  // без привязки у старых заказов, его можно уменьшить до нуля здесь же.
  const advanceRows = useMemo(
    () => clientAdvanceRows(draft.client, advances, orders, draft.id),
    [advances, orders, draft.client, draft.id]
  )
  const unallocated = orderUnallocatedAdvance(draft)
  // Сумма, а не первая строка: после слияния дублей на один аванс бывало две.
  const allocationOf = (advanceId: string) => (draft.advanceAllocations || []).filter((a) => a.advanceId === advanceId).reduce((s, a) => s + parseNum(a.amount), 0)
  // Списания с авансов, которых нет среди авансов клиента: аванс удалили или
  // у заказа сменили клиента. Раньше таких строк в форме не было вовсе —
  // сумма висела невидимой, и правка соседней строки давала неверный итог.
  const orphanAllocations = useMemo(() => {
    const known = new Set(advanceRows.map((r) => r.advance.id))
    const ids = [...new Set((draft.advanceAllocations || []).map((a) => a.advanceId))].filter((id) => !known.has(id))
    return ids.map((id) => ({ advanceId: id, amount: (draft.advanceAllocations || []).filter((a) => a.advanceId === id).reduce((s, a) => s + parseNum(a.amount), 0), advance: advances.find((a) => a.id === id) }))
  }, [advanceRows, draft.advanceAllocations, advances])

  function setAllocation(advanceId: string, amount: number) {
    setDraft((d) => {
      const rest = (d.advanceAllocations || []).filter((a) => a.advanceId !== advanceId)
      const next = amount > 0 ? [...rest, { advanceId, amount }] : rest
      const keepUnallocated = orderUnallocatedAdvance(d)
      return { ...d, advanceAllocations: next, advanceUsed: Math.round((next.reduce((s, a) => s + a.amount, 0) + keepUnallocated) * 100) / 100 }
    })
  }
  function setUnallocated(amount: number) {
    setDraft((d) => {
      const allocated = (d.advanceAllocations || []).reduce((s, a) => s + a.amount, 0)
      return { ...d, advanceUsed: Math.round((allocated + Math.max(0, amount)) * 100) / 100 }
    })
  }
  function fillMaxAdvance() {
    // Старые первыми, не больше остатка каждого и не больше стоимости заказа;
    // сверху — не больше, чем у клиента вообще осталось (с учётом списаний
    // без привязки у других заказов).
    const target = Math.round(Math.min(advanceAvailableHere, totalWithTax))
    const next = allocateGreedy(advanceRows, target)
    setDraft((d) => ({ ...d, advanceAllocations: next, advanceUsed: next.reduce((s, a) => s + a.amount, 0) }))
  }

  function applyTemplate(templateId: string) {
    const t = appSettings.orderTemplates.find((x) => x.id === templateId)
    if (!t) return
    // Часы уже отработанных позиций не пропадают: переходят в позицию шаблона
    // с тем же названием, а без пары — в первую. Раньше шаблон заменял всё, и
    // «минус столько-то часов» уходил в журнал сегодняшним днём.
    setDraft((d) => {
      const norm = (s: string) => (s || "").trim().toLowerCase()
      const lines: OrderLine[] = t.lines.map((l) => ({ id: randId("l"), label: l.label, type: l.type, qty: l.qty, rate: l.rate, pomoHours: 0, ignorePrice: false, ready: false }))
      d.lines.forEach((old) => {
        const h = parseHours(old.pomoHours)
        if (!(h > 0) || !lines.length) return
        const target = lines.find((l) => norm(l.label) === norm(old.label)) || lines[0]
        target.pomoHours = Math.round((parseHours(target.pomoHours) + h) * 10000) / 10000
      })
      return { ...d, lines }
    })
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
      subject: draft.subject.trim(),
      grade: draft.grade.trim(),
      quarter: draft.quarter.trim(),
      lesson: draft.lesson.trim(),
      payments: cleanPayments,
      advanceUsed: parseNum(draft.advanceUsed),
      advanceAllocations: (draft.advanceAllocations || []).filter((a) => parseNum(a.amount) > 0),
      lines: cleanLines,
      notes: draft.notes.trim(),
      createdAt: editingOrder ? editingOrder.createdAt : Date.now(),
    }

    // Разница часов, набранная руками в форме, — до того, как добавим время
    // таймера: его он уже записал в журнал сам.
    const delta = Math.round((actualHours(finalOrder) - (editingOrder ? actualHours(editingOrder) : 0)) * 10000) / 10000

    // Время, которое таймер записал, пока форма была открыта. Черновик снят
    // при открытии и об этом времени не знает: раньше сохранение возвращало
    // часы позиций к прежним (у почасовых — и цену), а в журнале эти минуты
    // оставались.
    if (editingOrder) {
      const stored = useAppStore.getState().orders.find((o) => o.id === editingOrder.id)
      if (stored) {
        const round4 = (n: number) => Math.round(n * 10000) / 10000
        const openedHours = new Map(editingOrder.lines.map((l) => [l.id, parseHours(l.pomoHours)]))
        finalOrder.lines = finalOrder.lines.map((l) => {
          const now = stored.lines.find((x) => x.id === l.id)
          const was = openedHours.get(l.id)
          if (!now || was === undefined) return l
          const timerAdded = parseHours(now.pomoHours) - was
          return timerAdded > 1e-6 ? { ...l, pomoHours: round4(parseHours(l.pomoHours) + timerAdded) } : l
        })
        // Заказ без позиций: таймер пишет в «Факт. часы».
        const factAdded = parseHours(stored.actualHours) - parseHours(editingOrder.actualHours)
        if (!editingOrder.lines.length && factAdded > 1e-6) finalOrder.actualHours = String(round4(parseHours(finalOrder.actualHours) + factAdded))
      }
    }

    // Считаем по УЖЕ ОЧИЩЕННЫМ позициям и платежам, а не по черновику: пустые
    // строки и нулевые платежи из формы в заказ не идут.
    // paidAmount — сырая сумма платежей, без обрезки по стоимости заказа:
    // это зеркало списка платежей (так же его пишет и cloudSync), переплату
    // терять нельзя. Обрезка живёт только в расчёте покрытия.
    finalOrder.paidAmount = cleanPayments.reduce((s, p) => s + parseNum(p.amount), 0)
    finalOrder.isPaid = draftPaymentState(finalOrder).isFullyPaid
    finalOrder.paidAt = cleanPayments.length ? cleanPayments[0].date || null : null

    setOrders((prev) => {
      const idx = prev.findIndex((o) => o.id === finalOrder.id)
      return idx >= 0 ? prev.map((o, i) => (i === idx ? finalOrder : o)) : [...prev, finalOrder]
    })

    if (delta && !journalSkip) applyHoursDelta(finalOrder.id, journalDate || dateKey(new Date()), delta)

    saveData()
    onOpenChange(false)
  }

  function handleDelete(wipeStats: boolean) {
    if (!editingOrder) return
    const id = editingOrder.id
    setOrders((prev) => prev.filter((o) => o.id !== id))
    useTimerStore.getState().orderRemoved(id)
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
            <p className="text-sm text-muted-foreground">
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
                <label className="flex cursor-pointer items-center gap-1.5 text-2xs font-bold text-destructive normal-case">
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

            {/* Появляется только когда часы в форме реально изменились: сюда
                входят и «Факт. часы», и часы у позиций. Без этого блока
                разница записывалась в журнал за сегодня без спроса. */}
            {hoursDelta !== 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-xs">
                <span>
                  Часы по заказу {hoursDelta > 0 ? "вырастут" : "уменьшатся"} на{" "}
                  <b className="font-bold">{fmtHours(Math.abs(hoursDelta))}</b>. Записать в журнал за
                </span>
                <Input
                  type="date"
                  value={journalDate}
                  disabled={journalSkip}
                  onChange={(e) => setJournalDate(e.target.value)}
                  className="h-8 w-auto"
                />
                <label className="flex cursor-pointer items-center gap-1.5 font-bold">
                  <Checkbox checked={journalSkip} onCheckedChange={(c) => setJournalSkip(!!c)} />
                  Не записывать в журнал
                </label>
              </div>
            )}

            {/* Аванс */}
            <div className="rounded-xl border border-border bg-muted/60 p-4">
              <div className="mb-3 text-2xs font-extrabold tracking-wide text-muted-foreground uppercase">Аванс клиента по заказу</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-2xs font-bold text-muted-foreground">Доступно у клиента</div>
                  <div className="font-heading mt-0.5 text-lg font-bold">{fmtMoney(clientStats.available)}</div>
                </div>
                <div>
                  <div className="text-2xs font-bold text-muted-foreground">Списано на этот заказ</div>
                  <div className={cn("font-heading mt-0.5 text-lg font-bold", (advanceExceedsOrder || advanceOverdraft > 0) && "text-destructive")}>
                    {fmtMoney(draft.advanceUsed)}
                  </div>
                </div>
                <div>
                  <div className="text-2xs font-bold text-muted-foreground">Остаток после аванса</div>
                  <div className="font-heading mt-0.5 text-lg font-bold">{fmtMoney(Math.max(0, totalWithTax - advUsed))}</div>
                </div>
              </div>

              {/* Построчно по авансам клиента: видно, какой именно аванс
                  тратится. Раньше было одно число по клиенту, и в реестре
                  авансов нельзя было понять, что из них уже потрачено. */}
              <div className="mt-3 flex flex-col gap-1.5">
                {advanceRows.length === 0 && unallocated === 0 && orphanAllocations.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    У клиента нет внесённых авансов — внести можно на Финансах или в карточке клиента.
                  </div>
                )}
                {advanceRows.map((r) => {
                  const mine = allocationOf(r.advance.id)
                  const over = mine > r.available + 0.01
                  return (
                    <div key={r.advance.id} className="grid grid-cols-[1fr_110px] items-center gap-2 rounded-lg bg-background/70 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold">
                          {fmtDeadline(r.advance.date).replace(" г.", "")}{r.advance.note ? ` · ${r.advance.note}` : ""}
                        </div>
                        <div className={cn("text-2xs", over ? "font-bold text-destructive" : "text-muted-foreground")}>
                          внесено {fmtMoney(r.advance.amount)} · остаток {fmtMoney(r.available)}
                          {over && ` — не хватает ${fmtMoney(mine - r.available)}`}
                        </div>
                      </div>
                      <NumberInput
                        value={mine}
                        onChange={(n) => setAllocation(r.advance.id, n)}
                        className={cn("h-8", over && "border-destructive")}
                        placeholder="0"
                      />
                    </div>
                  )
                })}
                {orphanAllocations.map((r) => (
                  <div key={r.advanceId} className="grid grid-cols-[1fr_110px] items-center gap-2 rounded-lg border border-dashed border-border bg-notice/60 px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold">
                        {r.advance ? `Аванс другого клиента: ${r.advance.client || "без клиента"}` : "Аванс удалён"}
                      </div>
                      <div className="text-2xs text-muted-foreground">
                        {r.advance ? "У заказа сменили клиента — перенесите списание на аванс этого клиента или обнулите." : "Списание осталось от удалённого аванса. Обнулите его или перенесите на другой аванс выше."}
                      </div>
                    </div>
                    <NumberInput value={r.amount} onChange={(n) => setAllocation(r.advanceId, n)} className="h-8" />
                  </div>
                ))}
                {unallocated > 0 && (
                  <div className="grid grid-cols-[1fr_110px] items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="text-xs font-bold">Без привязки к авансу</div>
                      <div className="text-2xs text-muted-foreground">
                        Списание из прежних версий — по клиенту, без указания аванса. Можно перенести в строки выше и обнулить здесь.
                      </div>
                    </div>
                    <NumberInput value={unallocated} onChange={setUnallocated} className="h-8" />
                  </div>
                )}
              </div>
              {advanceExceedsOrder && (
                <div className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-xs font-bold text-danger-soft-foreground">
                  Списано больше, чем стоит заказ ({fmtMoney(totalWithTax)}).
                </div>
              )}
              {advanceOverdraft > 0 && (
                <div className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-xs font-bold text-danger-soft-foreground">
                  Списано больше, чем внесено: у клиента доступно {fmtMoney(advanceAvailableHere)}, не хватает {fmtMoney(advanceOverdraft)}.
                  Внесите аванс на Финансах или уменьшите сумму.
                </div>
              )}
              <button type="button" onClick={fillMaxAdvance} className="mt-2 text-xs font-bold text-foreground hover:underline">
                Списать всё
              </button>
            </div>

            {/* Оплата */}
            <div className="rounded-xl border border-border bg-muted/60 p-4">
              <div className="mb-3 text-2xs font-extrabold tracking-wide text-muted-foreground uppercase">Оплата по заказу</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-2xs font-bold text-muted-foreground">Стоимость заказа</div>
                  <div className="font-heading mt-0.5 text-lg font-bold">{fmtMoney(totalWithTax)}</div>
                </div>
                <div>
                  <div className="text-2xs font-bold text-muted-foreground">Получено деньгами</div>
                  <div className="font-heading mt-0.5 text-lg font-bold">{fmtMoney(paymentsTotal)}</div>
                </div>
                <div>
                  <div className="text-2xs font-bold text-muted-foreground">К доплате</div>
                  <div className="font-heading mt-0.5 text-lg font-bold">{fmtMoney(remaining)}</div>
                </div>
              </div>

              {/* Заказ подешевел ниже уже учтённых денег (снизили цену, убрали
                  позицию) — «Получено» и «К доплате» выше молча обрезаны до
                  стоимости заказа, эта сумма исправляет то же самое незаметно.
                  Деньги никуда не делись: аванс и платежи на заказе не тронуты,
                  просто перестали умещаться в его новую цену. Правится теми же
                  полями — списанием аванса выше и платежами ниже. */}
              {pay.overpaid > 0 && (
                <div className="mt-3 rounded-lg bg-notice px-3 py-2 text-xs font-bold text-notice-foreground">
                  Заказ стоит {fmtMoney(totalWithTax)}, а аванс и платежи по нему в сумме дают {fmtMoney(parseNum(draft.advanceUsed) + paymentsTotal)}.
                  {" "}{fmtMoney(pay.overpaid)} не попадают ни в «Получено», ни в «К доплате». Уменьшите списание аванса или платёж, либо верните позицию.
                </div>
              )}

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

              <div className="mt-3 flex flex-wrap gap-4 text-xs font-bold text-foreground">
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
                      <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-2xs font-bold text-cta">
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
                      <div className="text-center text-sm font-bold tabular-nums">{fmtMoney(calculateLineTotal(line))}</div>
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
                      <div className="flex justify-between text-sm font-bold">
                        <span className="text-muted-foreground">Итого по позиции</span>
                        <span className="tabular-nums">{fmtMoney(calculateLineTotal(line))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addLine}><Plus />Добавить позицию</Button>

              {/* Надбавки идут в том же порядке, в каком считаются: нейросети
                  к позициям, срочность к этой сумме, налог ко всему. */}
              <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-border bg-muted/60 p-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <div className="mb-1.5 text-2xs font-bold tracking-wide text-muted-foreground uppercase">Нейросети, ₽ за единицу</div>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      value={draft.aiRate}
                      onChange={(n) => setDraft((d) => ({ ...d, aiRate: Math.max(0, n) }))}
                      placeholder="0"
                      className="h-8 w-20"
                    />
                    <span className="min-w-0 text-xs text-muted-foreground">
                      {price.aiRate > 0 ? <>× {price.aiUnits} ед. = <b className="text-foreground tabular-nums">{fmtMoney(price.ai)}</b></> : "за слайд, страницу…"}
                    </span>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="mb-1.5 text-2xs font-bold tracking-wide text-muted-foreground uppercase">Срочность</div>
                  <div className="inline-flex rounded-md border border-border bg-background p-0.5">
                    {[0, ...URGENCY_OPTIONS].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, urgencyPct: p }))}
                        className={cn(
                          "h-7 rounded px-3 text-xs font-bold tabular-nums transition-colors",
                          draft.urgencyPct === p ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {p ? `+${p}%` : "Нет"}
                      </button>
                    ))}
                  </div>
                </div>
                {/* На какие позиции идёт надбавка: по умолчанию на все штучные.
                    Клик убирает позицию из расчёта (например, видео без нейросетей). */}
                {price.aiRate > 0 && aiLines.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2">
                    <span className="text-2xs font-bold text-muted-foreground">Считать с:</span>
                    {aiLines.map((l) => {
                      const on = lineTakesAi(l)
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => updateLine(l.id, { noAi: on ? true : undefined })}
                          title={on ? "Надбавка идёт — нажмите, чтобы убрать с этой позиции" : "Без надбавки — нажмите, чтобы вернуть"}
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-xs font-bold transition-colors",
                            on ? "border-border bg-background text-foreground" : "border-dashed border-border text-muted-foreground line-through"
                          )}
                        >
                          {l.label || l.type} · {parseNum(l.qty)}
                        </button>
                      )
                    })}
                  </div>
                )}
                <Field label="Налог" className="sm:col-span-2">
                  <Select value={draft.taxType} onValueChange={(v) => setDraft((d) => ({ ...d, taxType: v as TaxType }))}>
                    <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Без налога</SelectItem>
                      <SelectItem value="individual">Физ. лицо (+4%)</SelectItem>
                      <SelectItem value="entity">Юр. лицо (+6%)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="mt-3 flex flex-col gap-0.5 text-sm">
                <PriceRow label="Сумма позиций" value={fmtMoney(price.base)} />
                {price.ai > 0 && <PriceRow label={`Нейросети · ${fmtMoney(price.aiRate)} × ${price.aiUnits}`} value={`+${fmtMoney(price.ai)}`} />}
                {price.urgency > 0 && <PriceRow label={`Срочность · +${price.urgencyPct}%`} value={`+${fmtMoney(price.urgency)}`} />}
                {price.tax > 0 && <PriceRow label={`Налог · +${Math.round(price.taxRate * 100)}%`} value={`+${fmtMoney(price.tax)}`} />}
                <div className="mt-1 flex justify-between border-t border-border pt-1.5 font-bold">
                  <span>Конечная цена</span>
                  <span className="tabular-nums">{fmtMoney(totalWithTax)}</span>
                </div>
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
      <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">{label}</Label>
      {children}
    </div>
  )
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  )
}

function MiniField({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div title={title}>
      <div className="mb-1 text-2xs font-bold tracking-wide text-muted-foreground uppercase">{label}</div>
      {children}
    </div>
  )
}
