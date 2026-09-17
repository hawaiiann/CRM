import { useEffect, useState, Suspense, type ReactNode } from "react"
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import {
  BarChart3,
  CalendarDays,
  Database,
  CloudOff,
  HardDrive,
  Sun,
  Menu,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"
import { useTimerStore } from "@/store/useTimerStore"
import { useThemeStore } from "@/store/useThemeStore"
import { restoreBackupDirectoryHandle, triggerDiskBackup, confirmBackupDirectoryAccess } from "@/lib/diskBackup"
import { hotkeyFor, HOTKEY_HINT } from "./hotkeys"
import { SidebarNotice, SidebarNoticeButton } from "./SidebarNotice"
import { retryCloudSync } from "@/lib/cloudSync"
import { SidebarTimerCard } from "./SidebarTimerCard"
import { ToastRoot } from "./ToastRoot"
import { AppDialogRoot } from "./AppDialogRoot"
import { AccountSwitcher } from "./AccountSwitcher"
import { GlassBackdrop } from "@/features/dashboard/GlassBackdrop"
import { APP_VERSION } from "@/lib/version"
import { REQUIRED_SQL, SCHEMA_ISSUE_TEXT } from "@/lib/cloudSchema"

type NavItem = {
  label: string
  icon: typeof Sun
  to: string
  /** Дополнительные пути, при которых пункт считается активным (виды одного раздела). */
  match?: string[]
}

type NavGroup = {
  label: string
  items: NavItem[]
}

// Четыре раздела вместо восьми. Заказы, таймлайн и планирование — три вида
// одних данных (см. LessonsHeader), клиенты — вкладка Финансов, задачи живут
// на «Сегодня». Меньше переходов, меньше вопросов «где это».
const NAV: NavGroup[] = [
  {
    label: "Работа",
    items: [
      { label: "Сегодня", icon: Sun, to: "/", match: ["/tasks"] },
      { label: "Уроки", icon: CalendarDays, to: "/planning", match: ["/orders", "/timeline"] },
    ],
  },
  {
    label: "Деньги",
    items: [{ label: "Финансы", icon: BarChart3, to: "/finance", match: ["/clients"] }],
  },
  {
    label: "Настройки",
    items: [{ label: "Справочники", icon: Database, to: "/settings" }],
  },
]

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const setOnNavigateToOrder = useTimerStore((s) => s.setOnNavigateToOrder)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const isDark = useThemeStore((s) => s.mode === "dark")

  useEffect(() => {
    setOnNavigateToOrder((orderId) => navigate(`/orders/${orderId}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  // Горячие клавиши (см. hotkeys.ts): пробел — таймер, N — новый заказ, / — поиск.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = hotkeyFor(e)
      if (!action) return
      e.preventDefault()
      if (action === "timer") useTimerStore.getState().toggle()
      else if (action === "newOrder") navigate("/orders", { state: { newOrder: Date.now() } })
      else if (action === "search") {
        if (window.location.hash.startsWith("#/orders")) window.dispatchEvent(new Event("crm:focus-search"))
        else navigate("/orders", { state: { focusSearch: Date.now() } })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    restoreBackupDirectoryHandle()

    const INTERVAL_MS: Record<string, number> = { "1h": 3600000, "6h": 21600000, "24h": 86400000, "7d": 604800000 }
    const timer = window.setInterval(() => {
      const s = useAppStore.getState().backupSettings
      if (!s.enabled) return
      const periodMs = INTERVAL_MS[s.interval]
      if (periodMs && Date.now() - (s.lastBackup || 0) >= periodMs) {
        triggerDiskBackup()
      }
    }, 60000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="flex min-h-screen">
      <GlassBackdrop />

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/55 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside
        className={cn(
          "sidebar-glass fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col gap-1 overflow-y-auto p-4 text-foreground transition-transform duration-200 md:static md:z-auto md:w-60 md:translate-x-0",
          isDark && "dark",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-2">
          <AccountSwitcher />
        </div>

        {NAV.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <div className="px-3 pt-3 pb-1.5 text-2xs font-extrabold tracking-wide text-muted-foreground uppercase">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-base font-bold transition-colors",
                    isActive || (item.match || []).some((m) => location.pathname.startsWith(m))
                      ? "bg-emphasis/88 text-emphasis-foreground"
                      : "text-muted-foreground hover:bg-overlay/10 hover:text-foreground"
                  )
                }
              >
                <item.icon className="size-4 shrink-0" strokeWidth={1.75} />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="flex-1" />

        <SidebarTimerCard />
        <SidebarFooter />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className={cn("glass-panel sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 px-4 py-3 text-foreground md:hidden", isDark && "dark")}>
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="flex size-8 items-center justify-center rounded-md text-foreground hover:bg-overlay/10"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-emphasis/90 font-heading text-2xs font-extrabold text-emphasis-foreground">Д</div>
          <div className="font-heading text-base font-extrabold tracking-tight">Дизайн · CRM</div>
        </div>

        <main className={cn("relative min-w-0 w-full flex-1 px-4 py-5 pb-12 text-foreground md:px-8 md:py-7", isDark && "dark")}>
          <div className="mx-auto" style={{ maxWidth: 1600 }}>
            {/* Разделы грузятся отдельными кусками (см. App.tsx), поэтому
                Suspense стоит здесь, а не вокруг всего шелла: при переходе
                должна ждать только область страницы, а сайдбар с таймером —
                оставаться на месте. */}
            <Suspense fallback={<div className="min-h-[60vh]" />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      <ToastRoot />
      <AppDialogRoot />
    </div>
  )
}

function SidebarFooter() {
  const syncStatus = useAppStore((s) => s.syncStatus)
  const syncError = useAppStore((s) => s.syncError)
  const schemaIssue = useAppStore((s) => s.schemaIssue)
  const backupSettings = useAppStore((s) => s.backupSettings)
  const backupDirAccess = useAppStore((s) => s.backupDirAccess)
  const navigate = useNavigate()
  const [sqlCopied, setSqlCopied] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)

  // Бэкап на диск не пишется: нет доступа к папке (браузер требует
  // подтверждать его кликом) или последний файл старше двух дней. Раньше
  // это было видно только в Справочниках, и бэкап молча стоял с 21 августа.
  // «Сейчас» — состояние, а не Date.now() в рендере: обновляется раз в десять
  // минут, чтобы счётчик дней не застывал в долгой сессии.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 600000)
    return () => window.clearInterval(t)
  }, [])
  const daysSinceBackup = backupSettings.lastBackup ? Math.floor((now - backupSettings.lastBackup) / 86400000) : null
  const backupStale = backupSettings.enabled && (!backupDirAccess || daysSinceBackup === null || daysSinceBackup >= 2)

  async function fixBackup() {
    setBackupBusy(true)
    try {
      if (!backupDirAccess) {
        const ok = await confirmBackupDirectoryAccess()
        if (!ok) navigate("/settings")
      } else {
        await triggerDiskBackup()
      }
    } finally {
      setBackupBusy(false)
    }
  }

  async function copySql() {
    try {
      await navigator.clipboard.writeText(REQUIRED_SQL)
      setSqlCopied(true)
      setTimeout(() => setSqlCopied(false), 2500)
    } catch {
      window.prompt("Скопируйте SQL и выполните в Supabase → SQL Editor:", REQUIRED_SQL)
    }
  }

  return (
    <div className="pt-3">
      {/* Уведомления свёрнуты в строку (SidebarNotice): подробности по клику. */}
      {syncStatus === "failed" && (
        <SidebarNotice tone="danger" icon={CloudOff} title="Не сохранено в облако" defaultOpen>
          {syncError && <div>{syncError}</div>}
          <SidebarNoticeButton onClick={retryCloudSync}>Повторить сейчас</SidebarNoticeButton>
        </SidebarNotice>
      )}
      {backupStale && (
        <SidebarNotice tone="notice" icon={HardDrive} title="Бэкап на диск не пишется">
          <div>
            {!backupDirAccess ? "Нужно подтвердить доступ к папке — браузер спрашивает после перезапуска." : daysSinceBackup === null ? "Ещё ни разу не записан." : `Последний файл ${daysSinceBackup} дн. назад.`}
          </div>
          <SidebarNoticeButton onClick={fixBackup} disabled={backupBusy}>{!backupDirAccess ? "Подтвердить доступ" : "Записать сейчас"}</SidebarNoticeButton>
        </SidebarNotice>
      )}
      {schemaIssue && (
        <SidebarNotice tone="notice" icon={Database} title="Нужно обновить базу">
          <div>{SCHEMA_ISSUE_TEXT[schemaIssue] || schemaIssue}</div>
          <SidebarNoticeButton onClick={copySql}>{sqlCopied ? "Скопировано" : "Скопировать SQL"}</SidebarNoticeButton>
          <div className="mt-1">Вставить в Supabase → SQL Editor → Run, затем обновить страницу.</div>
        </SidebarNotice>
      )}
      {/* Версия внизу сайдбара: по скриншоту сразу видно, какая сборка у
          пользователя. Горячие клавиши — подсказкой при наведении. */}
      <div className="cursor-default text-center text-2xs font-semibold text-muted-foreground" title={HOTKEY_HINT}>v{APP_VERSION}</div>
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-base text-muted-foreground">{subtitle}</p>
      </div>
      {actions}
    </div>
  )
}
