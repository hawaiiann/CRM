import type { Order, PlanningBoard } from "@/types/models"
import { findLessonForOrder } from "./planningSync"

/** Тема урока из планирования, если она задана (а не «Урок 14» по умолчанию). */
export function lessonTopicForOrder(boards: PlanningBoard[], order: Order): string | null {
  const hit = findLessonForOrder(boards, order)
  if (!hit) return null
  const t = (hit.lesson.title || "").trim()
  if (!t || /^урок\s*\d+$/i.test(t)) return null
  return t
}

/**
 * Заголовок заказа с темой урока: «Урок 14 · Пушкин. Лирика». Своё название
 * заказа (title) важнее темы. Без темы — как раньше: предмет, класс, номер.
 */
export function orderTitleWithTopic(boards: PlanningBoard[], order: Order): string {
  if (order.title) return order.title
  const topic = lessonTopicForOrder(boards, order)
  const base = [order.subject, order.grade, order.lesson && `Урок ${order.lesson}`].filter(Boolean).join(", ") || "Без названия"
  return topic ? `${order.lesson ? `Урок ${order.lesson} · ` : ""}${topic}` : base
}
