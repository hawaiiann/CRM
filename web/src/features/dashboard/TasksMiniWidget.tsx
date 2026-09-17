import { useState } from "react"
import { Plus, Trash2, Check, ChevronDown } from "lucide-react"
import { Link } from "react-router-dom"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { deleteFromCloud } from "@/lib/cloudSync"
import { dateKey } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Linkified } from "@/components/ui/linkified"
import { confirmDialog } from "@/store/useDialogStore"
import type { Task, TaskPeriod } from "@/types/models"

function randId() {
  return "t" + Math.random().toString(36).slice(2, 11)
}

const UPCOMING_LABELS: Record<TaskPeriod, string> = { today: "Сегодня", week: "Неделя", month: "Месяц", year: "Год" }

/**
 * Задачи на «Сегодня». Активные — сверху, выполненные свёрнуты в одну строку
 * (раньше они висели зачёркнутыми в общем списке и занимали половину
 * виджета). Ссылки в тексте — кликабельные чипы, кнопка добавления —
 * акцентная и включается, когда есть что добавить.
 */
export function TasksMiniWidget() {
  const tasks = useAppStore((s) => s.tasks)
  const setTasks = useAppStore((s) => s.setTasks)
  const [text, setText] = useState("")
  const [doneOpen, setDoneOpen] = useState(false)

  const today = dateKey(new Date())
  const todayTasks = tasks.filter((t) => (t.period || "today") === "today")
  const active = todayTasks.filter((t) => !t.done)
  const done = todayTasks.filter((t) => t.done)
  const upcoming = tasks.filter((t) => (t.period || "today") !== "today" && !t.done).slice(0, 4)

  function addTask() {
    const v = text.trim()
    if (!v) return
    const t: Task = { id: randId(), text: v, time: "", done: false, period: "today", createdAt: today }
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

  async function clearDone() {
    const ok = await confirmDialog({
      title: "Убрать выполненные задачи?",
      body: `${done.length} ${done.length === 1 ? "задача" : done.length < 5 ? "задачи" : "задач"} будут удалены насовсем.`,
      confirmLabel: "Убрать",
      destructive: true,
    })
    if (!ok) return
    const ids = done.map((t) => t.id)
    setTasks((prev) => prev.filter((t) => !ids.includes(t.id)))
    ids.forEach((id) => deleteFromCloud("tasks", id))
    saveData()
  }

  return (
    <div className="glass-surface flex flex-col rounded-xl p-4.5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-base font-bold">Задачи</div>
        <div className="flex items-center gap-2.5 text-2xs font-bold text-muted-foreground">
          {active.length > 0 && <span>{active.length} активных</span>}
          <Link to="/tasks" className="hover:text-foreground hover:underline">Все задачи</Link>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {active.length === 0 && <div className="py-5 text-center text-sm text-muted-foreground">На сегодня задач нет</div>}
        {active.map((t) => {
          const overdue = !!t.createdAt && t.createdAt < today
          return (
            <div key={t.id} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
              <button
                type="button"
                onClick={() => toggle(t.id)}
                title="Выполнено"
                className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-md border border-border hover:border-emphasis"
              />
              <div className="min-w-0 flex-1 text-sm leading-snug break-words">
                {overdue && <span className="mr-1 text-2xs font-bold text-destructive" title={`Со дня ${t.createdAt}`}>⏰</span>}
                <Linkified text={t.text} />
              </div>
              <button type="button" onClick={() => remove(t.id)} className="mt-0.5 opacity-0 group-hover:opacity-100" title="Удалить">
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          )
        })}
      </div>

      {done.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
            <button type="button" onClick={() => setDoneOpen((v) => !v)} className="flex items-center gap-1 hover:text-foreground">
              Выполнено — {done.length}
              <ChevronDown className={cn("size-3.5 transition-transform", doneOpen && "rotate-180")} />
            </button>
            <button type="button" onClick={clearDone} className="hover:text-destructive">Убрать</button>
          </div>
          {doneOpen && (
            <div className="mt-1 flex flex-col gap-0.5">
              {done.map((t) => (
                <div key={t.id} className="group flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-muted">
                  <button type="button" onClick={() => toggle(t.id)} title="Вернуть" className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-md border border-emphasis bg-emphasis/90 text-emphasis-foreground">
                    <Check className="size-3" strokeWidth={3} />
                  </button>
                  <div className="min-w-0 flex-1 text-sm leading-snug break-words text-muted-foreground line-through"><Linkified text={t.text} /></div>
                  <button type="button" onClick={() => remove(t.id)} className="mt-0.5 opacity-0 group-hover:opacity-100" title="Удалить">
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex shrink-0 gap-1.5 border-t border-border pt-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          placeholder="Новая задача… (Enter)"
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-ring"
        />
        <button
          type="button"
          onClick={addTask}
          disabled={!text.trim()}
          title="Добавить"
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-cta/90 text-cta-foreground hover:bg-cta disabled:cursor-default disabled:bg-muted disabled:text-muted-foreground"
        >
          <Plus className="size-4" strokeWidth={2.5} />
        </button>
      </div>

      {upcoming.length > 0 && (
        <div className="mt-3.5 shrink-0 border-t border-border pt-3.5">
          <div className="mb-1.5 text-2xs font-extrabold tracking-wide text-muted-foreground uppercase">Скоро</div>
          <div className="flex flex-col gap-1">
            {upcoming.map((t) => (
              <div key={t.id} className="flex items-start gap-2 px-2 py-1 text-sm">
                <span className="mt-px shrink-0 rounded-md bg-overlay/10 px-1.5 py-0.5 text-2xs font-bold text-foreground/70">{UPCOMING_LABELS[t.period || "today"]}</span>
                <div className="min-w-0 flex-1 leading-snug break-words text-foreground/85"><Linkified text={t.text} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
