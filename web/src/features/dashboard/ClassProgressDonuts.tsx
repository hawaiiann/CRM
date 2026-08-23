import { Pie, PieChart, Cell, Label } from "recharts"
import { useAppStore } from "@/store/useAppStore"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"

const chartConfig = {
  pct: { label: "Прогресс" },
} satisfies ChartConfig

function ClassDonut({ pct, title, color }: { pct: number; title: string; color: string }) {
  const data = [
    { name: "done", value: pct },
    { name: "rest", value: Math.max(0, 100 - pct) },
  ]

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <ChartContainer config={chartConfig} className="aspect-square h-[72px] w-[72px]">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="70%"
            outerRadius="100%"
            startAngle={90}
            endAngle={450}
            stroke="none"
            isAnimationActive
            animationDuration={600}
          >
            <Cell fill={color} />
            <Cell fill="var(--border)" />
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox) || viewBox.cx == null || viewBox.cy == null) return null
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle" className="fill-foreground font-heading text-[13px] font-bold">
                    {pct}%
                  </text>
                )
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="max-w-[76px] truncate text-[11px] font-semibold text-muted-foreground" title={title}>{title}</div>
    </div>
  )
}

export function ClassProgressDonuts() {
  const boards = useAppStore((s) => s.planningBoards).filter((b) => !b.archived)

  if (boards.length === 0) {
    return <div className="py-4 text-[12.5px] text-muted-foreground">Нет активных классов</div>
  }

  // Считаем и складываем в один проход, но без записи во внешние переменные
  // из колбэка map: побочный эффект внутри рендера — то, на чём ломается
  // работа React в конкурентном режиме (рендер могут прервать и повторить,
  // и счётчики удвоятся).
  const items = boards.map((board) => {
    let total = 0
    let done = 0
    ;(board.lessons || []).forEach((l) => (l.items || []).forEach((i) => { total++; if (i.done) done++ }))
    return { id: board.id, title: board.title, subject: board.subject, total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 }
  })
  const totalAll = items.reduce((s, it) => s + it.total, 0)
  const doneAll = items.reduce((s, it) => s + it.done, 0)
  const overallPct = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0

  return (
    <div>
      <div className="flex gap-4 overflow-x-auto pb-1">
        {items.map((it) => (
          <ClassDonut key={it.id} pct={it.pct} title={it.title} color="var(--foreground)" />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3 text-[12px]">
        <span className="text-muted-foreground">Итого по всем классам</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-overlay/10">
          <div className="h-full rounded-full bg-emphasis/80 transition-[width] duration-500" style={{ width: `${overallPct}%` }} />
        </div>
        <span className="font-bold">{overallPct}%</span>
      </div>
    </div>
  )
}
