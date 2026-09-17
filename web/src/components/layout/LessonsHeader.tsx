import type { ReactNode } from "react"
import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"

/**
 * Общая шапка раздела «Уроки»: планирование, список заказов и календарь —
 * три вида на одни и те же данные, а не три раздела. Раньше они были
 * отдельными пунктами меню, и между ними ходили через сайдбар.
 */
const VIEWS = [
  { to: "/planning", label: "Планирование" },
  { to: "/orders", label: "Список" },
  { to: "/timeline", label: "Календарь" },
]

export function LessonsHeader({ subtitle, actions }: { subtitle: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Уроки</h1>
        <p className="text-base text-muted-foreground">{subtitle}</p>
        <div className="mt-3 inline-flex gap-0.5 rounded-lg bg-muted p-[3px]">
          {VIEWS.map((v) => (
            <NavLink
              key={v.to}
              to={v.to}
              className={({ isActive }) =>
                cn(
                  "rounded-lg px-3.5 py-1.5 text-sm font-bold transition-colors",
                  isActive ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                )
              }
            >
              {v.label}
            </NavLink>
          ))}
        </div>
      </div>
      {actions}
    </div>
  )
}
