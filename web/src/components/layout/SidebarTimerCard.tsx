import { useEffect } from "react"
import { RotateCcw, Play, Pause, Square } from "lucide-react"
import { useTimerStore } from "@/store/useTimerStore"
import { cn } from "@/lib/utils"

const CYCLE_SECONDS = 3600 // ring makes one full lap per hour, then loops

function fmtTime(totalSeconds: number): string {
  const s = totalSeconds % 60
  const m = Math.floor(totalSeconds / 60) % 60
  const h = Math.floor(totalSeconds / 3600)
  return h > 0
    ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function SidebarTimerCard() {
  const { id, title, elapsed, running, toggle, reset, stop } = useTimerStore()
  const restore = useTimerStore((s) => s.restore)
  const tick = useTimerStore((s) => s.tick)

  useEffect(() => {
    restore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!running) return
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [running, tick])

  const elapsedSec = Math.floor(elapsed / 1000)
  const progress = (elapsedSec % CYCLE_SECONDS) / CYCLE_SECONDS

  return (
    <div className="rounded-2xl border border-sidebar-border bg-muted/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6.2" /><path d="M8 4.6V8.2L10.6 9.9" /></svg>
        Таймер
      </div>

      <div className="timer-display-accent relative mb-2.5 flex flex-col items-center justify-center overflow-hidden rounded-xl py-3.5">
        <div
          className="pointer-events-none absolute top-2 right-2 size-4 rounded-full"
          style={{ background: `conic-gradient(rgba(255,255,255,0.85) ${progress * 360}deg, rgba(255,255,255,0.15) ${progress * 360}deg)` }}
        />
        <div className="font-heading text-[26px] font-bold tabular-nums text-white">{fmtTime(elapsedSec)}</div>
        <div className={cn("mt-0.5 max-w-[160px] truncate text-[11px] font-semibold", id === "standalone" ? "text-white/50" : "text-white/80")}>{title}</div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <TimerBtn title="Сбросить" onClick={reset}><RotateCcw className="size-3.5" /></TimerBtn>
        <button
          type="button"
          title="Старт/Пауза"
          onClick={toggle}
          className="flex h-[42px] items-center justify-center rounded-lg bg-emphasis/90 text-emphasis-foreground"
        >
          {running ? <Pause className="size-4.5" fill="currentColor" /> : <Play className="size-4.5 translate-x-0.5" fill="currentColor" />}
        </button>
        <TimerBtn title="Завершить" onClick={stop}><Square className="size-3" fill="currentColor" /></TimerBtn>
      </div>
    </div>
  )
}

function TimerBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} onClick={onClick} className="flex h-[42px] items-center justify-center rounded-lg border border-sidebar-border text-muted-foreground hover:bg-sidebar-accent">
      {children}
    </button>
  )
}
