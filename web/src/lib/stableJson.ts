/**
 * Сравнение данных без оглядки на порядок ключей.
 *
 * Облако хранит вложенные объекты (позиции заказа, оплаты, пункты урока) в
 * jsonb, а jsonb переупорядочивает ключи по-своему. Поэтому «то же самое»
 * после загрузки из облака и локальная копия давали разные JSON.stringify —
 * и после каждой загрузки первое же сохранение переотправляло ВСЕ заказы как
 * «изменённые». Это и трафик, и главное — устаревшая вкладка так затирала
 * свежие правки другой: см. upsertWithConflictCheck в cloudSync.ts.
 */
export function canon(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return canon(a) === canon(b)
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    Object.keys(value as Record<string, unknown>).sort().forEach((k) => {
      const v = (value as Record<string, unknown>)[k]
      if (v !== undefined) out[k] = sortKeys(v)
    })
    return out
  }
  return value
}
