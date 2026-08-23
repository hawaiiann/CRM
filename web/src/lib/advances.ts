import type { Order, Advance } from "@/types/models"
import { parseNum, ordersOfClient } from "./money"

// Ported from js/finance.js's getClientAdvanceStats.
export function getClientAdvanceStats(clientName: string, advances: Advance[], orders: Order[], excludeOrderId?: string) {
  const name = (clientName || "").trim().toLowerCase()
  if (!name) return { totalIn: 0, used: 0, available: 0 }
  const totalIn = advances
    .filter((a) => (a.client || "").trim().toLowerCase() === name)
    .reduce((s, a) => s + parseNum(a.amount), 0)
  const used = ordersOfClient(orders, clientName)
    .filter((o) => o.id !== excludeOrderId)
    .reduce((s, o) => s + parseNum(o.advanceUsed), 0)
  return { totalIn, used, available: Math.max(0, totalIn - used) }
}

/**
 * То же самое, но сразу по всем клиентам — для итоговой плитки на Финансах.
 *
 * Раньше эта сумма считалась там на месте и по ВСЕМ заказам, включая
 * отменённые. Получалось расхождение: в карточке заказа и у клиентов
 * отменённый заказ аванс не расходует (работы не было — деньги не потрачены),
 * а в итоге на Финансах расходовал, и «Остаток доступен» выходил заниженным.
 *
 * Число всё равно останется не равным сумме по одному клиенту, и это
 * нормально: перерасход у одного клиента уменьшает общий остаток, а его
 * личный остаток обрезан нулём.
 */
export function getTotalAdvanceStats(advances: Advance[], orders: Order[]) {
  const totalIn = advances.reduce((s, a) => s + parseNum(a.amount), 0)
  const used = orders
    .filter((o) => o.status !== "cancelled")
    .reduce((s, o) => s + parseNum(o.advanceUsed), 0)
  return { totalIn, used, available: Math.max(0, totalIn - used) }
}
