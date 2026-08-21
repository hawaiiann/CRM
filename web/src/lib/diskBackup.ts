// Дисковый автобэкап через File System Access API — порт js/settings.js.
// Хэндл папки хранится в IndexedDB (не в localStorage — FileSystemHandle не сериализуется в JSON),
// разрешение на запись браузер требует подтверждать явным кликом при каждой новой сессии.
import { useAppStore } from "@/store/useAppStore"
import { BACKUP_CFG_KEY } from "./storageKeys"
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase"
import { getKnownAccounts } from "./accountSwitcher"

const BACKUP_HANDLE_DB = "design_crm_dirhandle_db"
const BACKUP_HANDLE_STORE = "handles"

// Сколько дней хранить историю бэкапов. Раньше файл был один
// (crm-autobackup.json) и затирал сам себя при каждом сохранении, поэтому
// вчерашнего состояния попросту не существовало: когда 20.08.2026 миграция
// снесла журнал часов, автобэкап тут же честно записал уже испорченные данные
// поверх целых, и откатываться стало не на что. Теперь на каждый аккаунт и
// каждый день — свой файл.
const RETENTION_DAYS = 45

function accountSlug(email: string | null | undefined, userId: string | null | undefined) {
  const base = (email || userId || "account").toLowerCase()
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "account"
}

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

let directoryHandle: FileSystemDirectoryHandle | null = null

function isFsAccessSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window
}

function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_HANDLE_DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(BACKUP_HANDLE_STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveDirectoryHandleToDB(handle: FileSystemDirectoryHandle) {
  try {
    const db = await openHandleDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BACKUP_HANDLE_STORE, "readwrite")
      tx.objectStore(BACKUP_HANDLE_STORE).put(handle, "backupDir")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.error("Не удалось сохранить доступ к папке", err)
  }
}

// Пытается восстановить доступ к ранее выбранной папке при открытии CRM, чтобы
// не приходилось выбирать её заново каждый раз. Возвращает true, если доступ реально есть прямо сейчас.
export async function restoreBackupDirectoryHandle(): Promise<boolean> {
  try {
    const db = await openHandleDB()
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(BACKUP_HANDLE_STORE, "readonly")
      const req = tx.objectStore(BACKUP_HANDLE_STORE).get("backupDir")
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    if (!handle) { directoryHandle = null; return false }
    const perm = await handle.queryPermission({ mode: "readwrite" })
    if (perm === "granted") {
      directoryHandle = handle
      return true
    }
    // Браузер требует явного клика пользователя, чтобы разрешить доступ заново —
    // сама папка "помнится", но её нужно один раз подтвердить кнопкой.
    directoryHandle = null
    return false
  } catch {
    directoryHandle = null
    return false
  }
}

export function hasDirectoryAccess() {
  return !!directoryHandle
}

export function backupPathSupported() {
  return isFsAccessSupported()
}

export async function selectBackupDirectory(): Promise<string | null> {
  if (!isFsAccessSupported()) {
    alert("Ваш браузер не поддерживает выбор папки на диске (File System Access API).")
    return null
  }
  try {
    const handle = await window.showDirectoryPicker()
    directoryHandle = handle
    await saveDirectoryHandleToDB(handle)
    const store = useAppStore.getState()
    const next = { ...store.backupSettings, path: handle.name }
    store.setBackupSettings(next)
    localStorage.setItem(BACKUP_CFG_KEY, JSON.stringify(next))
    return handle.name
  } catch {
    return null
  }
}

// Насколько «похудел» бэкап по сравнению с уже лежащим за сегодня. Если данных
// стало заметно меньше — это подозрительно (ровно так выглядела потеря журнала
// 20.08.2026), и затирать целый файл усохшим нельзя.
function looksLikeDataLoss(prev: any, next: any): string | null {
  const pairs: [string, string][] = [["orders", "заказы"], ["advances", "авансы"], ["tasks", "задачи"], ["activityLog", "журнал"]]
  for (const [key, label] of pairs) {
    const a = Array.isArray(prev?.[key]) ? prev[key].length : 0
    const b = Array.isArray(next?.[key]) ? next[key].length : 0
    if (a >= 5 && b < a * 0.7) return `${label}: было ${a}, стало ${b}`
  }
  return null
}

async function writeBackupFile(dir: FileSystemDirectoryHandle, name: string, jsonStr: string) {
  const fileHandle = await dir.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(jsonStr)
  await writable.close()
}

async function readBackupFile(dir: FileSystemDirectoryHandle, name: string): Promise<any | null> {
  try {
    const fh = await dir.getFileHandle(name)
    return JSON.parse(await (await fh.getFile()).text())
  } catch {
    return null
  }
}

// Удаляет старые ДНЕВНЫЕ автобэкапы. Всё остальное не трогает — и это критично.
//
// Прежний шаблон /^crm-.+-(дата)(-.*)?\.json$/ был слишком широким и сносил бы:
//   • ручные выгрузки crm-backup-<дата>.json — включая файл от 18.08.2026 с
//     единственной уцелевшей историей часов;
//   • аварийные файлы «-ВНИМАНИЕ-данных-меньше-» — то есть ровно те, что
//     сигнализируют о потере данных и нужны дольше всех.
// Автоочистка, стирающая невосстановимое, хуже, чем её отсутствие: удаляем
// только точное совпадение «crm-<аккаунт>-<дата>.json», без суффиксов, и
// отдельно исключаем префикс crm-backup-.
async function pruneOldBackups(dir: FileSystemDirectoryHandle) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)
  const cutoffKey = dayKey(cutoff)
  try {
    for await (const entry of (dir as any).values()) {
      if (entry.kind !== "file") continue
      if (entry.name.startsWith("crm-backup-")) continue // ручная выгрузка — не наша
      const m = /^crm-(.+)-(\d{4}-\d{2}-\d{2})\.json$/.exec(entry.name)
      if (!m) continue // с суффиксом (в т.ч. «ВНИМАНИЕ») — не трогаем никогда
      if (m[2] < cutoffKey) {
        try { await (dir as any).removeEntry(entry.name) } catch { /* файл занят — не беда */ }
      }
    }
  } catch { /* перебор недоступен — пропускаем чистку, это не критично */ }
}

export async function triggerDiskBackup(): Promise<{ savedToDisk: boolean }> {
  const store = useAppStore.getState()
  const backupData = {
    orders: store.orders,
    settings: store.appSettings,
    tasks: store.tasks,
    advances: store.advances,
    planning: store.planningBoards,
    activityLog: store.activityLog,
    account: store.cloudUserEmail || null,
    timestamp: Date.now(),
  }
  const jsonStr = JSON.stringify(backupData, null, 2)

  let saved = false
  if (directoryHandle) {
    try {
      let perm = await directoryHandle.queryPermission({ mode: "readwrite" })
      if (perm !== "granted") perm = await directoryHandle.requestPermission({ mode: "readwrite" })
      if (perm === "granted") {
        const slug = accountSlug(store.cloudUserEmail, store.cloudUserId)
        const todayName = `crm-${slug}-${dayKey()}.json`

        // Если сегодняшний файл уже есть и новый заметно беднее — НЕ затираем.
        // Кладём рядом отдельным файлом, чтобы уцелели оба и было видно расхождение.
        const prev = await readBackupFile(directoryHandle, todayName)
        const shrink = prev ? looksLikeDataLoss(prev, backupData) : null
        if (shrink) {
          const stamp = new Date().toTimeString().slice(0, 5).replace(":", "-")
          await writeBackupFile(directoryHandle, `crm-${slug}-${dayKey()}-ВНИМАНИЕ-данных-меньше-${stamp}.json`, jsonStr)
          console.warn(`Бэкап не перезаписан: данных стало меньше (${shrink}). Прежний файл сохранён.`)
        } else {
          await writeBackupFile(directoryHandle, todayName, jsonStr)
        }
        await pruneOldBackups(directoryHandle)
        saved = true
      }
    } catch (err) {
      console.error("Directory write error", err)
    }
  }

  if (!saved) {
    // Реальной папки на диске сейчас нет — сохраняем только внутри браузера
    // и честно не отмечаем lastBackup, чтобы UI не врал, что бэкап на диск выгружен.
    localStorage.setItem("crm_last_auto_backup", jsonStr)
    return { savedToDisk: false }
  }

  // Остальные аккаунты бэкапим тем же заходом: читаем их данные напрямую по
  // сохранённому токену и НЕ трогаем текущую сессию (никакого setSession и
  // перезагрузки — именно это раньше и приводило к путанице между аккаунтами).
  if (saved && directoryHandle) {
    try { await backupOtherAccounts(directoryHandle) } catch (e) { console.error("Бэкап других аккаунтов", e) }
  }

  const next = { ...useAppStore.getState().backupSettings, lastBackup: Date.now() }
  useAppStore.getState().setBackupSettings(next)
  localStorage.setItem(BACKUP_CFG_KEY, JSON.stringify(next))
  return { savedToDisk: true }
}

/**
 * Ручной бэкап кнопкой «Скачать бэкап»: если папка автобэкапа подтверждена,
 * файл кладётся сразу туда (с датой в имени, рядом с автоматическими) и в
 * «Загрузки» не идёт. Если доступа к папке нет — возвращаем false, и вызывающий
 * код скачивает файл обычным способом, чтобы бэкап не потерялся вовсе.
 */
export async function saveManualBackupToFolder(jsonStr: string, fileName: string): Promise<boolean> {
  if (!directoryHandle) return false
  try {
    let perm = await directoryHandle.queryPermission({ mode: "readwrite" })
    if (perm !== "granted") perm = await directoryHandle.requestPermission({ mode: "readwrite" })
    if (perm !== "granted") return false
    await writeBackupFile(directoryHandle, fileName, jsonStr)
    return true
  } catch (err) {
    console.error("Не удалось сохранить бэкап в папку", err)
    return false
  }
}

async function backupOtherAccounts(dir: FileSystemDirectoryHandle) {
  const state = useAppStore.getState()
  const currentId = state.cloudUserId
  const excluded = new Set(state.backupSettings.excludedAccounts || [])
  const known = getKnownAccounts()
  for (const [userId, acc] of Object.entries(known)) {
    if (userId === currentId) continue
    if (excluded.has(userId)) continue // отключён в настройках (напр. тестовый аккаунт)
    const slug = accountSlug(acc.email, userId)
    const name = `crm-${slug}-${dayKey()}.json`

    // ЗДЕСЬ НЕЛЬЗЯ ОБНОВЛЯТЬ ТОКЕН. Раньше по 401 вызывался refresh_token, и это
    // было опасно: refresh_token одноразовый и общий с сессией самого владельца
    // аккаунта. Обновив его здесь, мы отбираем сессию у человека, который прямо
    // сейчас работает под этим аккаунтом на другом компьютере, — его просто
    // выкидывает из приложения. Проверено на живой связке: ровно так сломался
    // бэкап по refresh_token, когда браузер и скрипт делили один токен.
    //
    // Поэтому берём только уже сохранённый access_token. Он живёт около часа,
    // так что чужой аккаунт снимется, если в него недавно заходили на этой
    // машине, а если нет — молча пропустится. Пропущенный бэкап чужого аккаунта
    // не страшен: свой у каждой машины снимается всегда.
    const grab = async (table: string): Promise<any> => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + acc.access_token },
      })
      if (r.status === 401) throw new Error("токен устарел — аккаунт пропущен (сессию владельца не трогаем)")
      if (!r.ok) throw new Error(`${table}: HTTP ${r.status}`)
      return r.json()
    }
    try {
      const [orders, tasks, advances, activityLog, planning] = await Promise.all([
        grab("orders"), grab("tasks"), grab("advances"), grab("activity_log"), grab("planning_boards"),
      ])
      const data = { orders, tasks, advances, activityLog, planning, account: acc.email || userId, timestamp: Date.now(), raw: true }
      const prev = await readBackupFile(dir, name)
      const shrink = prev ? looksLikeDataLoss(prev, data) : null
      const json = JSON.stringify(data, null, 2)
      if (shrink) {
        const stamp = new Date().toTimeString().slice(0, 5).replace(":", "-")
        await writeBackupFile(dir, `crm-${slug}-${dayKey()}-ВНИМАНИЕ-данных-меньше-${stamp}.json`, json)
      } else {
        await writeBackupFile(dir, name, json)
      }
    } catch (e) {
      // Протухший токен — обычное дело: аккаунт просто пропускаем, свой бэкап уже сохранён.
      console.warn(`Бэкап аккаунта ${acc.email || userId} пропущен:`, e)
    }
  }
}
