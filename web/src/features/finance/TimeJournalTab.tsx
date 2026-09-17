import { useMemo, useRef, useState } from "react"
import { Trash2, Plus, ArrowLeftRight, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useAppStore } from "@/store/useAppStore"
import { fmtHours, parseHours, dateKey } from "@/lib/money"
import { fmtDeadline } from "@/lib/dates"
import { actualHours } from "@/lib/activity"
import { groupByDayOrder } from "@/lib/journal"
import {
  applyHoursDelta,
  setJournalDayHours,
  deleteActivityLogEntries,
  compactJournal,
  saveData,
} from "@/lib/cloudSync"
import { confirmDialog, alertDialog } from "@/store/useDialogStore"
import { cn } from "@/lib/utils"
import type { ActivityLogEntry, Order } from "@/types/models"
import { ActiveDaysCalendar } from "@/features/dashboard/ActiveDaysCalendar"

/**
 * Журнал часов: таблица «день × заказ» с правкой на месте и сверка с заказами.
 *
 * Это инструмент точечной правки: нереальные цифры за день раньше можно было
 * только искать по календарю на дашборде и удалять по одной записи. Здесь
 * всё в одном месте — что записано, по какому заказу, за какой день, и
 * насколько журнал расходится с часами, которые числятся на самих заказах.
 */

function orderTitle(o: Order | undefined, id: string): string {
  if (!o) return `Заказ удалён (${id.slice(0, 6)}…)`
  return o.title || [o.subject, o.grade, o.lesson && `Урок ${o.lesson}`].filter(Boolean).join(", ") || "Без названия"
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function TimeJournalTab() {
  const orders = useAppStore((s) => s.orders)
  const activityLog = useAppStore((s) => s.activityLog)
  const setOrders = useAppStore((s) => s.setOrders)

  const now = new Date()
  const [from, setFrom] = useState(dateKey(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(dateKey(now))
  const [orderFilter, setOrderFilter] = useState("all")

  // Добавление записи задним числом.
  const [newDate, setNewDate] = useState(dateKey(now))
  const [newOrder, setNewOrder] = useState("")
  const [newHours, setNewHours] = useState("")

  // Куда писать разницу при выравнивании журнала по заказу.
  const [fixDate, setFixDate] = useState(dateKey(now))

  const ordersById = useMemo(() => {
    const m = new Map<string, Order>()
    orders.forEach((o) => m.set(o.id, o))
    return m
  }, [orders])

  type DayRow = { key: string; date: string; orderId: string; hours: number; entries: ActivityLogEntry[] }

  const { rows, legacyGroups, totalHours } = useMemo(() => {
    const groups = groupByDayOrder(activityLog)
    const rows: DayRow[] = []
    let legacyGroups = 0
    groups.forEach((entries, key) => {
      if (entries.length > 1) legacyGroups++
      const { date, orderId } = entries[0]
      if (date < from || date > to) return
      if (orderFilter !== "all" && orderId !== orderFilter) return
      rows.push({ key, date, orderId, hours: round2(entries.reduce((s, e) => s + e.delta, 0)), entries })
    })
    rows.sort((a, b) => b.date.localeCompare(a.date) || orderTitle(ordersById.get(a.orderId), a.orderId).localeCompare(orderTitle(ordersById.get(b.orderId), b.orderId), "ru"))
    const totalHours = rows.reduce((s, r) => s + r.hours, 0)
    return { rows, legacyGroups, totalHours }
  }, [activityLog, from, to, orderFilter, ordersById])

  // Сверка: по каждому заказу — часы на самом заказе (ручные или таймер по
  // позициям) против суммы журнала за всё время.
  const reconcile = useMemo(() => {
    const journalByOrder = new Map<string, number>()
    activityLog.forEach((e) => { if (e.field === "hours") journalByOrder.set(e.orderId, (journalByOrder.get(e.orderId) || 0) + e.delta) })
    const ids = new Set<string>([...journalByOrder.keys(), ...orders.map((o) => o.id)])
    const list = [...ids]
      .map((id) => {
        const o = ordersById.get(id)
        const inOrder = o ? round2(actualHours(o)) : 0
        const inJournal = round2(journalByOrder.get(id) || 0)
        return { id, order: o, inOrder, inJournal, diff: round2(inJournal - inOrder) }
      })
      .filter((r) => r.inOrder || r.inJournal)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    const mismatched = list.filter((r) => Math.abs(r.diff) >= 0.01)
    return { list, mismatched }
  }, [activityLog, orders, ordersById])

  const orderOptions = useMemo(
    () => orders.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((o) => ({ id: o.id, label: orderTitle(o, o.id) })),
    [orders]
  )

  function commitRow(row: DayRow, text: string) {
    const hours = parseHours(text)
    if (!Number.isFinite(hours) || round2(hours) === row.hours) return
    setJournalDayHours(row.orderId, row.date, hours)
    saveData()
  }

  async function removeRow(row: DayRow) {
    const ok = await confirmDialog({
      title: "Удалить часы за день?",
      body: `${fmtDeadline(row.date)} · ${orderTitle(ordersById.get(row.orderId), row.orderId)} · ${fmtHours(row.hours)}`,
      confirmLabel: "Удалить",
      destructive: true,
    })
    if (!ok) return
    deleteActivityLogEntries(row.entries)
    saveData()
  }

  function addEntry() {
    const hours = parseHours(newHours)
    if (!newOrder || !newDate || !hours) return
    applyHoursDelta(newOrder, newDate, hours)
    saveData()
    setNewHours("")
  }

  async function compact() {
    const ok = await confirmDialog({
      title: "Схлопнуть старые записи?",
      body:
        `В журнале ${legacyGroups} ${legacyGroups === 1 ? "день" : legacyGroups < 5 ? "дня" : "дней"} с несколькими строками по одному заказу — ` +
        "так писали прежние версии (по строке на минуту таймера). Суммы по дням не изменятся, просто строк станет по одной на день и заказ.",
      confirmLabel: "Схлопнуть",
    })
    if (!ok) return
    const n = compactJournal()
    saveData()
    await alertDialog({ title: "Готово", body: `Убрано лишних строк: ${n}. Суммы по дням прежние.` })
  }

  async function journalToOrder(r: (typeof reconcile.list)[number]) {
    const delta = round2(r.inOrder - r.inJournal)
    const ok = await confirmDialog({
      title: "Уравнять журнал по заказу?",
      body:
        `${orderTitle(r.order, r.id)}: на заказе ${fmtHours(r.inOrder)}, в журнале ${fmtHours(r.inJournal)}.\n\n` +
        `В журнал за ${fmtDeadline(fixDate)} будет записано ${delta > 0 ? "+" : "−"}${fmtHours(Math.abs(delta))}.`,
      confirmLabel: "Записать",
    })
    if (!ok) return
    applyHoursDelta(r.id, fixDate, delta)
    saveData()
  }

  async function orderToJournal(r: (typeof reconcile.list)[number]) {
    if (!r.order) return
    const ok = await confirmDialog({
      title: "Уравнять заказ по журналу?",
      body:
        `${orderTitle(r.order, r.id)}: в «Факт. часы» заказа будет записано ${fmtHours(r.inJournal)} (сейчас на заказе ${fmtHours(r.inOrder)}). ` +
        "Часы у позиций не меняются — ручное поле имеет приоритет.",
      confirmLabel: "Записать",
    })
    if (!ok) return
    setOrders((prev) => prev.map((o) => (o.id === r.id ? { ...o, actualHours: String(r.inJournal) } : o)))
    saveData()
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/* Календарь активных дней с бывшего дашборда — здесь он рядом с
          таблицей, которую и правит. */}
      <div className="glass-surface rounded-xl p-4.5 lg:max-w-[420px]">
        <ActiveDaysCalendar />
      </div>

      <div className="glass-surface rounded-xl p-4.5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold">Журнал часов по дням</h3>
            <div className="text-[12px] text-muted-foreground">Одна строка — один день по одному заказу. Число можно поправить прямо в таблице.</div>
          </div>
          {legacyGroups > 0 && (
            <Button variant="outline" size="sm" onClick={compact} title="Старые версии писали по строке на каждую минуту таймера">
              <Layers />Схлопнуть старые строки ({legacyGroups})
            </Button>
          )}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">С</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div>
            <label className="mb-1 block text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">По</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">Заказ</label>
            <Select value={orderFilter} onValueChange={setOrderFilter}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все заказы</SelectItem>
                {orderOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mb-2 text-[12px] text-muted-foreground">
          Строк <b className="text-foreground">{rows.length}</b> · всего <b className="text-foreground">{fmtHours(totalHours)}</b>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[130px]">День</TableHead>
                <TableHead>Заказ</TableHead>
                <TableHead className="w-[150px] text-right">Часов</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow className="hover:bg-transparent"><TableCell colSpan={4} className="py-8 text-center whitespace-normal text-muted-foreground">Нет записей за период</TableCell></TableRow>
              )}
              {rows.map((r) => {
                const o = ordersById.get(r.orderId)
                return (
                  <TableRow key={r.key}>
                    <TableCell className="tabular-nums">{fmtDeadline(r.date).replace(" г.", "")}</TableCell>
                    <TableCell className={cn("min-w-0 whitespace-normal", !o && "text-destructive")}>
                      {orderTitle(o, r.orderId)}
                      {r.entries.length > 1 && (
                        <span className="ml-2 rounded-full bg-muted px-1.5 text-[10.5px] font-bold text-muted-foreground" title="Несколько строк за день — старый формат">
                          {r.entries.length} стр.
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <HoursCell hours={r.hours} onCommit={(t) => commitRow(r, t)} />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" title="Удалить день" onClick={() => removeRow(r)}>
                        <Trash2 className="text-muted-foreground hover:text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div>
            <label className="mb-1 block text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">День</label>
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-9" />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">Заказ</label>
            <Select value={newOrder} onValueChange={setNewOrder}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Выберите заказ..." /></SelectTrigger>
              <SelectContent>
                {orderOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">Часов</label>
            <Input value={newHours} onChange={(e) => setNewHours(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addEntry()} placeholder="1.5 или 1:30" className="h-9 w-28" />
          </div>
          <Button type="button" variant="outline" onClick={addEntry} disabled={!newOrder || !parseHours(newHours)}>
            <Plus />Добавить
          </Button>
        </div>
      </div>

      <div className="glass-surface rounded-xl p-4.5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold">Сверка с заказами</h3>
            <div className="text-[12px] text-muted-foreground">
              «На заказе» — «Факт. часы» или сумма часов по позициям. «В журнале» — всё, что записано по заказу за все дни.
            </div>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>Разницу писать за</span>
            <Input type="date" value={fixDate} onChange={(e) => setFixDate(e.target.value)} className="h-8 w-auto" />
          </div>
        </div>

        {reconcile.mismatched.length === 0 ? (
          <div className="py-4 text-[12.5px] text-muted-foreground">Расхождений нет — журнал сходится с заказами.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Заказ</TableHead>
                  <TableHead className="text-right">На заказе</TableHead>
                  <TableHead className="text-right">В журнале</TableHead>
                  <TableHead className="text-right">Разница</TableHead>
                  <TableHead className="w-[250px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconcile.mismatched.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className={cn("min-w-0 whitespace-normal", !r.order && "text-destructive")}>{orderTitle(r.order, r.id)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtHours(r.inOrder)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtHours(r.inJournal)}</TableCell>
                    <TableCell className={cn("text-right font-bold tabular-nums", r.diff > 0 ? "text-warning-foreground" : "text-destructive")}>
                      {r.diff > 0 ? "+" : "−"}{fmtHours(Math.abs(r.diff))}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => journalToOrder(r)} title="Записать разницу в журнал, чтобы он сошёлся с заказом">
                          <ArrowLeftRight />Журнал ← заказ
                        </Button>
                        {r.order && (
                          <Button variant="outline" size="sm" onClick={() => orderToJournal(r)} title="Записать сумму журнала в «Факт. часы» заказа">
                            Заказ ← журнал
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** Часы в строке: свободный ввод («2.5», «2:30», «2ч 30м»), сохраняется по Enter или уходу из поля. */
function HoursCell({ hours, onCommit }: { hours: number; onCommit: (text: string) => void }) {
  const [text, setText] = useState<string | null>(null)
  // Escape отменяет правку: blur() срабатывает синхронно, и состояние в его
  // замыкании ещё старое — поэтому отмена помечается через ref, а не state.
  const cancelled = useRef(false)
  const shown = text ?? String(hours)
  return (
    <input
      value={shown}
      title={fmtHours(hours)}
      onFocus={(e) => { cancelled.current = false; setText(String(hours)); e.currentTarget.select() }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text !== null && !cancelled.current) onCommit(text); setText(null) }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        if (e.key === "Escape") { cancelled.current = true; (e.target as HTMLInputElement).blur() }
      }}
      className="h-8 w-24 rounded-md border border-border bg-background px-2 text-right text-[12.5px] tabular-nums outline-none focus-visible:border-ring"
    />
  )
}
