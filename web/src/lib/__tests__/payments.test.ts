import { test, expect } from "vitest"
import { distributePayment, applyPayments, allocateAdvanceToOrders } from "../payments"
import { orderPaymentState } from "../money"
import type { Order } from "@/types/models"

const order = (id: string, price: number, over: Partial<Order> = {}): Order => ({
  id, title: id, client: "Школа", subject: "", grade: "", quarter: "", lesson: "", status: "done",
  isPaid: false, priority: false, advanceUsed: 0, advanceAllocations: [], payments: [], paidAmount: 0, taxType: "none", start: "", deadline: "2026-08-10",
  estimatedHours: "", actualHours: "", notes: "", createdAt: 0, linkedLessonId: null, paidAt: null,
  lines: [{ id: "l", label: "Презентация", type: "Слайд", qty: 1, pomoHours: 0, rate: price, ignorePrice: false, ready: true }],
  ...over,
})

test("сумма раскладывается по порядку, каждому не больше остатка, лишнее — в leftover", () => {
  const orders = [order("a", 1000), order("b", 500, { advanceUsed: 200 }), order("c", 700)]
  expect(distributePayment(orders, 1200)).toEqual({ splits: [{ orderId: "a", amount: 1000 }, { orderId: "b", amount: 200 }], leftover: 0 })
  expect(distributePayment(orders, 5000)).toEqual({ splits: [{ orderId: "a", amount: 1000 }, { orderId: "b", amount: 300 }, { orderId: "c", amount: 700 }], leftover: 3000 })
  expect(distributePayment(orders, 0).splits).toEqual([])
})

test("applyPayments добавляет платёж, считает paidAmount и isPaid, не трогает чужие заказы", () => {
  const orders = [order("a", 1000), order("b", 500)]
  const next = applyPayments(orders, [{ orderId: "a", amount: 1000 }, { orderId: "b", amount: 100 }], "2026-09-01", "За август")
  expect(next[0].payments).toHaveLength(1)
  expect(next[0]).toMatchObject({ paidAmount: 1000, isPaid: true, paidAt: "2026-09-01" })
  expect(next[0].payments[0]).toMatchObject({ amount: 1000, date: "2026-09-01", note: "За август" })
  expect(next[1]).toMatchObject({ paidAmount: 100, isPaid: false })
  expect(orderPaymentState(next[1]).remaining).toBe(400)
  const untouched = applyPayments(orders, [], "2026-09-01", "")
  expect(untouched[0]).toBe(orders[0])
})

test("аванс списывается на выбранные заказы с привязкой и увеличением advanceUsed", () => {
  const orders = [order("a", 1000, { advanceAllocations: [{ advanceId: "old", amount: 300 }], advanceUsed: 300 }), order("b", 500), order("c", 900)]
  const r = allocateAdvanceToOrders(orders, "adv1", 1000, ["a", "c"])
  expect(r.splits).toEqual([{ orderId: "a", amount: 700 }, { orderId: "c", amount: 300 }])
  expect(r.leftover).toBe(0)
  expect(r.orders[0]).toMatchObject({ advanceUsed: 1000, advanceAllocations: [{ advanceId: "old", amount: 300 }, { advanceId: "adv1", amount: 700 }] })
  expect(r.orders[1]).toBe(orders[1])
  expect(r.orders[2]).toMatchObject({ advanceUsed: 300, advanceAllocations: [{ advanceId: "adv1", amount: 300 }] })
  expect(orderPaymentState(r.orders[0]).remaining).toBe(0)
})
