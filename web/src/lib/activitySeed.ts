import { ACTIVITY_SEEDED_KEY } from "./storageKeys"

/**
 * Отметка «журнал часов этому аккаунту уже досевали».
 *
 * Досев (seedActivityLogIfEmpty в cloudSync.ts) задуман как одноразовая
 * миграция для тех, кто переходит из версии без журнала вовсе. Без этой
 * метки он срабатывал при КАЖДОМ пустом журнале, а не только при первом —
 * а журнал мог опустеть и по другой причине (сетевой сбой на предыдущей
 * синхронизации). Так 20.08.2026 реальная история была подменена оценками
 * часов по датам заказов сразу на нескольких аккаунтах.
 *
 * Отдельным модулем, а не внутри cloudSync.ts, чтобы проверяться без
 * Supabase — так же, как pendingDeletes.ts.
 */
function read(): Set<string> {
  try {
    const raw = localStorage.getItem(ACTIVITY_SEEDED_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

export function wasAccountSeeded(scope: string): boolean {
  return read().has(scope)
}

export function markAccountSeeded(scope: string) {
  const set = read()
  set.add(scope)
  try { localStorage.setItem(ACTIVITY_SEEDED_KEY, JSON.stringify([...set])) }
  catch (err) { console.error("Не удалось сохранить метку досева журнала:", err) }
}
