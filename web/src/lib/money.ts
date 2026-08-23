import type { Order, OrderLine } from "@/types/models"

export function parseNum(v: unknown): number {
  const n = parseFloat(String(v ?? "").replace(",", ".").replace(/[^\d.-]/g, ""))
  return isNaN(n) ? 0 : n
}

export function fmtMoney(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n || 0)) + " ₽"
}

export function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function isOrderOverdue(o: Pick<Order, "deadline" | "status">): boolean {
  return !!(o.deadline && o.deadline < dateKey(new Date()) && !["done", "cancelled"].includes(o.status))
}

export function parseHours(v: unknown): number {
  const s = String(v ?? "").trim().toLowerCase()
  if (!s) return 0
  if (s.includes(":")) {
    const [h, m] = s.split(":")
    return parseNum(h) + parseNum(m) / 60
  }
  if (s.includes("ч") || s.includes("м")) {
    const hMatch = s.match(/(\d+[.,]?\d*)\s*ч/)
    const mMatch = s.match(/(\d+[.,]?\d*)\s*м/)
    const h = hMatch ? parseNum(hMatch[1]) : 0
    const m = mMatch ? parseNum(mMatch[1]) : 0
    return h + m / 60
  }
  return parseNum(s)
}

export function fmtHours(h: unknown): string {
  const num = parseNum(h)
  if (num === 0) return "0 ч 0 мин"
  const hrs = Math.floor(num)
  const mins = Math.round((num - hrs) * 60)
  if (hrs === 0) return `${mins} мин`
  if (mins === 0) return `${hrs} ч 0 мин`
  return `${hrs} ч ${mins} мин`
}

export function isHourlyUnit(l: OrderLine): boolean {
  return (l.type || "").toLowerCase().includes("час")
}

export function calculateLineTotal(l: OrderLine): number {
  if (l.ignorePrice) return 0
  if (isHourlyUnit(l)) return parseHours(l.pomoHours) * parseNum(l.rate)
  return parseNum(l.qty) * parseNum(l.rate)
}

export function orderBaseTotal(o: Pick<Order, "lines">): number {
  return (o.lines || []).reduce((s, l) => s + calculateLineTotal(l), 0)
}

export function orderTaxRate(o: Pick<Order, "taxType"> | undefined): number {
  if (o?.taxType === "individual") return 0.04
  if (o?.taxType === "entity") return 0.06
  return 0
}

export function orderTaxLabel(o: Pick<Order, "taxType"> | undefined): string {
  if (o?.taxType === "individual") return "Физ. лицо (+4%)"
  if (o?.taxType === "entity") return "Юр. лицо (+6%)"
  return "Без налога"
}

export function orderTotal(o: Pick<Order, "lines" | "taxType">): number {
  return orderBaseTotal(o) * (1 + orderTaxRate(o))
}

export function orderPayments(o: Pick<Order, "payments" | "paidAmount" | "paidAt" | "deadline">) {
  if (Array.isArray(o.payments) && o.payments.length) return o.payments
  const legacy = parseNum(o.paidAmount)
  if (legacy > 0) return [{ id: "legacy", amount: legacy, date: o.paidAt || o.deadline || "", note: "" }]
  return []
}

export function orderPaymentsTotal(o: Pick<Order, "payments" | "paidAmount" | "paidAt" | "deadline">): number {
  return orderPayments(o).reduce((s, p) => s + parseNum(p.amount), 0)
}

export function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

export function fmtMilestoneDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h} ${pluralizeRu(h, "час", "часа", "часов")}`)
  if (m > 0) parts.push(`${m} ${pluralizeRu(m, "минута", "минуты", "минут")}`)
  return parts.join(" ") || "0 минут"
}

export function orderPaymentState(o: Order) {
  const fullExact = orderTotal(o)
  const full = Math.round(fullExact)
  const advUsed = Math.min(parseNum(o.advanceUsed), full)
  const paidMoney = Math.min(orderPaymentsTotal(o), Math.max(0, full - advUsed))
  const covered = advUsed + paidMoney
  const remaining = Math.max(0, Math.round((full - covered) * 100) / 100)
  return {
    full,
    fullExact,
    advUsed,
    paidMoney,
    covered,
    remaining,
    isFullyPaid: full > 0 && remaining <= 0,
  }
}
