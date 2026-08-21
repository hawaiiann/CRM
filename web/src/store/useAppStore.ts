import { create } from "zustand"
import type {
  Order,
  Task,
  Advance,
  PlanningBoard,
  AppSettings,
  ActivityLogEntry,
  BackupSettings,
} from "@/types/models"
import { defaultAppSettings, defaultPlanningBoards } from "@/lib/normalize"
import { DEFAULT_BACKUP_PATH } from "@/lib/version"

type Updater<T> = T | ((prev: T) => T)

function resolve<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === "function" ? (updater as (prev: T) => T)(prev) : updater
}

export type SyncStatus = "idle" | "syncing" | "healthy" | "failed"

interface AppState {
  // auth
  authLoading: boolean
  cloudUserId: string | null
  cloudUserEmail: string | null
  addAccountOverlayOpen: boolean

  // data — mirrors the vanilla app's global mutable arrays 1:1
  orders: Order[]
  tasks: Task[]
  advances: Advance[]
  planningBoards: PlanningBoard[]
  appSettings: AppSettings
  activityLog: ActivityLogEntry[]
  backupSettings: BackupSettings

  // data-loaded gate — the UI shows a loading state until the first cloud
  // pull (or local-storage fallback) has completed once
  dataLoaded: boolean

  // sync status surfaced in the UI (sidebar indicator)
  syncStatus: SyncStatus

  setAuth: (userId: string | null, email: string | null) => void
  setAuthLoading: (v: boolean) => void
  setAddAccountOverlayOpen: (v: boolean) => void
  setDataLoaded: (v: boolean) => void
  setSyncStatus: (v: SyncStatus) => void

  setOrders: (u: Updater<Order[]>) => void
  setTasks: (u: Updater<Task[]>) => void
  setAdvances: (u: Updater<Advance[]>) => void
  setPlanningBoards: (u: Updater<PlanningBoard[]>) => void
  setAppSettings: (u: Updater<AppSettings>) => void
  setActivityLog: (u: Updater<ActivityLogEntry[]>) => void
  setBackupSettings: (u: Updater<BackupSettings>) => void
}

export const useAppStore = create<AppState>((set) => ({
  authLoading: true,
  cloudUserId: null,
  cloudUserEmail: null,
  addAccountOverlayOpen: false,

  orders: [],
  tasks: [],
  advances: [],
  planningBoards: defaultPlanningBoards(),
  appSettings: defaultAppSettings(),
  activityLog: [],
  backupSettings: { enabled: true, interval: "change", path: DEFAULT_BACKUP_PATH, lastBackup: 0, excludedAccounts: [] },

  dataLoaded: false,
  syncStatus: "idle",

  setAuth: (userId, email) => set({ cloudUserId: userId, cloudUserEmail: email }),
  setAuthLoading: (v) => set({ authLoading: v }),
  setAddAccountOverlayOpen: (v) => set({ addAccountOverlayOpen: v }),
  setDataLoaded: (v) => set({ dataLoaded: v }),
  setSyncStatus: (v) => set({ syncStatus: v }),

  setOrders: (u) => set((s) => ({ orders: resolve(u, s.orders) })),
  setTasks: (u) => set((s) => ({ tasks: resolve(u, s.tasks) })),
  setAdvances: (u) => set((s) => ({ advances: resolve(u, s.advances) })),
  setPlanningBoards: (u) => set((s) => ({ planningBoards: resolve(u, s.planningBoards) })),
  setAppSettings: (u) => set((s) => ({ appSettings: resolve(u, s.appSettings) })),
  setActivityLog: (u) => set((s) => ({ activityLog: resolve(u, s.activityLog) })),
  setBackupSettings: (u) => set((s) => ({ backupSettings: resolve(u, s.backupSettings) })),
}))
