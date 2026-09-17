import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import {
  Search,
  Plus,
  Columns3,
  ChevronDown,
  MoreVertical,
  Pencil,
  Copy,
  Trash2,
  ChevronRight,
  ArrowUp,
  Merge,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { LessonsHeader } from "@/components/layout/LessonsHeader"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
import { saveData, deleteFromCloud, reassignJournalOrder } from "@/lib/cloudSync"
import { mergeOrders, duplicateOrderGroups } from "@/lib/orderMerge"
import { isLessonEmpty } from "@/lib/planningStats"
import { orderTitleWithTopic, lessonTopicForOrder } from "@/lib/orderTitle"
import type { Order } from "@/types/models"
import { fmtMoney, orderPaymentState, isOrderOverdue, dateKey } from "@/lib/money"
import { fmtDeadline } from "@/lib/dates"
import { StatusBadge } from "./StatusBadge"
import { OrderDetailsSheet } from "./OrderDetailsSheet"
import { OrderFormDialog } from "./OrderFormDialog"
import { OrderTimerButton, orderDisplayTitle } from "./OrderTimerButton"
import { orderMatchesQuery } from "@/lib/orderSearch"
import { confirmDialog } from "@/store/useDialogStore"
import { usePagination } from "@/lib/usePagination"
import { PaginationBar } from "@/components/ui/pagination-bar"

function clientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "?"
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase()
}

type StatusFilter = "all" | "progress" | "unpaid" | "overdue"

// Сортировки на этом экране не было вовсе — при десятке заказов порядок
// определялся тем, в каком они заведены, и найти нужный можно было только
// глазами. По умолчанию — ближайший срок сверху: это то, чем список
// открывают чаще всего («что горит»).
//
// Поле и направление хранятся раздельно, а не одной строкой вида
// "deadline_asc": по заголовку таблицы жмут, чтобы ПЕРЕВЕРНУТЬ порядок, и с
// плоским перечислением каждый столбец пришлось бы описывать парой значений
// и вручную сводить их между собой.
type SortField = "lesson" | "deadline" | "debt" | "total" | "client" | "subject" | "grade" | "created"
type OrderSort = { field: SortField; dir: "asc" | "desc" }

// Направление по умолчанию при первом клике по столбцу: у текста — с начала
// алфавита, у денег и дат добавления — с большего, потому что спрашивают
// «где самые крупные» и «что появилось недавно», а не наоборот.
const DEFAULT_DIR: Record<SortField, OrderSort["dir"]> = {
  lesson: "asc",
  deadline: "asc",
  debt: "desc",
  total: "desc",
  client: "asc",
  subject: "asc",
  grade: "asc",
  created: "desc",
}

// Готовые варианты для выпадающего списка. Он остаётся ради телефона: там
// вместо таблицы карточки, и заголовков, по которым можно кликнуть, нет.
const ORDER_SORT_PRESETS: { key: string; label: string; sort: OrderSort }[] = [
  // По умолчанию — как в программе: класс за классом, внутри по номеру
  // урока. В таком порядке видно, какой урок пропущен; по сроку сдачи
  // заказы одного класса разлетались по всему списку.
  { key: "lesson_asc", label: "По классу и номеру урока", sort: { field: "lesson", dir: "asc" } },
  { key: "lesson_desc", label: "По классу, уроки с конца", sort: { field: "lesson", dir: "desc" } },
  { key: "deadline_asc", label: "Ближайший срок сверху", sort: { field: "deadline", dir: "asc" } },
  { key: "deadline_desc", label: "Дальний срок сверху", sort: { field: "deadline", dir: "desc" } },
  { key: "grade_asc", label: "По классу (от младших)", sort: { field: "grade", dir: "asc" } },
  { key: "grade_desc", label: "По классу (от старших)", sort: { field: "grade", dir: "desc" } },
  { key: "subject_asc", label: "По предмету (А–Я)", sort: { field: "subject", dir: "asc" } },
  { key: "debt_desc", label: "Сначала с долгом", sort: { field: "debt", dir: "desc" } },
  { key: "total_desc", label: "По сумме: больше сверху", sort: { field: "total", dir: "desc" } },
  { key: "client_asc", label: "По клиенту (А–Я)", sort: { field: "client", dir: "asc" } },
  { key: "created_desc", label: "Сначала добавленные позже", sort: { field: "created", dir: "desc" } },
]

// Названия полей для подписи текущей сортировки. Кликом по заголовку можно
// получить сочетание, которого нет среди готовых вариантов (скажем, клиент
// в обратном порядке) — без этого выпадающий список в такой момент просто
// оказывался пустым.
const SORT_FIELD_LABELS: Record<SortField, string> = {
  lesson: "классу и уроку",
  deadline: "сроку сдачи",
  debt: "долгу",
  total: "сумме",
  client: "клиенту",
  subject: "предмету",
  grade: "классу",
  created: "дате добавления",
}

function sortLabel(sort: OrderSort): string {
  const preset = ORDER_SORT_PRESETS.find((p) => p.sort.field === sort.field && p.sort.dir === sort.dir)
  if (preset) return preset.label
  return `По ${SORT_FIELD_LABELS[sort.field]} (${sort.dir === "asc" ? "по возрастанию" : "по убыванию"})`
}

/**
 * Ключ сортировки по классу.
 *
 * Обычное сравнение строк ставит «10 класс» перед «5 классом» — посимвольно
 * «1» меньше «5». Поэтому сначала сравниваем число, а буквенную часть («9А»
 * против «9Б») используем вторым ключом. Классы без числа («Без класса»)
 * уходят в конец: это не место в ряду, а его отсутствие.
 */
function gradeSortKey(grade: string): [number, string] {
  const text = (grade || "").trim().toLowerCase()
  const num = text.match(/\d+/)
  return [num ? parseInt(num[0], 10) : Number.MAX_SAFE_INTEGER, text]
}

/** Номер урока из поля «Урок» («10», «Урок 10», «10-11» → 10); без числа — в конец. */
function lessonNum(o: Order): number {
  const m = String(o.lesson || "").match(/\d+/)
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER
}

/**
 * Группа списка — класс: предмет + класс + четверть. Внутри группы заказы
 * идут по номеру урока, между группами — по классу (см. gradeSortKey).
 */
function groupKey(o: Order): string {
  return [o.subject, o.grade, o.quarter].map((s) => (s || "").trim().toLowerCase()).join("|")
}
function groupLabel(o: Order): string {
  return [o.subject, o.grade, o.quarter].map((s) => (s || "").trim()).filter(Boolean).join(" · ") || "Без класса"
}
function compareGroups(a: Order, b: Order): number {
  const [an, at] = gradeSortKey(a.grade)
  const [bn, bt] = gradeSortKey(b.grade)
  return (a.subject || "").localeCompare(b.subject || "", "ru") || an - bn || at.localeCompare(bt, "ru") || (a.quarter || "").localeCompare(b.quarter || "", "ru")
}

/** Пропущенные номера уроков внутри класса: между первым и последним заказом. */
function missingLessons(orders: Order[]): number[] {
  const nums = [...new Set(orders.map(lessonNum).filter((n) => n !== Number.MAX_SAFE_INTEGER))].sort((a, b) => a - b)
  if (nums.length < 2) return []
  const have = new Set(nums)
  const out: number[] = []
  for (let n = nums[0]; n <= nums[nums.length - 1]; n++) if (!have.has(n)) out.push(n)
  return out
}

/** Что показывать в строке вместо длинного «Литература, 9 класс, 1, Урок 10», когда класс уже в заголовке группы. */
function rowTitleInGroup(o: Order, topic: string | null): string {
  if (o.title) return o.title
  if (topic) return topic
  const composition = (o.lines || []).map((l) => l.label || l.type).filter(Boolean)
  return composition.length ? composition.join(" · ") : "Без состава"
}

/**
 * Подпись столбца, по которой можно кликнуть, чтобы отсортировать.
 *
 * Первый клик ставит направление по умолчанию для этого поля, повторный —
 * переворачивает. Стрелка появляется только у активного столбца: показывать
 * её у всех — значит превратить шапку в частокол.
 */
function SortHead({
  field,
  label,
  sort,
  onSort,
}: {
  field: SortField
  label: string
  sort: OrderSort
  onSort: (s: OrderSort) => void
}) {
  const active = sort.field === field
  return (
    <button
      type="button"
      onClick={() => onSort({ field, dir: active ? (sort.dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[field] })}
      title={active ? "Кликните, чтобы перевернуть порядок" : `Сортировать по столбцу «${label}»`}
      className={cn(
        "group inline-flex items-center gap-1 whitespace-nowrap transition-colors",
        active ? "text-foreground" : "hover:text-foreground"
      )}
    >
      {label}
      {/* Стрелка только у активного столбца, без невидимой заглушки у
          остальных: в столбце «Класс / предмет» подписи две, и два
          зарезервированных места под стрелки съедали ширину, из-за чего
          заголовок налезал на соседний. */}
      {active && (
        <ArrowUp className={cn("size-3 shrink-0 transition-transform", sort.dir === "desc" && "rotate-180")} />
      )}
    </button>
  )
}

export function OrdersPage() {
  const orders = useAppStore((s) => s.orders)
  const boards = useAppStore((s) => s.planningBoards)
  const ktpMode = useAppStore((s) => s.appSettings.ktpMode)
  const setOrders = useAppStore((s) => s.setOrders)
  const [search, setSearch] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  // Архив: сделанные и оплаченные старше месяца прячутся, чтобы список не
  // разрастался; «Показать старше месяца» раскрывает всё.
  const [showOldArchive, setShowOldArchive] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>("all")
  const [sort, setSort] = useState<OrderSort>({ field: "lesson", dir: "asc" })
  const [clientFilter, setClientFilter] = useState("all")
  // Быстрый переход к классу: чипы над таблицей. Один клик — только этот
  // класс, повторный — снова все.
  const [classFilter, setClassFilter] = useState<string | null>(null)
  const [showClass, setShowClass] = useState(true)
  const [showClient, setShowClient] = useState(true)
  const [showDue, setShowDue] = useState(true)
  const [archiveOpen, setArchiveOpen] = useState(false)
  // Открытая карточка живёт в адресе (/orders/:orderId), а не в состоянии:
  // так на неё можно сослаться откуда угодно — из урока, финансов, уведомления
  // таймера, — и карточка всегда показывает актуальный заказ из стора, а не
  // снимок на момент клика.
  const navigate = useNavigate()
  const location = useLocation()
  const { orderId: activeOrderId } = useParams()
  const activeOrder = useMemo(() => (activeOrderId ? orders.find((o) => o.id === activeOrderId) || null : null), [orders, activeOrderId])
  // Откуда пришли в карточку (OrderLink кладёт адрес в state): закрытие
  // карточки возвращает туда, а не оставляет в списке заказов. Редактирование
  // остаётся в списке: форма живёт здесь, и уходить со страницы нельзя.
  const cameFrom = (location.state as { from?: string } | null)?.from
  const setActiveOrder = (o: Order | null, opts: { stay?: boolean } = {}) => {
    if (o) { navigate(`/orders/${o.id}`, { replace: !!activeOrderId, state: cameFrom ? { from: cameFrom } : undefined }); return }
    if (cameFrom && !opts.stay && cameFrom !== "/orders") { navigate(cameFrom, { replace: true }); return }
    navigate("/orders", { replace: !!activeOrderId })
  }
  const [formOpen, setFormOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [duplicateFrom, setDuplicateFrom] = useState<Order | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null)

  const handledHotkey = useRef<number>(0)
  useEffect(() => {
    const st = location.state as { newOrder?: number; focusSearch?: number } | null
    const token = st?.newOrder || st?.focusSearch || 0
    if (!token || token === handledHotkey.current) return
    handledHotkey.current = token
    if (st?.newOrder) openNewOrder()
    if (st?.focusSearch) searchRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])
  useEffect(() => {
    const onFocus = () => searchRef.current?.focus()
    window.addEventListener("crm:focus-search", onFocus)
    return () => window.removeEventListener("crm:focus-search", onFocus)
  }, [])

  function openNewOrder() {
    setEditingOrder(null)
    setDuplicateFrom(null)
    setDeleteTarget(null)
    setFormOpen(true)
  }
  function openEditOrder(o: Order) {
    setActiveOrder(null, { stay: true })
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
    const matchesClient = (r: Row) => (clientFilter === "all" || (r.order.client || "") === clientFilter) && (!classFilter || groupKey(r.order) === classFilter)
    const matchesFilter = (r: Row) => {
      if (filter === "all") return true
      if (filter === "progress") return r.order.status === "progress"
      if (filter === "unpaid") return r.pay.remaining > 0
      if (filter === "overdue") return r.overdue
      return true
    }

    // «Нет значения» всегда внизу, в обе стороны. Иначе при обратном порядке
    // наверх всплывают заказы, у которых поля просто нет, — а искали в них
    // ровно обратное.
    //
    // Для класса это не только пустая строка, но и «Без класса»: номера у него
    // нет, места в ряду 5…11 тоже, и на «от старших» он не должен идти первым.
    const noValue = (r: Row) => {
      if (sort.field === "grade") return !/\d/.test(r.order.grade || "")
      if (sort.field === "subject") return !(r.order.subject || "").trim()
      if (sort.field === "client") return !(r.order.client || "").trim()
      return false
    }

    const compare = (a: Row, b: Row): number => {
      switch (sort.field) {
        case "lesson": {
          // Группы (классы) всегда в одном порядке; направление
          // переворачивает только номера уроков внутри группы.
          const g = compareGroups(a.order, b.order)
          if (g !== 0) return sort.dir === "asc" ? g : -g
          return lessonNum(a.order) - lessonNum(b.order)
        }
        case "deadline": return dl(a).localeCompare(dl(b))
        case "debt": return a.pay.remaining - b.pay.remaining
        case "total": return a.pay.full - b.pay.full
        case "client": return (a.order.client || "").localeCompare(b.order.client || "", "ru")
        case "subject": return (a.order.subject || "").localeCompare(b.order.subject || "", "ru")
        case "grade": {
          const [an, at] = gradeSortKey(a.order.grade)
          const [bn, bt] = gradeSortKey(b.order.grade)
          return an - bn || at.localeCompare(bt, "ru")
        }
        case "created": return (a.order.createdAt || 0) - (b.order.createdAt || 0)
      }
    }

    const applySort = (list: Row[]): Row[] =>
      list.slice().sort((a, b) => {
        const emptyA = noValue(a)
        const emptyB = noValue(b)
        if (emptyA !== emptyB) return emptyA ? 1 : -1

        const p = compare(a, b) * (sort.dir === "asc" ? 1 : -1)
        // Вторичный ключ — срок, иначе равные значения встают случайно.
        // Он всегда по возрастанию: внутри одного класса или предмета нужен
        // тот же ответ на вопрос «что горит», а не зеркальный.
        return p !== 0 ? p : dl(a).localeCompare(dl(b))
      })

    return {
      visibleActive: applySort(active.filter((r) => matchesFilter(r) && matchesSearch(r) && matchesClient(r))),
      visibleArchived: applySort(archived.filter((r) => matchesSearch(r) && matchesClient(r))),
    }
  }, [active, archived, filter, search, sort, clientFilter, classFilter])

  const clientOptions = useMemo(
    () => [...new Set(orders.map((o) => o.client).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")),
    [orders]
  )

  // Группировка включена, когда список идёт по классам: заголовок группы
  // говорит, что это за класс, а строки внутри — только номер и состав.
  const grouped = sort.field === "lesson" || sort.field === "grade"

  // Тема урока из планирования — в заголовок строки (после импорта КТП
  // «Урок 14» превращается в «Пушкин. Лирика»).
  const topics = useMemo(() => new Map(orders.map((o) => [o.id, lessonTopicForOrder(boards, o, { ktpMode })])), [orders, boards, ktpMode])
  const fullTitle = (o: Order) => orderTitleWithTopic(boards, o, { ktpMode })
  const rowTitle = (o: Order) => (grouped ? rowTitleInGroup(o, topics.get(o.id) || null) : fullTitle(o))

  // Дубли: два заказа на один урок. Объединение — из меню строки.
  const dupByOrder = useMemo(() => {
    const m = new Map<string, Order[]>()
    duplicateOrderGroups(orders).forEach((g) => g.forEach((o) => m.set(o.id, g)))
    return m
  }, [orders])

  async function mergeDuplicates(group: Order[]) {
    const [primary, ...rest] = group
    const ok = await confirmDialog({
      title: `Объединить ${group.length} заказа на урок ${primary.lesson}?`,
      bullets: [
        `Останется заказ от ${fmtDeadline(primary.start || primary.deadline)}, остальные ${rest.length} удалятся.`,
        "Позиции с одинаковым названием сложатся (часы суммируются), новые добавятся.",
        "Оплаты, списания аванса и часы журнала перейдут в оставшийся заказ.",
      ],
      confirmLabel: "Объединить",
    })
    if (!ok) return
    const merged = rest.reduce((acc, o) => mergeOrders(acc, o), primary)
    const gone = new Set(rest.map((o) => o.id))
    setOrders((prev) => prev.filter((o) => !gone.has(o.id)).map((o) => (o.id === merged.id ? merged : o)))
    for (const o of rest) {
      await reassignJournalOrder(o.id, merged.id)
      deleteFromCloud("orders", o.id)
    }
    saveData()
  }

  // Чипы классов и пропуски — по всем неотменённым заказам, а не по видимым:
  // «пропущен урок 11» верно только если его нет ни в работе, ни в архиве.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; sample: Order; all: Order[]; activeCount: number; overdue: boolean; due: number }>()
    rows.forEach((r) => {
      if (r.order.status === "cancelled") return
      const key = groupKey(r.order)
      let g = map.get(key)
      if (!g) { g = { key, label: groupLabel(r.order), sample: r.order, all: [], activeCount: 0, overdue: false, due: 0 }; map.set(key, g) }
      g.all.push(r.order)
      if (r.order.status !== "done") g.activeCount++
      if (r.overdue) g.overdue = true
      g.due += r.pay.remaining
    })
    const list = [...map.values()].sort((a, b) => compareGroups(a.sample, b.sample))
    // Уроки, помеченные в планировании «без материала», пропуском не считаются.
    const norm = (s: string) => (s || "").trim().toLowerCase()
    const emptyNums = (o: Order) => {
      const set = new Set<number>()
      boards.forEach((b) => {
        if (norm(b.title) !== norm(o.grade)) return
        if (b.subject && o.subject && norm(b.subject) !== norm(o.subject)) return
        b.lessons.forEach((l) => { if (isLessonEmpty(l)) set.add(l.num) })
      })
      return set
    }
    const missing = new Map(list.map((g) => { const skip = emptyNums(g.sample); return [g.key, missingLessons(g.all).filter((n) => !skip.has(n))] }))
    return { list, missing }
  }, [rows, boards])

  // Старые в архиве: сделанные и оплаченные (или отменённые) больше месяца назад.
  const archiveCutoff = dateKey(new Date(Date.now() - 30 * 86400000))
  const isOldArchived = (r: Row) => {
    const when = r.order.paidAt || r.order.deadline || ""
    if (r.order.status === "cancelled") return !!when && when < archiveCutoff
    return r.pay.remaining <= 0 && !!when && when < archiveCutoff
  }
  const oldArchivedCount = visibleArchived.filter(isOldArchived).length
  const archivedShown = showOldArchive ? visibleArchived : visibleArchived.filter((r) => !isOldArchived(r))

  const totalRows = active.length + archived.length

  const {
    page: currentPage, pageSize, pageItems: pagedActive, setPage, setPageSize,
  } = usePagination(visibleActive, {
    resetKey: [filter, search, sort.field, sort.dir, clientFilter, classFilter || ""].join("|"),
  })

  /** Строки с заголовками групп между классами (только когда список по классам). */
  function withGroupHeaders<T>(list: Row[], renderRow: (r: Row) => T, renderHeader: (g: { key: string; label: string; count: number; missing: number[]; due: number }) => T): T[] {
    if (!grouped) return list.map(renderRow)
    const out: T[] = []
    let prev: string | null = null
    list.forEach((r) => {
      const key = groupKey(r.order)
      if (key !== prev) {
        prev = key
        const count = list.filter((x) => groupKey(x.order) === key).length
        out.push(renderHeader({ key, label: groupLabel(r.order), count, missing: groups.missing.get(key) || [], due: groups.list.find((g) => g.key === key)?.due || 0 }))
      }
      out.push(renderRow(r))
    })
    return out
  }
  const classCol = showClass && !grouped
  // Число колонок таблицы: раньше заголовки групп были на 8 колонок при
  // семи видимых, и лишняя фантомная колонка съедала всё место справа.
  const colCount = 5 + (classCol ? 1 : 0) + (showClient ? 1 : 0) + (showDue ? 1 : 0)

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
      <LessonsHeader subtitle="Все заказы списком: поиск, сортировка, статусы и оплата" />

      {/* Сводка одной полосой: четыре числа без бейджей и подписей в три
          строки — раньше карточки занимали четверть экрана и говорили одно и
          то же дважды. */}
      <div className="glass-surface mb-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl px-5 py-3.5 sm:grid-cols-4">
        <Kpi label="К доплате" value={fmtMoney(dueTotal)} hint={`${dueRows.length} заказов, без учёта авансов`} tone={dueTotal > 0 ? "destructive" : undefined} />
        <Kpi label="В работе" value={String(active.length)} hint={`${active.filter((r) => r.order.status === "queue").length} в очереди · ${active.filter((r) => r.order.status === "progress").length} в работе`} />
        <Kpi label="Просрочено" value={String(overdueRows.length)} hint={overdueRows.length ? overdueRows.map((r) => orderDisplayTitle(r.order).split(",")[0]).slice(0, 3).join(", ") : "срок сдачи не прошёл ни у кого"} tone={overdueRows.length ? "destructive" : undefined} />
        <Kpi label="В архиве" value={String(doneThisMonthCount)} hint="завершённые, см. под таблицей" />
      </div>

      {/* toolbar */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
          <div className="relative w-full sm:w-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
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
                  "rounded-lg px-3.5 py-1.5 text-sm font-bold transition-colors",
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
          <Select
            value={`${sort.field}_${sort.dir}`}
            onValueChange={(v) => {
              const preset = ORDER_SORT_PRESETS.find((p) => p.key === v)
              if (preset) setSort(preset.sort)
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-52">
              <SelectValue>{sortLabel(sort)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ORDER_SORT_PRESETS.map((p) => (
                <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
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

      {/* Классы одной строкой: сколько в работе, где просрочка, клик —
          только этот класс. С тремя-четырьмя классами и полусотней заказов
          это быстрее любого поиска. */}
      {groups.list.length > 1 && (
        <div className="mb-3.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setClassFilter(null)}
            className={cn("rounded-full px-3 py-1 text-xs font-bold transition-colors", !classFilter ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}
          >
            Все классы
          </button>
          {groups.list.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setClassFilter((v) => (v === g.key ? null : g.key))}
              title={`${g.all.length} заказов, ${g.activeCount} в работе${g.due > 0 ? `, к доплате ${fmtMoney(g.due)}` : ""}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-colors",
                classFilter === g.key ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/70"
              )}
            >
              {g.label}
              <span className={cn("rounded-full px-1.5 text-2xs tabular-nums", classFilter === g.key ? "bg-background/20" : "bg-overlay/15 text-muted-foreground")}>{g.activeCount}</span>
              {g.overdue && <span className="size-1.5 rounded-full bg-destructive" title="Есть просроченные" />}
            </button>
          ))}
        </div>
      )}

      {/* mobile — one stacked card per order, no columns to squeeze or scroll */}
      <div className="flex flex-col gap-2.5 sm:hidden">
        {visibleActive.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {orders.length === 0 ? "Заказов пока нет — добавьте первый." : "Ничего не найдено."}
          </div>
        )}
        {withGroupHeaders(
          pagedActive,
          ({ order, pay, overdue }) => (
            <OrderCard
              key={order.id}
              order={order}
              displayTitle={rowTitle(order)}
              fullTitle={fullTitle(order)}
              duplicates={dupByOrder.get(order.id) || null}
              onMerge={() => { const g = dupByOrder.get(order.id); if (g) mergeDuplicates(g) }}
              sum={pay.full}
              due={pay.remaining}
              overdue={overdue}
              showClass={classCol}
              showClient={showClient}
              showDue={showDue}
              grouped={grouped}
              onOpen={() => setActiveOrder(order)}
              onEdit={() => openEditOrder(order)}
              onStatusChange={(next) => changeStatus(order.id, next)}
              onDuplicate={() => openDuplicateOrder(order)}
              onDelete={() => openDeleteOrder(order)}
            />
          ),
          (g) => <GroupHeading key={"g_" + g.key} label={g.label} count={g.count} missing={g.missing} due={g.due} />
        )}

        {archived.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setArchiveOpen((v) => !v)}
              className="mt-1 flex w-full items-center gap-2 px-1 py-2 text-xs font-extrabold tracking-wide text-muted-foreground uppercase"
            >
              <ChevronRight className={cn("size-3 transition-transform", archiveOpen && "rotate-90")} />
              Архив · завершённые и отменённые ({archived.length})
            </button>
            {archiveOpen && withGroupHeaders(
              archivedShown,
              ({ order, pay, overdue }) => (
                <OrderCard
                  key={order.id}
                  order={order}
              displayTitle={rowTitle(order)}
              fullTitle={fullTitle(order)}
              duplicates={dupByOrder.get(order.id) || null}
              onMerge={() => { const g = dupByOrder.get(order.id); if (g) mergeDuplicates(g) }}
                  sum={pay.full}
                  due={pay.remaining}
                  overdue={overdue}
                  showClass={classCol}
                  showClient={showClient}
                  showDue={showDue}
                  grouped={grouped}
                  onOpen={() => setActiveOrder(order)}
                  onEdit={() => openEditOrder(order)}
                  onStatusChange={(next) => changeStatus(order.id, next)}
                  onDuplicate={() => openDuplicateOrder(order)}
                  onDelete={() => openDeleteOrder(order)}
                  muted
                />
              ),
              (g) => <GroupHeading key={"ga_" + g.key} label={g.label} count={g.count} missing={g.missing} due={g.due} />
            )}
            {archiveOpen && oldArchivedCount > 0 && !showOldArchive && (
              <button type="button" onClick={() => setShowOldArchive(true)} className="mt-1 px-1 py-2 text-left text-xs font-bold text-muted-foreground hover:text-foreground">
                Показать старше месяца ({oldArchivedCount})
              </button>
            )}
          </>
        )}
      </div>

      {/* table — fixed layout via colgroup; desktop/tablet only */}
      <div className="glass-surface hidden overflow-hidden rounded-xl sm:block">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] table-fixed border-collapse">
          <colgroup>
            <col />
            {/* Скрытый столбец — без <col>: с нулевой шириной заголовки соседних
                столбцов съезжали на его место и налезали друг на друга. */}
            {classCol && <col style={{ width: 192 }} />}
            {showClient && <col style={{ width: 124 }} />}
            <col style={{ width: 148 }} />
            <col style={{ width: 148 }} />
            <col style={{ width: 120 }} />
            {showDue && <col style={{ width: 128 }} />}
            <col style={{ width: 36 }} />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-3">
                {grouped ? <SortHead field="lesson" label="Урок" sort={sort} onSort={setSort} /> : "Заказ"}
              </TableHead>
              {/* Столбец один, а полей в нём два, и сортировать просили по
                  каждому. Поэтому кликабельны обе подписи по отдельности, а
                  не заголовок целиком. */}
              {classCol && (
                <TableHead className="px-4">
                  <span className="inline-flex items-center gap-1.5">
                    <SortHead field="grade" label="Класс" sort={sort} onSort={setSort} />
                    <span className="text-muted-foreground/40">/</span>
                    <SortHead field="subject" label="предмет" sort={sort} onSort={setSort} />
                  </span>
                </TableHead>
              )}
              {showClient && (
                <TableHead className="px-4">
                  <SortHead field="client" label="Клиент" sort={sort} onSort={setSort} />
                </TableHead>
              )}
              <TableHead className="px-4">
                <SortHead field="deadline" label="Срок сдачи" sort={sort} onSort={setSort} />
              </TableHead>
              <TableHead className="px-4">Статус</TableHead>
              <TableHead className="px-4 text-right">
                <span className="flex justify-end">
                  <SortHead field="total" label="Сумма" sort={sort} onSort={setSort} />
                </span>
              </TableHead>
              {showDue && (
                <TableHead className="px-4 text-right">
                  <span className="flex justify-end">
                    <SortHead field="debt" label="К доплате" sort={sort} onSort={setSort} />
                  </span>
                </TableHead>
              )}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleActive.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="py-10 text-center text-sm text-muted-foreground">
                  {orders.length === 0 ? "Заказов пока нет — добавьте первый." : "Ничего не найдено."}
                </TableCell>
              </TableRow>
            )}
            {withGroupHeaders(
              pagedActive,
              ({ order, pay, overdue }) => (
                <OrderRow
                  key={order.id}
                  order={order}
              displayTitle={rowTitle(order)}
              fullTitle={fullTitle(order)}
              duplicates={dupByOrder.get(order.id) || null}
              onMerge={() => { const g = dupByOrder.get(order.id); if (g) mergeDuplicates(g) }}
                  sum={pay.full}
                  due={pay.remaining}
                  overdue={overdue}
                  showClass={classCol}
                  showClient={showClient}
                  showDue={showDue}
                  grouped={grouped}
                  onOpen={() => setActiveOrder(order)}
                  onEdit={() => openEditOrder(order)}
                  onStatusChange={(next) => changeStatus(order.id, next)}
                  onDuplicate={() => openDuplicateOrder(order)}
                  onDelete={() => openDeleteOrder(order)}
                />
              ),
              (g) => <GroupRow key={"g_" + g.key} label={g.label} count={g.count} missing={g.missing} due={g.due} colSpan={colCount} />
            )}
          </TableBody>
        </table>
        </div>

        <button
          type="button"
          onClick={() => setArchiveOpen((v) => !v)}
          className="flex w-full items-center gap-2 border-t border-border px-3.5 py-2.5 text-xs font-extrabold tracking-wide text-muted-foreground uppercase"
        >
          <ChevronRight className={cn("size-3 transition-transform", archiveOpen && "rotate-90")} />
          Архив · завершённые и отменённые ({archived.length})
        </button>

        {archiveOpen && (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] table-fixed border-collapse">
            <colgroup>
              <col />
              {/* Скрытый столбец — без <col>: с нулевой шириной заголовки соседних
                  столбцов съезжали на его место и налезали друг на друга. */}
              {classCol && <col style={{ width: 192 }} />}
              {showClient && <col style={{ width: 124 }} />}
              <col style={{ width: 148 }} />
              <col style={{ width: 148 }} />
              <col style={{ width: 120 }} />
              {showDue && <col style={{ width: 128 }} />}
              <col style={{ width: 36 }} />
            </colgroup>
            <TableBody>
              {withGroupHeaders(
                archivedShown,
                ({ order, pay, overdue }) => (
                  <OrderRow
                    key={order.id}
                    order={order}
              displayTitle={rowTitle(order)}
              fullTitle={fullTitle(order)}
              duplicates={dupByOrder.get(order.id) || null}
              onMerge={() => { const g = dupByOrder.get(order.id); if (g) mergeDuplicates(g) }}
                    sum={pay.full}
                    due={pay.remaining}
                    overdue={overdue}
                    showClass={classCol}
                    showClient={showClient}
                    showDue={showDue}
                    grouped={grouped}
                    onOpen={() => setActiveOrder(order)}
                    onEdit={() => openEditOrder(order)}
                    onStatusChange={(next) => changeStatus(order.id, next)}
                    onDuplicate={() => openDuplicateOrder(order)}
                    onDelete={() => openDeleteOrder(order)}
                    muted
                  />
                ),
                (g) => <GroupRow key={"ga_" + g.key} label={g.label} count={g.count} missing={g.missing} due={g.due} colSpan={colCount} muted />
              )}
            </TableBody>
          </table>
          </div>
        )}
        {archiveOpen && oldArchivedCount > 0 && (
          <button type="button" onClick={() => setShowOldArchive((v) => !v)} className="flex w-full items-center gap-2 border-t border-border px-3.5 py-2.5 text-left text-xs font-bold text-muted-foreground hover:text-foreground">
            {showOldArchive ? "Скрыть старше месяца" : `Показать старше месяца (${oldArchivedCount}) — сделанные и оплаченные`}
          </button>
        )}
      </div>

      {/* footer */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-4 px-1">
        <div className="text-sm text-muted-foreground">
          {active.length} активных · {archived.length} в архиве · всего {totalRows}
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

/** Содержимое заголовка группы: класс, сколько заказов, пропущенные уроки, к доплате. */
function GroupHeadingInner({ label, count, missing, due }: { label: string; count: number; missing: number[]; due: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-sm font-extrabold text-foreground">{label}</span>
      <span className="text-xs font-bold text-muted-foreground">{count} {count === 1 ? "заказ" : count < 5 ? "заказа" : "заказов"}</span>
      {missing.length > 0 && (
        <span className="rounded-full bg-warning px-2 py-px text-2xs font-bold text-warning-foreground" title="Между первым и последним заказом класса нет заказов с этими номерами">
          нет уроков: {missing.slice(0, 8).join(", ")}{missing.length > 8 ? "…" : ""}
        </span>
      )}
      {due > 0 && <span className="text-xs font-bold text-destructive">к доплате {fmtMoney(due)}</span>}
    </div>
  )
}

function GroupRow({ colSpan, muted, ...rest }: { label: string; count: number; missing: number[]; due: number; colSpan: number; muted?: boolean }) {
  return (
    <TableRow className={cn("hover:bg-transparent", muted ? "bg-muted/30" : "bg-muted/60")}>
      <TableCell colSpan={colSpan} className="px-3 py-2 whitespace-normal">
        <GroupHeadingInner {...rest} />
      </TableCell>
    </TableRow>
  )
}

function GroupHeading(props: { label: string; count: number; missing: number[]; due: number }) {
  return (
    <div className="mt-1.5 px-1">
      <GroupHeadingInner {...props} />
    </div>
  )
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "destructive" }) {
  return (
    <div className="min-w-0">
      <div className="text-2xs font-extrabold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn("font-heading mt-0.5 text-2xl font-bold tabular-nums", tone === "destructive" && "text-destructive")}>{value}</div>
      <div className="truncate text-xs text-muted-foreground" title={hint}>{hint}</div>
    </div>
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
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onStatusChange,
  grouped,
  muted,
  displayTitle,
  fullTitle,
  duplicates,
  onMerge,
}: {
  order: Order
  sum: number
  due: number
  overdue: boolean
  showClass: boolean
  showClient: boolean
  showDue: boolean
  onOpen: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onStatusChange: (next: Order["status"]) => void
  grouped?: boolean
  muted?: boolean
  displayTitle: string
  fullTitle: string
  duplicates: Order[] | null
  onMerge: () => void
}) {
  const n = grouped ? lessonNum(order) : Number.MAX_SAFE_INTEGER
  return (
    <TableRow>
      <TableCell className="min-w-0 whitespace-normal px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <OrderTimerButton order={order} />
          {/* В группе класс уже в заголовке: строка — это номер урока и
              состав, а не «Литература, 9 класс, 1, Урок 10» сорок раз подряд. */}
          {grouped && (
            <span className={cn("font-heading shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-bold tabular-nums", muted && "text-muted-foreground")} title="Номер урока">
              {n === Number.MAX_SAFE_INTEGER ? "—" : `№ ${n}`}
            </span>
          )}
          <button
            type="button"
            onClick={onOpen}
            title={fullTitle}
            className={cn(
              "min-w-0 truncate text-base text-foreground underline decoration-transparent decoration-1 underline-offset-3 hover:decoration-muted-foreground",
              grouped && !order.title ? "font-medium" : "font-bold"
            )}
          >
            {displayTitle}
          </button>
          {duplicates && <span className="shrink-0 rounded-full bg-warning px-1.5 text-2xs font-bold text-warning-foreground" title="На этот урок несколько заказов — объединить можно из меню строки">дубль</span>}
          {order.priority && <span className="shrink-0">🔥</span>}
          {overdue && <span className="shrink-0 text-2xs font-bold text-destructive">просрочен</span>}
        </div>
      </TableCell>
      {showClass && (
        <TableCell className="min-w-0 px-4 text-sm text-muted-foreground">
          {(order.subject || order.grade) ? (
            <span className="block truncate">{[order.grade, order.subject].filter(Boolean).join(" · ")}</span>
          ) : "—"}
        </TableCell>
      )}
      {showClient && (
        <TableCell className="min-w-0 px-4">
          {order.client ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar className="size-4.5 shrink-0">
                <AvatarFallback className="text-2xs font-extrabold">
                  {clientInitials(order.client)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-sm">{order.client}</span>
            </span>
          ) : <span className="text-sm text-muted-foreground">—</span>}
        </TableCell>
      )}
      <TableCell className={cn("px-4 text-sm", overdue ? "font-bold text-destructive" : "text-muted-foreground")}>
        {fmtDeadline(order.deadline)}
      </TableCell>
      <TableCell className="px-4">
        <StatusBadge status={order.status} onChange={onStatusChange} />
      </TableCell>
      <TableCell className={cn("px-4 text-right font-heading text-sm font-bold tabular-nums", muted && "text-muted-foreground")}>
        {fmtMoney(sum)}
      </TableCell>
      {showDue && (
        <TableCell
          className={cn(
            "px-4 text-right font-heading text-sm font-bold tabular-nums",
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
            {duplicates && (
              <DropdownMenuItem onClick={onMerge}>
                <Merge />
                Объединить дубли ({duplicates.length})
              </DropdownMenuItem>
            )}
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
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onStatusChange,
  grouped,
  muted,
  displayTitle,
  duplicates,
  onMerge,
}: {
  order: Order
  sum: number
  due: number
  overdue: boolean
  showClass: boolean
  showClient: boolean
  showDue: boolean
  onOpen: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onStatusChange: (next: Order["status"]) => void
  grouped?: boolean
  muted?: boolean
  displayTitle: string
  fullTitle?: string
  duplicates: Order[] | null
  onMerge: () => void
}) {
  const metaParts = [
    showClass && [order.grade, order.subject].filter(Boolean).join(" · "),
    showClient && order.client,
  ].filter(Boolean) as string[]
  const n = grouped ? lessonNum(order) : Number.MAX_SAFE_INTEGER

  return (
    <div className="glass-surface rounded-xl p-3.5">
      <div className="flex items-start gap-2.5">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex min-w-0 items-center gap-1.5">
            {grouped && (
              <span className="font-heading shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-bold tabular-nums">{n === Number.MAX_SAFE_INTEGER ? "—" : `№ ${n}`}</span>
            )}
            <span className={cn("min-w-0 truncate text-base font-bold", muted && "text-muted-foreground")}>{displayTitle}</span>
            {duplicates && <span className="shrink-0 rounded-full bg-warning px-1.5 text-2xs font-bold text-warning-foreground">дубль</span>}
            {order.priority && <span className="shrink-0">🔥</span>}
          </div>
          {metaParts.length > 0 && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{metaParts.join(" · ")}</div>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="shrink-0"><MoreVertical /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}><Pencil />Редактировать</DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}><Copy />Дублировать</DropdownMenuItem>
            {duplicates && <DropdownMenuItem onClick={onMerge}><Merge />Объединить дубли ({duplicates.length})</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 />Удалить</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <StatusBadge status={order.status} onChange={onStatusChange} />
        <span className={cn("text-xs font-bold", overdue ? "text-destructive" : "text-muted-foreground")}>
          {overdue && "просрочен · "}{fmtDeadline(order.deadline)}
        </span>
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2.5">
        <div>
          <div className="text-2xs font-bold tracking-wide text-muted-foreground uppercase">Сумма</div>
          <div className={cn("font-heading text-base font-bold tabular-nums", muted && "text-muted-foreground")}>{fmtMoney(sum)}</div>
        </div>
        {showDue && (
          <div className="text-right">
            <div className="text-2xs font-bold tracking-wide text-muted-foreground uppercase">К доплате</div>
            <div className={cn("font-heading text-base font-bold tabular-nums", due === 0 && "text-muted-foreground")}>{fmtMoney(due)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
