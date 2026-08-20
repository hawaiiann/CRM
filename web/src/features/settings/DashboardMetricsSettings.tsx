import { Eye, EyeOff, Trash2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { DASHBOARD_METRIC_TYPES } from "@/lib/dashboardMetrics"
import { cn } from "@/lib/utils"
import type { DashboardMetric } from "@/types/models"

function randId() {
  return "dm" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function DashboardMetricsSettings() {
  const metrics = useAppStore((s) => s.appSettings.dashboardMetrics)
  const setAppSettings = useAppStore((s) => s.setAppSettings)

  function update(next: DashboardMetric[]) {
    setAppSettings((s) => ({ ...s, dashboardMetrics: next }))
    saveData()
  }

  const usedTypes = metrics.map((m) => m.type)

  function add() {
    const freeType = Object.keys(DASHBOARD_METRIC_TYPES).find((k) => !usedTypes.includes(k)) || Object.keys(DASHBOARD_METRIC_TYPES)[0]
    update([...metrics, { id: randId(), type: freeType, goal: 0 }])
  }
  function remove(idx: number) {
    if (metrics.length <= 1) return
    const m = metrics[idx]
    const label = DASHBOARD_METRIC_TYPES[m.type]?.label || "этот показатель"
    if (!confirm(`Убрать показатель «${label}» с графика "Активность"?`)) return
    update(metrics.filter((_, i) => i !== idx))
  }

  return (
    <div className="glass-surface rounded-xl p-4.5">
      <h3 className="text-[15px] font-bold">Показатели дашборда</h3>
      <div className="mb-3 text-[12px] text-muted-foreground">Какие метрики показывать на графике «Активность» и цель на день по каждой.</div>

      <div className="flex flex-col gap-2">
        {metrics.map((m, idx) => {
          const info = DASHBOARD_METRIC_TYPES[m.type] || DASHBOARD_METRIC_TYPES.hours
          const isHidden = !!m.hidden
          return (
            <div key={m.id} className={cn("flex flex-wrap items-center gap-2", isHidden && "opacity-50")}>
              <Select value={m.type} onValueChange={(v) => update(metrics.map((x, i) => (i === idx ? { ...x, type: v } : x)))}>
                <SelectTrigger size="sm" className="min-w-[160px] flex-[1.4]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DASHBOARD_METRIC_TYPES).map(([key, i2]) => (
                    <SelectItem key={key} value={key} disabled={usedTypes.includes(key) && m.type !== key}>
                      {i2.label}{i2.secondary ? " + " + i2.secondary.label : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={0}
                value={m.goal}
                title={`Цель: ${info.label}`}
                placeholder={`Цель: ${info.label}`}
                className="h-8 min-w-[110px] flex-1"
                onChange={(e) => update(metrics.map((x, i) => (i === idx ? { ...x, goal: parseFloat(e.target.value) || 0 } : x)))}
              />
              <Button type="button" variant="ghost" size="icon-sm" title={isHidden ? "Показать на дашборде" : "Скрыть с дашборда"} onClick={() => update(metrics.map((x, i) => (i === idx ? { ...x, hidden: !isHidden } : x)))}>
                {isHidden ? <EyeOff className="text-muted-foreground" /> : <Eye className="text-muted-foreground" />}
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={metrics.length <= 1} onClick={() => remove(idx)}>
                <Trash2 className="text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          )
        })}
      </div>

      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={add}>
        <Plus />Добавить показатель
      </Button>
    </div>
  )
}
