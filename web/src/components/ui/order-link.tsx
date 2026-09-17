import { Link, useLocation, type LinkProps } from "react-router-dom"

/**
 * Ссылка на карточку заказа, которая помнит, откуда пришли.
 *
 * Карточка живёт по адресу /orders/:id, то есть поверх списка заказов. Из
 * Финансов, «Сегодня» или урока по ссылке попадали в список и после закрытия
 * карточки там и оставались — назад к прежнему месту дороги не было. Теперь
 * адрес, с которого перешли, едет в state, и закрытие карточки возвращает
 * туда (см. OrdersPage).
 */
export function OrderLink({ orderId, ...props }: Omit<LinkProps, "to"> & { orderId: string }) {
  const location = useLocation()
  return <Link to={`/orders/${orderId}`} state={{ from: location.pathname + location.search }} {...props} />
}
