function csvEscape(val: unknown): string {
  const s = String(val ?? "")
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function buildCsv(sections: { title?: string; header: string[]; rows: (string | number)[][] }[]): string {
  const lines: string[] = []
  sections.forEach((s, i) => {
    if (i > 0) lines.push("") // пустая строка отделяет один раздел от другого
    if (s.title) lines.push(csvEscape(s.title))
    lines.push(s.header.map(csvEscape).join(";"))
    s.rows.forEach((row) => lines.push(row.map(csvEscape).join(";")))
  })
  return "﻿" + lines.join("\r\n") // BOM — иначе Excel показывает кириллицу битой
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  downloadBlob(filename, buildCsv([{ header, rows }]))
}

/**
 * Несколько таблиц в одном файле, каждая со своим заголовком и подписью.
 * CSV не поддерживает листы, как настоящий .xlsx, — разделы просто идут
 * подряд через пустую строку. Excel открывает такой файл как обычную
 * таблицу; для «Прогресса по классам» и «Прогресса по позициям» в одном
 * экспорте планирования этого достаточно и не тянет за собой библиотеку
 * для сборки настоящего .xlsx.
 */
export function downloadCsvSections(filename: string, sections: { title?: string; header: string[]; rows: (string | number)[][] }[]) {
  downloadBlob(filename, buildCsv(sections))
}
