import { describe, test, expect } from "vitest"
import { orderPriceBreakdown, orderTotal, orderPreTaxTotal, orderAiUnits, orderPaymentState, orderExtrasLabel } from "../money"
import { orderRecognizedRevenue } from "../dashboardMetrics"
import { actRows } from "../act"
import { normalizeOrder, defaultAppSettings } from "../normalize"
import type { Order, OrderLine } from "@/types/models"

const line = (over: Partial<OrderLine>): OrderLine => ({
  id: "l" + Math.random().toString(36).slice(2, 6), label: "Презентация", type: "Слайд", qty: 10, pomoHours: 0, rate: 100, ignorePrice: false, ready: false, ...over,
})

const order = (over: Partial<Order>): Order => ({
  id: "o1", title: "", client: "Школа", subject: "Литература", grade: "9 класс", quarter: "1", lesson: "3", status: "progress",
  isPaid: false, priority: false, advanceUsed: 0, advanceAllocations: [], payments: [], paidAmount: 0, taxType: "none", aiRate: 0, urgencyPct: 0,
  start: "2026-09-01", deadline: "2026-09-10", estimatedHours: "", actualHours: "", notes: "", createdAt: 0, linkedLessonId: null, paidAt: null,
  lines: [line({})],
  ...over,
})

describe("цена заказа: нейросети → срочность → налог", () => {
  test("порядок расчёта", () => {
    // 10 слайдов × 100 = 1000; нейросети 5 ₽ × 10 = 50; срочность 20% от 1050 = 210; налог 4% от 1260 = 50,4
    const p = orderPriceBreakdown(order({ aiRate: 5, urgencyPct: 20, taxType: "individual" }))
    expect(p).toMatchObject({ base: 1000, aiUnits: 10, ai: 50, subtotal: 1050, urgency: 210, preTax: 1260 })
    expect(p.tax).toBeCloseTo(50.4)
    expect(p.total).toBeCloseTo(1310.4)
    expect(orderPaymentState(order({ aiRate: 5, urgencyPct: 20, taxType: "individual" })).full).toBe(1310)
  })

  test("без надбавок цена та же, что раньше", () => {
    expect(orderTotal(order({ taxType: "entity" }))).toBeCloseTo(1060)
    expect(orderPreTaxTotal(order({}))).toBe(1000)
    // Старый заказ без полей вовсе
    const legacy = { lines: [line({})], taxType: "individual" as const }
    expect(orderTotal(legacy)).toBeCloseTo(1040)
  })

  test("надбавка за нейросети — только штучные оплачиваемые позиции", () => {
    const o = order({
      aiRate: 5,
      lines: [
        line({ qty: 12 }),
        line({ label: "Рабочий лист", type: "Страница", qty: 4, rate: 150 }),
        line({ label: "Правки", type: "Час", qty: 1, pomoHours: 2, rate: 500 }),
        line({ label: "Бонус", qty: 3, ignorePrice: true }),
        line({ label: "Видео", type: "шт", qty: 2, rate: 300, noAi: true }),
      ],
    })
    expect(orderAiUnits(o)).toBe(16)
    expect(orderPriceBreakdown(o).ai).toBe(80)
  })

  test("срочность без нейросетей и нейросети без срочности", () => {
    expect(orderTotal(order({ urgencyPct: 30 }))).toBe(1300)
    expect(orderTotal(order({ aiRate: 5 }))).toBe(1050)
  })

  test("выручка без налога включает надбавки", () => {
    const o = order({ aiRate: 5, urgencyPct: 20, taxType: "individual", payments: [{ id: "p", amount: 1310, date: "2026-09-10", note: "" }] })
    expect(orderRecognizedRevenue(o)).toEqual({ revenue: 1310, net: 1260 })
  })

  test("в акте надбавки стоят в составе, итог сходится", () => {
    const [row] = actRows([order({ aiRate: 5, urgencyPct: 20 })])
    expect(row.composition).toContain("нейросети 5 ₽ × 10")
    expect(row.composition).toContain("срочность +20%")
    expect(row.total).toBe(1260)
    expect(orderExtrasLabel(order({}))).toBe("")
  })

  test("нормализация: по умолчанию нули, noAi только если включён", () => {
    const n = normalizeOrder({ id: "x", lines: [line({ id: "a" }), line({ id: "b", noAi: true })] }, defaultAppSettings())
    expect(n.aiRate).toBe(0)
    expect(n.urgencyPct).toBe(0)
    expect("noAi" in n.lines[0]).toBe(false)
    expect(n.lines[1].noAi).toBe(true)
    expect(normalizeOrder({ id: "y", aiRate: "5" as unknown as number, urgencyPct: -3 }, defaultAppSettings())).toMatchObject({ aiRate: 5, urgencyPct: 0 })
  })
})
