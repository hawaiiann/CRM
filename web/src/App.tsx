import { HashRouter, Routes, Route } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppShell } from "@/components/layout/AppShell"
import { AuthGate } from "@/components/auth/AuthGate"
import { DashboardPage } from "@/features/dashboard/DashboardPage"
import { FinancePage } from "@/features/finance/FinancePage"
import { ClientsPage } from "@/features/clients/ClientsPage"
import { OrdersPage } from "@/features/orders/OrdersPage"
import { TimelinePage } from "@/features/timeline/TimelinePage"
import { TasksPage } from "@/features/tasks/TasksPage"
import { PlanningPage } from "@/features/planning/PlanningPage"
import { SettingsPage } from "@/features/settings/SettingsPage"
import { DashboardPreviewHarness } from "@/features/dashboard/DashboardPreviewHarness"

function App() {
  // Dev-only. Раньше харнесс был доступен и в проде: он подменяет стор
  // мок-данными, а любое действие внутри него вызывает saveData(), которая
  // пишет эти моки в БОЕВЫЕ ключи localStorage (design_crm_orders_v10 и др.)
  // и попадает в автобэкап. Облако спасал только незаданный cloudUserId.
  // Если облачная загрузка потом падала, из кэша поднимались фейковые заказы.
  if (import.meta.env.DEV && window.location.pathname === "/__dashboard-preview") {
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
