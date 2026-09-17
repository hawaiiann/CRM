import { test, expect } from "vitest"
import { actOrders, actRows, actTotals, lineLabel, actFilename, monthLabel } from "../act"
import type { Order } from "@/types/models"

const order = (id: string, deadline: string, over: Partial<Order> = {}): Order => ({
  id, title: "", client: "Эстетичные уроки", subject: "Литература", grade: "9 класс", quarter: "1", lesson: id, status: "done",
  isPaid: false, priority: false, advanceUsed: 0, advanceAllocations: [], payments: [], paidAmount: 0, taxType: "individual", start: "", deadline,
  estimatedHours: "", actualHours: "", notes: "", createdAt: 0, linkedLessonId: null, paidAt: null,
  lines: [
    { id: "l1", label: "Презентация", type: "Слайд", qty: 10, pomoHours: 0, rate: 260, ignorePrice: false, ready: true },
    { id: "l2", label: "Карточка с вопросами", type: "Час", qty: 1, pomoHours: 0.5, rate: 900, ignorePrice: false, ready: true },
  ],
  ...over,
})

test("в акт входят сданные заказы клиента за месяц по сроку сдачи, по порядку", () => {
  const orders = [
    order("3", "2026-08-20"),
    order("1", "2026-08-02"),
    order("x", "2026-07-30"),
    order("q", "2026-08-10", { status: "progress" }),
    order("c", "2026-08-11", { status: "cancelled" }),
    order("o", "2026-08-12", { client: "Другой" }),
  ]
  expect(actOrders(orders, "эстетичные уроки", 2026, 7).map((o) => o.id)).toEqual(["1", "3"])
  expect(actOrders(orders, "Эстетичные уроки", 2026, 7, { onlyDone: false }).map((o) => o.id)).toEqual(["1", "q", "3"])
})

test("строки и итоги: состав словами, сумма с налогом, аванс и деньги", () => {
  const o1 = order("1", "2026-08-02", { advanceUsed: 1000 })
  const o2 = order("2", "2026-08-05", { payments: [{ id: "p", amount: 3000, date: "2026-08-06", note: "" }] })
  const rows = actRows([o1, o2])
  expect(rows[0]).toMatchObject({ n: 1, title: "Литература, 9 класс, Урок 1", composition: "Презентация: 10 Слайд × 260; Карточка с вопросами: 0.5 ч × 900", total: 3172 })
  expect(lineLabel({ id: "l", label: "Правки", type: "Слайд", qty: 3, pomoHours: 0, rate: 0, ignorePrice: true, ready: false })).toBe("Правки (без оплаты)")
  expect(actTotals([o1, o2])).toEqual({ total: 6344, advance: 1000, paid: 3000, remaining: 2344 })
})

test("имя файла и подпись месяца", () => {
  expect(monthLabel(2026, 7)).toBe("август 2026")
  expect(actFilename("Эстетичные уроки", 2026, 7)).toBe("akt-эстетичные-уроки-2026-08.xlsx")
})
