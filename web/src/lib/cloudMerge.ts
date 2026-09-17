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
 *   обе ≠ снимок                         → правили и там и тут — берём облако
 *                                          и честно считаем потерю (dropped);
 *   локальной нет в облаке и в снимке    → создана здесь офлайн — оставляем;
 *   локальная есть в снимке, но не в облаке → удалена на другом устройстве.
 *
 * Раньше загрузка просто брала облако целиком: закрытый за секунду до
 * перезагрузки заказ «возвращался» в очередь, а неотправленная правка
 * терялась молча.
 */
export interface MergeResult<T> {
  merged: T[]
  /** Локальных неотправленных правок, которые сохранены. */
  kept: number
  /** Локальных правок, проигравших облаку (менялось и там и тут). */
  dropped: number
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
    const localChanged = !sameData(shape(l), snap)
    if (!localChanged) return c
    const cloudChanged = !sameData(shape(c), snap)
    if (cloudChanged) { dropped++; return c }
    kept++
    return l
  })

  local.forEach((l) => {
    if (cloudIds.has(l.id)) return
    if (prevSnapshot[l.id] !== undefined) return // удалена на другом устройстве
    kept++
    merged.push(l)
  })

  return { merged, kept, dropped }
}
