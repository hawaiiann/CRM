import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Уведомление внизу сайдбара: одна строка с иконкой, подробности и кнопки
 * раскрываются по клику. Раньше каждое предупреждение было развёрнутой
 * плашкой с текстом в четыре строки, и с двумя-тремя сразу низ сайдбара
 * превращался в склад.
 *
 * Тон: notice — «надо бы сделать» (серо-синий, не спорит со статусом
 * «в работе»), danger — «данные не сохраняются» (мягкий красный, читаемый и
 * в тёмной теме).
 */
export function SidebarNotice({
  tone,
  icon: Icon,
  title,
  defaultOpen = false,
  children,
}: {
  tone: "notice" | "danger"
  icon: typeof ChevronDown
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      className={cn(
        "mb-1.5 rounded-lg text-2xs",
        tone === "danger" ? "bg-danger-soft text-danger-soft-foreground" : "bg-notice text-notice-foreground"
      )}
    >
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-bold">
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDown className={cn("size-3 shrink-0 opacity-70 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="px-2.5 pb-2 pl-7 opacity-90">{children}</div>}
    </div>
  )
}

/** Кнопка внутри уведомления: рамка в цвет текста, без своей заливки. */
export function SidebarNoticeButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-1.5 rounded-md border border-current/30 px-2 py-0.5 font-bold hover:bg-current/10 disabled:opacity-60"
    >
      {children}
    </button>
  )
}
