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
import { ComboInput } from "@/components/ui/combo-input"
import { Label } from "@/components/ui/label"
import { getVisibleCatalog, catalogWithCurrent } from "@/lib/catalog"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import type { PlanningBoard, PlanningLesson } from "@/types/models"

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

  const [subject, setSubject] = useState("")
  const [title, setTitle] = useState("")
  const [quarter, setQuarter] = useState("")
  const [deadline, setDeadline] = useState("")
  const [lessonNums, setLessonNums] = useState<number[]>([])
  const [rangeFrom, setRangeFrom] = useState(1)
  const [rangeTo, setRangeTo] = useState(24)
  const [template, setTemplate] = useState<string[]>([])
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
      setTemplate(board.baseTemplate?.length ? [...board.baseTemplate] : ["Презентация", "Рабочий лист"])
    } else {
      setSubject(getVisibleCatalog(appSettings, "subjects")[0] || "Математика")
      setTitle(getVisibleCatalog(appSettings, "classes")[0] || "5 класс")
      setQuarter("1 четверть")
      setDeadline("")
      setLessonNums(Array.from({ length: 24 }, (_, i) => i + 1))
      setRangeFrom(25)
      setRangeTo(32)
      setTemplate(["Презентация", "Рабочий лист"])
    }
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
    const templateItems = template.map((s) => s.trim()).filter(Boolean)

    const nextSettings = { ...appSettings }
    let changed = false
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
      const newBoard: PlanningBoard = { id: randId("pb"), subject, title, quarter, deadline, baseTemplate: templateItems, collapsed: false, archived: false, lessons }
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
            <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Базовое наполнение уроков</Label>
            <div className="flex flex-col gap-1.5">
              {template.map((val, idx) => (
                <div key={idx} className="flex gap-1.5">
                  <ComboInput
                    className="flex-1"
                    value={val}
                    onChange={(v) => setTemplate((prev) => prev.map((x, i) => (i === idx ? v : x)))}
                    options={catalogWithCurrent(appSettings, "types", val)}
                    placeholder="Выберите тип работы или введите..."
                  />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setTemplate((prev) => prev.filter((_, i) => i !== idx))}>
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setTemplate((prev) => [...prev, ""])}>
              <Plus />Добавить материал
            </Button>
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
