import { useMemo, useState } from "react"
import {
  Search,
  Plus,
  Columns3,
  ChevronDown,
  GripVertical,
  MoreVertical,
  Pencil,
  Copy,
  Trash2,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  Play,
  Pause,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"
import { useTimerStore } from "@/store/useTimerStore"
import { saveData } from "@/lib/cloudSync"
import type { Order } from "@/types/models"
import { fmtMoney, orderPaymentState, isOrderOverdue, dateKey } from "@/lib/money"
import { fmtDeadline } from "@/lib/dates"
import { StatusBadge } from "./StatusBadge"
import { OrderDetailsSheet } from "./OrderDetailsSheet"
import { OrderFormDialog } from "./OrderFormDialog"
import { orderMatchesQuery } from "@/lib/orderSearch"
import { confirmDialog } from "@/store/useDialogStore"
import { usePagination } from "@/lib/usePagination"
import { PaginationBar } from "@/components/ui/pagination-bar"

function clientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "?"
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase()
}

function orderDisplayTitle(o: Order): string {
  return o.title || [o.subject, o.grade, o.quarter, o.lesson && `Урок ${o.lesson}`].filter(Boolean).join(", ") || "Без названия"
}

type StatusFilter = "all" | "progress" | "unpaid" | "overdue"

// Сортировки на этом экране не было вовсе — при десятке заказов порядок
// определялся тем, в каком они заведены, и найти нужный можно было только
// глазами. По умолчанию — ближайший срок сверху: это то, чем список
// открывают чаще всего («что горит»).
type OrderSort = "deadline_asc" | "deadline_desc" | "debt_desc" | "total_desc" | "client" | "created_desc"

const ORDER_SORT_LABELS: Record<OrderSort, string> = {
  deadline_asc: "Ближайший срок сверху",
  deadline_desc: "Дальний срок сверху",
  debt_desc: "Сначала с долгом",
  total_desc: "По сумме: больше сверху",
  client: "По клиенту (А–Я)",
  created_desc: "Сначала добавленные позже",
}

export function OrdersPage() {
  const orders = useAppStore((s) => s.orders)
  const setOrders = useAppStore((s) => s.setOrders)
  const [search, setSearch] = useState("")
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>("all")
  const [sort, setSort] = useState<OrderSort>("deadline_asc")
  const [clientFilter, setClientFilter] = useState("all")
  const [showClass, setShowClass] = useState(true)
  const [showClient, setShowClient] = useState(true)
  const [showDue, setShowDue] = useState(true)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [duplicateFrom, setDuplicateFrom] = useState<Order | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null)

  function openNewOrder() {
    setEditingOrder(null)
    setDuplicateFrom(null)
    setDeleteTarget(null)
    setFormOpen(true)
  }
  function openEditOrder(o: Order) {
    setActiveOrder(null)
    setEditingOrder(o)
    setDuplicateFrom(null)
    setDeleteTarget(null)
    setFormOpen(true)
  }
  function openDuplicateOrder(o: Order) {
    setEditingOrder(null)
    setDuplicateFrom(o)
    setDeleteTarget(null)
    setFormOpen(true)
  }
  function openDeleteOrder(o: Order) {
    setEditingOrder(o)
    setDuplicateFrom(null)
    setDeleteTarget(o)
    setFormOpen(true)
  }

  const rows = useMemo(
    () => orders.map((o) => ({ order: o, pay: orderPaymentState(o), overdue: isOrderOverdue(o) })),
    [orders]
  )

  // Через useMemo, а не просто filter: эти массивы стоят в зависимостях
  // отбора ниже, и пересоздаваясь каждый рендер обнуляли бы весь его смысл.
  const active = useMemo(() => rows.filter((r) => r.order.status !== "done" && r.order.status !== "cancelled"), [rows])
  const archived = useMemo(() => rows.filter((r) => r.order.status === "done" || r.order.status === "cancelled"), [rows])

  type Row = (typeof rows)[number]

  // Отбор и сортировка живут внутри useMemo, а не рядом с ним. Снаружи они
  // пересоздавались на каждый рендер, из-за чего в списке зависимостей стояли
  // не сами функции, а значения фильтров, которые они замыкают, — memo работал
  // правильно только пока эти два списка держали руками в согласии. Так и
  // получилось: при добавлении сортировки в deps архива забыли filter.
  const { visibleActive, visibleArchived } = useMemo(() => {
    const dl = (r: Row) => r.order.deadline || r.order.start || ""

    const matchesSearch = (r: Row) => orderMatchesQuery(r.order, search)
    const matchesClient = (r: Row) => clientFilter === "all" || (r.order.client || "") === clientFilter
    const matchesFilter = (r: Row) => {
      if (filter === "all") return true
      if (filter === "progress") return r.order.status === "progress"
      if (filter === "unpaid") return r.pay.remaining > 0
      if (filter === "overdue") return r.overdue
      return true
    }

    const applySort = (list: Row[]): Row[] =>
      list.slice().sort((a, b) => {
        let p = 0
        if (sort === "deadline_asc") p = dl(a).localeCompare(dl(b))
        else if (sort === "deadline_desc") p = dl(b).localeCompare(dl(a))
        else if (sort === "debt_desc") p = b.pay.remaining - a.pay.remaining
        else if (sort === "total_desc") p = b.pay.full - a.pay.full
        else if (sort === "client") p = (a.order.client || "").localeCompare(b.order.client || "", "ru")
        else if (sort === "created_desc") p = (b.order.createdAt || 0) - (a.order.createdAt || 0)
        // Вторичный ключ — срок, иначе равные значения встают случайно.
        return p !== 0 ? p : dl(a).localeCompare(dl(b))
      })

    return {
      visibleActive: applySort(active.filter((r) => matchesFilter(r) && matchesSearch(r) && matchesClient(r))),
      visibleArchived: applySort(archived.filter((r) => matchesSearch(r) && matchesClient(r))),
    }
  }, [active, archived, filter, search, sort, clientFilter])

  const clientOptions = useMemo(
    () => [...new Set(orders.map((o) => o.client).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")),
    [orders]
  )

  const totalRows = active.length + archived.length

  const {
    page: currentPage, pageSize, pageItems: pagedActive, setPage, setPageSize,
  } = usePagination(visibleActive, { resetKey: [filter, search, sort, clientFilter].join("|") })

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }
  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(active.map((r) => r.order.id)) : new Set())
  }

  // Быстрая смена статуса прямо из списка — как было в ванильной версии.
  // Завершение заказа не должно требовать открытия формы: это самое частое
  // действие, а через форму его попросту не находили.
  async function changeStatus(id: string, next: Order["status"]) {
    const order = orders.find((o) => o.id === id)
    const wasArchived = order && (order.status === "done" || order.status === "cancelled")
    const backToWork = next !== "done" && next !== "cancelled"
    const today = dateKey(new Date())

    // Заказ, поднятый из архива со старым сроком, молча уезжал в прошлые недели:
    // в планировании и таймлайне он не попадал в текущую неделю, и о нём просто
    // забывали. Формально он числится просроченным, но по датам его не видно.
    // Поэтому спрашиваем сразу — перенести срок или оставить как есть.
    let patch: Partial<Order> = { status: next }
    if (order && wasArchived && backToWork && order.deadline && order.deadline < today) {
      const move = await confirmDialog({
        title: "Срок сдачи уже прошёл",
        body:
          `Заказ нужно было сдать ${fmtDeadline(order.deadline)}. ` +
          "Перенести срок на сегодня, чтобы он появился в текущей неделе?",
        confirmLabel: "Перенести на сегодня",
        cancelLabel: "Оставить дату",
      })
      if (move) {
        patch = { ...patch, deadline: today, start: order.start && order.start > today ? today : order.start }
      }
    }

    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))
    saveData()
  }

  function handleRowDrop(targetId: string) {
    const draggedId = draggingId
    setDraggingId(null)
    if (!draggedId || draggedId === targetId) return
    setOrders((prev) => {
      const list = prev.slice()
      const fromIdx = list.findIndex((o) => o.id === draggedId)
      const toIdx = list.findIndex((o) => o.id === targetId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const [moved] = list.splice(fromIdx, 1)
      list.splice(toIdx, 0, moved)
      return list
    })
    saveData()
  }

  const overdueRows = active.filter((r) => r.overdue)
  // Долг считаем по ВСЕМ заказам, кроме отменённых, а не только по активным.
  // Завершённый заказ вполне может оставаться неоплаченным — и это как раз то,
  // что нужно видеть в первую очередь. Раньше такие суммы просто выпадали из
  // итога: в таблице долг у завершённых виден, а карточка его не учитывала.
  // Заодно это сходится с Финансами, где «Остаток к получению» всегда считался
  // по всем неотменённым — до этого две страницы показывали разные числа.
  const dueRows = rows.filter((r) => r.order.status !== "cancelled" && r.pay.remaining > 0)
  const dueTotal = dueRows.reduce((s, r) => s + r.pay.remaining, 0)
  const doneThisMonthCount = archived.filter((r) => r.order.status === "done").length

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-heading text-[30px] font-bold tracking-tight">Заказы</h1>
        <p className="text-[13.5px] text-muted-foreground">
          Управление всеми проектами и их наполнением
        </p>
      </div>

      {/* KPI row */}
      <div className="mb-5.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="glass-surface ring-0">
          <CardHeader>
            <CardDescription>К доплате всего</CardDescription>
            <CardTitle className="font-heading text-[34px] font-bold tabular-nums">
              {fmtMoney(dueTotal)}
            </CardTitle>
            <CardAction>
              <span className="inline-flex items-center gap-1 rounded-full border border-overlay/20 px-2 py-0.5 text-[11px] font-bold text-foreground/80">
                <TrendingUp className="size-3" />
                {dueRows.length} заказов
              </span>
            </CardAction>
          </CardHeader>
          <CardContent className="text-[12.5px] text-muted-foreground">
            <div className="font-bold text-foreground">Без учёта авансов клиентов</div>
            По всем заказам, кроме отменённых — включая завершённые, если по ним ещё не заплатили
          </CardContent>
        </Card>

        <Card className="glass-surface glass-surface-accent ring-1 ring-cta/25">
          <CardHeader>
            <CardDescription>Активные заказы</CardDescription>
            <CardTitle className="font-heading text-[34px] font-bold tabular-nums">
              {active.length}
            </CardTitle>
            <CardAction>
              <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                {active.length} всего
              </span>
            </CardAction>
          </CardHeader>
          <CardContent className="text-[12.5px] text-muted-foreground">
            <div className="font-bold text-foreground">
              {active.filter((r) => r.order.status === "queue").length} в очереди ·{" "}
              {active.filter((r) => r.order.status === "progress").length} в работе
            </div>
            Без завершённых и отменённых
          </CardContent>
        </Card>

        <Card className="glass-surface ring-0">
          <CardHeader>
            <CardDescription>Просрочено</CardDescription>
            <CardTitle className="font-heading text-[34px] font-bold text-destructive tabular-nums">
              {overdueRows.length}
            </CardTitle>
            <CardAction>
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 px-2 py-0.5 text-[11px] font-bold text-destructive">
                <AlertTriangle className="size-3" />
                внимание
              </span>
            </CardAction>
          </CardHeader>
          <CardContent className="text-[12.5px] text-muted-foreground">
            <div className="font-bold text-destructive">Срок сдачи уже прошёл</div>
            {overdueRows.map((r) => orderDisplayTitle(r.order).split(",")[0]).join(", ") || "—"}
          </CardContent>
        </Card>

        <Card className="glass-surface ring-0">
          <CardHeader>
            <CardDescription>Завершено</CardDescription>
            <CardTitle className="font-heading text-[34px] font-bold tabular-nums">
              {doneThisMonthCount}
            </CardTitle>
            <CardAction>
              <span className="inline-flex items-center gap-1 rounded-full border border-overlay/20 px-2 py-0.5 text-[11px] font-bold text-foreground/80">
                <TrendingUp className="size-3" />
                архив
              </span>
            </CardAction>
          </CardHeader>
          <CardContent className="text-[12.5px] text-muted-foreground">
            <div className="font-bold text-foreground">Готовые и отменённые заказы</div>
            Смотрите архив под таблицей
          </CardContent>
        </Card>
      </div>

      {/* toolbar */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
          <div className="relative w-full sm:w-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск: класс, урок, клиент, предмет..."
              className="w-full pl-8 sm:w-60"
            />
          </div>
          <div className="bg-muted inline-flex gap-0.5 rounded-[10px] p-[3px]">
            {(
              [
                ["all", "Все"],
                ["progress", "В работе"],
                ["unpaid", "Ожидают оплаты"],
                ["overdue", "Просрочены"],
              ] as [StatusFilter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold transition-colors",
                  filter === value
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Сортировка и отбор по клиенту. Быстрые виды слева отвечают за
              «что показать», эти два — за «в каком порядке» и «чьё». */}
          <Select value={sort} onValueChange={(v) => setSort(v as OrderSort)}>
            <SelectTrigger size="sm" className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(ORDER_SORT_LABELS) as OrderSort[]).map((k) => (
                <SelectItem key={k} value={k}>{ORDER_SORT_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger size="sm" className="w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Клиент: любой</SelectItem>
              {clientOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 />
                Колонки
                <ChevronDown className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuCheckboxItem checked={showClass} onCheckedChange={setShowClass}>
                Класс / предмет
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={showDue} onCheckedChange={setShowDue}>
                К доплате
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={showClient} onCheckedChange={setShowClient}>
                Клиент
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={openNewOrder}
            className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta"
          >
            <Plus />
            Новый заказ
          </Button>
        </div>
      </div>

      {/* mobile — one stacked card per order, no columns to squeeze or scroll */}
      <div className="flex flex-col gap-2.5 sm:hidden">
        {visibleActive.length === 0 && (
          <div className="py-10 text-center text-[13px] text-muted-foreground">
            {orders.length === 0 ? "Заказов пока нет — добавьте первый." : "Ничего не найдено."}
          </div>
        )}
        {pagedActive.map(({ order, pay, overdue }) => (
          <OrderCard
            key={order.id}
            order={order}
            sum={pay.full}
            due={pay.remaining}
            overdue={overdue}
            showClass={showClass}
            showClient={showClient}
            showDue={showDue}
            checked={selected.has(order.id)}
            onCheckedChange={(c) => toggleRow(order.id, c)}
            onOpen={() => setActiveOrder(order)}
            onEdit={() => openEditOrder(order)}
                onStatusChange={(next) => changeStatus(order.id, next)}
            onDuplicate={() => openDuplicateOrder(order)}
            onDelete={() => openDeleteOrder(order)}
          />
        ))}

        {archived.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setArchiveOpen((v) => !v)}
              className="mt-1 flex w-full items-center gap-2 px-1 py-2 text-[12px] font-extrabold tracking-wide text-muted-foreground uppercase"
            >
              <ChevronRight className={cn("size-3 transition-transform", archiveOpen && "rotate-90")} />
              Архив · завершённые и отменённые ({archived.length})
            </button>
            {archiveOpen && visibleArchived.map(({ order, pay, overdue }) => (
              <OrderCard
                key={order.id}
                order={order}
                sum={pay.full}
                due={pay.remaining}
                overdue={overdue}
                showClass={showClass}
                showClient={showClient}
                showDue={showDue}
                checked={selected.has(order.id)}
                onCheckedChange={(c) => toggleRow(order.id, c)}
                onOpen={() => setActiveOrder(order)}
                onEdit={() => openEditOrder(order)}
                onStatusChange={(next) => changeStatus(order.id, next)}
                onDuplicate={() => openDuplicateOrder(order)}
                onDelete={() => openDeleteOrder(order)}
                muted
              />
            ))}
          </>
        )}
      </div>

      {/* table — fixed layout via colgroup; desktop/tablet only */}
      <div className="glass-surface hidden overflow-hidden rounded-xl sm:block">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] table-fixed border-collapse">
          <colgroup>
            <col style={{ width: 26 }} />
            <col style={{ width: 34 }} />
            <col />
            <col style={{ width: showClass ? 136 : 0 }} />
            <col style={{ width: showClient ? 156 : 0 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 148 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: showDue ? 108 : 0 }} />
            <col style={{ width: 36 }} />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead />
              <TableHead>
                <Checkbox
                  checked={selected.size > 0 && selected.size === active.length}
                  onCheckedChange={(c) => toggleAll(!!c)}
                />
              </TableHead>
              <TableHead className="px-3">Заказ</TableHead>
              {showClass && <TableHead className="px-4">Класс / предмет</TableHead>}
              {showClient && <TableHead className="px-4">Клиент</TableHead>}
              <TableHead className="px-4">Срок сдачи</TableHead>
              <TableHead className="px-4">Статус</TableHead>
              <TableHead className="px-4 text-right">Сумма</TableHead>
              {showDue && <TableHead className="px-4 text-right">К доплате</TableHead>}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleActive.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={10} className="py-10 text-center text-[13px] text-muted-foreground">
                  {orders.length === 0 ? "Заказов пока нет — добавьте первый." : "Ничего не найдено."}
                </TableCell>
              </TableRow>
            )}
            {pagedActive.map(({ order, pay, overdue }) => (
              <OrderRow
                key={order.id}
                order={order}
                sum={pay.full}
                due={pay.remaining}
                overdue={overdue}
                showClass={showClass}
                showClient={showClient}
                showDue={showDue}
                checked={selected.has(order.id)}
                onCheckedChange={(c) => toggleRow(order.id, c)}
                onOpen={() => setActiveOrder(order)}
                onEdit={() => openEditOrder(order)}
                onStatusChange={(next) => changeStatus(order.id, next)}
                onDuplicate={() => openDuplicateOrder(order)}
                onDelete={() => openDeleteOrder(order)}
                draggable
                onDragStart={() => setDraggingId(order.id)}
                onDragEnd={() => setDraggingId(null)}
                onDropRow={() => handleRowDrop(order.id)}
              />
            ))}
          </TableBody>
        </table>
        </div>

        <button
          type="button"
          onClick={() => setArchiveOpen((v) => !v)}
          className="flex w-full items-center gap-2 border-t border-border px-3.5 py-2.5 text-[12px] font-extrabold tracking-wide text-muted-foreground uppercase"
        >
          <ChevronRight className={cn("size-3 transition-transform", archiveOpen && "rotate-90")} />
          Архив · завершённые и отменённые ({archived.length})
        </button>

        {archiveOpen && (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] table-fixed border-collapse">
            <colgroup>
              <col style={{ width: 26 }} />
              <col style={{ width: 34 }} />
              <col />
              <col style={{ width: showClass ? 136 : 0 }} />
              <col style={{ width: showClient ? 156 : 0 }} />
              <col style={{ width: 104 }} />
              <col style={{ width: 148 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: showDue ? 108 : 0 }} />
              <col style={{ width: 36 }} />
            </colgroup>
            <TableBody>
              {visibleArchived.map(({ order, pay, overdue }) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  sum={pay.full}
                  due={pay.remaining}
                  overdue={overdue}
                  showClass={showClass}
                  showClient={showClient}
                  showDue={showDue}
                  checked={selected.has(order.id)}
                  onCheckedChange={(c) => toggleRow(order.id, c)}
                  onOpen={() => setActiveOrder(order)}
                  onEdit={() => openEditOrder(order)}
                onStatusChange={(next) => changeStatus(order.id, next)}
                  onDuplicate={() => openDuplicateOrder(order)}
                  onDelete={() => openDeleteOrder(order)}
                  muted
                />
              ))}
            </TableBody>
          </table>
          </div>
        )}
      </div>

      {/* footer */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-4 px-1">
        <div className="text-[12.5px] text-muted-foreground">
          {selected.size} из {totalRows} строк выбрано
        </div>
        {/* Раньше эта панель была здесь переписана вручную — при том, что
            PaginationBar уже используется на Клиентах и Финансах. Копия и
            разошлась: кнопки «назад/вперёд» считали от сырого номера страницы
            вместо обрезанного (см. usePagination). */}
        <PaginationBar
          page={currentPage}
          pageSize={pageSize}
          totalItems={visibleActive.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      <OrderDetailsSheet
        order={activeOrder}
        onOpenChange={(open) => !open && setActiveOrder(null)}
        onEdit={(o) => openEditOrder(o)}
      />

      <OrderFormDialog
        open={formOpen}
        editingOrder={editingOrder}
        duplicateFrom={duplicateFrom}
        startInDeleteConfirm={!!deleteTarget}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) {
            setEditingOrder(null)
            setDuplicateFrom(null)
            setDeleteTarget(null)
          }
        }}
      />
    </div>
  )
}

function OrderTimerButton({ order }: { order: Order }) {
  const activeId = useTimerStore((s) => s.id)
  const running = useTimerStore((s) => s.running)
  const startFor = useTimerStore((s) => s.startFor)
  const isActive = activeId === order.id && running

  return (
    <button
      type="button"
      title={isActive ? "Пауза" : "Старт таймера по этому заказу"}
      onClick={(e) => { e.stopPropagation(); startFor(order.id, orderDisplayTitle(order)) }}
      className="flex shrink-0 items-center gap-1 rounded-full bg-emphasis/85 px-2 py-1 text-[10.5px] font-extrabold text-emphasis-foreground"
    >
      {isActive ? <Pause className="size-2.5" fill="currentColor" /> : <Play className="size-2.5" fill="currentColor" />}
      {isActive ? "Пауза" : "Старт"}
    </button>
  )
}

function OrderRow({
  order,
  sum,
  due,
  overdue,
  showClass,
  showClient,
  showDue,
  checked,
  onCheckedChange,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onStatusChange,
  muted,
  draggable,
  onDragStart,
  onDragEnd,
  onDropRow,
}: {
  order: Order
  sum: number
  due: number
  overdue: boolean
  showClass: boolean
  showClient: boolean
  showDue: boolean
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  onOpen: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onStatusChange: (next: Order["status"]) => void
  muted?: boolean
  draggable?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
  onDropRow?: () => void
}) {
  return (
    <TableRow
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      onDrop={
        draggable
          ? (e) => {
              e.preventDefault()
              onDropRow?.()
            }
          : undefined
      }
    >
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn("flex size-6.5 items-center justify-center text-muted-foreground", draggable ? "cursor-grab" : "cursor-default opacity-40")}>
              <GripVertical className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{draggable ? "Перетащить, чтобы изменить порядок" : "Порядок архива не меняется"}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
        <Checkbox checked={checked} onCheckedChange={(c) => onCheckedChange(!!c)} />
      </TableCell>
      <TableCell className="min-w-0 whitespace-normal px-3">
        <div className="flex min-w-0 max-w-[340px] items-center gap-1.5">
          <OrderTimerButton order={order} />
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 truncate text-[13.5px] font-bold text-foreground underline decoration-transparent decoration-1 underline-offset-3 hover:decoration-muted-foreground"
          >
            {orderDisplayTitle(order)}
          </button>
          {order.priority && <span className="shrink-0">🔥</span>}
          {overdue && <span className="shrink-0 text-[10.5px] font-bold text-destructive">просрочен</span>}
        </div>
      </TableCell>
      {showClass && (
        <TableCell className="min-w-0 px-4 text-[12.5px] text-muted-foreground">
          {(order.subject || order.grade) ? (
            <span className="block truncate">{[order.subject, order.grade].filter(Boolean).join(" · ")}</span>
          ) : "—"}
        </TableCell>
      )}
      {showClient && (
        <TableCell className="min-w-0 px-4">
          {order.client ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar className="size-4.5 shrink-0">
                <AvatarFallback className="text-[8.5px] font-extrabold">
                  {clientInitials(order.client)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-[12.5px]">{order.client}</span>
            </span>
          ) : <span className="text-[12.5px] text-muted-foreground">—</span>}
        </TableCell>
      )}
      <TableCell className={cn("px-4 text-[12.5px]", overdue ? "font-bold text-destructive" : "text-muted-foreground")}>
        {fmtDeadline(order.deadline)}
      </TableCell>
      <TableCell className="px-4">
        <StatusBadge status={order.status} onChange={onStatusChange} />
      </TableCell>
      <TableCell className={cn("px-4 text-right font-heading text-[13px] font-bold tabular-nums", muted && "text-muted-foreground")}>
        {fmtMoney(sum)}
      </TableCell>
      {showDue && (
        <TableCell
          className={cn(
            "px-4 text-right font-heading text-[13px] font-bold tabular-nums",
            due === 0 && "text-muted-foreground font-semibold"
          )}
        >
          {fmtMoney(due)}
        </TableCell>
      )}
      <TableCell>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Открыть меню</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              Редактировать
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy />
              Дублировать
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 />
              Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

function OrderCard({
  order,
  sum,
  due,
  overdue,
  showClass,
  showClient,
  showDue,
  checked,
  onCheckedChange,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onStatusChange,
  muted,
}: {
  order: Order
  sum: number
  due: number
  overdue: boolean
  showClass: boolean
  showClient: boolean
  showDue: boolean
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  onOpen: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onStatusChange: (next: Order["status"]) => void
  muted?: boolean
}) {
  const metaParts = [
    showClass && [order.subject, order.grade].filter(Boolean).join(" · "),
    showClient && order.client,
  ].filter(Boolean) as string[]

  return (
    <div className="glass-surface rounded-xl p-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5">
          <Checkbox checked={checked} onCheckedChange={(c) => onCheckedChange(!!c)} />
        </div>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={cn("min-w-0 truncate text-[14px] font-bold", muted && "text-muted-foreground")}>{orderDisplayTitle(order)}</span>
            {order.priority && <span className="shrink-0">🔥</span>}
          </div>
          {metaParts.length > 0 && (
            <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{metaParts.join(" · ")}</div>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="shrink-0"><MoreVertical /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}><Pencil />Редактировать</DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}><Copy />Дублировать</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 />Удалить</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <StatusBadge status={order.status} onChange={onStatusChange} />
        <span className={cn("text-[11.5px] font-bold", overdue ? "text-destructive" : "text-muted-foreground")}>
          {overdue && "просрочен · "}{fmtDeadline(order.deadline)}
        </span>
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2.5">
        <div>
          <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Сумма</div>
          <div className={cn("font-heading text-[14px] font-bold tabular-nums", muted && "text-muted-foreground")}>{fmtMoney(sum)}</div>
        </div>
        {showDue && (
          <div className="text-right">
            <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">К доплате</div>
            <div className={cn("font-heading text-[14px] font-bold tabular-nums", due === 0 && "text-muted-foreground")}>{fmtMoney(due)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
