import type { ActivityLogEntry } from "@/types/models"

/**
 * Журнал часов: одна запись на «день + заказ».
 *
 * Раньше журнал был логом дельт: каждая правка заказа и каждый минутный сброс
 * таймера добавляли отдельную строку «сегодня, заказ, ±N часов». За один день
 * по одному заказу набегало по 40 строк, а ошибочный ввод и его исправление
 * оставались в журнале парой «+30, −30» — сумма нулевая, но график за день
 * уже показал 30 часов. Восстановить из такого лога, что реально было
 * отработано, нельзя.
 *
 * Теперь новое время ВЛИВАЕТСЯ в уже существующую запись того же дня по тому
 * же заказу, а если после этого она обнуляется — запись убирается совсем.
 * Облако получает обновление строки, а не новую строку (см. syncActivityLog).
 *
 * Модуль чистый и без стора, чтобы его можно было проверить в node.
 */

const EPS = 1e-6

/**
 * Идентификатор записи журнала — выдаётся сразу при создании, а не при
 * отправке. Раньше запись без entryId, не успевшая уйти в облако (закрыли
 * вкладку через секунду, нет сети), при следующей загрузке выбрасывалась:
 * её нельзя отличить от строки, которая уже лежит в облаке.
 */
export function makeEntryId(): string {
  return "al_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

export interface JournalChange {
  log: ActivityLogEntry[]
  /** Записи, исчезнувшие из журнала — их надо удалить и из облака. */
  removed: ActivityLogEntry[]
}

function findDayEntry(log: ActivityLogEntry[], orderId: string, date: string): number {
  // С конца: если по старым данным на день несколько строк, дописываем в
  // последнюю — старые строки не трогаем, их разбирает инструмент сверки.
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]
    if (e.field === "hours" && e.orderId === orderId && e.date === date) return i
  }
  return -1
}

/** Добавить delta часов к записи дня по заказу (создав её при необходимости). */
export function mergeHoursEntry(log: ActivityLogEntry[], orderId: string, date: string, delta: number): JournalChange {
  if (!orderId || !date || !Number.isFinite(delta) || Math.abs(delta) < EPS) return { log, removed: [] }
  const idx = findDayEntry(log, orderId, date)
  if (idx < 0) return { log: [...log, { date, orderId, field: "hours", delta: round4(delta), entryId: makeEntryId() }], removed: [] }
  const cur = log[idx]
  const next = round4(cur.delta + delta)
  if (Math.abs(next) < EPS) return { log: log.filter((_, i) => i !== idx), removed: [cur] }
  return { log: log.map((e, i) => (i === idx ? { ...e, delta: next } : e)), removed: [] }
}

export function dayOrderKey(date: string, orderId: string): string {
  return `${date}|${orderId}`
}

/** Записи по «день + заказ», в порядке журнала. */
export function groupByDayOrder(log: ActivityLogEntry[]): Map<string, ActivityLogEntry[]> {
  const map = new Map<string, ActivityLogEntry[]>()
  log.forEach((e) => {
    if (e.field !== "hours") return
    const k = dayOrderKey(e.date, e.orderId)
    const list = map.get(k)
    if (list) list.push(e)
    else map.set(k, [e])
  })
  return map
}

/**
 * Задать дню по заказу ТОЧНОЕ число часов — для таблицы правки. Если по дню
 * лежит несколько старых строк, они схлопываются в первую (её entryId
 * сохраняется, в облако уйдёт UPDATE), остальные удаляются.
 */
export function setDayHours(log: ActivityLogEntry[], orderId: string, date: string, hours: number): JournalChange {
  if (!orderId || !date || !Number.isFinite(hours)) return { log, removed: [] }
  const group = log.filter((e) => e.field === "hours" && e.orderId === orderId && e.date === date)
  const target = Math.abs(hours) < EPS ? 0 : round4(hours)
  if (!group.length) {
    if (!target) return { log, removed: [] }
    return { log: [...log, { date, orderId, field: "hours", delta: target, entryId: makeEntryId() }], removed: [] }
  }
  const [first, ...rest] = group
  const current = round4(group.reduce((s, e) => s + e.delta, 0))
  if (!rest.length && current === target) return { log, removed: [] }
  if (!target) return { log: log.filter((e) => !group.includes(e)), removed: group }
  const restSet = new Set(rest)
  return {
    log: log.filter((e) => !restSet.has(e)).map((e) => (e === first ? { ...e, delta: target } : e)),
    removed: rest,
  }
}

/**
 * Схлопнуть весь журнал до одной строки на «день + заказ». Только по явной
 * кнопке: автоматическое схлопывание при загрузке однажды уже уничтожило
 * журнал (см. историю в cloudSync.ts), и повторять его молча нельзя.
 */
export function compactLog(log: ActivityLogEntry[]): JournalChange {
  const groups = groupByDayOrder(log)
  let changed = false
  const removed: ActivityLogEntry[] = []
  const replace = new Map<ActivityLogEntry, ActivityLogEntry>()
  groups.forEach((group) => {
    if (group.length < 2) return
    changed = true
    const sum = round4(group.reduce((s, e) => s + e.delta, 0))
    const [first, ...rest] = group
    removed.push(...rest)
    if (Math.abs(sum) < EPS) removed.push(first)
    else replace.set(first, { ...first, delta: sum })
  })
  if (!changed) return { log, removed: [] }
  const removedSet = new Set(removed)
  return { log: log.filter((e) => !removedSet.has(e)).map((e) => replace.get(e) || e), removed }
}

/** Задать записи точное число часов; ноль — убрать запись. */
export function setEntryDelta(log: ActivityLogEntry[], entry: ActivityLogEntry, delta: number): JournalChange {
  if (!log.includes(entry)) return { log, removed: [] }
  if (!Number.isFinite(delta) || Math.abs(delta) < EPS) return { log: log.filter((e) => e !== entry), removed: [entry] }
  return { log: log.map((e) => (e === entry ? { ...e, delta: round4(delta) } : e)), removed: [] }
}

export interface JournalScaleResult extends JournalChange {
  /** По каким заказам журнал пересчитан: было и стало часов. */
  orders: { orderId: string; before: number; after: number }[]
}

/**
 * Привести завышенный журнал к часам заказов. Записи заказа, у которого в
 * журнале в разы больше часов, чем на самом заказе (журнал размножился при
 * старых сбоях синхронизации: в августе-сентябре 2026 — в 2, 3, 7 и 14 раз),
 * умножаются на одно число: раскладка по дням сохраняется, а сумма
 * становится равной часам заказа. Заказы с небольшим расхождением не
 * трогаются — их правят вручную в сверке.
 */
export function scaleJournalToOrders(log: ActivityLogEntry[], targets: Map<string, number>, minRatio = 1.5): JournalScaleResult {
  const sums = new Map<string, number>()
  log.forEach((e) => { if (e.field === "hours") sums.set(e.orderId, (sums.get(e.orderId) || 0) + e.delta) })
  const factor = new Map<string, number>()
  const orders: JournalScaleResult["orders"] = []
  sums.forEach((sum, orderId) => {
    const target = targets.get(orderId)
    if (!target || target <= 0 || sum <= 0 || sum / target < minRatio) return
    factor.set(orderId, target / sum)
    orders.push({ orderId, before: round4(sum), after: round4(target) })
  })
  if (!factor.size) return { log, removed: [], orders: [] }
  const removed: ActivityLogEntry[] = []
  const next: ActivityLogEntry[] = []
  log.forEach((e) => {
    const k = e.field === "hours" ? factor.get(e.orderId) : undefined
    if (k === undefined) { next.push(e); return }
    const d = round4(e.delta * k)
    if (Math.abs(d) < EPS) removed.push(e)
    else next.push({ ...e, delta: d })
  })
  return { log: next, removed, orders }
}
