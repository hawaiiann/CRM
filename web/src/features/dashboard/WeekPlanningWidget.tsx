import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { useAppStore } from "@/store/useAppStore"
import { dateKey, addDays } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Order } from "@/types/models"

const WEEKDAY_LABELS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"]

function orderWeekLabel(o: Order): string {
  if (o.subject && o.grade && o.lesson) {
    return [o.subject, o.grade, o.quarter, "Урок " + o.lesson].filter(Boolean).join(", ")
  }
  return o.title || "Заказ"
}

// Monochrome throughout — state reads by shade of white, not hue.
const STATUS_BAR_STYLE: Record<Order["status"], string> = {
  queue: "bg-overlay/10 text-foreground/70",
  progress: "bg-emphasis/88 text-emphasis-foreground",
  review: "bg-overlay/20 text-foreground/90",
  done: "bg-overlay/10 text-foreground/45",
  cancelled: "bg-overlay/5 text-foreground/35",
}

export function WeekPlanningWidget() {
  const orders = useAppStore((s) => s.orders)
  const [showDone, setShowDone] = useState(false)

  const today = new Date()
  const dayOfWeek = (today.getDay() + 6) % 7
  const monday = addDays(today, -dayOfWeek)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const weekStartKey = dateKey(weekDays[0])
  const weekEndKey = dateKey(weekDays[6])
  const todayKey = dateKey(today)

  const allWeekOrders = orders
    .filter((o) => {
      if (o.status === "cancelled") return false
      const startStr = o.start || o.deadline
      const endStr = o.deadline || o.start
      if (!startStr && !endStr) return false
      return startStr <= weekEndKey && endStr >= weekStartKey
    })
    .sort((a, b) => (a.start || a.deadline || "").localeCompare(b.start || b.deadline || ""))

  const doneCount = allWeekOrders.filter((o) => o.status === "done").length
  const weekOrders = showDone ? allWeekOrders : allWeekOrders.filter((o) => o.status !== "done")

  function dayIndex(dateStr: string) {
    return Math.round((new Date(dateStr).getTime() - new Date(weekStartKey).getTime()) / 86400000)
  }

  return (
    <div>
      <div className="mb-2.5 grid grid-cols-7 gap-1">
        {weekDays.map((d, i) => {
          const isToday = dateKey(d) === todayKey
          return (
            <div key={i} className={cn("rounded-lg py-1.5 text-center", isToday && "bg-emphasis")}>
              <div className={cn("text-[9.5px] font-bold tracking-wide", isToday ? "text-emphasis-foreground" : "text-muted-foreground")}>{WEEKDAY_LABELS[i]}</div>
              <div className={cn("mt-0.5 font-heading text-[12px] font-bold", isToday ? "text-emphasis-foreground" : "text-muted-foreground")}>{d.getDate()}</div>
            </div>
          )
        })}
      </div>

      <div className="flex max-h-[150px] flex-col gap-1.5 overflow-y-auto">
        {weekOrders.length === 0 && <div className="py-2 text-[12.5px] text-muted-foreground">На этой неделе заказов нет</div>}
        {weekOrders.map((o) => {
          const startStr = o.start || o.deadline
          const endStr = o.deadline || o.start
          const startCol = Math.max(1, Math.min(7, dayIndex(startStr) + 1))
          const endCol = Math.max(1, Math.min(7, dayIndex(endStr) + 1))
          const span = Math.max(1, endCol - startCol + 1)
          return (
            <div key={o.id} className="grid grid-cols-7 gap-1">
              <div
                title={orderWeekLabel(o)}
                className={cn("truncate rounded-md px-2 py-1.5 text-[10.5px] font-bold", STATUS_BAR_STYLE[o.status])}
                style={{ gridColumn: `${startCol} / span ${span}` }}
              >
                {orderWeekLabel(o)}
              </div>
            </div>
          )
        })}
      </div>

      {doneCount > 0 && (
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className="mx-auto mt-2 flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-bold text-muted-foreground"
        >
          {showDone ? "Скрыть завершённые" : "Показать завершённые"}
          {!showDone && <span className="rounded-full bg-overlay/20 px-1.5 text-foreground">{doneCount}</span>}
          <ChevronDown className={cn("size-3 transition-transform", showDone && "rotate-180")} />
        </button>
      )}
    </div>
  )
}
