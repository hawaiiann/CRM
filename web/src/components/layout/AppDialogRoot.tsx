import { useEffect, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useDialogStore } from "@/store/useDialogStore"

/**
 * Показывает подтверждения и сообщения из useDialogStore — то, что раньше
 * делали системные confirm() и alert().
 *
 * Показывает по одному: очередь нужна на случай, когда сообщение приходит из
 * фонового кода (автобэкап, синхронизация) в тот момент, когда на экране уже
 * висит вопрос. Системные окна в такой ситуации молча блокировали друг друга.
 */
export function AppDialogRoot() {
  const current = useDialogStore((s) => s.queue[0])
  const settle = useDialogStore((s) => s.settle)
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Фокус на кнопке подтверждения — как в системном окне, где Enter отвечал
  // «да». У опасных действий фокус не ставим: подтверждать удаление вслепую
  // нажатым Enter'ом никто не должен.
  useEffect(() => {
    if (current && !current.destructive) confirmRef.current?.focus()
  }, [current])

  if (!current) return null

  const isConfirm = current.kind === "confirm"

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Закрытие крестиком, Esc или кликом мимо — это отказ. Для сообщения
        // отказываться не от чего, поэтому просто закрываем.
        if (!open) settle(current.id, false)
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          {current.body && (
            <DialogDescription className="whitespace-pre-line">{current.body}</DialogDescription>
          )}
        </DialogHeader>

        {current.bullets && current.bullets.length > 0 && (
          <ul className="flex flex-col gap-1.5 rounded-xl bg-muted px-3.5 py-3 text-[12.5px] leading-relaxed">
            {current.bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        {current.note && <div className="text-[12px] text-muted-foreground">{current.note}</div>}

        <DialogFooter>
          {isConfirm && (
            <Button type="button" variant="outline" onClick={() => settle(current.id, false)}>
              {current.cancelLabel || "Отмена"}
            </Button>
          )}
          <Button
            ref={confirmRef}
            type="button"
            variant={current.destructive ? "destructive" : "default"}
            className={current.destructive ? undefined : "bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta"}
            onClick={() => settle(current.id, true)}
          >
            {current.confirmLabel || (isConfirm ? "Подтвердить" : "Понятно")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
