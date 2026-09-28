import { test, expect } from "vitest"
import { orderMatchesQuery } from "../orderSearch"
import type { Order } from "@/types/models"

const order = (over: Partial<Order>): Order => ({
  id: "o1", title: "", client: "Алёна", subject: "Литература", grade: "9 класс", quarter: "1", lesson: "10", status: "queue",
  isPaid: false, priority: false, advanceUsed: 0, advanceAllocations: [], payments: [], paidAmount: 0, taxType: "none", aiRate: 0, urgencyPct: 0,
  start: "", deadline: "", estimatedHours: "", actualHours: "", notes: "", createdAt: 0, linkedLessonId: null, paidAt: null, lines: [],
  ...over,
})

test("ё и е не различаются", () => {
  expect(orderMatchesQuery(order({}), "алена")).toBe(true)
  expect(orderMatchesQuery(order({ client: "Алена" }), "алёна")).toBe(true)
})

test("«урок 10» находит и «10», и «Урок 10», но не «110»", () => {
  expect(orderMatchesQuery(order({ lesson: "10" }), "урок 10")).toBe(true)
  expect(orderMatchesQuery(order({ lesson: "Урок 10" }), "урок 10")).toBe(true)
  expect(orderMatchesQuery(order({ lesson: "110" }), "урок 10")).toBe(false)
})
