import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Settings, Archive, ArchiveRestore, X, CalendarDays, FolderOpen, LayoutGrid, List } from "lucide-react"
import { StatusBadge } from "@/features/orders/StatusBadge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/useAppStore"
import { saveData, deleteFromCloud } from "@/lib/cloudSync"
import { fmtDeadline } from "@/lib/dates"
import { dateKey } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Order, PlanningBoard, PlanningLesson } from "@/types/models"
import { confirmDialog } from "@/store/useDialogStore"
import { computeBoardProgress, lessonDisplayColor, isLessonDone, isLessonEmpty } from "@/lib/planningStats"
import { findGoverningOrder } from "@/lib/planningSync"
import { unlinkOrdersFromLessons } from "@/lib/planningOrderSync"
import { scheduleValid, scheduleStatus, weekLabel, type ScheduleWeek } from "@/lib/boardSchedule"

const CELL_STYLE: Record<string, string> = {
  gray: "bg-neutral-tone text-neutral-tone-foreground",
  yellow: "bg-warning text-warning-foreground",
  "green-1": "bg-success/35 text-success-foreground",
  "green-2": "bg-success/65 text-success-foreground",
  "green-3": "bg-success text-success-foreground",
  red: "bg-destructive text-white",
  // Без материала: пустая клетка с пунктиром — номер на месте, делать нечего.
  empty: "border border-dashed border-border bg-transparent text-muted-foreground/60",
}

function randId(prefix: string) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// Вид сетки: квадраты для обзора, строки для работы (тема, состав, заказ).
// Общий на все классы, живёт в браузере.
type BoardView = "grid" | "rows"
const VIEW_KEY = "crm_board_view"
function readView(): BoardView {
  try { return localStorage.getItem(VIEW_KEY) === "rows" ? "rows" : "grid" } catch { return "grid" }
}

export function BoardCard({
  board,
  onEdit,
  onOpenLesson,
}: {
  board: PlanningBoard
  onEdit: () => void
  onOpenLesson: (lesson: PlanningLesson) => void
}) {
  const orders = useAppStore((s) => s.orders)
  const schedule = useAppStore((s) => s.appSettings.boardSchedules?.[board.id])
  const materialsLink = useAppStore((s) => s.appSettings.boardLinks?.[board.id])
  const ktpMode = useAppStore((s) => s.appSettings.ktpMode)
  const setPlanningBoards = useAppStore((s) => s.setPlanningBoards)
  const setOrders = useAppStore((s) => s.setOrders)
  const setAppSettings = useAppStore((s) => s.setAppSettings)
  // Свёрнутость хранится в самой доске (и в облаке): раньше поле board.collapsed
  // сохранялось, но карточка держала своё локальное состояние и после
  // перезагрузки всё открывалось развёрнутым.
  const collapsed = !!board.collapsed
  const [showCompleted, setShowCompleted] = useState(false)
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null)
  const [view, setView] = useState<BoardView>(readView)
  function switchView(v: BoardView) {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* приватный режим */ }
  }

  useEffect(() => {
    if (!deleteArmedId) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest(`[data-lesson-id="${deleteArmedId}"]`)) setDeleteArmedId(null)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDeleteArmedId(null)
    }
    document.addEventListener("click", onDocClick)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("click", onDocClick)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [deleteArmedId])

  const lessons = board.lessons || []
  // Цвет клетки считается на лету по чек-листу и заказу урока — а не берётся
  // из сохранённого lesson.color, который мог посчитать другой, отставший
  // клиент (см. lessonDisplayColor).
  const governing = useMemo(() => {
    const map = new Map<string, Order | null>()
    ;(board.lessons || []).forEach((l) => map.set(l.id, findGoverningOrder(orders, board, l)))
    return map
  }, [orders, board])
  const colorOf = (l: PlanningLesson) => lessonDisplayColor(l, governing.get(l.id))

  // Расчёт вынесен в lib/planningStats.ts — тот же самый использует экспорт
  // в CSV, и он обязан сходиться с тем, что нарисовано на этой карточке.
  const progress = computeBoardProgress(board)
  const { itemsTotal: totalItems, itemsDone: doneItems, lessonsDone: greenLessons } = progress
  const typeBreakdown: Record<string, { done: number; total: number }> = {}
  progress.byItem.forEach(({ name, done, total }) => { typeBreakdown[name] = { done, total } })

  const lessonsTotal = progress.lessonsTotal
  const mainPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : lessonsTotal > 0 ? Math.round((greenLessons / lessonsTotal) * 100) : 0
  const lessonsPct = lessonsTotal > 0 ? Math.round((greenLessons / lessonsTotal) * 100) : 0

  const today = dateKey(new Date())
  // Урок без материала для графика считается закрытым: отставать по нему нечему.
  const plan = scheduleValid(schedule) ? scheduleStatus(lessons, schedule, today, (l) => isLessonDone(l) || isLessonEmpty(l)) : null

  function updateBoard(patch: Partial<PlanningBoard>) {
    setPlanningBoards((prev) => prev.map((b) => (b.id === board.id ? { ...b, ...patch } : b)))
    saveData()
  }

  function toggleArchived() {
    updateBoard({ archived: !board.archived })
  }
  async function deleteBoard() {
    const ok = await confirmDialog({
      title: "Удалить доску со всеми уроками?",
      body: `«${board.title}» — вместе с ней исчезнут ${lessons.length} уроков и весь их состав. Заказы это не затронет.`,
      confirmLabel: "Удалить доску",
      destructive: true,
    })
    if (!ok) return
    setPlanningBoards((prev) => prev.filter((b) => b.id !== board.id))
    // Уроки удаляем поимённо, а не только доску: строки уроков лежат в своей
    // таблице и без этого оставались в облаке навсегда. На экране их не видно
    // (урок без доски никуда не попадает), но копятся они молча.
    lessons.forEach((l) => deleteFromCloud("planning_lessons", l.id))
    deleteFromCloud("planning_boards", board.id)
    setOrders((prev) => unlinkOrdersFromLessons(prev, lessons.map((l) => l.id)))
    setAppSettings((s) => {
      if (!s.boardTemplates?.[board.id] && !s.boardSchedules?.[board.id] && !s.boardLinks?.[board.id]) return s
      const drop = <T,>(m: Record<string, T> | undefined) => { const n = { ...(m || {}) }; delete n[board.id]; return n }
      return { ...s, boardTemplates: drop(s.boardTemplates), boardSchedules: drop(s.boardSchedules), boardLinks: drop(s.boardLinks) }
    })
    saveData()
  }
  function addLesson() {
    const maxNum = lessons.reduce((m, l) => Math.max(m, l.num || 0), 0)
    const baseItems = (board.baseTemplate || []).map((t) => ({ id: randId("i"), text: t, done: false }))
    const lesson: PlanningLesson = { id: randId("l"), num: maxNum + 1, title: `Урок ${maxNum + 1}`, color: "gray", items: baseItems, colorLocked: false, orderLinked: false, notes: "" }
    updateBoard({ lessons: [...lessons, lesson] })
  }
  function deleteLesson(id: string) {
    updateBoard({ lessons: lessons.filter((l) => l.id !== id) })
    // Раньше это правило только локальный список — строка урока оставалась в
    // облаке и при следующей синхронизации приезжала обратно. Тот же провал,
    // что был у удаления доски целиком (см. v2.14.0).
    deleteFromCloud("planning_lessons", id)
    setOrders((prev) => unlinkOrdersFromLessons(prev, [id]))
    setDeleteArmedId(null)
  }

  const hiddenCompletedCount = showCompleted ? 0 : lessons.filter((l) => colorOf(l) === "green-3").length
  const isVisible = (l: PlanningLesson) => showCompleted || colorOf(l) !== "green-3"

  function renderCell(lesson: PlanningLesson) {
    const colorClass = colorOf(lesson)
    const armed = deleteArmedId === lesson.id
    return (
      <button
        key={lesson.id}
        type="button"
        data-lesson-id={lesson.id}
        title={armed ? "Удалить урок" : isLessonEmpty(lesson) ? `Урок ${lesson.num} — без материала` : lesson.title || `Урок ${lesson.num}`}
        onClick={() => (armed ? deleteLesson(lesson.id) : onOpenLesson(lesson))}
        onContextMenu={(e) => { e.preventDefault(); setDeleteArmedId(lesson.id) }}
        className={cn(
          "flex size-11 items-center justify-center rounded-[13px] text-base font-bold transition-transform hover:brightness-105 active:scale-[0.93]",
          armed ? "bg-destructive text-white" : CELL_STYLE[colorClass]
        )}
      >
        {armed ? <X className="size-4.5" strokeWidth={2.5} /> : lesson.num}
      </button>
    )
  }

  // Строка урока: номер в цвете клетки, тема, состав, заказ, неделя.
  function renderRow(lesson: PlanningLesson) {
    const colorClass = colorOf(lesson)
    const order = governing.get(lesson.id)
    const items = lesson.items || []
    const done = items.filter((i) => i.done).length
    const week = plan?.weeks.find((w) => w.lessons.some((l) => l.id === lesson.id))
    const empty = isLessonEmpty(lesson)
    const topic = ktpMode && lesson.title && !/^урок\s*\d+$/i.test(lesson.title) ? lesson.title : ""
    const armed = deleteArmedId === lesson.id
    return (
      <button
        key={lesson.id}
        type="button"
        data-lesson-id={lesson.id}
        onClick={() => (armed ? deleteLesson(lesson.id) : onOpenLesson(lesson))}
        onContextMenu={(e) => { e.preventDefault(); setDeleteArmedId(lesson.id) }}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-muted"
      >
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold", armed ? "bg-destructive text-white" : CELL_STYLE[colorClass])}>
          {armed ? <X className="size-4" strokeWidth={2.5} /> : lesson.num}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm", topic ? "font-bold" : ktpMode ? "text-muted-foreground" : "font-bold")}>{topic || (ktpMode ? "Без темы" : lesson.title || `Урок ${lesson.num}`)}</span>
          <span className="block truncate text-2xs text-muted-foreground">
            {empty ? "без материала — в прогресс не входит" : items.length ? `${done}/${items.length}: ${items.map((i) => (i.done ? "✓ " : "") + i.text).join(", ")}` : "состав пуст"}
          </span>
        </span>
        {week && <span className="hidden shrink-0 text-2xs font-bold text-muted-foreground uppercase sm:block">{week.index + 1} нед</span>}
        {order ? <StatusBadge status={order.status} /> : <span className="hidden shrink-0 text-2xs text-muted-foreground sm:block">без заказа</span>}
      </button>
    )
  }

  function renderWeek(w: ScheduleWeek) {
    const visible = w.lessons.filter(isVisible)
    const current = plan && w.index === plan.currentWeek
    // Неделя без уроков по графику (каникулы) — узкая плашка, чтобы счёт
    // недель на сетке сходился с КТП.
    if (w.planned === 0) {
      return (
        <div key={w.index} className={cn("flex flex-col justify-center rounded-[15px] border border-dashed px-2 py-1.5", current ? "border-emphasis/50" : "border-border")}>
          <div className="text-2xs font-bold tracking-wide text-muted-foreground uppercase">{w.index + 1} нед</div>
          <div className="text-2xs text-muted-foreground">каникулы</div>
        </div>
      )
    }
    if (!visible.length) return null
    const past = w.end < today
    const lagging = past && w.lessons.some((l) => !isLessonDone(l) && !isLessonEmpty(l))
    return (
      <div
        key={w.index}
        className={cn(
          "rounded-[15px] border p-1.5",
          current ? "border-emphasis/50 bg-emphasis/8" : "border-transparent",
          lagging && !current && "border-destructive/30"
        )}
      >
        <div className={cn("mb-1 flex items-center gap-1 px-0.5 text-2xs font-bold tracking-wide uppercase", current ? "text-foreground" : lagging ? "text-destructive" : "text-muted-foreground")}>
          <span>{w.index + 1} нед</span>
          <span className="font-semibold normal-case tracking-normal opacity-80">· {weekLabel(w)}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">{visible.map(renderCell)}</div>
      </div>
    )
  }

  return (
    <div className="glass-surface rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-3 py-1.5 text-sm font-bold">{board.subject || "Предмет"}</span>
          <span className="rounded-full bg-muted px-3 py-1.5 text-sm font-bold">{board.title || "Класс"}</span>
          {board.quarter && <span className="text-xs text-muted-foreground">{board.quarter}</span>}
          {board.deadline ? (
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-2xs font-bold">
              <CalendarDays className="size-3" />
              {fmtDeadline(board.deadline)}
            </button>
          ) : (
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-2xs font-bold text-muted-foreground">
              <CalendarDays className="size-3" />+ Дедлайн
            </button>
          )}
          {materialsLink && (
            <a
              href={materialsLink}
              target="_blank"
              rel="noopener noreferrer"
              title={materialsLink}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-2xs font-bold hover:bg-muted"
            >
              <FolderOpen className="size-3" />
              Материалы
            </a>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="mr-1 flex rounded-md border border-border p-0.5">
            <button type="button" title="Клетки" onClick={() => switchView("grid")} className={cn("flex size-7 items-center justify-center rounded", view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <LayoutGrid className="size-3.5" />
            </button>
            <button type="button" title="Строки: тема, состав, заказ" onClick={() => switchView("rows")} className={cn("flex size-7 items-center justify-center rounded", view === "rows" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <List className="size-3.5" />
            </button>
          </div>
          <IconBtn title="Настройки класса" onClick={onEdit}><Settings className="size-3.5" /></IconBtn>
          <Button variant="outline" size="sm" onClick={addLesson}>Добавить урок</Button>
          <IconBtn title={board.archived ? "Вернуть из архива" : "В архив"} onClick={toggleArchived}>
            {board.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
          </IconBtn>
          <IconBtn title="Удалить класс" onClick={deleteBoard} danger><X className="size-3.5" /></IconBtn>
          <IconBtn title={collapsed ? "Развернуть" : "Свернуть"} onClick={() => updateBoard({ collapsed: !collapsed })}>
            <ChevronDown className={cn("size-4 transition-transform", collapsed && "-rotate-90")} />
          </IconBtn>
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 pb-4">
          <div className="mb-3 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))" }}>
            <div className="rounded-xl border-[1.5px] border-overlay/25 bg-overlay/5 px-3 py-2.5">
              <div className="text-2xs font-bold tracking-wide text-muted-foreground uppercase">Пункты</div>
              <div className="font-heading mt-0.5 text-sm font-bold">{doneItems}/{totalItems} · {mainPct}%</div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-overlay/10"><div className="h-full rounded-full bg-emphasis/80" style={{ width: `${mainPct}%` }} /></div>
            </div>
            <div className="rounded-xl bg-muted px-3 py-2.5">
              <div className="text-2xs font-bold tracking-wide text-muted-foreground uppercase">Уроки</div>
              <div className="font-heading mt-0.5 text-sm font-bold">{greenLessons}/{lessonsTotal}</div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-overlay/10"><div className="h-full rounded-full bg-emphasis/60" style={{ width: `${lessonsPct}%` }} /></div>
            </div>
            {plan && (
              // График: где программа должна быть сегодня и сколько уроков
              // отстаёт. Считается по неделям от даты старта (lib/boardSchedule.ts).
              <div className={cn("rounded-xl px-3 py-2.5", plan.behind > 0 ? "bg-destructive/10" : "bg-muted")}>
                <div className="text-2xs font-bold tracking-wide text-muted-foreground uppercase">График</div>
                <div className="font-heading mt-0.5 text-sm font-bold">
                  {plan.currentWeek < 0 ? "до старта" : plan.currentWeek >= plan.weeks.length ? "завершён" : `${plan.currentWeek + 1} из ${plan.weeks.length} нед`}
                </div>
                <div className={cn("mt-1 text-2xs font-bold", plan.behind > 0 ? "text-destructive" : "text-muted-foreground")}>
                  {plan.behind > 0 ? `отстаёт на ${plan.behind}` : "в графике"} · план {plan.plannedByNow}, готово {plan.done}
                </div>
              </div>
            )}
            {Object.entries(typeBreakdown).map(([name, stat]) => {
              const pct = stat.total > 0 ? Math.round((stat.done / stat.total) * 100) : 0
              return (
                <div key={name} className="rounded-xl bg-muted px-3 py-2.5">
                  <div className="truncate text-2xs font-bold tracking-wide text-muted-foreground uppercase">{name}</div>
                  <div className="font-heading mt-0.5 text-sm font-bold">{stat.done}/{stat.total}</div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-overlay/10"><div className="h-full rounded-full bg-emphasis/60" style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>

          {view === "rows" ? (
            <div className="flex flex-col gap-0.5">{lessons.slice().sort((a, b) => (a.num || 0) - (b.num || 0)).filter(isVisible).map(renderRow)}</div>
          ) : plan ? (
            <div className="-m-1.5 flex flex-wrap gap-x-2 gap-y-1">{plan.weeks.map(renderWeek)}</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">{lessons.filter(isVisible).map(renderCell)}</div>
          )}

          {/* Жест удаления правой кнопкой раньше нигде не был подписан —
              о нём просто не знали. Основной путь — корзина в карточке урока. */}
          {lessons.length > 0 && (
            <div className="mt-2 text-2xs text-muted-foreground">
              Клик — открыть урок. Удалить: корзина в карточке урока или правая кнопка по клетке.
              {!plan && " Уроков в неделю и дата старта — в настройках класса: сетка разложится по неделям."}
            </div>
          )}

          {(hiddenCompletedCount > 0 || showCompleted) && (
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              className="mx-auto mt-3 flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-2xs font-bold text-muted-foreground"
            >
              {showCompleted ? "Скрыть выполненные" : "Показать выполненные"}
              {!showCompleted && hiddenCompletedCount > 0 && <span className="rounded-full bg-overlay/20 px-1.5 text-foreground">{hiddenCompletedCount}</span>}
              <ChevronDown className={cn("size-3 transition-transform", showCompleted && "rotate-180")} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted",
        danger && "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
      )}
    >
      {children}
    </button>
  )
}
