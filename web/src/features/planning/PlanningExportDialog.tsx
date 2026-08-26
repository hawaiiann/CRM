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
import { downloadCsvSections } from "@/lib/csv"
import { computeBoardProgress, distinctQuarters } from "@/lib/planningStats"
import { fmtDeadline } from "@/lib/dates"
import { dateKey, pluralizeRu } from "@/lib/money"
import type { PlanningBoard } from "@/types/models"

const ALL_QUARTERS = "__all__"

/**
 * Экспорт планирования в CSV (Excel открывает его как обычную таблицу).
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

  const quarters = distinctQuarters(boards)
  const matched = quarter === ALL_QUARTERS ? boards : boards.filter((b) => (b.quarter || "").trim() === quarter)
  // Порядок такой же, как на странице по умолчанию: по названию класса.
  const sorted = matched.slice().sort((a, b) => (a.title || "").localeCompare(b.title || "", "ru"))

  function handleExport() {
    const byClassRows: (string | number)[][] = []
    const byItemRows: (string | number)[][] = []

    sorted.forEach((board) => {
      const p = computeBoardProgress(board)
      const lessonsPct = p.lessonsTotal > 0 ? Math.round((p.lessonsDone / p.lessonsTotal) * 100) : 0
      const itemsPct = p.itemsTotal > 0 ? Math.round((p.itemsDone / p.itemsTotal) * 100) : 0
      byClassRows.push([
        board.title || "Без названия",
        board.subject || "",
        board.quarter || "",
        board.deadline ? fmtDeadline(board.deadline) : "",
        p.lessonsTotal, p.lessonsDone, lessonsPct,
        p.itemsTotal, p.itemsDone, itemsPct,
      ])

      p.byItem.forEach(({ name, done, total }) => {
        const pct = total > 0 ? Math.round((done / total) * 100) : 0
        byItemRows.push([board.title || "Без названия", board.subject || "", board.quarter || "", name, done, total, pct])
      })
    })

    const scopeLabel = quarter === ALL_QUARTERS ? "все-четверти" : quarter.replace(/\s+/g, "-")
    downloadCsvSections(`planning-${scopeLabel}-${dateKey(new Date())}.csv`, [
      {
        title: "Прогресс по классам",
        header: ["Класс", "Предмет", "Четверть", "Дедлайн", "Уроков всего", "Уроков готово", "% уроков", "Пунктов всего", "Пунктов готово", "% пунктов"],
        rows: byClassRows,
      },
      {
        title: "Прогресс по позициям",
        header: ["Класс", "Предмет", "Четверть", "Позиция", "Готово", "Всего", "%"],
        rows: byItemRows,
      },
    ])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Экспорт планирования</DialogTitle>
          <DialogDescription>
            CSV-файл с двумя таблицами: прогресс по классам и прогресс по позициям чек-листа. Открывается в Excel.
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
            {sorted.length > 0
              ? `Попадёт в файл: ${sorted.length} ${pluralizeRu(sorted.length, "класс", "класса", "классов")}.`
              : "На этот период классов не найдено."}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            type="button"
            disabled={sorted.length === 0}
            onClick={handleExport}
            className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta"
          >
            Скачать CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
