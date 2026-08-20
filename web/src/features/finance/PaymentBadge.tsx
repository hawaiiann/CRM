import { fmtMoney } from "@/lib/money"
import { orderPaymentState } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Order } from "@/types/models"

export function PaymentBadge({ order, onClick }: { order: Order; onClick: () => void }) {
  const p = orderPaymentState(order)
  if (p.isFullyPaid) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Оплачен полностью. Клик — снять оплату"
        className="inline-flex h-6 items-center rounded-full bg-success px-2.5 text-[11px] font-bold text-success-foreground"
      >
        Оплачено
      </button>
    )
  }
  if (p.covered > 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={`Получено ${fmtMoney(p.covered)} из ${fmtMoney(p.full)}. Клик — отметить полную оплату`}
        className={cn("inline-flex h-6 items-center rounded-full bg-warning px-2.5 text-[11px] font-bold text-warning-foreground")}
      >
        К доплате {fmtMoney(p.remaining)}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title="Оплаты не было. Клик — отметить полную оплату"
      className="inline-flex h-6 items-center rounded-full bg-destructive/10 px-2.5 text-[11px] font-bold text-destructive"
    >
      Не оплачено
    </button>
  )
}
