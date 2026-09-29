import { Play, Pause } from "lucide-react"
import { useTimerStore } from "@/store/useTimerStore"
import { cn } from "@/lib/utils"
import type { Order } from "@/types/models"

export function orderDisplayTitle(o: Order): string {
  return o.title || [o.subject, o.grade, o.quarter, o.lesson && `Урок ${o.lesson}`].filter(Boolean).join(", ") || "Без названия"
}

/**
 * Кнопка таймера по заказу — одна на список заказов и карточку урока, чтобы
 * запускать время можно было оттуда, где реально работают.
 *
 * В списках — круглая иконка без подписи: чёрная пилюля «Старт» в каждой
 * строке складывалась в столбик тёмных пятен слева и перебивала названия.
 * Идущий таймер — синий, его видно сразу.
 */
export function OrderTimerButton({ order, size = "sm" }: { order: Order; size?: "sm" | "md" }) {
  const activeId = useTimerStore((s) => s.id)
  const running = useTimerStore((s) => s.running)
  const startFor = useTimerStore((s) => s.startFor)
  const isActive = activeId === order.id && running
  const Icon = isActive ? Pause : Play

  if (size === "md") {
    return (
      <button
        type="button"
        title={isActive ? "Пауза" : "Старт таймера по этому заказу"}
        onClick={(e) => { e.stopPropagation(); startFor(order.id, orderDisplayTitle(order)) }}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold transition-colors",
          isActive ? "bg-cta text-cta-foreground hover:bg-cta/90" : "bg-emphasis/85 text-emphasis-foreground hover:bg-emphasis"
        )}
      >
        <Icon className="size-3" fill="currentColor" />
        {isActive ? "Пауза" : "Таймер"}
      </button>
    )
  }

  return (
    <button
      type="button"
      title={isActive ? "Пауза" : "Старт таймера по этому заказу"}
      aria-label={isActive ? "Пауза" : "Старт таймера"}
      onClick={(e) => { e.stopPropagation(); startFor(order.id, orderDisplayTitle(order)) }}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
        isActive
          ? "border-transparent bg-cta text-cta-foreground shadow-[0_0_0_3px_color-mix(in_oklab,var(--cta)_22%,transparent)]"
          : "border-border bg-transparent text-foreground/70 hover:border-foreground/30 hover:bg-foreground hover:text-background"
      )}
    >
      <Icon className={cn("size-3", !isActive && "translate-x-px")} fill="currentColor" />
    </button>
  )
}
