// Справочники с учётом скрытых записей — порт getVisibleCatalog/catalogWithCurrent
// из legacy/js/utils.js. В React-версии этой фильтрации не было вовсе: значения
// брались из appSettings напрямую, поэтому запись, выключенная «глазом» в
// Справочниках, продолжала предлагаться в форме заказа.
import type { AppSettings } from "@/types/models"

export type CatalogKey = "clients" | "types" | "units" | "subjects" | "classes"

export function getVisibleCatalog(settings: AppSettings, key: CatalogKey): string[] {
  const list = settings[key] || []
  const hidden = settings.hiddenEntries?.[key] || []
  return list.filter((v) => !hidden.includes(v))
}

// Как getVisibleCatalog, но гарантированно включает текущее значение поля, даже
// если оно скрыто — иначе список молча «потеряет» уже выбранное значение, и при
// открытии старого заказа поле выглядело бы пустым.
export function catalogWithCurrent(settings: AppSettings, key: CatalogKey, current?: string): string[] {
  const visible = getVisibleCatalog(settings, key)
  if (current && !visible.includes(current)) return [...visible, current]
  return visible
}
