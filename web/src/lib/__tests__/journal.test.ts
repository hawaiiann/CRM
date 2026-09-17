import { describe, test, expect } from "vitest"
import { mergeHoursEntry, setEntryDelta, setDayHours, compactLog, groupByDayOrder } from "../journal"
import type { ActivityLogEntry } from "@/types/models"

const e = (date: string, orderId: string, delta: number, entryId?: string): ActivityLogEntry => ({ date, orderId, field: "hours", delta, entryId })

describe("mergeHoursEntry", () => {
  test("пустой журнал: появляется одна запись", () => {
    const r = mergeHoursEntry([], "o1", "2026-08-27", 1 / 60)
    expect(r.log).toHaveLength(1)
    expect(r.log[0].delta).toBe(0.0167)
    expect(r.removed).toEqual([])
  })

  test("минутные сбросы таймера копятся в ту же запись", () => {
    let log = mergeHoursEntry([], "o1", "2026-08-27", 1 / 60).log
    for (let i = 0; i < 59; i++) log = mergeHoursEntry(log, "o1", "2026-08-27", 1 / 60).log
    expect(log).toHaveLength(1)
    expect(Math.abs(log[0].delta - 1)).toBeLessThan(0.01)
  })

  test("другой заказ или день — отдельные записи", () => {
    let log = mergeHoursEntry([], "o1", "2026-08-27", 1).log
    log = mergeHoursEntry(log, "o2", "2026-08-27", 0.5).log
    log = mergeHoursEntry(log, "o1", "2026-08-28", 0.25).log
    expect(log).toHaveLength(3)
  })

  test("опечатка +30 и исправление −30 схлопываются, запись удаляется из облака", () => {
    const r = mergeHoursEntry([e("2026-08-22", "o9", 30, "al_x")], "o9", "2026-08-22", -30)
    expect(r.log).toHaveLength(0)
    expect(r.removed[0].entryId).toBe("al_x")
  })

  test("правка сохраняет entryId (в облако идёт UPDATE)", () => {
    const r = mergeHoursEntry([e("2026-08-22", "o9", 2, "al_y")], "o9", "2026-08-22", 1)
    expect(r.log[0].entryId).toBe("al_y")
    expect(r.log[0].delta).toBe(3)
  })

  test("нулевая дельта и мусор не трогают журнал", () => {
    const same = [e("2026-08-22", "o9", 2)]
    expect(mergeHoursEntry(same, "o9", "2026-08-22", 0).log).toBe(same)
    expect(mergeHoursEntry(same, "", "2026-08-22", 1).log).toBe(same)
    expect(mergeHoursEntry(same, "o9", "2026-08-22", NaN).log).toBe(same)
  })

  test("несколько старых строк на день: дописываем в последнюю", () => {
    const r = mergeHoursEntry([e("2026-08-22", "o9", 1, "a"), e("2026-08-22", "o9", 1, "b")], "o9", "2026-08-22", 1)
    expect(r.log.map((x) => x.delta)).toEqual([1, 2])
  })
})

describe("setEntryDelta", () => {
  test("правка на месте и удаление нулём", () => {
    const target = e("2026-08-22", "o9", 5, "z")
    expect(setEntryDelta([target], target, 2.5).log[0]).toMatchObject({ delta: 2.5, entryId: "z" })
    const r = setEntryDelta([target], target, 0)
    expect(r.log).toHaveLength(0)
    expect(r.removed[0]).toBe(target)
    expect(setEntryDelta([target], e("x", "y", 1), 3).log).toHaveLength(1)
  })
})

describe("setDayHours", () => {
  test("создаёт, правит на месте, схлопывает старые строки в первую", () => {
    expect(setDayHours([], "o1", "2026-08-22", 2).log[0].delta).toBe(2)
    expect(setDayHours([], "o1", "2026-08-22", 0).log).toHaveLength(0)
    const one = setDayHours([e("2026-08-22", "o1", 5, "a")], "o1", "2026-08-22", 2.5)
    expect(one.log[0]).toMatchObject({ delta: 2.5, entryId: "a" })
    const same = [e("2026-08-22", "o1", 5, "a")]
    expect(setDayHours(same, "o1", "2026-08-22", 5).log).toBe(same)
    const many = [e("2026-08-22", "o1", 1, "a"), e("2026-08-23", "o1", 1, "x"), e("2026-08-22", "o1", 1, "b"), e("2026-08-22", "o1", 1, "c")]
    const r = setDayHours(many, "o1", "2026-08-22", 4)
    expect(r.log.map((x) => x.entryId)).toEqual(["a", "x"])
    expect(r.log[0].delta).toBe(4)
    expect(r.removed.map((x) => x.entryId)).toEqual(["b", "c"])
    const zero = setDayHours(many, "o1", "2026-08-22", 0)
    expect(zero.log).toHaveLength(1)
    expect(zero.removed).toHaveLength(3)
  })
})

describe("compactLog", () => {
  test("40 минутных строк и пара +30/−30 → одна строка с прежней суммой", () => {
    const legacy: ActivityLogEntry[] = []
    for (let i = 0; i < 40; i++) legacy.push(e("2026-08-22", "o1", 1 / 60, "m" + i))
    legacy.push(e("2026-08-22", "o2", 30, "p"), e("2026-08-22", "o2", -30, "q"), e("2026-08-23", "o1", 2, "z"))
    const r = compactLog(legacy)
    expect(r.log.map((x) => x.entryId)).toEqual(["m0", "z"])
    expect(Math.abs(r.log[0].delta - 40 / 60)).toBeLessThan(0.001)
    expect(r.removed).toHaveLength(41)
    expect(compactLog(r.log).log).toBe(r.log)
    expect(groupByDayOrder(legacy).size).toBe(3)
  })
})
