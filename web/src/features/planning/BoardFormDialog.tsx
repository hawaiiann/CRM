import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  const [startNum, setStartNum] = useState(1)
  const [count, setCount] = useState(24)
  const [template, setTemplate] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    if (board) {
      setSubject(board.subject || "")
      setTitle(board.title || "")
      setQuarter(board.quarter || "")
      setDeadline(board.deadline || "")
      setStartNum(board.lessons[0]?.num || 1)
      setCount(board.lessons.length || 24)
      setTemplate(board.baseTemplate?.length ? [...board.baseTemplate] : ["Презентация", "Рабочий лист"])
    } else {
      setSubject(appSettings.subjects[0] || "Математика")
      setTitle(appSettings.classes[0] || "5 класс")
      setQuarter("1 четверть")
      setDeadline("")
      setStartNum(1)
      setCount(24)
      setTemplate(["Презентация", "Рабочий лист"])
    }
  }, [open, board, appSettings.subjects, appSettings.classes])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
          let lessons = b.lessons
          if (lessons.length !== count) {
            if (count > lessons.length) {
              const addCount = count - lessons.length
              const maxNum = lessons.reduce((m, l) => Math.max(m, l.num || 0), startNum - 1)
              const added: PlanningLesson[] = Array.from({ length: addCount }, (_, i) => ({
                id: randId("l"), num: maxNum + 1 + i, title: `Урок ${maxNum + 1 + i}`, color: "gray",
                items: templateItems.map((t) => ({ id: randId("i"), text: t, done: false })), colorLocked: false, orderLinked: false, notes: "",
              }))
              lessons = [...lessons, ...added]
            } else {
              lessons = lessons.slice(0, count)
            }
          }
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
      const lessons: PlanningLesson[] = Array.from({ length: count }, (_, i) => ({
        id: randId("l"), num: startNum + i, title: `Урок ${startNum + i}`, color: "gray",
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
              <Input list="board-subjects-list" value={subject} onChange={(e) => setSubject(e.target.value)} required />
              <datalist id="board-subjects-list">{appSettings.subjects.map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            <Field label="Класс">
              <Input list="board-classes-list" value={title} onChange={(e) => setTitle(e.target.value)} required />
              <datalist id="board-classes-list">{appSettings.classes.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Четверть">
              <Input value={quarter} onChange={(e) => setQuarter(e.target.value)} placeholder="1 четверть" />
            </Field>
            <Field label="Старт. № урока">
              <Input type="number" min={1} value={startNum} onChange={(e) => setStartNum(parseInt(e.target.value) || 1)} required />
            </Field>
            <Field label="Кол-во уроков">
              <Input type="number" min={1} value={count} onChange={(e) => setCount(parseInt(e.target.value) || 1)} required />
            </Field>
          </div>
          <Field label="Дедлайн класса">
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
          <div>
            <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Базовое наполнение уроков</Label>
            <div className="flex flex-col gap-1.5">
              {template.map((val, idx) => (
                <div key={idx} className="flex gap-1.5">
                  <Input
                    list="board-types-list"
                    value={val}
                    onChange={(e) => setTemplate((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))}
                    placeholder="Выберите тип работы или введите..."
                  />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setTemplate((prev) => prev.filter((_, i) => i !== idx))}>
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
            <datalist id="board-types-list">{appSettings.types.map((t) => <option key={t} value={t} />)}</datalist>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setTemplate((prev) => [...prev, ""])}>
              <Plus />Добавить материал
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" className="bg-emphasis/90 font-extrabold text-emphasis-foreground hover:bg-emphasis">Сохранить</Button>
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
