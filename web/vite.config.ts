import fs from "node:fs"
import path from "node:path"
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages отдаёт статику и не знает про клиентский роутинг: заход на
// /CRM/app/orders или F5 на нём — это запрос несуществующего файла, то есть
// 404. Приём стандартный: положить рядом 404.html — копию index.html. Pages
// отдаст её, приложение загрузится, а BrowserRouter разберёт настоящий путь
// из адресной строки сам.
function spaFallback(): Plugin {
  return {
    name: "spa-fallback-404",
    closeBundle() {
      const outDir = path.resolve(import.meta.dirname, "../app")
      const index = path.join(outDir, "index.html")
      if (fs.existsSync(index)) fs.copyFileSync(index, path.join(outDir, "404.html"))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Приложение публикуется на https://hawaiiann.github.io/CRM/app/ рядом с
  // ванильной версией, которая остаётся на /CRM/. Сборка кладётся в /app/ в
  // корне репозитория, потому что Pages отдаёт корень ветки main.
  base: '/CRM/app/',
  build: {
    outDir: '../app',
    emptyOutDir: true,
  },
  plugins: [react(), tailwindcss(), spaFallback()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})
