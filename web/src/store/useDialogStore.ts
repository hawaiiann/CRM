import { create } from "zustand"

/**
 * Подтверждения и сообщения приложения вместо системных confirm()/alert().
 *
 * Браузерные окна выбивались из интерфейса целиком: своя типографика, чужие
 * кнопки «ОК/Отмена» поверх всего, никакой темы, а в тексте — только plain
 * text. При этом подтверждения тут содержательные (что именно изменится при
 * отвязке урока, чем грозит удаление позиции справочника), и читать их в
 * системном окне неудобно.
 *
 * Сделано на сторе, а не на React-контексте, намеренно: вызывать нужно и из
 * обычных модулей (diskBackup, cloudSync), где хуков нет. Функции ниже
 * возвращают промис и работают откуда угодно.
 */
export interface DialogRequest {
  id: string
  kind: "confirm" | "alert"
  title: string
  /** Пояснение. Переводы строк сохраняются. */
  body?: string
  /** Пункты списком — для перечислений вроде «что именно изменится». */
  bullets?: string[]
  /** Приписка под списком — то, что читается последним («деньги не тронем»). */
  note?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Красная кнопка подтверждения — для удаления и прочего необратимого. */
  destructive?: boolean
  resolve: (ok: boolean) => void
}

interface DialogState {
  queue: DialogRequest[]
  push: (r: DialogRequest) => void
  settle: (id: string, ok: boolean) => void
}

export const useDialogStore = create<DialogState>((set, get) => ({
  queue: [],
  push: (r) => set((s) => ({ queue: [...s.queue, r] })),
  settle: (id, ok) => {
    const req = get().queue.find((r) => r.id === id)
    set((s) => ({ queue: s.queue.filter((r) => r.id !== id) }))
    req?.resolve(ok)
  },
}))

function nextId() {
  return "dlg" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

type ConfirmOptions = Omit<DialogRequest, "id" | "kind" | "resolve">

/** Спросить подтверждение. Промис отвечает true, если человек согласился. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().push({ id: nextId(), kind: "confirm", ...options, resolve })
  })
}

/** Показать сообщение, которое нужно прочитать. Промис ждёт закрытия. */
export function alertDialog(options: Omit<ConfirmOptions, "cancelLabel" | "destructive">): Promise<void> {
  return new Promise((resolve) => {
    useDialogStore.getState().push({ id: nextId(), kind: "alert", ...options, resolve: () => resolve() })
  })
}
