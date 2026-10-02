import { useEffect, useMemo, useState } from "react"
import { Copy, Check } from "lucide-react"
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
import { distributePayment, applyPayments, spendAdvancesOnOrders } from "@/lib/payments"
import { clientAdvanceRows, getClientAdvanceStats, uniqueClientNames } from "@/lib/advances"
import { orderDisplayTitle } from "@/features/orders/OrderTimerButton"
import type { Order } from "@/types/models"
import { cn } from "@/lib/utils"

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Оплата пачкой и закрытие долга клиента целиком.
 *
 * Заказчик платит одной суммой за несколько уроков, а часть долга может
 * закрываться авансом, который он вносил раньше. Раньше и то и другое
 * делалось в форме каждого заказа по очереди. Здесь: выбрать уроки (или
 * сразу все неоплаченные), при желании сначала списать свободный аванс —
 * окно само скажет, сколько осталось заплатить деньгами, — и записать всё
 * одной кнопкой. Раскладка — по срокам сдачи, каждому не больше остатка.
 */
export function ReceivePaymentDialog({
  open,
  onOpenChange,
  initialClient,
  selectAll = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialClient?: string
  /** Открыть с выбранными ВСЕМИ неоплаченными заказами клиента («Закрыть долг»), а не только сданными. */
  selectAll?: boolean
}) {
  const orders = useAppStore((s) => s.orders)
  const advances = useAppStore((s) => s.advances)
  const setOrders = useAppStore((s) => s.setOrders)

  const clients = useMemo(
    () => uniqueClientNames(orders.filter((o) => o.status !== "cancelled" && orderPaymentState(o).remaining > 0).map((o) => o.client)).sort((a, b) => a.localeCompare(b, "ru")),
    [orders]
  )

  const [client, setClient] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(dateKey(new Date()))
  const [note, setNote] = useState("")
  const [amountTouched, setAmountTouched] = useState(false)
  const [useAdvance, setUseAdvance] = useState(true)
  const [copied, setCopied] = useState(false)

  // Неоплаченные заказы клиента, по сроку сдачи: в таком порядке и раскладываем.
  const unpaidOf = (list: Order[], c: string) =>
    ordersOfClient(list, c).filter((o) => orderPaymentState(o).remaining > 0).sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""))
  const unpaid = useMemo(() => unpaidOf(orders, client), [orders, client])

  function initialSelection(c: string, all: boolean) {
    const list = unpaidOf(orders, c)
    // По умолчанию — сданные: за них обычно и платят. «Закрыть долг» — все.
    return new Set((all ? list : list.filter((o) => o.status === "done")).map((o) => o.id))
  }

  useEffect(() => {
    if (!open) return
    const c = initialClient || clients[0] || ""
    setClient(c)
    setAmount("")
    setAmountTouched(false)
    setDate(dateKey(new Date()))
    setNote("")
    setUseAdvance(true)
    setCopied(false)
    setSelected(initialSelection(c, selectAll))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialClient, selectAll])

  const chosen = unpaid.filter((o) => selected.has(o.id))
  const chosenIds = chosen.map((o) => o.id)
  const chosenTotal = round2(chosen.reduce((s, o) => s + orderPaymentState(o).remaining, 0))

  // Свободный аванс клиента и как он ляжет на выбранные заказы.
  const advanceRows = useMemo(() => clientAdvanceRows(client, advances, orders), [client, advances, orders])
  const advanceFree = useMemo(() => getClientAdvanceStats(client, advances, orders).available, [client, advances, orders])
  const advancePlan = useMemo(
    () => (useAdvance && advanceFree > 0 ? spendAdvancesOnOrders(orders, chosenIds, advanceRows, advanceFree) : { orders, splits: [], total: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useAdvance, advanceFree, orders, advanceRows, chosenIds.join("|")]
  )
  const advanceById = new Map(advancePlan.splits.map((s) => [s.orderId, s.amount]))

  // Что остаётся заплатить деньгами после аванса — эту сумму и называть заказчику.
  const afterAdvance = chosenIds.map((id) => advancePlan.orders.find((o) => o.id === id)).filter((o): o is Order => !!o)
  const dueMoney = round2(afterAdvance.reduce((s, o) => s + orderPaymentState(o).remaining, 0))
  // Пока сумму не трогали руками — она равна остатку после аванса.
  const effectiveAmount = amountTouched ? parseNum(amount) : dueMoney
  const { splits, leftover } = distributePayment(afterAdvance, effectiveAmount)
  const moneyById = new Map(splits.map((s) => [s.orderId, s.amount]))
  const moneyTotal = round2(effectiveAmount - leftover)
  const closedCount = chosen.filter((o) => {
    const got = (advanceById.get(o.id) || 0) + (moneyById.get(o.id) || 0)
    return got >= orderPaymentState(o).remaining - 0.01
  }).length

  function toggle(id: string) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function selectAllOrders(on: boolean) {
    setSelected(on ? new Set(unpaid.map((o) => o.id)) : new Set())
  }

  async function copyAmount() {
    try {
      await navigator.clipboard.writeText(String(Math.round(dueMoney)))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* без буфера обмена — не беда, сумма и так на экране */ }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!advancePlan.total && !splits.length) return
    // Пересчёт по свежим данным: пока окно было открыто, таймер мог дописать
    // часы. Порядок тот же — сначала аванс, потом деньги.
    setOrders((prev) => {
      let next = prev
      if (useAdvance && advancePlan.total > 0) {
        const rows = clientAdvanceRows(client, advances, prev)
        const free = getClientAdvanceStats(client, advances, prev).available
        next = spendAdvancesOnOrders(prev, chosenIds, rows, free).orders
      }
      if (moneyTotal > 0) {
        const targets = chosenIds.map((id) => next.find((o) => o.id === id)).filter((o): o is Order => !!o)
        const money = distributePayment(targets, moneyTotal)
        next = applyPayments(next, money.splits, date, note.trim())
      }
      return next
    })
    saveData()
    onOpenChange(false)
  }

  const submitLabel = advancePlan.total > 0 && moneyTotal > 0
    ? `Записать: аванс ${fmtMoney(advancePlan.total)} + ${fmtMoney(moneyTotal)}`
    : advancePlan.total > 0
      ? `Списать аванс ${fmtMoney(advancePlan.total)}`
      : `Записать ${moneyTotal > 0 ? fmtMoney(moneyTotal) : ""}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>{selectAll ? "Закрыть долг клиента" : "Получить оплату"}</DialogTitle>
          <DialogDescription>
            Сначала списывается свободный аванс, остаток — деньгами. Раскладка по срокам сдачи, каждому заказу не больше его долга.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          <div>
            <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Заказчик</Label>
            <Select value={client} onValueChange={(c) => { setClient(c); setSelected(initialSelection(c, selectAll)); setAmountTouched(false) }}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Выберите заказчика" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-2xs font-bold tracking-wide text-muted-foreground uppercase">За какие уроки</Label>
              {unpaid.length > 0 && (
                <button type="button" onClick={() => selectAllOrders(selected.size !== unpaid.length)} className="text-xs font-bold hover:underline">
                  {selected.size === unpaid.length ? "Снять все" : `Выбрать все (${unpaid.length})`}
                </button>
              )}
            </div>
            {unpaid.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">У этого заказчика нет заказов с долгом.</div>
            ) : (
              <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
                {unpaid.map((o) => {
                  const pay = orderPaymentState(o)
                  const on = selected.has(o.id)
                  const fromAdvance = advanceById.get(o.id) || 0
                  const fromMoney = moneyById.get(o.id) || 0
                  const got = fromAdvance + fromMoney
                  return (
                    <label key={o.id} className={cn("flex cursor-pointer items-center gap-2.5 px-3 py-2", !on && "opacity-60 hover:opacity-100")}>
                      <Checkbox checked={on} onCheckedChange={() => toggle(o.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{orderDisplayTitle(o)}</div>
                        <div className="text-2xs text-muted-foreground">
                          {o.status === "done" ? "сдан" : "в работе"} · {fmtDeadline(o.deadline).replace(" г.", "")} · долг {fmtMoney(pay.remaining)}
                        </div>
                      </div>
                      {on && (
                        <div className="shrink-0 text-right text-xs tabular-nums">
                          <div className={cn("font-bold", got < pay.remaining - 0.01 ? "text-warning-foreground" : "text-success-foreground")}>
                            {got > 0 ? (got >= pay.remaining - 0.01 ? "закрыт" : `${fmtMoney(got)} из ${fmtMoney(pay.remaining)}`) : "—"}
                          </div>
                          {fromAdvance > 0 && <div className="text-2xs text-muted-foreground">аванс {fmtMoney(fromAdvance)}{fromMoney > 0 ? ` + ${fmtMoney(fromMoney)}` : ""}</div>}
                        </div>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {advanceFree > 0 && chosen.length > 0 && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border px-3 py-2.5">
              <Checkbox checked={useAdvance} onCheckedChange={(c) => { setUseAdvance(!!c); setAmountTouched(false) }} className="mt-0.5" />
              <div className="min-w-0 text-sm">
                <div className="font-bold">Сначала списать аванс</div>
                <div className="text-xs text-muted-foreground">
                  Свободно у клиента {fmtMoney(advanceFree)}{useAdvance && advancePlan.total > 0 ? ` · спишется ${fmtMoney(advancePlan.total)}` : ""}. Старые авансы — первыми.
                </div>
              </div>
            </label>
          )}

          {/* Сколько заплатить деньгами после аванса — эту сумму и называют
              заказчику. Поле суммы по умолчанию равно ей. */}
          {chosen.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3.5 py-3">
              <div>
                <div className="text-2xs font-bold tracking-wide text-muted-foreground uppercase">Заказчику заплатить</div>
                <div className="font-heading text-2xl font-bold tabular-nums">{fmtMoney(dueMoney)}</div>
                {advancePlan.total > 0 && <div className="text-2xs text-muted-foreground">долг {fmtMoney(chosenTotal)} − аванс {fmtMoney(advancePlan.total)}</div>}
              </div>
              {dueMoney > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={copyAmount} title="Скопировать сумму">
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Скопировано" : "Скопировать"}
                </Button>
              )}
            </div>
          )}

          {dueMoney > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.4fr]">
              <div>
                <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Получено, ₽</Label>
                <Input
                  inputMode="decimal"
                  value={amountTouched ? amount : dueMoney ? String(dueMoney) : ""}
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
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: за сентябрь" />
              </div>
            </div>
          )}

          {chosen.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Закроется заказов: <b className="text-foreground">{closedCount} из {chosen.length}</b>
              {leftover > 0 && <span className="ml-1 font-bold text-destructive">· {fmtMoney(leftover)} лишние — некуда положить, уменьшите сумму или выберите ещё уроки</span>}
              {amountTouched && effectiveAmount < dueMoney - 0.01 && <span className="ml-1">· не хватает {fmtMoney(dueMoney - effectiveAmount)}: последние по сроку останутся с долгом</span>}
            </div>
          )}

          <DialogFooter className="sticky bottom-0 -mx-1 border-t border-border bg-popover px-1 pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={!advancePlan.total && !splits.length} className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
