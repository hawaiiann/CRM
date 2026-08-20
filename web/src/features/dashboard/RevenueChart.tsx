import { useMemo } from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { useAppStore } from "@/store/useAppStore"
import { fmtMoney } from "@/lib/money"
import { orderRecognizedRevenue } from "@/lib/dashboardMetrics"
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

  const data = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (5 - i), 1))
    return months.map((m) => {
      const mYear = m.getFullYear()
      const mMonth = m.getMonth()
      const revenue = orders
        .filter((o) => {
          if (o.status === "cancelled") return false
          const dStr = o.deadline || o.start
          if (!dStr) return false
          const parts = dStr.split("-").map(Number)
          if (parts.length < 2) return false
          return parts[0] === mYear && parts[1] - 1 === mMonth
        })
        .reduce((s, o) => s + orderRecognizedRevenue(o).revenue, 0)
      return { month: MONTH_NAMES[m.getMonth()], revenue }
    })
  }, [orders])

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
