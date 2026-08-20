import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/useAppStore"
import { fmtMoney, orderTotal } from "@/lib/money"
import { fmtDeadline } from "@/lib/dates"
import { getClientAdvanceStats } from "@/lib/advances"

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
}: {
  clientName: string | null
  onOpenChange: (open: boolean) => void
  onDeposit: (client: string) => void
}) {
  const orders = useAppStore((s) => s.orders)
  const advances = useAppStore((s) => s.advances)

  const clientOrders = clientName
    ? orders.filter((o) => (o.client || "").toLowerCase() === clientName.toLowerCase() && o.status !== "cancelled")
    : []
  const revenue = clientOrders.reduce((s, o) => s + orderTotal(o), 0)
  const stats = clientName ? getClientAdvanceStats(clientName, advances, orders) : { totalIn: 0, used: 0, available: 0 }
  const sortedOrders = clientOrders.slice().sort((a, b) => (b.deadline || "").localeCompare(a.deadline || ""))

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
                <div className="rounded-xl bg-muted px-3.5 py-2.5">
                  <div className="text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">Заказов (активных)</div>
                  <div className="font-heading mt-0.5 text-[22px] font-bold">{clientOrders.length}</div>
                </div>
                <div className="rounded-xl bg-muted px-3.5 py-2.5">
                  <div className="text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">Выручка (с налогом)</div>
                  <div className="font-heading mt-0.5 text-[22px] font-bold">{fmtMoney(revenue)}</div>
                </div>
              </div>

              <div className="rounded-2xl bg-muted px-4 py-3.5">
                <div className="text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">Доступный остаток аванса</div>
                <div className="font-heading mt-1 text-[26px] font-bold text-foreground">{fmtMoney(stats.available)}</div>
                <div className="mt-2.5 flex justify-between border-t border-dashed border-border pt-2.5 text-[11.5px] text-muted-foreground">
                  <span>Внесено <b className="text-foreground">{fmtMoney(stats.totalIn)}</b></span>
                  <span>Списано <b className="text-foreground">{fmtMoney(stats.used)}</b></span>
                </div>
              </div>

              <div>
                <div className="mb-2 text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">Заказы клиента</div>
                <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto">
                  {sortedOrders.length === 0 && <div className="text-[12.5px] text-muted-foreground">Заказов не найдено</div>}
                  {sortedOrders.map((o) => {
                    const title = o.title || [o.subject, o.grade, o.quarter, o.lesson && `Урок ${o.lesson}`].filter(Boolean).join(", ") || "Без названия"
                    return (
                      <div key={o.id} className="flex items-center justify-between gap-2.5 rounded-xl bg-muted px-3.5 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-bold">{title}</div>
                          <div className="text-[11.5px] text-muted-foreground">{STATUS_LABEL[o.status] || o.status} · сдача {fmtDeadline(o.deadline)}</div>
                        </div>
                        <div className="shrink-0 text-[13px] font-bold">{fmtMoney(orderTotal(o))}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <SheetFooter>
              <Button
                onClick={() => onDeposit(clientName)}
                className="w-full bg-emphasis/90 font-extrabold text-emphasis-foreground hover:bg-emphasis"
              >
                Внести аванс от этого клиента
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
