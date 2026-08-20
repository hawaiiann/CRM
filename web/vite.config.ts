import path from "node:path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})
