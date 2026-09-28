import { useState } from "react"
import { ChevronUp, ChevronDown, Eye, EyeOff, Trash2, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { planCatalogRename } from "@/lib/catalogRename"
import { fmtMoney } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { cn } from "@/lib/utils"
import type { AppSettings } from "@/types/models"
import { confirmDialog } from "@/store/useDialogStore"

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

  /**
   * Переименование — по уходу из поля, с каскадом по заказам, авансам,
   * доскам и шаблонам (lib/catalogRename.ts). Раньше правилось на каждое
   * нажатие клавиши и только в самом списке: клиент «раздваивался» — новое имя
   * в справочнике, старое во всех заказах.
   */
  async function commitRename(idx: number, val: string) {
    const from = list[idx]
    const to = val.trim()
    if (!to || to === from) return
    const buildPlan = () => {
      const s = useAppStore.getState()
      return planCatalogRename(catalogKey, from, to, { settings: s.appSettings, orders: s.orders, advances: s.advances, planningBoards: s.planningBoards })
    }
    // Этот план — только для текста подтверждения (см. ниже).
    const preview = buildPlan()
    const t = preview.touched
    const total = t.orders + t.advances + t.boards + t.templates
    const r = preview.repricing
    if (total > 0 || preview.merges || r) {
      const bullets: string[] = []
      if (t.orders) bullets.push(`Заказы: ${t.orders}${t.lines ? ` (позиций: ${t.lines})` : ""}`)
      if (t.advances) bullets.push(`Авансы: ${t.advances}`)
      if (t.boards) bullets.push(`Доски планирования: ${t.boards}${t.lessonItems ? ` (пунктов в уроках: ${t.lessonItems})` : ""}`)
      if (t.templates) bullets.push(`Пункты шаблонов досок и заказов: ${t.templates}`)
      if (preview.merges) bullets.push(`«${to}» уже есть в справочнике — записи сольются в одну`)
      let body = total ? "Новое имя будет подставлено везде, где встречается старое:" : undefined
      // Смена почасовой единицы на штучную (и наоборот) пересчитывает цены
      // заказов — предупреждение первым абзацем и красная кнопка без фокуса,
      // чтобы не подтвердить это Enter'ом не глядя.
      if (r) {
        const how = r.toHourly
          ? `«${to}» — почасовая единица (в названии есть «час»): позиции будут считаться как часы × ставка, а не количество × ставка.`
          : `«${to}» — не почасовая единица (в названии нет «час»): позиции будут считаться как количество × ставка, а не часы × ставка.`
        const diff = r.after - r.before
        const money = r.orders
          ? `Цена изменится у заказов: ${r.orders}${r.paid ? ` (из них с оплатой или авансом: ${r.paid} — у них появится переплата или долг)` : ""}. Сумма по ним: ${fmtMoney(r.before)} → ${fmtMoney(r.after)} (${diff > 0 ? "+" : "−"}${fmtMoney(Math.abs(diff))}).`
          : "Цены сохранённых заказов не изменятся."
        body = `Внимание: ${how}\n${money}${body ? `\n\n${body}` : ""}`
      }
      const ok = await confirmDialog({
        title: r?.orders ? `«${from}» → «${to}»: изменятся цены заказов` : `Переименовать «${from}» в «${to}»?`,
        body,
        bullets,
        confirmLabel: r?.orders ? "Всё равно переименовать" : "Переименовать",
        destructive: !!r?.orders,
      })
      if (!ok) return
    }
    // Применяем план, собранный заново из ТЕКУЩЕГО состояния. Пока окно было
    // открыто, таймер или правка с другого устройства могли изменить заказы и
    // доски — запись плана, собранного до вопроса, молча их бы затёрла.
    const plan = buildPlan()
    const s = useAppStore.getState()
    s.setAppSettings(plan.settings)
    if (plan.touched.orders) s.setOrders(plan.orders)
    if (plan.touched.advances) s.setAdvances(plan.advances)
    if (plan.touched.boards) s.setPlanningBoards(plan.planningBoards)
    saveData()
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
  async function remove(idx: number) {
    const val = list[idx]
    const ok = await confirmDialog({
      title: "Удалить запись из справочника?",
      body: `«${val}»

Если она где-то ещё используется — лучше скрыть её глазком, а не удалять: удаление не подставит замену в старые записи.`,
      confirmLabel: "Удалить",
      destructive: true,
    })
    if (!ok) return
    update(list.filter((_, i) => i !== idx), hidden.filter((h) => h !== val))
  }
  function add() {
    update([...list, "Новая запись"])
  }

  return (
    <div className="glass-surface rounded-xl p-4.5">
      <h3 className="mb-3 text-lg font-bold">{title}</h3>
      <div className="flex flex-col gap-1.5">
        {list.map((val, idx) => {
          const isHidden = hidden.includes(val)
          return (
            <div key={idx} className={cn("flex items-center gap-1", isHidden && "opacity-50")}>
              {/* Стрелки перестановки. Сама иконка маленькая — иначе строка
                  справочника разъезжается, — но область нажатия расширена до
                  24×20 через отрицательные отступы: 16×16 пальцем не попасть,
                  а на телефоне это основной способ ввода. */}
              <div className="-my-1 flex shrink-0 flex-col">
                <button
                  type="button"
                  aria-label="Переместить выше"
                  disabled={idx === 0}
                  onClick={() => move(idx, -1)}
                  className="flex h-5 w-6 items-center justify-center text-muted-foreground disabled:opacity-30"
                >
                  <ChevronUp className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="Переместить ниже"
                  disabled={idx === list.length - 1}
                  onClick={() => move(idx, 1)}
                  className="flex h-5 w-6 items-center justify-center text-muted-foreground disabled:opacity-30"
                >
                  <ChevronDown className="size-3" />
                </button>
              </div>
              <CatalogNameInput
                value={val}
                onCommit={(v) => commitRename(idx, v)}
                className={cn("h-8 flex-1 text-sm", isHidden && "line-through")}
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

/** Поле имени: правится свободно, сохраняется по Enter или уходу из поля. */
function CatalogNameInput({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <Input
      value={text ?? value}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text !== null && text !== value) onCommit(text); setText(null) }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        if (e.key === "Escape") { setText(null); (e.target as HTMLInputElement).blur() }
      }}
      className={className}
    />
  )
}
