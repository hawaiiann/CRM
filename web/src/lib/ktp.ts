/**
 * Разбор КТП (календарно-тематического планирования), вставленного текстом
 * из документа или таблицы. Формат у школ разный, поэтому правила
 * нестрогие: в строке ищем номер урока, тему, дату и число часов, а всё
 * лишнее (столбцы «Примечание», «Домашнее задание») пропускаем.
 *
 * Строка = урок, если в ней есть номер и хоть какой-то текст. Строки без
 * номера, идущие сразу за уроком, считаются продолжением темы (перенос
 * строки внутри ячейки таблицы).
 */
export interface KtpLesson {
  num: number
  title: string
  /** YYYY-MM-DD, если в строке была дата. */
  date?: string
  /** Часов на тему (1–9), если было отдельное число. */
  hours?: number
}

export interface KtpParseResult {
  lessons: KtpLesson[]
  /** Строки, в которых не нашлось ни номера, ни продолжения — для подсказки. */
  skipped: number
}

const DATE_RE = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/
const DATE_RANGE_RE = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s*[-–—]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/

function toIso(d: string, m: string, y: string | undefined, fallbackYear: number): string | undefined {
  const day = parseInt(d, 10), mon = parseInt(m, 10)
  if (day < 1 || day > 31 || mon < 1 || mon > 12) return undefined
  let year = y ? parseInt(y, 10) : fallbackYear
  if (y && y.length === 2) year = 2000 + year
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function splitCells(line: string): string[] {
  const byTab = line.split("\t")
  if (byTab.length > 1) return byTab.map((s) => s.trim())
  if (line.includes("|")) return line.split("|").map((s) => s.trim())
  return line.split(/\s{2,}/).map((s) => s.trim())
}

export function parseKtp(text: string, opts: { year?: number } = {}): KtpParseResult {
  const year = opts.year ?? new Date().getFullYear()
  const lessons: KtpLesson[] = []
  let skipped = 0
  let last: KtpLesson | null = null

  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.replace(/ /g, " ").trim()
    if (!line) return
    const cells = splitCells(line).filter((c) => c !== "")
    if (!cells.length) return

    // Дата: первая дата (или начало диапазона) в любой ячейке.
    let date: string | undefined
    let rest = cells
    for (const c of cells) {
      const r = c.match(DATE_RANGE_RE) || c.match(DATE_RE)
      if (r) { date = toIso(r[1], r[2], r[3], year); break }
    }
    if (date) rest = rest.map((c) => c.replace(DATE_RANGE_RE, "").replace(DATE_RE, "").trim()).filter(Boolean)

    // Номер урока: первая ячейка, которая целиком число (или «12.» / «№12»).
    let num: number | undefined
    let numIdx = -1
    for (let i = 0; i < rest.length; i++) {
      const m = rest[i].match(/^(?:№\s*)?(\d{1,3})\.?$/)
      if (m) { num = parseInt(m[1], 10); numIdx = i; break }
    }
    // Номер в начале единственной ячейки: «12. Тема урока» / «12 Тема».
    if (num === undefined && rest.length) {
      const m = rest[0].match(/^(?:№\s*)?(\d{1,3})[.)]?\s+(.+)$/)
      if (m) { num = parseInt(m[1], 10); rest = [m[2], ...rest.slice(1)]; numIdx = -1 }
    }

    if (num === undefined) {
      // Продолжение темы предыдущего урока.
      const tail = rest.filter((c) => !/^\d{1,3}$/.test(c)).join(" ").trim()
      if (last && tail && !/^[-–—]+$/.test(tail)) { last.title = (last.title + " " + tail).trim() } else skipped++
      return
    }

    const others = rest.filter((_, i) => i !== numIdx)
    // Часы: маленькое целое отдельной ячейкой.
    let hours: number | undefined
    const hoursIdx = others.findIndex((c) => /^\d$/.test(c))
    if (hoursIdx >= 0) { hours = parseInt(others[hoursIdx], 10); others.splice(hoursIdx, 1) }
    // Тема — самая длинная оставшаяся ячейка.
    const title = others.slice().sort((a, b) => b.length - a.length)[0] || ""
    const lesson: KtpLesson = { num, title: title.replace(/\s+/g, " ").trim() }
    if (date) lesson.date = date
    if (hours) lesson.hours = hours
    lessons.push(lesson)
    last = lesson
  })

  // Дубли номеров (одна тема на два урока в таблице) — оставляем первый.
  const seen = new Set<number>()
  const unique = lessons.filter((l) => (seen.has(l.num) ? false : (seen.add(l.num), true))).sort((a, b) => a.num - b.num)
  return { lessons: unique, skipped }
}

/**
 * График по датам КТП: старт — первая дата, уроков в неделю — самое частое
 * число уроков в полной календарной неделе, первая неделя — сколько в ней
 * уроков по факту.
 */
export function scheduleFromKtp(lessons: KtpLesson[]): { start: string; perWeek: number; firstWeekLessons: number } | null {
  const dated = lessons.filter((l) => l.date).sort((a, b) => a.date!.localeCompare(b.date!))
  if (dated.length < 2) return null
  const start = dated[0].date!
  const [y, m, d] = start.split("-").map(Number)
  const startDate = new Date(y, m - 1, d)
  const monday = new Date(startDate)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const weekOf = (iso: string) => {
    const [yy, mm, dd] = iso.split("-").map(Number)
    return Math.floor((new Date(yy, mm - 1, dd).getTime() - monday.getTime()) / (7 * 86400000))
  }
  const counts = new Map<number, number>()
  dated.forEach((l) => counts.set(weekOf(l.date!), (counts.get(weekOf(l.date!)) || 0) + 1))
  const firstWeekLessons = counts.get(0) || 1
  const full = [...counts.entries()].filter(([w]) => w > 0).map(([, n]) => n)
  const mode = (arr: number[]) => {
    const f = new Map<number, number>()
    arr.forEach((n) => f.set(n, (f.get(n) || 0) + 1))
    return [...f.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0]
  }
  const perWeek = mode(full) || firstWeekLessons
  return { start, perWeek, firstWeekLessons }
}
