import { describe, test, expect } from "vitest"
import { orderPaymentState, orderTotal } from "../money"
import { clientKey, uniqueClientNames, ordersOfClientKey, getClientAdvanceStats, clientUnallocatedAdvance } from "../advances"
import { ordersPriceTotal, revenueEventsForOrder } from "../dashboardMetrics"
import { planCatalogRename } from "../catalogRename"
import { syncPlanningWithOrders } from "../planningSync"
import { defaultAppSettings } from "../normalize"
import type { Order, OrderLine, AppSettings, PlanningBoard, PlanningLesson } from "@/types/models"

const line = (over: Partial<OrderLine>): OrderLine => ({
  id: "l1", label: "Презентация", type: "Слайд", qty: 10, pomoHours: 0, rate: 100, ignorePrice: false, ready: false, ...over,
})
const order = (over: Partial<Order>): Order => ({
  id: "o1", title: "", client: "Школа №1", subject: "Математика", grade: "5 класс", quarter: "1", lesson: "3", status: "progress",
  isPaid: false, priority: false, advanceUsed: 0, advanceAllocations: [], payments: [], paidAmount: 0, taxType: "none", aiRate: 0, urgencyPct: 0, start: "2026-08-01", deadline: "2026-08-10",
  estimatedHours: "", actualHours: "", notes: "", createdAt: 0, linkedLessonId: null, paidAt: null,
  lines: [line({})],
  ...over,
})

describe("итоги списка — по округлённой цене каждого заказа", () => {
  test("два заказа по 1013 ₽ + 4%: сумма совпадает с «к доплате»", () => {
    const list = [order({ id: "a", taxType: "individual", lines: [line({ qty: 1, rate: 1013 })] }), order({ id: "b", taxType: "individual", lines: [line({ qty: 1, rate: 1013 })] })]
    expect(orderTotal(list[0])).toBeCloseTo(1053.52)
    expect(ordersPriceTotal(list)).toBe(2108)
    expect(ordersPriceTotal(list)).toBe(list.reduce((s, o) => s + orderPaymentState(o).remaining, 0))
  })
  test("заказ на 0 ₽ — ни долга, ни оплаты", () => {
    for (const o of [order({ lines: [line({ ignorePrice: true })] }), order({ lines: [line({ type: "Час", pomoHours: 0, rate: 800 })] })]) {
      const p = orderPaymentState(o)
      expect(p.full).toBe(0)
      expect(p.remaining).toBe(0) // фильтр «Есть долг» — remaining > 0
      expect(p.isFullyPaid).toBe(false)
    }
  })
})

describe("один ключ клиента на всех экранах", () => {
  test("clientKey: регистр, крайние и сдвоенные пробелы", () => {
    expect(clientKey("  Школа   №1 ")).toBe("школа №1")
    expect(clientKey("ШКОЛА №1")).toBe(clientKey("школа №1"))
    expect(clientKey(undefined)).toBe("")
  })
  test("uniqueClientNames: по одному на ключ, написание из справочника или самое частое", () => {
    expect(uniqueClientNames(["школа №1", "Школа №1", "школа  №1", "школа №1", "Другой", "", null])).toEqual(["школа №1", "Другой"])
    expect(uniqueClientNames(["школа №1", "школа №1", "Другой"], ["Школа №1", "Третий"])).toEqual(["Школа №1", "Другой"])
    expect(uniqueClientNames(["Школа", "школа"])).toEqual(["Школа"])
  })
  test("заказы, аванс и списания без привязки — по ключу", () => {
    const orders = [
      order({ id: "a", client: "школа  №1", advanceUsed: 200 }),
      order({ id: "b", client: "ШКОЛА №1" }),
      order({ id: "c", client: "Школа №1", status: "cancelled", advanceUsed: 999 }),
      order({ id: "d", client: "Другой" }),
    ]
    expect(ordersOfClientKey(orders, "Школа №1").map((o) => o.id)).toEqual(["a", "b"])
    const advances = [{ id: "x", client: " школа №1", amount: 500, date: "2026-07-01", note: "" }]
    expect(getClientAdvanceStats("Школа №1", advances, orders)).toEqual({ totalIn: 500, used: 200, available: 300 })
    expect(clientUnallocatedAdvance("Школа №1", orders)).toBe(200)
  })
  test("выручка со списания без привязки — датой аванса, даже если имя набрано иначе", () => {
    const o = order({ client: "школа №1", advanceUsed: 300 })
    const events = revenueEventsForOrder(o, [{ id: "x", client: "Школа №1", amount: 500, date: "2026-07-01", note: "" }])
    expect(events.map((e) => [e.date, e.revenue])).toEqual([["2026-07-01", 300]])
  })
})

describe("переименование единицы: смена почасовой на штучную видна до подтверждения", () => {
  const data = (orders: Order[]) => ({ settings: defaultAppSettings(), orders, advances: [], planningBoards: [] })
  const hourlyLine = line({ label: "Консультация", type: "Час", qty: 1, pomoHours: 12.5, rate: 800 })

  test("«Час» → «Ч»: 10 000 ₽ превращаются в 800 ₽, оплаченный заказ — в переплату", () => {
    const paid = order({ id: "h", lines: [hourlyLine], payments: [{ id: "p", amount: 10000, date: "2026-08-10", note: "" }] })
    const cancelled = order({ id: "c", status: "cancelled", lines: [hourlyLine] })
    const plan = planCatalogRename("units", "Час", "Ч", data([paid, cancelled, order({ id: "s" })]))
    expect(plan.repricing).toEqual({ toHourly: false, orders: 1, paid: 1, before: 10000, after: 800 })
    expect(orderPaymentState(plan.orders[0]).overpaid).toBe(9200)
    // Переименование остаётся возможным — решает человек.
    expect(plan.orders[0].lines[0].type).toBe("Ч")
  })
  test("штучная → почасовая тоже предупреждает; без смены характера — нет", () => {
    const perPiece = order({ lines: [line({ type: "Урок", qty: 2, rate: 500 })] })
    expect(planCatalogRename("units", "Урок", "Час работы", data([perPiece])).repricing).toEqual({ toHourly: true, orders: 1, paid: 0, before: 1000, after: 0 })
    expect(planCatalogRename("units", "Слайд", "Слайды", data([order({})])).repricing).toBeNull()
    expect(planCatalogRename("units", "Час", "Часы", data([order({ lines: [hourlyLine] })])).repricing).toBeNull()
    // Характер меняется, но заказов с этой единицей нет — предупреждение без сумм.
    expect(planCatalogRename("units", "Час", "Ч", data([])).repricing).toEqual({ toHourly: false, orders: 0, paid: 0, before: 0, after: 0 })
  })
})

describe("переименование типа работы доходит до планирования и шаблонов", () => {
  const lesson = (id: string, num: number, items: PlanningLesson["items"]): PlanningLesson => ({ id, num, title: "", color: "", items, colorLocked: false, orderLinked: false, notes: "" })
  const board: PlanningBoard = {
    id: "pb", subject: "Математика", title: "5 класс", quarter: "1", deadline: "", collapsed: false, archived: false,
    baseTemplate: ["Презентация", "Карточка"],
    lessons: [
      lesson("L3", 3, [{ id: "i1", text: "Презентация", done: true, fromOrder: true }, { id: "i2", text: "Карточка", done: false }]),
      lesson("L4", 4, [{ id: "i3", text: "Карточка", done: false }]),
    ],
  }
  const settings: AppSettings = {
    ...defaultAppSettings(),
    boardTemplates: { pb: [{ label: "Презентация", type: "Слайд", qty: 10, rate: 100 }, { label: "Карточка", type: "Страница", qty: 1, rate: 50 }] },
    orderTemplates: [{ id: "t1", name: "Урок", lines: [{ label: "презентация ", type: "Слайд", qty: 12, rate: 90 }] }],
  }
  const linked = order({ linkedLessonId: "L3", lines: [line({ ready: true })] })
  const data = { settings, orders: [linked], advances: [], planningBoards: [board] }

  test("чек-лист доски, пункты уроков, шаблоны доски и заказов", () => {
    const plan = planCatalogRename("types", "Презентация", "Презентация PDF", data)
    const b = plan.planningBoards[0]
    expect(b.baseTemplate).toEqual(["Презентация PDF", "Карточка"])
    expect(b.lessons[0].items.map((i) => i.text)).toEqual(["Презентация PDF", "Карточка"])
    expect(b.lessons[0].items[0]).toMatchObject({ id: "i1", done: true, fromOrder: true })
    expect(b.lessons[1]).toBe(board.lessons[1])
    expect(plan.settings.boardTemplates.pb[0].label).toBe("Презентация PDF")
    expect(plan.settings.boardTemplates.pb[1]).toBe(settings.boardTemplates.pb[1])
    expect(plan.settings.orderTemplates[0].lines[0].label).toBe("Презентация PDF")
    expect(plan.touched).toEqual({ orders: 1, advances: 0, boards: 1, lines: 1, lessonItems: 1, templates: 3 })
    expect(plan.repricing).toBeNull()
  })
  test("после синхронизации с заказом у урока нет пункта-дубля", () => {
    const plan = planCatalogRename("types", "Презентация", "Презентация PDF", data)
    const synced = syncPlanningWithOrders(plan.orders, plan.planningBoards)
    const texts = synced[0].lessons[0].items.map((i) => i.text)
    expect(texts.filter((t) => t === "Презентация PDF")).toHaveLength(1)
    expect(texts).not.toContain("Презентация")
  })
  test("слияние с существующим типом: один пункт, сделан — если сделан любой", () => {
    const plan = planCatalogRename("types", "Презентация", "Карточка", data)
    expect(plan.merges).toBe(true)
    expect(plan.planningBoards[0].baseTemplate).toEqual(["Карточка"])
    const items = plan.planningBoards[0].lessons[0].items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: "i1", text: "Карточка", done: true })
    expect(items[0].fromOrder).toBeFalsy() // ручной пункт сильнее: синхронизация его не удалит
  })
  test("единица переименовывается и в шаблонах; доски не трогаются", () => {
    const plan = planCatalogRename("units", "Слайд", "Слайды", data)
    expect(plan.settings.boardTemplates.pb[0].type).toBe("Слайды")
    expect(plan.settings.orderTemplates[0].lines[0].type).toBe("Слайды")
    expect(plan.planningBoards).toBe(data.planningBoards)
    expect(plan.touched.templates).toBe(2)
  })
})
