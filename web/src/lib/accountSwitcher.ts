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

export function forgetAccount(userId: string) {
  const map = getKnownAccounts()
  delete map[userId]
  saveKnownAccountsMap(map)
}
