import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import type { Session } from "@supabase/supabase-js"
import { X } from "lucide-react"
import { supabaseClient, setRememberMeOnNextSignIn } from "@/lib/supabase"
import { useAppStore } from "@/store/useAppStore"
import { loadData, subscribeRealtime } from "@/lib/cloudSync"
import { getKnownAccounts, rememberAccount } from "@/lib/accountSwitcher"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"

export function AuthGate({ children }: { children: ReactNode }) {
  const authLoading = useAppStore((s) => s.authLoading)
  const cloudUserId = useAppStore((s) => s.cloudUserId)
  const dataLoaded = useAppStore((s) => s.dataLoaded)
  const setAuth = useAppStore((s) => s.setAuth)
  const setAuthLoading = useAppStore((s) => s.setAuthLoading)
  const addAccountOverlayOpen = useAppStore((s) => s.addAccountOverlayOpen)
  const setAddAccountOverlayOpen = useAppStore((s) => s.setAddAccountOverlayOpen)

  useEffect(() => {
    let cancelled = false
    supabaseClient.auth.getSession().then(({ data }) => {
      if (cancelled) return
      if (data.session) {
        setAuth(data.session.user.id, data.session.user.email ?? null)
      }
      setAuthLoading(false)
    })
    // Keeps tokens fresh for ALREADY-known accounts (supabase-js rotates them
    // periodically) — never adds a new entry on its own, only refreshes one
    // that switchToAccount/login already remembered.
    const { data: sub } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setAuth(session.user.id, session.user.email ?? null)
        if (getKnownAccounts()[session.user.id]) rememberAccount(session)
      }
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [setAuth, setAuthLoading])

  useEffect(() => {
    if (!cloudUserId) return
    loadData()
    subscribeRealtime()
  }, [cloudUserId])

  if (authLoading) return null

  if (!cloudUserId) return <LoginScreen mandatory />

  if (!dataLoaded) return null

  return (
    <>
      {children}
      {addAccountOverlayOpen && <LoginScreen onClose={() => setAddAccountOverlayOpen(false)} />}
    </>
  )
}

function LoginScreen({ mandatory, onClose }: { mandatory?: boolean; onClose?: () => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    setRememberMeOnNextSignIn(remember)
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
      if (remember) rememberAccount(data.session)
      if (!mandatory) {
        // Switching accounts while already signed in — reload for a clean slate
        // instead of trying to reconcile in-memory state from the old account.
        window.location.reload()
      }
      // Mandatory first login: onAuthStateChange in AuthGate picks up the session reactively.
    } catch {
      setError("Не удалось войти: проверьте email и пароль.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={mandatory ? "flex min-h-screen items-center justify-center bg-[image:var(--app-bg-gradient)] p-6" : "fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-6"}>
      <div className="relative w-full max-w-[400px] rounded-2xl border border-border bg-card p-7 shadow-lg">
        {onClose && (
          <button type="button" onClick={onClose} className="absolute top-3.5 right-3.5 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        )}
        <h1 className="font-heading text-xl font-bold">Вход в CRM</h1>
        <p className="mt-1 mb-5 text-[13px] text-muted-foreground">
          Данные у каждого пользователя свои и не пересекаются.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth_email">Email</Label>
            <Input id="auth_email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth_password">Пароль</Label>
            <Input id="auth_password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <Checkbox checked={remember} onCheckedChange={(c) => setRemember(!!c)} />
            Запомнить меня на этом устройстве
          </label>
          {error && <div className="text-[12.5px] font-bold text-destructive">{error}</div>}
          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-gradient-to-br from-[#D4F86A] via-[#A8E10C] to-[#7CB518] font-extrabold text-[#17190A] hover:brightness-105"
          >
            {submitting ? "Вход..." : "Войти"}
          </Button>
        </form>
      </div>
    </div>
  )
}

export type { Session }
