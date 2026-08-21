import { useRef, useState } from "react"
import { Download, Upload, ShieldCheck, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { useAppStore } from "@/store/useAppStore"
import { saveData, runSyncSelfCheck } from "@/lib/cloudSync"
import { dateKey } from "@/lib/money"
import { normalizeOrder, normalizeTask, normalizeAdvance, applySettingsMigrations } from "@/lib/normalize"
import { selectBackupDirectory, hasDirectoryAccess, backupPathSupported, saveManualBackupToFolder } from "@/lib/diskBackup"
import { getKnownAccounts } from "@/lib/accountSwitcher"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { DEFAULT_BACKUP_PATH } from "@/lib/version"
import type { BackupSettings as BackupSettingsType, Order, Task, Advance, PlanningBoard, ActivityLogEntry } from "@/types/models"

export function BackupSettings() {
  const backupSettings = useAppStore((s) => s.backupSettings)
  const setBackupSettings = useAppStore((s) => s.setBackupSettings)
  const appSettings = useAppStore((s) => s.appSettings)
  const store = useAppStore
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [checking, setChecking] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [, forceRender] = useState(0)

  async function pickDirectory() {
    const name = await selectBackupDirectory()
    if (name) forceRender((n) => n + 1)
  }

  const dirWarning = backupSettings.path && !hasDirectoryAccess()
  const currentUserId = useAppStore((s) => s.cloudUserId)
  // Текущий аккаунт бэкапится всегда, поэтому в списке он есть, но галочку у
  // него снять нельзя — иначе можно молча остаться вообще без бэкапа.
  const otherAccounts = Object.entries(getKnownAccounts()).sort((a, b) => (a[0] === currentUserId ? -1 : b[0] === currentUserId ? 1 : 0))

  function updateSetting(patch: Partial<BackupSettingsType>) {
    const next = { ...backupSettings, ...patch }
    setBackupSettings(next)
    localStorage.setItem("design_crm_backup_cfg", JSON.stringify(next))
  }

  async function exportJson() {
    const s = store.getState()
    const backupData = {
      orders: s.orders,
      settings: s.appSettings,
      tasks: s.tasks,
      advances: s.advances,
      planning: s.planningBoards,
      activityLog: s.activityLog,
      account: s.cloudUserEmail || null,
      timestamp: Date.now(),
    }
    const json = JSON.stringify(backupData, null, 2)
    const fileName = "crm-backup-" + dateKey(new Date()) + ".json"

    // Сначала пробуем положить в папку автобэкапа — там файл окажется рядом с
    // остальными и попадёт в приватный репозиторий. В «Загрузки» скачиваем
    // только если доступа к папке нет, чтобы бэкап не потерялся совсем.
    const savedToFolder = await saveManualBackupToFolder(json, fileName)
    if (!savedToFolder) {
      const blob = new Blob([json], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    }
    updateSetting({ lastBackup: Date.now() })
    setExportNote(savedToFolder ? `Сохранён в папку: ${fileName}` : "Папка не подтверждена — файл ушёл в «Загрузки»")
    setTimeout(() => setExportNote(null), 6000)
  }

  function importJson(file: File) {
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(String(evt.target?.result))
        const settings = parsed.settings ? applySettingsMigrations({ ...appSettings, ...parsed.settings }) : appSettings
        if (parsed.settings) store.getState().setAppSettings(settings)
        if (Array.isArray(parsed.orders)) store.getState().setOrders((parsed.orders as Partial<Order>[]).map((o) => normalizeOrder(o, settings)))
        if (Array.isArray(parsed.tasks)) store.getState().setTasks((parsed.tasks as Partial<Task>[]).map(normalizeTask))
        if (Array.isArray(parsed.advances)) store.getState().setAdvances((parsed.advances as Partial<Advance>[]).map(normalizeAdvance))
        if (Array.isArray(parsed.planning)) store.getState().setPlanningBoards(parsed.planning as PlanningBoard[])
        if (Array.isArray(parsed.activityLog)) store.getState().setActivityLog(parsed.activityLog as ActivityLogEntry[])
        saveData()
      } catch (err) {
        console.error(err)
        alert("Не удалось прочитать файл — проверьте, что это корректный JSON-бэкап.")
      }
    }
    reader.readAsText(file)
  }

  async function selfCheck() {
    setChecking(true)
    try {
      const problems = await runSyncSelfCheck()
      if (!problems) alert("Синхронизация в порядке — данные в приложении и в облаке совпадают.")
      else alert("Найдены расхождения:\n\n" + problems.join("\n"))
    } catch (err) {
      alert("Не удалось проверить: " + (err instanceof Error ? err.message : String(err)))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="glass-surface rounded-xl p-4.5">
      <h3 className="text-[15px] font-bold">Резервное копирование</h3>
      <div className="mb-3 text-[12px] text-muted-foreground">Скачайте бэкап целиком или проверьте, что всё в приложении совпадает с тем, что реально лежит в облаке.</div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Автобэкап при сохранении</label>
          <Select value={String(backupSettings.enabled)} onValueChange={(v) => updateSetting({ enabled: v === "true" })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Включён</SelectItem>
              <SelectItem value="false">Отключён</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Периодичность</label>
          <Select value={backupSettings.interval} onValueChange={(v) => updateSetting({ interval: v as BackupSettingsType["interval"] })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="change">При каждом изменении</SelectItem>
              <SelectItem value="1h">Каждый час</SelectItem>
              <SelectItem value="6h">Каждые 6 часов</SelectItem>
              <SelectItem value="24h">Раз в день</SelectItem>
              <SelectItem value="7d">Раз в неделю</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {backupPathSupported() && (
        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Папка на диске для автобэкапа</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={backupSettings.path}
              onChange={(e) => updateSetting({ path: e.target.value })}
              placeholder={DEFAULT_BACKUP_PATH}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-[12.5px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <Button type="button" variant="outline" size="sm" onClick={pickDirectory}>
              <FolderOpen />{hasDirectoryAccess() ? "Сменить папку" : "Подтвердить доступ"}
            </Button>
          </div>
          <div className="mt-1.5 text-[11.5px] text-muted-foreground">
            Путь можно править вручную, но доступ к папке даёт только браузер — один раз нажмите кнопку и выберите её. Дальше доступ запомнится.
          </div>
          {dirWarning && (
            <div className="mt-1.5 text-[11.5px] font-bold text-destructive">
              Доступ к папке не подтверждён — автобэкап на диск не пишется. Нажмите кнопку рядом.
            </div>
          )}

          {otherAccounts.length > 0 && (
            <div className="mt-3.5 rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-2 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Какие аккаунты бэкапить</div>
              <div className="flex flex-col gap-2">
                {otherAccounts.map(([id, acc]) => {
                  const isCurrent = id === currentUserId
                  const on = isCurrent || !(backupSettings.excludedAccounts || []).includes(id)
                  return (
                    <label key={id} className={cn("flex items-center gap-2.5 text-[12.5px]", isCurrent ? "cursor-default" : "cursor-pointer")}>
                      <Checkbox
                        checked={on}
                        disabled={isCurrent}
                        onCheckedChange={(c) => {
                          if (isCurrent) return
                          const prev = backupSettings.excludedAccounts || []
                          updateSetting({ excludedAccounts: c ? prev.filter((x) => x !== id) : [...prev, id] })
                        }}
                      />
                      <span className={on ? "" : "text-muted-foreground line-through"}>{acc.email || id.slice(0, 8)}</span>
                      {isCurrent && <span className="text-[11px] text-muted-foreground">— текущий, бэкапится всегда</span>}
                    </label>
                  )
                })}
              </div>
              <div className="mt-2 text-[11.5px] text-muted-foreground">
                Снятые галочки пропускаются. Данные неактивных аккаунтов читаются напрямую по сохранённому токену — переключаться между ними не нужно.
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-border pt-3.5">
        <div className="text-[12.5px]">
          <span className="font-bold">Последний бэкап: </span>
          <span className="text-muted-foreground">{backupSettings.lastBackup ? new Date(backupSettings.lastBackup).toLocaleString("ru") : "Ещё не производился"}</span>
          {exportNote && <div className="mt-1 text-[11.5px] font-bold text-foreground/80">{exportNote}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={selfCheck} disabled={checking}>
            <ShieldCheck />{checking ? "Проверка..." : "Проверить синхронизацию"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload />Загрузить
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={exportJson}>
            <Download />Скачать бэкап
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = "" }}
          />
        </div>
      </div>
    </div>
  )
}
