import { useMemo, useState } from "react"
import { useAppStore } from "@/store/useAppStore"
import { fmtHours, dateKey } from "@/lib/money"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"

const WEEKDAY_LABELS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"]
const MONTH_NAMES_FULL = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
const MONTH_SHORT_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

function monthOptions() {
  const now = new Date()
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return { value: `${d.getFullYear()}-${d.getMonth()}`, label: `${MONTH_NAMES_FULL[d.getMonth()]} ${d.getFullYear()}` }
  })
}

export function ActiveDaysCalendar() {
  const activityLog = useAppStore((s) => s.activityLog)
  const options = useMemo(() => monthOptions(), [])
  const [monthValue, setMonthValue] = useState(options[0].value)
  const [openDay, setOpenDay] = useState<string | null>(null)

  const [yearStr, monthStr] = monthValue.split("-")
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const todayStr = dateKey(new Date())
  const activeDatesSet = useMemo(() => new Set(activityLog.map((e) => e.date)), [activityLog])

  const firstOfMonth = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7

  type Cell = { num: number; outside: boolean; dateStr?: string; isToday?: boolean; isActive?: boolean }
  const cells: Cell[] = []
  for (let i = firstWeekday - 1; i >= 0; i--) cells.push({ num: daysInPrevMonth - i, outside: true })
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    cells.push({ num: d, outside: false, dateStr: ds, isToday: ds === todayStr, isActive: activeDatesSet.has(ds) })
  }
  let nextMonthDay = 1
  while (cells.length < 42) { cells.push({ num: nextMonthDay, outside: true }); nextMonthDay++ }

  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`
  const activeDaysInMonth = new Set(activityLog.filter((e) => e.date.startsWith(monthPrefix)).map((e) => e.date)).size
  const hoursInMonth = activityLog.filter((e) => e.field === "hours" && e.date.startsWith(monthPrefix)).reduce((s, e) => s + e.delta, 0)

  const dayEntries = openDay ? activityLog.filter((e) => e.date === openDay) : []
  const hoursForDay = dayEntries.reduce((s, e) => s + e.delta, 0)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[16px] font-bold">Активные дни</h3>
        <Select value={monthValue} onValueChange={(v) => { setMonthValue(v); setOpenDay(null) }}>
          <SelectTrigger size="sm" className="w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-muted-foreground">
        {WEEKDAY_LABELS.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c, i) => (
          <button
            key={i}
            type="button"
            disabled={c.outside || !c.isActive}
            onClick={() => c.dateStr && setOpenDay((d) => (d === c.dateStr ? null : c.dateStr!))}
            className={cn(
              "flex aspect-square items-center justify-center rounded-md text-[11px] font-semibold",
              c.outside && "text-muted-foreground/40",
              !c.outside && !c.isActive && "text-muted-foreground",
              !c.outside && c.isActive && !c.isToday && "cursor-pointer bg-overlay/14 text-foreground/90",
              c.isToday && "bg-emphasis text-emphasis-foreground",
              openDay === c.dateStr && "ring-2 ring-overlay/40"
            )}
          >
            {c.num}
          </button>
        ))}
      </div>

      <div className="mt-4 flex gap-6 border-t border-border pt-3.5">
        <div>
          <div className="font-heading text-[23px] font-bold">{activeDaysInMonth}</div>
          <div className="text-[11px] text-muted-foreground">активных дней</div>
        </div>
        <div>
          <div className="font-heading text-[23px] font-bold">{fmtHours(hoursInMonth)}</div>
          <div className="text-[11px] text-muted-foreground">за месяц</div>
        </div>
      </div>

      {openDay && (
        <div className="mt-3 rounded-xl bg-muted px-3.5 py-3">
          <div className="mb-1 flex items-center justify-between">
            <b className="text-[12.5px]">{formatDayLabel(openDay)}</b>
            <button type="button" onClick={() => setOpenDay(null)} className="text-[11px] text-muted-foreground">Закрыть ✕</button>
          </div>
          {dayEntries.length ? (
            <div className="flex justify-between py-1 text-[12.5px]">
              <span className="text-muted-foreground">Часы</span>
              <b>{fmtHours(hoursForDay)}</b>
            </div>
          ) : (
            <div className="text-[12px] text-muted-foreground">Нет записей</div>
          )}
        </div>
      )}
    </div>
  )
}

function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return `${d} ${MONTH_SHORT_RU[m - 1]} ${y}`
}
