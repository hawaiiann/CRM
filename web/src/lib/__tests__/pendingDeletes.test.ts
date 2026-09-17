import { test, expect, beforeAll } from "vitest"

// Модуль читает localStorage при импорте — подставляем шим до импорта.
const mem = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
}
mem.set("design_crm_pending_deletes_v1", JSON.stringify({ orders: ["old1"] }))

let m: typeof import("../pendingDeletes")
beforeAll(async () => { m = await import("../pendingDeletes") })

test("старая общая очередь дочитывается и убирается после первой записи", () => {
  expect(m.isPendingDelete("orders", "old1")).toBe(true)
  m.setPendingDeletesScope("userA")
  expect(m.isPendingDelete("orders", "old1")).toBe(true)
  m.rememberDelete("tasks", "tA")
  expect(mem.has("design_crm_pending_deletes_v1")).toBe(false)
  expect(mem.has("design_crm_pending_deletes_v1::userA")).toBe(true)
})

test("очереди аккаунтов не пересекаются и переживают переключение", () => {
  m.setPendingDeletesScope("userB")
  expect(m.isPendingDelete("tasks", "tA")).toBe(false)
  expect(m.pendingDeleteCount()).toBe(0)
  m.rememberDelete("orders", "oB")
  m.setPendingDeletesScope("userA")
  expect(m.isPendingDelete("tasks", "tA")).toBe(true)
  expect(m.isPendingDelete("orders", "oB")).toBe(false)
  m.forgetDelete("tasks", "tA")
  expect(m.isPendingDelete("tasks", "tA")).toBe(false)
})
