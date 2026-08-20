import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { TemplateEditorDialog } from "./TemplateEditorDialog"
import type { OrderTemplate } from "@/types/models"

export function OrderTemplatesSettings() {
  const templates = useAppStore((s) => s.appSettings.orderTemplates)
  const setAppSettings = useAppStore((s) => s.setAppSettings)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<OrderTemplate | null>(null)

  function remove(id: string) {
    if (!confirm("Удалить этот шаблон? Уже созданные заказы это не затронет.")) return
    setAppSettings((s) => ({ ...s, orderTemplates: s.orderTemplates.filter((t) => t.id !== id) }))
    saveData()
  }

  return (
    <div className="glass-surface rounded-xl p-4.5">
      <h3 className="text-[15px] font-bold">Шаблоны заказов</h3>
      <div className="mb-3 text-[12px] text-muted-foreground">Готовые наборы позиций для быстрого создания заказа.</div>

      <div className="flex flex-col gap-2">
        {templates.length === 0 && <div className="text-[12.5px] text-muted-foreground">Шаблонов пока нет.</div>}
        {templates.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold">{t.name}</div>
              <div className="truncate text-[11.5px] text-muted-foreground">{t.lines.map((l) => l.label || "?").join(", ") || "нет позиций"}</div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(t); setEditorOpen(true) }}>Изменить</Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => remove(t.id)}>Удалить</Button>
            </div>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => { setEditing(null); setEditorOpen(true) }}>
        <Plus />Новый шаблон
      </Button>

      <TemplateEditorDialog open={editorOpen} template={editing} onOpenChange={setEditorOpen} />
    </div>
  )
}
