// exceljs подключается динамическим import() из PlanningExportDialog, а не
// статическим импортом здесь — библиотека нужна только в момент нажатия
// «Скачать», и без ленивой загрузки она вошла бы в стартовый кусок
// приложения, который в v2.12.1 специально ужимали.
import type ExcelJS from "exceljs"
import type { PlanningBoard } from "@/types/models"
import { computeBoardProgress, lessonDisplayColor, type LessonColor } from "./planningStats"
import { fmtDeadline } from "./dates"

/**
 * Цвета строк «По урокам» — не то же самое, что CSS-токены приложения
 * (--success, --warning и т. п.): те заточены под полупрозрачные подложки на
 * тёмном/светлом фоне интерфейса, а здесь сплошная заливка ячейки на белом
 * листе Excel. Палитра подобрана отдельно, но узнаваемо: тот же зелёный,
 * что и в DASHBOARD_METRIC_COLORS_LIGHT (dashboardMetrics.ts) и тот же
 * красный, что и --destructive.
 */
const FILL_HEX: Record<LessonColor, string> = {
  gray: "FFEFEFED",
  yellow: "FFF5A623",
  "green-1": "FFE3F0C7",
  "green-2": "FFC4E38A",
  "green-3": "FF7CB518",
  red: "FFE4483F",
}
// Тёмный текст на светлой заливке, белый — на насыщенной.
const DARK_TEXT: LessonColor[] = ["gray", "green-1", "green-2"]

const HEADER_FILL = "FF2C2D31"
const HEADER_FONT = "FFFFFFFF"

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT } }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }
    cell.alignment = { vertical: "middle" }
  })
  row.height = 20
}

function autoWidth(ws: ExcelJS.Worksheet, widths: number[]) {
  ws.columns.forEach((col, i) => { col.width = widths[i] })
}

/**
 * Собирает книгу планирования: три листа — «По классам», «По позициям» и
 * «По урокам». Третий лист красит строку цветом клетки, каким она выглядит
 * в самом планировании (lessonDisplayColor) — увидеть «что уже полностью
 * пройдено» можно не читая проценты, а по цвету, как на экране.
 */
export async function buildPlanningWorkbook(
  ExcelJSMod: typeof ExcelJS,
  boards: PlanningBoard[]
): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJSMod.Workbook()
  wb.creator = "CRM"
  wb.created = new Date()

  const sorted = boards.slice().sort((a, b) => (a.title || "").localeCompare(b.title || "", "ru"))

  const byClass = wb.addWorksheet("По классам")
  byClass.addRow(["Класс", "Предмет", "Четверть", "Дедлайн", "Уроков всего", "Уроков готово", "% уроков", "Пунктов всего", "Пунктов готово", "% пунктов"])
  styleHeaderRow(byClass.getRow(1))
  autoWidth(byClass, [14, 16, 12, 12, 12, 13, 10, 13, 14, 10])

  const byItem = wb.addWorksheet("По позициям")
  byItem.addRow(["Класс", "Предмет", "Четверть", "Позиция", "Готово", "Всего", "%"])
  styleHeaderRow(byItem.getRow(1))
  autoWidth(byItem, [14, 16, 12, 22, 9, 9, 8])

  const byLesson = wb.addWorksheet("По урокам")
  byLesson.addRow(["Класс", "Предмет", "Четверть", "№ урока", "Название урока", "Пунктов всего", "Пунктов готово", "%", "Статус"])
  styleHeaderRow(byLesson.getRow(1))
  autoWidth(byLesson, [14, 16, 12, 9, 26, 13, 14, 8, 14])

  sorted.forEach((board) => {
    const p = computeBoardProgress(board)
    const lessonsPct = p.lessonsTotal > 0 ? Math.round((p.lessonsDone / p.lessonsTotal) * 100) : 0
    const itemsPct = p.itemsTotal > 0 ? Math.round((p.itemsDone / p.itemsTotal) * 100) : 0

    byClass.addRow([
      board.title || "Без названия", board.subject || "", board.quarter || "",
      board.deadline ? fmtDeadline(board.deadline) : "",
      p.lessonsTotal, p.lessonsDone, lessonsPct, p.itemsTotal, p.itemsDone, itemsPct,
    ])

    p.byItem.forEach(({ name, done, total }) => {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0
      byItem.addRow([board.title || "Без названия", board.subject || "", board.quarter || "", name, done, total, pct])
    })

    const lessons = (board.lessons || []).slice().sort((a, b) => a.num - b.num)
    lessons.forEach((lesson) => {
      const items = lesson.items || []
      const total = items.length
      const done = items.filter((i) => i.done).length
      const pct = total > 0 ? Math.round((done / total) * 100) : 0
      const color = lessonDisplayColor(lesson)
      const statusLabel = color === "green-3" ? "Готово" : color === "gray" ? "Не начат" : "В работе"

      const row = byLesson.addRow([
        board.title || "Без названия", board.subject || "", board.quarter || "",
        lesson.num, lesson.title || `Урок ${lesson.num}`, total, done, pct, statusLabel,
      ])
      const argb = FILL_HEX[color]
      const textColor = DARK_TEXT.includes(color) ? "FF1A1A1A" : "FFFFFFFF"
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }
        cell.font = { color: { argb: textColor } }
      })
    })
  })

  ;[byClass, byItem, byLesson].forEach((ws) => { ws.views = [{ state: "frozen", ySplit: 1 }] })

  return wb.xlsx.writeBuffer()
}

export function planningExportFilename(scopeLabel: string, todayIso: string): string {
  return `planning-${scopeLabel}-${todayIso}.xlsx`
}
