import { useMemo } from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { useAppStore } from "@/store/useAppStore"
import { fmtMoney } from "@/lib/money"
import { revenueEvents, revenueForMonth } from "@/lib/dashboardMetrics"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const MONTH_NAMES = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

const chartConfig = {
  revenue: {
    label: "Выручка",
    color: "var(--cta)",
  },
} satisfies ChartConfig

export function RevenueChart() {
  const orders = useAppStore((s) => s.orders)
  const advances = useAppStore((s) => s.advances)

  // По датам платежей и авансов — то же определение, что у плитки «Выручка»
  // и метрик «Активность». Раньше месяц брался по сроку сдачи заказа.
  const data = useMemo(() => {
    const now = new Date()
    const events = revenueEvents(orders, advances)
    const months = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (5 - i), 1))
    return months.map((m) => ({ month: MONTH_NAMES[m.getMonth()], revenue: revenueForMonth(events, m.getFullYear(), m.getMonth()) }))
  }, [orders, advances])

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[190px] w-full">
      <AreaChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
        <defs>
          <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip
          cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              indicator="dot"
              formatter={(value) => fmtMoney(Number(value))}
            />
          }
        />
        <Area
          dataKey="revenue"
          type="monotone"
          fill="url(#fillRevenue)"
          stroke="var(--color-revenue)"
          strokeWidth={2.5}
          animationDuration={700}
        />
      </AreaChart>
    </ChartContainer>
  )
}
