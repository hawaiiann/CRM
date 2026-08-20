import { parseNum, dateKey, addDays } from "./money"
import type {
  Order,
  OrderLine,
  Payment,
  Task,
  Advance,
  AppSettings,
  PlanningBoard,
} from "@/types/models"

function randId(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 11)
}

export function normalizePayment(p: Partial<Payment>): Payment {
  return {
    id: p.id || "pay" + Date.now() + Math.random().toString(36).slice(2, 7),
    amount: parseNum(p.amount),
    date: p.date || dateKey(new Date()),
    note: p.note || "",
  }
}

export function normalizeOrderLine(l: Partial<OrderLine>, defaults: { type: string; unit: string }): OrderLine {
  return {
    id: l.id || randId("l"),
    label: l.label || defaults.type,
    type: l.type || defaults.unit,
    qty: l.qty ?? 1,
    pomoHours: l.pomoHours ?? 0,
    rate: l.rate ?? 0,
    ignorePrice: !!l.ignorePrice,
    ready: !!l.ready,
  }
}

export function normalizeOrder(o: Partial<Order> & { class?: string }, settings: AppSettings): Order {
  const defaultType = settings.types[0] || "Презентация"
  const defaultUnit = settings.units[0] || "Слайд"
  return {
    id: o.id || randId("o"),
    title: o.title || "",
    client: o.client || "",
    subject: o.subject || "",
    grade: o.grade || o.class || "",
    quarter: o.quarter || "",
    lesson: o.lesson || "",
    status: o.status || "queue",
    isPaid: !!o.isPaid,
    priority: !!o.priority,
    advanceUsed: parseNum(o.advanceUsed),
    payments: (o.payments && Array.isArray(o.payments) ? o.payments : []).map(normalizePayment),
    paidAmount: parseNum(o.paidAmount),
    taxType: o.taxType || "none",
    start: o.start || dateKey(new Date()),
    deadline: o.deadline || dateKey(addDays(new Date(), 7)),
    estimatedHours: o.estimatedHours ?? "",
    actualHours: o.actualHours ?? "",
    lines:
      o.lines && o.lines.length
        ? o.lines.map((l) => normalizeOrderLine(l, { type: defaultType, unit: defaultUnit }))
        : [
            {
              id: "l0",
              label: defaultType,
              type: defaultUnit,
              qty: 10,
              pomoHours: 0,
              rate: 500,
              ignorePrice: false,
              ready: false,
            },
          ],
    notes: o.notes || "",
    createdAt: o.createdAt || Date.now(),
    linkedLessonId: o.linkedLessonId || null,
    paidAt: o.paidAt || null,
  }
}

export function normalizeTask(t: Partial<Task>): Task {
  return {
    id: t.id || randId("t"),
    text: t.text || "",
    time: t.time || "",
    done: !!t.done,
    period: t.period || "today",
    createdAt: t.createdAt || "",
  }
}

export function normalizeAdvance(a: Partial<Advance>): Advance {
  return {
    id: a.id || randId("adv"),
    client: a.client || "",
    amount: parseNum(a.amount),
    date: a.date || dateKey(new Date()),
    note: a.note || "",
  }
}

export function defaultAppSettings(): AppSettings {
  return {
    clients: ["Школа №1", 'Издательство "Просвещение"', "Частный заказчик"],
    types: ["Презентация", "Рабочий лист", "Карточка"],
    units: ["Слайд", "Страница", "Урок", "Час", "Другое"],
    subjects: ["Математика", "Русский язык", "Литература", "Дизайн"],
    classes: ["5 класс", "6 класс", "7 класс", "Без класса"],
    hiddenEntries: { clients: [], types: [], units: [], subjects: [], classes: [] },
    orderTemplates: [],
    dashboardMetrics: [
      { id: "dm1", type: "hours", goal: 4 },
      { id: "dm2", type: "presentations", goal: 0 },
      { id: "dm3", type: "worksheets", goal: 0 },
      { id: "dm4", type: "revenue", goal: 4000 },
    ],
  }
}

// Same shape-filling migration as db.js's applySettingsMigrations, minus the
// dashboardMetrics type-remap (slides→presentations, netIncome→revenue) —
// nothing in the ported app has ever written those old type names, so there
// is nothing to remap; keep this comment as the reason if that assumption
// ever needs revisiting once Dashboard settings are ported.
export function applySettingsMigrations(parsed: Partial<AppSettings> | null | undefined): AppSettings {
  const base = defaultAppSettings()
  const merged: AppSettings = { ...base, ...(parsed || {}) }
  if (!merged.clients) merged.clients = base.clients
  if (!merged.types) merged.types = base.types
  if (!merged.units) merged.units = base.units
  if (!merged.subjects) merged.subjects = base.subjects
  if (!merged.classes) merged.classes = base.classes
  if (!merged.dashboardMetrics) merged.dashboardMetrics = base.dashboardMetrics
  if (!merged.orderTemplates) merged.orderTemplates = base.orderTemplates
  if (!merged.hiddenEntries) merged.hiddenEntries = base.hiddenEntries
  ;(["clients", "types", "units", "subjects", "classes"] as const).forEach((k) => {
    if (!merged.hiddenEntries[k]) merged.hiddenEntries[k] = []
  })
  return merged
}

export function defaultPlanningBoards(): PlanningBoard[] {
  return [
    {
      id: "pb_1",
      subject: "Математика",
      title: "5 класс",
      quarter: "1 четверть",
      deadline: "2026-09-01",
      baseTemplate: ["Презентация", "Рабочий лист"],
      collapsed: false,
      archived: false,
      lessons: Array.from({ length: 24 }, (_, i) => ({
        id: "l_" + (i + 1),
        num: i + 1,
        title: `Урок ${i + 1}`,
        color: "gray",
        items: [
          { id: "i1", text: "Презентация", done: false },
          { id: "i2", text: "Рабочий лист", done: false },
        ],
        colorLocked: false,
        orderLinked: false,
        notes: "",
      })),
    },
    {
      id: "pb_2",
      subject: "Русский язык",
      title: "6 класс",
      quarter: "1 четверть",
      deadline: "2026-10-15",
      baseTemplate: ["Презентация", "Рабочий лист"],
      collapsed: false,
      archived: false,
      lessons: Array.from({ length: 24 }, (_, i) => ({
        id: "l_" + (i + 1),
        num: i + 1,
        title: `Урок ${i + 1}`,
        color: "gray",
        items: [],
        colorLocked: false,
        orderLinked: false,
        notes: "",
      })),
    },
  ]
}
