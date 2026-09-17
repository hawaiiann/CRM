import { describe, test, expect } from "vitest"
import { paymentBreakdown, orderPaymentState, clientDebt, ordersOfClient } from "../money"
import { clientAdvanceRows, advanceAllocated, orderUnallocatedAdvance, allocateGreedy, clientUnallocatedAdvance, getClientAdvanceStats } from "../advances"
import { revenueEventsForOrder, revenueForMonth, revenueEvents, orderRecognizedRevenue } from "../dashboardMetrics"
import { planCatalogRename } from "../catalogRename"
import { defaultAppSettings } from "../normalize"
import type { Order, Advance, PlanningBoard } from "@/types/models"

const order = (over: Partial<Order>): Order => ({
  id: "o1", title: "", client: "Школа", subject: "Математика", grade: "5 класс", quarter: "1", lesson: "3", status: "progress",
  isPaid: false, priority: false, advanceUsed: 0, advanceAllocations: [], payments: [], paidAmount: 0, taxType: "none", start: "2026-08-01", deadline: "2026-08-10",
  estimatedHours: "", actualHours: "", notes: "", createdAt: 0, linkedLessonId: null, paidAt: null,
  lines: [{ id: "l1", label: "Презентация", type: "Слайд", qty: 10, pomoHours: 0, rate: 100, ignorePrice: false, ready: false }],
  ...over,
})
const advances: Advance[] = [
  { id: "a1", client: "Школа", amount: 500, date: "2026-07-01", note: "" },
  { id: "a2", client: "Школа", amount: 800, date: "2026-08-05", note: "" },
  { id: "a9", client: "Другой", amount: 999, date: "2026-08-05", note: "" },
]

describe("paymentBreakdown", () => {
  test("аванс, потом деньги, остаток не уходит в минус, переплата видна", () => {
    expect(paymentBreakdown(1000, 300, 200)).toMatchObject({ full: 1000, advUsed: 300, paidMoney: 200, covered: 500, remaining: 500, overpaid: 0, isFullyPaid: false })
    expect(paymentBreakdown(1000, 600, 900)).toMatchObject({ advUsed: 600, paidMoney: 400, remaining: 0, overpaid: 500, isFullyPaid: true })
    expect(paymentBreakdown(0, 0, 0).isFullyPaid).toBe(false)
  })
  test("orderPaymentState считает с налогом, долг клиента без отменённых", () => {
    const o = order({ taxType: "individual", payments: [{ id: "p", amount: 540, date: "2026-08-02", note: "" }] })
    expect(orderPaymentState(o)).toMatchObject({ full: 1040, remaining: 500 })
    expect(clientDebt([o, order({ id: "x", status: "cancelled" })], "школа")).toBe(500)
    expect(ordersOfClient([o], "ШКОЛА ")).toHaveLength(1)
  })
})

describe("авансы по строкам", () => {
  const o1 = order({ id: "o1", advanceUsed: 600, advanceAllocations: [{ advanceId: "a1", amount: 500 }, { advanceId: "a2", amount: 100 }] })
  const o2 = order({ id: "o2", advanceUsed: 200 })

  test("остаток каждого аванса, без привязки — отдельно", () => {
    const rows = clientAdvanceRows("Школа", advances, [o1, o2])
    expect(rows.map((r) => r.advance.id)).toEqual(["a1", "a2"])
    expect(rows.map((r) => r.available)).toEqual([0, 700])
    expect(advanceAllocated("a2", [o1, o2])).toBe(100)
    expect(orderUnallocatedAdvance(o2)).toBe(200)
    expect(orderUnallocatedAdvance(o1)).toBe(0)
    expect(clientUnallocatedAdvance("Школа", [o1, o2])).toBe(200)
    expect(getClientAdvanceStats("Школа", advances, [o1, o2])).toEqual({ totalIn: 1300, used: 800, available: 500 })
  })
  test("текущий заказ не «съедает» свой остаток; отменённый аванс не расходует", () => {
    expect(clientAdvanceRows("Школа", advances, [o1, o2], "o1")[0].available).toBe(500)
    expect(advanceAllocated("a1", [{ ...o1, status: "cancelled" }])).toBe(0)
  })
  test("жадное распределение: старые первыми, не больше остатка", () => {
    expect(allocateGreedy(clientAdvanceRows("Школа", advances, []), 900)).toEqual([{ advanceId: "a1", amount: 500 }, { advanceId: "a2", amount: 400 }])
    expect(allocateGreedy(clientAdvanceRows("Школа", advances, [o1, o2]), 50)).toEqual([{ advanceId: "a2", amount: 50 }])
  })
})

describe("выручка по датам денег", () => {
  const o1 = order({ id: "o1", advanceUsed: 600, advanceAllocations: [{ advanceId: "a1", amount: 500 }, { advanceId: "a2", amount: 100 }] })
  const o3 = order({ id: "o3", advanceUsed: 200, payments: [{ id: "p", amount: 300, date: "2026-09-02", note: "" }] })
  const o4 = order({ id: "o4", advanceUsed: 600, advanceAllocations: [{ advanceId: "a2", amount: 600 }], payments: [{ id: "p", amount: 900, date: "2026-09-02", note: "" }] })

  test("списания — датой аванса, без привязки — датой первого аванса клиента", () => {
    expect(revenueEventsForOrder(o1, advances).map((e) => [e.date, e.revenue])).toEqual([["2026-07-01", 500], ["2026-08-05", 100]])
    expect(revenueEventsForOrder(o3, advances).map((e) => [e.date, e.revenue])).toEqual([["2026-07-01", 200], ["2026-09-02", 300]])
  })
  test("обрезка стоимостью заказа и суммы по месяцам", () => {
    expect(revenueEventsForOrder(o4, advances).map((e) => e.revenue)).toEqual([600, 400])
    const all = revenueEvents([o1, o3, o4, { ...o1, id: "x", status: "cancelled" }], advances)
    expect(revenueForMonth(all, 2026, 6)).toBe(700)
    expect(revenueForMonth(all, 2026, 7)).toBe(700)
    expect(revenueForMonth(all, 2026, 8)).toBe(700)
    // итог по событиям равен признанной выручке «сейчас»
    const total = all.reduce((s, e) => s + e.revenue, 0)
    expect(total).toBe([o1, o3, o4].reduce((s, o) => s + orderRecognizedRevenue(o).revenue, 0))
  })
})

describe("каскадное переименование справочников", () => {
  const settings = { ...defaultAppSettings(), clients: ["Школа", "Другой"], hiddenEntries: { ...defaultAppSettings().hiddenEntries, clients: ["Школа"] } }
  const boards: PlanningBoard[] = [{ id: "pb", subject: "Математика", title: "5 класс", quarter: "1", deadline: "", baseTemplate: [], collapsed: false, archived: false, lessons: [] }]
  const o1 = order({})
  const data = { settings, orders: [o1], advances, planningBoards: boards }

  test("клиент: заказы, авансы, скрытость переезжают", () => {
    const plan = planCatalogRename("clients", "Школа", "Школа №1", { ...data, orders: [o1, order({ id: "o2" }), order({ id: "z", client: "Другой" })] })
    expect(plan.touched).toEqual({ orders: 2, advances: 2, boards: 0, lines: 0 })
    expect(plan.orders[2].client).toBe("Другой")
    expect(plan.advances[0].client).toBe("Школа №1")
    expect(plan.settings.clients).toEqual(["Школа №1", "Другой"])
    expect(plan.settings.hiddenEntries.clients).toEqual(["Школа №1"])
    expect(plan.merges).toBe(false)
  })
  test("слияние с существующим именем", () => {
    const plan = planCatalogRename("clients", "Школа", "другой", data)
    expect(plan.merges).toBe(true)
    expect(plan.settings.clients).toEqual(["Другой"])
    expect(plan.orders[0].client).toBe("другой")
  })
  test("предмет и класс — в заказы и доски; тип и единица — в позиции", () => {
    let plan = planCatalogRename("subjects", "Математика", "Алгебра", data)
    expect(plan.orders[0].subject).toBe("Алгебра"); expect(plan.planningBoards[0].subject).toBe("Алгебра"); expect(plan.touched.boards).toBe(1)
    plan = planCatalogRename("classes", "5 класс", "5А", data)
    expect(plan.orders[0].grade).toBe("5А"); expect(plan.planningBoards[0].title).toBe("5А")
    plan = planCatalogRename("types", "Презентация", "Презентация PDF", data)
    expect(plan.orders[0].lines[0].label).toBe("Презентация PDF"); expect(plan.touched).toEqual({ orders: 1, advances: 0, boards: 0, lines: 1 })
    plan = planCatalogRename("units", "Слайд", "Слайды", data)
    expect(plan.orders[0].lines[0].type).toBe("Слайды")
  })
  test("пустое или то же имя ничего не меняет", () => {
    const plan = planCatalogRename("clients", "Школа", "  ", data)
    expect(plan.orders[0]).toBe(o1)
    expect(plan.settings).toBe(settings)
  })
})
