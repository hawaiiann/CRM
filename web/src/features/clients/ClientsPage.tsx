import { useMemo, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { PageHeader } from "@/components/layout/AppShell"
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
import { fmtMoney, isOrderOverdue, orderPaymentState } from "@/lib/money"
import { getClientAdvanceStats } from "@/lib/advances"
import { ClientCardSheet } from "./ClientCardSheet"
import { DepositDialog } from "@/features/finance/DepositDialog"

type SortMode = "name" | "due_desc" | "advance_desc" | "orders_desc"

export function ClientsPage() {
  const orders = useAppStore((s) => s.orders)
  const advances = useAppStore((s) => s.advances)
  const appSettings = useAppStore((s) => s.appSettings)

  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortMode>("name")
  const [activeClient, setActiveClient] = useState<string | null>(null)
  const [depositClient, setDepositClient] = useState<string | null>(null)

  const rows = useMemo(() => {
    const names = new Set((appSettings.clients || []).filter(Boolean))
    orders.forEach((o) => { if (o.client) names.add(o.client) })

    let list = [...names].map((name) => {
      const stats = getClientAdvanceStats(name, advances, orders)
      const clientOrders = orders.filter((o) => (o.client || "").toLowerCase() === name.toLowerCase() && o.status !== "cancelled")
      const activeOrders = clientOrders.filter((o) => o.status !== "done")
      const totalDue = activeOrders.reduce((s, o) => s + orderPaymentState(o).remaining, 0)
      const hasOverdue = activeOrders.some(isOrderOverdue)
      return { name, available: stats.available, totalDue, activeCount: activeOrders.length, hasOverdue }
    })

    const q = search.trim().toLowerCase()
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q))

    if (sort === "due_desc") list.sort((a, b) => b.totalDue - a.totalDue)
    else if (sort === "advance_desc") list.sort((a, b) => b.available - a.available)
    else if (sort === "orders_desc") list.sort((a, b) => b.activeCount - a.activeCount)
    else list.sort((a, b) => a.name.localeCompare(b.name, "ru"))

    return list
  }, [orders, advances, appSettings.clients, search, sort])

  return (
    <div>
      <PageHeader title="Клиенты" subtitle="Все заказчики: активные заказы, остаток аванса, сумма к доплате" />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по клиентам..." className="w-full sm:w-64" />
        <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
          <SelectTrigger size="sm" className="w-full sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Сортировка: по алфавиту</SelectItem>
            <SelectItem value="due_desc">По сумме к доплате</SelectItem>
            <SelectItem value="advance_desc">По остатку аванса</SelectItem>
            <SelectItem value="orders_desc">По числу активных заказов</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* mobile — stacked cards */}
      <div className="flex flex-col gap-2.5 sm:hidden">
        {rows.length === 0 && (
          <div className="py-10 text-center text-[13px] text-muted-foreground">{search ? "Ничего не найдено" : "Клиентов пока нет"}</div>
        )}
        {rows.map((r) => (
          <button key={r.name} type="button" onClick={() => setActiveClient(r.name)} className="glass-surface rounded-xl p-3.5 text-left">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[14px] font-bold">{r.name}</span>
              {r.hasOverdue ? (
                <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2.5 text-[11px] font-bold text-destructive">
                  <AlertTriangle className="size-3" />
                  Просрочка
                </span>
              ) : r.activeCount ? (
                <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-overlay/20 px-2.5 text-[11px] font-bold text-foreground/90">В работе</span>
              ) : null}
            </div>
            <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-border pt-2.5 text-left">
              <div>
                <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Заказов</div>
                <div className="text-[13px] font-bold tabular-nums">{r.activeCount}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Аванс</div>
                <div className="text-[13px] font-bold tabular-nums">{fmtMoney(r.available)}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">К доплате</div>
                <div className="text-[13px] font-bold tabular-nums text-destructive">{r.totalDue > 0 ? fmtMoney(r.totalDue) : "—"}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* desktop/tablet — table */}
      <div className="glass-surface hidden overflow-hidden rounded-xl sm:block">
        <table className="w-full border-collapse">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">Клиент</TableHead>
              <TableHead className="text-right">Активных заказов</TableHead>
              <TableHead className="text-right">Доступный аванс</TableHead>
              <TableHead className="text-right">К доплате всего</TableHead>
              <TableHead className="pr-4">Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={5} className="py-10 text-center whitespace-normal text-muted-foreground">{search ? "Ничего не найдено" : "Клиентов пока нет"}</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.name} onClick={() => setActiveClient(r.name)} className="cursor-pointer">
                <TableCell className="pl-4 font-bold">{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">{r.activeCount}</TableCell>
                <TableCell className="text-right font-bold tabular-nums text-foreground">{fmtMoney(r.available)}</TableCell>
                <TableCell className="text-right font-bold tabular-nums text-destructive">{r.totalDue > 0 ? fmtMoney(r.totalDue) : "—"}</TableCell>
                <TableCell className="pr-4">
                  {r.hasOverdue ? (
                    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-destructive/10 px-2.5 text-[11px] font-bold text-destructive">
                      <AlertTriangle className="size-3" />
                      Есть просрочка
                    </span>
                  ) : r.activeCount ? (
                    <span className="inline-flex h-6 items-center rounded-full bg-overlay/20 px-2.5 text-[11px] font-bold text-foreground/90">В работе</span>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>

      <ClientCardSheet
        clientName={activeClient}
        onOpenChange={(open) => !open && setActiveClient(null)}
        onDeposit={(client) => { setActiveClient(null); setDepositClient(client) }}
      />
      <DepositDialog open={!!depositClient} onOpenChange={(open) => !open && setDepositClient(null)} initialClient={depositClient || undefined} />
    </div>
  )
}
