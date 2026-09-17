import type { Order, PlanningBoard, PlanningLesson } from "@/types/models"

export interface BoardProgress {
  lessonsTotal: number
  lessonsDone: number
  itemsTotal: number
  itemsDone: number
  /** Разбивка по названию пункта чек-листа — «презентация», «рабочий лист» и т.п. */
  byItem: { name: string; done: number; total: number }[]
}

export type LessonColor = "gray" | "yellow" | "green-1" | "green-2" | "green-3" | "red" | "empty"

/**
 * Урок без материала: номер нужен для нумерации и графика, а делать для
 * него нечего. Хранится как закреплённый цвет "empty" (colorLocked), чтобы
 * не добавлять колонку в planning_lessons. Такой урок не входит в прогресс
 * и не считается отставанием.
 */
export function isLessonEmpty(l: PlanningLesson): boolean {
  return !!l.colorLocked && l.color === "empty"
}

/** Доля закрытых пунктов чек-листа: 0…1; без пунктов — 0. */
export function lessonRatio(l: PlanningLesson): number {
  const items = l.items || []
  if (!items.length) return 0
  return items.filter((i) => i.done).length / items.length
}

/**
 * Цвет клетки урока — одна функция для сетки, тайлов прогресса, экспорта и
 * автосинхронизации (syncPlanningWithOrders пишет её результат в lesson.color).
 *
 * Правило: цвет считается по чек-листу, всегда. Закрыто всё — green-3, больше
 * половины — green-2, что-то — green-1. Ничего не закрыто: жёлтый, если заказ
 * в работе или на согласовании, иначе серый. Закреплённый вручную цвет
 * побеждает.
 *
 * Раньше статус заказа перекрывал чек-лист целиком: заказ «в очереди» держал
 * клетку серой, даже когда все пункты уже отмечены, — и в сетке не было видно,
 * что урок по факту готов.
 */
export function lessonDisplayColor(l: PlanningLesson, order?: Order | null): LessonColor {
  if (l.colorLocked) return (l.color as LessonColor) || "gray"
  const ratio = lessonRatio(l)
  if (ratio >= 0.99) return "green-3"
  if (ratio >= 0.5) return "green-2"
  if (ratio > 0) return "green-1"
  if (order && (order.status === "progress" || order.status === "review")) return "yellow"
  return "gray"
}

/**
 * Урок готов: все пункты закрыты, либо цвет закреплён вручную как «Готово».
 * Раньше готовым считался любой зелёный оттенок — урок с одним пунктом из
 * трёх попадал в «сделанные» на тайле доски.
 */
export function isLessonDone(l: PlanningLesson): boolean {
  if (l.colorLocked) return l.color === "green-3"
  if (isLessonEmpty(l)) return false
  const items = l.items || []
  return items.length > 0 && items.every((i) => i.done)
}

/**
 * Прогресс одной доски (класса): сколько уроков закрыто, сколько пунктов
 * чек-листа выполнено — целиком и по каждому названию пункта отдельно.
 * Тот же расчёт использует экспорт в CSV (PlanningExportDialog).
 */
export function computeBoardProgress(board: PlanningBoard): BoardProgress {
  const lessons = board.lessons || []
  let itemsTotal = 0
  let itemsDone = 0
  let lessonsDone = 0
  const byItemMap: Record<string, { done: number; total: number }> = {}

  lessons.forEach((l) => {
    if (isLessonEmpty(l)) return
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
    lessonsTotal: lessons.filter((l) => !isLessonEmpty(l)).length,
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
