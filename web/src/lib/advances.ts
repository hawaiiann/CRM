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

/* ---------- Списание по конкретным авансам ----------
 * Раньше списание было одним числом по клиенту: в реестре авансов колонки
 * «Списано» и «Остаток» показывали итог по клиенту в каждой строке, и
 * понять, какой аванс уже потрачен, было нельзя. Теперь у заказа есть
 * разбивка advanceAllocations; сумма списаний без привязки (старые заказы)
 * считается отдельно и показывается честно как «без привязки».
 */

/** Сколько списано с конкретного аванса по всем неотменённым заказам. */
export function advanceAllocated(advanceId: string, orders: Order[], excludeOrderId?: string): number {
  return orders
    .filter((o) => o.status !== "cancelled" && o.id !== excludeOrderId)
    .reduce((s, o) => s + (o.advanceAllocations || []).filter((a) => a.advanceId === advanceId).reduce((t, a) => t + parseNum(a.amount), 0), 0)
}

/** Часть списания заказа, не привязанная ни к одному авансу. */
export function orderUnallocatedAdvance(o: Pick<Order, "advanceUsed" | "advanceAllocations">): number {
  const allocated = (o.advanceAllocations || []).reduce((s, a) => s + parseNum(a.amount), 0)
  return Math.max(0, Math.round((parseNum(o.advanceUsed) - allocated) * 100) / 100)
}

/** Сколько у клиента списано без привязки к авансу (старые заказы). */
export function clientUnallocatedAdvance(clientName: string, orders: Order[], excludeOrderId?: string): number {
  return ordersOfClient(orders, clientName)
    .filter((o) => o.id !== excludeOrderId)
    .reduce((s, o) => s + orderUnallocatedAdvance(o), 0)
}

export interface AdvanceRow {
  advance: Advance
  /** Списано с этого аванса другими заказами (без текущего, если он исключён). */
  used: number
  /** Остаток именно этого аванса. */
  available: number
}

/** Авансы клиента с остатком по каждому, от старых к новым. */
export function clientAdvanceRows(clientName: string, advances: Advance[], orders: Order[], excludeOrderId?: string): AdvanceRow[] {
  const name = (clientName || "").trim().toLowerCase()
  if (!name) return []
  return advances
    .filter((a) => (a.client || "").trim().toLowerCase() === name)
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .map((advance) => {
      const used = advanceAllocated(advance.id, orders, excludeOrderId)
      return { advance, used, available: Math.max(0, Math.round((parseNum(advance.amount) - used) * 100) / 100) }
    })
}

/**
 * Разложить сумму по авансам: старые первыми, каждый не больше остатка.
 * Для кнопки «Списать всё» и для автоматической привязки.
 */
export function allocateGreedy(rows: AdvanceRow[], amount: number): { advanceId: string; amount: number }[] {
  let left = Math.max(0, amount)
  const result: { advanceId: string; amount: number }[] = []
  for (const r of rows) {
    if (left <= 0) break
    const take = Math.min(r.available, left)
    if (take > 0) { result.push({ advanceId: r.advance.id, amount: Math.round(take * 100) / 100 }); left -= take }
  }
  return result
}
