import { useEffect, useMemo, useState } from "react"
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
import type { AppSettings, PlanningBoard, PlanningLesson, OrderTemplateLine } from "@/types/models"
import { defaultFirstWeekLessons, weekdayIndex, weekdayLabel, weekLabel } from "@/lib/boardSchedule"
import { dateKey, addDays } from "@/lib/money"

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
  // График: уроков в неделю и дата старта — по ним сетка раскладывается по
  // неделям и видно отставание. Ссылка на материалы — папка класса на диске.
  const [perWeek, setPerWeek] = useState(0)
  const [startDate, setStartDate] = useState("")
  const [materialsLink, setMaterialsLink] = useState("")
  // Уроки класса = существующие уроки доски + диапазон «от … до», минус те,
  // что убраны крестиком. Диапазон применяется сразу при вводе: раньше он
  // добавлялся только кнопкой, и «от 1 до 39» без нажатия молча оставлял 24.
  const [existingNums, setExistingNums] = useState<number[]>([])
  const [rangeFrom, setRangeFrom] = useState(1)
  const [rangeTo, setRangeTo] = useState(24)
  const [removedNums, setRemovedNums] = useState<Set<number>>(new Set())
  const lessonNums = useMemo(() => {
    const from = Math.max(1, Math.min(rangeFrom, rangeTo))
    const to = Math.min(Math.max(rangeFrom, rangeTo), 500)
    const nums = new Set(existingNums)
    for (let n = from; n <= to; n++) nums.add(n)
    removedNums.forEach((n) => nums.delete(n))
    return [...nums].sort((a, b) => a - b)
  }, [existingNums, rangeFrom, rangeTo, removedNums])
  // График: первая неделя может быть неполной (старт в среду), исключения —
  // каникулы и короткие недели. 0 в «уроков в первой неделе» — авто.
  const [firstWeekLessons, setFirstWeekLessons] = useState(0)
  const [exceptions, setExceptions] = useState<{ id: string; week: number; lessons: number }[]>([])
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
      const sched = appSettings.boardSchedules?.[board.id]
      setPerWeek(sched?.perWeek || 0)
      setStartDate(sched?.start || "")
      setFirstWeekLessons(sched?.firstWeekLessons || 0)
      setExceptions(Object.entries(sched?.exceptions || {}).map(([w, n]) => ({ id: randId("ex"), week: parseInt(w, 10), lessons: n })).sort((a, b) => a.week - b.week))
      setMaterialsLink(appSettings.boardLinks?.[board.id] || "")
      setExistingNums(nums)
      setRemovedNums(new Set())
      setRangeFrom(nums[0] || 1)
      setRangeTo(nums[nums.length - 1] || 1)
      const lines = boardTemplateLines(appSettings, board, orders, defaultUnit)
      setTemplate(lines.length ? lines.map(row) : [row({ label: "Презентация", qty: 10 }), row({ label: "Рабочий лист" })])
    } else {
      setSubject(getVisibleCatalog(appSettings, "subjects")[0] || "Математика")
      setTitle(getVisibleCatalog(appSettings, "classes")[0] || "5 класс")
      setQuarter("1 четверть")
      setDeadline("")
      setPerWeek(0)
      setStartDate("")
      setFirstWeekLessons(0)
      setExceptions([])
      setMaterialsLink("")
      setExistingNums([])
      setRemovedNums(new Set())
      setRangeFrom(1)
      setRangeTo(24)
      setTemplate([row({ label: "Презентация", qty: 10 }), row({ label: "Рабочий лист" })])
    }
    // Зависим от конкретных справочников, а не от appSettings целиком, и это
    // намеренно: эффект заполняет форму значениями по умолчанию, и перезапуск
    // от любой правки настроек затёр бы то, что человек уже набрал.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, board, appSettings.subjects, appSettings.classes])

  function removeLessonNum(n: number) {
    setRemovedNums((prev) => new Set([...prev, n]))
  }

  const scheduleDraft = perWeek > 0 && startDate ? { start: startDate, perWeek: Math.floor(perWeek) } : null
  const autoFirstWeek = scheduleDraft ? defaultFirstWeekLessons(scheduleDraft.start, scheduleDraft.perWeek) : 0
  const firstWeekEnd = scheduleDraft ? dateKey(addDays(new Date(scheduleDraft.start + "T00:00:00"), 6 - weekdayIndex(scheduleDraft.start))) : ""

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Подсказка в форме, а не системным окном: сказать надо про конкретное
    // поле, и человек должен видеть его, пока читает.
    if (lessonNums.length === 0) {
      setError("Добавьте хотя бы один урок — укажите диапазон «от … до».")
      return
    }
    setError("")
    const templateLines: OrderTemplateLine[] = template
      .filter((t) => t.label.trim())
      .map((t) => ({ label: t.label.trim(), type: (t.type || defaultUnit).trim(), qty: t.qty || 1, rate: t.rate || 0 }))
    const templateItems = templateLines.map((t) => t.label)
    const boardId = board ? board.id : randId("pb")

    const nextSettings = {
      ...appSettings,
      boardTemplates: { ...appSettings.boardTemplates, [boardId]: templateLines },
      boardSchedules: { ...(appSettings.boardSchedules || {}) },
      boardLinks: { ...(appSettings.boardLinks || {}) },
    }
    if (scheduleDraft) {
      const sched: AppSettings["boardSchedules"][string] = { ...scheduleDraft }
      if (firstWeekLessons > 0) sched.firstWeekLessons = Math.floor(firstWeekLessons)
      const ex: Record<string, number> = {}
      exceptions.filter((x) => x.week >= 1).forEach((x) => { ex[String(Math.floor(x.week))] = Math.max(0, Math.floor(x.lessons)) })
      if (Object.keys(ex).length) sched.exceptions = ex
      nextSettings.boardSchedules[boardId] = sched
    } else delete nextSettings.boardSchedules[boardId]
    if (materialsLink.trim()) nextSettings.boardLinks[boardId] = materialsLink.trim()
    else delete nextSettings.boardLinks[boardId]
    let changed = JSON.stringify(appSettings.boardTemplates?.[boardId] || []) !== JSON.stringify(templateLines)
      || JSON.stringify(appSettings.boardSchedules?.[boardId] || null) !== JSON.stringify(nextSettings.boardSchedules[boardId] || null)
      || (appSettings.boardLinks?.[boardId] || "") !== (nextSettings.boardLinks[boardId] || "")
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
            <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">График (по КТП)</Label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[120px_1fr_130px]">
              <Field label="Уроков в неделю">
                <NumberInput value={perWeek} onChange={setPerWeek} inputMode="numeric" placeholder="0" />
              </Field>
              <Field label="Первый учебный день">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label="В 1-й неделе">
                <NumberInput value={firstWeekLessons} onChange={setFirstWeekLessons} inputMode="numeric" placeholder={scheduleDraft ? `авто: ${autoFirstWeek}` : "авто"} title="Сколько уроков в первой, неполной неделе. 0 — посчитать по учебным дням." />
              </Field>
            </div>
            <div className="mt-1.5 text-2xs text-muted-foreground">
              {scheduleDraft ? (
                <>
                  Недели считаются с понедельника. Старт — {weekdayLabel(scheduleDraft.start)}, первая неделя {weekLabel({ start: scheduleDraft.start, end: firstWeekEnd })}:{" "}
                  <b className="text-foreground">{firstWeekLessons > 0 ? firstWeekLessons : autoFirstWeek}</b> {plural(firstWeekLessons > 0 ? firstWeekLessons : autoFirstWeek)}, дальше по {scheduleDraft.perWeek} в неделю.
                </>
              ) : (
                "Укажите уроков в неделю и первый учебный день — сетка разложится по календарным неделям, и на карточке будет видно отставание."
              )}
            </div>

            {scheduleDraft && (
              <div className="mt-2.5">
                <div className="mb-1 text-2xs font-bold tracking-wide text-muted-foreground uppercase">Исключения по неделям</div>
                <div className="flex flex-col gap-1.5">
                  {exceptions.map((x) => (
                    <div key={x.id} className="grid grid-cols-[90px_1fr_28px] items-center gap-1.5 sm:grid-cols-[110px_130px_1fr_28px]">
                      <NumberInput value={x.week} onChange={(n) => setExceptions((p) => p.map((y) => (y.id === x.id ? { ...y, week: n } : y)))} inputMode="numeric" placeholder="№ недели" title="Номер недели, с 1" />
                      <NumberInput value={x.lessons} onChange={(n) => setExceptions((p) => p.map((y) => (y.id === x.id ? { ...y, lessons: n } : y)))} inputMode="numeric" placeholder="уроков" title="Сколько уроков в этой неделе; 0 — каникулы" />
                      <span className="hidden truncate text-2xs text-muted-foreground sm:block">{x.lessons === 0 ? "каникулы" : `${x.lessons} ${plural(x.lessons)} вместо ${scheduleDraft.perWeek}`}</span>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => setExceptions((p) => p.filter((y) => y.id !== x.id))}>
                        <Trash2 className="text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-1.5" onClick={() => setExceptions((p) => [...p, { id: randId("ex"), week: p.length ? Math.max(...p.map((x) => x.week)) + 1 : 2, lessons: 0 }])}>
                  <Plus />Каникулы или короткая неделя
                </Button>
              </div>
            )}
          </div>
          <Field label="Материалы (ссылка)">
            <Input value={materialsLink} onChange={(e) => setMaterialsLink(e.target.value)} placeholder="https://drive.google.com/…" />
          </Field>

          <div>
            <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Уроки класса</Label>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-2xs text-muted-foreground">От</span>
                <Input type="number" min={1} max={500} value={rangeFrom} onChange={(e) => setRangeFrom(parseInt(e.target.value) || 1)} className="w-20" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-2xs text-muted-foreground">До</span>
                <Input type="number" min={1} max={500} value={rangeTo} onChange={(e) => setRangeTo(parseInt(e.target.value) || 1)} className="w-20" />
              </div>
              {removedNums.size > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setRemovedNums(new Set())}>Вернуть убранные ({removedNums.size})</Button>
              )}
            </div>

            {lessonNums.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {lessonNums.map((n) => (
                  <span key={n} className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pr-1 pl-2.5 text-xs font-bold">
                    {n}
                    <button type="button" onClick={() => removeLessonNum(n)} className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-1.5 text-2xs text-muted-foreground">
              {lessonNums.length} {plural(lessonNums.length)} в классе: диапазон применяется сразу. Существующие уроки сохраняют прогресс; убрать урок (вместе с составом) можно только крестиком.
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Состав урока и ставки</Label>
            <div className="mb-1.5 hidden grid-cols-[1.4fr_1fr_70px_90px_28px] gap-1.5 text-2xs font-bold tracking-wide text-muted-foreground uppercase sm:grid">
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
            <div className="mt-1.5 text-2xs text-muted-foreground">
              По этим ставкам заказ из урока создаётся в один клик, уже с ценами. Ставки можно поправить в самом заказе.
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-bold text-danger-soft-foreground">{error}</div>
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

function plural(n: number): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return "урок"
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "урока"
  return "уроков"
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">{label}</Label>
      {children}
    </div>
  )
}
