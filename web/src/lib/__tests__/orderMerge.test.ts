import { test, expect } from "vitest"
import { mergeOrders, duplicateOrderGroups } from "../orderMerge"
import type { Order } from "@/types/models"

const order = (over: Partial<Order>): Order => ({
  id: "o1", title: "", client: "Школа", subject: "Литература", grade: "9 класс", quarter: "1", lesson: "6", status: "queue",
  isPaid: false, priority: false, advanceUsed: 0, advanceAllocations: [], payments: [], paidAmount: 0, taxType: "none", start: "2026-09-01", deadline: "2026-09-10",
  estimatedHours: "", actualHours: "", notes: "", createdAt: 1, linkedLessonId: null, paidAt: null,
  lines: [{ id: "l1", label: "Презентация", type: "Слайд", qty: 10, pomoHours: 1, rate: 200, ignorePrice: false, ready: true }],
  ...over,
})

test("объединение: позиции складываются по названию, деньги суммируются, статус — продвинутый", () => {
  const a = order({})
  const b = order({
    id: "o2", status: "done", deadline: "2026-09-05", createdAt: 2, notes: "второй", advanceUsed: 500, paidAmount: 300,
    payments: [{ id: "p1", amount: 300, date: "2026-09-05", note: "" }],
    lines: [
      { id: "l2", label: "презентация", type: "Слайд", qty: 12, pomoHours: 0.5, rate: 0, ignorePrice: false, ready: false },
      { id: "l3", label: "Рабочий лист", type: "Страница", qty: 2, pomoHours: 0, rate: 150, ignorePrice: false, ready: true },
    ],
  })
  const m = mergeOrders(a, b)
  expect(m.id).toBe("o1")
  expect(m.lines).toHaveLength(2)
  expect(m.lines[0]).toMatchObject({ label: "Презентация", qty: 12, pomoHours: 1.5, rate: 200, ready: false })
  expect(m.lines[1].label).toBe("Рабочий лист")
  expect(m.status).toBe("done")
  expect(m.deadline).toBe("2026-09-05")
  expect(m.advanceUsed).toBe(500)
  expect(m.paidAmount).toBe(300)
  expect(m.payments).toHaveLength(1)
  expect(m.notes).toBe("второй")
})

test("дубли: одинаковый предмет, класс, четверть и номер урока, отменённые не считаются", () => {
  const g = duplicateOrderGroups([
    order({ id: "a", createdAt: 5 }), order({ id: "b", createdAt: 1 }), order({ id: "c", lesson: "7" }), order({ id: "d", status: "cancelled" }),
  ])
  expect(g).toHaveLength(1)
  expect(g[0].map((o) => o.id)).toEqual(["b", "a"])
})
