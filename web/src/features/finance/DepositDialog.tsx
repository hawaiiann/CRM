import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ComboInput } from "@/components/ui/combo-input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { fmtMoney, orderPaymentState, ordersOfClient } from "@/lib/money"
import { fmtDeadline } from "@/lib/dates"
import { allocateAdvanceToOrders, distributePayment } from "@/lib/payments"
import { orderDisplayTitle } from "@/features/orders/OrderTimerButton"
import { cn } from "@/lib/utils"
import { catalogWithCurrent } from "@/lib/catalog"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { parseNum, dateKey } from "@/lib/money"
import type { Advance } from "@/types/models"

function randId() {
  return "adv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function DepositDialog({
  open,
  onOpenChange,
  initialClient,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialClient?: string
}) {
  const appSettings = useAppStore((s) => s.appSettings)
  const setAdvances = useAppStore((s) => s.setAdvances)
  const orders = useAppStore((s) => s.orders)
  const setOrders = useAppStore((s) => s.setOrders)
  const [client, setClient] = useState(initialClient || "")
  // Списать сразу на выбранные заказы — обычно аванс вносят под конкретные
  // уроки, и раньше это была вторая ручная операция в каждом заказе.
  const [targets, setTargets] = useState<Set<string>>(new Set())
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(dateKey(new Date()))
  const [note, setNote] = useState("")

  useEffect(() => {
    if (open) { setClient(initialClient || ""); setTargets(new Set()) }
  }, [open, initialClient])

  const unpaid = useMemo(
    () => ordersOfClient(orders, client).filter((o) => orderPaymentState(o).remaining > 0).sort((a, b) => (a.deadline || "").localeCompare(b.deadline || "")),
    [orders, client]
  )
  const chosen = unpaid.filter((o) => targets.has(o.id))
  const preview = distributePayment(chosen, parseNum(amount))
  const previewById = new Map(preview.splits.map((x) => [x.orderId, x.amount]))

  function reset() {
    setClient("")
    setAmount("")
    setDate(dateKey(new Date()))
    setNote("")
    setTargets(new Set())
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseNum(amount)
    if (!client.trim() || !amt) return
    const a: Advance = { id: randId(), client: client.trim(), amount: amt, date, note: note.trim() }
    setAdvances((prev) => [...prev, a])
    if (chosen.length) setOrders((prev) => allocateAdvanceToOrders(prev, a.id, amt, chosen.map((o) => o.id)).orders)
    saveData()
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Внести аванс от клиента</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Заказчик / клиент</Label>
            <ComboInput value={client} onChange={setClient} options={catalogWithCurrent(appSettings, "clients", client)} placeholder="Выберите или впишите клиента..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Сумма аванса (₽)</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="50 000 ₽" />
            </div>
            <div>
              <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Дата поступления</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Примечание / комментарий</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: Предоплата за август" />
          </div>

          {unpaid.length > 0 && (
            <div>
              <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Сразу списать на уроки (необязательно)</Label>
              <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
                {unpaid.map((o) => {
                  const on = targets.has(o.id)
                  const gets = previewById.get(o.id) || 0
                  return (
                    <label key={o.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5", on ? "bg-muted" : "hover:bg-muted/50")}>
                      <Checkbox checked={on} onCheckedChange={() => setTargets((prev) => { const n = new Set(prev); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n })} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-bold">{orderDisplayTitle(o)}</div>
                        <div className="text-[11px] text-muted-foreground">{fmtDeadline(o.deadline).replace(" г.", "")} · к доплате {fmtMoney(orderPaymentState(o).remaining)}</div>
                      </div>
                      {on && <div className="shrink-0 text-[12.5px] font-bold tabular-nums">{gets > 0 ? fmtMoney(gets) : "—"}</div>}
                    </label>
                  )
                })}
              </div>
              {chosen.length > 0 && preview.leftover > 0 && (
                <div className="mt-1.5 text-[11.5px] text-muted-foreground">
                  {fmtMoney(preview.leftover)} останутся на балансе клиента — спишутся на следующие уроки.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
              Внести аванс
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
