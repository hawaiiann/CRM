import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Wallet, Clock3, ArrowRight, CalendarClock, Play } from "lucide-react"
import { PageHeader } from "@/components/layout/AppShell"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { fmtMoney, fmtHours, dateKey, addDays, ordersDebt, isOrderOverdue } from "@/lib/money"
import { getTotalAdvanceStats } from "@/lib/advances"
import { StatusBadge } from "@/features/orders/StatusBadge"
import { OrderTimerButton, orderDisplayTitle } from "@/features/orders/OrderTimerButton"
import { TasksMiniWidget } from "@/features/dashboard/TasksMiniWidget"
import { ReceivePaymentDialog } from "@/features/finance/ReceivePaymentDialog"
import { cn } from "@/lib/utils"
import type { Order } from "@/types/models"

/**
 * «Сегодня» — стартовый экран для одного человека: что в работе прямо сейчас,
 * что горит по срокам, задачи на день и деньги одним числом. Аналитика
 * (графики, метрики по дням) уехала в Финансы → Аналитика: на старте она
 * занимала весь экран, а отвечала на вопросы, которые задают раз в месяц.
 */

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"]

function daysUntil(dateStr: string, today: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  const [ty, tm, td] = today.split("-").map(Number)
  return Math.round((new Date(y, m - 1, d).getTime() - new Date(ty, tm - 1, td).getTime()) / 86400000)
}

/** «сегодня», «завтра», «через 3 дн.», «просрочен на 2 дн.» — вместо голой даты. */
export function deadlineLabel(deadline: string, today: string): { text: string; tone: "overdue" | "soon" | "normal" } {
  if (!deadline) return { text: "без срока", tone: "normal" }
  const n = daysUntil(deadline, today)
  if (n < 0) return { text: `просрочен на ${-n} дн.`, tone: "overdue" }
  if (n === 0) return { text: "сегодня", tone: "soon" }
  if (n === 1) return { text: "завтра", tone: "soon" }
  if (n <= 3) return { text: `через ${n} дн.`, tone: "soon" }
  const [, m, d] = deadline.split("-").map(Number)
  return { text: `${d} ${MONTHS_GEN[m - 1]}`, tone: "normal" }
}

export function TodayPage() {
  const orders = useAppStore((s) => s.orders)
  const advances = useAppStore((s) => s.advances)
  const activityLog = useAppStore((s) => s.activityLog)
  const setOrders = useAppStore((s) => s.setOrders)
  const [receiveOpen, setReceiveOpen] = useState(false)

  const now = new Date()
  const today = dateKey(now)

  const { inWork, upcoming, overdueCount } = useMemo(() => {
    const byDeadline = (a: Order, b: Order) => (a.deadline || "9999").localeCompare(b.deadline || "9999")
    const inWork = orders.filter((o) => o.status === "progress" || o.status === "review").sort(byDeadline)
    const upcoming = orders.filter((o) => o.status === "queue").sort(byDeadline).slice(0, 8)
    const overdueCount = orders.filter(isOrderOverdue).length
    return { inWork, upcoming, overdueCount }
  }, [orders])

  const money = useMemo(() => {
    const adv = getTotalAdvanceStats(advances, orders)
    const weekStart = dateKey(addDays(now, -((now.getDay() + 6) % 7)))
    let hoursToday = 0, hoursWeek = 0
    activityLog.forEach((e) => {
      if (e.field !== "hours") return
      if (e.date === today) hoursToday += e.delta
      if (e.date >= weekStart && e.date <= today) hoursWeek += e.delta
    })
    return { debt: ordersDebt(orders), advance: adv.available, hoursToday, hoursWeek }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, advances, activityLog, today])

  function changeStatus(id: string, next: Order["status"]) {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: next } : o)))
    saveData()
  }

  return (
    <div>
      <PageHeader
        title="Сегодня"
        subtitle={`${WEEKDAYS[now.getDay()]}, ${now.getDate()} ${MONTHS_GEN[now.getMonth()]}`}
        actions={
          <Button onClick={() => setReceiveOpen(true)} className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
            <Wallet />
            Получить оплату
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-3.5">
          <section className="glass-surface rounded-xl p-4.5">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[16px] font-bold">В работе сейчас</h3>
              <span className="text-[12px] text-muted-foreground">{inWork.length ? `${inWork.length} ${inWork.length === 1 ? "урок" : inWork.length < 5 ? "урока" : "уроков"}` : ""}</span>
            </div>
            {inWork.length === 0 ? (
              <EmptyHint icon={Play} text="Ничего не в работе. Возьмите урок из очереди ниже — статус меняется прямо в строке." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {inWork.map((o) => <OrderRow key={o.id} order={o} today={today} onStatus={(s) => changeStatus(o.id, s)} />)}
              </div>
            )}
          </section>

          <section className="glass-surface rounded-xl p-4.5">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[16px] font-bold">Очередь по срокам</h3>
              <Link to="/orders" className="flex items-center gap-1 text-[12px] font-bold text-muted-foreground hover:text-foreground">
                Все заказы <ArrowRight className="size-3" />
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <EmptyHint icon={CalendarClock} text="Очередь пуста. Новый урок заводится из планирования — кнопкой в карточке урока." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {upcoming.map((o) => <OrderRow key={o.id} order={o} today={today} onStatus={(s) => changeStatus(o.id, s)} />)}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-3.5">
          <section className="glass-surface rounded-xl p-4.5">
            <h3 className="mb-3 text-[16px] font-bold">Деньги и время</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Stat label="К получению" value={fmtMoney(money.debt)} tone={money.debt > 0 ? "destructive" : undefined} />
              <Stat label="Аванс на балансе" value={fmtMoney(money.advance)} />
              <Stat label="Часы сегодня" value={fmtHours(money.hoursToday)} />
              <Stat label="За неделю" value={fmtHours(money.hoursWeek)} />
            </div>
            {overdueCount > 0 && (
              <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] font-bold text-destructive">
                Просрочено: {overdueCount}. Они наверху в списках, с красной пометкой.
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <Link to="/finance" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] font-bold hover:bg-muted">
                <Clock3 className="size-3.5" />
                Финансы
              </Link>
              <Link to="/planning" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] font-bold hover:bg-muted">
                Планирование
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </section>

          <TasksMiniWidget />
        </div>
      </div>

      <ReceivePaymentDialog open={receiveOpen} onOpenChange={setReceiveOpen} />
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "destructive" }) {
  return (
    <div>
      <div className="text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn("font-heading mt-0.5 text-[22px] font-bold tabular-nums", tone === "destructive" && "text-destructive")}>{value}</div>
    </div>
  )
}

function EmptyHint({ icon: Icon, text }: { icon: typeof Play; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-4 text-[12.5px] text-muted-foreground">
      <Icon className="size-4 shrink-0" strokeWidth={1.8} />
      {text}
    </div>
  )
}

function OrderRow({ order, today, onStatus }: { order: Order; today: string; onStatus: (s: Order["status"]) => void }) {
  const due = deadlineLabel(order.deadline, today)
  const ready = order.lines.filter((l) => l.ready).length
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-muted/60 px-3 py-2.5">
      <OrderTimerButton order={order} />
      <Link to={`/orders/${order.id}`} className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-bold hover:underline">{orderDisplayTitle(order)}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
          <span className={cn("font-bold", due.tone === "overdue" && "text-destructive", due.tone === "soon" && "text-warning-foreground")}>{due.text}</span>
          {order.lines.length > 0 && <span>{ready}/{order.lines.length} поз.</span>}
          {order.client && <span className="truncate">{order.client}</span>}
        </div>
      </Link>
      <StatusBadge status={order.status} onChange={onStatus} />
    </div>
  )
}
