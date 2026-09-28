import { sameData } from "./stableJson"

/**
 * Трёхстороннее слияние при загрузке из облака и после долгого простоя вкладки.
 *
 * Есть три версии каждой записи: локальная (что видит человек), облачная
 * (что лежит на сервере) и снимок (что облако знало в последний раз, когда
 * эта вкладка с ним сверялась). По ним понятно, кто менял запись:
 *
 *   локальная ≠ снимок, облако = снимок  → правили только здесь, не успело
 *                                          уйти (перезагрузка раньше отправки,
 *                                          обрыв сети) — берём локальную;
 *   локальная = снимок, облако ≠ снимок  → правили на другом устройстве —
 *                                          берём облако;
 *   обе ≠ снимок                         → правили и там и тут — сливаем по
 *                                          полям (mergeFields): поле, которое
 *                                          меняли только здесь, остаётся
 *                                          здешним; поле, менявшееся с обеих
 *                                          сторон, берётся из облака, и потеря
 *                                          честно считается (dropped);
 *   локальной нет в облаке и в снимке    → создана здесь офлайн — оставляем;
 *   локальная есть в снимке, но не в облаке → удалена на другом устройстве.
 *
 * Раньше загрузка просто брала облако целиком: закрытый за секунду до
 * перезагрузки заказ «возвращался» в очередь, а неотправленная правка
 * терялась молча. А при правке с двух сторон целиком побеждало облако —
 * даже если здесь меняли статус, а там заметку.
 */
export interface MergeResult<T> {
  merged: T[]
  /** Локальных неотправленных правок, которые сохранены (целиком или по полям). */
  kept: number
  /** Локальных правок, проигравших облаку (одно и то же поле менялось и там и тут). */
  dropped: number
}

export interface FieldMerge<T> {
  value: T
  /** Хотя бы одно поле взято из локальной версии — её надо отправить. */
  usedLocal: boolean
  /** Хотя бы одно поле менялось с обеих сторон по-разному — взято облако. */
  conflict: boolean
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x)
}

/**
 * Слияние одной записи по полям. depth — на сколько уровней вложенных
 * объектов спускаться: 1 — поля записи сравниваются целиком (массив позиций
 * заказа — одно поле); 2 — ещё и ключи внутри полей-словарей (настройки:
 * boardSchedules[id доски] сливаются по доскам). Массивы всегда целиком.
 */
export function mergeFields<T>(local: T, cloud: T, snap: unknown, depth = 1): FieldMerge<T> {
  if (sameData(local, snap)) return { value: cloud, usedLocal: false, conflict: false }
  if (sameData(cloud, snap)) return { value: local, usedLocal: true, conflict: false }
  if (sameData(local, cloud)) return { value: cloud, usedLocal: false, conflict: false }
  if (depth <= 0 || !isPlainObject(local) || !isPlainObject(cloud)) return { value: cloud, usedLocal: false, conflict: true }

  const s = isPlainObject(snap) ? snap : {}
  const out: Record<string, unknown> = {}
  let usedLocal = false
  let conflict = false
  const keys = new Set([...Object.keys(local), ...Object.keys(cloud)])
  keys.forEach((k) => {
    const m = mergeFields(local[k], cloud[k], s[k], depth - 1)
    if (m.usedLocal) usedLocal = true
    if (m.conflict) conflict = true
    if (m.value !== undefined) out[k] = m.value
  })
  return { value: out as T, usedLocal, conflict }
}

export function mergeUnsentLocal<T extends { id: string }>(
  local: T[],
  cloud: T[],
  prevSnapshot: Record<string, unknown>,
  shape: (item: T) => unknown = (x) => x
): MergeResult<T> {
  const localById = new Map(local.map((x) => [x.id, x]))
  const cloudIds = new Set(cloud.map((x) => x.id))
  let kept = 0
  let dropped = 0

  const merged: T[] = cloud.map((c) => {
    const l = localById.get(c.id)
    if (!l) return c
    const snap = prevSnapshot[c.id]
    if (snap === undefined) return c
    const ls = shape(l)
    if (sameData(ls, snap)) return c
    const cs = shape(c)
    if (sameData(cs, snap)) { kept++; return l }
    // Правили и там и тут: по полям. Сливаются только поля, которые есть в
    // снимке (shape) — у доски, например, уроки живут отдельно.
    const m = mergeFields(ls, cs, snap, 1)
    if (m.conflict) dropped++
    if (m.usedLocal) kept++
    return { ...c, ...(m.value as object) } as T
  })

  local.forEach((l) => {
    if (cloudIds.has(l.id)) return
    if (prevSnapshot[l.id] !== undefined) return // удалена на другом устройстве
    kept++
    merged.push(l)
  })

  return { merged, kept, dropped }
}
