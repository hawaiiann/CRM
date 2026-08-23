import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Clock } from "lucide-react"
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
import { fmtMoney, isOrderOverdue, ordersOfClient, clientDebt } from "@/lib/money"
import { getClientAdvanceStats } from "@/lib/advances"
import { ClientCardSheet } from "./ClientCardSheet"
import { DepositDialog } from "@/features/finance/DepositDialog"
import { PaginationBar } from "@/components/ui/pagination-bar"

type SortMode = "name" | "due_desc" | "advance_desc" | "orders_desc"

type StateFilter = "all" | "debt" | "overdue" | "advance" | "active"

const STATE_LABELS: Record<StateFilter, string> = {
  all: "Состояние: любое",
  debt: "Есть долг",
  overdue: "Есть просрочка",
  advance: "Есть остаток аванса",
  active: "Есть активные заказы",
}

export function ClientsPage() {
  const orders = useAppStore((s) => s.orders)
  const advances = useAppStore((s) => s.advances)
  const appSettings = useAppStore((s) => s.appSettings)

  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortMode>("name")
  const [state, setState] = useState<StateFilter>("all")
  const [activeClient, setActiveClient] = useState<string | null>(null)
  const [depositClient, setDepositClient] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  const rows = useMemo(() => {
    const names = new Set((appSettings.clients || []).filter(Boolean))
    orders.forEach((o) => { if (o.client) names.add(o.client) })

    let list = [...names].map((name) => {
      const stats = getClientAdvanceStats(name, advances, orders)
      const clientOrders = ordersOfClient(orders, name)
      const activeOrders = clientOrders.filter((o) => o.status !== "done")
      // Долг — по ВСЕМ заказам клиента, кроме отменённых (см. clientDebt:
      // именно этот отбор дважды разъезжался, в v2.8.1 и v2.8.2).
      const totalDue = clientDebt(orders, name)
      // Просрочка — только по незавершённым: у сданного заказа срок сдачи уже
      // неактуален, там вопрос только к оплате.
      const hasOverdue = activeOrders.some(isOrderOverdue)
      return { name, available: stats.available, totalDue, activeCount: activeOrders.length, hasOverdue }
    })

    const q = search.trim().toLowerCase()
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q))

    // Отбор по состоянию. Раньше был только поиск по имени: чтобы понять,
    // «кто должен» или «у кого кончается аванс», приходилось глазами
    // просматривать весь список — а бейджи для этого уже считались.
    if (state === "debt") list = list.filter((r) => r.totalDue > 0)
    else if (state === "overdue") list = list.filter((r) => r.hasOverdue)
    else if (state === "advance") list = list.filter((r) => r.available > 0)
    else if (state === "active") list = list.filter((r) => r.activeCount > 0)

    if (sort === "due_desc") list.sort((a, b) => b.totalDue - a.totalDue)
    else if (sort === "advance_desc") list.sort((a, b) => b.available - a.available)
    else if (sort === "orders_desc") list.sort((a, b) => b.activeCount - a.activeCount)
    else list.sort((a, b) => a.name.localeCompare(b.name, "ru"))
    // Вторичный ключ — имя: без него клиенты с равными суммами (а нулевых
    // обычно большинство) вставали в произвольном порядке.
    if (sort !== "name") {
      const key = sort === "due_desc" ? "totalDue" : sort === "advance_desc" ? "available" : "activeCount"
      list.sort((a, b) => (b[key] as number) - (a[key] as number) || a.name.localeCompare(b.name, "ru"))
    }

    return list
  }, [orders, advances, appSettings.clients, search, sort, state])

  useEffect(() => { setPage(0) }, [search, sort, pageSize, state])
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, totalPages - 1)
  const pagedRows = useMemo(
    () => rows.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [rows, currentPage, pageSize]
  )

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
        <Select value={state} onValueChange={(v) => setState(v as StateFilter)}>
          <SelectTrigger size="sm" className="w-full sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(STATE_LABELS) as StateFilter[]).map((k) => (
              <SelectItem key={k} value={k}>{STATE_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[12px] text-muted-foreground">
          Показано <b className="text-foreground">{rows.length}</b>
        </span>
      </div>

      {/* mobile — stacked cards */}
      <div className="flex flex-col gap-2.5 sm:hidden">
        {rows.length === 0 && (
          <div className="py-10 text-center text-[13px] text-muted-foreground">{search ? "Ничего не найдено" : "Клиентов пока нет"}</div>
        )}
        {pagedRows.map((r) => (
          <button key={r.name} type="button" onClick={() => setActiveClient(r.name)} className="glass-surface rounded-xl p-3.5 text-left">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[14px] font-bold">{r.name}</span>
              {r.hasOverdue ? (
                <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2.5 text-[11px] font-bold text-destructive">
                  <AlertTriangle className="size-3" />
                  Просрочка
                </span>
              ) : r.activeCount ? (
                <span className="inline-flex h-6 shrink-0 items-center rounded-full gap-1.5 bg-warning px-2.5 text-[11px] font-bold text-warning-foreground"><Clock className="size-3" strokeWidth={2.25} />В работе</span>
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
            {pagedRows.map((r) => (
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
                    <span className="inline-flex h-6 items-center rounded-full gap-1.5 bg-warning px-2.5 text-[11px] font-bold text-warning-foreground"><Clock className="size-3" strokeWidth={2.25} />В работе</span>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>

      {rows.length > 0 && (
        <div className="mt-3.5">
          <PaginationBar page={currentPage} pageSize={pageSize} totalItems={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      )}

      <ClientCardSheet
        clientName={activeClient}
        onOpenChange={(open) => !open && setActiveClient(null)}
        onDeposit={(client) => { setActiveClient(null); setDepositClient(client) }}
      />
      <DepositDialog open={!!depositClient} onOpenChange={(open) => !open && setDepositClient(null)} initialClient={depositClient || undefined} />
    </div>
  )
}
