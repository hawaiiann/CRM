import type { PlanningBoard, PlanningLesson } from "@/types/models"

export interface BoardProgress {
  lessonsTotal: number
  lessonsDone: number
  itemsTotal: number
  itemsDone: number
  /** Разбивка по названию пункта чек-листа — «презентация», «рабочий лист» и т.п. */
  byItem: { name: string; done: number; total: number }[]
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
