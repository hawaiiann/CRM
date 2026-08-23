import { PENDING_DELETES_KEY } from "./storageKeys"

/**
 * Очередь удалений, не подтверждённых облаком.
 *
 * Удаление считалось выполненным по факту вызова: ошибку Supabase возвращает
 * в результате, а не бросает, и проверки не было вовсе. Если запрос не
 * проходил (нет сети, права, ошибка сервера), приложение молчало, локально
 * запись исчезала — а при следующем открытии приезжала из облака обратно.
 * Ровно так «возвращался» удалённый урок.
 *
 * Очередь лежит в localStorage и переживает перезагрузку. Пока запись в ней:
 *   • при загрузке из облака строка отфильтровывается — воскреснуть не может;
 *   • при каждой синхронизации удаление повторяется.
 *
 * Отдельным модулем, а не внутри cloudSync, чтобы это можно было проверить
 * без Supabase и без стора приложения.
 */
type Queue = Record<string, string[]>

let queue: Queue = read()

function read(): Queue {
  try {
    const raw = localStorage.getItem(PENDING_DELETES_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === "object" ? (parsed as Queue) : {}
  } catch {
    return {}
  }
}

function persist() {
  try { localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(queue)) }
  catch (err) { console.error("Не удалось сохранить очередь удалений:", err) }
}

export function rememberDelete(table: string, id: string) {
  const list = queue[table] || []
  if (!list.includes(id)) queue[table] = [...list, id]
  persist()
}

export function forgetDelete(table: string, id: string) {
  const list = queue[table]
  if (!list) return
  const next = list.filter((x) => x !== id)
  if (next.length) queue[table] = next
  else delete queue[table]
  persist()
}

export function isPendingDelete(table: string, id: string): boolean {
  return (queue[table] || []).includes(id)
}

/** Таблицы и записи, ждущие подтверждения, — для повтора при синхронизации. */
export function pendingDeleteEntries(): { table: string; id: string }[] {
  return Object.keys(queue).flatMap((table) => (queue[table] || []).map((id) => ({ table, id })))
}

/** Только для тестов: перечитать очередь так, как это делает новая вкладка. */
export function reloadPendingDeletes() {
  queue = read()
}
