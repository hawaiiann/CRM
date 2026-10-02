import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"
import { fmtMoney, orderPaymentState } from "@/lib/money"
import { fmtDeadline } from "@/lib/dates"
import { getClientAdvanceStats, ordersOfClientKey } from "@/lib/advances"
import { ordersPriceTotal } from "@/lib/dashboardMetrics"

const STATUS_LABEL: Record<string, string> = {
  queue: "В очереди",
  progress: "В работе",
  review: "На согласовании",
  done: "Завершён",
  cancelled: "Отменён",
}

export function ClientCardSheet({
  clientName,
  onOpenChange,
  onDeposit,
  onReceive,
  onCloseDebt,
  onAct,
}: {
  clientName: string | null
  onOpenChange: (open: boolean) => void
  onDeposit: (client: string) => void
  onReceive: (client: string) => void
  /** «Закрыть долг»: окно оплаты сразу со всеми неоплаченными заказами и списанием аванса. */
  onCloseDebt: (client: string) => void
  onAct: (client: string) => void
}) {
  const orders = useAppStore((s) => s.orders)
  const advances = useAppStore((s) => s.advances)

  // По ключу клиента — тем же отбором, что строка на странице Клиентов.
  const clientOrders = ordersOfClientKey(orders, clientName || "")
  // По округлённой цене каждого заказа — как долг и акт (см. ordersPriceTotal).
  const revenue = ordersPriceTotal(clientOrders)
  const stats = clientName ? getClientAdvanceStats(clientName, advances, orders) : { totalIn: 0, used: 0, available: 0 }
  const sortedOrders = clientOrders.slice().sort((a, b) => (b.deadline || "").localeCompare(a.deadline || ""))
  const debt = Math.round(clientOrders.reduce((s, o) => s + orderPaymentState(o).remaining, 0) * 100) / 100
  const activeCount = clientOrders.filter((o) => o.status !== "done").length

  return (
    <Sheet open={!!clientName} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[440px]">
        {clientName && (
          <>
            <SheetHeader className="pr-10">
              <SheetTitle>{clientName}</SheetTitle>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-4.5 overflow-y-auto px-4">
              <div className="grid grid-cols-2 gap-2.5">
                {/* Долг — первым: ради него карточку клиента чаще всего и открывают. */}
                <div className="rounded-xl bg-muted px-3.5 py-2.5">
                  <div className="text-2xs font-extrabold tracking-wide text-muted-foreground uppercase">Долг</div>
                  <div className={cn("font-heading mt-0.5 text-2xl font-bold", debt > 0 && "text-destructive")}>{fmtMoney(debt)}</div>
                </div>
                <div className="rounded-xl bg-muted px-3.5 py-2.5">
                  <div className="text-2xs font-extrabold tracking-wide text-muted-foreground uppercase">Выручка (с налогом)</div>
                  <div className="font-heading mt-0.5 text-2xl font-bold">{fmtMoney(revenue)}</div>
                </div>
              </div>

              <div className="rounded-2xl bg-muted px-4 py-3.5">
                <div className="text-2xs font-extrabold tracking-wide text-muted-foreground uppercase">Доступный остаток аванса</div>
                <div className="font-heading mt-1 text-2xl font-bold text-foreground">{fmtMoney(stats.available)}</div>
                <div className="mt-2.5 flex justify-between border-t border-dashed border-border pt-2.5 text-xs text-muted-foreground">
                  <span>Внесено <b className="text-foreground">{fmtMoney(stats.totalIn)}</b></span>
                  <span>Списано <b className="text-foreground">{fmtMoney(stats.used)}</b></span>
                </div>
              </div>

              <div>
                <div className="mb-2 text-2xs font-extrabold tracking-wide text-muted-foreground uppercase">
                  Заказы клиента · {activeCount} в работе из {clientOrders.length}
                </div>
                <div className="flex max-h-[320px] flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border">
                  {sortedOrders.length === 0 && <div className="px-3.5 py-2.5 text-sm text-muted-foreground">Заказов не найдено</div>}
                  {sortedOrders.map((o) => {
                    const title = o.title || [o.subject, o.grade, o.quarter, o.lesson && `Урок ${o.lesson}`].filter(Boolean).join(", ") || "Без названия"
                    return (
                      <div key={o.id} className="flex items-center justify-between gap-2.5 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold">{title}</div>
                          <div className="text-xs text-muted-foreground">{STATUS_LABEL[o.status] || o.status} · сдача {fmtDeadline(o.deadline)}</div>
                        </div>
                        <div className="shrink-0 text-sm font-bold">{fmtMoney(orderPaymentState(o).full)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <SheetFooter>
              {/* Есть долг — главная кнопка закрывает его целиком: аванс, потом
                  деньги, все неоплаченные заказы сразу. Оплата за отдельные
                  уроки — рядом. */}
              {debt > 0 ? (
                <Button onClick={() => onCloseDebt(clientName)} className="w-full bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
                  Закрыть долг · {fmtMoney(debt)}
                </Button>
              ) : (
                <Button onClick={() => onReceive(clientName)} className="w-full bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
                  Получить оплату
                </Button>
              )}
              <div className="flex w-full gap-2">
                {debt > 0 && (
                  <Button variant="outline" className="flex-1 px-2 text-xs" onClick={() => onReceive(clientName)}>
                    За отдельные уроки
                  </Button>
                )}
                <Button variant="outline" className="flex-1 px-2 text-xs" onClick={() => onDeposit(clientName)}>
                  Внести аванс
                </Button>
                <Button variant="outline" className="flex-1 px-2 text-xs" onClick={() => onAct(clientName)}>
                  Акт за месяц
                </Button>
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
