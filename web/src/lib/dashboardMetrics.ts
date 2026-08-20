import type { Order, Advance, ActivityLogEntry, DashboardMetric } from "@/types/models"
import { parseNum, dateKey, addDays, orderTotal, orderBaseTotal, orderPayments } from "./money"

/* Ported from js/app.js */
export interface MetricTypeInfo {
  label: string
  unit: string
  activityField: string
  cumulative?: boolean
  secondary?: { label: string; unit: string; activityField: string; cumulative?: boolean }
}

export const DASHBOARD_METRIC_TYPES: Record<string, MetricTypeInfo> = {
  hours: { label: "Часы", unit: "ч", activityField: "hours" },
  presentations: {
    label: "Презентации", unit: "шт.", activityField: "presentations", cumulative: true,
    secondary: { label: "слайдов", unit: "шт.", activityField: "slides", cumulative: true },
  },
  worksheets: {
    label: "Рабочие листы", unit: "шт.", activityField: "worksheets", cumulative: true,
    secondary: { label: "страниц", unit: "шт.", activityField: "pages", cumulative: true },
  },
  revenue: {
    label: "Выручка", unit: "₽", activityField: "revenue",
    secondary: { label: "чистыми", unit: "₽", activityField: "netRevenue" },
  },
}

export const DASHBOARD_METRIC_COLORS_LIGHT = ["#7CB518", "#F5A623", "#2E7BF6", "#E4483F", "#0E9AA7"]
export const DASHBOARD_METRIC_COLORS_DARK = ["#A8E10C", "#F2B84D", "#4C9AFF", "#FF6259", "#3BC9DB"]

/* ---------- Ported from js/stats.js: revenue/count derived from orders, not the journal ---------- */

function splitLineTypes(lines: Order["lines"]) {
  let presentations = 0, worksheets = 0
  ;(lines || []).forEach((l) => {
    const label = (l.label || "").toLowerCase()
    if (label.includes("презентац")) presentations++
    else if (label.includes("рабочий лист") || label.includes("карточ")) worksheets++
  })
  return { presentations, worksheets }
}
function splitLineUnits(lines: Order["lines"]) {
  let slides = 0, pages = 0
  ;(lines || []).forEach((l) => {
    const label = (l.label || "").toLowerCase()
    const qty = parseNum(l.qty)
    if (label.includes("презентац")) slides += qty
    else if (label.includes("рабочий лист") || label.includes("карточ")) pages += qty
  })
  return { slides, pages }
}

function advanceDateForClient(advances: Advance[], client: string): string | null {
  const list = advances.filter((a) => a.client === client && a.date).sort((a, b) => (a.date < b.date ? -1 : 1))
  return list.length ? list[0].date : null
}
function orderContributionDate(o: Order): string {
  return o.start || o.deadline || (o.createdAt ? dateKey(new Date(o.createdAt)) : dateKey(new Date()))
}

interface RevenueEvent { date: string; orderId: string; revenue: number; net: number }

function revenueEventsForOrder(o: Order, advances: Advance[]): RevenueEvent[] {
  const events: RevenueEvent[] = []
  const fullExact = orderTotal(o)
  const full = Math.round(fullExact)
  const base = orderBaseTotal(o)
  if (full <= 0) return events

  const advUsed = Math.min(parseNum(o.advanceUsed), full)
  const netForAdvance = fullExact > 0 ? advUsed * (base / fullExact) : 0
  if (advUsed > 0) {
    events.push({
      date: advanceDateForClient(advances, o.client) || orderContributionDate(o),
      orderId: o.id,
      revenue: Math.round(advUsed * 100) / 100,
      net: Math.round(netForAdvance * 100) / 100,
    })
  }

  let room = Math.max(0, full - advUsed)
  orderPayments(o).forEach((p) => {
    if (room <= 0) return
    const amount = Math.min(parseNum(p.amount), room)
    if (amount <= 0) return
    room -= amount
    const netForMoney = fullExact > 0 ? amount * (base / fullExact) : 0
    events.push({
      date: p.date || o.deadline || orderContributionDate(o),
      orderId: o.id,
      revenue: Math.round(amount * 100) / 100,
      net: Math.round(netForMoney * 100) / 100,
    })
  })
  return events
}

function revenueEvents(orders: Order[], advances: Advance[]): RevenueEvent[] {
  const all: RevenueEvent[] = []
  orders.forEach((o) => revenueEventsForOrder(o, advances).forEach((e) => all.push(e)))
  return all
}

function countEvents(orders: Order[]) {
  return orders.map((o) => {
    const types = splitLineTypes(o.lines)
    const units = splitLineUnits(o.lines)
    return { date: orderContributionDate(o), orderId: o.id, ...types, ...units }
  })
}

// Recognized revenue for a single order "right now" — advance + money received,
// capped at the order's full price. Same rule as orderRecognizedRevenue in utils.js.
export function orderRecognizedRevenue(o: Order): { revenue: number; net: number } {
  const base = orderBaseTotal(o)
  const fullExact = orderTotal(o)
  const full = Math.round(fullExact)
  const advUsed = Math.min(parseNum(o.advanceUsed), full)
  const paid = orderPayments(o).reduce((s, p) => s + parseNum(p.amount), 0)
  const paidCapped = Math.min(paid, Math.max(0, full - advUsed))
  const covered = advUsed + paidCapped
  if (covered <= 0) return { revenue: 0, net: 0 }
  if (covered >= full) return { revenue: full, net: Math.round(base) }
  const net = fullExact > 0 ? covered * (base / fullExact) : 0
  return { revenue: Math.round(covered * 100) / 100, net: Math.round(net * 100) / 100 }
}

const DERIVED_METRIC_SOURCES: Record<string, { from: "revenue" | "counts"; field: string; cumulative: boolean }> = {
  revenue: { from: "revenue", field: "revenue", cumulative: false },
  netRevenue: { from: "revenue", field: "net", cumulative: false },
  presentations: { from: "counts", field: "presentations", cumulative: true },
  worksheets: { from: "counts", field: "worksheets", cumulative: true },
  slides: { from: "counts", field: "slides", cumulative: true },
  pages: { from: "counts", field: "pages", cumulative: true },
}

export function isDerivedMetric(field: string) {
  return Object.prototype.hasOwnProperty.call(DERIVED_METRIC_SOURCES, field)
}

export interface BucketRange { start: Date; end: Date }

export function computeDerivedSeries(field: string, ranges: BucketRange[], orders: Order[], advances: Advance[]): number[] {
  const src = DERIVED_METRIC_SOURCES[field]
  if (!src) return ranges.map(() => 0)

  const events: { date: string; presentations?: number; worksheets?: number; slides?: number; pages?: number; revenue?: number; net?: number }[] =
    src.from === "revenue" ? revenueEvents(orders, advances) : countEvents(orders)

  const bucketKeys = ranges.map((r) => ({ start: dateKey(r.start), end: dateKey(r.end) }))
  const buckets = ranges.map(() => 0)
  let carriedOver = 0

  events.forEach((e) => {
    const value = (e as unknown as Record<string, number | undefined>)[src.field] || 0
    if (!value) return
    if (src.cumulative && e.date < bucketKeys[0].start) { carriedOver += value; return }
    for (let i = 0; i < bucketKeys.length; i++) {
      if (e.date >= bucketKeys[i].start && e.date <= bucketKeys[i].end) { buckets[i] += value; break }
    }
  })

  if (!src.cumulative) return buckets.map((v) => Math.round(v * 100) / 100)
  let running = carriedOver
  return buckets.map((v) => { running += v; return Math.round(running * 100) / 100 })
}

/* ---------- Period bucketing (ported from js/overview.js) ---------- */

export type MetricPeriod = "day" | "week" | "month" | "year"

export function getPeriodStart(d: Date, period: MetricPeriod): Date {
  const dt = new Date(d)
  if (period === "week") {
    const day = dt.getDay()
    const diff = (day === 0 ? -6 : 1) - day
    return addDays(dt, diff)
  }
  if (period === "month") return new Date(dt.getFullYear(), dt.getMonth(), 1)
  if (period === "year") return new Date(dt.getFullYear(), 0, 1)
  return dt
}
function addPeriod(d: Date, period: MetricPeriod, n: number): Date {
  const dt = new Date(d)
  if (period === "week") return addDays(dt, n * 7)
  if (period === "month") { dt.setMonth(dt.getMonth() + n); return dt }
  if (period === "year") { dt.setFullYear(dt.getFullYear() + n); return dt }
  return addDays(dt, n)
}

const BUCKET_COUNTS: Record<MetricPeriod, number> = { day: 14, week: 10, month: 8, year: 5 }

export function getPeriodBucketRanges(period: MetricPeriod): BucketRange[] {
  const N = BUCKET_COUNTS[period]
  const curStart = getPeriodStart(new Date(), period)
  const ranges: BucketRange[] = []
  for (let i = N - 1; i >= 0; i--) {
    const bStart = addPeriod(curStart, period, -i)
    const bEndInclusive = addDays(addPeriod(bStart, period, 1), -1)
    ranges.push({ start: bStart, end: bEndInclusive })
  }
  return ranges
}

export function getMetricSeriesForPeriod(
  activityField: string, period: MetricPeriod, cumulative: boolean | undefined,
  orders: Order[], advances: Advance[], activityLog: ActivityLogEntry[]
): number[] {
  if (isDerivedMetric(activityField)) {
    return computeDerivedSeries(activityField, getPeriodBucketRanges(period), orders, advances)
  }

  const N = BUCKET_COUNTS[period]
  const curStart = getPeriodStart(new Date(), period)
  const buckets: number[] = []
  let runningTotal = 0
  if (cumulative) {
    const firstBucketStart = addPeriod(curStart, period, -(N - 1))
    const beforeStr = dateKey(firstBucketStart)
    runningTotal = activityLog.filter((e) => e.field === activityField && e.date < beforeStr).reduce((s, e) => s + e.delta, 0)
  }
  for (let i = N - 1; i >= 0; i--) {
    const bStart = addPeriod(curStart, period, -i)
    const bEndInclusive = addDays(addPeriod(bStart, period, 1), -1)
    const startStr = dateKey(bStart), endStr = dateKey(bEndInclusive)
    const sum = activityLog.filter((e) => e.field === activityField && e.date >= startStr && e.date <= endStr).reduce((s, e) => s + e.delta, 0)
    if (cumulative) { runningTotal += sum; buckets.push(Math.max(0, runningTotal)) }
    else buckets.push(Math.max(0, sum))
  }
  return buckets
}

const MONTH_SHORT_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

export function formatBucketLabel(range: BucketRange, period: MetricPeriod): string {
  if (period === "day") return `${range.start.getDate()} ${MONTH_SHORT_RU[range.start.getMonth()]}`
  if (period === "week") return `${range.start.getDate()}–${range.end.getDate()} ${MONTH_SHORT_RU[range.end.getMonth()]}`
  if (period === "year") return `${range.start.getFullYear()}`
  return `${MONTH_SHORT_RU[range.start.getMonth()]} ${range.start.getFullYear()}`
}

export function formatMetricValue(info: { unit: string }, value: number, fmtMoney: (n: number) => string, fmtHours: (h: number) => string): string {
  const v = Math.round(value * 100) / 100
  if (info.unit === "ч") return fmtHours(v)
  if (info.unit === "₽") return fmtMoney(v)
  return Math.round(v) + " " + info.unit
}

export function defaultDashboardMetrics(): DashboardMetric[] {
  return [
    { id: "dm1", type: "hours", goal: 4 },
    { id: "dm2", type: "presentations", goal: 0 },
    { id: "dm3", type: "worksheets", goal: 0 },
    { id: "dm4", type: "revenue", goal: 4000 },
  ]
}
