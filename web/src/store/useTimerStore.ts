import { create } from "zustand"
import { useAppStore } from "./useAppStore"
import { useToastStore } from "./useToastStore"
import { saveData, applyHoursDelta } from "@/lib/cloudSync"
import { parseHours, parseNum, dateKey, orderPaymentState, fmtHours } from "@/lib/money"
import { fmtMilestoneDuration } from "@/lib/money"
import { requestNotificationPermission, isPageBackground, sendSystemNotification } from "@/lib/notifications"

const TIMER_STATE_KEY = "design_crm_timer_state_v1"
const MILESTONE_STEP_MS = 30 * 60 * 1000
/** Как часто накопленное время уходит в заказ и журнал. */
const FLUSH_EVERY_MS = 60 * 1000
/**
 * Пауза между тиками длиннее этой — компьютер спал (крышка закрыта, сон).
 * В свёрнутой вкладке Chrome будит таймер раз в минуту, так что обычная
 * работа в другой программе сюда не попадает.
 */
const SLEEP_GAP_MS = 10 * 60 * 1000
/** Сколько после последнего «пульса» вкладка считается ещё живой (свёрнутую Chrome будит раз в минуту). */
const OTHER_TAB_ALIVE_MS = 90 * 1000
const TAB_ID = Math.random().toString(36).slice(2, 10)

interface TimerState {
  id: string
  title: string
  elapsed: number
  segmentStart: number
  running: boolean
  start: number
  nextMilestoneMs: number
  /** Когда был последний тик — по нему видно сон компьютера. В хранилище не пишется. */
  lastTickAt: number
  onNavigateToOrder: ((orderId: string) => void) | null

  setOnNavigateToOrder: (fn: (orderId: string) => void) => void
  restore: () => void
  persist: () => void
  tick: () => void
  toggle: () => void
  reset: () => void
  startFor: (id: string, title: string) => void
  stop: () => void
  /** Записать накопленное время в заказ и журнал; at — момент, до которого (по умолчанию «сейчас»). */
  flushSegment: (at?: number) => void
  /** Заказ удалён или слит с другим: таймер переходит на replacementId или останавливается. */
  orderRemoved: (orderId: string, replacementId?: string, replacementTitle?: string) => void
}

/**
 * Добавить часы к заказу: в первую неготовую позицию (или последнюю), а если
 * позиций нет — в «Факт. часы». Раньше у заказа без позиций время таймера
 * просто терялось, вместе с журналом.
 */
function addHoursToOrder(orderId: string, hours: number, date: string): boolean {
  const app = useAppStore.getState()
  const order = app.orders.find((o) => o.id === orderId)
  if (!order || !(hours > 0)) return false
  const line = order.lines.find((l) => !l.ready) || order.lines[order.lines.length - 1]
  let next = line
    ? { ...order, lines: order.lines.map((l) => (l.id === line.id ? { ...l, pomoHours: Math.round((parseHours(l.pomoHours) + hours) * 10000) / 10000 } : l)) }
    : { ...order, actualHours: String(Math.round((parseNum(order.actualHours) + hours) * 10000) / 10000) }
  // Время на почасовой позиции поднимает цену. Отметка «оплачен» у заказа,
  // закрытого авансом, от этого должна сниматься: раньше она оставалась, и
  // при загрузке заказу выдумывалась оплата на разницу.
  if (next.isPaid && !orderPaymentState(next).isFullyPaid) next = { ...next, isPaid: false }
  app.setOrders((prev) => prev.map((o) => (o.id === next.id ? next : o)))
  // Время таймера — это реально отработанные часы, они идут в журнал всегда
  // и вливаются в запись этого дня по заказу (lib/journal.ts).
  applyHoursDelta(orderId, date, hours)
  return true
}

function readSaved(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(TIMER_STATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Таймер уже идёт в другой вкладке — второй запуск считал бы то же время дважды. */
function runningInOtherTab(): boolean {
  const saved = readSaved()
  return !!saved && saved.running === true && saved.tab !== TAB_ID && Date.now() - Number(saved.beat || 0) < OTHER_TAB_ALIVE_MS
}

export const useTimerStore = create<TimerState>((set, get) => ({
  id: "standalone",
  title: "Свободный замер",
  elapsed: 0,
  segmentStart: 0,
  running: false,
  start: 0,
  nextMilestoneMs: MILESTONE_STEP_MS,
  lastTickAt: 0,
  onNavigateToOrder: null,

  setOnNavigateToOrder: (fn) => set({ onNavigateToOrder: fn }),

  persist: () => {
    const s = get()
    localStorage.setItem(TIMER_STATE_KEY, JSON.stringify({
      id: s.id, title: s.title, elapsed: s.elapsed, segmentStart: s.segmentStart, nextMilestoneMs: s.nextMilestoneMs,
      running: s.running, tab: TAB_ID, beat: Date.now(),
    }))
  },

  // Restored ALWAYS paused, even if it was ticking when the tab closed — silently
  // resuming after an unknown gap (e.g. overnight) would rack up bogus hours.
  restore: () => {
    const saved = readSaved()
    if (!saved || !saved.id || !saved.elapsed) return
    set({
      id: String(saved.id),
      title: String(saved.title || "Свободный замер"),
      elapsed: Number(saved.elapsed),
      segmentStart: Number(saved.segmentStart || 0),
      nextMilestoneMs: Number(saved.nextMilestoneMs || MILESTONE_STEP_MS),
      running: false,
    })
  },

  flushSegment: (at) => {
    const s = get()
    if (s.id === "standalone") return
    const moment = at ?? Date.now()
    const nowElapsed = s.running ? moment - s.start : s.elapsed
    const segmentMs = nowElapsed - (s.segmentStart || 0)
    if (segmentMs <= 0) return
    // Заказа нет (удалён) — сегмент не сжигаем: orderRemoved решит, куда он.
    if (!useAppStore.getState().orders.some((o) => o.id === s.id)) return
    set({ segmentStart: nowElapsed })
    addHoursToOrder(s.id, segmentMs / 1000 / 3600, dateKey(new Date(moment)))
  },

  tick: () => {
    const s = get()
    if (!s.running) return
    const now = Date.now()

    // Компьютер спал с идущим таймером: время до сна записываем, сам сон —
    // нет (сдвигаем старт), но предлагаем засчитать его одним нажатием. Раньше
    // ночь с закрытой крышкой уходила в заказ как 10 часов работы.
    if (s.id !== "standalone" && s.lastTickAt && now - s.lastTickAt > SLEEP_GAP_MS) {
      const gap = now - s.lastTickAt
      const sleptFrom = s.lastTickAt
      get().flushSegment(sleptFrom)
      saveData()
      set({ start: get().start + gap })
      const orderId = s.id
      const title = s.title
      const hours = gap / 1000 / 3600
      useToastStore.getState().addToast({
        title: `Таймер: ${fmtHours(hours)} простоя не засчитано`,
        sub: `Компьютер спал или вкладка стояла. Нажмите, чтобы засчитать это время в «${title}».`,
        onClick: () => {
          if (addHoursToOrder(orderId, hours, dateKey(new Date(sleptFrom)))) {
            saveData()
            useToastStore.getState().addToast({ title: `Засчитано ${fmtHours(hours)}`, sub: title })
          }
        },
      }, 120000)
    }

    const elapsed = now - get().start
    set({ elapsed, lastTickAt: now })

    // Раз в минуту накопленное уходит в заказ, чтобы пережить перезагрузку.
    // Раньше условие было «секунда кратна 60»: в свёрнутой вкладке Chrome
    // будит таймер раз в минуту, и это совпадение почти не случалось — всё
    // время копилось в памяти и после полуночи уходило в новый день.
    if (s.id !== "standalone" && elapsed - (get().segmentStart || 0) >= FLUSH_EVERY_MS) {
      get().flushSegment(now)
      saveData()
    }

    // Milestone toasts every 30 min — a while loop (not if) so a backgrounded tab that
    // missed several ticks at once doesn't lose a milestone.
    while (get().id !== "standalone" && get().elapsed >= get().nextMilestoneMs) {
      const ms = get().nextMilestoneMs
      set({ nextMilestoneMs: ms + MILESTONE_STEP_MS })
      const label = fmtMilestoneDuration(ms)
      const title = get().title
      const orderId = get().id
      const onNav = get().onNavigateToOrder
      if (isPageBackground()) {
        sendSystemNotification("Таймер CRM", `Отработано ${label} — «${title}»`, () => onNav?.(orderId))
      } else {
        useToastStore.getState().addToast({ title: `Отработано ${label}`, sub: title, onClick: () => onNav?.(orderId) })
      }
    }

    get().persist()
  },

  toggle: () => {
    const s = get()
    if (s.running) {
      set({ running: false })
      if (s.id !== "standalone") {
        get().flushSegment()
        saveData()
      }
      get().persist()
    } else {
      if (s.id !== "standalone" && runningInOtherTab()) {
        useToastStore.getState().addToast({ title: "Таймер уже идёт в другой вкладке", sub: "Остановите его там — иначе одно и то же время посчитается дважды.", danger: true })
        return
      }
      if (s.id !== "standalone") requestNotificationPermission()
      set({ start: Date.now() - s.elapsed, running: true, lastTickAt: Date.now() })
      get().tick()
    }
  },

  reset: () => {
    set({ running: false, elapsed: 0, segmentStart: 0, id: "standalone", title: "Свободный замер", nextMilestoneMs: MILESTONE_STEP_MS, lastTickAt: 0 })
    localStorage.removeItem(TIMER_STATE_KEY)
  },

  startFor: (id, title) => {
    const s = get()
    if (s.id === id) {
      get().toggle()
      return
    }
    if (runningInOtherTab()) {
      useToastStore.getState().addToast({ title: "Таймер уже идёт в другой вкладке", sub: "Остановите его там — иначе одно и то же время посчитается дважды.", danger: true })
      return
    }
    if (s.id !== "standalone") {
      get().flushSegment()
      saveData()
    }
    get().reset()
    set({ id, title, segmentStart: 0 })
    get().toggle()
  },

  stop: () => {
    const s = get()
    if (s.id !== "standalone") {
      get().flushSegment()
      saveData()
    }
    get().reset()
  },

  orderRemoved: (orderId, replacementId, replacementTitle) => {
    const s = get()
    if (s.id !== orderId) return
    if (replacementId) {
      // Дубль слит в другой заказ: таймер продолжает идти уже по нему. Раньше
      // он «шёл» дальше по удалённому заказу, и всё время пропадало.
      set({ id: replacementId, title: replacementTitle || s.title })
      get().flushSegment()
      get().persist()
      return
    }
    get().reset()
  },
}))
