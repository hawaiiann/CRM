import { useEffect, useState, type ReactNode } from "react"
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom"
import {
  LayoutGrid,
  BarChart3,
  Users,
  FileText,
  GanttChartSquare,
  CheckCircle2,
  CalendarDays,
  Database,
  CloudOff,
  Sun,
  Moon,
  Menu,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"
import { useTimerStore } from "@/store/useTimerStore"
import { useThemeStore } from "@/store/useThemeStore"
import { restoreBackupDirectoryHandle, triggerDiskBackup } from "@/lib/diskBackup"
import { SidebarTimerCard } from "./SidebarTimerCard"
import { ToastRoot } from "./ToastRoot"
import { AccountSwitcher } from "./AccountSwitcher"
import { GlassBackdrop } from "@/features/dashboard/GlassBackdrop"
import { APP_VERSION } from "@/lib/version"

type NavItem = {
  label: string
  icon: typeof LayoutGrid
  to: string
}

type NavGroup = {
  label: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    label: "Обзор",
    items: [
      { label: "Дашборд", icon: LayoutGrid, to: "/" },
      { label: "Финансы", icon: BarChart3, to: "/finance" },
      { label: "Клиенты", icon: Users, to: "/clients" },
    ],
  },
  {
    label: "Работа",
    items: [
      { label: "Заказы", icon: FileText, to: "/orders" },
      { label: "Таймлайн", icon: GanttChartSquare, to: "/timeline" },
      { label: "Задачи", icon: CheckCircle2, to: "/tasks" },
      { label: "Планирование", icon: CalendarDays, to: "/planning" },
    ],
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
    setOnNavigateToOrder(() => navigate("/orders"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

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
            <div className="px-3 pt-3 pb-1.5 text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-full px-3.5 py-2.5 text-[13.5px] font-bold transition-colors",
                    isActive
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
        <ThemeToggle />
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
          <div className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-emphasis/90 font-heading text-[11px] font-extrabold text-emphasis-foreground">Д</div>
          <div className="font-heading text-[14px] font-extrabold tracking-tight">Дизайн · CRM</div>
        </div>

        <main className={cn("relative min-w-0 w-full flex-1 px-4 py-5 pb-12 text-foreground md:px-8 md:py-7", isDark && "dark")}>
          <div className="mx-auto" style={{ maxWidth: 1600 }}>
            <Outlet />
          </div>
        </main>
      </div>

      <ToastRoot />
    </div>
  )
}

function ThemeToggle() {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)

  return (
    <div className="mb-1 flex gap-1 rounded-lg bg-muted p-1">
      <button
        type="button"
        onClick={() => setMode("light")}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-bold transition-colors",
          mode === "light" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Sun className="size-3.5" strokeWidth={1.8} />
        Светлая
      </button>
      <button
        type="button"
        onClick={() => setMode("dark")}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-bold transition-colors",
          mode === "dark" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Moon className="size-3.5" strokeWidth={1.8} />
        Тёмная
      </button>
    </div>
  )
}

function SidebarFooter() {
  const syncStatus = useAppStore((s) => s.syncStatus)

  return (
    <div className="pt-3">
      {syncStatus === "failed" && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11px] font-bold text-destructive">
          <CloudOff className="size-3.5 shrink-0" />
          Не сохранено в облако
        </div>
      )}
      {/* Версия внизу сайдбара — как было в ванильной версии: по скриншоту
          сразу видно, какая сборка у пользователя. Без разделителя: линия
          отсекала подпись от таймера и выглядела лишней рамкой. */}
      <div className="text-center text-[11px] font-semibold text-muted-foreground">v{APP_VERSION}</div>
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-heading text-[30px] font-bold tracking-tight">{title}</h1>
        <p className="text-[13.5px] text-muted-foreground">{subtitle}</p>
      </div>
      {actions}
    </div>
  )
}
