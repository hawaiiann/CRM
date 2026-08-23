import type { Order, OrderLine, PlanningLesson } from "@/types/models"

/**
 * Ручное пополнение между планированием и заказом.
 *
 * Автоматическая синхронизация односторонняя: позиции заказа падают в чек-лист
 * урока (syncPlanningWithOrders). Обратной дороги не было вовсе — состав,
 * набранный в планировании, в заказ не попадал, и его переписывали руками.
 *
 * Здесь обе стороны, но НЕ автоматически: перенос состава — решение человека,
 * а не фоновое действие. Молча добавлять позиции в заказ нельзя, за ними
 * стоят деньги.
 */

const norm = (s: string) => s.trim().toLowerCase()

/** Пункты урока, которых ещё нет среди позиций заказа. */
export function lessonItemsMissingInOrder(lesson: PlanningLesson, order: Order): string[] {
  const have = new Set((order.lines || []).map((l) => norm(l.label || l.type || "")))
  const seen = new Set<string>()
  return (lesson.items || [])
    .map((i) => i.text.trim())
    .filter((text) => {
      if (!text) return false
      const k = norm(text)
      if (have.has(k) || seen.has(k)) return false
      seen.add(k)
      return true
    })
}

/** Позиции заказа, которых ещё нет в чек-листе урока. */
export function orderLinesMissingInLesson(order: Order, lesson: PlanningLesson): string[] {
  const have = new Set((lesson.items || []).map((i) => norm(i.text)))
  const seen = new Set<string>()
  return (order.lines || [])
    .map((l) => (l.label || l.type || "").trim())
    .filter((text) => {
      if (!text) return false
      const k = norm(text)
      if (have.has(k) || seen.has(k)) return false
      seen.add(k)
      return true
    })
}

/**
 * Добавляет недостающие пункты урока в заказ новыми позициями.
 * Цена и количество ставятся по умолчанию — суммы за человеком, угадывать их
 * нельзя. Готовность пункта переносится в ready, чтобы таймер сразу вставал
 * на первую незакрытую позицию.
 */
export function addLessonItemsToOrderLines(
  order: Order,
  lesson: PlanningLesson,
  defaults: { unit: string },
  makeId: () => string
): OrderLine[] {
  const missing = lessonItemsMissingInOrder(lesson, order)
  if (!missing.length) return order.lines
  const doneByText = new Map((lesson.items || []).map((i) => [norm(i.text), !!i.done]))
  const added: OrderLine[] = missing.map((text) => ({
    id: makeId(),
    label: text,
    type: defaults.unit,
    qty: 1,
    pomoHours: 0,
    rate: 0,
    ignorePrice: false,
    ready: !!doneByText.get(norm(text)),
  }))
  return [...(order.lines || []), ...added]
}

/** Добавляет недостающие позиции заказа в чек-лист урока. */
export function addOrderLinesToLessonItems(
  order: Order,
  lesson: PlanningLesson,
  makeId: () => string
): PlanningLesson["items"] {
  const missing = orderLinesMissingInLesson(order, lesson)
  if (!missing.length) return lesson.items || []
  const readyByText = new Map((order.lines || []).map((l) => [norm(l.label || l.type || ""), !!l.ready]))
  return [
    ...(lesson.items || []),
    ...missing.map((text) => ({
      id: makeId(),
      text,
      done: !!readyByText.get(norm(text)),
      // fromOrder не ставим: пункт добавлен вручную и не должен исчезать,
      // если позицию потом уберут из заказа (автосинхронизация чистит только
      // свои, помеченные fromOrder).
    })),
  ]
}
