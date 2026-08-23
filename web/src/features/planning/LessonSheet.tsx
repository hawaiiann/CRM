import { useState, type KeyboardEvent } from "react"
import { Check, Trash2, RotateCcw, ArrowRight, ExternalLink } from "lucide-react"
import { Link } from "react-router-dom"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useAppStore } from "@/store/useAppStore"
import { fmtMoney, orderTotal } from "@/lib/money"
import { saveData, deleteFromCloud } from "@/lib/cloudSync"
import { findGoverningOrder } from "@/lib/planningSync"
import {
  lessonItemsMissingInOrder,
  orderLinesMissingInLesson,
  addLessonItemsToOrderLines,
  addOrderLinesToLessonItems,
} from "@/lib/planningOrderSync"
import { getVisibleCatalog } from "@/lib/catalog"
import { cn } from "@/lib/utils"
import type { PlanningBoard, PlanningLesson } from "@/types/models"

const COLORS: { key: string; label: string; className: string }[] = [
  { key: "gray", label: "Неактив", className: "bg-neutral-tone text-neutral-tone-foreground" },
  { key: "yellow", label: "В работе", className: "bg-warning text-warning-foreground" },
  { key: "green-3", label: "Готово", className: "bg-success text-success-foreground" },
  { key: "red", label: "Срочно", className: "bg-destructive text-white" },
]

const STATUS_LABEL: Record<string, string> = { queue: "В очереди", progress: "В работе", review: "На согласовании", done: "Завершён", cancelled: "Отменён" }

function randId(prefix: string) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function orderTitle(o: { title?: string; subject?: string; grade?: string; quarter?: string; lesson?: string }): string {
  return o.title || [o.subject, o.grade, o.quarter, o.lesson && `Урок ${o.lesson}`].filter(Boolean).join(", ") || "Без названия"
}

export function LessonSheet({
  board,
  lesson,
  onOpenChange,
}: {
  board: PlanningBoard | null
  lesson: PlanningLesson | null
  onOpenChange: (open: boolean) => void
}) {
  const orders = useAppStore((s) => s.orders)
  const setPlanningBoards = useAppStore((s) => s.setPlanningBoards)
  const setOrders = useAppStore((s) => s.setOrders)
  const appSettings = useAppStore((s) => s.appSettings)
  const [newItem, setNewItem] = useState("")

  // Always read the live lesson from the store so edits reflect immediately.
  const liveBoard = useAppStore((s) => s.planningBoards.find((b) => b.id === board?.id)) || board
  const liveLesson = liveBoard?.lessons.find((l) => l.id === lesson?.id) || lesson

  function updateLesson(patch: Partial<PlanningLesson>) {
    if (!liveBoard || !liveLesson) return
    setPlanningBoards((prev) =>
      prev.map((b) => (b.id !== liveBoard.id ? b : { ...b, lessons: b.lessons.map((l) => (l.id === liveLesson.id ? { ...l, ...patch } : l)) }))
    )
    saveData()
  }

  function setColor(color: string) {
    updateLesson({ color, colorLocked: true })
  }
  function resetColorLock() {
    updateLesson({ colorLocked: false })
  }

  function addItem() {
    const val = newItem.trim()
    if (!val || !liveLesson) return
    updateLesson({ items: [...(liveLesson.items || []), { id: randId("i"), text: val, done: false }] })
    setNewItem("")
  }
  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); addItem() }
  }
  function toggleItem(id: string) {
    if (!liveLesson) return
    const items = (liveLesson.items || []).map((i) => (i.id === id ? { ...i, done: !i.done } : i))
    updateLesson({ items })
  }
  function deleteItem(id: string) {
    if (!liveLesson) return
    updateLesson({ items: (liveLesson.items || []).filter((i) => i.id !== id) })
  }

  function deleteLesson() {
    if (!liveBoard || !liveLesson) return
    if (!confirm("Удалить этот урок?")) return
    setPlanningBoards((prev) =>
      prev.map((b) => (b.id !== liveBoard.id ? b : { ...b, lessons: b.lessons.filter((l) => l.id !== liveLesson.id) }))
    )
    deleteFromCloud("planning_lessons", liveLesson.id)
    saveData()
    onOpenChange(false)
  }

  const governingOrder = liveBoard && liveLesson ? findGoverningOrder(orders, liveBoard, liveLesson) : null

  const toOrder = governingOrder && liveLesson ? lessonItemsMissingInOrder(liveLesson, governingOrder) : []
  const toLesson = governingOrder && liveLesson ? orderLinesMissingInLesson(governingOrder, liveLesson) : []

  function pushToOrder() {
    if (!governingOrder || !liveLesson || !toOrder.length) return
    const unit = getVisibleCatalog(appSettings, "units")[0] || "Слайд"
    const lines = addLessonItemsToOrderLines(governingOrder, liveLesson, { unit }, () => randId("l"))
    setOrders((prev) => prev.map((o) => (o.id === governingOrder.id ? { ...o, lines } : o)))
    saveData()
  }

  function pullFromOrder() {
    if (!governingOrder || !liveLesson || !toLesson.length) return
    updateLesson({ items: addOrderLinesToLessonItems(governingOrder, liveLesson, () => randId("i")) })
  }
  const items = liveLesson?.items || []
  const doneCount = items.filter((i) => i.done).length

  return (
    <Sheet open={!!lesson} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[440px]">
        {liveBoard && liveLesson && (
          <>
            <SheetHeader className="pr-10">
              <div className="flex items-start justify-between gap-2">
                <SheetTitle>
                  {liveBoard.subject ? liveBoard.subject + " · " : ""}{liveBoard.title} {liveBoard.quarter ? "· " + liveBoard.quarter : ""} — Урок {liveLesson.num}
                </SheetTitle>
                <button
                  type="button"
                  title="Удалить урок"
                  onClick={deleteLesson}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <SheetDescription>{doneCount}/{items.length} пунктов выполнено</SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">Статус / цвет ячейки</span>
                  {liveLesson.colorLocked && (
                    <button type="button" onClick={resetColorLock} className="flex items-center gap-1 text-[11px] font-bold text-foreground">
                      <RotateCcw className="size-3" />Сделать автоматическим
                    </button>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {COLORS.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setColor(c.key)}
                      className={cn(
                        "flex-1 rounded-full py-1.5 text-[11px] font-bold",
                        liveLesson.color === c.key || (c.key === "green-3" && (liveLesson.color || "").startsWith("green")) ? c.className : "bg-muted text-muted-foreground"
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-muted-foreground">
                    {liveLesson.colorLocked
                      ? "Цвет закреплён вручную — не пересчитывается автоматически."
                      : governingOrder
                        ? `По статусу заказа «${governingOrder.title || "заказ"}» — ${STATUS_LABEL[governingOrder.status] || governingOrder.status}.`
                        : `По чек-листу: ${doneCount} из ${items.length}.`}
                  </div>
                  {governingOrder && (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-foreground">
                      Заказ <ArrowRight className="size-3" />
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-full bg-muted px-3.5 py-2">
                <span className="text-[12px] font-bold text-muted-foreground">Порядковый номер урока</span>
                <input
                  type="number"
                  value={liveLesson.num}
                  onChange={(e) => updateLesson({ num: parseInt(e.target.value) || 1 })}
                  className="w-16 rounded-full border border-border bg-background px-2 py-1 text-center text-[12.5px] font-bold outline-none"
                />
              </div>

              <div>
                <Input
                  value={liveLesson.title}
                  onChange={(e) => updateLesson({ title: e.target.value })}
                  placeholder="Название урока..."
                  className="mb-2.5 font-bold"
                />
                <div className="flex flex-col gap-1.5">
                  {items.map((item) => (
                    <div key={item.id} className={cn("flex items-center gap-2 rounded-lg px-2.5 py-1.5", item.done ? "bg-success/15" : "bg-muted")}>
                      <button type="button" onClick={() => toggleItem(item.id)} className={cn("flex size-4.5 shrink-0 items-center justify-center rounded-md border", item.done ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                        {item.done && <Check className="size-3" strokeWidth={3} />}
                      </button>
                      <span className={cn("flex-1 text-[13px]", item.done && "text-muted-foreground line-through")}>{item.text}</span>
                      <button type="button" onClick={() => deleteItem(item.id)}><Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" /></button>
                    </div>
                  ))}
                  {items.length === 0 && <div className="text-[12px] text-muted-foreground">Состав урока пуст</div>}
                </div>
                <Input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Состав урока (Enter)..."
                  className="mt-2"
                />
              </div>

              <div>
                <div className="mb-1.5 text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">Заметки к уроку</div>
                <Textarea value={liveLesson.notes} onChange={(e) => updateLesson({ notes: e.target.value })} placeholder="Идеи, правки, ссылки на материалы..." rows={3} />
              </div>

              {/* Связь с заказом. Раньше её не было видно вовсе: заказ мог быть
                  привязан к уроку (явно или по совпадению предмета/класса/
                  четверти/номера), но из урока об этом узнать было нельзя и
                  перейти к заказу тоже. */}
              <div>
                <div className="mb-1.5 text-[10.5px] font-extrabold tracking-wide text-muted-foreground uppercase">Заказ</div>
                {governingOrder ? (
                  <div className="flex flex-col gap-2">
                    <Link
                      to="/orders"
                      onClick={() => onOpenChange(false)}
                      className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3.5 py-3 hover:bg-muted/70"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-bold">{orderTitle(governingOrder)}</div>
                        <div className="truncate text-[11.5px] text-muted-foreground">
                          {governingOrder.client || "без клиента"} · {fmtMoney(orderTotal(governingOrder))}
                        </div>
                      </div>
                      <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                    </Link>

                    {/* Ручное пополнение в обе стороны. Автоматически работает
                        только «заказ → урок», поэтому набранный в планировании
                        состав в заказ раньше не попадал вовсе. */}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={toOrder.length === 0}
                        onClick={pushToOrder}
                        className="flex-1 rounded-lg bg-muted px-3 py-2 text-[12px] font-bold hover:bg-muted/70 disabled:opacity-40"
                        title={toOrder.length ? `Добавит в заказ: ${toOrder.join(", ")}` : "В заказе уже есть всё из чек-листа"}
                      >
                        В заказ{toOrder.length > 0 && ` (${toOrder.length})`}
                      </button>
                      <button
                        type="button"
                        disabled={toLesson.length === 0}
                        onClick={pullFromOrder}
                        className="flex-1 rounded-lg bg-muted px-3 py-2 text-[12px] font-bold hover:bg-muted/70 disabled:opacity-40"
                        title={toLesson.length ? `Добавит в урок: ${toLesson.join(", ")}` : "В чек-листе уже есть все позиции заказа"}
                      >
                        В урок{toLesson.length > 0 && ` (${toLesson.length})`}
                      </button>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Цену и количество новых позиций заказа проставьте сами — их не угадать.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-muted px-3.5 py-3">
                    <div className="text-[12.5px] text-muted-foreground">
                      К этому уроку не привязан ни один заказ.
                    </div>
                    <div className="mt-1 text-[11.5px] text-muted-foreground">
                      Состав урока в заказ не переносится сам — заказ создаётся отдельно, а привязывается полем
                      «Привязать к уроку» в его форме либо совпадением предмета, класса, четверти и номера урока.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
