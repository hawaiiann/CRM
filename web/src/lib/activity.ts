import type { Order, ActivityLogEntry } from "@/types/models"
import { parseNum, dateKey } from "./money"

function getOrderDisplayHours(o: Order): number {
  const manualAct = parseNum(o.actualHours)
  const pomoSum = (o.lines || []).reduce((s, l) => s + parseNum(l.pomoHours), 0)
  if (manualAct > 0) return manualAct
  if (pomoSum > 0) return pomoSum
  return parseNum(o.estimatedHours) || 0
}

// Ported from db.js's recordActivityChanges — writes only the HOURS delta
// between the old and new order into the activity log (revenue/материалы are
// derived directly from orders elsewhere, see js/stats.js's original comment).
export function recordActivityChanges(oldOrder: Order | null, newOrder: Order, onDate?: string): ActivityLogEntry | null {
  const today = onDate || dateKey(new Date())
  const oldHours = oldOrder ? getOrderDisplayHours(oldOrder) : 0
  const newHours = getOrderDisplayHours(newOrder)
  const hoursDelta = newHours - oldHours
  if (!hoursDelta) return null
  return { date: today, orderId: newOrder.id, field: "hours", delta: hoursDelta }
}
