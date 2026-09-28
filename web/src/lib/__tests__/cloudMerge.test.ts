import { test, expect } from "vitest"
import { mergeUnsentLocal, mergeFields } from "../cloudMerge"
import { sameData, canon } from "../stableJson"

type R = { id: string; v: number; tags?: string[]; nested?: Record<string, unknown> }

test("порядок ключей во вложенных объектах не считается изменением", () => {
  expect(sameData({ a: 1, b: { x: 1, y: [{ p: 1, q: 2 }] } }, { b: { y: [{ q: 2, p: 1 }], x: 1 }, a: 1 })).toBe(true)
  expect(sameData({ a: 1 }, { a: 2 })).toBe(false)
  expect(canon({ b: undefined, a: 1 })).toBe('{"a":1}')
})

test("неотправленная локальная правка переживает загрузку, если облако не менялось", () => {
  const snap = { a: { id: "a", v: 1 } }
  const r = mergeUnsentLocal<R>([{ id: "a", v: 2 }], [{ id: "a", v: 1 }], snap)
  expect(r.merged).toEqual([{ id: "a", v: 2 }])
  expect(r.kept).toBe(1)
  expect(r.dropped).toBe(0)
})

test("правка на другом устройстве побеждает, если здесь не трогали", () => {
  const snap = { a: { id: "a", v: 1 } }
  const r = mergeUnsentLocal<R>([{ id: "a", v: 1 }], [{ id: "a", v: 5 }], snap)
  expect(r.merged).toEqual([{ id: "a", v: 5 }])
  expect(r.kept).toBe(0)
})

test("правили и там и тут — облако побеждает, потеря посчитана", () => {
  const snap = { a: { id: "a", v: 1 } }
  const r = mergeUnsentLocal<R>([{ id: "a", v: 2 }], [{ id: "a", v: 5 }], snap)
  expect(r.merged).toEqual([{ id: "a", v: 5 }])
  expect(r.dropped).toBe(1)
})

test("правили разные поля — сливаются оба, без потерь", () => {
  type O = { id: string; status: string; notes: string }
  const snap = { a: { id: "a", status: "queue", notes: "" } }
  const r = mergeUnsentLocal<O>([{ id: "a", status: "done", notes: "" }], [{ id: "a", status: "queue", notes: "позвонить" }], snap)
  expect(r.merged).toEqual([{ id: "a", status: "done", notes: "позвонить" }])
  expect(r.kept).toBe(1)
  expect(r.dropped).toBe(0)
})

test("mergeFields: словари настроек сливаются по ключам на втором уровне", () => {
  const snap = { ktpMode: false, boardSchedules: { b1: { perWeek: 2 } }, clients: ["A"] }
  const local = { ktpMode: false, boardSchedules: { b1: { perWeek: 2 }, b2: { perWeek: 3 } }, clients: ["A"] }
  const cloud = { ktpMode: true, boardSchedules: { b1: { perWeek: 4 } }, clients: ["A", "B"] }
  const m = mergeFields(local, cloud, snap, 2)
  expect(m.value).toEqual({ ktpMode: true, boardSchedules: { b1: { perWeek: 4 }, b2: { perWeek: 3 } }, clients: ["A", "B"] })
  expect(m.usedLocal).toBe(true)
  expect(m.conflict).toBe(false)
  // Одно и то же поле с обеих сторон — облако, конфликт отмечен
  const c = mergeFields({ x: 1 }, { x: 2 }, { x: 0 }, 1)
  expect(c.value).toEqual({ x: 2 })
  expect(c.conflict).toBe(true)
  // Удалённое здесь поле остаётся удалённым, если облако его не трогало
  expect(mergeFields({ a: 1 }, { a: 1, b: 2 }, { a: 1, b: 2 }, 1).value).toEqual({ a: 1 })
})

test("созданное офлайн остаётся, удалённое на другом устройстве не воскресает", () => {
  const snap = { old: { id: "old", v: 1 } }
  const r = mergeUnsentLocal<R>([{ id: "old", v: 1 }, { id: "new", v: 9 }], [], snap)
  expect(r.merged).toEqual([{ id: "new", v: 9 }])
  expect(r.kept).toBe(1)
})

test("сравнение через shape: доска сравнивается без уроков", () => {
  type B = { id: string; title: string; lessons: number[] }
  const shape = (b: B) => ({ id: b.id, title: b.title })
  const snap = { b: { id: "b", title: "9 класс" } }
  const r = mergeUnsentLocal<B>([{ id: "b", title: "9 класс", lessons: [1, 2] }], [{ id: "b", title: "9 класс", lessons: [] }], snap, shape)
  expect(r.merged[0].lessons).toEqual([])
  expect(r.kept).toBe(0)
})
