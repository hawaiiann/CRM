import { useEffect, useState } from "react"
import { ChevronDown, Settings, Archive, ArchiveRestore, X, CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/useAppStore"
import { saveData, deleteFromCloud } from "@/lib/cloudSync"
import { fmtDeadline } from "@/lib/dates"
import { cn } from "@/lib/utils"
import type { PlanningBoard, PlanningLesson } from "@/types/models"
import { confirmDialog } from "@/store/useDialogStore"
import { computeBoardProgress, lessonDisplayColor } from "@/lib/planningStats"

const CELL_STYLE: Record<string, string> = {
  gray: "bg-neutral-tone text-neutral-tone-foreground",
  yellow: "bg-warning text-warning-foreground",
  "green-1": "bg-success/35 text-success-foreground",
  "green-2": "bg-success/65 text-success-foreground",
  "green-3": "bg-success text-success-foreground",
  red: "bg-destructive text-white",
}

function randId(prefix: string) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
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
  const setPlanningBoards = useAppStore((s) => s.setPlanningBoards)
  const [collapsed, setCollapsed] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null)

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
  // Расчёт вынесен в lib/planningStats.ts — тот же самый использует экспорт
  // в CSV, и он обязан сходиться с тем, что нарисовано на этой карточке.
  const progress = computeBoardProgress(board)
  const { itemsTotal: totalItems, itemsDone: doneItems, lessonsDone: greenLessons } = progress
  const typeBreakdown: Record<string, { done: number; total: number }> = {}
  progress.byItem.forEach(({ name, done, total }) => { typeBreakdown[name] = { done, total } })

  const mainPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : lessons.length > 0 ? Math.round((greenLessons / lessons.length) * 100) : 0
  const lessonsPct = lessons.length > 0 ? Math.round((greenLessons / lessons.length) * 100) : 0

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
    setDeleteArmedId(null)
  }

  let hiddenCompletedCount = 0

  return (
    <div className="glass-surface rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-3 py-1.5 text-[12.5px] font-bold">{board.subject || "Предмет"}</span>
          <span className="rounded-full bg-muted px-3 py-1.5 text-[12.5px] font-bold">{board.title || "Класс"}</span>
          {board.quarter && <span className="text-[12px] text-muted-foreground">{board.quarter}</span>}
          {board.deadline ? (
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-bold">
              <CalendarDays className="size-3" />
              {fmtDeadline(board.deadline)}
            </button>
          ) : (
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
              <CalendarDays className="size-3" />+ Дедлайн
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <IconBtn title="Настройки класса" onClick={onEdit}><Settings className="size-3.5" /></IconBtn>
          <Button variant="outline" size="sm" onClick={addLesson}>Добавить урок</Button>
          <IconBtn title={board.archived ? "Вернуть из архива" : "В архив"} onClick={toggleArchived}>
            {board.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
          </IconBtn>
          <IconBtn title="Удалить класс" onClick={deleteBoard} danger><X className="size-3.5" /></IconBtn>
          <IconBtn title={collapsed ? "Развернуть" : "Свернуть"} onClick={() => setCollapsed((v) => !v)}>
            <ChevronDown className={cn("size-4 transition-transform", collapsed && "-rotate-90")} />
          </IconBtn>
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 pb-4">
          <div className="mb-3 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))" }}>
            <div className="rounded-xl border-[1.5px] border-overlay/25 bg-overlay/5 px-3 py-2.5">
              <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Пункты</div>
              <div className="font-heading mt-0.5 text-[13px] font-bold">{doneItems}/{totalItems} · {mainPct}%</div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-overlay/10"><div className="h-full rounded-full bg-emphasis/80" style={{ width: `${mainPct}%` }} /></div>
            </div>
            <div className="rounded-xl bg-muted px-3 py-2.5">
              <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Уроки</div>
              <div className="font-heading mt-0.5 text-[13px] font-bold">{greenLessons}/{lessons.length}</div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-overlay/10"><div className="h-full rounded-full bg-emphasis/60" style={{ width: `${lessonsPct}%` }} /></div>
            </div>
            {Object.entries(typeBreakdown).map(([name, stat]) => {
              const pct = stat.total > 0 ? Math.round((stat.done / stat.total) * 100) : 0
              return (
                <div key={name} className="rounded-xl bg-muted px-3 py-2.5">
                  <div className="truncate text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{name}</div>
                  <div className="font-heading mt-0.5 text-[13px] font-bold">{stat.done}/{stat.total}</div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-overlay/10"><div className="h-full rounded-full bg-emphasis/60" style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {lessons.map((lesson) => {
              const colorClass = lessonDisplayColor(lesson)
              if (colorClass === "green-3" && !showCompleted) { hiddenCompletedCount++; return null }
              const armed = deleteArmedId === lesson.id
              return (
                <button
                  key={lesson.id}
                  type="button"
                  data-lesson-id={lesson.id}
                  title={armed ? "Удалить урок" : lesson.title || `Урок ${lesson.num}`}
                  onClick={() => (armed ? deleteLesson(lesson.id) : onOpenLesson(lesson))}
                  onContextMenu={(e) => { e.preventDefault(); setDeleteArmedId(lesson.id) }}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-[13px] text-[14.5px] font-bold transition-transform hover:brightness-105 active:scale-[0.93]",
                    armed ? "bg-destructive text-white" : CELL_STYLE[colorClass]
                  )}
                >
                  {armed ? <X className="size-4.5" strokeWidth={2.5} /> : lesson.num}
                </button>
              )
            })}
          </div>

          {(hiddenCompletedCount > 0 || showCompleted) && (
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              className="mx-auto mt-3 flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-bold text-muted-foreground"
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
