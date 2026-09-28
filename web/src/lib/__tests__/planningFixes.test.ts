import { test, expect } from "vitest"
import { syncPlanningWithOrders, orderMatchesLessonFuzzy, findGoverningOrder, findLessonForOrder, fuzzyTargetForOrder, gradeKey } from "../planningSync"
import { planLessonNums } from "../planningStats"
import type { Order, PlanningBoard, PlanningLesson } from "@/types/models"

const order = (over: Partial<Order>): Order => ({
  id: "o1", title: "", client: "", subject: "Математика", grade: "5 класс", quarter: "1", lesson: "3", status: "progress",
  isPaid: false, priority: false, advanceUsed: 0, advanceAllocations: [], payments: [], paidAmount: 0, taxType: "none", aiRate: 0, urgencyPct: 0, start: "", deadline: "",
  estimatedHours: "", actualHours: "", notes: "", createdAt: 0, linkedLessonId: null, paidAt: null,
  lines: [{ id: "l1", label: "Презентация", type: "Слайд", qty: 1, pomoHours: 0, rate: 0, ignorePrice: false, ready: false }],
  ...over,
})
const lesson = (id: string, num: number, items: PlanningLesson["items"] = []): PlanningLesson => ({
  id, num, title: "", color: "gray", items, colorLocked: false, orderLinked: false, notes: "",
})
const board = (id: string, over: Partial<PlanningBoard> = {}): PlanningBoard => ({
  id, subject: "Математика", title: "5 класс", quarter: "1", deadline: "", baseTemplate: [], collapsed: false, archived: false,
  lessons: [lesson(id + "_L3", 3)],
  ...over,
})

test("класс сравнивается целиком: «1 класс» не ловит «11 класс», «9 класс» = «9»", () => {
  expect(gradeKey("9 класс")).toBe("9")
  expect(gradeKey(" 9  Класс ")).toBe("9")
  expect(gradeKey("9А")).toBe("9а")
  expect(gradeKey("9 а класс")).toBe("9а")
  expect(gradeKey("11 класс")).toBe("11")

  const b1 = board("b1", { title: "1 класс" })
  expect(orderMatchesLessonFuzzy(order({ grade: "11 класс" }), b1, b1.lessons[0])).toBe(false)
  const b11 = board("b11", { title: "11 класс" })
  expect(orderMatchesLessonFuzzy(order({ grade: "1 класс" }), b11, b11.lessons[0])).toBe(false)
  const b9 = board("b9", { title: "9 класс" })
  expect(orderMatchesLessonFuzzy(order({ grade: "9" }), b9, b9.lessons[0])).toBe(true)
  const b9a = board("b9a", { title: "9А" })
  expect(orderMatchesLessonFuzzy(order({ grade: "9а класс" }), b9a, b9a.lessons[0])).toBe(true)
  expect(orderMatchesLessonFuzzy(order({ grade: "9б" }), b9a, b9a.lessons[0])).toBe(false)
})

test("нечёткое совпадение не трогает архив и применяется к одной доске", () => {
  const archived = board("old", { archived: true })
  const current = board("cur")
  const o = order({})
  const r = syncPlanningWithOrders([o], [archived, current])
  expect(r[0].lessons[0].orderLinked).toBe(false)
  expect(r[0].lessons[0].items).toEqual([])
  expect(r[1].lessons[0].orderLinked).toBe(true)
  expect(findGoverningOrder([o], archived, archived.lessons[0], [archived, current])).toBeNull()
  expect(findGoverningOrder([o], archived, archived.lessons[0])).toBeNull()
  expect(findLessonForOrder([archived, current], o)?.board.id).toBe("cur")

  // Две живые доски: без дат — последняя в списке.
  const a = board("a")
  const b = board("b")
  const two = syncPlanningWithOrders([o], [a, b])
  expect(two.map((x) => x.lessons[0].orderLinked)).toEqual([false, true])
  expect(findGoverningOrder([o], a, a.lessons[0], [a, b])).toBeNull()
  expect(findGoverningOrder([o], b, b.lessons[0], [a, b])).toBe(o)
  // Старый вызов без списка досок (карточка урока) опирается на orderLinked
  // после синхронизации и показывает то же самое.
  expect(findGoverningOrder([o], two[0], two[0].lessons[0])).toBeNull()
  expect(findGoverningOrder([o], two[1], two[1].lessons[0])).toBe(o)

  // С датами — доска с дедлайном ближе к сроку заказа, даже если она раньше в списке.
  const thisYear = board("now", { deadline: "2026-10-30" })
  const lastYear = board("prev", { deadline: "2025-10-30" })
  const dated = order({ deadline: "2026-10-10" })
  expect(fuzzyTargetForOrder(dated, [thisYear, lastYear])?.board.id).toBe("now")
  const synced = syncPlanningWithOrders([dated], [thisYear, lastYear])
  expect(synced.map((x) => x.lessons[0].orderLinked)).toEqual([true, false])
})

test("явная привязка по-прежнему сильнее нечёткой и работает и в архиве", () => {
  const archived = board("old", { archived: true })
  const current = board("cur")
  const o = order({ linkedLessonId: "old_L3" })
  const r = syncPlanningWithOrders([o], [archived, current])
  expect(r[0].lessons[0].orderLinked).toBe(true)
  expect(r[1].lessons[0].orderLinked).toBe(false)
  expect(findGoverningOrder([o], archived, archived.lessons[0], [archived, current])).toBe(o)
  expect(findGoverningOrder([o], current, current.lessons[0], [archived, current])).toBeNull()
  expect(findLessonForOrder([archived, current], o)?.board.id).toBe("old")
})

test("несколько заказов на урок: управляет один, и он не сбрасывает галочку другого", () => {
  const b = board("b", { lessons: [lesson("L3", 3, [{ id: "i1", text: "Презентация", done: true, fromOrder: true }])] })
  const older = order({ id: "old", createdAt: 1, lines: [{ id: "l1", label: "Презентация", type: "Слайд", qty: 1, pomoHours: 0, rate: 0, ignorePrice: false, ready: true }] })
  const newer = order({ id: "new", createdAt: 2 })
  // Порядок массива не важен — управляет самый свежий.
  expect(findGoverningOrder([newer, older], b, b.lessons[0], [b])).toBe(newer)
  expect(findGoverningOrder([older, newer], b, b.lessons[0], [b])).toBe(newer)
  const r1 = syncPlanningWithOrders([older, newer], [b])
  const r2 = syncPlanningWithOrders([newer, older], [b])
  expect(r1[0].lessons[0].items[0].done).toBe(false)
  expect(r2[0].lessons[0].items[0].done).toBe(false)

  // Галочка, поставленная в уроке, переносится в управляющий заказ — и второй
  // заказ её больше не откатывает.
  const ticked = { ...newer, lines: newer.lines.map((l) => ({ ...l, ready: true })) }
  const oldNotReady = { ...older, lines: older.lines.map((l) => ({ ...l, ready: false })) }
  const r3 = syncPlanningWithOrders([ticked, oldNotReady], [b])
  expect(r3[0].lessons[0].items[0].done).toBe(true)
})

test("привязка к удалённому уроку: синхронизация, карточка урока и карточка заказа видят одно и то же", () => {
  const b = board("b")
  const o = order({ linkedLessonId: "gone" })
  const r = syncPlanningWithOrders([o], [b])
  expect(r[0].lessons[0].orderLinked).toBe(true)
  expect(findGoverningOrder([o], r[0], r[0].lessons[0], r)).toBe(o)
  // Без списка досок — по признаку orderLinked, который ставит синхронизация.
  expect(findGoverningOrder([o], r[0], r[0].lessons[0])).toBe(o)
  expect(findLessonForOrder(r, o)?.lesson.id).toBe("b_L3")

  // Привязка к живому уроку другой доски — этот урок заказ не ведёт.
  const other = board("other", { title: "6 класс", lessons: [lesson("X1", 1)] })
  const linkedElsewhere = order({ linkedLessonId: "X1" })
  const r2 = syncPlanningWithOrders([linkedElsewhere], [b, other])
  expect(r2[0].lessons[0].orderLinked).toBe(false)
  expect(findGoverningOrder([linkedElsewhere], r2[0], r2[0].lessons[0], r2)).toBeNull()
  expect(findGoverningOrder([linkedElsewhere], r2[0], r2[0].lessons[0])).toBeNull()
})

test("номера уроков в форме класса: без правки диапазона ничего не добавляется", () => {
  // Редактирование: уроки 1, 2, 4, 5 (3-й удалён) — форма открылась с 1…5.
  expect(planLessonNums([1, 2, 4, 5], null)).toEqual([1, 2, 4, 5])
  // Диапазон изменили — добавляет всё от … до.
  expect(planLessonNums([1, 2, 4, 5], { from: 1, to: 7 })).toEqual([1, 2, 3, 4, 5, 6, 7])
  // Убранные крестиком вычитаются.
  expect(planLessonNums([1, 2, 4, 5], null, [2])).toEqual([1, 4, 5])
  // Новый класс: 1…24 по умолчанию.
  expect(planLessonNums([], { from: 1, to: 24 })).toHaveLength(24)
  expect(planLessonNums([], { from: 5, to: 3 })).toEqual([3, 4, 5])
})
