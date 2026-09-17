import { ExternalLink } from "lucide-react"
import { splitLinks, linkLabel } from "@/lib/links"
import { cn } from "@/lib/utils"

/**
 * Текст, в котором адреса стали короткими кликабельными чипами.
 * Открывается в новой вкладке; клик по ссылке не всплывает, чтобы не
 * срабатывали обработчики строки (редактирование, отметка).
 */
export function Linkified({ text, className }: { text: string; className?: string }) {
  const parts = splitLinks(text)
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.kind === "link" ? (
          <a
            key={i}
            href={p.value}
            target="_blank"
            rel="noopener noreferrer"
            title={p.value}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md bg-overlay/10 px-1.5 py-px align-baseline text-xs font-bold text-foreground/85 no-underline hover:bg-overlay/20"
            )}
          >
            <ExternalLink className="size-3 shrink-0" />
            <span className="truncate">{linkLabel(p.value)}</span>
          </a>
        ) : (
          <span key={i}>{p.value}</span>
        )
      )}
    </span>
  )
}
