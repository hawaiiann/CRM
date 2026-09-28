import type { Order, PlanningBoard, PlanningLesson } from "@/types/models"
import { lessonDisplayColor } from "./planningStats"

/**
 * Класс как ключ для сравнения: «9 класс», «9», « 9  Класс» → «9»;
 * «9А», «9 а класс» → «9а». Раньше класс сравнивался вхождением подстроки, и
 * доска «1 класс» ловила заказы «11 класс». Без цифры — строка целиком, без
 * слова «класс».
 */
export function gradeKey(s: string): string {
  const t = (s || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ")
  const m = t.match(/(?:^|\D)(\d{1,2})\s*-?\s*([a-zа-я])?(?![a-zа-я\d])/)
  if (m) return String(parseInt(m[1], 10)) + (m[2] || "")
  return t.replace(/класс\S*/g, "").replace(/\s+/g, " ").trim()
}

/**
 * Нечёткое совпадение заказа с уроком: класс, предмет, четверть и номер урока.
 * Раньше эти правила были переписаны дважды — внутри syncPlanningWithOrders и
 * в findGoverningOrder — и разошлись бы при первой же правке. Теперь одно
 * место, и на него же опирается отвязка урока от заказа: чтобы разорвать
 * связь, надо знать, поймает ли заказ урок снова по совпадению полей.
 *
 * Явную привязку (linkedLessonId) не учитывает — это отдельное, более сильное
 * правило, которое проверяется до нечёткого. Архив и выбор одной доски из
 * нескольких совпавших — тоже не здесь, а в fuzzyTargetForOrder: это только
 * сравнение полей.
 */
export function orderMatchesLessonFuzzy(order: Order, board: PlanningBoard, lesson: PlanningLesson): boolean {
  if (!order.grade || !order.lesson) return false

  const lessonNumMatch = String(order.lesson).match(/\d+/)
  if (!lessonNumMatch || parseInt(lessonNumMatch[0], 10) !== lesson.num) return false

  const boardSubject = (board.subject || "").trim().toLowerCase()
  const boardQuarter = (board.quarter || "").trim().toLowerCase()

  const orderSubject = (order.subject || "").trim().toLowerCase()
  const orderQuarter = (order.quarter || "").trim().toLowerCase()

  // Доска без класса, как и раньше, подходит к любому классу заказа.
  const boardGrade = gradeKey(board.title || "")
  const isGradeMatch = !boardGrade || boardGrade === gradeKey(order.grade)
  const isSubjectMatch =
    !boardSubject || !orderSubject || boardSubject === orderSubject || boardSubject.includes(orderSubject) || orderSubject.includes(boardSubject)
  const isQuarterMatch =
    !boardQuarter || !orderQuarter || boardQuarter === orderQuarter || boardQuarter.includes(orderQuarter) || orderQuarter.includes(boardQuarter)

  return isGradeMatch && isSubjectMatch && isQuarterMatch
}

type LessonRef = { board: PlanningBoard; lesson: PlanningLesson }

function lessonExists(boards: PlanningBoard[], lessonId: string): boolean {
  return boards.some((b) => (b.lessons || []).some((l) => l.id === lessonId))
}

/** YYYY-MM-DD → номер дня; не дата — null. */
function dayNumber(s: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "")
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null
}

/**
 * Урок, который заказ ловит нечётким совпадением, — один на все доски.
 *
 * Раньше заказ применялся к совпавшему уроку на КАЖДОЙ доске, включая архив и
 * класс прошлого года с теми же полями. Теперь архивные доски не участвуют, а
 * из нескольких живых берётся одна: с дедлайном, ближайшим к сроку заказа;
 * если сравнить не по чему (нет дат) — последняя в списке, то есть созданная
 * позже.
 */
export function fuzzyTargetForOrder(order: Order, boards: PlanningBoard[]): LessonRef | null {
  if (!boards || order.status === "cancelled" || !order.grade || !order.lesson) return null
  const found: LessonRef[] = []
  boards.forEach((board) => {
    if (board.archived) return
    const lesson = (board.lessons || []).find((l) => orderMatchesLessonFuzzy(order, board, l))
    if (lesson) found.push({ board, lesson })
  })
  if (found.length <= 1) return found[0] || null

  const ref = dayNumber(order.deadline) ?? dayNumber(order.start)
  if (ref !== null && found.every((f) => dayNumber(f.board.deadline) !== null)) {
    let best = found[0]
    let bestDist = Infinity
    found.forEach((f) => {
      const d = Math.abs(dayNumber(f.board.deadline)! - ref)
      // «<=» — при равенстве побеждает доска, созданная позже.
      if (d <= bestDist) { best = f; bestDist = d }
    })
    return best
  }
  return found[found.length - 1]
}

/**
 * Из нескольких заказов одного урока управляет один: самый свежий по
 * createdAt, при равенстве — по id. Порядок массива заказов для этого не
 * годится: из облака они приходят без сортировки. Раньше к уроку применялись
 * все по очереди, и второй заказ сбрасывал галочки пунктов первого.
 */
function pickGoverning(list: Order[]): Order | null {
  let best: Order | null = null
  for (const o of list) {
    if (!best) { best = o; continue }
    const a = o.createdAt || 0, b = best.createdAt || 0
    if (a > b || (a === b && o.id < best.id)) best = o
  }
  return best
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
      // Пункт, пришедший из заказа, повторяет готовность позиции в обе
      // стороны. Пункт, заведённый вручную (из шаблона доски или руками),
      // заказ может только ЗАКРЫТЬ — снять галочку он не вправе: раньше
      // ручная отметка откатывалась при каждом сохранении, и в планировании
      // нельзя было отметить сделанное, пока позиция заказа не «готова».
      if (item.fromOrder) item.done = !!line.ready
      else if (line.ready) item.done = true
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

    // Цвет — по чек-листу (lessonDisplayColor), статус заказа лишь добавляет
    // жёлтый «в работе», пока ничего не закрыто. Раньше «в очереди» красил
    // клетку серой поверх любых галочек.
    lesson.orderLinked = true
    lessonsSyncedByOrder.add(lesson)
    if (!lesson.colorLocked) lesson.color = lessonDisplayColor(lesson, o)
  }

  // Сначала раскладываем заказы по урокам, потом применяем к каждому уроку
  // ровно один управляющий заказ — тот же, что вернёт findGoverningOrder.
  // Явная привязка сильнее нечёткой; привязка к удалённому уроку считается
  // пустой, и заказ ищет урок по полям.
  const lessonById = new Map<string, PlanningLesson>()
  boards.forEach((b) => b.lessons.forEach((l) => { if (!lessonById.has(l.id)) lessonById.set(l.id, l) }))
  const explicitByLesson = new Map<PlanningLesson, Order[]>()
  const fuzzyByLesson = new Map<PlanningLesson, Order[]>()
  const push = (m: Map<PlanningLesson, Order[]>, l: PlanningLesson, o: Order) => {
    const list = m.get(l)
    if (list) list.push(o)
    else m.set(l, [o])
  }

  orders.forEach((o) => {
    if (o.status === "cancelled") return
    const linked = o.linkedLessonId ? lessonById.get(o.linkedLessonId) : undefined
    if (linked) { push(explicitByLesson, linked, o); return }
    const target = fuzzyTargetForOrder(o, boards)
    if (target) push(fuzzyByLesson, target.lesson, o)
  })

  boards.forEach((board) => {
    board.lessons.forEach((lesson) => {
      const o = pickGoverning(explicitByLesson.get(lesson) || []) || pickGoverning(fuzzyByLesson.get(lesson) || [])
      if (o) applyOrderToLesson(o, lesson)
    })
  })

  boards.forEach((board) => {
    board.lessons.forEach((lesson) => {
      if (lesson.colorLocked) return
      if (lessonsSyncedByOrder.has(lesson)) return
      lesson.color = lessonDisplayColor(lesson, null)
    })
  })

  return boards
}

/**
 * Готовность позиций заказа по чек-листу урока: галочка в уроке ставит
 * позицию «готова» и наоборот. Без этого пункт, пришедший из заказа,
 * откатывался автосинхронизацией при следующем же сохранении, а таймер
 * продолжал считать позицию открытой.
 */
export function applyLessonItemsToOrderLines(order: Order, lesson: PlanningLesson): Order {
  const doneByText = new Map((lesson.items || []).map((i) => [i.text.trim().toLowerCase(), !!i.done]))
  let changed = false
  const lines = (order.lines || []).map((line) => {
    const key = (line.label || line.type || "Работа").trim().toLowerCase()
    const done = doneByText.get(key)
    if (done === undefined || !!line.ready === done) return line
    changed = true
    return { ...line, ready: done }
  })
  return changed ? { ...order, lines } : order
}

// Тот же поиск, что делает syncPlanningWithOrders — возвращает заказ, который
// управляет цветом урока (подсказка «почему ячейка такого цвета» и блок «Заказ»
// в карточке урока). Портировано из db.js findGoverningOrder.
//
// boards — все доски: без них не выбрать одну доску из нескольких совпавших и
// не понять, жив ли урок явной привязки. Без boards (старый вызов) нечёткий
// поиск идёт только по этой доске и только если автосинхронизация и правда
// вела урок заказом (lesson.orderLinked) — иначе заказ мог бы «найтись» здесь,
// хотя синхронизация отдала его другой доске.
export function findGoverningOrder(orders: Order[], board: PlanningBoard, lesson: PlanningLesson, boards?: PlanningBoard[]): Order | null {
  if (!orders) return null

  const explicit = pickGoverning(orders.filter((o) => o.status !== "cancelled" && o.linkedLessonId === lesson.id))
  if (explicit) return explicit
  if (board.archived) return null
  if (!boards && !lesson.orderLinked) return null

  const pool = boards || [board]
  return pickGoverning(
    orders.filter((o) => {
      if (o.status === "cancelled" || !orderMatchesLessonFuzzy(o, board, lesson)) return false
      // Привязка к живому уроку — заказ ведёт тот урок, а не этот. Привязка
      // к удалённому считается пустой, как и в автосинхронизации.
      if (o.linkedLessonId && lessonExists(pool, o.linkedLessonId)) return false
      const target = fuzzyTargetForOrder(o, pool)
      return !!target && target.board.id === board.id && target.lesson.id === lesson.id
    })
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
    // Явная привязка указывает на удалённый урок — ищем по полям, как и
    // автосинхронизация: раньше здесь был null, а урок при этом уже вёлся
    // этим заказом.
  }

  return fuzzyTargetForOrder(order, boards)
}
