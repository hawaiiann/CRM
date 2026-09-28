import { createClient } from "@supabase/supabase-js"

// Публичный ключ не секретен: реальная защита данных — политики RLS в базе
// (каждый видит и правит только свои строки, user_id = auth.uid()). Те же
// значения, что и в vanilla-версии (js/supabaseConfig.js).
// Экспортируются, чтобы бэкап мог читать данные НЕактивных аккаунтов напрямую
// через REST с их сохранённым токеном, не переключая текущую сессию.
export const SUPABASE_URL = "https://wsykxvmweyvwytniycca.supabase.co"
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_lfDyJYRnafI4mDvVaR8BKg_QZa1Thoe"

// Чекбокс "Запомнить меня" переключает, куда supabase-js пишет сессию: localStorage
// (переживает закрытие браузера) при включённой галочке, sessionStorage (только пока
// открыта вкладка) — при выключенной.
//
// null — явного выбора в этой загрузке страницы не было (например, после F5):
// тогда сессия остаётся там, где уже лежит. Раньше здесь было true по
// умолчанию, и первое же обновление токена после перезагрузки переносило
// «незапомненную» сессию в localStorage — на общем компьютере следующий
// человек попадал в CRM.
let rememberMeOnNextSignIn: boolean | null = null
export function setRememberMeOnNextSignIn(v: boolean) {
  rememberMeOnNextSignIn = v
}

const authStorageAdapter = {
  getItem: (key: string) => localStorage.getItem(key) ?? sessionStorage.getItem(key),
  setItem: (key: string, value: string) => {
    const sessionOnly = sessionStorage.getItem(key) !== null && localStorage.getItem(key) === null
    const remember = rememberMeOnNextSignIn ?? !sessionOnly
    if (remember) {
      localStorage.setItem(key, value)
      sessionStorage.removeItem(key)
    } else {
      sessionStorage.setItem(key, value)
      localStorage.removeItem(key)
    }
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage: authStorageAdapter },
})
