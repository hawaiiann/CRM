import { test, expect } from "vitest"
import { syncPlanningWithOrders, orderMatchesLessonFuzzy } from "../planningSync"
import { unlinkOrdersFromLessons, planUnlink } from "../planningOrderSync"
import type { Order, PlanningBoard } from "@/types/models"

const order = (over: Partial<Order>): Order => ({
  id: "o1", title: "", client: "", subject: "Математика", grade: "5 класс", quarter: "1", lesson: "3", status: "progress",
  isPaid: false, priority: false, advanceUsed: 0, advanceAllocations: [], payments: [], paidAmount: 0, taxType: "none", start: "", deadline: "",
  estimatedHours: "", actualHours: "", notes: "", createdAt: 0, linkedLessonId: null, paidAt: null,
  lines: [{ id: "l1", label: "Презентация", type: "Слайд", qty: 1, pomoHours: 0, rate: 0, ignorePrice: false, ready: false }],
  ...over,
})
const board = (items: PlanningBoard["lessons"][number]["items"]): PlanningBoard => ({
  id: "pb", subject: "Математика", title: "5 класс", quarter: "1", deadline: "", baseTemplate: [], collapsed: false, archived: false,
  lessons: [{ id: "L3", num: 3, title: "", color: "gray", items, colorLocked: false, orderLinked: false, notes: "" }],
})

test("ручная галочка не откатывается заказом с неготовой позицией", () => {
  const r = syncPlanningWithOrders([order({})], [board([{ id: "i1", text: "Презентация", done: true }])])
  expect(r[0].lessons[0].items[0].done).toBe(true)
})

test("готовая позиция закрывает ручной пункт", () => {
  const ready = order({ lines: [{ id: "l1", label: "Презентация", type: "Слайд", qty: 1, pomoHours: 0, rate: 0, ignorePrice: false, ready: true }] })
  const r = syncPlanningWithOrders([ready], [board([{ id: "i1", text: "Презентация", done: false }])])
  expect(r[0].lessons[0].items[0].done).toBe(true)
})

test("пункт из заказа следует за позицией в обе стороны", () => {
  const r = syncPlanningWithOrders([order({})], [board([{ id: "i1", text: "Презентация", done: true, fromOrder: true }])])
  expect(r[0].lessons[0].items[0].done).toBe(false)
})

test("нечёткая привязка и её разрыв", () => {
  const b = board([])
  expect(orderMatchesLessonFuzzy(order({}), b, b.lessons[0])).toBe(true)
  expect(orderMatchesLessonFuzzy(order({ lesson: "4" }), b, b.lessons[0])).toBe(false)
  const plan = planUnlink(order({ linkedLessonId: "L3" }), b, b.lessons[0])
  expect(plan).toMatchObject({ possible: true, clearsExplicitLink: true, clearsLessonNumber: true })
  expect(plan.orderPatch).toEqual({ linkedLessonId: null, lesson: "" })
})

test("снятие привязок у заказов удалённых уроков", () => {
  const orders = [order({ id: "a", linkedLessonId: "L3" }), order({ id: "b", linkedLessonId: "L9" }), order({ id: "c" })]
  const next = unlinkOrdersFromLessons(orders, ["L3"])
  expect(next[0].linkedLessonId).toBeNull()
  expect(next[1].linkedLessonId).toBe("L9")
  expect(next[2]).toBe(orders[2])
  expect(unlinkOrdersFromLessons(orders, [])).toBe(orders)
  expect(unlinkOrdersFromLessons(orders, ["nope"])).toBe(orders)
})
