import { lazy, Suspense } from "react"

// Графики с бывшего дашборда. Все три тянут recharts — грузятся только при
// открытии вкладки, как и раньше на дашборде.
const ClassProgressDonuts = lazy(() => import("@/features/dashboard/ClassProgressDonuts").then((m) => ({ default: m.ClassProgressDonuts })))
const RevenueChart = lazy(() => import("@/features/dashboard/RevenueChart").then((m) => ({ default: m.RevenueChart })))
const ActivityMetricsGrid = lazy(() => import("@/features/dashboard/ActivityMetricsGrid").then((m) => ({ default: m.ActivityMetricsGrid })))

export function AnalyticsTab() {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="glass-surface rounded-xl p-4.5">
          <h3 className="text-lg font-bold">Доход по месяцам</h3>
          <div className="mb-3 text-sm text-muted-foreground">За последние 6 месяцев по датам платежей и авансов</div>
          <Suspense fallback={<div className="h-[190px] w-full" />}><RevenueChart /></Suspense>
        </div>
        <div className="glass-surface flex flex-col rounded-xl p-4.5">
          <h3 className="text-lg font-bold">Прогресс по классам</h3>
          <div className="mb-1 text-sm text-muted-foreground">Выполнение пунктов чек-листов в планировании</div>
          <div className="flex flex-1 items-center">
            <Suspense fallback={<div className="h-[72px] w-[72px]" />}><ClassProgressDonuts /></Suspense>
          </div>
        </div>
      </div>
      <div className="glass-surface rounded-xl p-4.5">
        <Suspense fallback={<div className="h-[180px] w-full" />}><ActivityMetricsGrid /></Suspense>
      </div>
    </div>
  )
}
