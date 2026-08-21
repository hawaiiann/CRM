import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Поле со справочником: свободный ввод + раскрывающийся список значений.
 *
 * Раньше здесь стоял нативный <datalist>, и это была ошибка переноса: datalist —
 * не выпадающий список, а автодополнение. Он показывает только то, что совпадает
 * с уже введённым текстом, поэтому в заполненном поле («Слайд») предлагался
 * ровно один вариант, а остальные значения справочника увидеть было нельзя —
 * поле выглядело сломанным.
 *
 * Это порт combo-field из legacy/js/orders.js: по кнопке-стрелке открывается
 * ВЕСЬ список, ввод его фильтрует, свои значения вписывать по-прежнему можно.
 * Список рендерится тут же, а не в портале — иначе клик по варианту глотает
 * модальное окно (Radix Dialog перехватывает события снаружи своего поддерева).
 */
export function ComboInput({
  value,
  onChange,
  options,
  placeholder,
  className,
  id,
  inputClassName,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  className?: string
  id?: string
  inputClassName?: string
}) {
  const [open, setOpen] = useState(false)
  // Фильтруем только когда пользователь печатает. Если список открыт кнопкой,
  // показываем всё целиком — ради этого всё и затевалось.
  const [typing, setTyping] = useState(false)
  // Куда раскрывать список. Он лежит внутри формы с overflow-y-auto, а такой
  // контейнер обрезает всё, что вылезает за его край: у поля в нижней части
  // формы список уходил под обрез. Поэтому при нехватке места снизу
  // раскрываем вверх и заодно ограничиваем высоту доступным местом.
  const [drop, setDrop] = useState<{ up: boolean; maxH: number }>({ up: false, maxH: 224 })
  const wrapRef = useRef<HTMLDivElement>(null)

  // Ближайший предок, который реально обрезает содержимое. Именно он, а не
  // окно, задаёт границы: у модального окна своя прокрутка внутри.
  function clipBounds(): { top: number; bottom: number } {
    let el = wrapRef.current?.parentElement
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      if (cs.overflowY === "auto" || cs.overflowY === "scroll" || cs.overflowY === "hidden") {
        const r = el.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom }
      }
      el = el.parentElement
    }
    return { top: 0, bottom: window.innerHeight }
  }

  function decideDirection() {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    const b = clipBounds()
    const below = b.bottom - r.bottom - 8
    const above = r.top - b.top - 8
    // Вверх — только если снизу действительно тесно, а сверху заметно просторнее.
    const up = below < 140 && above > below
    setDrop({ up, maxH: Math.max(96, Math.min(224, Math.floor(up ? above : below))) })
  }

  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); e.stopPropagation() }
    }
    document.addEventListener("mousedown", onDocDown)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("mousedown", onDocDown)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [open])

  const q = value.trim().toLowerCase()
  const list = typing && q ? options.filter((o) => o.toLowerCase().includes(q)) : options

  function pick(v: string) {
    onChange(v)
    setOpen(false)
    setTyping(false)
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setTyping(true); decideDirection(); setOpen(true) }}
        onFocus={() => { setTyping(false); decideDirection(); setOpen(true) }}
        className={cn(
          "h-9 w-full rounded-md border border-border bg-background px-3 pr-8 text-[13px] outline-none",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          inputClassName
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Показать список"
        onClick={() => { setTyping(false); decideDirection(); setOpen((v) => !v) }}
        className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          style={{ maxHeight: drop.maxH }}
          className={cn(
            "absolute right-0 left-0 z-50 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg",
            drop.up ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]"
          )}
        >
          {list.length === 0 ? (
            <div className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
              {options.length ? "Ничего не найдено" : "Справочник пуст"}
            </div>
          ) : (
            list.map((o) => (
              <button
                key={o}
                type="button"
                // mousedown, а не click: input теряет фокус раньше, и click по
                // варианту иногда не доходил.
                onMouseDown={(e) => { e.preventDefault(); pick(o) }}
                className={cn(
                  "block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-muted",
                  o === value && "font-bold"
                )}
              >
                {o}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
