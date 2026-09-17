import type { PlanningLesson } from "@/types/models"
import { dateKey, addDays } from "./money"

/**
 * График класса: сколько уроков в неделю и с какого числа. По нему уроки
 * раскладываются по неделям, и видно, где программа должна быть сегодня и
 * сколько уроков отстаёт. Хранится в настройках (boardSchedules[boardId]),
 * а не в самой доске, чтобы не менять таблицу planning_boards.
 */
export interface BoardSchedule {
  /** Первый день первой недели, YYYY-MM-DD. */
  start: string
  perWeek: number
}

export interface ScheduleWeek {
  /** С нуля. */
  index: number
  start: string
  end: string
  lessons: PlanningLesson[]
}

export interface ScheduleStatus {
  weeks: ScheduleWeek[]
  /** Индекс недели, в которую попадает сегодня; −1 до старта, weeks.length после конца. */
  currentWeek: number
  /** Сколько уроков должно быть закрыто к концу прошлой недели. */
  plannedByNow: number
  /** Сколько уроков закрыто по факту (в порядке номеров). */
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

export function scheduleWeeks(lessons: PlanningLesson[], s: BoardSchedule): ScheduleWeek[] {
  const sorted = lessons.slice().sort((a, b) => (a.num || 0) - (b.num || 0))
  const per = Math.max(1, Math.floor(s.perWeek))
  const [y, m, d] = s.start.split("-").map(Number)
  const start = new Date(y, m - 1, d)
  const weeks: ScheduleWeek[] = []
  for (let i = 0; i * per < sorted.length; i++) {
    weeks.push({
      index: i,
      start: dateKey(addDays(start, i * 7)),
      end: dateKey(addDays(start, i * 7 + 6)),
      lessons: sorted.slice(i * per, (i + 1) * per),
    })
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

/** «1–7 сен», «29 сен – 5 окт». */
export function weekLabel(w: Pick<ScheduleWeek, "start" | "end">): string {
  const [, sm, sd] = w.start.split("-").map(Number)
  const [, em, ed] = w.end.split("-").map(Number)
  if (sm === em) return `${sd}–${ed} ${MONTHS[sm - 1]}`
  return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}`
}
