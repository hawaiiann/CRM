import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { PageHeader } from "@/components/layout/AppShell"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/useAppStore"
import { addDays, dateKey } from "@/lib/money"
import { cn } from "@/lib/utils"
import { OrderDetailsSheet } from "@/features/orders/OrderDetailsSheet"
import { OrderFormDialog } from "@/features/orders/OrderFormDialog"
import type { Order } from "@/types/models"

type TlMode = "1w" | "2w" | "1m"

function daysBetween(a: Date, b: Date): number {
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86400000)
}
function parseLocalDate(str: string): Date | null {
  if (!str) return null
  const parts = str.split("-").map(Number)
  if (parts.length < 3 || parts.some(isNaN)) return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}

const WEEKDAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]
const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

export function TimelinePage() {
  const orders = useAppStore((s) => s.orders)
  const [mode, setMode] = useState<TlMode>("2w")
  const [anchor, setAnchor] = useState(new Date())
  const [hideDone, setHideDone] = useState(false)
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)

  const days = useMemo(() => {
    const start = new Date(anchor)
    start.setHours(0, 0, 0, 0)
    if (mode === "1m") {
      const monthStart = new Date(start.getFullYear(), start.getMonth(), 1)
      const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
      return Array.from({ length: daysInMonth }, (_, i) => addDays(monthStart, i))
    }
    const totalDays = mode === "1w" ? 7 : 14
    const dow = (start.getDay() + 6) % 7
    start.setDate(start.getDate() - dow)
    return Array.from({ length: totalDays }, (_, i) => addDays(start, i))
  }, [mode, anchor])

  function navigate(dir: number) {
    if (dir === 0) { setAnchor(new Date()); return }
    if (mode === "1m") setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1))
    else setAnchor((a) => addDays(a, dir * (mode === "1w" ? 7 : 14)))
  }

  const rangeStart = days[0]
  const rangeEnd = days[days.length - 1]
  const todayStr = dateKey(new Date())

  const rows = useMemo(() => {
    let active = orders.filter((o) => o.status !== "cancelled" && (!hideDone || o.status !== "done") && o.start && o.deadline)
    active = active.slice().sort((a, b) => {
      const startCmp = a.start.localeCompare(b.start)
      if (startCmp !== 0) return startCmp
      const seqA = [a.subject || "", a.grade || "", a.quarter || ""].join("|")
      const seqB = [b.subject || "", b.grade || "", b.quarter || ""].join("|")
      if (seqA !== seqB) return seqA.localeCompare(seqB)
      const lessonA = Number(a.lesson), lessonB = Number(b.lesson)
      if (lessonA && lessonB && lessonA !== lessonB) return lessonA - lessonB
      const deadlineCmp = (a.deadline || "").localeCompare(b.deadline || "")
      if (deadlineCmp !== 0) return deadlineCmp
      return (a.createdAt || 0) - (b.createdAt || 0)
    })
    for (let i = 1; i < active.length; i++) {
      if (!active[i].priority) continue
      let j = i
      while (j > 0 && !active[j - 1].priority && active[j - 1].status !== "done") {
        ;[active[j - 1], active[j]] = [active[j], active[j - 1]]
        j--
      }
    }
    return active.filter((o) => {
      const s = parseLocalDate(o.start)
      const e = parseLocalDate(o.deadline)
      return e && s && e >= rangeStart && s <= rangeEnd
    })
  }, [orders, hideDone, rangeStart, rangeEnd])

  const colWidth = mode === "1m" ? 56 : undefined
  const totalRangeDays = days.length

  return (
    <div>
      <PageHeader
        title="Таймлайн"
        subtitle="Визуализация нахлеста и параллельных заказов"
        actions={
          <Button onClick={() => { setEditingOrder(null); setFormOpen(true) }} className="bg-emphasis/90 font-extrabold text-emphasis-foreground hover:bg-emphasis">
            <Plus />
            Новый заказ
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-0.5 rounded-[10px] bg-muted p-[3px]">
          {(["1w", "2w", "1m"] as TlMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold transition-colors",
                mode === m ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "1w" ? "1 неделя" : m === "2w" ? "2 недели" : "Месяц"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => navigate(-1)}><ChevronLeft /></Button>
          <div className="min-w-[130px] text-center text-[12.5px] font-bold">
            {rangeStart.getDate()} {MONTH_SHORT[rangeStart.getMonth()]} — {rangeEnd.getDate()} {MONTH_SHORT[rangeEnd.getMonth()]}
          </div>
          <Button variant="outline" size="icon-sm" onClick={() => navigate(1)}><ChevronRight /></Button>
          <Button variant="outline" size="sm" onClick={() => navigate(0)}>Сегодня</Button>
          <Button variant={hideDone ? "default" : "outline"} size="sm" onClick={() => setHideDone((v) => !v)}>
            {hideDone ? "Показать завершённые" : "Скрыть завершённые"}
          </Button>
        </div>
      </div>

      <div className="glass-surface rounded-xl p-3">
        <div className={cn("overflow-x-auto", mode === "1m" && "overflow-x-auto")}>
          <div style={{ width: colWidth ? colWidth * days.length : "100%", minWidth: "100%" }}>
            <div className="mb-2 grid" style={{ gridTemplateColumns: `repeat(${days.length}, ${colWidth ? colWidth + "px" : "1fr"})` }}>
              {days.map((d, i) => {
                const isWknd = d.getDay() === 0 || d.getDay() === 6
                const isToday = dateKey(d) === todayStr
                return (
                  <div key={i} className={cn("py-1.5 text-center text-[10.5px] font-semibold", isWknd && "text-muted-foreground", isToday && "rounded-md bg-emphasis text-emphasis-foreground")}>
                    {WEEKDAY_SHORT[d.getDay()]}<br /><b className="font-heading text-[12px]">{d.getDate()}</b>
                  </div>
                )
              })}
            </div>

            {rows.length === 0 && <div className="py-10 text-center text-[13px] text-muted-foreground">Нет заказов в этом периоде</div>}

            <div className="flex flex-col gap-1.5">
              {rows.map((o) => {
                const oStart = parseLocalDate(o.start)!
                const oEnd = parseLocalDate(o.deadline)!
                const offsetDays = Math.max(0, daysBetween(rangeStart, oStart))
                const durationDays = daysBetween(oStart < rangeStart ? rangeStart : oStart, oEnd > rangeEnd ? rangeEnd : oEnd) + 1
                const leftPct = (offsetDays / totalRangeDays) * 100
                const widthPct = Math.min((durationDays / totalRangeDays) * 100, 100 - leftPct)
                const title = o.title || [o.subject, o.grade, o.quarter, o.lesson && `Урок ${o.lesson}`].filter(Boolean).join(", ") || "Без названия"

                return (
                  <div key={o.id} className="relative h-9">
                    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
                      {days.map((d, i) => (
                        <div key={i} className={cn("border-r border-border/60 last:border-r-0", (d.getDay() === 0 || d.getDay() === 6) && "bg-muted/40", dateKey(d) === todayStr && "bg-overlay/8")} />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveOrder(o)}
                      title={title}
                      className={cn(
                        "absolute top-0.5 flex h-8 items-center gap-1.5 overflow-hidden rounded-md px-2.5 text-[11.5px] font-bold whitespace-nowrap",
                        STATUS_BG[o.status],
                        o.priority && "ring-2 ring-destructive"
                      )}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    >
                      <span className="truncate">{title}</span>
                      <span className="shrink-0 opacity-70">{o.lines.length} поз.</span>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <OrderDetailsSheet
        order={activeOrder}
        onOpenChange={(open) => !open && setActiveOrder(null)}
        onEdit={(o) => { setActiveOrder(null); setEditingOrder(o); setFormOpen(true) }}
      />
      <OrderFormDialog open={formOpen} editingOrder={editingOrder} duplicateFrom={null} onOpenChange={setFormOpen} />
    </div>
  )
}

const STATUS_BG: Record<Order["status"], string> = {
  queue: "bg-neutral-tone text-neutral-tone-foreground",
  progress: "bg-warning text-warning-foreground",
  review: "bg-overlay/20 text-foreground/90",
  done: "bg-success text-success-foreground",
  cancelled: "bg-destructive/10 text-destructive",
}
