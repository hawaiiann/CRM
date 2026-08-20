// Дисковый автобэкап через File System Access API — порт js/settings.js.
// Хэндл папки хранится в IndexedDB (не в localStorage — FileSystemHandle не сериализуется в JSON),
// разрешение на запись браузер требует подтверждать явным кликом при каждой новой сессии.
import { useAppStore } from "@/store/useAppStore"
import { BACKUP_CFG_KEY } from "./storageKeys"

const BACKUP_FILE_NAME = "crm-autobackup.json"
const BACKUP_HANDLE_DB = "design_crm_dirhandle_db"
const BACKUP_HANDLE_STORE = "handles"

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

export async function triggerDiskBackup(): Promise<{ savedToDisk: boolean }> {
  const store = useAppStore.getState()
  const backupData = {
    orders: store.orders,
    settings: store.appSettings,
    tasks: store.tasks,
    advances: store.advances,
    planning: store.planningBoards,
    activityLog: store.activityLog,
    timestamp: Date.now(),
  }
  const jsonStr = JSON.stringify(backupData, null, 2)

  let saved = false
  if (directoryHandle) {
    try {
      let perm = await directoryHandle.queryPermission({ mode: "readwrite" })
      if (perm !== "granted") perm = await directoryHandle.requestPermission({ mode: "readwrite" })
      if (perm === "granted") {
        const fileHandle = await directoryHandle.getFileHandle(BACKUP_FILE_NAME, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(jsonStr)
        await writable.close()
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

  const next = { ...useAppStore.getState().backupSettings, lastBackup: Date.now() }
  useAppStore.getState().setBackupSettings(next)
  localStorage.setItem(BACKUP_CFG_KEY, JSON.stringify(next))
  return { savedToDisk: true }
}
