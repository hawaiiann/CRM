import { useMemo } from "react"
import { Play, CheckCircle2, Wallet, Clock3, TrendingUp, TrendingDown } from "lucide-react"
import { PageHeader } from "@/components/layout/AppShell"
import { useAppStore } from "@/store/useAppStore"
import { fmtMoney, orderPaymentState } from "@/lib/money"
import { orderRecognizedRevenue } from "@/lib/dashboardMetrics"
import { cn } from "@/lib/utils"
import { TasksMiniWidget } from "./TasksMiniWidget"
import { ClassProgressDonuts } from "./ClassProgressDonuts"
import { WeekPlanningWidget } from "./WeekPlanningWidget"
import { RevenueChart } from "./RevenueChart"
import { ActiveDaysCalendar } from "./ActiveDaysCalendar"
import { ActivityMetricsGrid } from "./ActivityMetricsGrid"

function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 100)
}

export function DashboardPage() {
  const orders = useAppStore((s) => s.orders)

  const stats = useMemo(() => {
    const active = orders.filter((o) => ["progress", "review"].includes(o.status))
    const done = orders.filter((o) => o.status === "done")
    const now = new Date()
    const prevMonthRef = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    let currentMonthRev = 0
    let prevMonthRev = 0
    let doneThisMonth = 0
    let doneLastMonth = 0

    orders.forEach((o) => {
      if (o.status === "cancelled" || !o.deadline) return
      const parts = o.deadline.split("-").map(Number)
      const isThisMonth = parts[0] === now.getFullYear() && parts[1] - 1 === now.getMonth()
      const isLastMonth = parts[0] === prevMonthRef.getFullYear() && parts[1] - 1 === prevMonthRef.getMonth()
      if (isThisMonth) currentMonthRev += orderRecognizedRevenue(o).revenue
      if (isLastMonth) prevMonthRev += orderRecognizedRevenue(o).revenue
      if (o.status === "done") {
        if (isThisMonth) doneThisMonth++
        if (isLastMonth) doneLastMonth++
      }
    })

    const activeRev = orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + orderPaymentState(o).remaining, 0)

    return {
      activeCount: active.length,
      doneCount: done.length,
      currentMonthRev,
      activeRev,
      revPct: pctChange(currentMonthRev, prevMonthRev),
      donePct: pctChange(doneThisMonth, doneLastMonth),
    }
  }, [orders])

  return (
    <div>
      <PageHeader title="Дашборд" subtitle="Общая картина по вашей загрузке, статистике и доходу" />

      <div className="mb-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <TasksMiniWidget />

        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Активных заказов" value={String(stats.activeCount)} icon={Play} featured />
            <StatCard label="Выполнено заказов" value={String(stats.doneCount)} icon={CheckCircle2} pct={stats.donePct} tone="success" />
            <StatCard label="Выручка (с налогом)" value={fmtMoney(stats.currentMonthRev)} icon={Wallet} pct={stats.revPct} tone="warning" />
            <StatCard label="Ожидает оплаты" value={fmtMoney(stats.activeRev)} icon={Clock3} tone="destructive" />
          </div>

          <div className="glass-surface flex-1 rounded-xl p-4.5">
            <h3 className="text-[16px] font-bold">Прогресс по классам</h3>
            <div className="mb-1 text-[12.5px] text-muted-foreground">Завершение выработки материалов</div>
            <ClassProgressDonuts />
          </div>
        </div>

        <div className="glass-surface rounded-xl p-4.5">
          <ActiveDaysCalendar />
        </div>
      </div>

      <div className="mb-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="glass-surface rounded-xl p-4.5">
          <h3 className="text-[16px] font-bold">Планирование недели</h3>
          <div className="mb-3 text-[12.5px] text-muted-foreground">Как распределены заказы по дням ближайшей недели</div>
          <WeekPlanningWidget />
        </div>

        <div className="glass-surface rounded-xl p-4.5">
          <h3 className="text-[16px] font-bold">Доход по месяцам</h3>
          <div className="mb-3 text-[12.5px] text-muted-foreground">За последние 6 месяцев по завершённым проектам</div>
          <RevenueChart />
        </div>
      </div>

      <div className="glass-surface rounded-xl p-4.5">
        <ActivityMetricsGrid />
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  pct,
  featured,
  tone,
}: {
  label: string
  value: string
  icon: typeof Play
  pct?: number | null
  featured?: boolean
  tone?: "success" | "warning" | "destructive"
}) {
  const toneClasses = {
    success: "bg-overlay/10 text-foreground/80",
    warning: "bg-overlay/10 text-foreground/80",
    destructive: "bg-overlay/10 text-foreground/80",
  }
  return (
    <div
      className={cn(
        "glass-surface rounded-xl p-4.5",
        featured && "glass-surface-accent ring-1 ring-cta/25"
      )}
    >
      <div className="flex items-start justify-between">
        <span className={cn("text-[12.5px] font-semibold", featured ? "text-foreground" : "text-muted-foreground")}>{label}</span>
        <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", featured ? "bg-cta/15 text-cta" : tone ? toneClasses[tone] : "bg-muted text-muted-foreground")}>
          <Icon className="size-3.5" strokeWidth={2} />
        </div>
      </div>
      <div className="font-heading mt-3 text-[31px] font-bold tabular-nums">{value}</div>
      {pct !== undefined && pct !== null && (
        <div className="mt-2.5 flex items-center gap-1 text-[12px] font-bold text-foreground/70">
          {pct >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          {Math.abs(pct)}% за месяц
        </div>
      )}
    </div>
  )
}
