import { Circle, Clock, Eye, CheckCircle2, XCircle, ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
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

export const STATUS_ORDER: OrderStatus[] = ["queue", "progress", "review", "done", "cancelled"]
export { STATUS_LABEL }

/**
 * Бейдж статуса. Если передан onChange — кликабельный, с выпадающим списком.
 *
 * В ванильной версии статус менялся прямо в строке списка: бейдж был
 * выпадающим списком (quickChangeStatus). При переносе на React он стал
 * просто подписью, и завершить заказ можно было только открыв форму и найдя
 * там поле «Статус» — неочевидно настолько, что способ вообще не находился.
 */
// Цвет точки в компактном виде — тот же смысл, что у заливки пилюли.
const STATUS_DOT: Record<OrderStatus, string> = {
  queue: "bg-muted-foreground/50",
  progress: "bg-warning-foreground",
  review: "bg-foreground/60",
  done: "bg-success-foreground",
  cancelled: "bg-destructive",
}

export function StatusBadge({
  status,
  onChange,
  variant = "pill",
}: {
  status: OrderStatus
  onChange?: (next: OrderStatus) => void
  /**
   * dot — точка и подпись без заливки. Для списков, где у всех строк один и
   * тот же статус («В работе сейчас»): колонка одинаковых жёлтых пилюль
   * ничего не сообщала и перебивала названия.
   */
  variant?: "pill" | "dot"
}) {
  const Icon = STATUS_ICON[status]
  const base = variant === "dot"
    ? "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-2xs font-bold whitespace-nowrap text-muted-foreground"
    : cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-2xs font-bold whitespace-nowrap", STATUS_STYLE[status])
  const mark = variant === "dot"
    ? <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[status])} />
    : <Icon className="size-3" strokeWidth={2.25} />

  if (!onChange) {
    return (
      <span className={base}>
        {mark}
        {STATUS_LABEL[status]}
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Сменить статус"
          onClick={(e) => e.stopPropagation()}
          className={cn(base, "cursor-pointer transition-colors", variant === "dot" ? "hover:bg-muted hover:text-foreground" : "transition-opacity hover:opacity-80")}
        >
          {mark}
          {STATUS_LABEL[status]}
          <ChevronDown className="size-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {STATUS_ORDER.map((s) => {
          const ItemIcon = STATUS_ICON[s]
          return (
            <DropdownMenuItem key={s} onClick={() => onChange(s)} className={cn(s === status && "font-bold")}>
              <ItemIcon className="size-3.5" strokeWidth={2.25} />
              {STATUS_LABEL[s]}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
