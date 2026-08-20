import { Clock } from "lucide-react"
import { useToastStore } from "@/store/useToastStore"
import { useThemeStore } from "@/store/useThemeStore"
import { cn } from "@/lib/utils"

export function ToastRoot() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)
  const isDark = useThemeStore((s) => s.mode === "dark")

  if (!toasts.length) return null

  return (
    <div className={cn("fixed right-5 bottom-5 z-[100] flex flex-col gap-2 text-foreground", isDark && "dark")}>
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => { t.onClick?.(); removeToast(t.id) }}
          className={cn(
            "glass-surface flex w-[280px] items-start gap-2.5 rounded-xl p-3 text-left",
            t.danger && "border-destructive/40"
          )}
        >
          <div className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", t.danger ? "bg-destructive/10 text-destructive" : "bg-overlay/10 text-foreground")}>
            <Clock className="size-3.5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-bold">{t.title}</div>
            <div className="truncate text-[11.5px] text-muted-foreground">{t.sub}</div>
          </div>
        </button>
      ))}
    </div>
  )
}
