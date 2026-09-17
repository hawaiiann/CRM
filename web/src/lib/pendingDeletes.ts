import { PENDING_DELETES_KEY, accountKey } from "./storageKeys"

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
 * Очередь своя у каждого аккаунта (setPendingDeletesScope): общая очередь
 * «исполнялась» под чужой сессией — RLS возвращал ноль строк без ошибки, и
 * удаление вычёркивалось, так и не дойдя до нужных данных.
 *
 * Отдельным модулем, а не внутри cloudSync, чтобы это можно было проверить
 * без Supabase и без стора приложения.
 */
type Queue = Record<string, string[]>

let scope: string | null = null
let queue: Queue = read()

function key(): string {
  return accountKey(PENDING_DELETES_KEY, scope)
}

function read(): Queue {
  try {
    // Старая общая очередь дочитывается один раз вместе со своей: то, что
    // там лежит, ставили ещё до разделения по аккаунтам.
    const merged: Queue = {}
    for (const k of [PENDING_DELETES_KEY, key()]) {
      const raw = localStorage.getItem(k)
      const parsed = raw ? JSON.parse(raw) : null
      if (!parsed || typeof parsed !== "object") continue
      for (const table in parsed as Queue) {
        const ids = (parsed as Queue)[table] || []
        merged[table] = [...new Set([...(merged[table] || []), ...ids])]
      }
    }
    return merged
  } catch {
    return {}
  }
}

function persist() {
  try {
    localStorage.setItem(key(), JSON.stringify(queue))
    localStorage.removeItem(PENDING_DELETES_KEY)
  } catch (err) { console.error("Не удалось сохранить очередь удалений:", err) }
}

/** Переключить очередь на аккаунт. Вызывается до первой загрузки данных. */
export function setPendingDeletesScope(userId: string | null) {
  scope = userId
  queue = read()
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

export function pendingDeleteCount(): number {
  return pendingDeleteEntries().length
}

/** Только для тестов: перечитать очередь так, как это делает новая вкладка. */
export function reloadPendingDeletes() {
  queue = read()
}
