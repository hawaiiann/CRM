import type { AppSettings, Order, OrderLine, OrderTemplateLine, Advance, PlanningBoard, PlanningLesson, PlanningLessonItem } from "@/types/models"
import type { CatalogKey } from "./catalog"
import { isHourlyUnit, orderPaymentState, orderPaymentsTotal, parseNum } from "./money"

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
  /**
   * Сколько записей изменится в каждой коллекции. lessonItems — пункты
   * чек-листов уроков; templates — пункты шаблона доски (baseTemplate),
   * шаблонов заказа досок (boardTemplates) и общих шаблонов заказов.
   */
  touched: { orders: number; advances: number; boards: number; lines: number; lessonItems: number; templates: number }
  /** Новое имя уже есть в справочнике — записи сольются в одну. */
  merges: boolean
  /**
   * Единица становится почасовой или перестаёт ею быть (isHourlyUnit ищет
   * «час» в названии): «Час» → «Ч» молча превращал 12,5 ч × 800 = 10 000 в
   * 1 × 800 = 800, и оплаченный заказ оказывался переплаченным. Здесь — цены
   * затронутых неотменённых заказов до и после, чтобы это было видно в
   * подтверждении. null — характер единицы не меняется.
   */
  repricing: { toHourly: boolean; orders: number; paid: number; before: number; after: number } | null
}

const same = (a: string | undefined, b: string) => (a || "").trim().toLowerCase() === b.trim().toLowerCase()

// Та же проверка, что в расчёте цены позиции, — по одному названию единицы.
const hourly = (unit: string) => isHourlyUnit({ type: unit } as OrderLine)

/**
 * Переименование в списке строк (чек-лист доски). При слиянии с уже
 * существующим именем второй экземпляр убирается — иначе пункт задваивался.
 * null — переименовывать нечего.
 */
function renameInList(list: string[], from: string, to: string): { list: string[]; count: number } | null {
  let count = 0
  let seen = false
  const out: string[] = []
  for (const t of list) {
    const hit = same(t, from)
    if (hit) count++
    const v = hit ? to : t
    if (same(v, to)) { if (seen) continue; seen = true }
    out.push(v)
  }
  return count ? { list: out, count } : null
}

/**
 * Пункты чек-листа урока. Синхронизация с заказом ищет пункт по названию
 * позиции: без переименования здесь у каждого связанного урока появлялся
 * пункт-дубль с новым именем, а старый так и не закрывался. При слиянии
 * остаётся один пункт: сделан, если сделан любой; ручной сильнее пришедшего
 * из заказа — ручной синхронизация не удаляет.
 */
function renameLessonItems(lesson: PlanningLesson, from: string, to: string): { lesson: PlanningLesson; count: number } | null {
  const items = lesson.items || []
  if (!items.some((i) => same(i.text, from))) return null
  let count = 0
  const out: PlanningLessonItem[] = []
  for (const i of items) {
    const hit = same(i.text, from)
    if (hit) count++
    const v = hit ? { ...i, text: to } : i
    const idx = same(v.text, to) ? out.findIndex((x) => same(x.text, to)) : -1
    if (idx >= 0) {
      out[idx] = { ...out[idx], done: out[idx].done || v.done, fromOrder: out[idx].fromOrder && v.fromOrder }
      continue
    }
    out.push(v)
  }
  return { lesson: { ...lesson, items: out }, count }
}

/** Позиции шаблона заказа: тип работы лежит в label, единица — в type. */
function renameTemplateLines(lines: OrderTemplateLine[], field: "label" | "type", from: string, to: string): { lines: OrderTemplateLine[]; count: number } | null {
  let count = 0
  const out = lines.map((l) => {
    if (!same(l[field], from)) return l
    count++
    return { ...l, [field]: to }
  })
  return count ? { lines: out, count } : null
}

export function planCatalogRename(
  key: CatalogKey,
  from: string,
  to: string,
  data: { settings: AppSettings; orders: Order[]; advances: Advance[]; planningBoards: PlanningBoard[] }
): RenamePlan {
  const { settings, orders, advances, planningBoards } = data
  const touched = { orders: 0, advances: 0, boards: 0, lines: 0, lessonItems: 0, templates: 0 }
  const toTrim = to.trim()
  const noop = !toTrim || toTrim === from
  if (noop) return { orders, advances, planningBoards, settings, touched, merges: false, repricing: null }

  const merges = settings[key].some((v) => v !== from && same(v, toTrim))
  const list = merges ? settings[key].filter((v) => v !== from) : settings[key].map((v) => (v === from ? toTrim : v))
  const hidden = settings.hiddenEntries[key] || []
  let nextSettings: AppSettings = {
    ...settings,
    [key]: list,
    hiddenEntries: { ...settings.hiddenEntries, [key]: merges ? hidden.filter((h) => h !== from) : hidden.map((h) => (h === from ? toTrim : h)) },
  }

  // Шаблоны заказов (общие и досок) хранят и тип работы, и единицу. Раньше они
  // оставались со старым именем, и заказ из урока или шаблона приходил с
  // записью, которой в справочнике уже нет.
  const tplField = key === "types" ? "label" : key === "units" ? "type" : null
  if (tplField) {
    let boardTplChanged = false
    const boardTemplates: AppSettings["boardTemplates"] = {}
    Object.entries(settings.boardTemplates || {}).forEach(([boardId, lines]) => {
      const r = renameTemplateLines(lines || [], tplField, from, toTrim)
      if (r) { boardTplChanged = true; touched.templates += r.count }
      boardTemplates[boardId] = r ? r.lines : lines
    })
    let orderTplChanged = false
    const orderTemplates = (settings.orderTemplates || []).map((t) => {
      const r = renameTemplateLines(t.lines || [], tplField, from, toTrim)
      if (!r) return t
      orderTplChanged = true
      touched.templates += r.count
      return { ...t, lines: r.lines }
    })
    if (boardTplChanged) nextSettings = { ...nextSettings, boardTemplates }
    if (orderTplChanged) nextSettings = { ...nextSettings, orderTemplates }
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

  // Тип работы — это ещё и пункт чек-листа: в шаблоне доски и в уроках.
  const renameBoardType = (b: PlanningBoard): PlanningBoard => {
    const base = renameInList(b.baseTemplate || [], from, toTrim)
    let lessonsChanged = false
    const lessons = (b.lessons || []).map((l) => {
      const r = renameLessonItems(l, from, toTrim)
      if (!r) return l
      lessonsChanged = true
      touched.lessonItems += r.count
      return r.lesson
    })
    if (!base && !lessonsChanged) return b
    touched.boards++
    if (base) touched.templates += base.count
    return { ...b, baseTemplate: base ? base.list : b.baseTemplate, lessons: lessonsChanged ? lessons : b.lessons }
  }

  const nextBoards = key === "subjects" || key === "classes"
    ? planningBoards.map((b) => {
        const field = key === "subjects" ? "subject" : "title"
        if (!same(b[field], from)) return b
        touched.boards++
        return { ...b, [field]: toTrim }
      })
    : key === "types"
      ? planningBoards.map(renameBoardType)
      : planningBoards

  let repricing: RenamePlan["repricing"] = null
  if (key === "units" && hourly(from) !== hourly(toTrim)) {
    const r = { toHourly: hourly(toTrim), orders: 0, paid: 0, before: 0, after: 0 }
    orders.forEach((o, i) => {
      const next = nextOrders[i]
      if (next === o || o.status === "cancelled") return
      const was = orderPaymentState(o).full
      const now = orderPaymentState(next).full
      if (was === now) return
      r.orders++
      if (orderPaymentsTotal(o) > 0 || parseNum(o.advanceUsed) > 0) r.paid++
      r.before += was
      r.after += now
    })
    repricing = r
  }

  return { orders: nextOrders, advances: nextAdvances, planningBoards: nextBoards, settings: nextSettings, touched, merges, repricing }
}
