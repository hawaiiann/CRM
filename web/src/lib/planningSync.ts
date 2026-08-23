import type { Order, PlanningBoard, PlanningLesson } from "@/types/models"

/**
 * Нечёткое совпадение заказа с уроком: класс, предмет, четверть и номер урока.
 * Раньше эти правила были переписаны дважды — внутри syncPlanningWithOrders и
 * в findGoverningOrder — и разошлись бы при первой же правке. Теперь одно
 * место, и на него же опирается отвязка урока от заказа: чтобы разорвать
 * связь, надо знать, поймает ли заказ урок снова по совпадению полей.
 *
 * Явную привязку (linkedLessonId) не учитывает — это отдельное, более сильное
 * правило, которое проверяется до нечёткого.
 */
export function orderMatchesLessonFuzzy(order: Order, board: PlanningBoard, lesson: PlanningLesson): boolean {
  if (!order.grade || !order.lesson) return false

  const lessonNumMatch = String(order.lesson).match(/\d+/)
  if (!lessonNumMatch || parseInt(lessonNumMatch[0], 10) !== lesson.num) return false

  const boardTitle = (board.title || "").trim().toLowerCase()
  const boardSubject = (board.subject || "").trim().toLowerCase()
  const boardQuarter = (board.quarter || "").trim().toLowerCase()

  const orderGrade = (order.grade || "").trim().toLowerCase()
  const orderSubject = (order.subject || "").trim().toLowerCase()
  const orderQuarter = (order.quarter || "").trim().toLowerCase()

  const isGradeMatch = boardTitle === orderGrade || boardTitle.includes(orderGrade) || orderGrade.includes(boardTitle)
  const isSubjectMatch =
    !boardSubject || !orderSubject || boardSubject === orderSubject || boardSubject.includes(orderSubject) || orderSubject.includes(boardSubject)
  const isQuarterMatch =
    !boardQuarter || !orderQuarter || boardQuarter === orderQuarter || boardQuarter.includes(orderQuarter) || orderQuarter.includes(boardQuarter)

  return isGradeMatch && isSubjectMatch && isQuarterMatch
}

/* АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ ЗАКАЗОВ И ПЛАНИРОВАНИЯ
 * Ported 1:1 from js/db.js's syncPlanningWithOrders — same matching rules
 * (explicit linkedLessonId first, fuzzy grade/subject/quarter/lesson-number
 * match as a fallback), same color-locking behavior, same "fromOrder"
 * checklist item bookkeeping. Mutates and returns a new boards array (the
 * original mutated in place; here it returns a fresh array so it plays
 * nicely with the store's immutable setState). */
export function syncPlanningWithOrders(orders: Order[], boardsIn: PlanningBoard[]): PlanningBoard[] {
  if (!orders || !boardsIn) return boardsIn

  const boards: PlanningBoard[] = boardsIn.map((b) => ({
    ...b,
    lessons: (b.lessons || []).map((l) => ({ ...l, items: (l.items || []).map((i) => ({ ...i })) })),
  }))

  const lessonsSyncedByOrder = new Set<PlanningLesson>()

  boards.forEach((board) => {
    board.lessons.forEach((lesson) => {
      lesson.orderLinked = false
    })
  })

  function applyOrderToLesson(o: Order, lesson: PlanningLesson) {
    if (!lesson.items) lesson.items = []

    ;(o.lines || []).forEach((line) => {
      const lineLabel = line.label || line.type || "Работа"
      if (!lineLabel.trim()) return
      let item = lesson.items.find((i) => i.text.toLowerCase() === lineLabel.toLowerCase())
      if (!item) {
        item = { id: "i_" + Date.now() + Math.random().toString(36).slice(2, 7), text: lineLabel, done: false, fromOrder: true }
        lesson.items.push(item)
      }
      item.done = !!line.ready
    })

    const currentLineLabels = new Set(
      (o.lines || []).map((l) => (l.label || l.type || "Работа").trim().toLowerCase()).filter(Boolean)
    )
    lesson.items = lesson.items.filter((item) => !item.fromOrder || currentLineLabels.has(item.text.trim().toLowerCase()))

    if (o.status === "done") {
      ;(o.lines || []).forEach((line) => {
        const lineLabel = line.label || line.type || "Работа"
        const item = lesson.items.find((i) => i.text.toLowerCase() === lineLabel.toLowerCase())
        if (item) item.done = true
      })
    }

    if (!lesson.colorLocked) {
      if (o.status === "done") {
        const totalInL = lesson.items.length
        const doneInL = lesson.items.filter((i) => i.done).length
        if (totalInL === 0 || doneInL === 0) {
          lesson.color = "gray"
        } else {
          const ratio = doneInL / totalInL
          lesson.color = ratio >= 0.99 ? "green-3" : ratio >= 0.5 ? "green-2" : "green-1"
        }
        lessonsSyncedByOrder.add(lesson)
        lesson.orderLinked = true
      } else if (["progress", "review"].includes(o.status)) {
        lesson.color = "yellow"
        lessonsSyncedByOrder.add(lesson)
        lesson.orderLinked = true
      } else if (o.status === "queue") {
        lesson.color = "gray"
        lessonsSyncedByOrder.add(lesson)
        lesson.orderLinked = true
      }
    }
  }

  orders.forEach((o) => {
    if (o.status === "cancelled") return

    if (o.linkedLessonId) {
      let linkedLesson: PlanningLesson | null = null
      for (const board of boards) {
        linkedLesson = board.lessons.find((l) => l.id === o.linkedLessonId) || null
        if (linkedLesson) break
      }
      if (linkedLesson) {
        applyOrderToLesson(o, linkedLesson)
        return
      }
    }

    if (!o.grade || !o.lesson) return

    boards.forEach((board) => {
      const lesson = board.lessons.find((l) => orderMatchesLessonFuzzy(o, board, l))
      if (lesson) applyOrderToLesson(o, lesson)
    })
  })

  boards.forEach((board) => {
    board.lessons.forEach((lesson) => {
      if (lesson.colorLocked) return
      if (lessonsSyncedByOrder.has(lesson)) return

      const items = lesson.items || []
      const totalInL = items.length
      const doneInL = items.filter((i) => i.done).length

      if (totalInL === 0 || doneInL === 0) {
        lesson.color = "gray"
      } else {
        const ratio = doneInL / totalInL
        lesson.color = ratio >= 0.99 ? "green-3" : ratio >= 0.5 ? "green-2" : "green-1"
      }
    })
  })

  return boards
}

// Тот же поиск, что делает syncPlanningWithOrders — возвращает заказ, который
// управляет цветом урока (подсказка «почему ячейка такого цвета» и блок «Заказ»
// в карточке урока). Портировано из db.js findGoverningOrder.
export function findGoverningOrder(orders: Order[], board: PlanningBoard, lesson: PlanningLesson): Order | null {
  if (!orders) return null

  const explicit = orders.find((o) => o.status !== "cancelled" && o.linkedLessonId === lesson.id)
  if (explicit) return explicit

  return (
    orders.find((o) => o.status !== "cancelled" && !o.linkedLessonId && orderMatchesLessonFuzzy(o, board, lesson)) ||
    null
  )
}

/**
 * Обратный поиск: по заказу найти урок, которым он управляет. Нужен на стороне
 * заказа — связь была видна только из планирования, и из карточки заказа нельзя
 * было ни узнать про урок, ни сверить с ним состав.
 */
export function findLessonForOrder(
  boards: PlanningBoard[],
  order: Order
): { board: PlanningBoard; lesson: PlanningLesson } | null {
  if (!boards || order.status === "cancelled") return null

  if (order.linkedLessonId) {
    for (const board of boards) {
      const lesson = board.lessons.find((l) => l.id === order.linkedLessonId)
      if (lesson) return { board, lesson }
    }
    // Явная привязка указывает на удалённый урок — на нечёткое совпадение не
    // переключаемся: так же ведёт себя и автосинхронизация.
    return null
  }

  for (const board of boards) {
    const lesson = board.lessons.find((l) => orderMatchesLessonFuzzy(order, board, l))
    if (lesson) return { board, lesson }
  }
  return null
}
