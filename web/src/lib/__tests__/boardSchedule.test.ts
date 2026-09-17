import { test, expect } from "vitest"
import { scheduleWeeks, scheduleStatus, weekLabel, scheduleValid } from "../boardSchedule"
import type { PlanningLesson } from "@/types/models"

const lesson = (num: number, done = false): PlanningLesson => ({
  id: "l" + num, num, title: "", color: "gray", colorLocked: false, orderLinked: false, notes: "",
  items: [{ id: "i" + num, text: "Презентация", done }],
})

test("уроки раскладываются по неделям от даты старта, по номерам", () => {
  const lessons = [lesson(3), lesson(1), lesson(2), lesson(4), lesson(5)]
  const weeks = scheduleWeeks(lessons, { start: "2026-09-01", perWeek: 2 })
  expect(weeks.map((w) => w.lessons.map((l) => l.num))).toEqual([[1, 2], [3, 4], [5]])
  expect(weeks[0]).toMatchObject({ start: "2026-09-01", end: "2026-09-07" })
  expect(weeks[1]).toMatchObject({ start: "2026-09-08", end: "2026-09-14" })
  expect(weekLabel(weeks[0])).toBe("1–7 сен")
  expect(weekLabel({ start: "2026-09-29", end: "2026-10-05" })).toBe("29 сен – 5 окт")
})

test("статус: текущая неделя, план к сегодняшнему дню и отставание", () => {
  const lessons = [lesson(1, true), lesson(2, true), lesson(3), lesson(4), lesson(5), lesson(6)]
  const s = { start: "2026-09-01", perWeek: 2 }
  const isDone = (l: PlanningLesson) => l.items.every((i) => i.done)
  const mid = scheduleStatus(lessons, s, "2026-09-16", isDone)
  expect(mid.currentWeek).toBe(2)
  expect(mid.plannedByNow).toBe(4)
  expect(mid.done).toBe(2)
  expect(mid.behind).toBe(2)
  expect(mid.thisWeek.map((l) => l.num)).toEqual([5, 6])
  expect(mid.end).toBe("2026-09-21")

  expect(scheduleStatus(lessons, s, "2026-08-20", isDone)).toMatchObject({ currentWeek: -1, plannedByNow: 0, behind: 0 })
  expect(scheduleStatus(lessons, s, "2026-10-20", isDone)).toMatchObject({ currentWeek: 3, plannedByNow: 6, behind: 4, thisWeek: [] })
})

test("валидность графика", () => {
  expect(scheduleValid({ start: "2026-09-01", perWeek: 2 })).toBe(true)
  expect(scheduleValid({ start: "", perWeek: 2 })).toBe(false)
  expect(scheduleValid({ start: "2026-09-01", perWeek: 0 })).toBe(false)
  expect(scheduleValid(undefined)).toBe(false)
})
