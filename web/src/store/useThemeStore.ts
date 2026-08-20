// Светлая/тёмная тема — порт js/utils.js (setTheme). Тот же localStorage-ключ,
// чтобы предпочтение не сбрасывалось при параллельном использовании обеих версий.
import { create } from "zustand"

const THEME_KEY = "design_crm_theme"

export type ThemeMode = "light" | "dark"

function applyThemeClass(mode: ThemeMode) {
  document.documentElement.classList.toggle("dark", mode === "dark")
}

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: "light",
  setMode: (mode) => {
    applyThemeClass(mode)
    localStorage.setItem(THEME_KEY, mode)
    set({ mode })
  },
}))

// Применяет сохранённую тему сразу при загрузке модуля — до первого рендера,
// чтобы не было мигания светлой темой перед переключением на тёмную.
const stored = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"
applyThemeClass(stored)
useThemeStore.setState({ mode: stored })
