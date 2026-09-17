import { test, expect } from "vitest"
import { mergeUnsentLocal } from "../cloudMerge"
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
