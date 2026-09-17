import { test, expect } from "vitest"
import { syncPlanningWithOrders, orderMatchesLessonFuzzy, applyLessonItemsToOrderLines } from "../planningSync"
import { lessonDisplayColor, isLessonDone } from "../planningStats"
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

test("галочка в уроке делает позицию заказа готовой и наоборот", () => {
  const o = order({})
  const l = board([{ id: "i1", text: "презентация", done: true }]).lessons[0]
  const next = applyLessonItemsToOrderLines(o, l)
  expect(next).not.toBe(o)
  expect(next.lines[0].ready).toBe(true)
  // Уже совпадает — тот же объект, без лишнего сохранения.
  expect(applyLessonItemsToOrderLines(next, l)).toBe(next)
  // Пункт, которого нет среди позиций, ничего не меняет.
  expect(applyLessonItemsToOrderLines(o, board([{ id: "i2", text: "Карточка", done: true }]).lessons[0])).toBe(o)
})

test("цвет клетки — по чек-листу, заказ «в очереди» его не перекрывает", () => {
  const items = [{ id: "i1", text: "Презентация", done: true }, { id: "i2", text: "Рабочий лист", done: true }]
  const queued = order({ status: "queue", lines: [{ id: "l1", label: "Презентация", type: "Слайд", qty: 1, pomoHours: 0, rate: 0, ignorePrice: false, ready: true }] })
  const r = syncPlanningWithOrders([queued], [board(items)])
  expect(r[0].lessons[0].color).toBe("green-3")
  expect(r[0].lessons[0].orderLinked).toBe(true)
  expect(lessonDisplayColor(r[0].lessons[0], queued)).toBe("green-3")
  expect(isLessonDone(r[0].lessons[0])).toBe(true)

  const empty = board([{ id: "i1", text: "Презентация", done: false }]).lessons[0]
  expect(lessonDisplayColor(empty, order({ status: "progress" }))).toBe("yellow")
  expect(lessonDisplayColor(empty, order({ status: "queue" }))).toBe("gray")
  expect(lessonDisplayColor({ ...empty, colorLocked: true, color: "red" }, null)).toBe("red")
  expect(isLessonDone({ ...empty, colorLocked: true, color: "green-1" })).toBe(false)
  expect(isLessonDone({ ...empty, colorLocked: true, color: "green-3" })).toBe(true)
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
