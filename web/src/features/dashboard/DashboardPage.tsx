import { useMemo, lazy, Suspense } from "react"
import { Play, CheckCircle2, Wallet, Clock3, TrendingUp, TrendingDown } from "lucide-react"
import { PageHeader } from "@/components/layout/AppShell"
import { useAppStore } from "@/store/useAppStore"
import { fmtMoney, ordersDebt } from "@/lib/money"
import { revenueEvents, revenueForMonth } from "@/lib/dashboardMetrics"
import { cn } from "@/lib/utils"
import { TasksMiniWidget } from "./TasksMiniWidget"
import { WeekPlanningWidget } from "./WeekPlanningWidget"
import { ActiveDaysCalendar } from "./ActiveDaysCalendar"

// Все три виджета тянут recharts — самую тяжёлую библиотеку в проекте.
// Дашборд стартовый, отложить его целиком нельзя, но цифры в плитках и
// список задач не должны ждать графики: они приезжают следом, на своих
// местах (высота заглушек совпадает с высотой графиков, чтобы страницу
// не дёргало).
const ClassProgressDonuts = lazy(() => import("./ClassProgressDonuts").then((m) => ({ default: m.ClassProgressDonuts })))
const RevenueChart = lazy(() => import("./RevenueChart").then((m) => ({ default: m.RevenueChart })))
const ActivityMetricsGrid = lazy(() => import("./ActivityMetricsGrid").then((m) => ({ default: m.ActivityMetricsGrid })))

function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 100)
}

export function DashboardPage() {
  const orders = useAppStore((s) => s.orders)
  const advances = useAppStore((s) => s.advances)

  const stats = useMemo(() => {
    const active = orders.filter((o) => ["progress", "review"].includes(o.status))
    const now = new Date()
    const prevMonthRef = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    // Выручка — по датам платежей и авансов (единое определение, см.
    // revenueEventsForOrder); раньше плитка считала по месяцу срока сдачи и
    // не сходилась с графиком и метриками ниже.
    const events = revenueEvents(orders, advances)
    const currentMonthRev = revenueForMonth(events, now.getFullYear(), now.getMonth())
    const prevMonthRev = revenueForMonth(events, prevMonthRef.getFullYear(), prevMonthRef.getMonth())

    let doneThisMonth = 0
    let doneLastMonth = 0
    orders.forEach((o) => {
      if (o.status !== "done" || !o.deadline) return
      const parts = o.deadline.split("-").map(Number)
      if (parts[0] === now.getFullYear() && parts[1] - 1 === now.getMonth()) doneThisMonth++
      if (parts[0] === prevMonthRef.getFullYear() && parts[1] - 1 === prevMonthRef.getMonth()) doneLastMonth++
    })

    return {
      activeCount: active.length,
      doneThisMonth,
      currentMonthRev,
      activeRev: ordersDebt(orders),
      revPct: pctChange(currentMonthRev, prevMonthRev),
      donePct: pctChange(doneThisMonth, doneLastMonth),
    }
  }, [orders, advances])

  return (
    <div>
      <PageHeader title="Дашборд" subtitle="Общая картина по вашей загрузке, статистике и доходу" />

      <div className="mb-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <TasksMiniWidget />

        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Активных заказов" value={String(stats.activeCount)} icon={Play} featured />
            {/* Подписи сходятся с числами: раньше «Выполнено заказов» показывало
                итог за всё время с процентом «за месяц». */}
            <StatCard label="Выполнено за месяц" value={String(stats.doneThisMonth)} icon={CheckCircle2} pct={stats.donePct} tone="success" />
            <StatCard label="Выручка за месяц" value={fmtMoney(stats.currentMonthRev)} icon={Wallet} pct={stats.revPct} tone="warning" />
            <StatCard label="Ожидает оплаты" value={fmtMoney(stats.activeRev)} icon={Clock3} tone="destructive" />
          </div>

          <div className="glass-surface flex flex-1 flex-col rounded-xl p-4.5">
            <h3 className="text-[16px] font-bold">Прогресс по классам</h3>
            <div className="mb-1 text-[12.5px] text-muted-foreground">Завершение выработки материалов</div>
            <div className="flex flex-1 items-center">
              <Suspense fallback={<div className="h-[72px] w-[72px]" />}><ClassProgressDonuts /></Suspense>
            </div>
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

        <div className="glass-surface glass-surface-accent rounded-xl p-4.5 ring-1 ring-cta/25">
          <h3 className="text-[16px] font-bold">Доход по месяцам</h3>
          <div className="mb-3 text-[12.5px] text-muted-foreground">За последние 6 месяцев по датам платежей и авансов</div>
          <Suspense fallback={<div className="h-[190px] w-full" />}><RevenueChart /></Suspense>
        </div>
      </div>

      <div className="glass-surface glass-surface-accent-warm rounded-xl p-4.5 ring-1 ring-accent-warm/25">
        <Suspense fallback={<div className="h-[180px] w-full" />}><ActivityMetricsGrid /></Suspense>
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
    success: "bg-success text-success-foreground",
    warning: "bg-warning text-warning-foreground",
    destructive: "bg-destructive/12 text-destructive",
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
