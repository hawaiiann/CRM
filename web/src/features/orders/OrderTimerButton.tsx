import { Play, Pause } from "lucide-react"
import { useTimerStore } from "@/store/useTimerStore"
import type { Order } from "@/types/models"

export function orderDisplayTitle(o: Order): string {
  return o.title || [o.subject, o.grade, o.quarter, o.lesson && `Урок ${o.lesson}`].filter(Boolean).join(", ") || "Без названия"
}

/**
 * Кнопка таймера по заказу — одна на список заказов и карточку урока, чтобы
 * запускать время можно было оттуда, где реально работают.
 */
export function OrderTimerButton({ order, size = "sm" }: { order: Order; size?: "sm" | "md" }) {
  const activeId = useTimerStore((s) => s.id)
  const running = useTimerStore((s) => s.running)
  const startFor = useTimerStore((s) => s.startFor)
  const isActive = activeId === order.id && running

  return (
    <button
      type="button"
      title={isActive ? "Пауза" : "Старт таймера по этому заказу"}
      onClick={(e) => { e.stopPropagation(); startFor(order.id, orderDisplayTitle(order)) }}
      className={
        size === "md"
          ? "flex shrink-0 items-center gap-1.5 rounded-lg bg-emphasis/85 px-3 py-1.5 text-[12px] font-extrabold text-emphasis-foreground hover:bg-emphasis"
          : "flex shrink-0 items-center gap-1 rounded-full bg-emphasis/85 px-2 py-1 text-[10.5px] font-extrabold text-emphasis-foreground"
      }
    >
      {isActive ? <Pause className={size === "md" ? "size-3" : "size-2.5"} fill="currentColor" /> : <Play className={size === "md" ? "size-3" : "size-2.5"} fill="currentColor" />}
      {isActive ? "Пауза" : size === "md" ? "Таймер" : "Старт"}
    </button>
  )
}
