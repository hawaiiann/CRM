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
