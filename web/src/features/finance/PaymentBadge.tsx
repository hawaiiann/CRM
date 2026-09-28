import { fmtMoney, orderPaymentState } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Order } from "@/types/models"

export function PaymentBadge({ order, onClick }: { order: Order; onClick: () => void }) {
  const p = orderPaymentState(order)
  // Заказ на 0 ₽ (все позиции «без оплаты» или почасовая без часов) — ни
  // долга, ни оплаты. Раньше он светился «Не оплачено», а клик ставил isPaid
  // без платежа. Нейтральная плашка, по клику ничего не происходит.
  if (p.full <= 0) {
    return (
      <span
        title={p.overpaid > 0
          ? `Стоимость заказа 0 ₽, но на нём записано ${fmtMoney(p.overpaid)} — проверьте в форме заказа`
          : "Стоимость заказа 0 ₽ — оплачивать нечего"}
        className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-2xs font-bold text-muted-foreground"
      >
        0 ₽
      </span>
    )
  }
  if (p.isFullyPaid) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Оплачен полностью. Клик — снять оплату"
        className="inline-flex h-6 items-center rounded-full bg-success px-2.5 text-2xs font-bold text-success-foreground"
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
        className={cn("inline-flex h-6 items-center rounded-full bg-warning px-2.5 text-2xs font-bold text-warning-foreground")}
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
      className="inline-flex h-6 items-center rounded-full bg-danger-soft px-2.5 text-2xs font-bold text-danger-soft-foreground"
    >
      Не оплачено
    </button>
  )
}
