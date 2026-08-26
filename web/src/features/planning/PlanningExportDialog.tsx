import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { distinctQuarters } from "@/lib/planningStats"
import { dateKey, pluralizeRu } from "@/lib/money"
import { alertDialog } from "@/store/useDialogStore"
import type { PlanningBoard } from "@/types/models"

const ALL_QUARTERS = "__all__"

/**
 * Экспорт планирования в настоящий .xlsx (не CSV — нужна заливка строк
 * цветом урока, а у CSV нет форматирования вообще).
 *
 * Период — это четверть, а не диапазон дат: у урока нет своей даты, только
 * номер и четверть доски, поэтому «период» здесь означает «какие четверти
 * включить», а не календарный интервал.
 *
 * Архивные доски в фильтр по четверти попадают наравне с активными —
 * законченная четверть почти всегда лежит в архиве, и выгрузка «прогресса за
 * четверть» без архивных досок была бы пустой для всего, кроме текущей.
 */
export function PlanningExportDialog({
  open,
  boards,
  onOpenChange,
}: {
  open: boolean
  boards: PlanningBoard[]
  onOpenChange: (open: boolean) => void
}) {
  const [quarter, setQuarter] = useState(ALL_QUARTERS)
  const [exporting, setExporting] = useState(false)

  const quarters = distinctQuarters(boards)
  const matched = quarter === ALL_QUARTERS ? boards : boards.filter((b) => (b.quarter || "").trim() === quarter)

  async function handleExport() {
    setExporting(true)
    try {
      // exceljs — не самая лёгкая библиотека, поэтому подключается только
      // здесь, по клику, а не статическим импортом наверху файла (см.
      // комментарий в lib/planningExcel.ts).
      const [ExcelJS, { buildPlanningWorkbook, planningExportFilename }] = await Promise.all([
        import("exceljs"),
        import("@/lib/planningExcel"),
      ])
      const buffer = await buildPlanningWorkbook(ExcelJS.default ?? ExcelJS, matched)
      const scopeLabel = quarter === ALL_QUARTERS ? "все-четверти" : quarter.replace(/\s+/g, "-")
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = planningExportFilename(scopeLabel, dateKey(new Date()))
      a.click()
      URL.revokeObjectURL(url)
      onOpenChange(false)
    } catch (err) {
      console.error("Не удалось собрать экспорт планирования:", err)
      await alertDialog({
        title: "Не удалось собрать файл",
        body: "Попробуйте ещё раз. Если не поможет — проверьте соединение с интернетом: библиотека для сборки .xlsx подгружается отдельно.",
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Экспорт планирования</DialogTitle>
          <DialogDescription>
            Файл .xlsx с тремя листами: по классам, по позициям чек-листа и по каждому уроку — со строкой, закрашенной тем же цветом, что и клетка урока в планировании.
          </DialogDescription>
        </DialogHeader>

        <div>
          <div className="mb-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Период</div>
          <Select value={quarter} onValueChange={setQuarter}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_QUARTERS}>Все четверти</SelectItem>
              {quarters.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="mt-2 text-[11.5px] text-muted-foreground">
            {matched.length > 0
              ? `Попадёт в файл: ${matched.length} ${pluralizeRu(matched.length, "класс", "класса", "классов")}.`
              : "На этот период классов не найдено."}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            type="button"
            disabled={matched.length === 0 || exporting}
            onClick={handleExport}
            className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta"
          >
            {exporting ? "Собираю файл…" : "Скачать .xlsx"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
