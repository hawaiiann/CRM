import type { Session } from "@supabase/supabase-js"
import { KNOWN_ACCOUNTS_KEY } from "./storageKeys"

export interface KnownAccount {
  email: string
  access_token: string
  refresh_token: string
  lastUsed: number
}

export function getKnownAccounts(): Record<string, KnownAccount> {
  try {
    return JSON.parse(localStorage.getItem(KNOWN_ACCOUNTS_KEY) || "{}")
  } catch {
    return {}
  }
}

function saveKnownAccountsMap(map: Record<string, KnownAccount>) {
  localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(map))
}

export function rememberAccount(session: Session) {
  const map = getKnownAccounts()
  map[session.user.id] = {
    email: session.user.email || "",
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    lastUsed: Date.now(),
  }
  saveKnownAccountsMap(map)
}

// Обновляет только токены, не трогая остальное. Нужно бэкапу: access_token
// живёт около часа, и без обновления бэкап чужого аккаунта переставал
// работать через час после последнего входа в него на этой машине.
export function updateAccountTokens(userId: string, accessToken: string, refreshToken: string) {
  const map = getKnownAccounts()
  if (!map[userId]) return
  map[userId] = { ...map[userId], access_token: accessToken, refresh_token: refreshToken }
  saveKnownAccountsMap(map)
}

export function forgetAccount(userId: string) {
  const map = getKnownAccounts()
  delete map[userId]
  saveKnownAccountsMap(map)
}
