import { ChevronUp, ChevronDown, Eye, EyeOff, Trash2, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { cn } from "@/lib/utils"
import type { AppSettings } from "@/types/models"

type CatalogKey = keyof Pick<AppSettings, "clients" | "types" | "units" | "subjects" | "classes">

export function CatalogList({ title, catalogKey }: { title: string; catalogKey: CatalogKey }) {
  const appSettings = useAppStore((s) => s.appSettings)
  const setAppSettings = useAppStore((s) => s.setAppSettings)
  const list = appSettings[catalogKey]
  const hidden = appSettings.hiddenEntries[catalogKey]

  function update(next: string[], nextHidden?: string[]) {
    setAppSettings((s) => ({
      ...s,
      [catalogKey]: next,
      hiddenEntries: { ...s.hiddenEntries, [catalogKey]: nextHidden ?? s.hiddenEntries[catalogKey] },
    }))
    saveData()
  }

  function rename(idx: number, val: string) {
    const oldVal = list[idx]
    const nextHidden = hidden.includes(oldVal) ? hidden.map((h) => (h === oldVal ? val : h)) : hidden
    update(list.map((v, i) => (i === idx ? val : v)), nextHidden)
  }
  function move(idx: number, dir: -1 | 1) {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= list.length) return
    const next = [...list]
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    update(next)
  }
  function toggleHidden(idx: number) {
    const val = list[idx]
    const next = hidden.includes(val) ? hidden.filter((h) => h !== val) : [...hidden, val]
    update(list, next)
  }
  function remove(idx: number) {
    const val = list[idx]
    if (!confirm(`Удалить «${val}» из справочника? Если позиция где-то ещё используется — лучше скрыть её глазком, а не удалять.`)) return
    update(list.filter((_, i) => i !== idx), hidden.filter((h) => h !== val))
  }
  function add() {
    update([...list, "Новая запись"])
  }

  return (
    <div className="glass-surface rounded-xl p-4.5">
      <h3 className="mb-3 text-[15px] font-bold">{title}</h3>
      <div className="flex flex-col gap-1.5">
        {list.map((val, idx) => {
          const isHidden = hidden.includes(val)
          return (
            <div key={idx} className={cn("flex items-center gap-1", isHidden && "opacity-50")}>
              <div className="flex flex-col">
                <button type="button" disabled={idx === 0} onClick={() => move(idx, -1)} className="flex size-4 items-center justify-center text-muted-foreground disabled:opacity-30">
                  <ChevronUp className="size-3" />
                </button>
                <button type="button" disabled={idx === list.length - 1} onClick={() => move(idx, 1)} className="flex size-4 items-center justify-center text-muted-foreground disabled:opacity-30">
                  <ChevronDown className="size-3" />
                </button>
              </div>
              <Input
                value={val}
                onChange={(e) => rename(idx, e.target.value)}
                className={cn("h-8 flex-1 text-[12.5px]", isHidden && "line-through")}
              />
              <Button type="button" variant="ghost" size="icon-sm" title={isHidden ? "Показать в списках выбора" : "Скрыть из списков выбора"} onClick={() => toggleHidden(idx)}>
                {isHidden ? <EyeOff className="text-muted-foreground" /> : <Eye className="text-muted-foreground" />}
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(idx)}>
                <Trash2 className="text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          )
        })}
      </div>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={add}>
        <Plus />Добавить
      </Button>
    </div>
  )
}
