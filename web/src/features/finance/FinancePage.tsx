import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Plus, Trash2 } from "lucide-react"
import { PageHeader } from "@/components/layout/AppShell"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useAppStore } from "@/store/useAppStore"
import { saveData, deleteFromCloud } from "@/lib/cloudSync"
import { recordActivityChanges } from "@/lib/activity"
import {
  fmtMoney,
  fmtHours,
  parseNum,
  dateKey,
  orderTotal,
  orderBaseTotal,
  orderPaymentState,
  orderPayments,
  orderPaymentsTotal,
} from "@/lib/money"
import { orderRecognizedRevenue } from "@/lib/dashboardMetrics"
import { getClientAdvanceStats } from "@/lib/advances"
import { downloadCsv } from "@/lib/csv"
import { normalizePayment } from "@/lib/normalize"
import { PaymentBadge } from "./PaymentBadge"
import { DepositDialog } from "./DepositDialog"
import { PaginationBar } from "@/components/ui/pagination-bar"
import type { Order } from "@/types/models"

type SortMode = "default" | "status" | "price_desc" | "price_asc" | "pending_desc" | "adv_desc"

function sortedFinanceList(orders: Order[], sort: SortMode): Order[] {
  const list = orders.slice()
  if (sort === "status") {
    list.sort((a, b) => {
      const score = (o: Order) => {
        const p = orderPaymentState(o)
        if (p.isFullyPaid) return 1
        if (p.covered > 0) return 2
        return 3
      }
      return score(a) - score(b)
    })
  } else if (sort === "price_desc") list.sort((a, b) => orderTotal(b) - orderTotal(a))
  else if (sort === "price_asc") list.sort((a, b) => orderTotal(a) - orderTotal(b))
  else if (sort === "pending_desc") list.sort((a, b) => orderPaymentState(b).remaining - orderPaymentState(a).remaining)
  else if (sort === "adv_desc") list.sort((a, b) => parseNum(b.advanceUsed) - parseNum(a.advanceUsed))
  return list
}

export function FinancePage() {
  const orders = useAppStore((s) => s.orders)
  const advances = useAppStore((s) => s.advances)
  const setOrders = useAppStore((s) => s.setOrders)
  const setAdvances = useAppStore((s) => s.setAdvances)
  const setActivityLog = useAppStore((s) => s.setActivityLog)

  const [sort, setSort] = useState<SortMode>("default")
  const [depositOpen, setDepositOpen] = useState(false)
  const [finPage, setFinPage] = useState(0)
  const [finPageSize, setFinPageSize] = useState(10)
  const [advPage, setAdvPage] = useState(0)
  const [advPageSize, setAdvPageSize] = useState(10)

  const totals = useMemo(() => {
    let totalRevenue = 0, totalNet = 0, totalPending = 0
    const totalAdvancesIn = advances.reduce((s, a) => s + parseNum(a.amount), 0)
    orders.forEach((o) => {
      if (o.status === "cancelled") return
      const rec = orderRecognizedRevenue(o)
      totalRevenue += rec.revenue
      totalNet += rec.net
      totalPending += orderPaymentState(o).remaining
    })
    const totalAdvUsed = orders.reduce((s, o) => s + parseNum(o.advanceUsed), 0)
    return {
      totalRevenue,
      totalNet,
      totalTax: totalRevenue - totalNet,
      totalAdvancesIn,
      totalAdvAvailable: Math.max(0, totalAdvancesIn - totalAdvUsed),
      totalPending,
    }
  }, [orders, advances])

  const finList = useMemo(() => sortedFinanceList(orders, sort), [orders, sort])

  useEffect(() => { setFinPage(0) }, [sort, finPageSize])
  const finTotalPages = Math.max(1, Math.ceil(finList.length / finPageSize))
  const finCurrentPage = Math.min(finPage, finTotalPages - 1)
  const pagedFinList = useMemo(
    () => finList.slice(finCurrentPage * finPageSize, finCurrentPage * finPageSize + finPageSize),
    [finList, finCurrentPage, finPageSize]
  )

  useEffect(() => { setAdvPage(0) }, [advPageSize])
  const advTotalPages = Math.max(1, Math.ceil(advances.length / advPageSize))
  const advCurrentPage = Math.min(advPage, advTotalPages - 1)
  const pagedAdvances = useMemo(
    () => advances.slice(advCurrentPage * advPageSize, advCurrentPage * advPageSize + advPageSize),
    [advances, advCurrentPage, advPageSize]
  )

  function togglePayment(o: Order) {
    const pay = orderPaymentState(o)
    let next: Order
    if (pay.isFullyPaid) {
      next = { ...o, payments: [], paidAmount: 0, isPaid: false, paidAt: null }
    } else {
      const rest = Math.max(0, Math.round(pay.remaining * 100) / 100)
      const payments = orderPayments(o).map(normalizePayment)
      if (rest > 0) payments.push(normalizePayment({ amount: rest, date: dateKey(new Date()), note: "" }))
      next = { ...o, payments, paidAmount: orderPaymentsTotal({ ...o, payments }), isPaid: true, paidAt: o.paidAt || dateKey(new Date()) }
    }
    const entry = recordActivityChanges(o, next)
    setOrders((prev) => prev.map((x) => (x.id === o.id ? next : x)))
    if (entry) setActivityLog((prev) => [...prev, entry])
    saveData()
  }

  function removeAdvance(id: string) {
    const a = advances.find((x) => x.id === id)
    const label = a ? `${fmtMoney(a.amount)} от ${a.client} (${a.date})` : "эту запись"
    if (!confirm(`Удалить запись об авансе — ${label}?`)) return
    setAdvances((prev) => prev.filter((x) => x.id !== id))
    deleteFromCloud("advances", id)
    saveData()
  }

  function exportFinanceCsv() {
    const header = ["Проект", "Заказчик", "Выручка (с налогом)", "Налог", "Оплачено из аванса", "К доплате", "Статус оплаты"]
    const rows = finList.map((o) => {
      const base = orderBaseTotal(o)
      const full = orderTotal(o)
      const tax = full - base
      const pay = orderPaymentState(o)
      let statusText = "Не оплачено"
      if (pay.isFullyPaid) statusText = "Оплачен полностью"
      else if (pay.covered > 0) statusText = `Получено ${fmtMoney(pay.covered)}, к доплате ${fmtMoney(pay.remaining)}`
      return [o.title || "Без названия", o.client || "—", Math.round(full), Math.round(tax), pay.advUsed, pay.remaining, statusText]
    })
    downloadCsv("finance-" + dateKey(new Date()) + ".csv", header, rows)
  }

  return (
    <div>
      <PageHeader
        title="Финансы"
        subtitle="Учет доходов, чистой прибыли, налоговых отчислений и управления авансами"
        actions={
          <Button onClick={() => setDepositOpen(true)} className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
            <Plus />
            Внести аванс
          </Button>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="overview">Обзор финансов</TabsTrigger>
          <TabsTrigger value="advances">Баланс авансов по клиентам</TabsTrigger>
          <TabsTrigger value="timereport">Отчёт по времени</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <StatTile num={fmtMoney(totals.totalRevenue)} lbl="Выручка (с налогом)" sub="Оплачено + покрыто авансом" tone="success" />
            <StatTile num={fmtMoney(totals.totalNet)} lbl="Чистый доход" sub="За вычетом налогов" accent />
            <StatTile num={fmtMoney(totals.totalTax)} lbl="Налог к уплате" sub="Справочно по ставкам" tone="destructive" />
            <StatTile num={fmtMoney(totals.totalAdvancesIn)} lbl="Всего авансов внесено" sub={`Остаток доступен: ${fmtMoney(totals.totalAdvAvailable)}`} tone="warning" />
            <StatTile num={fmtMoney(totals.totalPending)} lbl="Остаток к получению" sub="Ожидает доплаты клиентов" />
          </div>

          <div className="glass-surface rounded-xl p-4.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-bold">Финансовая статистика по заказам</h3>
                <div className="text-[12px] text-muted-foreground">Кликните по названию для перехода к заказу. Кликните по статусу для смены оплаты.</div>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
                  <SelectTrigger size="sm" className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Сортировка: по умолчанию</SelectItem>
                    <SelectItem value="status">По статусу оплаты</SelectItem>
                    <SelectItem value="price_desc">По сумме (убывание)</SelectItem>
                    <SelectItem value="price_asc">По сумме (возрастание)</SelectItem>
                    <SelectItem value="pending_desc">По остатку к доплате</SelectItem>
                    <SelectItem value="adv_desc">По списанному авансу</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={exportFinanceCsv}>Экспорт в CSV</Button>
              </div>
            </div>

            {/* mobile — stacked cards */}
            <div className="flex flex-col gap-2.5 sm:hidden">
              {finList.length === 0 && <div className="py-8 text-center text-muted-foreground">Нет данных</div>}
              {pagedFinList.map((o) => {
                const base = orderBaseTotal(o)
                const full = orderTotal(o)
                const tax = full - base
                const pay = orderPaymentState(o)
                return (
                  <div key={o.id} className="rounded-xl bg-muted/60 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link to="/orders" className="block truncate font-semibold text-foreground hover:underline">{o.title || "Без названия"}</Link>
                        {o.client && <Link to="/clients" className="block truncate text-[12.5px] text-muted-foreground hover:underline">{o.client}</Link>}
                      </div>
                      <PaymentBadge order={o} onClick={() => togglePayment(o)} />
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border pt-2.5">
                      <div>
                        <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Выручка</div>
                        <div className="font-heading text-[13px] font-bold tabular-nums">{fmtMoney(full)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Налог</div>
                        <div className="text-[13px] tabular-nums text-muted-foreground">{fmtMoney(tax)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Из аванса</div>
                        <div className="text-[13px] font-bold tabular-nums">{pay.advUsed > 0 ? fmtMoney(pay.advUsed) : "—"}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">К доплате</div>
                        <div className="text-[13px] font-bold tabular-nums text-destructive">{pay.remaining > 0 ? fmtMoney(pay.remaining) : "0 ₽"}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col />
                  <col style={{ width: 170 }} />
                  <col style={{ width: 112 }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 112 }} />
                  <col style={{ width: 112 }} />
                  <col style={{ width: 170 }} />
                </colgroup>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-3">Проект</TableHead>
                    <TableHead className="px-3">Заказчик</TableHead>
                    <TableHead className="px-3 text-right">Выручка</TableHead>
                    <TableHead className="px-3 text-right">Налог</TableHead>
                    <TableHead className="px-3 text-right">Из аванса</TableHead>
                    <TableHead className="px-3 text-right">К доплате</TableHead>
                    <TableHead className="px-3">Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {finList.length === 0 && (
                    <TableRow className="hover:bg-transparent"><TableCell colSpan={7} className="py-8 text-center whitespace-normal text-muted-foreground">Нет данных</TableCell></TableRow>
                  )}
                  {pagedFinList.map((o) => {
                    const base = orderBaseTotal(o)
                    const full = orderTotal(o)
                    const tax = full - base
                    const pay = orderPaymentState(o)
                    return (
                      <TableRow key={o.id}>
                        <TableCell className="min-w-0 px-3">
                          <Link to="/orders" className="block truncate font-semibold text-foreground hover:underline">{o.title || "Без названия"}</Link>
                        </TableCell>
                        <TableCell className="min-w-0 px-3">{o.client ? <Link to="/clients" className="block truncate text-foreground hover:underline">{o.client}</Link> : "—"}</TableCell>
                        <TableCell className="px-3 text-right font-heading font-bold tabular-nums">{fmtMoney(full)}</TableCell>
                        <TableCell className="px-3 text-right tabular-nums text-muted-foreground">{fmtMoney(tax)}</TableCell>
                        <TableCell className="px-3 text-right font-bold tabular-nums text-foreground">{pay.advUsed > 0 ? fmtMoney(pay.advUsed) : "—"}</TableCell>
                        <TableCell className="px-3 text-right font-bold tabular-nums text-destructive">{pay.remaining > 0 ? fmtMoney(pay.remaining) : "0 ₽"}</TableCell>
                        <TableCell className="px-3"><PaymentBadge order={o} onClick={() => togglePayment(o)} /></TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </table>
            </div>

            {finList.length > 0 && (
              <div className="mt-3.5 border-t border-border pt-3.5">
                <PaginationBar page={finCurrentPage} pageSize={finPageSize} totalItems={finList.length} onPageChange={setFinPage} onPageSizeChange={setFinPageSize} />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="advances" className="mt-4">
          <div className="glass-surface rounded-xl p-4.5">
            <h3 className="text-[15px] font-bold">Реестр полученных авансов и депозитов</h3>
            <div className="mb-3 text-[12px] text-muted-foreground">История поступлений авансов от клиентов и их доступный остаток</div>
            {/* mobile — stacked cards */}
            <div className="flex flex-col gap-2.5 sm:hidden">
              {advances.length === 0 && <div className="py-8 text-center text-muted-foreground">Авансы ещё не вносились</div>}
              {pagedAdvances.map((a) => {
                const stats = getClientAdvanceStats(a.client, advances, orders)
                return (
                  <div key={a.id} className="rounded-xl bg-muted/60 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-bold">{a.client}</div>
                        <div className="text-[12px] text-muted-foreground">{a.date}{a.note ? " · " + a.note : ""}</div>
                      </div>
                      <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => removeAdvance(a.id)}><Trash2 className="text-muted-foreground hover:text-destructive" /></Button>
                    </div>
                    <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-border pt-2.5">
                      <div>
                        <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Внесено</div>
                        <div className="text-[13px] font-bold tabular-nums">{fmtMoney(a.amount)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Списано</div>
                        <div className="text-[13px] tabular-nums text-muted-foreground">{fmtMoney(stats.used)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Остаток</div>
                        <div className="text-[13px] font-bold tabular-nums">{fmtMoney(stats.available)}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Дата</TableHead>
                    <TableHead>Заказчик</TableHead>
                    <TableHead className="text-right">Внесено</TableHead>
                    <TableHead className="text-right">Списано</TableHead>
                    <TableHead className="text-right">Остаток</TableHead>
                    <TableHead>Примечание</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {advances.length === 0 && (
                    <TableRow className="hover:bg-transparent"><TableCell colSpan={7} className="py-8 text-center whitespace-normal text-muted-foreground">Авансы ещё не вносились</TableCell></TableRow>
                  )}
                  {pagedAdvances.map((a) => {
                    const stats = getClientAdvanceStats(a.client, advances, orders)
                    return (
                      <TableRow key={a.id}>
                        <TableCell>{a.date}</TableCell>
                        <TableCell className="font-bold">{a.client}</TableCell>
                        <TableCell className="text-right font-bold tabular-nums">{fmtMoney(a.amount)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{fmtMoney(stats.used)}</TableCell>
                        <TableCell className="text-right font-bold tabular-nums text-foreground">{fmtMoney(stats.available)}</TableCell>
                        <TableCell className="whitespace-normal text-muted-foreground">{a.note || "—"}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon-sm" onClick={() => removeAdvance(a.id)}><Trash2 className="text-muted-foreground hover:text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </table>
            </div>

            {advances.length > 0 && (
              <div className="mt-3.5 border-t border-border pt-3.5">
                <PaginationBar page={advCurrentPage} pageSize={advPageSize} totalItems={advances.length} onPageChange={setAdvPage} onPageSizeChange={setAdvPageSize} />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="timereport" className="mt-4">
          <TimeReportTab />
        </TabsContent>
      </Tabs>

      <DepositDialog open={depositOpen} onOpenChange={setDepositOpen} />
    </div>
  )
}

function StatTile({ num, lbl, sub, accent }: { num: string; lbl: string; sub: string; tone?: "success" | "warning" | "destructive"; accent?: boolean }) {
  return (
    <div className={cn("glass-surface rounded-xl p-4", accent && "glass-surface-accent ring-1 ring-cta/25")}>
      <div className="font-heading text-[26px] font-bold tabular-nums">{num}</div>
      <div className="mt-1 text-[12px] font-bold text-muted-foreground">{lbl}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  )
}

type GroupBy = "client" | "subject" | "order"

function TimeReportTab() {
  const orders = useAppStore((s) => s.orders)
  const activityLog = useAppStore((s) => s.activityLog)

  const now = new Date()
  const [from, setFrom] = useState(dateKey(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(dateKey(now))
  const [groupBy, setGroupBy] = useState<GroupBy>("client")

  const { rows, totalHours, totalOrders } = useMemo(() => {
    const hoursByOrder: Record<string, number> = {}
    activityLog.forEach((e) => {
      if (e.field !== "hours" || !e.orderId) return
      if (e.date < from || e.date > to) return
      hoursByOrder[e.orderId] = (hoursByOrder[e.orderId] || 0) + e.delta
    })

    const groups: Record<string, { label: string; hours: number; orderIds: Set<string> }> = {}
    let totalOrders = 0
    Object.keys(hoursByOrder).forEach((orderId) => {
      const hours = hoursByOrder[orderId]
      if (Math.abs(hours) < 0.001) return
      totalOrders++
      const o = orders.find((x) => x.id === orderId)
      let key: string
      let label: string
      if (groupBy === "order") {
        key = orderId
        label = o ? (o.title || [o.subject, o.grade, o.quarter, o.lesson && `Урок ${o.lesson}`].filter(Boolean).join(", ") || "Без названия") : "Удалённый заказ"
      } else if (groupBy === "subject") {
        key = label = (o && o.subject) || "—"
      } else {
        key = label = (o && o.client) || "—"
      }
      if (!groups[key]) groups[key] = { label, hours: 0, orderIds: new Set() }
      groups[key].hours += hours
      groups[key].orderIds.add(orderId)
    })

    const rows = Object.values(groups).sort((a, b) => b.hours - a.hours)
    const totalHours = rows.reduce((s, r) => s + r.hours, 0)
    return { rows, totalHours, totalOrders }
  }, [activityLog, orders, from, to, groupBy])

  const groupHeader = groupBy === "order" ? "Заказ" : groupBy === "subject" ? "Предмет" : "Клиент"

  function exportCsv() {
    const header = [groupHeader, "Часов", "Заказов"]
    const dataRows = rows.map((r) => [r.label, fmtHours(r.hours), r.orderIds.size])
    dataRows.push(["Итого", fmtHours(totalHours), totalOrders])
    downloadCsv("time-report-" + dateKey(new Date()) + ".csv", header, dataRows)
  }

  return (
    <div className="glass-surface rounded-xl p-4.5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold">Отчёт по времени</h3>
          <div className="text-[12px] text-muted-foreground">Сколько часов реально отработано за период — по данным таймера.</div>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>Экспорт в CSV</Button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">С</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">По</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Группировать</label>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="client">По клиенту</SelectItem>
              <SelectItem value="subject">По предмету</SelectItem>
              <SelectItem value="order">По заказу</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{groupHeader}</TableHead>
            <TableHead className="text-right">Часов</TableHead>
            <TableHead className="text-right">Заказов</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && <TableRow className="hover:bg-transparent"><TableCell colSpan={3} className="py-8 text-center whitespace-normal text-muted-foreground">Нет данных за выбранный период</TableCell></TableRow>}
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell>{r.label}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtHours(r.hours)}</TableCell>
              <TableCell className="text-right tabular-nums">{r.orderIds.size}</TableCell>
            </TableRow>
          ))}
          {rows.length > 0 && (
            <TableRow className="font-bold hover:bg-transparent">
              <TableCell>Итого</TableCell>
              <TableCell className="text-right tabular-nums">{fmtHours(totalHours)}</TableCell>
              <TableCell className="text-right tabular-nums">{totalOrders}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </table>
      </div>
    </div>
  )
}
