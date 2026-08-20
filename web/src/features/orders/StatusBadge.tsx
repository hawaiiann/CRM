import { Circle, Clock, Eye, CheckCircle2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { OrderStatus } from "@/types/models"

const STATUS_LABEL: Record<OrderStatus, string> = {
  queue: "В очереди",
  progress: "В работе",
  review: "На согласовании",
  done: "Завершён",
  cancelled: "Отменён",
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  queue: "bg-neutral-tone text-neutral-tone-foreground",
  progress: "bg-warning text-warning-foreground",
  review: "bg-overlay/20 text-foreground/90",
  done: "bg-success text-success-foreground",
  cancelled: "bg-destructive/10 text-destructive",
}

const STATUS_ICON: Record<OrderStatus, typeof Circle> = {
  queue: Circle,
  progress: Clock,
  review: Eye,
  done: CheckCircle2,
  cancelled: XCircle,
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const Icon = STATUS_ICON[status]
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold whitespace-nowrap",
        STATUS_STYLE[status]
      )}
    >
      <Icon className="size-3" strokeWidth={2.25} />
      {STATUS_LABEL[status]}
    </span>
  )
}
