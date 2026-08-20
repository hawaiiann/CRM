const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

export function fmtDeadline(dStr: string | null | undefined): string {
  if (!dStr) return "—"
  const parts = dStr.split("-").map(Number)
  if (parts.length < 3 || parts.some(isNaN)) return dStr
  const day = String(parts[2]).padStart(2, "0")
  const month = MONTHS[parts[1] - 1] || String(parts[1])
  return `${day} ${month} ${parts[0]} г.`
}

export function fmtDateRangeCompact(startStr: string, endStr: string): string {
  if (!startStr || !endStr) return `${fmtDeadline(startStr)} — ${fmtDeadline(endStr)}`.replace(/ г\./g, "")
  const s = startStr.split("-").map(Number)
  const e = endStr.split("-").map(Number)
  if (s.length < 3 || e.length < 3 || s.some(isNaN) || e.some(isNaN)) return `${startStr} — ${endStr}`
  const [sy, sm, sd] = s
  const [ey, em, ed] = e
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS[em - 1]} ${ey}`
  if (sy === ey) return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${ey}`
  return `${sd} ${MONTHS[sm - 1]} ${sy} – ${ed} ${MONTHS[em - 1]} ${ey}`
}
