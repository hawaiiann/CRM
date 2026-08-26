import { PackageOpen, ExternalLink, TriangleAlert } from "lucide-react"
import { Link } from "react-router-dom"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import type { Order } from "@/types/models"
import { fmtMoney, calculateLineTotal, orderPaymentState, isHourlyUnit, pluralizeRu } from "@/lib/money"
import { fmtDateRangeCompact, fmtDeadline } from "@/lib/dates"
import { useAppStore } from "@/store/useAppStore"
import { findLessonForOrder } from "@/lib/planningSync"
import { lessonItemsMissingInOrder } from "@/lib/planningOrderSync"

export function OrderDetailsSheet({
  order,
  onOpenChange,
  onEdit,
}: {
  order: Order | null
  onOpenChange: (open: boolean) => void
  onEdit: (order: Order) => void
}) {
  const pay = order ? orderPaymentState(order) : null

  // Связь с уроком была видна только из планирования: отсюда нельзя было ни
  // узнать, что заказ вообще чем-то управляет, ни сверить состав.
  const planningBoards = useAppStore((s) => s.planningBoards)
  const linked = order ? findLessonForOrder(planningBoards, order) : null
  const missingInOrder = order && linked ? lessonItemsMissingInOrder(linked.lesson, order) : []

  // Показываем только заполненные поля: пустые подписи в шапке лишь мешают.
  const facts = order
    ? ([
        ["Предмет", order.subject],
        ["Класс", order.grade],
        ["Четверть", order.quarter],
        ["Урок", order.lesson],
      ] as [string, string][])
        .filter(([, v]) => String(v || "").trim() !== "")
        .map(([label, value]) => ({ label, value }))
    : []

  return (
    <Sheet open={!!order} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[440px]">
        {order && pay && (
          <>
            <SheetHeader className="pr-10">
              <SheetTitle>{order.title || [order.subject, order.grade, order.lesson && `Урок ${order.lesson}`].filter(Boolean).join(", ")}</SheetTitle>
              <SheetDescription>
                {order.client} · сдача {fmtDeadline(order.deadline)}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-4.5 overflow-y-auto px-4">
              {/* Предмет, класс, четверть, урок. У заказа со своим названием
                  эти поля нигде не показывались — автосборка «Предмет, Класс,
                  Урок N» подставляется только когда название пустое, поэтому
                  приходилось открывать форму, чтобы узнать, что за урок. */}
              {facts.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {facts.map((f) => (
                    <span
                      key={f.label}
                      title={f.label}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-[12px]"
                    >
                      <span className="text-muted-foreground">{f.label}</span>
                      <b className="font-bold">{f.value}</b>
                    </span>
                  ))}
                </div>
              )}

              <div>
                <div className="mb-2 text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">
                  Позиции в заказе
                </div>
                {order.lines.length === 0 ? (
                  <div className="flex flex-col items-center gap-1.5 rounded-xl bg-muted py-7 text-center">
                    <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground">
                      <PackageOpen className="size-[18px]" strokeWidth={1.6} />
                    </div>
                    <div className="text-[13px] font-bold">Пока пусто</div>
                    <div className="max-w-[220px] text-xs text-muted-foreground">
                      Позиции ещё не добавлены — откройте редактирование заказа, чтобы внести первую.
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {order.lines.map((line) => (
                      <div
                        key={line.id}
                        className="flex items-center justify-between gap-2.5 rounded-xl bg-muted px-3.5 py-2.5"
                      >
                        <div>
                          <div className="text-[13px] font-bold">
                            {line.label}
                            {line.ignorePrice && " (без опл.)"}
                          </div>
                          <div className="text-[11.5px] text-muted-foreground">
                            {isHourlyUnit(line) ? `${line.pomoHours} ч × ${fmtMoney(line.rate)}` : `${line.qty} ${line.type} × ${fmtMoney(line.rate)}`}
                          </div>
                        </div>
                        <div className="shrink-0 text-[13px] font-bold">{fmtMoney(calculateLineTotal(line))}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Урок в планировании: куда уходят позиции этого заказа и что
                  из состава урока в заказ не попало. Расхождение здесь — это
                  работа, которая делается, но не посчитана. */}
              {linked && (
                <div>
                  <div className="mb-1.5 text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">
                    Урок в планировании
                  </div>
                  <div className="flex flex-col gap-2">
                    <Link
                      to="/planning"
                      onClick={() => onOpenChange(false)}
                      className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3.5 py-3 hover:bg-muted/70"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-bold">
                          {linked.lesson.title || `Урок ${linked.lesson.num}`}
                        </div>
                        <div className="truncate text-[11.5px] text-muted-foreground">
                          {[linked.board.subject, linked.board.title, linked.board.quarter].filter(Boolean).join(" · ")} ·{" "}
                          {linked.lesson.items.filter((i) => i.done).length}/{linked.lesson.items.length} выполнено
                        </div>
                      </div>
                      <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                    </Link>

                    {missingInOrder.length > 0 && (
                      <div className="flex gap-2 rounded-xl bg-warning px-3 py-2.5 text-warning-foreground">
                        <TriangleAlert className="mt-px size-3.5 shrink-0" />
                        <div className="text-[11.5px] leading-relaxed">
                          <b className="font-bold">Состав расходится с уроком.</b> В чек-листе урока{" "}
                          {missingInOrder.length}{" "}
                          {pluralizeRu(missingInOrder.length, "пункт", "пункта", "пунктов")}, которых нет в позициях
                          заказа: {missingInOrder.join(", ")}. Перенести их можно кнопкой «В заказ» в карточке урока.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl bg-muted px-3 py-2.5">
                  <div className="text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">
                    Сроки
                  </div>
                  <div className="mt-0.5 text-[12.5px] font-bold">{fmtDateRangeCompact(order.start, order.deadline)}</div>
                </div>
                <div className="rounded-xl bg-muted px-3 py-2.5">
                  <div className="text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">
                    Часы (план/факт)
                  </div>
                  <div className="mt-0.5 text-[12.5px] font-bold">
                    {order.estimatedHours || "—"} / {order.actualHours || "—"}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-muted px-4 py-3.5">
                <div className="text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">
                  Сумма позиций
                </div>
                <div className="font-heading mt-1 text-[25px] font-bold">{fmtMoney(pay.full)}</div>
                <div className="mt-2.5 flex justify-between border-t border-dashed border-border pt-2.5 text-[11.5px] text-muted-foreground">
                  <span>
                    Из аванса <b className="text-foreground">{fmtMoney(pay.advUsed)}</b>
                  </span>
                  <span>
                    К доплате{" "}
                    <b className="text-foreground">
                      {pay.remaining > 0 ? fmtMoney(pay.remaining) : `${fmtMoney(0)} — оплачено`}
                    </b>
                  </span>
                </div>
                {/* Заказ подешевел ниже уже учтённых денег (снизили цену, убрали
                    позицию) — «Из аванса» и «К доплате» выше молча обрезаны до
                    стоимости заказа. Деньги никуда не делись — просто перестали
                    умещаться в новую цену; поправить можно только в форме
                    редактирования (аванс, список платежей). */}
                {pay.overpaid > 0 && (
                  <div className="mt-2.5 flex gap-2 rounded-lg bg-warning px-3 py-2 text-warning-foreground">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    <div className="text-[11.5px] leading-relaxed">
                      <b className="font-bold">{fmtMoney(pay.overpaid)} не попадают в расчёт.</b> Аванс и платежи по заказу в сумме больше его стоимости — заказ подешевел уже после того, как деньги были учтены.
                    </div>
                  </div>
                )}
              </div>

              {order.notes && (
                <div>
                  <div className="mb-1.5 text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">
                    Заметка к заказу
                  </div>
                  <div className="text-[12.5px] leading-relaxed text-muted-foreground">{order.notes}</div>
                </div>
              )}
            </div>

            <SheetFooter>
              <Button
                onClick={() => onEdit(order)}
                className="w-full bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta"
              >
                Редактировать заказ
              </Button>
              <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
                Закрыть
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
