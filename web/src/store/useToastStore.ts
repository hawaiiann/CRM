import { create } from "zustand"

export interface AppToast {
  id: string
  title: string
  sub: string
  danger?: boolean
  onClick?: () => void
}

interface ToastState {
  toasts: AppToast[]
  addToast: (t: Omit<AppToast, "id">, durationMs?: number) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  addToast: (t, durationMs = 7000) => {
    const id = "toast" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }))
    setTimeout(() => get().removeToast(id), durationMs)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))
