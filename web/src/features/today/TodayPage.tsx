import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { OrderLink } from "@/components/ui/order-link"
import { Wallet, Clock3, ArrowRight, CalendarClock, Play } from "lucide-react"
import { PageHeader } from "@/components/layout/AppShell"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { fmtMoney, fmtHours, dateKey, addDays, ordersDebt, isOrderOverdue } from "@/lib/money"
import { getTotalAdvanceStats } from "@/lib/advances"
import { StatusBadge } from "@/features/orders/StatusBadge"
import { OrderTimerButton } from "@/features/orders/OrderTimerButton"
import { orderTitleWithTopic } from "@/lib/orderTitle"
import { groupByDayOrder } from "@/lib/journal"
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
  const boards = useAppStore((s) => s.planningBoards)
  const ktpMode = useAppStore((s) => s.appSettings.ktpMode)
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
      // Отрицательная запись — правка часов задним числом, а не работа:
      // в «часах сегодня» её не считаем, иначе выходит «−1 ч 58 мин».
      const h = Math.max(0, e.delta)
      if (e.date === today) hoursToday += h
      if (e.date >= weekStart && e.date <= today) hoursWeek += h
    })
    // Дни с несколькими строками по одному заказу — так писали старые версии
    // (по строке на минуту). Их убирает «Схлопнуть» в Журнале часов.
    let legacyDays = 0
    groupByDayOrder(activityLog).forEach((g) => { if (g.length > 1) legacyDays++ })
    return { debt: ordersDebt(orders), advance: adv.available, hoursToday, hoursWeek, legacyDays }
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
              <h3 className="text-lg font-bold">В работе сейчас</h3>
              <span className="text-xs text-muted-foreground">{inWork.length ? `${inWork.length} ${inWork.length === 1 ? "урок" : inWork.length < 5 ? "урока" : "уроков"}` : ""}</span>
            </div>
            {inWork.length === 0 ? (
              <EmptyHint icon={Play} text="Ничего не в работе. Возьмите урок из очереди ниже — статус меняется прямо в строке." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {inWork.map((o) => <OrderRow key={o.id} order={o} title={orderTitleWithTopic(boards, o, { ktpMode })} today={today} onStatus={(s) => changeStatus(o.id, s)} />)}
              </div>
            )}
          </section>

          <section className="glass-surface rounded-xl p-4.5">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-lg font-bold">Очередь по срокам</h3>
              <Link to="/orders" className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground">
                Все заказы <ArrowRight className="size-3" />
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <EmptyHint icon={CalendarClock} text="Очередь пуста. Новый урок заводится из планирования — кнопкой в карточке урока." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {upcoming.map((o) => <OrderRow key={o.id} order={o} title={orderTitleWithTopic(boards, o, { ktpMode })} today={today} onStatus={(s) => changeStatus(o.id, s)} />)}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-3.5">
          {/* shrink-0: колонка растянута по высоте соседней, и без этого блок
              сжимался под виджет задач — низ с кнопками обрезался. */}
          <section className="glass-surface shrink-0 rounded-xl p-4.5">
            <h3 className="mb-3 text-lg font-bold">Деньги и время</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Stat label="К получению" value={fmtMoney(money.debt)} tone={money.debt > 0 ? "destructive" : undefined} />
              <Stat label="Аванс на балансе" value={fmtMoney(money.advance)} />
              <Stat label="Часы сегодня" value={fmtHours(money.hoursToday)} />
              <Stat label="За неделю" value={fmtHours(money.hoursWeek)} />
            </div>
            {money.legacyDays > 0 && (
              <Link to="/finance?tab=journal" className="mt-3 block rounded-lg bg-notice px-3 py-2 text-xs font-bold text-notice-foreground hover:opacity-90">
                В журнале {money.legacyDays} {money.legacyDays === 1 ? "день" : money.legacyDays < 5 ? "дня" : "дней"} со старыми поминутными строками — схлопнуть в Журнале часов
              </Link>
            )}
            {overdueCount > 0 && (
              <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs font-bold text-danger-soft-foreground">
                Просрочено: {overdueCount}. Они наверху в списках, с красной пометкой.
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <Link to="/finance" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-muted">
                <Clock3 className="size-3.5" />
                Финансы
              </Link>
              <Link to="/planning" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-muted">
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
      <div className="text-2xs font-extrabold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn("font-heading mt-0.5 text-2xl font-bold tabular-nums", tone === "destructive" && "text-destructive")}>{value}</div>
    </div>
  )
}

function EmptyHint({ icon: Icon, text }: { icon: typeof Play; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-4 text-sm text-muted-foreground">
      <Icon className="size-4 shrink-0" strokeWidth={1.8} />
      {text}
    </div>
  )
}

function OrderRow({ order, title, today, onStatus }: { order: Order; title: string; today: string; onStatus: (s: Order["status"]) => void }) {
  const due = deadlineLabel(order.deadline, today)
  const ready = order.lines.filter((l) => l.ready).length
  return (
    // На телефоне таймер, название и статус не влезают в одну строку:
    // название уезжало в «Литература, …». Там название идёт первой строкой
    // на всю ширину, таймер и статус — второй.
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl bg-muted/60 px-3 py-2.5">
      <div className="order-2 sm:order-1"><OrderTimerButton order={order} /></div>
      <OrderLink orderId={order.id} className="order-1 min-w-0 basis-full sm:order-2 sm:flex-1 sm:basis-auto">
        <div className="truncate text-sm font-bold hover:underline">{title}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className={cn("font-bold", due.tone === "overdue" && "text-destructive", due.tone === "soon" && "text-warning-foreground")}>{due.text}</span>
          {order.lines.length > 0 && <span>{ready}/{order.lines.length} поз.</span>}
          {order.client && <span className="truncate">{order.client}</span>}
        </div>
      </OrderLink>
      <div className="order-3 ml-auto sm:ml-0"><StatusBadge status={order.status} onChange={onStatus} /></div>
    </div>
  )
}
