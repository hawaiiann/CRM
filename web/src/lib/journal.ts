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
  if (idx < 0) return { log: [...log, { date, orderId, field: "hours", delta: round4(delta) }], removed: [] }
  const cur = log[idx]
  const next = round4(cur.delta + delta)
  if (Math.abs(next) < EPS) return { log: log.filter((_, i) => i !== idx), removed: [cur] }
  return { log: log.map((e, i) => (i === idx ? { ...e, delta: next } : e)), removed: [] }
}

/** Задать записи точное число часов; ноль — убрать запись. */
export function setEntryDelta(log: ActivityLogEntry[], entry: ActivityLogEntry, delta: number): JournalChange {
  if (!log.includes(entry)) return { log, removed: [] }
  if (!Number.isFinite(delta) || Math.abs(delta) < EPS) return { log: log.filter((e) => e !== entry), removed: [entry] }
  return { log: log.map((e) => (e === entry ? { ...e, delta: round4(delta) } : e)), removed: [] }
}
