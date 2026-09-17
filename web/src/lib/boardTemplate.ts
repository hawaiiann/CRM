import type { AppSettings, Order, OrderLine, OrderTemplateLine, PlanningBoard, PlanningLesson } from "@/types/models"
import { parseNum } from "./money"
import { orderMatchesLessonFuzzy } from "./planningSync"

/**
 * Шаблон заказа для доски: состав урока с единицами, количеством и ставками.
 *
 * Заказ и урок — одно и то же для одного дизайнера с одним заказчиком, но
 * заводились они порознь: урок в планировании, заказ отдельно, с перебивкой
 * предмета, класса, номера и цен. Здесь ставки живут у доски, и заказ из
 * урока собирается сразу с деньгами.
 */

const norm = (s: string) => (s || "").trim().toLowerCase()

/** Заказы, относящиеся к доске (по предмету и классу), свежие первыми. */
export function boardOrders(orders: Order[], board: PlanningBoard): Order[] {
  return orders
    .filter((o) => o.status !== "cancelled" && board.lessons.some((l) => o.linkedLessonId === l.id || orderMatchesLessonFuzzy(o, board, l)))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/**
 * Строки шаблона доски. Если шаблон ещё не задан — собирается из чек-листа
 * доски (baseTemplate), а единицы, количество и ставки подсматриваются в
 * последнем заказе этой доски с такой же позицией. Так у существующих досок
 * цены появляются сами, без ручного ввода.
 */
export function boardTemplateLines(settings: AppSettings, board: PlanningBoard, orders: Order[], defaultUnit: string): OrderTemplateLine[] {
  const saved = settings.boardTemplates?.[board.id]
  if (saved && saved.length) return saved
  const recent = boardOrders(orders, board)
  const lookup = (label: string): OrderLine | undefined => {
    for (const o of recent) {
      const line = o.lines.find((l) => norm(l.label) === norm(label))
      if (line) return line
    }
    return undefined
  }
  return (board.baseTemplate || []).filter((t) => t.trim()).map((label) => {
    const known = lookup(label)
    return {
      label,
      type: known?.type || defaultUnit,
      qty: known ? parseNum(known.qty) || 1 : 1,
      rate: known ? parseNum(known.rate) : 0,
    }
  })
}

export interface LessonOrderDefaults {
  unit: string
  makeId: () => string
}

/**
 * Черновик заказа по уроку: предмет, класс, четверть, номер и привязка — из
 * доски и урока; позиции — по чек-листу урока с ценами из шаблона доски;
 * клиент и налог — как в последнем заказе этой доски (или единственный
 * клиент в справочнике). Готовые пункты чек-листа сразу «готовы» в заказе.
 */
export function buildOrderPrefillFromLesson(
  board: PlanningBoard,
  lesson: PlanningLesson,
  template: OrderTemplateLine[],
  orders: Order[],
  settings: AppSettings,
  defaults: LessonOrderDefaults
): Partial<Order> {
  const byLabel = new Map(template.map((t) => [norm(t.label), t]))
  const items = (lesson.items || []).filter((i) => i.text.trim())
  const lines: OrderLine[] = items.map((i) => {
    const t = byLabel.get(norm(i.text))
    return {
      id: defaults.makeId(),
      label: i.text.trim(),
      type: t?.type || defaults.unit,
      qty: t ? parseNum(t.qty) || 1 : 1,
      pomoHours: 0,
      rate: t ? parseNum(t.rate) : 0,
      ignorePrice: false,
      ready: !!i.done,
    }
  })
  // Пустой чек-лист — берём состав целиком из шаблона.
  if (!lines.length) {
    template.forEach((t) => lines.push({ id: defaults.makeId(), label: t.label, type: t.type || defaults.unit, qty: parseNum(t.qty) || 1, pomoHours: 0, rate: parseNum(t.rate), ignorePrice: false, ready: false }))
  }

  const recent = boardOrders(orders, board)[0] || orders.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
  const visibleClients = settings.clients.filter((c) => !(settings.hiddenEntries?.clients || []).includes(c))
  const client = recent?.client || (visibleClients.length === 1 ? visibleClients[0] : "")

  const prefill: Partial<Order> = {
    subject: board.subject || "",
    grade: board.title || "",
    quarter: board.quarter || "",
    lesson: String(lesson.num),
    linkedLessonId: lesson.id,
    client,
    taxType: recent?.taxType || "none",
  }
  if (board.deadline) prefill.deadline = board.deadline
  if (lines.length) prefill.lines = lines
  return prefill
}
