import { useState } from "react"
import { Plus, Trash2, Check } from "lucide-react"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { deleteFromCloud } from "@/lib/cloudSync"
import { dateKey } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Task, TaskPeriod } from "@/types/models"

function randId() {
  return "t" + Math.random().toString(36).slice(2, 11)
}

const UPCOMING_LABELS: Record<TaskPeriod, string> = { today: "Сегодня", week: "Неделя", month: "Месяц", year: "Год" }

export function TasksMiniWidget() {
  const tasks = useAppStore((s) => s.tasks)
  const setTasks = useAppStore((s) => s.setTasks)
  const [text, setText] = useState("")

  const today = tasks.filter((t) => (t.period || "today") === "today")
  const active = today.filter((t) => !t.done)
  const upcoming = tasks.filter((t) => (t.period || "today") !== "today" && !t.done).slice(0, 4)

  function addTask() {
    const v = text.trim()
    if (!v) return
    const t: Task = { id: randId(), text: v, time: "", done: false, period: "today", createdAt: dateKey(new Date()) }
    setTasks((prev) => [...prev, t])
    saveData()
    setText("")
  }

  function toggle(id: string) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
    saveData()
  }

  function remove(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    deleteFromCloud("tasks", id)
    saveData()
  }

  return (
    <div className="glass-surface flex h-full flex-col rounded-xl p-4.5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[14px] font-bold">Задачи: сегодня</div>
        <span className="text-[11px] font-bold text-muted-foreground">{active.length} активных</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {today.length === 0 && <div className="py-6 text-center text-[12.5px] text-muted-foreground">Нет активных задач</div>}
        {today.map((t) => (
          <div key={t.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
            <button
              type="button"
              onClick={() => toggle(t.id)}
              className={cn(
                "flex size-4.5 shrink-0 items-center justify-center rounded-md border",
                t.done ? "border-emphasis bg-emphasis/90 text-emphasis-foreground" : "border-border"
              )}
            >
              {t.done && <Check className="size-3" strokeWidth={3} />}
            </button>
            <span className={cn("min-w-0 flex-1 truncate text-[13px]", t.done && "text-muted-foreground line-through")}>{t.text}</span>
            <button type="button" onClick={() => remove(t.id)} className="opacity-0 group-hover:opacity-100">
              <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex shrink-0 gap-1.5 border-t border-border pt-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          placeholder="Новая задача..."
          className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 text-[12.5px] outline-none focus:border-ring"
        />
        <button type="button" onClick={addTask} className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted">
          <Plus className="size-4" />
        </button>
      </div>

      {upcoming.length > 0 && (
        <div className="mt-3.5 shrink-0 border-t border-border pt-3.5">
          <div className="mb-1.5 text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">Скоро</div>
          <div className="flex flex-col gap-1">
            {upcoming.map((t) => (
              <div key={t.id} className="flex items-center gap-2 px-2 py-1 text-[12.5px]">
                <span className="shrink-0 rounded-md bg-overlay/10 px-1.5 py-0.5 text-[10px] font-bold text-foreground/70">{UPCOMING_LABELS[t.period || "today"]}</span>
                <span className="min-w-0 flex-1 truncate text-foreground/85">{t.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
