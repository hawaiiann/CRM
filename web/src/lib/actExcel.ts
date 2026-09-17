// exceljs подключается динамическим import() из ActDialog — см. planningExcel.ts.
import type ExcelJS from "exceljs"
import type { Order } from "@/types/models"
import { actRows, actTotals, monthLabel } from "./act"
import { fmtDeadline } from "./dates"

const HEADER_FILL = "FF2C2D31"
const HEADER_FONT = "FFFFFFFF"

/**
 * Один лист: шапка (заказчик, период, дата), таблица сданных уроков с
 * составом и суммой, итоги. Числа — числами, чтобы в Excel их можно было
 * пересчитать; формат «# ##0 ₽» задан ячейкам.
 */
export async function buildActWorkbook(
  ExcelJSMod: typeof ExcelJS,
  args: { client: string; year: number; month0: number; orders: Order[]; performer?: string }
): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJSMod.Workbook()
  wb.creator = "CRM"
  wb.created = new Date()
  const ws = wb.addWorksheet("Акт")
  ws.columns = [{ width: 5 }, { width: 34 }, { width: 14 }, { width: 14 }, { width: 52 }, { width: 14 }]

  const rows = actRows(args.orders)
  const totals = actTotals(args.orders)
  const money = "# ##0 ₽"

  ws.addRow([`Акт выполненных работ — ${monthLabel(args.year, args.month0)}`]).font = { bold: true, size: 14 }
  ws.mergeCells(1, 1, 1, 6)
  ws.addRow([`Заказчик: ${args.client}`])
  if (args.performer) ws.addRow([`Исполнитель: ${args.performer}`])
  ws.addRow([`Сформировано: ${fmtDeadline(new Date().toISOString().slice(0, 10))}`])
  ws.addRow([])

  const header = ws.addRow(["№", "Урок", "Класс", "Сдан", "Состав", "Сумма"])
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT } }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }
    cell.alignment = { vertical: "middle" }
  })
  header.height = 20
  const headerRowNumber = header.number

  rows.forEach((r) => {
    const row = ws.addRow([r.n, r.title, [r.grade, r.subject].filter(Boolean).join(" · "), r.deadline ? fmtDeadline(r.deadline) : "", r.composition, r.total])
    row.getCell(6).numFmt = money
    row.getCell(5).alignment = { wrapText: true, vertical: "top" }
    row.getCell(2).alignment = { wrapText: true, vertical: "top" }
  })

  ws.addRow([])
  const addTotal = (label: string, value: number, bold = false) => {
    const row = ws.addRow(["", "", "", "", label, value])
    row.getCell(6).numFmt = money
    if (bold) { row.getCell(5).font = { bold: true }; row.getCell(6).font = { bold: true } }
    row.getCell(5).alignment = { horizontal: "right" }
  }
  addTotal("Итого за месяц", totals.total, true)
  addTotal("Закрыто авансом", totals.advance)
  addTotal("Оплачено деньгами", totals.paid)
  addTotal("К доплате", totals.remaining, true)

  ws.views = [{ state: "frozen", ySplit: headerRowNumber }]
  return wb.xlsx.writeBuffer()
}
