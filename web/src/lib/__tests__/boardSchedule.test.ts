import { test, expect } from "vitest"
import { scheduleWeeks, scheduleStatus, weekLabel, scheduleValid, defaultFirstWeekLessons, plannedForWeek } from "../boardSchedule"
import type { PlanningLesson } from "@/types/models"

const lesson = (num: number, done = false): PlanningLesson => ({
  id: "l" + num, num, title: "", color: "gray", colorLocked: false, orderLinked: false, notes: "",
  items: [{ id: "i" + num, text: "Презентация", done }],
})
const lessons = (n: number) => Array.from({ length: n }, (_, i) => lesson(i + 1))

test("старт в понедельник: недели пн–вс, уроки по номерам", () => {
  const weeks = scheduleWeeks([lesson(3), lesson(1), lesson(2), lesson(4), lesson(5)], { start: "2026-08-31", perWeek: 2 })
  expect(weeks.map((w) => w.lessons.map((l) => l.num))).toEqual([[1, 2], [3, 4], [5]])
  expect(weeks[0]).toMatchObject({ start: "2026-08-31", end: "2026-09-06", planned: 2 })
  expect(weeks[1]).toMatchObject({ start: "2026-09-07", end: "2026-09-13" })
  expect(weekLabel(weeks[1])).toBe("7–13 сен")
  expect(weekLabel({ start: "2026-09-29", end: "2026-10-05" })).toBe("29 сен – 5 окт")
})

test("старт в среду: первая неделя короткая, до воскресенья, дальше с понедельника", () => {
  // 2 сентября 2026 — среда. 4 урока в неделю → в первой неделе 3 дня из 5 → 3 урока (округление вверх от 2.4).
  expect(defaultFirstWeekLessons("2026-09-02", 4)).toBe(3)
  expect(defaultFirstWeekLessons("2026-09-04", 2)).toBe(1) // пятница
  expect(defaultFirstWeekLessons("2026-08-31", 4)).toBe(4) // понедельник
  const weeks = scheduleWeeks(lessons(10), { start: "2026-09-02", perWeek: 4 })
  expect(weeks[0]).toMatchObject({ start: "2026-09-02", end: "2026-09-06", planned: 3 })
  expect(weeks[0].lessons.map((l) => l.num)).toEqual([1, 2, 3])
  expect(weeks[1]).toMatchObject({ start: "2026-09-07", end: "2026-09-13", planned: 4 })
  expect(weeks[1].lessons.map((l) => l.num)).toEqual([4, 5, 6, 7])
  expect(weeks[2].lessons.map((l) => l.num)).toEqual([8, 9, 10])
})

test("число уроков в первой неделе и исключения задаются вручную", () => {
  const s = { start: "2026-09-02", perWeek: 4, firstWeekLessons: 4, exceptions: { "3": 0, "4": 2 } }
  expect(plannedForWeek(s, 0)).toBe(4)
  expect(plannedForWeek(s, 2)).toBe(0)
  expect(plannedForWeek(s, 3)).toBe(2)
  const weeks = scheduleWeeks(lessons(12), s)
  expect(weeks.map((w) => w.lessons.map((l) => l.num))).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [], [9, 10], [11, 12]])
  expect(weeks[2]).toMatchObject({ start: "2026-09-14", end: "2026-09-20", planned: 0 })
})

test("статус: текущая неделя, план к сегодняшнему дню и отставание", () => {
  const ls = [lesson(1, true), lesson(2, true), lesson(3), lesson(4), lesson(5), lesson(6)]
  const s = { start: "2026-08-31", perWeek: 2 }
  const isDone = (l: PlanningLesson) => l.items.every((i) => i.done)
  const mid = scheduleStatus(ls, s, "2026-09-16", isDone)
  expect(mid.currentWeek).toBe(2)
  expect(mid.plannedByNow).toBe(4)
  expect(mid.done).toBe(2)
  expect(mid.behind).toBe(2)
  expect(mid.thisWeek.map((l) => l.num)).toEqual([5, 6])
  expect(mid.end).toBe("2026-09-20")

  expect(scheduleStatus(ls, s, "2026-08-20", isDone)).toMatchObject({ currentWeek: -1, plannedByNow: 0, behind: 0 })
  expect(scheduleStatus(ls, s, "2026-10-20", isDone)).toMatchObject({ currentWeek: 3, plannedByNow: 6, behind: 4, thisWeek: [] })
})

test("валидность графика", () => {
  expect(scheduleValid({ start: "2026-09-01", perWeek: 2 })).toBe(true)
  expect(scheduleValid({ start: "", perWeek: 2 })).toBe(false)
  expect(scheduleValid({ start: "2026-09-01", perWeek: 0 })).toBe(false)
  expect(scheduleValid(undefined)).toBe(false)
})
