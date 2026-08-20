import { PageHeader } from "@/components/layout/AppShell"
import { CatalogList } from "./CatalogList"
import { DashboardMetricsSettings } from "./DashboardMetricsSettings"
import { OrderTemplatesSettings } from "./OrderTemplatesSettings"
import { BackupSettings } from "./BackupSettings"

export function SettingsPage() {
  return (
    <div>
      <PageHeader title="Справочники и настройки" subtitle="Настройка списков, заказчиков и автосохранения резервных копий" />

      <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        <CatalogList title="Заказчики" catalogKey="clients" />
        <CatalogList title="Типы работ" catalogKey="types" />
        <CatalogList title="Единицы измерения" catalogKey="units" />
        <CatalogList title="Предметы" catalogKey="subjects" />
        <CatalogList title="Классы" catalogKey="classes" />
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        <DashboardMetricsSettings />
        <OrderTemplatesSettings />
        <BackupSettings />
      </div>
    </div>
  )
}
