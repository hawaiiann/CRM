function csvEscape(val: unknown): string {
  const s = String(val ?? "")
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const csvLines = [header, ...rows].map((row) => row.map(csvEscape).join(";"))
  const csvStr = "﻿" + csvLines.join("\r\n")
  const blob = new Blob([csvStr], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
