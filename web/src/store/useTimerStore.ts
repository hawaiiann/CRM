import { create } from "zustand"
import { useAppStore } from "./useAppStore"
import { useToastStore } from "./useToastStore"
import { saveData } from "@/lib/cloudSync"
import { recordActivityChanges } from "@/lib/activity"
import { parseHours } from "@/lib/money"
import { fmtMilestoneDuration } from "@/lib/money"
import { requestNotificationPermission, isPageBackground, sendSystemNotification } from "@/lib/notifications"

const TIMER_STATE_KEY = "design_crm_timer_state_v1"
const MILESTONE_STEP_MS = 30 * 60 * 1000

interface TimerState {
  id: string
  title: string
  elapsed: number
  segmentStart: number
  running: boolean
  start: number
  nextMilestoneMs: number
  onNavigateToOrder: ((orderId: string) => void) | null

  setOnNavigateToOrder: (fn: (orderId: string) => void) => void
  restore: () => void
  persist: () => void
  tick: () => void
  toggle: () => void
  reset: () => void
  startFor: (id: string, title: string) => void
  stop: () => void
  flushSegment: () => void
}

export const useTimerStore = create<TimerState>((set, get) => ({
  id: "standalone",
  title: "Свободный замер",
  elapsed: 0,
  segmentStart: 0,
  running: false,
  start: 0,
  nextMilestoneMs: MILESTONE_STEP_MS,
  onNavigateToOrder: null,

  setOnNavigateToOrder: (fn) => set({ onNavigateToOrder: fn }),

  persist: () => {
    const s = get()
    localStorage.setItem(TIMER_STATE_KEY, JSON.stringify({ id: s.id, title: s.title, elapsed: s.elapsed, segmentStart: s.segmentStart, nextMilestoneMs: s.nextMilestoneMs }))
  },

  // Restored ALWAYS paused, even if it was ticking when the tab closed — silently
  // resuming after an unknown gap (e.g. overnight) would rack up bogus hours.
  restore: () => {
    const raw = localStorage.getItem(TIMER_STATE_KEY)
    if (!raw) return
    try {
      const saved = JSON.parse(raw)
      if (!saved || !saved.id || !saved.elapsed) return
      set({
        id: saved.id,
        title: saved.title || "Свободный замер",
        elapsed: saved.elapsed,
        segmentStart: saved.segmentStart || 0,
        nextMilestoneMs: saved.nextMilestoneMs || MILESTONE_STEP_MS,
        running: false,
      })
    } catch (e) {
      console.error("Не удалось восстановить состояние таймера:", e)
    }
  },

  flushSegment: () => {
    const s = get()
    if (s.id === "standalone") return
    const app = useAppStore.getState()
    const order = app.orders.find((o) => o.id === s.id)
    if (!order) return
    const nowElapsed = s.running ? Date.now() - s.start : s.elapsed
    const segmentMs = nowElapsed - (s.segmentStart || 0)
    set({ segmentStart: nowElapsed })
    if (segmentMs <= 0) return

    const line = order.lines.find((l) => !l.ready) || order.lines[order.lines.length - 1]
    if (!line) return
    const before = JSON.parse(JSON.stringify(order))
    const addHours = segmentMs / 1000 / 3600
    const nextPomo = Math.round((parseHours(line.pomoHours) + addHours) * 10000) / 10000
    const nextOrder = { ...order, lines: order.lines.map((l) => (l.id === line.id ? { ...l, pomoHours: nextPomo } : l)) }
    const entry = recordActivityChanges(before, nextOrder)
    app.setOrders((prev) => prev.map((o) => (o.id === nextOrder.id ? nextOrder : o)))
    if (entry) app.setActivityLog((prev) => [...prev, entry])
  },

  tick: () => {
    const s = get()
    if (!s.running) return
    const elapsed = Date.now() - s.start
    set({ elapsed })
    const elapsedSec = Math.floor(elapsed / 1000)

    // Safety-net: sweep accumulated time into the order's active line every minute,
    // so it survives a reload/crash instead of living only in memory until "Готово".
    if (s.id !== "standalone" && elapsedSec > 0 && elapsedSec % 60 === 0) {
      get().flushSegment()
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
      if (s.id !== "standalone") requestNotificationPermission()
      set({ start: Date.now() - s.elapsed, running: true })
      get().tick()
    }
  },

  reset: () => {
    set({ running: false, elapsed: 0, segmentStart: 0, id: "standalone", title: "Свободный замер", nextMilestoneMs: MILESTONE_STEP_MS })
    localStorage.removeItem(TIMER_STATE_KEY)
  },

  startFor: (id, title) => {
    const s = get()
    if (s.id === id) {
      get().toggle()
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
}))
