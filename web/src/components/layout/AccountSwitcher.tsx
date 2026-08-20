import { useState } from "react"
import { ChevronDown, LogOut, Plus, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { useAppStore } from "@/store/useAppStore"
import { supabaseClient } from "@/lib/supabase"
import { getKnownAccounts, forgetAccount } from "@/lib/accountSwitcher"

export function AccountSwitcher() {
  const email = useAppStore((s) => s.cloudUserEmail)
  const cloudUserId = useAppStore((s) => s.cloudUserId)
  const setAddAccountOverlayOpen = useAppStore((s) => s.setAddAccountOverlayOpen)
  const [open, setOpen] = useState(false)
  const [, forceRender] = useState(0)

  const known = getKnownAccounts()
  const others = Object.entries(known)
    .filter(([id]) => id !== cloudUserId)
    .sort((a, b) => b[1].lastUsed - a[1].lastUsed)

  async function switchToAccount(userId: string) {
    const acc = known[userId]
    if (!acc) return
    const { error } = await supabaseClient.auth.setSession({ access_token: acc.access_token, refresh_token: acc.refresh_token })
    if (error) {
      alert('Не удалось переключиться — сессия этого аккаунта истекла. Войдите в него заново через "Войти под другим аккаунтом".')
      forgetAccount(userId)
      forceRender((n) => n + 1)
      return
    }
    window.location.reload()
  }

  function handleForget(e: React.MouseEvent, userId: string) {
    e.stopPropagation()
    forgetAccount(userId)
    forceRender((n) => n + 1)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-overlay/10">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-emphasis/90 font-heading text-[13px] font-extrabold text-emphasis-foreground">Д</div>
          <div className="min-w-0 flex-1">
            <div className="font-heading text-[15px] font-extrabold tracking-tight">Дизайн · CRM</div>
            <div className="truncate text-[11px] font-semibold text-muted-foreground">{email || "—"}</div>
          </div>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {others.map(([id, acc]) => (
          <DropdownMenuItem key={id} onClick={() => switchToAccount(id)} className="justify-between">
            <span className="truncate">{acc.email}</span>
            <button type="button" title="Забыть аккаунт" onClick={(e) => handleForget(e, id)} className="ml-2 shrink-0 text-muted-foreground hover:text-destructive">
              <X className="size-3.5" />
            </button>
          </DropdownMenuItem>
        ))}
        {others.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => setAddAccountOverlayOpen(true)}>
          <Plus />
          Войти под другим аккаунтом
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => supabaseClient.auth.signOut().then(() => window.location.reload())}>
          <LogOut />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
