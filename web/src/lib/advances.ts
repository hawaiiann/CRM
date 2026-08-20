import type { Order, Advance } from "@/types/models"
import { parseNum } from "./money"

// Ported from js/finance.js's getClientAdvanceStats.
export function getClientAdvanceStats(clientName: string, advances: Advance[], orders: Order[], excludeOrderId?: string) {
  if (!clientName) return { totalIn: 0, used: 0, available: 0 }
  const name = clientName.toLowerCase()
  const totalIn = advances.filter((a) => a.client.toLowerCase() === name).reduce((s, a) => s + parseNum(a.amount), 0)
  const used = orders
    .filter((o) => o.client.toLowerCase() === name && o.status !== "cancelled" && o.id !== excludeOrderId)
    .reduce((s, o) => s + parseNum(o.advanceUsed), 0)
  return { totalIn, used, available: Math.max(0, totalIn - used) }
}
