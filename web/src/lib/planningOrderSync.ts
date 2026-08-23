import type { Order, OrderLine, PlanningBoard, PlanningLesson } from "@/types/models"
import { orderMatchesLessonFuzzy } from "./planningSync"

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

/**
 * Что произойдёт при отвязке урока от заказа.
 *
 * Разорвать связь одним флагом нельзя: у неё два независимых источника.
 * Явная привязка живёт в заказе (linkedLessonId), нечёткая — в совпадении
 * класса, предмета, четверти и НОМЕРА УРОКА. Снять только явную мало: заказ
 * тут же поймает тот же урок по совпадению полей, и со стороны это выглядит
 * как «кнопка не работает».
 *
 * Поэтому отвязка правит данные, а не заводит скрытый флаг «не связывать»:
 * чистится linkedLessonId и, если нечёткое совпадение всё равно срабатывает,
 * поле «Урок» заказа. Это видно в форме заказа и обратимо руками — в отличие
 * от невидимого признака, про который через месяц никто не вспомнит. Заодно
 * не нужна колонка в базе.
 */
export interface UnlinkPlan {
  /** Связь вообще есть и её есть что рвать. */
  possible: boolean
  /** Будет снята явная привязка «Привязать к уроку». */
  clearsExplicitLink: boolean
  /** Будет очищено поле «Урок» заказа — иначе связь восстановится сама. */
  clearsLessonNumber: boolean
  /** Номер урока, который будет стёрт (для текста подтверждения). */
  lessonNumber: string
  /** Патч заказа. */
  orderPatch: Pick<Order, "linkedLessonId" | "lesson">
  /** Чек-лист урока после отвязки. */
  lessonItems: PlanningLesson["items"]
  /** Сколько пунктов чек-листа перестанут числиться пришедшими из заказа. */
  releasedItems: number
}

export function planUnlink(order: Order, board: PlanningBoard, lesson: PlanningLesson): UnlinkPlan {
  const clearsExplicitLink = order.linkedLessonId === lesson.id
  // Проверяем нечёткое совпадение так, как оно сработает ПОСЛЕ снятия явной
  // привязки: пока linkedLessonId стоит, нечёткое правило до заказа не доходит.
  const clearsLessonNumber = orderMatchesLessonFuzzy({ ...order, linkedLessonId: null }, board, lesson)

  // Пункты, добавленные автосинхронизацией, оставляем в уроке, но снимаем
  // пометку fromOrder: заказа за ними больше нет, а терять набранный состав
  // из-за отвязки — потеря данных на ровном месте.
  const items = lesson.items || []
  const releasedItems = items.filter((i) => i.fromOrder).length
  const lessonItems = releasedItems
    ? items.map((i) => (i.fromOrder ? { id: i.id, text: i.text, done: i.done } : i))
    : items

  return {
    possible: clearsExplicitLink || clearsLessonNumber,
    clearsExplicitLink,
    clearsLessonNumber,
    lessonNumber: String(order.lesson || ""),
    orderPatch: {
      linkedLessonId: clearsExplicitLink ? null : order.linkedLessonId,
      lesson: clearsLessonNumber ? "" : order.lesson,
    },
    lessonItems,
    releasedItems,
  }
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
