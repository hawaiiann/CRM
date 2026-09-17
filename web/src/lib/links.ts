/**
 * Ссылки в свободном тексте (задачи, заметки к уроку). Текст «6кл лит
 * https://drive.google.com/drive/folders/…» раньше показывался как есть — длинный
 * адрес, который нельзя ни нажать, ни прочитать.
 */
const URL_RE = /https?:\/\/[^\s<>"']+/g

export interface TextPart {
  kind: "text" | "link"
  value: string
}

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const idx = m.index ?? 0
    let url = m[0]
    // Точка или скобка в конце обычно относятся к предложению, а не к адресу.
    while (/[.,;:)!?]$/.test(url)) url = url.slice(0, -1)
    if (idx > last) parts.push({ kind: "text", value: text.slice(last, idx) })
    parts.push({ kind: "link", value: url })
    last = idx + url.length
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) })
  return parts
}

export function extractLinks(text: string): string[] {
  return splitLinks(text).filter((p) => p.kind === "link").map((p) => p.value)
}

/** Короткая подпись ссылки: «drive.google.com», «disk.yandex.ru». */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, "")
    if (/drive\.google\.com/.test(host)) return "Google Диск"
    if (/docs\.google\.com/.test(host)) return "Google Документ"
    if (/disk\.yandex/.test(host)) return "Яндекс Диск"
    if (/figma\.com/.test(host)) return "Figma"
    if (/canva\.com/.test(host)) return "Canva"
    return host
  } catch {
    return url
  }
}
