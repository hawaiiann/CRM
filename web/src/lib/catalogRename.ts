import type { AppSettings, Order, Advance, PlanningBoard } from "@/types/models"
import type { CatalogKey } from "./catalog"

/**
 * Переименование записи справочника с каскадом по данным.
 *
 * Клиент, предмет, класс, тип работы и единица — это строки, повторённые в
 * заказах, авансах и досках. Раньше переименование меняло только сам список:
 * «Школа №1» → «Школа № 1» в справочнике, а в заказах оставалась старая
 * запись, и клиент раздваивался — с двумя остатками аванса и двумя долгами.
 *
 * Чистая функция: возвращает новые коллекции и что именно затронуто, чтобы
 * это можно было показать в подтверждении и проверить в node.
 */
export interface RenamePlan {
  orders: Order[]
  advances: Advance[]
  planningBoards: PlanningBoard[]
  settings: AppSettings
  /** Сколько записей изменится в каждой коллекции. */
  touched: { orders: number; advances: number; boards: number; lines: number }
  /** Новое имя уже есть в справочнике — записи сольются в одну. */
  merges: boolean
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function planCatalogRename(
  key: CatalogKey,
  from: string,
  to: string,
  data: { settings: AppSettings; orders: Order[]; advances: Advance[]; planningBoards: PlanningBoard[] }
): RenamePlan {
  const { settings, orders, advances, planningBoards } = data
  const touched = { orders: 0, advances: 0, boards: 0, lines: 0 }
  const toTrim = to.trim()
  const noop = !toTrim || toTrim === from
  if (noop) return { orders, advances, planningBoards, settings, touched, merges: false }

  const merges = settings[key].some((v) => v !== from && same(v, toTrim))
  const list = merges ? settings[key].filter((v) => v !== from) : settings[key].map((v) => (v === from ? toTrim : v))
  const hidden = settings.hiddenEntries[key] || []
  const nextSettings: AppSettings = {
    ...settings,
    [key]: list,
    hiddenEntries: { ...settings.hiddenEntries, [key]: merges ? hidden.filter((h) => h !== from) : hidden.map((h) => (h === from ? toTrim : h)) },
  }

  const mapOrder = (o: Order): Order => {
    let next = o
    if (key === "clients" && same(o.client, from)) { next = { ...next, client: toTrim }; touched.orders++ }
    if (key === "subjects" && same(o.subject, from)) { next = { ...next, subject: toTrim }; touched.orders++ }
    if (key === "classes" && same(o.grade, from)) { next = { ...next, grade: toTrim }; touched.orders++ }
    if (key === "types" || key === "units") {
      const field = key === "types" ? "label" : "type"
      let changed = false
      const lines = o.lines.map((l) => {
        if (!same(l[field] || "", from)) return l
        changed = true
        touched.lines++
        return { ...l, [field]: toTrim }
      })
      if (changed) { next = { ...next, lines }; touched.orders++ }
    }
    return next
  }

  const nextOrders = orders.map(mapOrder)
  const nextAdvances = key === "clients"
    ? advances.map((a) => (same(a.client, from) ? (touched.advances++, { ...a, client: toTrim }) : a))
    : advances
  const nextBoards = key === "subjects" || key === "classes"
    ? planningBoards.map((b) => {
        const field = key === "subjects" ? "subject" : "title"
        if (!same(b[field], from)) return b
        touched.boards++
        return { ...b, [field]: toTrim }
      })
    : planningBoards

  return { orders: nextOrders, advances: nextAdvances, planningBoards: nextBoards, settings: nextSettings, touched, merges }
}
