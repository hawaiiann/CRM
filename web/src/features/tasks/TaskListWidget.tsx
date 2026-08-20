import { useState } from "react"
import { Check, ChevronDown, Pencil, Trash2 } from "lucide-react"
import { useAppStore } from "@/store/useAppStore"
import { saveData, deleteFromCloud } from "@/lib/cloudSync"
import { dateKey } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Task, TaskPeriod } from "@/types/models"

const PERIODS: TaskPeriod[] = ["today", "week", "month", "year"]
const PERIOD_LABELS: Record<TaskPeriod, string> = { today: "Сегодня", week: "На этой неделе", month: "В этом месяце", year: "В этом году" }

function randId() {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function isTaskOverdue(t: Task): boolean {
  return !t.done && (t.period || "today") === "today" && !!t.createdAt && t.createdAt < dateKey(new Date())
}

// Rewritten as four always-visible period sections instead of one widget
// with a tab switcher that hides everything else — the tabs made it look
// like tasks from other periods had vanished, and having the same widget
// duplicated side by side (as TasksPage used to) was actively confusing
// since both copies showed the exact same data.
export function TaskListWidget() {
  const tasks = useAppStore((s) => s.tasks)
  const setTasks = useAppStore((s) => s.setTasks)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState("")
  const [editTime, setEditTime] = useState("")

  function toggle(id: string) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
    saveData()
  }
  function remove(id: string) {
    const t = tasks.find((x) => x.id === id)
    const label = t ? (t.text.length > 60 ? t.text.slice(0, 60) + "…" : t.text) : "эту задачу"
    if (!confirm(`Удалить задачу «${label}»?`)) return
    setTasks((prev) => prev.filter((x) => x.id !== id))
    deleteFromCloud("tasks", id)
    saveData()
  }
  function startEdit(t: Task) {
    setEditingId(t.id)
    setEditText(t.text)
    setEditTime(t.time || "")
  }
  function saveEdit(id: string) {
    const text = editText.trim()
    if (!text) { setEditingId(null); return }
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, text, time: editTime.trim() } : t)))
    saveData()
    setEditingId(null)
  }
  function addTask(period: TaskPeriod, raw: string) {
    const val = raw.trim()
    if (!val) return
    const timeMatch = val.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)
    let time = ""
    let text = val
    if (timeMatch) {
      time = timeMatch[0]
      text = val.replace(timeMatch[0], "").trim()
    } else {
      const now = new Date()
      time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    }
    const t: Task = { id: randId(), text, time, done: false, period, createdAt: dateKey(new Date()) }
    setTasks((prev) => [...prev, t])
    saveData()
  }

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
      {PERIODS.map((period) => (
        <PeriodSection
          key={period}
          period={period}
          tasks={tasks.filter((t) => (t.period || "today") === period)}
          editingId={editingId}
          editText={editText}
          editTime={editTime}
          onEditText={setEditText}
          onEditTime={setEditTime}
          onToggle={toggle}
          onStartEdit={startEdit}
          onSaveEdit={saveEdit}
          onCancelEdit={() => setEditingId(null)}
          onDelete={remove}
          onAdd={(text) => addTask(period, text)}
        />
      ))}
    </div>
  )
}

function PeriodSection({
  period,
  tasks,
  editingId,
  editText,
  editTime,
  onEditText,
  onEditTime,
  onToggle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onAdd,
}: {
  period: TaskPeriod
  tasks: Task[]
  editingId: string | null
  editText: string
  editTime: string
  onEditText: (v: string) => void
  onEditTime: (v: string) => void
  onToggle: (id: string) => void
  onStartEdit: (t: Task) => void
  onSaveEdit: (id: string) => void
  onCancelEdit: () => void
  onDelete: (id: string) => void
  onAdd: (text: string) => void
}) {
  const [newText, setNewText] = useState("")
  const [doneOpen, setDoneOpen] = useState(false)
  const active = tasks.filter((t) => !t.done)
  const done = tasks.filter((t) => t.done)

  function submitAdd() {
    onAdd(newText)
    setNewText("")
  }

  return (
    <div className="glass-surface flex flex-col rounded-xl p-4.5" style={{ minHeight: 260 }}>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[14px] font-bold">{PERIOD_LABELS[period]}</div>
        <span className="text-[11px] font-bold text-muted-foreground">{active.length} активных</span>
      </div>

      <div className="flex flex-col gap-1">
        {active.length === 0 && <div className="py-6 text-center text-[12.5px] text-muted-foreground">Нет активных задач</div>}
        {active.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            editing={editingId === t.id}
            editText={editText}
            editTime={editTime}
            onEditText={onEditText}
            onEditTime={onEditTime}
            onToggle={() => onToggle(t.id)}
            onStartEdit={() => onStartEdit(t)}
            onSaveEdit={() => onSaveEdit(t.id)}
            onCancelEdit={onCancelEdit}
            onDelete={() => onDelete(t.id)}
            overdue={isTaskOverdue(t)}
          />
        ))}
      </div>

      {done.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <button type="button" onClick={() => setDoneOpen((v) => !v)} className="flex w-full items-center justify-between text-[11.5px] font-bold text-muted-foreground">
            Выполнено — {done.length}
            <ChevronDown className={cn("size-3.5 transition-transform", doneOpen && "rotate-180")} />
          </button>
          {doneOpen && (
            <div className="mt-1.5 flex flex-col gap-1">
              {done.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  editing={editingId === t.id}
                  editText={editText}
                  editTime={editTime}
                  onEditText={onEditText}
                  onEditTime={onEditTime}
                  onToggle={() => onToggle(t.id)}
                  onStartEdit={() => onStartEdit(t)}
                  onSaveEdit={() => onSaveEdit(t.id)}
                  onCancelEdit={onCancelEdit}
                  onDelete={() => onDelete(t.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 border-t border-border pt-3">
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitAdd() } }}
          placeholder="+ Добавить задачу... (Enter)"
          rows={1}
          className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[12.5px] outline-none focus:border-ring"
        />
      </div>
    </div>
  )
}

function TaskRow({
  task,
  editing,
  editText,
  editTime,
  onEditText,
  onEditTime,
  onToggle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  overdue,
}: {
  task: Task
  editing: boolean
  editText: string
  editTime: string
  onEditText: (v: string) => void
  onEditTime: (v: string) => void
  onToggle: () => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
  overdue?: boolean
}) {
  if (editing) {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-muted px-2 py-1.5">
        <button type="button" onClick={onToggle} className={cn("mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-md border", task.done ? "border-emphasis bg-emphasis/90 text-emphasis-foreground" : "border-border")}>
          {task.done && <Check className="size-3" strokeWidth={3} />}
        </button>
        <textarea
          value={editText}
          onChange={(e) => onEditText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSaveEdit() } if (e.key === "Escape") onCancelEdit() }}
          rows={1}
          autoFocus
          className="flex-1 resize-none rounded-md border border-border bg-background px-2 py-1 text-[13px] outline-none"
        />
        <input
          value={editTime}
          onChange={(e) => onEditTime(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(); if (e.key === "Escape") onCancelEdit() }}
          placeholder="Время"
          className="w-16 rounded-md border border-border bg-background px-1.5 py-1 text-[12px] outline-none"
        />
        <button type="button" onClick={onSaveEdit} className="mt-0.5 text-emphasis"><Check className="size-4" /></button>
      </div>
    )
  }
  return (
    <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
      <button type="button" onClick={onToggle} className={cn("flex size-4.5 shrink-0 items-center justify-center rounded-md border", task.done ? "border-emphasis bg-emphasis/90 text-emphasis-foreground" : "border-border")}>
        {task.done && <Check className="size-3" strokeWidth={3} />}
      </button>
      <span onClick={onStartEdit} className={cn("flex-1 cursor-pointer text-[13px]", task.done && "text-muted-foreground line-through")}>
        {overdue && "⏰ "}{task.text}
      </span>
      {task.time && <span className="text-[11px] font-semibold text-muted-foreground">{task.time}</span>}
      <button type="button" onClick={onStartEdit} className="opacity-0 group-hover:opacity-100"><Pencil className="size-3.5 text-muted-foreground" /></button>
      <button type="button" onClick={onDelete} className="opacity-0 group-hover:opacity-100"><Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" /></button>
    </div>
  )
}
