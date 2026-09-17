import type { PlanningLesson } from "@/types/models"
import { dateKey, addDays } from "./money"

/**
 * График класса: сколько уроков в неделю и с какого числа. По нему уроки
 * раскладываются по неделям, и видно, где программа должна быть сегодня и
 * сколько уроков отстаёт. Хранится в настройках (boardSchedules[boardId]),
 * а не в самой доске, чтобы не менять таблицу planning_boards.
 *
 * Недели — календарные, с понедельника по воскресенье, как в КТП. Первая
 * неделя может быть неполной: четверть началась в среду — первая неделя
 * это среда–воскресенье, и уроков в ней столько, сколько указано в
 * firstWeekLessons (по умолчанию — доля от полной недели по числу учебных
 * дней). Исключения по неделям (каникулы, праздники, короткая неделя) —
 * в exceptions: номер недели (с 1) → сколько уроков в ней.
 */
export interface BoardSchedule {
  /** Первый учебный день, YYYY-MM-DD; любой день недели. */
  start: string
  perWeek: number
  /** Уроков в первой (неполной) неделе; не задано — считается по учебным дням. */
  firstWeekLessons?: number
  /** Номер недели (с 1) → уроков в ней. 0 — каникулы. */
  exceptions?: Record<string, number>
}

export interface ScheduleWeek {
  /** С нуля. */
  index: number
  start: string
  end: string
  /** Сколько уроков положено в эту неделю по графику. */
  planned: number
  lessons: PlanningLesson[]
}

export interface ScheduleStatus {
  weeks: ScheduleWeek[]
  /** Индекс недели, в которую попадает сегодня; −1 до старта, weeks.length после конца. */
  currentWeek: number
  /** Сколько уроков должно быть закрыто к концу прошлой недели. */
  plannedByNow: number
  /** Сколько уроков закрыто по факту. */
  done: number
  /** plannedByNow − done, если положительно. */
  behind: number
  /** Уроки текущей недели. */
  thisWeek: PlanningLesson[]
  end: string
}

export function scheduleValid(s: BoardSchedule | undefined | null): s is BoardSchedule {
  return !!s && !!s.start && /^\d{4}-\d{2}-\d{2}$/.test(s.start) && s.perWeek > 0
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/** 0 — понедельник … 6 — воскресенье. */
export function weekdayIndex(dateStr: string): number {
  return (parseDate(dateStr).getDay() + 6) % 7
}

/**
 * Уроков в первой неделе по умолчанию: доля полной недели по оставшимся
 * учебным дням (пн–пт). Старт в среду при 4 уроках в неделю → 3 дня из 5 →
 * 2 урока. Округление вверх: лучше показать урок раньше, чем спрятать.
 */
export function defaultFirstWeekLessons(start: string, perWeek: number): number {
  const wd = weekdayIndex(start)
  const schoolDaysLeft = Math.max(0, 5 - Math.min(wd, 5))
  if (schoolDaysLeft >= 5) return perWeek
  return Math.min(perWeek, Math.ceil((perWeek * schoolDaysLeft) / 5))
}

/** Сколько уроков положено в неделю с индексом i (с нуля). */
export function plannedForWeek(s: BoardSchedule, i: number): number {
  const ex = s.exceptions?.[String(i + 1)]
  if (ex !== undefined && ex !== null && Number.isFinite(ex)) return Math.max(0, Math.floor(ex))
  if (i === 0) return s.firstWeekLessons ?? defaultFirstWeekLessons(s.start, s.perWeek)
  return Math.max(1, Math.floor(s.perWeek))
}

export function scheduleWeeks(lessons: PlanningLesson[], s: BoardSchedule): ScheduleWeek[] {
  const sorted = lessons.slice().sort((a, b) => (a.num || 0) - (b.num || 0))
  const start = parseDate(s.start)
  // Конец первой недели — ближайшее воскресенье; дальше недели идут пн–вс.
  const firstEnd = addDays(start, 6 - weekdayIndex(s.start))
  const weeks: ScheduleWeek[] = []
  let cursor = 0
  // Защита от бесконечного цикла при нулевых исключениях подряд: не больше
  // 60 недель без единого урока.
  let idle = 0
  for (let i = 0; cursor < sorted.length && idle < 60; i++) {
    const planned = plannedForWeek(s, i)
    const wStart = i === 0 ? start : addDays(firstEnd, 1 + (i - 1) * 7)
    const wEnd = i === 0 ? firstEnd : addDays(wStart, 6)
    weeks.push({ index: i, start: dateKey(wStart), end: dateKey(wEnd), planned, lessons: sorted.slice(cursor, cursor + planned) })
    cursor += planned
    idle = planned === 0 ? idle + 1 : 0
  }
  return weeks
}

export function scheduleStatus(lessons: PlanningLesson[], s: BoardSchedule, today: string, isDone: (l: PlanningLesson) => boolean): ScheduleStatus {
  const weeks = scheduleWeeks(lessons, s)
  let currentWeek = -1
  if (weeks.length && today >= weeks[0].start) {
    currentWeek = weeks.findIndex((w) => today >= w.start && today <= w.end)
    if (currentWeek === -1) currentWeek = weeks.length
  }
  const plannedByNow = weeks.filter((w) => w.end < today).reduce((n, w) => n + w.lessons.length, 0)
  const done = lessons.filter(isDone).length
  return {
    weeks,
    currentWeek,
    plannedByNow,
    done,
    behind: Math.max(0, plannedByNow - done),
    thisWeek: currentWeek >= 0 && currentWeek < weeks.length ? weeks[currentWeek].lessons : [],
    end: weeks.length ? weeks[weeks.length - 1].end : s.start,
  }
}

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
const WEEKDAYS_RU = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]

export function weekdayLabel(dateStr: string): string {
  return WEEKDAYS_RU[weekdayIndex(dateStr)]
}

/** «1–7 сен», «29 сен – 5 окт». */
export function weekLabel(w: Pick<ScheduleWeek, "start" | "end">): string {
  const [, sm, sd] = w.start.split("-").map(Number)
  const [, em, ed] = w.end.split("-").map(Number)
  if (sm === em) return `${sd}–${ed} ${MONTHS[sm - 1]}`
  return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}`
}
