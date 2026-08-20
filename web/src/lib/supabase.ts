import { createClient } from "@supabase/supabase-js"

// Публичный ключ не секретен: реальная защита данных — политики RLS в базе
// (каждый видит и правит только свои строки, user_id = auth.uid()). Те же
// значения, что и в vanilla-версии (js/supabaseConfig.js).
const SUPABASE_URL = "https://wsykxvmweyvwytniycca.supabase.co"
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_lfDyJYRnafI4mDvVaR8BKg_QZa1Thoe"

// Чекбокс "Запомнить меня" переключает, куда supabase-js пишет сессию: localStorage
// (переживает закрытие браузера) при включённой галочке, sessionStorage (только пока
// открыта вкладка) — при выключенной.
export let rememberMeOnNextSignIn = true
export function setRememberMeOnNextSignIn(v: boolean) {
  rememberMeOnNextSignIn = v
}

const authStorageAdapter = {
  getItem: (key: string) => localStorage.getItem(key) ?? sessionStorage.getItem(key),
  setItem: (key: string, value: string) => {
    if (rememberMeOnNextSignIn) {
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
