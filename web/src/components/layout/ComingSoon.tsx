import { PageHeader } from "./AppShell"
import type { LucideIcon } from "lucide-react"

export function ComingSoon({
  title,
  subtitle,
  icon: Icon,
  note,
}: {
  title: string
  subtitle: string
  icon: LucideIcon
  note: string
}) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/50 py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" strokeWidth={1.6} />
        </div>
        <div className="text-[14px] font-bold">Этот экран ещё не перенесён</div>
        <div className="max-w-[360px] text-[12.5px] text-muted-foreground">{note}</div>
      </div>
    </div>
  )
}
