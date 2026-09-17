import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { ComboInput } from "@/components/ui/combo-input"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { parseKtp, scheduleFromKtp } from "@/lib/ktp"
import { catalogWithCurrent, getVisibleCatalog } from "@/lib/catalog"
import { fmtDeadline } from "@/lib/dates"
import type { PlanningBoard, PlanningLesson } from "@/types/models"

function randId(prefix: string) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * Импорт КТП: вставил таблицу из документа — класс создан или дополнен
 * темами и датами. Раньше 39 уроков заводились руками, а тема урока в CRM
 * не попадала вовсе, и в списке заказов были одни «Урок 14».
 */
export function KtpImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const boards = useAppStore((s) => s.planningBoards)
  const appSettings = useAppStore((s) => s.appSettings)
  const setPlanningBoards = useAppStore((s) => s.setPlanningBoards)
  const setAppSettings = useAppStore((s) => s.setAppSettings)

  const [text, setText] = useState("")
  const [target, setTarget] = useState<string>("new")
  const [subject, setSubject] = useState(() => getVisibleCatalog(appSettings, "subjects")[0] || "Литература")
  const [title, setTitle] = useState(() => getVisibleCatalog(appSettings, "classes")[0] || "5 класс")
  const [quarter, setQuarter] = useState("1 четверть")
  const [overwrite, setOverwrite] = useState(true)
  const [applySchedule, setApplySchedule] = useState(true)

  const parsed = useMemo(() => parseKtp(text), [text])
  const schedule = useMemo(() => scheduleFromKtp(parsed.lessons), [parsed])
  const existing = boards.find((b) => b.id === target) || null

  function apply() {
    if (!parsed.lessons.length) return
    const templateItems = existing?.baseTemplate || ["Презентация", "Рабочий лист"]
    const boardId = existing ? existing.id : randId("pb")
    const mkLesson = (num: number, t: string): PlanningLesson => ({
      id: randId("l"), num, title: t || `Урок ${num}`, color: "gray",
      items: templateItems.map((x) => ({ id: randId("i"), text: x, done: false })), colorLocked: false, orderLinked: false, notes: "",
    })

    if (existing) {
      setPlanningBoards((prev) => prev.map((b) => {
        if (b.id !== existing.id) return b
        const byNum = new Map(b.lessons.map((l) => [l.num, l]))
        parsed.lessons.forEach((k) => {
          const l = byNum.get(k.num)
          if (!l) { byNum.set(k.num, mkLesson(k.num, k.title)); return }
          const isDefault = !l.title || /^урок\s*\d+$/i.test(l.title)
          if (k.title && (overwrite || isDefault)) byNum.set(k.num, { ...l, title: k.title })
        })
        return { ...b, lessons: [...byNum.values()].sort((a, c) => a.num - c.num) }
      }))
    } else {
      const board: PlanningBoard = {
        id: boardId, subject, title, quarter, deadline: "", baseTemplate: templateItems, collapsed: false, archived: false,
        lessons: parsed.lessons.map((k) => mkLesson(k.num, k.title)),
      }
      setPlanningBoards((prev) => [...prev, board])
      setAppSettings((s) => ({
        ...s,
        subjects: s.subjects.includes(subject) ? s.subjects : [...s.subjects, subject],
        classes: s.classes.includes(title) ? s.classes : [...s.classes, title],
      }))
    }
    if (applySchedule && schedule) {
      setAppSettings((s) => ({ ...s, boardSchedules: { ...(s.boardSchedules || {}), [boardId]: { ...(s.boardSchedules?.[boardId] || {}), ...schedule } } }))
    }
    saveData()
    onOpenChange(false)
    setText("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Импорт КТП</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div>
            <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Таблица из документа</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              placeholder={"Скопируйте таблицу КТП и вставьте сюда. Нужны номер урока и тема, дата и часы — если есть.\n1\tВводный урок\t1\t02.09\n2\tУстное народное творчество\t1\t04.09"}
              className="font-mono text-xs"
            />
            <div className="mt-1 text-2xs text-muted-foreground">
              {parsed.lessons.length
                ? `Найдено уроков: ${parsed.lessons.length}${parsed.skipped ? `, пропущено строк: ${parsed.skipped}` : ""}${schedule ? ` · по датам: старт ${fmtDeadline(schedule.start)}, ${schedule.perWeek} в неделю` : ""}`
                : "Пока ничего не распознано: в строке должен быть номер урока и тема."}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Куда</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Новый класс</SelectItem>
                  {boards.filter((b) => !b.archived).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{[b.subject, b.title, b.quarter].filter(Boolean).join(" · ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {existing ? (
              <label className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                Перезаписать уже заданные темы
              </label>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <ComboInput value={subject} onChange={setSubject} options={catalogWithCurrent(appSettings, "subjects", subject)} placeholder="Предмет" />
                <ComboInput value={title} onChange={setTitle} options={catalogWithCurrent(appSettings, "classes", title)} placeholder="Класс" />
                <Input value={quarter} onChange={(e) => setQuarter(e.target.value)} placeholder="Четверть" />
              </div>
            )}
          </div>

          {schedule && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={applySchedule} onChange={(e) => setApplySchedule(e.target.checked)} />
              Поставить график по датам: старт {fmtDeadline(schedule.start)}, {schedule.perWeek} в неделю, в первой неделе {schedule.firstWeekLessons}
            </label>
          )}

          {parsed.lessons.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <tbody>
                  {parsed.lessons.map((l) => (
                    <tr key={l.num} className="border-b border-border last:border-0">
                      <td className="w-10 px-2.5 py-1.5 text-right font-bold tabular-nums text-muted-foreground">{l.num}</td>
                      <td className="px-2 py-1.5">{l.title || <span className="text-muted-foreground">без темы</span>}</td>
                      <td className="w-24 px-2 py-1.5 text-right text-muted-foreground tabular-nums">{l.date ? fmtDeadline(l.date).replace(/ г\.$/, "") : ""}</td>
                      <td className="w-10 px-2 py-1.5 text-right text-muted-foreground tabular-nums">{l.hours ? `${l.hours} ч` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button type="button" disabled={!parsed.lessons.length} onClick={apply} className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
            {existing ? "Обновить класс" : "Создать класс"} ({parsed.lessons.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
