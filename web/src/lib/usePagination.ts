import { useMemo, useState } from "react"

/**
 * Пагинация списка: номер страницы, размер, срез и сброс на первую страницу
 * при смене фильтров.
 *
 * Это было расписано руками в пяти местах (Заказы, Клиенты, Финансы —
 * реестр и авансы) одинаковыми четырьмя строками, и в одном из них разошлось:
 * на Заказах кнопки «назад/вперёд» считали от СЫРОГО номера страницы, а не от
 * обрезанного. Если список укорачивался не из-за фильтра (удалили заказ,
 * пришли данные из облака), сброса не происходило, номер оставался большим —
 * на экране «страница 2 из 2», а кнопка «назад» вела с несуществующей пятой
 * на четвёртую и внешне не делала ничего.
 *
 * Сброс сделан не эффектом, а сравнением ключа прямо в рендере. Так советует
 * документация React для состояния, зависящего от других состояний: эффект
 * тут даёт лишний коммит — страница успевает отрисоваться со старым номером,
 * и только потом сбрасывается.
 */
export function usePagination<T>(
  items: T[],
  options: {
    /** Строка из значений фильтров и сортировки: сменилась — уходим на первую страницу. */
    resetKey: string
    initialSize?: number
  }
) {
  const [pageSize, setPageSize] = useState(options.initialSize ?? 10)
  const [rawPage, setRawPage] = useState(0)
  const [seenKey, setSeenKey] = useState(options.resetKey)

  if (options.resetKey !== seenKey) {
    setSeenKey(options.resetKey)
    setRawPage(0)
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(rawPage, totalPages - 1)

  const pageItems = useMemo(
    () => items.slice(page * pageSize, page * pageSize + pageSize),
    [items, page, pageSize]
  )

  return {
    /** Уже обрезанный номер страницы — считать от него, а не от сырого. */
    page,
    pageSize,
    totalPages,
    pageItems,
    setPage: (next: number) => setRawPage(Math.max(0, Math.min(totalPages - 1, next))),
    setPageSize: (next: number) => {
      setPageSize(next)
      setRawPage(0)
    },
  }
}
