import { test, expect } from "vitest"
import { boardTemplateLines, buildOrderPrefillFromLesson, boardOrders } from "../boardTemplate"
import { defaultAppSettings } from "../normalize"
import type { Order, PlanningBoard } from "@/types/models"

const order = (over: Partial<Order>): Order => ({
  id: "o1", title: "", client: "Эстетичные уроки", subject: "Литература", grade: "9 класс", quarter: "1", lesson: "3", status: "done",
  isPaid: false, priority: false, advanceUsed: 0, advanceAllocations: [], payments: [], paidAmount: 0, taxType: "individual", start: "", deadline: "",
  estimatedHours: "", actualHours: "", notes: "", createdAt: 10, linkedLessonId: null, paidAt: null,
  lines: [
    { id: "l1", label: "Презентация", type: "Слайд", qty: 7, pomoHours: 0, rate: 290, ignorePrice: false, ready: true },
    { id: "l2", label: "Карточка с вопросами", type: "Час", qty: 1, pomoHours: 0.5, rate: 900, ignorePrice: false, ready: false },
  ],
  ...over,
})
const board: PlanningBoard = {
  id: "pb9", subject: "Литература", title: "9 класс", quarter: "1 четверть", deadline: "2026-10-01", baseTemplate: ["Презентация", "Рабочий лист"],
  collapsed: false, archived: false,
  lessons: [3, 4].map((n) => ({ id: "L" + n, num: n, title: "", color: "gray", colorLocked: false, orderLinked: false, notes: "", items: [
    { id: "a" + n, text: "Презентация", done: n === 3 }, { id: "b" + n, text: "Рабочий лист", done: false },
  ] })),
}
const settings = { ...defaultAppSettings(), clients: ["Эстетичные уроки"] }
let n = 0
const defaults = { unit: "Слайд", makeId: () => "id" + n++ }

test("шаблон доски без настроек подсматривает ставки в последнем заказе доски", () => {
  const lines = boardTemplateLines(settings, board, [order({})], "Слайд")
  expect(lines).toEqual([
    { label: "Презентация", type: "Слайд", qty: 7, rate: 290 },
    { label: "Рабочий лист", type: "Слайд", qty: 1, rate: 0 },
  ])
  expect(boardOrders([order({}), order({ id: "x", grade: "6 класс" })], board).map((o) => o.id)).toEqual(["o1"])
})

test("сохранённый шаблон имеет приоритет", () => {
  const s = { ...settings, boardTemplates: { pb9: [{ label: "Презентация", type: "Слайд", qty: 12, rate: 260 }] } }
  expect(boardTemplateLines(s, board, [order({})], "Слайд")[0].rate).toBe(260)
})

test("заказ из урока: поля доски, цены шаблона, готовность из чек-листа, клиент и налог из последнего заказа", () => {
  const tpl = [{ label: "Презентация", type: "Слайд", qty: 12, rate: 260 }, { label: "Рабочий лист", type: "Страница", qty: 2, rate: 200 }]
  const p = buildOrderPrefillFromLesson(board, board.lessons[0], tpl, [order({})], settings, defaults)
  expect(p).toMatchObject({ subject: "Литература", grade: "9 класс", quarter: "1 четверть", lesson: "3", linkedLessonId: "L3", client: "Эстетичные уроки", taxType: "individual", deadline: "2026-10-01" })
  expect(p.lines!.map((l) => [l.label, l.type, l.qty, l.rate, l.ready])).toEqual([
    ["Презентация", "Слайд", 12, 260, true],
    ["Рабочий лист", "Страница", 2, 200, false],
  ])
})

test("без заказов клиент берётся из справочника, если он один; пустой чек-лист — состав из шаблона", () => {
  const empty: PlanningBoard = { ...board, deadline: "", lessons: [{ ...board.lessons[0], items: [] }] }
  const p = buildOrderPrefillFromLesson(empty, empty.lessons[0], [{ label: "Презентация", type: "Слайд", qty: 10, rate: 260 }], [], settings, defaults)
  expect(p.client).toBe("Эстетичные уроки")
  expect(p.taxType).toBe("none")
  expect(p).not.toHaveProperty("deadline")
  expect(p.lines).toHaveLength(1)
  expect(buildOrderPrefillFromLesson(empty, empty.lessons[0], [], [], { ...settings, clients: ["A", "B"] }, defaults).client).toBe("")
})
