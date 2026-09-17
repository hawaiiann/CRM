import { useEffect, useState } from "react"
import { Plus, Trash2, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NumberInput } from "@/components/ui/number-input"
import { ComboInput } from "@/components/ui/combo-input"
import { Label } from "@/components/ui/label"
import { getVisibleCatalog, catalogWithCurrent } from "@/lib/catalog"
import { useAppStore } from "@/store/useAppStore"
import { saveData, deleteFromCloud } from "@/lib/cloudSync"
import { unlinkOrdersFromLessons } from "@/lib/planningOrderSync"
import { boardTemplateLines } from "@/lib/boardTemplate"
import type { PlanningBoard, PlanningLesson, OrderTemplateLine } from "@/types/models"

function randId(prefix: string) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function BoardFormDialog({
  open,
  board,
  onOpenChange,
}: {
  open: boolean
  board: PlanningBoard | null
  onOpenChange: (open: boolean) => void
}) {
  const appSettings = useAppStore((s) => s.appSettings)
  const setAppSettings = useAppStore((s) => s.setAppSettings)
  const setPlanningBoards = useAppStore((s) => s.setPlanningBoards)
  const setOrders = useAppStore((s) => s.setOrders)
  const orders = useAppStore((s) => s.orders)
  const defaultUnit = getVisibleCatalog(appSettings, "units")[0] || "Слайд"

  const [subject, setSubject] = useState("")
  const [title, setTitle] = useState("")
  const [quarter, setQuarter] = useState("")
  const [deadline, setDeadline] = useState("")
  const [lessonNums, setLessonNums] = useState<number[]>([])
  const [rangeFrom, setRangeFrom] = useState(1)
  const [rangeTo, setRangeTo] = useState(24)
  // Состав урока со ставками: то же, что раньше было списком названий, но с
  // единицей, количеством и ставкой — по нему заказ из урока получает цены.
  type TplRow = OrderTemplateLine & { id: string }
  const [template, setTemplate] = useState<TplRow[]>([])
  const row = (l: Partial<OrderTemplateLine>): TplRow => ({ id: randId("tr"), label: l.label || "", type: l.type || defaultUnit, qty: l.qty ?? 1, rate: l.rate ?? 0 })
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    if (board) {
      const nums = board.lessons.map((l) => l.num).sort((a, b) => a - b)
      setSubject(board.subject || "")
      setTitle(board.title || "")
      setQuarter(board.quarter || "")
      setDeadline(board.deadline || "")
      setLessonNums(nums)
      setRangeFrom((nums[nums.length - 1] || 0) + 1)
      setRangeTo((nums[nums.length - 1] || 0) + 8)
      const lines = boardTemplateLines(appSettings, board, orders, defaultUnit)
      setTemplate(lines.length ? lines.map(row) : [row({ label: "Презентация", qty: 10 }), row({ label: "Рабочий лист" })])
    } else {
      setSubject(getVisibleCatalog(appSettings, "subjects")[0] || "Математика")
      setTitle(getVisibleCatalog(appSettings, "classes")[0] || "5 класс")
      setQuarter("1 четверть")
      setDeadline("")
      setLessonNums(Array.from({ length: 24 }, (_, i) => i + 1))
      setRangeFrom(25)
      setRangeTo(32)
      setTemplate([row({ label: "Презентация", qty: 10 }), row({ label: "Рабочий лист" })])
    }
    // Зависим от конкретных справочников, а не от appSettings целиком, и это
    // намеренно: эффект заполняет форму значениями по умолчанию, и перезапуск
    // от любой правки настроек затёр бы то, что человек уже набрал.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, board, appSettings.subjects, appSettings.classes])

  function addRange() {
    const from = Math.max(1, Math.min(rangeFrom, rangeTo))
    const to = Math.max(rangeFrom, rangeTo)
    const nums = new Set(lessonNums)
    for (let n = from; n <= to; n++) nums.add(n)
    setLessonNums([...nums].sort((a, b) => a - b))
  }
  function removeLessonNum(n: number) {
    setLessonNums((prev) => prev.filter((x) => x !== n))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Подсказка в форме, а не системным окном: сказать надо про конкретное
    // поле, и человек должен видеть его, пока читает.
    if (lessonNums.length === 0) {
      setError("Добавьте хотя бы один урок — укажите диапазон и нажмите «Добавить диапазон».")
      return
    }
    setError("")
    const templateLines: OrderTemplateLine[] = template
      .filter((t) => t.label.trim())
      .map((t) => ({ label: t.label.trim(), type: (t.type || defaultUnit).trim(), qty: t.qty || 1, rate: t.rate || 0 }))
    const templateItems = templateLines.map((t) => t.label)
    const boardId = board ? board.id : randId("pb")

    const nextSettings = { ...appSettings, boardTemplates: { ...appSettings.boardTemplates, [boardId]: templateLines } }
    let changed = JSON.stringify(appSettings.boardTemplates?.[boardId] || []) !== JSON.stringify(templateLines)
    if (subject && !nextSettings.subjects.includes(subject)) { nextSettings.subjects = [...nextSettings.subjects, subject]; changed = true }
    if (title && !nextSettings.classes.includes(title)) { nextSettings.classes = [...nextSettings.classes, title]; changed = true }
    if (changed) setAppSettings(nextSettings)

    if (board) {
      setPlanningBoards((prev) =>
        prev.map((b) => {
          if (b.id !== board.id) return b
          const oldTemplate = b.baseTemplate || []
          const removedItems = oldTemplate.filter((old) => !templateItems.some((t) => t.toLowerCase() === old.toLowerCase()))
          // Точечный diff по номерам уроков: уроки, чей номер остался в lessonNums,
          // сохраняют id/прогресс; убранные номера удаляются; новые номера создаются с нуля.
          const keepSet = new Set(lessonNums)
          const removedLessons = b.lessons.filter((l) => !keepSet.has(l.num))
          // Раньше отсюда уроки убирались только из локального состояния —
          // строка в облаке оставалась навсегда и при следующей синхронизации
          // приезжала обратно. Убранная кнопкой в LessonSheet карточка урока
          // так не терялась (там deleteFromCloud вызывался), а вот сокращённый
          // здесь диапазон — терялся.
          removedLessons.forEach((l) => deleteFromCloud("planning_lessons", l.id))
          if (removedLessons.length) setOrders((prev) => unlinkOrdersFromLessons(prev, removedLessons.map((l) => l.id)))
          let lessons = b.lessons.filter((l) => keepSet.has(l.num))
          const existingNums = new Set(lessons.map((l) => l.num))
          const addedNums = lessonNums.filter((n) => !existingNums.has(n))
          const added: PlanningLesson[] = addedNums.map((n) => ({
            id: randId("l"), num: n, title: `Урок ${n}`, color: "gray",
            items: templateItems.map((t) => ({ id: randId("i"), text: t, done: false })), colorLocked: false, orderLinked: false, notes: "",
          }))
          lessons = [...lessons, ...added].sort((a, c) => a.num - c.num)
          lessons = lessons.map((l) => {
            let items = (l.items || []).filter((item) => !removedItems.some((rem) => rem.toLowerCase() === item.text.trim().toLowerCase()))
            templateItems.forEach((t) => {
              if (!items.some((item) => item.text.trim().toLowerCase() === t.toLowerCase())) items = [...items, { id: randId("i"), text: t, done: false }]
            })
            return { ...l, items }
          })
          return { ...b, subject, title, quarter, deadline, baseTemplate: templateItems, lessons }
        })
      )
    } else {
      const lessons: PlanningLesson[] = lessonNums.map((n) => ({
        id: randId("l"), num: n, title: `Урок ${n}`, color: "gray",
        items: templateItems.map((t) => ({ id: randId("i"), text: t, done: false })), colorLocked: false, orderLinked: false, notes: "",
      }))
      const newBoard: PlanningBoard = { id: boardId, subject, title, quarter, deadline, baseTemplate: templateItems, collapsed: false, archived: false, lessons }
      setPlanningBoards((prev) => [...prev, newBoard])
    }

    saveData()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{board ? "Редактировать класс" : "Добавить новый класс"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Предмет">
              <ComboInput value={subject} onChange={setSubject} options={catalogWithCurrent(appSettings, "subjects", subject)} />
            </Field>
            <Field label="Класс">
              <ComboInput value={title} onChange={setTitle} options={catalogWithCurrent(appSettings, "classes", title)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Четверть">
              <Input value={quarter} onChange={(e) => setQuarter(e.target.value)} placeholder="1 четверть" />
            </Field>
            <Field label="Дедлайн класса">
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
          </div>

          <div>
            <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Уроки класса</Label>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">От</span>
                <Input type="number" min={1} value={rangeFrom} onChange={(e) => setRangeFrom(parseInt(e.target.value) || 1)} className="w-20" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">До</span>
                <Input type="number" min={1} value={rangeTo} onChange={(e) => setRangeTo(parseInt(e.target.value) || 1)} className="w-20" />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addRange}>
                <Plus />Добавить диапазон
              </Button>
            </div>

            {lessonNums.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {lessonNums.map((n) => (
                  <span key={n} className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pr-1 pl-2.5 text-[12px] font-bold">
                    {n}
                    <button type="button" onClick={() => removeLessonNum(n)} className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              {lessonNums.length} {lessonNums.length === 1 ? "урок" : "уроков"} в классе. Уже существующие уроки сохранят прогресс, если их номер остаётся в списке — уберите крестиком только те, что нужно удалить.
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Состав урока и ставки</Label>
            <div className="mb-1.5 hidden grid-cols-[1.4fr_1fr_70px_90px_28px] gap-1.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase sm:grid">
              <span>Материал</span><span>Ед. изм.</span><span>Кол-во</span><span>Ставка, ₽</span><span />
            </div>
            <div className="flex flex-col gap-1.5">
              {template.map((t) => {
                const patch = (p: Partial<OrderTemplateLine>) => setTemplate((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...p } : x)))
                return (
                  <div key={t.id} className="grid grid-cols-2 gap-1.5 sm:grid-cols-[1.4fr_1fr_70px_90px_28px]">
                    <ComboInput className="col-span-2 sm:col-span-1" value={t.label} onChange={(v) => patch({ label: v })} options={catalogWithCurrent(appSettings, "types", t.label)} placeholder="Тип работы..." />
                    <ComboInput value={t.type} onChange={(v) => patch({ type: v })} options={catalogWithCurrent(appSettings, "units", t.type)} placeholder="Ед. изм." />
                    <NumberInput value={t.qty} onChange={(n) => patch({ qty: n })} placeholder="1" />
                    <NumberInput value={t.rate} onChange={(n) => patch({ rate: n })} placeholder="0" />
                    <Button type="button" variant="ghost" size="icon-sm" className="col-span-2 justify-self-end sm:col-span-1" onClick={() => setTemplate((prev) => prev.filter((x) => x.id !== t.id))}>
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </div>
                )
              })}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setTemplate((prev) => [...prev, row({})])}>
              <Plus />Добавить материал
            </Button>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              По этим ставкам заказ из урока создаётся в один клик, уже с ценами. Ставки можно поправить в самом заказе.
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] font-bold text-destructive">{error}</div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">Сохранить</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">{label}</Label>
      {children}
    </div>
  )
}
