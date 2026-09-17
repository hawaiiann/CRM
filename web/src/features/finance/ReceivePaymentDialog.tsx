import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { fmtMoney, parseNum, dateKey, orderPaymentState, ordersOfClient } from "@/lib/money"
import { fmtDeadline } from "@/lib/dates"
import { distributePayment, applyPayments } from "@/lib/payments"
import { orderDisplayTitle } from "@/features/orders/OrderTimerButton"
import { cn } from "@/lib/utils"

/**
 * Оплата пачкой: заказчик платит одной суммой за несколько сданных уроков.
 * Раньше каждый платёж вносился в форме каждого заказа отдельно. Здесь —
 * выбрать уроки, ввести сумму и дату; сумма раскладывается по срокам сдачи,
 * каждому не больше его остатка.
 */
export function ReceivePaymentDialog({
  open,
  onOpenChange,
  initialClient,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialClient?: string
}) {
  const orders = useAppStore((s) => s.orders)
  const setOrders = useAppStore((s) => s.setOrders)

  const clients = useMemo(
    () => [...new Set(orders.filter((o) => o.status !== "cancelled" && orderPaymentState(o).remaining > 0).map((o) => o.client).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")),
    [orders]
  )

  const [client, setClient] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(dateKey(new Date()))
  const [note, setNote] = useState("")
  const [amountTouched, setAmountTouched] = useState(false)

  // Неоплаченные заказы клиента, по сроку сдачи: в таком порядке и раскладываем.
  const unpaid = useMemo(
    () => ordersOfClient(orders, client).filter((o) => orderPaymentState(o).remaining > 0).sort((a, b) => (a.deadline || "").localeCompare(b.deadline || "")),
    [orders, client]
  )

  useEffect(() => {
    if (!open) return
    const c = initialClient || clients[0] || ""
    setClient(c)
    setAmount("")
    setAmountTouched(false)
    setDate(dateKey(new Date()))
    setNote("")
    // По умолчанию выбраны сданные заказы: за них обычно и платят.
    const list = ordersOfClient(orders, c).filter((o) => orderPaymentState(o).remaining > 0)
    setSelected(new Set(list.filter((o) => o.status === "done").map((o) => o.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialClient])

  const chosen = unpaid.filter((o) => selected.has(o.id))
  const chosenTotal = Math.round(chosen.reduce((s, o) => s + orderPaymentState(o).remaining, 0) * 100) / 100
  // Пока сумму не трогали руками — она равна остатку по выбранным.
  const effectiveAmount = amountTouched ? parseNum(amount) : chosenTotal
  const { splits, leftover } = distributePayment(chosen, effectiveAmount)
  const splitById = new Map(splits.map((s) => [s.orderId, s.amount]))

  function toggle(id: string) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function selectAll(on: boolean) {
    setSelected(on ? new Set(unpaid.map((o) => o.id)) : new Set())
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!splits.length) return
    setOrders((prev) => applyPayments(prev, splits, date, note.trim()))
    saveData()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Получить оплату</DialogTitle>
          <DialogDescription>Одна сумма за несколько уроков: раскладывается по срокам сдачи, каждому не больше его остатка.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Заказчик</Label>
              <Select value={client} onValueChange={(c) => { setClient(c); setSelected(new Set(ordersOfClient(orders, c).filter((o) => orderPaymentState(o).remaining > 0 && o.status === "done").map((o) => o.id))) }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Выберите заказчика" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-2xs font-bold tracking-wide text-muted-foreground uppercase">За какие уроки</Label>
              {unpaid.length > 0 && (
                <button type="button" onClick={() => selectAll(selected.size !== unpaid.length)} className="text-xs font-bold hover:underline">
                  {selected.size === unpaid.length ? "Снять все" : "Выбрать все"}
                </button>
              )}
            </div>
            {unpaid.length === 0 ? (
              <div className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">У этого заказчика нет заказов с остатком к оплате.</div>
            ) : (
              <div className="flex flex-col gap-1">
                {unpaid.map((o) => {
                  const pay = orderPaymentState(o)
                  const on = selected.has(o.id)
                  const gets = splitById.get(o.id) || 0
                  return (
                    <label key={o.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2", on ? "bg-muted" : "hover:bg-muted/50")}>
                      <Checkbox checked={on} onCheckedChange={() => toggle(o.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{orderDisplayTitle(o)}</div>
                        <div className="text-2xs text-muted-foreground">
                          {o.status === "done" ? "сдан" : "в работе"} · {fmtDeadline(o.deadline).replace(" г.", "")} · к доплате {fmtMoney(pay.remaining)}
                        </div>
                      </div>
                      {on && (
                        <div className={cn("shrink-0 text-sm font-bold tabular-nums", gets < pay.remaining - 0.01 && "text-warning-foreground")}>
                          {gets > 0 ? fmtMoney(gets) : "—"}
                        </div>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.4fr]">
            <div>
              <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Сумма, ₽</Label>
              <Input
                inputMode="decimal"
                value={amountTouched ? amount : chosenTotal ? String(chosenTotal) : ""}
                onChange={(e) => { setAmountTouched(true); setAmount(e.target.value) }}
                placeholder="0"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Дата</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Примечание</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: за август" />
            </div>
          </div>

          <div className="rounded-lg bg-muted px-3 py-2.5 text-xs">
            Выбрано <b>{chosen.length}</b> · остаток по ним <b>{fmtMoney(chosenTotal)}</b> · будет разложено <b>{fmtMoney(effectiveAmount - leftover)}</b>
            {leftover > 0 && <span className="ml-1 font-bold text-destructive">· {fmtMoney(leftover)} некуда положить — снимите лишнее или выберите ещё уроки</span>}
          </div>

          <DialogFooter className="sticky bottom-0 -mx-1 border-t border-border bg-popover px-1 pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={!splits.length} className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
              Записать {splits.length ? fmtMoney(effectiveAmount - leftover) : ""}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
