import type { Order, Payment } from "@/types/models"
import { orderPaymentState, parseNum, dateKey } from "./money"
import { normalizePayment } from "./normalize"

/**
 * Деньги приходят пачками: один платёж за несколько сданных уроков, один
 * аванс на несколько будущих. Раньше это раскладывалось руками — открыть
 * каждый заказ, добавить платёж. Здесь одна сумма раскладывается по выбранным
 * заказам по порядку (обычно по сроку сдачи), каждому не больше его остатка.
 */

export interface Split {
  orderId: string
  amount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Разложить сумму по заказам в заданном порядке, каждому не больше «к доплате». Остаток — что не поместилось. */
export function distributePayment(orders: Order[], amount: number): { splits: Split[]; leftover: number } {
  let left = Math.max(0, round2(parseNum(amount)))
  const splits: Split[] = []
  for (const o of orders) {
    if (left <= 0) break
    const room = orderPaymentState(o).remaining
    const take = round2(Math.min(room, left))
    if (take > 0) { splits.push({ orderId: o.id, amount: take }); left = round2(left - take) }
  }
  return { splits, leftover: left }
}

/** Применить платежи к заказам: новая запись в payments, итоги и флаги пересчитаны. */
export function applyPayments(orders: Order[], splits: Split[], date: string, note: string): Order[] {
  const byId = new Map(splits.map((s) => [s.orderId, s.amount]))
  return orders.map((o) => {
    const add = byId.get(o.id)
    if (!add) return o
    const payment: Payment = normalizePayment({ amount: add, date: date || dateKey(new Date()), note })
    const payments = [...(o.payments || []), payment]
    const paidAmount = payments.reduce((s, p) => s + parseNum(p.amount), 0)
    const next: Order = { ...o, payments, paidAmount }
    const state = orderPaymentState(next)
    return { ...next, isPaid: state.isFullyPaid, paidAt: o.paidAt || payment.date }
  })
}

/**
 * Списать новый аванс на заказы: каждому не больше его «к доплате», с
 * привязкой к этому авансу (advanceAllocations) и увеличением advanceUsed.
 */
export function allocateAdvanceToOrders(orders: Order[], advanceId: string, amount: number, targetIds: string[]): { orders: Order[]; splits: Split[]; leftover: number } {
  const targets = targetIds.map((id) => orders.find((o) => o.id === id)).filter((o): o is Order => !!o)
  const { splits, leftover } = distributePayment(targets, amount)
  const byId = new Map(splits.map((s) => [s.orderId, s.amount]))
  const next = orders.map((o) => {
    const add = byId.get(o.id)
    if (!add) return o
    const rest = (o.advanceAllocations || []).filter((a) => a.advanceId !== advanceId)
    const mine = (o.advanceAllocations || []).find((a) => a.advanceId === advanceId)?.amount || 0
    return {
      ...o,
      advanceAllocations: [...rest, { advanceId, amount: round2(mine + add) }],
      advanceUsed: round2(parseNum(o.advanceUsed) + add),
    }
  })
  return { orders: next, splits, leftover }
}
