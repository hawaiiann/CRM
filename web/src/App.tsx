import { lazy } from "react"
import { HashRouter, Routes, Route } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppShell } from "@/components/layout/AppShell"
import { AuthGate } from "@/components/auth/AuthGate"
import { DashboardPage } from "@/features/dashboard/DashboardPage"
import { DashboardPreviewHarness } from "@/features/dashboard/DashboardPreviewHarness"

// Дашборд грузится сразу — это стартовый экран, откладывать его нечего.
// Остальные разделы приезжают при первом заходе в них: всё приложение одним
// куском весило больше мегабайта, и при открытии дашборда в него входили
// Финансы с таблицами, Планирование и Настройки, которые могут не понадобиться
// за всю сессию.
const FinancePage = lazy(() => import("@/features/finance/FinancePage").then((m) => ({ default: m.FinancePage })))
const ClientsPage = lazy(() => import("@/features/clients/ClientsPage").then((m) => ({ default: m.ClientsPage })))
const OrdersPage = lazy(() => import("@/features/orders/OrdersPage").then((m) => ({ default: m.OrdersPage })))
const TimelinePage = lazy(() => import("@/features/timeline/TimelinePage").then((m) => ({ default: m.TimelinePage })))
const TasksPage = lazy(() => import("@/features/tasks/TasksPage").then((m) => ({ default: m.TasksPage })))
const PlanningPage = lazy(() => import("@/features/planning/PlanningPage").then((m) => ({ default: m.PlanningPage })))
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })))

function App() {
  // Dev-only. Раньше харнесс был доступен и в проде: он подменяет стор
  // мок-данными, а любое действие внутри него вызывает saveData(), которая
  // пишет эти моки в БОЕВЫЕ ключи localStorage (design_crm_orders_v10 и др.)
  // и попадает в автобэкап. Облако спасал только незаданный cloudUserId.
  // Если облачная загрузка потом падала, из кэша поднимались фейковые заказы.
  // endsWith, а не строгое равенство: после переезда приложения на /CRM/ у
  // dev-сервера появился тот же base, и путь стал /CRM/__dashboard-preview.
  if (import.meta.env.DEV && window.location.pathname.endsWith("/__dashboard-preview")) {
    return <DashboardPreviewHarness />
  }
  return (
    <TooltipProvider delayDuration={200}>
      <AuthGate>
        {/* HashRouter, а не BrowserRouter: GitHub Pages — статика и про
            клиентский роутинг не знает, поэтому F5 на /CRM/app/orders — это
            запрос несуществующего файла. Обычное лекарство (404.html рядом с
            приложением) здесь не работает: Pages берёт 404.html только из
            корня сайта, а корень занят ванильной версией, и трогать её
            поведение ради этого не хочется. С hash-навигацией сервер вообще
            не участвует — путь живёт после #, обновление страницы работает
            всегда. Проверено вживую: с 404.html deep-link отдавал страницу
            "Page not found" от GitHub. */}
        <HashRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="finance" element={<FinancePage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="timeline" element={<TimelinePage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="planning" element={<PlanningPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </HashRouter>
      </AuthGate>
    </TooltipProvider>
  )
}

export default App
