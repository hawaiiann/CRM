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
import { saveData, runSyncSelfCheck, deleteFromCloud } from "@/lib/cloudSync"
import { dateKey } from "@/lib/money"
import { normalizeOrder, normalizeTask, normalizeAdvance, applySettingsMigrations } from "@/lib/normalize"
import { selectBackupDirectory, hasDirectoryAccess, backupPathSupported, saveManualBackupToFolder } from "@/lib/diskBackup"
import { getKnownAccounts } from "@/lib/accountSwitcher"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { DEFAULT_BACKUP_PATH } from "@/lib/version"
import type { BackupSettings as BackupSettingsType, Order, Task, Advance, PlanningBoard, ActivityLogEntry } from "@/types/models"
import { alertDialog, choiceDialog } from "@/store/useDialogStore"

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

  /**
   * Импорт бэкапа. Раньше файл молча заменял всё в приложении, но НЕ в
   * облаке: записи, которых в файле нет, оставались там и при следующей
   * загрузке возвращались. Теперь два явных режима:
   *   • «Заменить всё» — состояние приложения становится равным файлу, а
   *     записи, которых в файле нет, удаляются и из облака;
   *   • «Дополнить» — добавляются только записи с неизвестными id, ничего
   *     существующего не трогается.
   */
  async function importJson(file: File) {
    let parsed: any
    try {
      parsed = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== "object") throw new Error("not an object")
    } catch (err) {
      console.error(err)
      await alertDialog({
        title: "Не удалось прочитать файл",
        body: "Проверьте, что это корректный JSON-бэкап. Данные в приложении не тронуты.",
      })
      return
    }

    const settings = parsed.settings ? applySettingsMigrations({ ...appSettings, ...parsed.settings }) : appSettings
    const fileOrders = Array.isArray(parsed.orders) ? (parsed.orders as Partial<Order>[]).map((o) => normalizeOrder(o, settings)) : null
    const fileTasks = Array.isArray(parsed.tasks) ? (parsed.tasks as Partial<Task>[]).map(normalizeTask) : null
    const fileAdvances = Array.isArray(parsed.advances) ? (parsed.advances as Partial<Advance>[]).map(normalizeAdvance) : null
    const fileBoards = Array.isArray(parsed.planning) ? (parsed.planning as PlanningBoard[]) : null
    const fileLog = Array.isArray(parsed.activityLog) ? (parsed.activityLog as ActivityLogEntry[]) : null

    const s = store.getState()
    const when = parsed.timestamp ? new Date(parsed.timestamp).toLocaleString("ru") : "дата неизвестна"
    const answer = await choiceDialog({
      title: "Как загрузить бэкап?",
      body: `Файл от ${when}${parsed.account ? `, аккаунт ${parsed.account}` : ""}.`,
      bullets: [
        `Заказы: в файле ${fileOrders?.length ?? "—"}, сейчас ${s.orders.length}`,
        `Задачи: в файле ${fileTasks?.length ?? "—"}, сейчас ${s.tasks.length}`,
        `Авансы: в файле ${fileAdvances?.length ?? "—"}, сейчас ${s.advances.length}`,
        `Доски планирования: в файле ${fileBoards?.length ?? "—"}, сейчас ${s.planningBoards.length}`,
        `Журнал часов: в файле ${fileLog?.length ?? "—"}, сейчас ${s.activityLog.length}`,
      ],
      note: "«Заменить всё» приводит приложение и облако к содержимому файла: чего нет в файле — будет удалено. «Дополнить» только добавляет записи, которых ещё нет.",
      confirmLabel: "Заменить всё",
      altLabel: "Дополнить",
      destructive: true,
    })
    if (answer === "cancel") return

    if (answer === "alt") {
      const addMissing = <T extends { id: string }>(current: T[], incoming: T[] | null) => {
        if (!incoming) return current
        const have = new Set(current.map((x) => x.id))
        return [...current, ...incoming.filter((x) => !have.has(x.id))]
      }
      s.setOrders((prev) => addMissing(prev, fileOrders))
      s.setTasks((prev) => addMissing(prev, fileTasks))
      s.setAdvances((prev) => addMissing(prev, fileAdvances))
      s.setPlanningBoards((prev) => addMissing(prev, fileBoards))
      if (fileLog) {
        const have = new Set(s.activityLog.map((e) => e.entryId).filter(Boolean))
        s.setActivityLog((prev) => [...prev, ...fileLog.filter((e) => !e.entryId || !have.has(e.entryId))])
      }
      saveData()
      return
    }

    // Заменить всё: то, чего нет в файле, уходит и из облака через очередь.
    const removeAbsent = <T extends { id: string }>(current: T[], incoming: T[] | null, table: string) => {
      if (!incoming) return
      const keep = new Set(incoming.map((x) => x.id))
      current.forEach((x) => { if (!keep.has(x.id)) deleteFromCloud(table, x.id) })
    }
    removeAbsent(s.orders, fileOrders, "orders")
    removeAbsent(s.tasks, fileTasks, "tasks")
    removeAbsent(s.advances, fileAdvances, "advances")
    if (fileBoards) {
      removeAbsent(s.planningBoards, fileBoards, "planning_boards")
      const fileLessonIds = new Set(fileBoards.flatMap((b) => (b.lessons || []).map((l) => l.id)))
      s.planningBoards.forEach((b) => (b.lessons || []).forEach((l) => { if (!fileLessonIds.has(l.id)) deleteFromCloud("planning_lessons", l.id) }))
    }
    if (fileLog) {
      const fileEntryIds = new Set(fileLog.map((e) => e.entryId).filter(Boolean))
      s.activityLog.forEach((e) => { if (e.entryId && !fileEntryIds.has(e.entryId)) deleteFromCloud("activity_log", e.entryId) })
    }

    if (parsed.settings) s.setAppSettings(settings)
    if (fileOrders) s.setOrders(fileOrders)
    if (fileTasks) s.setTasks(fileTasks)
    if (fileAdvances) s.setAdvances(fileAdvances)
    if (fileBoards) s.setPlanningBoards(fileBoards)
    if (fileLog) s.setActivityLog(fileLog)
    saveData()
  }

  async function selfCheck() {
    setChecking(true)
    try {
      const problems = await runSyncSelfCheck()
      if (!problems) {
        await alertDialog({
          title: "Синхронизация в порядке",
          body: "Данные в приложении и в облаке совпадают.",
        })
      } else {
        // Списком, а не сплошным текстом: расхождений может быть много, и в
        // системном окне их приходилось разбирать глазами по переводам строк.
        await alertDialog({ title: "Найдены расхождения", bullets: problems })
      }
    } catch (err) {
      await alertDialog({
        title: "Не удалось проверить",
        body: err instanceof Error ? err.message : String(err),
      })
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
