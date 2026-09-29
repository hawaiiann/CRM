import { useThemeStore } from "@/store/useThemeStore"

// Фон страницы на весь экран, неподвижный в обеих темах (см. .app-backdrop в
// index.css). В тёмной теме здесь раньше был WebGL-шейдер с движущейся дугой:
// он перерисовывался каждый кадр, а стеклянные карточки над ним каждый кадр
// заново размывали то, что под ними.
export function GlassBackdrop() {
  const isDark = useThemeStore((s) => s.mode === "dark")
  return <div className={isDark ? "app-backdrop-dark pointer-events-none fixed inset-0 -z-10" : "app-backdrop pointer-events-none fixed inset-0 -z-10"} />
}
