import type { Order, OrderLine } from "@/types/models"
import { parseNum, parseHours } from "./money"

/**
 * Объединение двух заказов на один урок. В данных такие дубли появлялись,
 * когда заказ заводили дважды (из урока и из списка): позиции, оплаты и
 * часы расползались по двум карточкам, а в акте урок шёл двумя строками.
 *
 * Правила: остаётся более ранний заказ (primary); позиции второго с новым
 * названием добавляются, с тем же названием — складываются часы и берётся
 * большее количество; оплаты, списания аванса и заметки складываются;
 * статус — самый продвинутый из двух; срок — ближайший.
 */
const STATUS_RANK: Record<Order["status"], number> = { queue: 0, progress: 1, review: 2, done: 3, cancelled: -1 }
const norm = (s: string) => (s || "").trim().toLowerCase()

export function mergeOrders(primary: Order, secondary: Order): Order {
  const lines: OrderLine[] = primary.lines.map((l) => ({ ...l }))
  secondary.lines.forEach((sl) => {
    const key = norm(sl.label || sl.type)
    const same = lines.find((l) => norm(l.label || l.type) === key)
    if (!same) { lines.push({ ...sl }); return }
    same.pomoHours = Math.round((parseHours(same.pomoHours) + parseHours(sl.pomoHours)) * 10000) / 10000
    same.qty = Math.max(parseNum(same.qty), parseNum(sl.qty))
    same.rate = parseNum(same.rate) || parseNum(sl.rate)
    same.ready = same.ready && sl.ready
  })
  const status = STATUS_RANK[secondary.status] > STATUS_RANK[primary.status] ? secondary.status : primary.status
  const deadlines = [primary.deadline, secondary.deadline].filter(Boolean).sort()
  const notes = [primary.notes, secondary.notes].map((n) => (n || "").trim()).filter(Boolean).join("\n")
  const sumOrKeep = (a: string | number, b: string | number) => (parseNum(a) || parseNum(b) ? String(parseNum(a) + parseNum(b)) : a)
  return {
    ...primary,
    title: primary.title || secondary.title,
    client: primary.client || secondary.client,
    status,
    deadline: deadlines[0] || primary.deadline,
    start: [primary.start, secondary.start].filter(Boolean).sort()[0] || primary.start,
    lines,
    payments: [...primary.payments, ...secondary.payments],
    paidAmount: parseNum(primary.paidAmount) + parseNum(secondary.paidAmount),
    advanceUsed: parseNum(primary.advanceUsed) + parseNum(secondary.advanceUsed),
    advanceAllocations: combineAllocations([...(primary.advanceAllocations || []), ...(secondary.advanceAllocations || [])]),
    aiRate: parseNum(primary.aiRate) || parseNum(secondary.aiRate),
    urgencyPct: Math.max(parseNum(primary.urgencyPct), parseNum(secondary.urgencyPct)),
    isPaid: primary.isPaid && secondary.isPaid,
    priority: primary.priority || secondary.priority,
    linkedLessonId: primary.linkedLessonId || secondary.linkedLessonId,
    estimatedHours: sumOrKeep(primary.estimatedHours, secondary.estimatedHours),
    actualHours: sumOrKeep(primary.actualHours, secondary.actualHours),
    notes,
  }
}

/**
 * Списания с одного аванса — одной строкой. Дубли одного урока обычно брали
 * из одного, самого старого аванса, и после слияния выходило две строки на
 * один аванс: форма показывала только первую, а правка суммы стирала обе.
 */
function combineAllocations(list: Order["advanceAllocations"]): Order["advanceAllocations"] {
  const byId = new Map<string, number>()
  list.forEach((a) => byId.set(a.advanceId, Math.round(((byId.get(a.advanceId) || 0) + parseNum(a.amount)) * 100) / 100))
  return [...byId.entries()].map(([advanceId, amount]) => ({ advanceId, amount }))
}

/**
 * Номер урока для поиска дублей: «Урок 10», «10» и « 10 » — одно и то же,
 * а «10-11» и «10а» — другие уроки. Раньше бралось первое число, и «10» с
 * «10-11» (или «10а» с «10б») помечались дублями.
 */
export function lessonKey(lesson: string): string {
  const k = norm(lesson).replace(/урок/g, "").replace(/[\s№.]+/g, "")
  return /\d/.test(k) ? k : ""
}

/** Дубли: неотменённые заказы с одинаковыми предметом, классом, четвертью и номером урока; в группе раньше созданный первым. */
export function duplicateOrderGroups(orders: Order[]): Order[][] {
  const map = new Map<string, Order[]>()
  orders.forEach((o) => {
    if (o.status === "cancelled") return
    const n = lessonKey(String(o.lesson || ""))
    if (!n) return
    const key = [o.subject, o.grade, o.quarter, n].map(norm).join("|")
    const list = map.get(key)
    if (list) list.push(o)
    else map.set(key, [o])
  })
  return [...map.values()].filter((g) => g.length > 1).map((g) => g.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)))
}
