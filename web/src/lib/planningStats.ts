import type { PlanningBoard, PlanningLesson } from "@/types/models"

export interface BoardProgress {
  lessonsTotal: number
  lessonsDone: number
  itemsTotal: number
  itemsDone: number
  /** Разбивка по названию пункта чек-листа — «презентация», «рабочий лист» и т.п. */
  byItem: { name: string; done: number; total: number }[]
}

export type LessonColor = "gray" | "yellow" | "green-1" | "green-2" | "green-3" | "red"

/**
 * Цвет клетки урока — то же самое, что решает раскраску сетки в BoardCard.
 *
 * Раньше это была локальная функция внутри компонента (lessonColorClass) и
 * годилась только для отрисовки на экране. Вынесена сюда, чтобы экспорт мог
 * закрасить строку «По урокам» ТЕМ ЖЕ цветом, что виден в самом планировании,
 * а не считать его заново своими правилами и рано или поздно разойтись.
 *
 * Закреплённый вручную или пришедший от заказа цвет побеждает — тогда состав
 * чек-листа на цвет клетки не влияет. Иначе цвет считается по доле готовых
 * пунктов: 0 — серый, до половины — green-1, до почти всех — green-2, иначе
 * green-3.
 */
export function lessonDisplayColor(l: PlanningLesson): LessonColor {
  if (l.colorLocked || l.orderLinked) return (l.color as LessonColor) || "gray"
  const items = l.items || []
  const total = items.length
  const done = items.filter((i) => i.done).length
  if (total === 0 || done === 0) return "gray"
  const ratio = done / total
  return ratio >= 0.99 ? "green-3" : ratio >= 0.5 ? "green-2" : "green-1"
}

/**
 * Урок готов, если у него нет незакрытых пунктов — либо если цвет клетки
 * зелёный (его можно закрепить вручную или он приходит от статуса связанного
 * заказа, и тогда состав чек-листа не главное). Условие один в один повторяет
 * то, что решает цвет клетки в BoardCard (lessonColorClass) — тайл «Уроков» на
 * карточке доски и строка в экспорте обязаны сходиться, иначе один и тот же
 * прогресс на экране и в файле будет выглядеть по-разному.
 */
function isLessonDone(l: PlanningLesson): boolean {
  const items = l.items || []
  const total = items.length
  const done = items.filter((i) => i.done).length
  return !!(l.color && l.color.startsWith("green")) || (total > 0 && done === total)
}

/**
 * Прогресс одной доски (класса): сколько уроков закрыто, сколько пунктов
 * чек-листа выполнено — целиком и по каждому названию пункта отдельно.
 *
 * Раньше это считалось прямо внутри BoardCard, только для отрисовки плиток
 * на карточке. Вынесено сюда, чтобы тот же расчёт использовал экспорт в CSV
 * (PlanningExportDialog) — без этого получилась бы вторая копия формулы,
 * которая рано или поздно разошлась бы с той, что видна на экране.
 */
export function computeBoardProgress(board: PlanningBoard): BoardProgress {
  const lessons = board.lessons || []
  let itemsTotal = 0
  let itemsDone = 0
  let lessonsDone = 0
  const byItemMap: Record<string, { done: number; total: number }> = {}

  lessons.forEach((l) => {
    if (isLessonDone(l)) lessonsDone++
    ;(l.items || []).forEach((item) => {
      const name = item.text.trim()
      if (!name) return
      if (!byItemMap[name]) byItemMap[name] = { done: 0, total: 0 }
      byItemMap[name].total++
      itemsTotal++
      if (item.done) {
        byItemMap[name].done++
        itemsDone++
      }
    })
  })

  return {
    lessonsTotal: lessons.length,
    lessonsDone,
    itemsTotal,
    itemsDone,
    byItem: Object.entries(byItemMap).map(([name, s]) => ({ name, ...s })),
  }
}

/** Список четвертей, реально встречающихся в досках, — для выбора периода при экспорте. */
export function distinctQuarters(boards: PlanningBoard[]): string[] {
  const set = new Set(boards.map((b) => (b.quarter || "").trim()).filter(Boolean))
  return [...set].sort((a, b) => a.localeCompare(b, "ru"))
}
