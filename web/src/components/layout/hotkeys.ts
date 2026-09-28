/**
 * Горячие клавиши на весь экран. Работают только когда фокус не в поле ввода
 * и не открыт диалог: иначе пробел в заметке запускал бы таймер.
 *
 *   пробел — старт/пауза таймера
 *   N (Т)  — новый заказ (список заказов открывает форму)
 *   /      — поиск по заказам
 */
export type HotkeyAction = "timer" | "newOrder" | "search"

// Фокус на кнопке, выпадающем списке, галочке, вкладке: пробел там нажимает
// сам элемент. Раньше вместе с этим запускался и таймер, а «т», набранная в
// выпадающем списке для поиска пункта, открывала форму нового заказа.
// Ссылки не в списке: пробел их не нажимает, после клика по пункту меню
// таймер должен по-прежнему включаться пробелом.
const INTERACTIVE = "button, [role=button], [role=combobox], [role=checkbox], [role=switch], [role=tab], [role=menuitem], [role=option], [role=radio], [role=slider]"

export function hotkeyFor(e: KeyboardEvent): HotkeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return null
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return null
  if (t && typeof t.closest === "function" && t.closest(INTERACTIVE)) return null
  if (t && t.closest("[role=dialog], [role=menu], [role=listbox]")) return null
  if (document.querySelector("[role=dialog][data-state=open]")) return null
  if (e.key === " " || e.code === "Space") return "timer"
  const k = e.key.toLowerCase()
  if (k === "n" || k === "т") return "newOrder"
  if (k === "/") return "search"
  return null
}

export const HOTKEY_HINT = "Пробел — таймер · N — новый заказ · / — поиск"
