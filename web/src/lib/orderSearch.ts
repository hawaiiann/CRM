import type { Order } from "@/types/models"

/**
 * Поиск по заказам. Общий для Заказов и Финансов, чтобы вести себя одинаково.
 *
 * Две вещи, которых не хватало:
 *
 * 1. Номер урока не искался у заказов с собственным названием — он попадал в
 *    текст только через автосборку «Предмет, Класс, Урок N», а она работает
 *    лишь когда название пустое.
 *
 * 2. Запрос ищется по словам, а не целой строкой: «9а 5» должно находить
 *    «Литература, 9А, 1, Урок 5», хотя такой подстроки в тексте нет.
 *
 * Отдельно разбирается «урок N»: иначе токен «5» совпадал с клиентом
 * «Клиент 5», и поиск конкретного урока притаскивал чужие строки. Если в
 * запросе есть «урок N» (или «ур N»), номер сверяется с полем урока точно,
 * а остальные слова ищутся как обычно.
 */
/** ё = е: «Алёна» находится и по «алена», и наоборот. */
const fold = (s: string) => s.toLowerCase().replace(/ё/g, "е")

export function orderMatchesQuery(o: Order, query: string): boolean {
  const q = fold(query.trim())
  if (!q) return true

  let rest = q
  let lessonWanted: string | null = null
  // ВНИМАНИЕ: без \b. В JavaScript граница слова определяется через [A-Za-z0-9_],
  // кириллица в этот набор не входит, поэтому /\bур/ с русским «урок» не
  // совпадает НИКОГДА — правило молча не срабатывало. Границы задаём явно:
  // начало строки или пробел слева, пробел или конец справа.
  const m = rest.match(/(?:^|\s)ур(?:ок)?\.?\s*(\d+)(?=\s|$)/)
  if (m) {
    lessonWanted = m[1]
    rest = (rest.slice(0, m.index) + " " + rest.slice((m.index ?? 0) + m[0].length)).trim()
  }

  if (lessonWanted !== null) {
    // В поле урока бывает и «Урок 10», и «10»: сравниваем номер, а не строку.
    const lesson = fold(String(o.lesson ?? "")).replace(/урок/g, "").trim()
    if (lesson !== lessonWanted) return false
  }

  const words = rest.split(/\s+/).filter(Boolean)
  if (!words.length) return true

  const hay = [
    o.title,
    o.client,
    o.subject,
    o.grade,
    o.quarter,
    o.lesson && `урок ${o.lesson}`,
    o.lesson,
  ]
    .filter(Boolean)
    .join(" ")
  const hayFolded = fold(hay)

  return words.every((w) => hayFolded.includes(w))
}
