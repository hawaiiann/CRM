import type { Order, ActivityLogEntry } from "@/types/models"
import { parseNum, dateKey } from "./money"

/**
 * Часы, которые реально отработаны по заказу: сначала «Факт. часы», вписанные
 * руками, иначе — сумма того, что накапал таймер по позициям.
 *
 * Раньше при отсутствии того и другого сюда же подставлялись «План. часы» —
 * оценка, сделанная ДО начала работы. Стоило создать заказ и сразу заполнить
 * план (обычный порядок действий), как разница «было 0, стало 6» уходила в
 * журнал активности отдельной записью «отработано 6 часов сегодня» — хотя
 * работа ещё не начиналась. Именно так набегали лишние часы за день: сумма
 * планов по нескольким заведённым заказам, а не реально потраченное время.
 */
function actualHours(o: Order): number {
  const manual = parseNum(o.actualHours)
  if (manual > 0) return manual
  return (o.lines || []).reduce((s, l) => s + parseNum(l.pomoHours), 0)
}

// Ported from db.js's recordActivityChanges — writes only the HOURS delta
// between the old and new order into the activity log (revenue/материалы are
// derived directly from orders elsewhere, see js/stats.js's original comment).
export function recordActivityChanges(oldOrder: Order | null, newOrder: Order, onDate?: string): ActivityLogEntry | null {
  const today = onDate || dateKey(new Date())
  const oldHours = oldOrder ? actualHours(oldOrder) : 0
  const newHours = actualHours(newOrder)
  const hoursDelta = newHours - oldHours
  if (!hoursDelta) return null
  return { date: today, orderId: newOrder.id, field: "hours", delta: hoursDelta }
}
