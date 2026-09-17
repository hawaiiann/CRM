import { Checkbox } from "@/components/ui/checkbox"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"

/**
 * Необязательные режимы. Режим КТП выключен по умолчанию: привычная работа
 * без тем уроков и без кнопки импорта, пока он не нужен.
 */
export function ModesSettings() {
  const ktpMode = useAppStore((s) => s.appSettings.ktpMode)
  const setAppSettings = useAppStore((s) => s.setAppSettings)

  function setKtp(on: boolean) {
    setAppSettings((s) => ({ ...s, ktpMode: on }))
    saveData()
  }

  return (
    <div className="glass-surface rounded-xl p-4.5">
      <div className="mb-3 text-base font-bold">Режимы</div>
      <label className="flex cursor-pointer items-start gap-2.5">
        <Checkbox checked={!!ktpMode} onCheckedChange={(c) => setKtp(!!c)} className="mt-0.5" />
        <span>
          <span className="block text-sm font-bold">Режим КТП</span>
          <span className="block text-xs text-muted-foreground">
            Кнопка «Импорт КТП» в планировании: темы уроков и график из вставленной таблицы. Темы показываются в строках класса и в названиях заказов вместо «Урок 14». Выключено — всё как раньше.
          </span>
        </span>
      </label>
    </div>
  )
}
