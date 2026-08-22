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
import { NumberInput } from "@/components/ui/number-input"
import { ComboInput } from "@/components/ui/combo-input"
import { Label } from "@/components/ui/label"
import { catalogWithCurrent } from "@/lib/catalog"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { parseNum } from "@/lib/money"
import type { OrderTemplate, OrderTemplateLine } from "@/types/models"

function randId(prefix: string) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function TemplateEditorDialog({
  open,
  template,
  onOpenChange,
}: {
  open: boolean
  template: OrderTemplate | null
  onOpenChange: (open: boolean) => void
}) {
  const appSettings = useAppStore((s) => s.appSettings)
  const setAppSettings = useAppStore((s) => s.setAppSettings)

  const [name, setName] = useState("")
  const [lines, setLines] = useState<(OrderTemplateLine & { id: string })[]>([])

  useEffect(() => {
    if (!open) return
    if (template) {
      setName(template.name)
      setLines(template.lines.map((l) => ({ ...l, id: randId("tl") })))
    } else {
      setName("")
      setLines([{ id: randId("tl"), label: "", type: "", qty: 1, rate: 0 }])
    }
  }, [open, template])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) { alert("Введите название шаблона."); return }
    const cleanLines = lines.filter((l) => (l.label || "").trim() !== "").map((l) => ({ label: l.label.trim(), type: (l.type || "").trim(), qty: parseNum(l.qty) || 1, rate: parseNum(l.rate) || 0 }))
    if (!cleanLines.length) { alert("Добавьте хотя бы одну позицию с названием."); return }

    setAppSettings((s) => {
      const templates = s.orderTemplates
      if (template) {
        return { ...s, orderTemplates: templates.map((t) => (t.id === template.id ? { ...t, name: trimmedName, lines: cleanLines } : t)) }
      }
      return { ...s, orderTemplates: [...templates, { id: randId("tpl"), name: trimmedName, lines: cleanLines }] }
    })
    saveData()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{template ? "Изменить шаблон" : "Новый шаблон"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Название шаблона</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Стандартный урок" required />
          </div>

          <div>
            <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Позиции</Label>
            <div className="flex flex-col gap-1.5">
              {lines.map((l) => (
                <div key={l.id} className="rounded-lg border border-border p-2 sm:border-0 sm:p-0">
                  {/* desktop — one compact row */}
                  <div className="hidden sm:grid sm:grid-cols-[1.4fr_1fr_80px_100px_28px] sm:gap-1.5">
                    <ComboInput value={l.label} onChange={(v) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, label: v } : x)))} options={catalogWithCurrent(appSettings, "types", l.label)} placeholder="Тип..." />
                    <ComboInput value={l.type} onChange={(v) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, type: v } : x)))} options={catalogWithCurrent(appSettings, "units", l.type)} placeholder="Ед. изм..." />
                    <NumberInput value={l.qty} onChange={(n) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, qty: n } : x)))} placeholder="1" />
                    <NumberInput value={l.rate} onChange={(n) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, rate: n } : x)))} placeholder="0 ₽" />
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setLines((prev) => prev.filter((x) => x.id !== l.id))}>
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </div>

                  {/* mobile — stacked, labeled */}
                  <div className="flex flex-col gap-2 sm:hidden">
                    <div className="flex items-center gap-2">
                      <ComboInput className="flex-1" value={l.label} onChange={(v) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, label: v } : x)))} options={catalogWithCurrent(appSettings, "types", l.label)} placeholder="Тип..." />
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => setLines((prev) => prev.filter((x) => x.id !== l.id))}>
                        <Trash2 className="text-muted-foreground" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <ComboInput value={l.type} onChange={(v) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, type: v } : x)))} options={catalogWithCurrent(appSettings, "units", l.type)} placeholder="Ед. изм..." />
                      <NumberInput value={l.qty} onChange={(n) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, qty: n } : x)))} placeholder="1" />
                      <NumberInput value={l.rate} onChange={(n) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, rate: n } : x)))} placeholder="0 ₽" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setLines((prev) => [...prev, { id: randId("tl"), label: "", type: "", qty: 1, rate: 0 }])}>
              <Plus />Добавить позицию
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">Сохранить шаблон</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
