import { useMemo, useState } from "react"
import { Area, AreaChart, Line, XAxis } from "recharts"
import { useAppStore } from "@/store/useAppStore"
import { fmtMoney, fmtHours } from "@/lib/money"
import {
  DASHBOARD_METRIC_TYPES,
  getMetricSeriesForPeriod,
  getPeriodBucketRanges,
  formatBucketLabel,
  formatMetricValue,
  type MetricPeriod,
} from "@/lib/dashboardMetrics"

// One color for every chart on the dashboard — same light gray as the
// revenue line and progress rings, not a different hue or shade per metric.
const GLASS_METRIC_COLOR = "var(--foreground)"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function MetricColumn({
  metricType,
  goal,
  color,
  period,
}: {
  metricType: string
  goal: number
  color: string
  period: MetricPeriod
}) {
  const orders = useAppStore((s) => s.orders)
  const advances = useAppStore((s) => s.advances)
  const activityLog = useAppStore((s) => s.activityLog)

  const info = DASHBOARD_METRIC_TYPES[metricType] || DASHBOARD_METRIC_TYPES.hours
  const series = getMetricSeriesForPeriod(info.activityField, period, info.cumulative, orders, advances, activityLog)
  const ranges = getPeriodBucketRanges(period)
  const secSeries = info.secondary ? getMetricSeriesForPeriod(info.secondary.activityField, period, info.secondary.cumulative, orders, advances, activityLog) : null

  const curVal = series[series.length - 1]
  const avgVal = series.reduce((s, v) => s + v, 0) / series.length
  const goalMultiplier = { day: 1, week: 7, month: 30, year: 365 }[period]
  const goalVal = goal * (info.cumulative ? 1 : goalMultiplier)
  const secCurVal = secSeries ? secSeries[secSeries.length - 1] : null

  const fmt = (v: number) => formatMetricValue(info, v, fmtMoney, fmtHours)

  const data = series.map((v, i) => ({
    bucket: formatBucketLabel(ranges[i], period),
    value: v,
    secondary: secSeries ? secSeries[i] : undefined,
  }))

  const gradId = "dmGrad-" + metricType
  const chartConfig = {
    value: { label: info.label, color },
    ...(info.secondary ? { secondary: { label: info.secondary.label, color: "var(--muted-foreground)" } } : {}),
  } satisfies ChartConfig

  return (
    <div className="rounded-xl bg-muted/50 p-3.5">
      <ChartContainer config={chartConfig} className="aspect-auto h-[56px] w-full sm:h-[80px]">
        <AreaChart data={data} margin={{ top: 4, left: 0, right: 0, bottom: 5 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="bucket" hide />
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeDasharray: "2 3" }}
            content={<ChartTooltipContent indicator="dot" formatter={(value) => fmt(Number(value))} />}
          />
          {secSeries && (
            <Line dataKey="secondary" type="monotone" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
          )}
          <Area
            dataKey="value"
            type="monotone"
            stroke={color}
            strokeWidth={2.5}
            fill={`url(#${gradId})`}
            activeDot={{ r: 4.5, stroke: "var(--card)", strokeWidth: 1.5 }}
            animationDuration={600}
          />
        </AreaChart>
      </ChartContainer>
      <div className="mt-1.5 text-[13px] text-muted-foreground">{info.label}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
        <span className="font-heading text-[28px] font-bold tabular-nums sm:text-[34px]" style={{ color }}>{fmt(curVal)}</span>
        {info.secondary && secCurVal !== null && (
          <span className="text-[13px] font-semibold text-muted-foreground">· {Math.round(secCurVal)} {info.secondary.label}</span>
        )}
      </div>
      <div className="mt-3.5 flex justify-between text-[12px] text-muted-foreground">
        <span>Цель</span>
        <span className="text-right font-semibold text-foreground/80">{fmt(goalVal)}</span>
      </div>
      <div className="mt-1 flex justify-between text-[12px] text-muted-foreground">
        <span>Среднее</span>
        <span className="text-right font-semibold text-foreground/80">{fmt(avgVal)}</span>
      </div>
    </div>
  )
}

export function ActivityMetricsGrid() {
  const appSettings = useAppStore((s) => s.appSettings)
  const [period, setPeriod] = useState<MetricPeriod>("day")
  const metrics = useMemo(() => appSettings.dashboardMetrics.filter((m) => !m.hidden), [appSettings.dashboardMetrics])

  const subtitleByPeriod: Record<MetricPeriod, string> = {
    day: "Сегодня, по показателям из Справочников",
    week: "На этой неделе, по показателям из Справочников",
    month: "В этом месяце, по показателям из Справочников",
    year: "В этом году, по показателям из Справочников",
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-bold">Активность</h3>
          <div className="text-[12.5px] text-muted-foreground">{subtitleByPeriod[period]}</div>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as MetricPeriod)}>
          <SelectTrigger size="sm" className="h-8 text-[12.5px] font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="day">День</SelectItem>
            <SelectItem value="week">Неделя</SelectItem>
            <SelectItem value="month">Месяц</SelectItem>
            <SelectItem value="year">Год</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3 sm:gap-3.5 sm:[grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        {metrics.map((m) => (
          <MetricColumn
            key={m.id}
            metricType={m.type}
            goal={m.goal}
            color={GLASS_METRIC_COLOR}
            period={period}
          />
        ))}
      </div>
    </div>
  )
}
