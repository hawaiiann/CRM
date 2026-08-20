import { WebGLShaderBackground } from "@/components/ui/webgl-shader-background"
import { useThemeStore } from "@/store/useThemeStore"

// Тёмная тема — WebGL-шейдер (собственный код, без Three.js) с движущейся
// светящейся дугой. Fixed на весь экран, чтобы не обрезалось высотой
// контента. Светлая тема — шейдер тюнингован под тёмный фон и на светлом
// читается плохо, так что вместо него простой светлый градиент (тот же,
// что body использует как --app-bg-gradient в light-теме).
export function GlassBackdrop() {
  const isDark = useThemeStore((s) => s.mode === "dark")

  if (!isDark) {
    return (
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ background: "linear-gradient(160deg, #FAFAF8 0%, #F5F5F2 55%, #F0F0EC 100%)" }}
      />
    )
  }

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black">
      <WebGLShaderBackground className="h-full w-full" />
    </div>
  )
}
