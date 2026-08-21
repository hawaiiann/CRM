import fs from "node:fs"
import path from "node:path"
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Сборка кладётся прямо в корень репозитория, потому что GitHub Pages отдаёт
// корень ветки main. Значит emptyOutDir обязан быть false — иначе Vite снесёт
// весь репозиторий. Обратная сторона: старые файлы сами не убираются, поэтому
// папку assets (её содержимое целиком принадлежит Vite и имена хэшированные)
// чистим перед каждой сборкой сами. Ничего, кроме неё, не трогаем.
function cleanRootAssets(): Plugin {
  return {
    name: "clean-root-assets",
    buildStart() {
      const dir = path.resolve(import.meta.dirname, "../assets")
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Приложение стало основным и живёт на https://hawaiiann.github.io/CRM/.
  // Прежняя ванильная версия осталась рабочей на /CRM/legacy/ как запасной вариант.
  base: '/CRM/',
  build: {
    outDir: '..',
    emptyOutDir: false,
  },
  plugins: [react(), tailwindcss(), cleanRootAssets()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})
