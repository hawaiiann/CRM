import path from "node:path"
import { defineConfig } from "vitest/config"

// Отдельный конфиг, а не vite.config.ts: тому нужны плагины React/Tailwind и
// база /CRM/, а тестам — только алиас «@» и node-окружение. Тесты лежат рядом
// с чистыми модулями (src/lib/__tests__) и не трогают Supabase и стор.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
})
