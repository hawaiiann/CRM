/**
 * Горячие клавиши на весь экран. Работают только когда фокус не в поле ввода
 * и не открыт диалог: иначе пробел в заметке запускал бы таймер.
 *
 *   пробел — старт/пауза таймера
 *   N (Т)  — новый заказ (список заказов открывает форму)
 *   /      — поиск по заказам
 */
export type HotkeyAction = "timer" | "newOrder" | "search"

export function hotkeyFor(e: KeyboardEvent): HotkeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return null
  if (t && t.closest("[role=dialog], [role=menu], [role=listbox]")) return null
  if (document.querySelector("[role=dialog][data-state=open]")) return null
  if (e.key === " " || e.code === "Space") return "timer"
  const k = e.key.toLowerCase()
  if (k === "n" || k === "т") return "newOrder"
  if (k === "/") return "search"
  return null
}

export const HOTKEY_HINT = "Пробел — таймер · N — новый заказ · / — поиск"
