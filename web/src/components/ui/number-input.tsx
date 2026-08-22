import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { parseNum } from "@/lib/money"

/**
 * Числовое поле со свободным вводом.
 *
 * Раньше такие поля хранили число и прогоняли ввод через parseNum на КАЖДОЕ
 * нажатие. Из-за этого дробное значение нельзя было набрать вообще: печатаешь
 * «1», потом «.», parseNum превращает «1.» обратно в 1 — и точка исчезает,
 * до «1.5» не добраться. По той же причине не стирался ноль: пустая строка
 * давала 0, поле тут же снова показывало «0».
 *
 * Здесь текст живёт своей жизнью, пока поле в фокусе: наверх уходит уже
 * разобранное число, а в поле остаётся ровно то, что набрал пользователь —
 * включая незавершённое «1.» и запятую «2,5». Когда фокус уходит, показываем
 * нормализованное значение из модели.
 */
export function NumberInput({
  value,
  onChange,
  className,
  placeholder,
  title,
  inputMode = "decimal",
}: {
  value: number
  onChange: (n: number) => void
  className?: string
  placeholder?: string
  title?: string
  inputMode?: "decimal" | "numeric"
}) {
  const [text, setText] = useState(() => String(value ?? 0))
  const focused = useRef(false)

  // Пока поле не в фокусе, оно следует за моделью: значение могли изменить
  // снаружи (шаблон, «заполнить остаток», сброс формы).
  useEffect(() => {
    if (!focused.current) setText(String(value ?? 0))
  }, [value])

  return (
    <Input
      inputMode={inputMode}
      className={className}
      placeholder={placeholder}
      title={title}
      value={text}
      onFocus={(e) => {
        focused.current = true
        // Ноль по умолчанию мешает: чаще всего его сразу стирают.
        if (text === "0") setText("")
        e.currentTarget.select()
      }}
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseNum(e.target.value))
      }}
      onBlur={() => {
        focused.current = false
        setText(String(parseNum(text)))
      }}
    />
  )
}
