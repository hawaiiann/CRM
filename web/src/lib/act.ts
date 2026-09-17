import type { Order, OrderLine } from "@/types/models"
import { isHourlyUnit, orderPaymentState, ordersOfClient, orderTotal, parseNum } from "./money"

/**
 * Акт за месяц для заказчика: что сдано, из чего состоит, сколько стоит,
 * сколько закрыто авансом и деньгами, сколько осталось. Это то, что раньше
 * собиралось руками из таблицы Финансов перед отправкой преподавателю.
 *
 * Месяц берётся по сроку сдачи заказа — так акт совпадает с тем, за что
 * реально просят оплату в этом месяце. Отменённые не входят.
 */

export interface ActRow {
  order: Order
  n: number
  title: string
  subject: string
  grade: string
  deadline: string
  composition: string
  total: number
}

export interface ActTotals {
  total: number
  advance: number
  paid: number
  remaining: number
}

export function lineLabel(l: OrderLine): string {
  const base = l.label || l.type || "Работа"
  if (l.ignorePrice) return `${base} (без оплаты)`
  const qty = isHourlyUnit(l) ? `${parseNum(l.pomoHours)} ч` : `${parseNum(l.qty)} ${l.type || ""}`.trim()
  return `${base}: ${qty} × ${parseNum(l.rate)}`
}

/** Заказы клиента, сданные в месяце (по сроку сдачи), по возрастанию срока. */
export function actOrders(orders: Order[], client: string, year: number, month0: number, opts: { onlyDone?: boolean } = {}): Order[] {
  const prefix = `${year}-${String(month0 + 1).padStart(2, "0")}-`
  return ordersOfClient(orders, client)
    .filter((o) => (o.deadline || "").startsWith(prefix))
    .filter((o) => (opts.onlyDone ?? true) ? o.status === "done" : true)
    .sort((a, b) => (a.deadline || "").localeCompare(b.deadline || "") || (a.createdAt || 0) - (b.createdAt || 0))
}

export function actRows(orders: Order[]): ActRow[] {
  return orders.map((o, i) => ({
    order: o,
    n: i + 1,
    title: o.title || [o.subject, o.grade, o.lesson && `Урок ${o.lesson}`].filter(Boolean).join(", ") || "Без названия",
    subject: o.subject || "",
    grade: o.grade || "",
    deadline: o.deadline || "",
    composition: (o.lines || []).map(lineLabel).join("; "),
    total: Math.round(orderTotal(o)),
  }))
}

export function actTotals(orders: Order[]): ActTotals {
  let total = 0, advance = 0, paid = 0, remaining = 0
  orders.forEach((o) => {
    const p = orderPaymentState(o)
    total += p.full
    advance += p.advUsed
    paid += p.paidMoney
    remaining += p.remaining
  })
  const r = (n: number) => Math.round(n * 100) / 100
  return { total: r(total), advance: r(advance), paid: r(paid), remaining: r(remaining) }
}

const MONTHS_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]

export function monthLabel(year: number, month0: number): string {
  return `${MONTHS_RU[month0]} ${year}`
}

export function actFilename(client: string, year: number, month0: number): string {
  const slug = (client || "client").toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 30)
  return `akt-${slug}-${year}-${String(month0 + 1).padStart(2, "0")}.xlsx`
}
