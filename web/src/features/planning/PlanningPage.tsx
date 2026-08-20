import { useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { PageHeader } from "@/components/layout/AppShell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { useAppStore } from "@/store/useAppStore"
import { BoardCard } from "./BoardCard"
import { BoardFormDialog } from "./BoardFormDialog"
import { LessonSheet } from "./LessonSheet"
import type { PlanningBoard, PlanningLesson } from "@/types/models"

type SortMode = "class" | "subject" | "deadline"

export function PlanningPage() {
  const boards = useAppStore((s) => s.planningBoards)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortMode>("class")
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [boardFormOpen, setBoardFormOpen] = useState(false)
  const [editingBoard, setEditingBoard] = useState<PlanningBoard | null>(null)
  const [activeLesson, setActiveLesson] = useState<{ board: PlanningBoard; lesson: PlanningLesson } | null>(null)

  const sorted = useMemo(() => {
    let list = boards.slice()
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((b) => (b.subject || "").toLowerCase().includes(q) || (b.title || "").toLowerCase().includes(q) || (b.quarter || "").toLowerCase().includes(q))
    if (sort === "class") list.sort((a, b) => (a.title || "").localeCompare(b.title || "", "ru"))
    else if (sort === "subject") list.sort((a, b) => (a.subject || "").localeCompare(b.subject || "", "ru"))
    else if (sort === "deadline") list.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"))
    return list
  }, [boards, search, sort])

  const active = sorted.filter((b) => !b.archived)
  const archived = sorted.filter((b) => b.archived)

  return (
    <div>
      <PageHeader
        title="Планирование"
        subtitle="Сетка уроков по классам с автосинхронизацией заказов и архивом"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
              <SelectTrigger size="sm" className="w-full sm:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="class">Сортировка: по классу</SelectItem>
                <SelectItem value="subject">Сортировка: по предмету</SelectItem>
                <SelectItem value="deadline">Сортировка: по дедлайну</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => { setEditingBoard(null); setBoardFormOpen(true) }} className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
              <Plus />
              Добавить класс
            </Button>
          </div>
        }
      />

      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по классам..." className="mb-4 max-w-[320px]" />

      {boards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 text-center">
          <div className="text-[14px] font-bold">Список планирования пуст</div>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">Создайте первый класс для ведения уроков.</p>
          <Button onClick={() => setBoardFormOpen(true)} className="mt-4 bg-cta/90 font-extrabold text-cta-foreground">
            Добавить класс
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {active.length === 0 && <div className="py-6 text-[13px] text-muted-foreground">{search ? "По вашему запросу ничего не найдено" : "Нет активных классов в планировании"}</div>}
          {active.map((b) => (
            <BoardCard key={b.id} board={b} onEdit={() => { setEditingBoard(b); setBoardFormOpen(true) }} onOpenLesson={(lesson) => setActiveLesson({ board: b, lesson })} />
          ))}

          {archived.length > 0 && (
            <div className="mt-2 border-t-2 border-dashed border-border pt-5">
              <button type="button" onClick={() => setArchiveOpen((v) => !v)} className="mb-3 text-[13px] font-bold text-muted-foreground">
                Архив классов ({archived.length}) {archiveOpen ? "▲" : "▼"}
              </button>
              {archiveOpen && (
                <div className="flex flex-col gap-3.5">
                  {archived.map((b) => (
                    <BoardCard key={b.id} board={b} onEdit={() => { setEditingBoard(b); setBoardFormOpen(true) }} onOpenLesson={(lesson) => setActiveLesson({ board: b, lesson })} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <BoardFormDialog open={boardFormOpen} board={editingBoard} onOpenChange={setBoardFormOpen} />
      <LessonSheet
        board={activeLesson?.board ?? null}
        lesson={activeLesson?.lesson ?? null}
        onOpenChange={(open) => !open && setActiveLesson(null)}
      />
    </div>
  )
}
