/* ============================================================
 * cloudSync.ts — облачная синхронизация с Supabase.
 * Порт js/cloudSync.js + js/db.js один в один: тот же diff-по-id против
 * последнего отправленного снимка (cloudSnapshot), та же защита от гонки
 * через updated_at, та же терпимость к недостающим колонкам схемы, тот же
 * realtime-приём с фильтром "не затирать неотправленную локальную правку".
 *
 * Отличие от оригинала — не архитектурное, а механическое: вместо глобальных
 * `let orders = ...` здесь чтение/запись идёт через useAppStore.getState()/
 * setOrders(...), потому что состояние теперь должно быть иммутабельным для
 * React. Сам алгоритм (что, когда и в каком порядке отправляется/принимается)
 * не менялся.
 * ============================================================ */
import { supabaseClient } from "./supabase"
import { useAppStore } from "@/store/useAppStore"
import {
  normalizeOrder,
  normalizeTask,
  normalizeAdvance,
  applySettingsMigrations,
  defaultPlanningBoards,
} from "./normalize"
import { orderPaymentsTotal, parseNum, dateKey } from "./money"
import { syncPlanningWithOrders } from "./planningSync"
import { scheduleDiskBackup } from "./diskBackup"
import {
  STORAGE_KEY,
  SETTINGS_KEY,
  TASKS_KEY,
  ADVANCES_KEY,
  PLANNING_KEY,
  ACTIVITY_LOG_KEY,
  BACKUP_CFG_KEY,
  CLOUD_SNAPSHOT_KEY,
  accountKey,
} from "./storageKeys"
import { rememberDelete, forgetDelete, isPendingDelete, pendingDeleteEntries, setPendingDeletesScope } from "./pendingDeletes"
import { useToastStore } from "@/store/useToastStore"
import { actualHours } from "./activity"
import { wasAccountSeeded, markAccountSeeded } from "./activitySeed"
import { mergeHoursEntry, setEntryDelta, setDayHours, compactLog } from "./journal"
import { sameData } from "./stableJson"
import { mergeUnsentLocal } from "./cloudMerge"
import type { Order, Task, Advance, PlanningBoard, PlanningLesson, ActivityLogEntry, AppSettings } from "@/types/models"

type Row = Record<string, any>

/* ---------- JS-объект <-> строка таблицы ---------- */

function orderToRow(o: Order, userId: string): Row {
  return {
    id: o.id, user_id: userId, title: o.title || "", client: o.client || "", subject: o.subject || "",
    grade: o.grade || "", quarter: o.quarter || "", lesson: o.lesson || "", status: o.status || "queue",
    is_paid: !!o.isPaid, priority: !!o.priority, advance_used: parseNum(o.advanceUsed),
    // Колонка advance_allocations (jsonb) новая — см. CHANGELOG v2.22.0. Пока её
    // нет в базе, она отбрасывается (stripKnownMissingColumns), остальное идёт.
    advance_allocations: o.advanceAllocations || [],
    payments: o.payments || [],
    paid_amount: orderPaymentsTotal(o),
    tax_type: o.taxType || "none", start_date: o.start || null, deadline: o.deadline || null,
    estimated_hours: String(o.estimatedHours ?? ""), actual_hours: String(o.actualHours ?? ""),
    lines: o.lines || [], notes: o.notes || "", created_at: o.createdAt || Date.now(),
    linked_lesson_id: o.linkedLessonId || null,
    paid_at: o.paidAt || null,
  }
}
function rowToOrder(r: Row): Partial<Order> {
  return {
    id: r.id, title: r.title || "", client: r.client || "", subject: r.subject || "",
    grade: r.grade || "", quarter: r.quarter || "", lesson: r.lesson || "", status: r.status || "queue",
    isPaid: !!r.is_paid, priority: !!r.priority, advanceUsed: r.advance_used || 0,
    advanceAllocations: Array.isArray(r.advance_allocations) ? r.advance_allocations : [],
    payments: Array.isArray(r.payments) ? r.payments : [],
    paidAmount: r.paid_amount || 0,
    taxType: r.tax_type || "none", start: r.start_date || "", deadline: r.deadline || "",
    estimatedHours: r.estimated_hours ?? "", actualHours: r.actual_hours ?? "",
    lines: r.lines || [], notes: r.notes || "", createdAt: r.created_at || Date.now(),
    linkedLessonId: r.linked_lesson_id || null,
    paidAt: r.paid_at || (r.is_paid && r.updated_at ? dateKey(new Date(r.updated_at)) : null),
  }
}

function taskToRow(t: Task, userId: string): Row {
  return { id: t.id, user_id: userId, text: t.text || "", time: t.time || "", done: !!t.done, period: t.period || "today", created_at: t.createdAt || "" }
}
function rowToTask(r: Row): Partial<Task> {
  return { id: r.id, text: r.text || "", time: r.time || "", done: !!r.done, period: r.period || "today", createdAt: r.created_at || "" }
}

function advanceToRow(a: Advance, userId: string): Row {
  return { id: a.id, user_id: userId, client: a.client || "", amount: parseNum(a.amount), date: a.date || null, note: a.note || "" }
}
function rowToAdvance(r: Row): Partial<Advance> {
  return { id: r.id, client: r.client || "", amount: r.amount || 0, date: r.date || "", note: r.note || "" }
}

function boardToRow(b: PlanningBoard, userId: string): Row {
  return {
    id: b.id, user_id: userId, subject: b.subject || "", title: b.title || "", quarter: b.quarter || "",
    deadline: b.deadline || null, base_template: b.baseTemplate || [], collapsed: !!b.collapsed, archived: !!b.archived,
  }
}
function rowToBoard(r: Row): PlanningBoard {
  return { id: r.id, subject: r.subject || "", title: r.title || "", quarter: r.quarter || "", deadline: r.deadline || "", baseTemplate: r.base_template || [], collapsed: !!r.collapsed, archived: !!r.archived, lessons: [] }
}
function boardSnapshotShape(b: PlanningBoard) {
  return { id: b.id, subject: b.subject || "", title: b.title || "", quarter: b.quarter || "", deadline: b.deadline || "", baseTemplate: JSON.parse(JSON.stringify(b.baseTemplate || [])), collapsed: !!b.collapsed, archived: !!b.archived }
}

function lessonToRow(l: PlanningLesson & { boardId: string }, userId: string): Row {
  return {
    id: l.id, user_id: userId, board_id: l.boardId, num: l.num || 0, title: l.title || "", color: l.color || "gray",
    items: l.items || [], color_locked: !!l.colorLocked, order_linked: !!l.orderLinked, notes: l.notes || "",
  }
}
function rowToLesson(r: Row): PlanningLesson {
  return { id: r.id, num: r.num || 0, title: r.title || "", color: r.color || "gray", items: r.items || [], colorLocked: !!r.color_locked, orderLinked: !!r.order_linked, notes: r.notes || "" }
}

/* ---------- Снимок последнего отправленного/полученного состояния ---------- */

interface CloudSnapshot {
  orders: Record<string, any>
  tasks: Record<string, any>
  advances: Record<string, any>
  planningBoards: Record<string, any>
  planningLessons: Record<string, any>
  appSettings: AppSettings | null
  activityLogSyncedCount: number
  activityLogSyncedIds: Set<string>
  // Что именно облако знает по каждой записи журнала (число часов и день).
  // Запись дня теперь ПРАВИТСЯ, а не только добавляется (см. lib/journal.ts),
  // и без этого снимка не понять, какие строки надо обновить в облаке.
  activityLogSynced: Record<string, { delta: number; date: string }>
  updatedAt: {
    orders: Record<string, string>
    tasks: Record<string, string>
    advances: Record<string, string>
    planningBoards: Record<string, string>
    planningLessons: Record<string, string>
  }
}

const cloudSnapshot: CloudSnapshot = {
  orders: {}, tasks: {}, advances: {}, planningBoards: {}, planningLessons: {},
  appSettings: null, activityLogSyncedCount: 0, activityLogSyncedIds: new Set(), activityLogSynced: {},
  updatedAt: { orders: {}, tasks: {}, advances: {}, planningBoards: {}, planningLessons: {} },
}

function rememberSyncedEntry(e: ActivityLogEntry) {
  if (!e.entryId) return
  cloudSnapshot.activityLogSyncedIds.add(e.entryId)
  cloudSnapshot.activityLogSynced[e.entryId] = { delta: e.delta, date: e.date }
}

function resetSyncedEntries(log: ActivityLogEntry[]) {
  cloudSnapshot.activityLogSyncedIds = new Set()
  cloudSnapshot.activityLogSynced = {}
  log.forEach(rememberSyncedEntry)
  cloudSnapshot.activityLogSyncedCount = log.length
}

/* ---------- Ключи локального кэша: свои у каждого аккаунта ---------- */

function lsKey(base: string): string {
  return accountKey(base, useAppStore.getState().cloudUserId)
}

/* ---------- Снимок облака переживает перезагрузку ----------
 * Снимок — это то, относительно чего считается «что изменилось локально».
 * Раньше он жил только в памяти: если облако при старте не ответило и данные
 * поднялись из кэша, снимок оставался пустым, ВСЁ считалось новым, и при
 * первой же синхронизации локальный (возможно, устаревший) кэш перезаписывал
 * более свежее облако. Теперь снимок хранится рядом с кэшем, а если его нет
 * (старый кэш) — перед первой отправкой сверяемся с облаком заново.
 */
let snapshotTrusted = false
const SNAPSHOT_VERSION = 2

function persistSnapshot() {
  try {
    localStorage.setItem(lsKey(CLOUD_SNAPSHOT_KEY), JSON.stringify({
      version: SNAPSHOT_VERSION,
      orders: cloudSnapshot.orders,
      tasks: cloudSnapshot.tasks,
      advances: cloudSnapshot.advances,
      planningBoards: cloudSnapshot.planningBoards,
      planningLessons: cloudSnapshot.planningLessons,
      appSettings: cloudSnapshot.appSettings,
      activityLogSynced: cloudSnapshot.activityLogSynced,
      activityLogSyncedCount: cloudSnapshot.activityLogSyncedCount,
      updatedAt: cloudSnapshot.updatedAt,
    }))
  } catch (err) {
    console.error("Не удалось сохранить снимок облака:", err)
  }
}

function restoreSnapshot(): boolean {
  try {
    const raw = localStorage.getItem(lsKey(CLOUD_SNAPSHOT_KEY))
    if (!raw) return false
    const s = JSON.parse(raw)
    if (!s || typeof s !== "object" || !s.updatedAt) return false
    cloudSnapshot.orders = s.orders || {}
    cloudSnapshot.tasks = s.tasks || {}
    cloudSnapshot.advances = s.advances || {}
    cloudSnapshot.planningBoards = s.planningBoards || {}
    cloudSnapshot.planningLessons = s.planningLessons || {}
    cloudSnapshot.appSettings = s.appSettings || null
    cloudSnapshot.activityLogSynced = s.activityLogSynced || {}
    cloudSnapshot.activityLogSyncedIds = new Set(Object.keys(cloudSnapshot.activityLogSynced))
    cloudSnapshot.activityLogSyncedCount = s.activityLogSyncedCount || 0
    cloudSnapshot.updatedAt = { orders: {}, tasks: {}, advances: {}, planningBoards: {}, planningLessons: {}, ...s.updatedAt }
    return true
  } catch {
    return false
  }
}

function snapshotCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function diffById<T extends { id: string }>(arr: T[]): Record<string, T> {
  const map: Record<string, T> = {}
  arr.forEach((item) => { map[item.id] = item })
  return map
}

// Сравнение без учёта порядка ключей: jsonb в облаке переставляет ключи во
// вложенных объектах, и JSON.stringify считал «изменёнными» все заказы после
// каждой загрузки (см. lib/stableJson.ts).
function collectionChanged<T>(currentMap: Record<string, T>, snapshotMap: Record<string, any>): T[] {
  const toUpsert: T[] = []
  for (const id in currentMap) {
    if (!sameData(currentMap[id], snapshotMap[id])) toUpsert.push(currentMap[id])
  }
  return toUpsert
}

/* ---------- Устойчивость к незавершённой миграции схемы ---------- */
const missingColumnsByTable: Record<string, Set<string>> = {}

function stripKnownMissingColumns(table: string, payload: Row): Row {
  const missing = missingColumnsByTable[table]
  if (!missing || !missing.size) return payload
  const copy = { ...payload }
  missing.forEach((col) => delete copy[col])
  return copy
}

function noteMissingColumn(table: string, error: any): boolean {
  const msg = String(error?.message || "")
  const match = msg.match(/'([^']+)' column/) || msg.match(/column "([^"]+)"/)
  if (!match) return false
  const col = match[1]
  if (!missingColumnsByTable[table]) missingColumnsByTable[table] = new Set()
  if (missingColumnsByTable[table].has(col)) return false
  missingColumnsByTable[table].add(col)
  console.warn(`В таблице "${table}" нет колонки "${col}" — она не будет сохраняться, пока не выполнен ALTER TABLE. Остальные поля синхронизируются как обычно.`)
  return true
}

async function tryConditionalUpdate<T>(
  table: string, id: string, item: T, toRowFn: (i: T) => Row, compareAt: string, updatedAtMap: Record<string, string>
): Promise<boolean> {
  const build = () => stripKnownMissingColumns(table, { ...toRowFn(item), updated_at: new Date().toISOString() })
  const run = (payload: Row) => supabaseClient.from(table).update(payload).eq("id", id).eq("updated_at", compareAt).select("updated_at")

  let { data, error } = await run(build())
  if (error && noteMissingColumn(table, error)) ({ data, error } = await run(build()))
  if (error) throw error
  if (!data || !data.length) return false
  updatedAtMap[id] = data[0].updated_at
  return true
}

async function resolveSyncConflict(table: string, id: string, updatedAtMap: Record<string, string>, mergeServerRow: (row: Row | null, id: string) => void) {
  const { data } = await supabaseClient.from(table).select("*").eq("id", id).maybeSingle()
  if (!data) { delete updatedAtMap[id]; mergeServerRow(null, id); return }
  updatedAtMap[id] = data.updated_at
  mergeServerRow(data, id)
}

/**
 * Отправка с проверкой на гонку. Условный UPDATE проходит только если
 * updated_at в облаке тот же, что мы видели в последний раз. Если нет —
 * запись менял кто-то ещё, и дальше важно, ЧТО именно изменилось:
 *
 *   содержимое в облаке = наш снимок   → просто уехала метка времени (например,
 *                                        ответ на наш же прошлый UPDATE не
 *                                        дошёл) — повторяем с новой меткой;
 *   содержимое в облаке = наша правка  → наш прошлый UPDATE на самом деле
 *                                        прошёл — ничего не шлём;
 *   иначе                              → настоящий конфликт: облако новее,
 *                                        берём его (resolveSyncConflict).
 *
 * Раньше при несовпадении метки запись повторялась со свежей меткой БЕЗ
 * сравнения содержимого — то есть устаревшая вкладка молча затирала правки,
 * сделанные на другом устройстве. Именно так «завершённый» урок после
 * перезагрузки оказывался снова в очереди.
 */
async function upsertWithConflictCheck<T extends { id: string }>(
  table: string, items: T[], toRowFn: (i: T) => Row,
  cloudSnapshotMap: Record<string, any>, updatedAtMap: Record<string, string>,
  mergeServerRow: (row: Row | null, id: string) => void,
  rowToShape?: (row: Row) => unknown
) {
  for (const item of items) {
    const id = item.id
    const known = updatedAtMap[id]
    try {
      if (known) {
        let applied = await tryConditionalUpdate(table, id, item, toRowFn, known, updatedAtMap)
        if (!applied) {
          const { data: freshRow } = await supabaseClient.from(table).select("*").eq("id", id).maybeSingle()
          if (freshRow) {
            const freshShape = rowToShape ? rowToShape(freshRow) : null
            if (rowToShape && sameData(freshShape, item)) {
              updatedAtMap[id] = freshRow.updated_at
              applied = true
            } else if (!rowToShape || sameData(freshShape, cloudSnapshotMap[id])) {
              applied = await tryConditionalUpdate(table, id, item, toRowFn, freshRow.updated_at, updatedAtMap)
            }
          }
        }
        if (!applied) { await resolveSyncConflict(table, id, updatedAtMap, mergeServerRow); continue }
      } else {
        const buildInsert = () => stripKnownMissingColumns(table, { ...toRowFn(item), updated_at: new Date().toISOString() })
        let { data, error } = await supabaseClient.from(table).insert(buildInsert()).select("updated_at").single()
        if (error && noteMissingColumn(table, error)) {
          ({ data, error } = await supabaseClient.from(table).insert(buildInsert()).select("updated_at").single())
        }
        if (error) {
          const { data: fresh } = await supabaseClient.from(table).select("updated_at").eq("id", id).maybeSingle()
          if (!fresh) throw error
          const applied = await tryConditionalUpdate(table, id, item, toRowFn, fresh.updated_at, updatedAtMap)
          if (!applied) { await resolveSyncConflict(table, id, updatedAtMap, mergeServerRow); continue }
        } else {
          updatedAtMap[id] = data!.updated_at
        }
      }
      cloudSnapshotMap[id] = snapshotCopy(item)
    } catch (err) {
      console.error(`Ошибка синхронизации записи (${table}/${id}):`, err)
      markSyncFailed(errorText(err))
    }
  }
}

/* ---------- Единственная точка настоящего удаления записи из облака ---------- */
/* ---------- Неподтверждённые удаления ----------
 * Сама очередь живёт в pendingDeletes.ts, здесь — работа с облаком.
 */

/** Убирает запись из снимка — иначе снимок расходится с реальностью. */
function dropFromSnapshot(table: string, id: string) {
  const maps: Record<string, Record<string, unknown>> = {
    orders: cloudSnapshot.orders,
    tasks: cloudSnapshot.tasks,
    advances: cloudSnapshot.advances,
    planning_boards: cloudSnapshot.planningBoards,
    planning_lessons: cloudSnapshot.planningLessons,
  }
  const map = maps[table]
  if (map) delete map[id]
}

// activity_log — единственная таблица, где клиентский идентификатор это не
// "id" (его назначает сервер), а "entry_id". Остальной механизм очереди тот
// же самый, поэтому не заводим отдельный путь, а просто бьём по нужной колонке.
// Псевдотаблица "activity_log@order" — удаление всех записей журнала по
// заказу: раньше оно шло мимо очереди и при сбое сети терялось молча.
export const ACTIVITY_BY_ORDER = "activity_log@order"

function deleteTarget(table: string): { table: string; column: string } {
  if (table === "activity_log") return { table, column: "entry_id" }
  if (table === ACTIVITY_BY_ORDER) return { table: "activity_log", column: "order_id" }
  return { table, column: "id" }
}

/** Одна попытка удаления. true — облако подтвердило. */
async function tryDelete(table: string, id: string): Promise<boolean> {
  try {
    const target = deleteTarget(table)
    const { error } = await supabaseClient.from(target.table).delete().eq(target.column, id)
    if (error) throw error
    forgetDelete(table, id)
    dropFromSnapshot(table, id)
    return true
  } catch (err) {
    console.error(`Не удалось удалить запись из облака (${table}/${id}):`, err)
    lastSyncError = errorText(err)
    return false
  }
}

/** Повтор всех неподтверждённых удалений. Вызывается при каждой синхронизации. */
async function flushPendingDeletes() {
  let allOk = true
  for (const { table, id } of pendingDeleteEntries()) {
    if (!(await tryDelete(table, id))) allOk = false
  }
  if (!allOk) markSyncFailed("не прошло удаление")
}

export async function deleteFromCloud(table: string, id: string) {
  if (!id) return
  // В очередь ставим всегда, даже без облачного аккаунта: запись могла быть
  // заведена в другой сессии, и удаление должно дойти, когда вход появится.
  rememberDelete(table, id)
  dropFromSnapshot(table, id)
  if (!useAppStore.getState().cloudUserId) return
  if (!(await tryDelete(table, id))) markSyncFailed("не прошло удаление")
}

/**
 * Удаляет отдельные записи журнала активности — единственный способ поправить
 * неверно посчитанные часы (например записанные по ошибке ранних версий,
 * см. lib/activity.ts). Точечного удаления не было вовсе: журнал только
 * пополнялся, и ошибочную запись нельзя было убрать иначе как стерев вообще
 * все записи заказа через deleteActivityLogForOrder.
 */
export function deleteActivityLogEntries(entries: ActivityLogEntry[]) {
  if (!entries.length) return
  const toRemove = new Set(entries)
  useAppStore.getState().setActivityLog((prev) => prev.filter((e) => !toRemove.has(e)))
  forgetEntriesInCloud(entries)
}

// Запись без entryId ещё не отправлена в облако — удалять там нечего.
function forgetEntriesInCloud(entries: ActivityLogEntry[]) {
  entries.forEach((e) => {
    if (!e.entryId) return
    cloudSnapshot.activityLogSyncedIds.delete(e.entryId)
    delete cloudSnapshot.activityLogSynced[e.entryId]
    deleteFromCloud("activity_log", e.entryId)
  })
}

/**
 * Единственный вход для «отработано ещё N часов по заказу за день». Таймер,
 * форма заказа и правка в календаре идут через него, поэтому в журнале на
 * день по заказу всегда одна строка (см. lib/journal.ts). Сохранение вызывает
 * тот, кто вызвал, — обычно оно всё равно идёт следом за правкой заказа.
 */
export function applyHoursDelta(orderId: string, date: string, delta: number) {
  const store = useAppStore.getState()
  const change = mergeHoursEntry(store.activityLog, orderId, date, delta)
  if (change.log === store.activityLog) return
  store.setActivityLog(change.log)
  forgetEntriesInCloud(change.removed)
}

/** Поправить число у конкретной записи; ноль убирает её. */
export function setActivityEntryDelta(entry: ActivityLogEntry, delta: number) {
  const store = useAppStore.getState()
  const change = setEntryDelta(store.activityLog, entry, delta)
  if (change.log === store.activityLog) return
  store.setActivityLog(change.log)
  forgetEntriesInCloud(change.removed)
}

/** Задать дню по заказу точное число часов (таблица правки журнала). */
export function setJournalDayHours(orderId: string, date: string, hours: number) {
  const store = useAppStore.getState()
  const change = setDayHours(store.activityLog, orderId, date, hours)
  if (change.log === store.activityLog) return
  store.setActivityLog(change.log)
  forgetEntriesInCloud(change.removed)
}

/** Схлопнуть старые построчные записи до одной на день и заказ. Возвращает, сколько строк ушло. */
export function compactJournal(): number {
  const store = useAppStore.getState()
  const change = compactLog(store.activityLog)
  if (change.log === store.activityLog) return 0
  store.setActivityLog(change.log)
  forgetEntriesInCloud(change.removed)
  return change.removed.length
}

/** Удалить из облака все записи журнала по заказу — через очередь, как и всё остальное. */
export function deleteActivityLogForOrder(orderId: string) {
  if (!orderId) return
  // Локально записи уже отфильтрованы вызывающим кодом; из снимка их надо
  // убрать самим, иначе они числятся «отправленными» и не переотправятся.
  const alive = new Set(useAppStore.getState().activityLog.map((e) => e.entryId).filter(Boolean))
  Object.keys(cloudSnapshot.activityLogSynced).forEach((entryId) => {
    if (!alive.has(entryId)) { delete cloudSnapshot.activityLogSynced[entryId]; cloudSnapshot.activityLogSyncedIds.delete(entryId) }
  })
  cloudSnapshot.activityLogSyncedCount = useAppStore.getState().activityLog.length
  deleteFromCloud(ACTIVITY_BY_ORDER, orderId)
}

async function deleteObsoleteJournalFieldsFromCloud(fields: string[]) {
  const userId = useAppStore.getState().cloudUserId
  if (!userId || !fields.length) return
  try {
    const { error } = await supabaseClient.from("activity_log").delete().eq("user_id", userId).in("field", fields)
    if (error) throw error
    resetSyncedEntries(useAppStore.getState().activityLog)
  } catch (err) {
    console.error("Не удалось убрать устаревшие записи журнала из облака:", err)
    markSyncFailed(errorText(err))
  }
}

/* ---------- Отправка изменений в облако ---------- */

let cloudSyncInFlight = false
let cloudSyncPending = false
let cloudSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null

export async function performCloudSync() {
  const store = useAppStore.getState()
  const userId = store.cloudUserId
  if (!userId) return
  if (cloudSyncInFlight) { cloudSyncPending = true; return }
  cloudSyncInFlight = true
  useAppStore.getState().setSyncStatus("syncing")
  try {
    // Снимку облака верить нельзя (данные подняты из старого кэша без него):
    // сначала сверяемся с облаком, и только потом что-то отправляем.
    if (!snapshotTrusted) await reconcileWithCloud()

    // Сначала доводим до конца удаления, не подтверждённые прошлый раз, и
    // только потом отправляем изменения — иначе запись, которую не удалось
    // удалить, могла бы уехать обратно в облако как «изменённая».
    await flushPendingDeletes()

    const ordersMap = diffById(useAppStore.getState().orders)
    const ordersToUpsert = collectionChanged(ordersMap, cloudSnapshot.orders)
    if (ordersToUpsert.length) {
      await upsertWithConflictCheck("orders", ordersToUpsert, (o) => orderToRow(o, userId), cloudSnapshot.orders, cloudSnapshot.updatedAt.orders, (row, id) => {
        if (row) {
          const o = normalizeOrder(rowToOrder(row), useAppStore.getState().appSettings)
          useAppStore.getState().setOrders((prev) => {
            const idx = prev.findIndex((x) => x.id === o.id)
            const next = idx >= 0 ? prev.map((x, i) => (i === idx ? o : x)) : [...prev, o]
            return next
          })
          cloudSnapshot.orders[o.id] = snapshotCopy(o)
        } else {
          useAppStore.getState().setOrders((prev) => prev.filter((x) => x.id !== id))
          delete cloudSnapshot.orders[id]
        }
        resyncPlanning()
      }, (row) => snapshotCopy(normalizeOrder(rowToOrder(row), useAppStore.getState().appSettings)))
    }

    const tasksMap = diffById(useAppStore.getState().tasks)
    const tasksToUpsert = collectionChanged(tasksMap, cloudSnapshot.tasks)
    if (tasksToUpsert.length) {
      await upsertWithConflictCheck("tasks", tasksToUpsert, (t) => taskToRow(t, userId), cloudSnapshot.tasks, cloudSnapshot.updatedAt.tasks, (row, id) => {
        if (row) {
          const t = normalizeTask(rowToTask(row))
          useAppStore.getState().setTasks((prev) => {
            const idx = prev.findIndex((x) => x.id === t.id)
            return idx >= 0 ? prev.map((x, i) => (i === idx ? t : x)) : [...prev, t]
          })
          cloudSnapshot.tasks[t.id] = snapshotCopy(t)
        } else {
          useAppStore.getState().setTasks((prev) => prev.filter((x) => x.id !== id))
          delete cloudSnapshot.tasks[id]
        }
      }, (row) => snapshotCopy(normalizeTask(rowToTask(row))))
    }

    const advMap = diffById(useAppStore.getState().advances)
    const advToUpsert = collectionChanged(advMap, cloudSnapshot.advances)
    if (advToUpsert.length) {
      await upsertWithConflictCheck("advances", advToUpsert, (a) => advanceToRow(a, userId), cloudSnapshot.advances, cloudSnapshot.updatedAt.advances, (row, id) => {
        if (row) {
          const a = normalizeAdvance(rowToAdvance(row))
          useAppStore.getState().setAdvances((prev) => {
            const idx = prev.findIndex((x) => x.id === a.id)
            return idx >= 0 ? prev.map((x, i) => (i === idx ? a : x)) : [...prev, a]
          })
          cloudSnapshot.advances[a.id] = snapshotCopy(a)
        } else {
          useAppStore.getState().setAdvances((prev) => prev.filter((x) => x.id !== id))
          delete cloudSnapshot.advances[id]
        }
      }, (row) => snapshotCopy(normalizeAdvance(rowToAdvance(row))))
    }

    const boardsMap = diffById(useAppStore.getState().planningBoards.map(boardSnapshotShape) as any)
    const boardsToUpsert = collectionChanged(boardsMap, cloudSnapshot.planningBoards)
    if (boardsToUpsert.length) {
      await upsertWithConflictCheck("planning_boards", boardsToUpsert as any[], (b: any) => boardToRow(b, userId), cloudSnapshot.planningBoards, cloudSnapshot.updatedAt.planningBoards, (row, id) => {
        if (row) {
          const rowBoard = rowToBoard(row)
          useAppStore.getState().setPlanningBoards((prev) => {
            const existing = prev.find((b) => b.id === rowBoard.id)
            if (existing) return prev.map((b) => (b.id === rowBoard.id ? { ...rowBoard, lessons: existing.lessons } : b))
            return [...prev, rowBoard]
          })
          cloudSnapshot.planningBoards[rowBoard.id] = boardSnapshotShape(rowBoard)
        } else {
          useAppStore.getState().setPlanningBoards((prev) => prev.filter((b) => b.id !== id))
          delete cloudSnapshot.planningBoards[id]
        }
      }, (row) => boardSnapshotShape(rowToBoard(row)))
    }

    const allLessons: (PlanningLesson & { boardId: string })[] = []
    useAppStore.getState().planningBoards.forEach((b) => (b.lessons || []).forEach((l) => allLessons.push({ ...l, boardId: b.id })))
    const lessonsMap = diffById(allLessons)
    const lessonsToUpsert = collectionChanged(lessonsMap, cloudSnapshot.planningLessons)
    if (lessonsToUpsert.length) {
      await upsertWithConflictCheck("planning_lessons", lessonsToUpsert, (l) => lessonToRow(l, userId), cloudSnapshot.planningLessons, cloudSnapshot.updatedAt.planningLessons, (row, id) => {
        if (row) {
          const lesson = rowToLesson(row)
          useAppStore.getState().setPlanningBoards((prev) =>
            prev.map((b) => {
              if (b.id !== row.board_id) return b
              const idx = b.lessons.findIndex((l) => l.id === lesson.id)
              const lessons = idx >= 0 ? b.lessons.map((l, i) => (i === idx ? lesson : l)) : [...b.lessons, lesson]
              return { ...b, lessons }
            })
          )
          cloudSnapshot.planningLessons[lesson.id] = snapshotCopy({ ...lesson, boardId: row.board_id })
        } else {
          useAppStore.getState().setPlanningBoards((prev) => prev.map((b) => ({ ...b, lessons: b.lessons.filter((l) => l.id !== id) })))
          delete cloudSnapshot.planningLessons[id]
        }
      }, (row) => snapshotCopy({ ...rowToLesson(row), boardId: row.board_id }))
    }

    const appSettings = useAppStore.getState().appSettings
    if (!sameData(appSettings, cloudSnapshot.appSettings)) {
      await supabaseClient.from("app_settings").upsert({ user_id: userId, data: appSettings })
      cloudSnapshot.appSettings = JSON.parse(JSON.stringify(appSettings))
    }

    await syncActivityLog()
    if (useAppStore.getState().syncStatus !== "failed") markSyncHealthy()
  } catch (err) {
    console.error("Ошибка облачной синхронизации:", err)
    markSyncFailed(errorText(err))
  } finally {
    // Снимок отражает то, что облако реально подтвердило, — даже если часть
    // отправки не прошла. Иначе после перезагрузки уже принятое ушло бы снова.
    if (snapshotTrusted) persistSnapshot()
    cloudSyncInFlight = false
    if (cloudSyncPending) { cloudSyncPending = false; performCloudSync() }
  }
}

/** Повтор по кнопке из сайдбара. */
export function retryCloudSync() {
  syncRetryAttempt = 0
  if (syncRetryTimer) { clearTimeout(syncRetryTimer); syncRetryTimer = null }
  performCloudSync()
}

function errorText(err: unknown): string {
  if (!err) return "неизвестная ошибка"
  if (typeof err === "string") return err
  const e = err as { message?: string; code?: string }
  const msg = e.message || String(err)
  if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) return "нет связи с облаком"
  if (/JWT|token|401|403/i.test(msg)) return "сессия устарела — войдите заново"
  return msg.length > 80 ? msg.slice(0, 77) + "…" : msg
}

function resyncPlanning() {
  const { orders, planningBoards, setPlanningBoards } = useAppStore.getState()
  setPlanningBoards(syncPlanningWithOrders(orders, planningBoards))
}

/* ---------- Журнал активности ---------- */
let activityLogSupportsEntryId = true

function makeEntryId(): string {
  return "al_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

async function syncActivityLog() {
  const userId = useAppStore.getState().cloudUserId
  if (!userId) return
  const activityLog = useAppStore.getState().activityLog

  if (activityLogSupportsEntryId) {
    // Сначала правки уже отправленных строк: запись дня по заказу теперь
    // накапливает часы, а не плодит новые строки (lib/journal.ts), поэтому
    // облако должно получать UPDATE, а не INSERT.
    const changed = activityLog.filter((e) => {
      if (!e.entryId) return false
      const known = cloudSnapshot.activityLogSynced[e.entryId]
      return !!known && (known.delta !== e.delta || known.date !== e.date)
    })
    for (const e of changed) {
      const { error } = await supabaseClient
        .from("activity_log")
        .update({ delta: e.delta, date: e.date })
        .eq("entry_id", e.entryId as string)
        .eq("user_id", userId)
      if (error) throw error
      rememberSyncedEntry(e)
    }

    const unsent = activityLog.filter((e) => !e.entryId || !cloudSnapshot.activityLogSyncedIds.has(e.entryId))
    if (!unsent.length) return
    unsent.forEach((e) => { if (!e.entryId) e.entryId = makeEntryId() })
    const rows = unsent.map((e) => ({ user_id: userId, entry_id: e.entryId, date: e.date, order_id: e.orderId, field: e.field, delta: e.delta }))
    // id строки нужен для realtime-DELETE: в событии удаления приходит только
    // серверный id, а не наш entry_id.
    const { data, error } = await supabaseClient.from("activity_log").insert(rows).select("id, entry_id")
    if (!error) {
      unsent.forEach(rememberSyncedEntry)
      ;(data || []).forEach((r: Row) => rememberServerId(r))
      cloudSnapshot.activityLogSyncedCount = activityLog.length
      return
    }
    if (String(error.message || "").includes("entry_id")) {
      activityLogSupportsEntryId = false
      console.warn("activity_log.entry_id отсутствует — используется прежняя позиционная отправка.")
    } else {
      throw error
    }
  }

  if (cloudSnapshot.activityLogSyncedCount > activityLog.length) cloudSnapshot.activityLogSyncedCount = activityLog.length
  if (activityLog.length > cloudSnapshot.activityLogSyncedCount) {
    const newEntries = activityLog.slice(cloudSnapshot.activityLogSyncedCount)
    const { error: logError } = await supabaseClient.from("activity_log").insert(newEntries.map((e) => ({ user_id: userId, date: e.date, order_id: e.orderId, field: e.field, delta: e.delta })))
    if (logError) throw logError
    cloudSnapshot.activityLogSyncedCount = activityLog.length
  }
}

export function scheduleCloudSync() {
  if (!useAppStore.getState().cloudUserId) return
  if (cloudSyncDebounceTimer) clearTimeout(cloudSyncDebounceTimer)
  cloudSyncDebounceTimer = setTimeout(performCloudSync, 600)
}

/* ---------- Индикатор состояния синхронизации ---------- */
let syncFailedSince: number | null = null
let syncRetryTimer: ReturnType<typeof setTimeout> | null = null
let syncRetryAttempt = 0

function scheduleSyncRetry() {
  if (syncRetryTimer) return
  const delays = [5000, 15000, 60000, 300000]
  const delay = delays[Math.min(syncRetryAttempt, delays.length - 1)]
  syncRetryAttempt++
  syncRetryTimer = setTimeout(() => { syncRetryTimer = null; performCloudSync() }, delay)
}

let lastSyncError: string | null = null

function markSyncFailed(reason?: string) {
  if (!syncFailedSince) syncFailedSince = Date.now()
  const text = reason || lastSyncError || "ошибка синхронизации"
  lastSyncError = null
  useAppStore.getState().setSyncStatus("failed", text)
  scheduleSyncRetry()
}
function markSyncHealthy() {
  syncRetryAttempt = 0
  if (syncRetryTimer) { clearTimeout(syncRetryTimer); syncRetryTimer = null }
  syncFailedSince = null
  useAppStore.getState().setSyncStatus("healthy")
}

function pluralRecords(n: number): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return "запись"
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "записи"
  return "записей"
}

/* ---------- Сверка после простоя ----------
 * Realtime доносит чужие правки только пока вкладка живёт и соединение цело.
 * После сна ноутбука, долгого простоя в фоне или обрыва сети события
 * теряются, и вкладка дальше работает со старыми данными — а при следующем
 * сохранении её версия уроков (они пересчитываются из заказов) уезжала бы в
 * облако. Теперь по возвращении вкладки данные сверяются заново, как при
 * загрузке: облако + неотправленные локальные правки.
 */
const REFRESH_AFTER_HIDDEN_MS = 90_000
let hiddenSince: number | null = null
let refreshInFlight = false

export async function refreshFromCloud() {
  if (refreshInFlight || cloudSyncInFlight) return
  if (!useAppStore.getState().cloudUserId) return
  refreshInFlight = true
  try {
    const local = readLocalBeforeLoad()
    // Память свежее кэша на диске? Кэш пишется при каждом saveData, поэтому нет.
    const state = buildStateFromCloud(await cloudLoadData())
    const merge = mergeLocalIntoState(state, local)
    applyCloudState(state)
    if (merge.kept > 0) scheduleCloudSync()
  } catch (e) {
    console.warn("Сверка с облаком после простоя не удалась:", e)
  } finally {
    refreshInFlight = false
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { if (syncFailedSince) performCloudSync(); else refreshFromCloud() })
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenSince = Date.now(); return }
    const away = hiddenSince ? Date.now() - hiddenSince : 0
    hiddenSince = null
    if (syncFailedSince) performCloudSync()
    else if (away >= REFRESH_AFTER_HIDDEN_MS) refreshFromCloud()
  })
}

/* ---------- Самопроверка синхронизации (кнопка в Справочниках) ---------- */
export async function runSyncSelfCheck(): Promise<string[] | null> {
  const userId = useAppStore.getState().cloudUserId
  if (!userId) throw new Error("Нет активной сессии — сначала войдите.")

  const [ordersRes, tasksRes, advRes, boardsRes, lessonsRes, logRes] = await Promise.all([
    supabaseClient.from("orders").select("*"),
    supabaseClient.from("tasks").select("*"),
    supabaseClient.from("advances").select("*"),
    supabaseClient.from("planning_boards").select("*"),
    supabaseClient.from("planning_lessons").select("*"),
    supabaseClient.from("activity_log").select("id"),
  ])

  const problems: string[] = []
  const store = useAppStore.getState()

  function compare<T extends { id: string }>(name: string, table: string, localArr: T[], cloudRows: Row[] | null, toRow: (x: T) => Row, rowToLocal: (r: Row) => T) {
    const cloudById: Record<string, Row> = {}
    ;(cloudRows || []).forEach((r) => { cloudById[r.id] = r })
    const localById: Record<string, T> = {}
    localArr.forEach((x) => { localById[x.id] = x })

    const missingInCloud = localArr.filter((x) => !cloudById[x.id]).length
    const missingLocally = (cloudRows || []).filter((r) => !localById[r.id]).length
    let different = 0
    localArr.forEach((x) => {
      const r = cloudById[x.id]
      if (!r) return
      // Колонки, которых в базе ещё нет, не сравниваем — они и не могли доехать.
      const a = stripKnownMissingColumns(table, toRow(x))
      const b = stripKnownMissingColumns(table, toRow(rowToLocal(r)))
      if (JSON.stringify(a) !== JSON.stringify(b)) different++
    })
    if (missingInCloud) problems.push(`${name}: нет в облаке — ${missingInCloud}`)
    if (missingLocally) problems.push(`${name}: есть в облаке, но нет здесь — ${missingLocally}`)
    if (different) problems.push(`${name}: расходится содержимое — ${different}`)
  }

  compare("Заказы", "orders", store.orders, ordersRes.data, (o) => orderToRow(o, userId), (r) => normalizeOrder(rowToOrder(r), store.appSettings))
  compare("Задачи", "tasks", store.tasks, tasksRes.data, (t) => taskToRow(t, userId), (r) => normalizeTask(rowToTask(r)))
  compare("Авансы", "advances", store.advances, advRes.data, (a) => advanceToRow(a, userId), (r) => normalizeAdvance(rowToAdvance(r)))
  compare("Доски планирования", "planning_boards", store.planningBoards, boardsRes.data, (b) => boardToRow(b, userId), rowToBoard)

  const localLessons: (PlanningLesson & { boardId: string })[] = []
  store.planningBoards.forEach((b) => (b.lessons || []).forEach((l) => localLessons.push({ ...l, boardId: b.id })))
  compare("Уроки", "planning_lessons", localLessons, lessonsRes.data, (l) => lessonToRow(l, userId), (r) => ({ ...rowToLesson(r), boardId: r.board_id }))

  const cloudLogCount = (logRes.data || []).length
  if (cloudLogCount !== store.activityLog.length) {
    problems.push(`Журнал статистики: здесь ${store.activityLog.length}, в облаке ${cloudLogCount}`)
  }

  return problems.length ? problems : null
}

/* ---------- Первая загрузка из облака ---------- */

const JOURNAL_OBSOLETE_FIELDS = ["revenue", "netRevenue", "presentations", "worksheets", "slides", "pages"]

function orderSeedDate(o: Order): string {
  if (o.start) return o.start
  if (o.deadline) return o.deadline
  if (o.createdAt) return dateKey(new Date(o.createdAt))
  return dateKey(new Date())
}

/**
 * Досев пустого журнала оценками часов по заказам — для тех, кто переходит
 * из версии, где журнала не было вовсе. Срабатывает не более одного раза на
 * аккаунт (см. lib/activitySeed.ts): второй пустой журнал у уже досеянного
 * аккаунта значит, что он опустел не просто потому, что его никогда не
 * было, а по какой-то другой причине — и досевать его выдумкой второй раз
 * нельзя.
 *
 * Часы считаются той же функцией, что и обычная запись в журнал
 * (actualHours из lib/activity.ts) — только факт и таймер, «План. часы» не
 * в счёт. Раньше здесь была отдельная копия с этим полем в приоритете, и
 * досев тянул в журнал не отработанное время, а оценки на будущее.
 */
function seedActivityLogIfEmpty(orders: Order[], activityLog: ActivityLogEntry[], scope: string): ActivityLogEntry[] {
  if (activityLog.length) return activityLog
  if (wasAccountSeeded(scope)) return activityLog
  const seeded: ActivityLogEntry[] = []
  orders.forEach((o) => {
    const hours = actualHours(o)
    if (hours) seeded.push({ date: orderSeedDate(o), orderId: o.id, field: "hours", delta: hours })
  })
  markAccountSeeded(scope)
  return seeded
}

function purgeObsoleteJournalFields(activityLog: ActivityLogEntry[]): { log: ActivityLogEntry[]; purged: number } {
  const before = activityLog.length
  const log = activityLog.filter((e) => !JOURNAL_OBSOLETE_FIELDS.includes(e.field))
  return { log, purged: before - log.length }
}

// Схлопывание журнала часов удалено целиком. Оно обнуляло entryId у объединённых
// записей, а syncActivityLog считает записи без entryId неотправленными — когда
// облако снова становилось доступно, они уезжали туда как новые поверх уже
// лежащих оригиналов, и часы задваивались. Раньше это прикрывалось сносом всех
// записей 'hours' из облака, но именно тот снос 20.08.2026 уничтожил журнал
// (45 настоящих записей), так что возвращать его нельзя. Само схлопывание было
// косметикой — те же данные, просто меньше строк.

// migratePaidFlagToAmount + migratePaidAmountToPayments folded into one step —
// same two-stage history as db.js, applied to a fresh orders array.
function migrateLegacyPayments(orders: Order[]): { orders: Order[]; migrated: number } {
  let migrated = 0
  const next = orders.map((o) => {
    let order = o
    if (order.isPaid && !parseNum(order.paidAmount) && !(order.payments && order.payments.length)) {
      // orderTotal needs lines/taxType only — safe to inline here without a circular import
      const base = (order.lines || []).reduce((s, l) => {
        if (l.ignorePrice) return s
        const isHourly = (l.type || "").toLowerCase().includes("час")
        return s + (isHourly ? parseNum(l.pomoHours) * parseNum(l.rate) : parseNum(l.qty) * parseNum(l.rate))
      }, 0)
      const rate = order.taxType === "individual" ? 0.04 : order.taxType === "entity" ? 0.06 : 0
      const full = Math.round(base * (1 + rate))
      const advUsed = Math.min(parseNum(order.advanceUsed), full)
      const rest = Math.max(0, Math.round((full - advUsed) * 100) / 100)
      if (rest > 0) { order = { ...order, paidAmount: rest }; migrated++ }
    }
    if (!(order.payments && order.payments.length) && parseNum(order.paidAmount) > 0) {
      order = {
        ...order,
        payments: [{ id: "legacy-" + order.id, amount: parseNum(order.paidAmount), date: order.paidAt || order.deadline || dateKey(new Date()), note: "" }],
      }
    }
    return order
  })
  return { orders: next, migrated }
}

async function cloudLoadData() {
  const [ordersRes, tasksRes, advRes, boardsRes, lessonsRes, settingsRes, logRes] = await Promise.all([
    supabaseClient.from("orders").select("*"),
    supabaseClient.from("tasks").select("*"),
    supabaseClient.from("advances").select("*"),
    supabaseClient.from("planning_boards").select("*"),
    supabaseClient.from("planning_lessons").select("*").order("num"),
    supabaseClient.from("app_settings").select("*").maybeSingle(),
    supabaseClient.from("activity_log").select("*").order("id"),
  ])
  ;[ordersRes, tasksRes, advRes, boardsRes, lessonsRes, logRes].forEach((r) => { if (r.error) throw r.error })
  if (settingsRes.error) throw settingsRes.error

  // Отсеиваем то, что уже удалено локально, но облако удаление ещё не
  // подтвердило. Без этого не дошедшее удаление отменялось перезагрузкой:
  // запись возвращалась на экран как ни в чём не бывало.
  const alive = (table: string) => (r: Row) => !isPendingDelete(table, r.id)

  const pulledOrdersRaw = (ordersRes.data || []).filter(alive("orders")).map(rowToOrder)
  const pulledTasks = (tasksRes.data || []).filter(alive("tasks")).map((r) => normalizeTask(rowToTask(r)))
  const pulledAdvances = (advRes.data || []).filter(alive("advances")).map((r) => normalizeAdvance(rowToAdvance(r)))
  const boards = (boardsRes.data || []).filter(alive("planning_boards")).map(rowToBoard)
  const boardsById: Record<string, PlanningBoard> = {}
  boards.forEach((b) => { boardsById[b.id] = b })
  ;(lessonsRes.data || []).filter(alive("planning_lessons")).forEach((r: Row) => {
    const board = boardsById[r.board_id]
    if (board) board.lessons.push(rowToLesson(r))
  })
  const pulledSettings = settingsRes.data ? (settingsRes.data as Row).data : null
  serverIdByEntry = {}
  entryByServerId = {}
  const pulledLog: ActivityLogEntry[] = (logRes.data || [])
    .filter((r: Row) => !r.entry_id || !isPendingDelete("activity_log", r.entry_id))
    .filter((r: Row) => !isPendingDelete(ACTIVITY_BY_ORDER, r.order_id))
    .map((r: Row) => {
      rememberServerId(r)
      return { date: r.date, orderId: r.order_id, field: r.field, delta: r.delta, entryId: r.entry_id || undefined }
    })

  // В снимок — нормализованный заказ, тот же, что попадёт в память: раньше
  // сюда клался «сырой» rowToOrder, и любой заказ с пустой датой или без
  // advanceAllocations считался изменённым сразу после загрузки.
  const settingsForSnapshot = applySettingsMigrations(pulledSettings)
  cloudSnapshot.orders = {}
  pulledOrdersRaw.forEach((o) => { if (o.id) cloudSnapshot.orders[o.id] = snapshotCopy(normalizeOrder(o, settingsForSnapshot)) })
  cloudSnapshot.tasks = {}; pulledTasks.forEach((t) => { cloudSnapshot.tasks[t.id] = snapshotCopy(t) })
  cloudSnapshot.advances = {}; pulledAdvances.forEach((a) => { cloudSnapshot.advances[a.id] = snapshotCopy(a) })
  cloudSnapshot.planningBoards = {}; boards.forEach((b) => { cloudSnapshot.planningBoards[b.id] = boardSnapshotShape(b) })
  cloudSnapshot.planningLessons = {}
  boards.forEach((b) => (b.lessons || []).forEach((l) => { cloudSnapshot.planningLessons[l.id] = snapshotCopy({ ...l, boardId: b.id }) }))
  cloudSnapshot.appSettings = pulledSettings ? JSON.parse(JSON.stringify(pulledSettings)) : null
  resetSyncedEntries(pulledLog)

  cloudSnapshot.updatedAt = { orders: {}, tasks: {}, advances: {}, planningBoards: {}, planningLessons: {} }
  ;(ordersRes.data || []).forEach((r: Row) => { cloudSnapshot.updatedAt.orders[r.id] = r.updated_at })
  ;(tasksRes.data || []).forEach((r: Row) => { cloudSnapshot.updatedAt.tasks[r.id] = r.updated_at })
  ;(advRes.data || []).forEach((r: Row) => { cloudSnapshot.updatedAt.advances[r.id] = r.updated_at })
  ;(boardsRes.data || []).forEach((r: Row) => { cloudSnapshot.updatedAt.planningBoards[r.id] = r.updated_at })
  ;(lessonsRes.data || []).forEach((r: Row) => { cloudSnapshot.updatedAt.planningLessons[r.id] = r.updated_at })

  snapshotTrusted = true
  persistSnapshot()
  return { pulledOrdersRaw, pulledTasks, pulledAdvances, boards, pulledSettings, pulledLog }
}

/* ---------- Локальный офлайн-фолбэк ---------- */

// Читает ключ кэша текущего аккаунта, а если его ещё нет — старый общий ключ.
// Общий ключ годится только пока никто не записал, чей он (маркер владельца):
// иначе после переключения аккаунта из него поднялись бы чужие данные.
const CACHE_OWNER_KEY = "design_crm_cache_owner_v1"

function readCached(base: string): string | null {
  const scoped = localStorage.getItem(lsKey(base))
  if (scoped !== null) return scoped
  const owner = localStorage.getItem(CACHE_OWNER_KEY)
  const userId = useAppStore.getState().cloudUserId
  if (owner && owner !== userId) return null
  return localStorage.getItem(base)
}

function writeCache(settings: AppSettings, orders: Order[], tasks: Task[], advances: Advance[], boards: PlanningBoard[], log: ActivityLogEntry[]) {
  localStorage.setItem(lsKey(STORAGE_KEY), JSON.stringify(orders))
  localStorage.setItem(lsKey(SETTINGS_KEY), JSON.stringify(settings))
  localStorage.setItem(lsKey(TASKS_KEY), JSON.stringify(tasks))
  localStorage.setItem(lsKey(ADVANCES_KEY), JSON.stringify(advances))
  localStorage.setItem(lsKey(PLANNING_KEY), JSON.stringify(boards))
  localStorage.setItem(lsKey(ACTIVITY_LOG_KEY), JSON.stringify(log))
  const userId = useAppStore.getState().cloudUserId
  if (userId) localStorage.setItem(CACHE_OWNER_KEY, userId)
}

function loadFromLocalStorageFallback() {
  const store = useAppStore.getState()

  const rawS = readCached(SETTINGS_KEY)
  const settings = applySettingsMigrations(rawS ? JSON.parse(rawS) : null)

  const raw = readCached(STORAGE_KEY)
  const orders = raw ? (JSON.parse(raw) as Partial<Order>[]).map((o) => normalizeOrder(o, settings)) : []

  const rawT = readCached(TASKS_KEY)
  const tasks = rawT ? (JSON.parse(rawT) as Partial<Task>[]).map(normalizeTask) : []

  const rawAdv = readCached(ADVANCES_KEY)
  const advances = rawAdv ? (JSON.parse(rawAdv) as Partial<Advance>[]).map(normalizeAdvance) : []

  const rawP = readCached(PLANNING_KEY)
  let planningBoards: PlanningBoard[] = rawP ? JSON.parse(rawP) : defaultPlanningBoards()
  planningBoards = planningBoards.map((b) => ({
    ...b,
    id: b.id || "pb_" + Date.now() + Math.random().toString(36).slice(2, 7),
    lessons: (b.lessons || []).map((l) => ({ ...l, id: l.id || "l_" + Date.now() + Math.random().toString(36).slice(2, 7) })),
  }))

  const { orders: migratedOrders } = migrateLegacyPayments(orders)

  const rawLog = readCached(ACTIVITY_LOG_KEY)
  let activityLog: ActivityLogEntry[] = rawLog ? JSON.parse(rawLog) : []
  activityLog = purgeObsoleteJournalFields(activityLog).log
  activityLog = seedActivityLogIfEmpty(migratedOrders, activityLog, store.cloudUserId || "local")

  store.setAppSettings(settings)
  store.setOrders(migratedOrders)
  store.setTasks(tasks)
  store.setAdvances(advances)
  store.setPlanningBoards(syncPlanningWithOrders(migratedOrders, planningBoards))
  store.setActivityLog(activityLog)

  // Снимок облака из кэша: с ним диф считается как обычно, и старые данные не
  // уедут поверх свежих. Без него (старый кэш) первая отправка начнётся со
  // сверки с облаком — см. reconcileWithCloud.
  snapshotTrusted = restoreSnapshot()
}

/**
 * Сверка после старта из кэша без снимка. Облако — источник истины для всего,
 * что в нём есть; локально остаются только записи, которых в облаке нет
 * (созданные офлайн). Правки существующих записей, сделанные офлайн, при
 * этом теряются — и об этом честно сообщается, а не молча.
 */
async function reconcileWithCloud() {
  const before = useAppStore.getState()
  const localOrders = before.orders, localTasks = before.tasks, localAdv = before.advances
  const localBoards = before.planningBoards, localLog = before.activityLog

  const pulled = await cloudLoadData()
  const state = buildStateFromCloud(pulled)

  const keepMissing = <T extends { id: string }>(local: T[], cloud: T[]) => {
    const have = new Set(cloud.map((x) => x.id))
    return [...cloud, ...local.filter((x) => !have.has(x.id))]
  }
  const countChanged = <T extends { id: string }>(local: T[], cloud: T[]) => {
    const byId = new Map(cloud.map((x) => [x.id, JSON.stringify(x)]))
    return local.filter((x) => byId.has(x.id) && byId.get(x.id) !== JSON.stringify(x)).length
  }

  const orders = keepMissing(localOrders, state.orders)
  const tasks = keepMissing(localTasks, state.tasks)
  const advances = keepMissing(localAdv, state.advances)
  const boards = keepMissing(localBoards, state.planningBoards).map((b) => {
    const local = localBoards.find((x) => x.id === b.id)
    return local ? { ...b, lessons: keepMissing(local.lessons || [], b.lessons || []) } : b
  })
  const cloudEntryIds = new Set(state.activityLog.map((e) => e.entryId).filter(Boolean))
  const activityLog = [...state.activityLog, ...localLog.filter((e) => !e.entryId || !cloudEntryIds.has(e.entryId))]

  const dropped = countChanged(localOrders, state.orders) + countChanged(localTasks, state.tasks) + countChanged(localAdv, state.advances)

  const store = useAppStore.getState()
  store.setAppSettings(state.settings)
  store.setOrders(orders)
  store.setTasks(tasks)
  store.setAdvances(advances)
  store.setPlanningBoards(syncPlanningWithOrders(orders, boards))
  store.setActivityLog(activityLog)
  writeCache(state.settings, orders, tasks, advances, useAppStore.getState().planningBoards, activityLog)

  if (dropped > 0) {
    useToastStore.getState().addToast({
      title: "Данные сверены с облаком",
      sub: `Правки офлайн по ${dropped} уже существующим записям не перенесены — облако новее.`,
      danger: true,
    }, 12000)
  }
}

interface CloudState {
  settings: AppSettings
  orders: Order[]
  tasks: Task[]
  advances: Advance[]
  planningBoards: PlanningBoard[]
  activityLog: ActivityLogEntry[]
  migratedPaid: number
  purged: number
  seeded: boolean
}

function buildStateFromCloud(pulled: Awaited<ReturnType<typeof cloudLoadData>>): CloudState {
  const { pulledOrdersRaw, pulledTasks, pulledAdvances, boards, pulledSettings, pulledLog } = pulled
  const settings = applySettingsMigrations(pulledSettings)
  const orders = pulledOrdersRaw.map((o) => normalizeOrder(o, settings))
  const planningBoards = boards.length ? boards : defaultPlanningBoards()
  const { orders: migratedOrders, migrated: migratedPaid } = migrateLegacyPayments(orders)
  const { log: purgedLog, purged } = purgeObsoleteJournalFields(pulledLog)
  // ВНИМАНИЕ: здесь раньше вызывался compactHoursJournal(), а ниже — снос всех
  // записей "hours" из облака с последующей заливкой схлопнутых. Порядок был
  // "сначала удалить, потом переслать", без атомарности: обрыв между шагами
  // уносил часы из облака насовсем, а на следующей загрузке пустой журнал
  // добивал seedActivityLogIfEmpty. Так 20.08.2026 было потеряно 45 записей.
  // Схлопывание убрано совсем; досев одноразовый (lib/activitySeed.ts).
  const activityLog = seedActivityLogIfEmpty(migratedOrders, purgedLog, useAppStore.getState().cloudUserId || "local")
  return {
    settings, orders: migratedOrders, tasks: pulledTasks, advances: pulledAdvances, planningBoards, activityLog,
    migratedPaid, purged, seeded: activityLog.length !== purgedLog.length,
  }
}

/**
 * Локальный кэш и прошлый снимок облака — до того, как cloudLoadData их
 * перезапишет. Нужны, чтобы не потерять правки, которые не успели уйти
 * (см. lib/cloudMerge.ts).
 */
interface LocalBeforeLoad {
  orders: Order[]
  tasks: Task[]
  advances: Advance[]
  boards: PlanningBoard[]
  log: ActivityLogEntry[]
  snapshot: Pick<CloudSnapshot, "orders" | "tasks" | "advances" | "planningBoards" | "planningLessons"> | null
}

function readLocalBeforeLoad(): LocalBeforeLoad {
  const parse = <T>(key: string): T[] => { try { const raw = readCached(key); return raw ? (JSON.parse(raw) as T[]) : [] } catch { return [] } }
  let snapshot: LocalBeforeLoad["snapshot"] = null
  try {
    const raw = localStorage.getItem(lsKey(CLOUD_SNAPSHOT_KEY))
    const s = raw ? JSON.parse(raw) : null
    // Снимки прежних версий хранили заказы «сырыми» (см. cloudLoadData) — по
    // ним каждая запись выглядела бы правленной с обеих сторон.
    if (s && s.updatedAt && s.version >= SNAPSHOT_VERSION) snapshot = { orders: s.orders || {}, tasks: s.tasks || {}, advances: s.advances || {}, planningBoards: s.planningBoards || {}, planningLessons: s.planningLessons || {} }
  } catch { /* снимка нет — сливать нечего */ }
  return { orders: parse<Order>(STORAGE_KEY), tasks: parse<Task>(TASKS_KEY), advances: parse<Advance>(ADVANCES_KEY), boards: parse<PlanningBoard>(PLANNING_KEY), log: parse<ActivityLogEntry>(ACTIVITY_LOG_KEY), snapshot }
}

/**
 * Свежее облако + неотправленные локальные правки. Если снимка нет (первый
 * вход на этом устройстве, старый кэш) — облако как есть.
 * Возвращает, сколько локальных правок сохранено (их надо отправить).
 */
function mergeLocalIntoState(state: CloudState, local: LocalBeforeLoad): { kept: number; dropped: number } {
  const snap = local.snapshot
  if (!snap) return { kept: 0, dropped: 0 }
  const settings = state.settings
  const o = mergeUnsentLocal(local.orders.map((x) => normalizeOrder(x, settings)), state.orders, snap.orders)
  const t = mergeUnsentLocal(local.tasks.map(normalizeTask), state.tasks, snap.tasks)
  const a = mergeUnsentLocal(local.advances.map(normalizeAdvance), state.advances, snap.advances)
  const b = mergeUnsentLocal(local.boards, state.planningBoards, snap.planningBoards, boardSnapshotShape)
  // Уроки живут внутри досок, но в облаке и снимке — отдельными строками.
  const flat = (boards: PlanningBoard[]) => boards.flatMap((bd) => (bd.lessons || []).map((l) => ({ ...l, boardId: bd.id })))
  const l = mergeUnsentLocal(flat(local.boards), flat(state.planningBoards), snap.planningLessons)
  const lessonsByBoard: Record<string, PlanningLesson[]> = {}
  l.merged.forEach(({ boardId, ...lesson }) => { (lessonsByBoard[boardId] ||= []).push(lesson) })
  const boards = b.merged.map((bd) => ({ ...bd, lessons: (lessonsByBoard[bd.id] || []).sort((x, y) => (x.num || 0) - (y.num || 0)) }))
  // Журнал: записи без entryId или неизвестные облаку — не отправлены.
  const cloudEntryIds = new Set(state.activityLog.map((e) => e.entryId).filter(Boolean))
  const unsentLog = local.log.filter((e) => !e.entryId || !cloudEntryIds.has(e.entryId))

  state.orders = o.merged
  state.tasks = t.merged
  state.advances = a.merged
  state.planningBoards = boards
  state.activityLog = [...state.activityLog, ...unsentLog]
  return { kept: o.kept + t.kept + a.kept + b.kept + l.kept + unsentLog.length, dropped: o.dropped + t.dropped + a.dropped + b.dropped + l.dropped }
}

function applyCloudState(state: CloudState) {
  const store = useAppStore.getState()
  store.setAppSettings(state.settings)
  store.setOrders(state.orders)
  store.setTasks(state.tasks)
  store.setAdvances(state.advances)
  store.setPlanningBoards(syncPlanningWithOrders(state.orders, state.planningBoards))
  store.setActivityLog(state.activityLog)
  writeCache(state.settings, state.orders, state.tasks, state.advances, useAppStore.getState().planningBoards, state.activityLog)
}

export async function loadData() {
  const store = useAppStore.getState()
  setPendingDeletesScope(store.cloudUserId)
  try {
    const local = readLocalBeforeLoad()
    const state = buildStateFromCloud(await cloudLoadData())
    const merge = mergeLocalIntoState(state, local)
    const { migratedPaid, purged, seeded } = state

    const rawBcfg = localStorage.getItem(BACKUP_CFG_KEY)
    if (rawBcfg) store.setBackupSettings((prev) => ({ ...prev, ...JSON.parse(rawBcfg) }))

    applyCloudState(state)

    if (seeded || migratedPaid || merge.kept > 0) scheduleCloudSync()
    if (merge.dropped > 0) {
      useToastStore.getState().addToast({
        title: "Данные сверены с облаком",
        sub: `${merge.dropped} ${pluralRecords(merge.dropped)} менялись и здесь, и на другом устройстве — взята версия из облака.`,
        danger: true,
      }, 12000)
    }
    if (purged) await deleteObsoleteJournalFieldsFromCloud(JOURNAL_OBSOLETE_FIELDS)
  } catch (e) {
    console.error("Не удалось загрузить данные из облака, работаем из локального кэша:", e)
    try { loadFromLocalStorageFallback() }
    catch (e2) { console.error(e2) }
  } finally {
    store.setDataLoaded(true)
  }
}

export function saveData() {
  const store = useAppStore.getState()
  store.setPlanningBoards((prev) => syncPlanningWithOrders(store.orders, prev))

  const s = useAppStore.getState()
  writeCache(s.appSettings, s.orders, s.tasks, s.advances, s.planningBoards, s.activityLog)

  scheduleCloudSync()

  const backupSettings = useAppStore.getState().backupSettings
  if (backupSettings.enabled && backupSettings.interval === "change") {
    // Отложенно, не на каждое нажатие клавиши: бэкап читает и пишет файл на
    // диске и опрашивает облако за каждый другой аккаунт (см. diskBackup.ts).
    scheduleDiskBackup()
  }
}

/* ---------- Входящие правки с других СВОИХ устройств (Realtime) ---------- */

let realtimeChannel: ReturnType<typeof supabaseClient.channel> | null = null

function isStaleRealtimeRow(updatedAtMap: Record<string, string>, id: string, incomingUpdatedAt: string | undefined): boolean {
  const known = updatedAtMap[id]
  if (!known || !incomingUpdatedAt) return false
  return new Date(incomingUpdatedAt).getTime() <= new Date(known).getTime()
}

function hasUnsentLocalChanges(snapshotMap: Record<string, any>, id: string, currentShape: any): boolean {
  if (!currentShape) return false
  const snap = snapshotMap[id]
  if (!snap) return true
  return !sameData(currentShape, snap)
}

export function subscribeRealtime() {
  const userId = useAppStore.getState().cloudUserId
  if (!userId || realtimeChannel) return
  realtimeChannel = supabaseClient
    .channel("crm-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${userId}` }, handleRealtimeOrders)
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${userId}` }, handleRealtimeTasks)
    .on("postgres_changes", { event: "*", schema: "public", table: "advances", filter: `user_id=eq.${userId}` }, handleRealtimeAdvances)
    .on("postgres_changes", { event: "*", schema: "public", table: "planning_boards", filter: `user_id=eq.${userId}` }, handleRealtimeBoards)
    .on("postgres_changes", { event: "*", schema: "public", table: "planning_lessons", filter: `user_id=eq.${userId}` }, handleRealtimeLessons)
    .on("postgres_changes", { event: "*", schema: "public", table: "app_settings", filter: `user_id=eq.${userId}` }, handleRealtimeSettings)
    .on("postgres_changes", { event: "*", schema: "public", table: "activity_log", filter: `user_id=eq.${userId}` }, handleRealtimeActivity)
    .subscribe()
}

/** Отписка при смене аккаунта — раньше канал жил до перезагрузки страницы. */
export function unsubscribeRealtime() {
  if (!realtimeChannel) return
  supabaseClient.removeChannel(realtimeChannel)
  realtimeChannel = null
}

/* Журнал часов по realtime. Раньше его не было вовсе: часы, записанные на
 * другом устройстве, появлялись здесь только после перезагрузки. В событии
 * DELETE приходит только серверный id, поэтому держим соответствие id ↔ entry_id. */
let serverIdByEntry: Record<string, number> = {}
let entryByServerId: Record<string, string> = {}

function rememberServerId(r: Row) {
  if (!r.entry_id || r.id == null) return
  serverIdByEntry[r.entry_id] = r.id
  entryByServerId[String(r.id)] = r.entry_id
}

function handleRealtimeActivity(payload: any) {
  const store = useAppStore.getState()
  if (payload.eventType === "DELETE") {
    const entryId = entryByServerId[String(payload.old?.id)]
    if (!entryId) return
    delete entryByServerId[String(payload.old.id)]
    delete serverIdByEntry[entryId]
    cloudSnapshot.activityLogSyncedIds.delete(entryId)
    delete cloudSnapshot.activityLogSynced[entryId]
    store.setActivityLog((prev) => prev.filter((e) => e.entryId !== entryId))
    return
  }
  const row: Row = payload.new
  if (!row?.entry_id) return
  rememberServerId(row)
  if (isPendingDelete("activity_log", row.entry_id) || isPendingDelete(ACTIVITY_BY_ORDER, row.order_id)) return

  const incoming: ActivityLogEntry = { date: row.date, orderId: row.order_id, field: row.field, delta: row.delta, entryId: row.entry_id }
  const local = store.activityLog.find((e) => e.entryId === row.entry_id)
  if (local) {
    const known = cloudSnapshot.activityLogSynced[row.entry_id]
    // Наша неотправленная правка новее — не затираем, но запоминаем, что
    // теперь лежит в облаке, чтобы следующая отправка ушла как UPDATE.
    if (known && (known.delta !== local.delta || known.date !== local.date)) {
      cloudSnapshot.activityLogSynced[row.entry_id] = { delta: row.delta, date: row.date }
      return
    }
    if (local.delta !== incoming.delta || local.date !== incoming.date) {
      store.setActivityLog((prev) => prev.map((e) => (e === local ? incoming : e)))
    }
  } else {
    store.setActivityLog((prev) => [...prev, incoming])
  }
  rememberSyncedEntry(incoming)
  cloudSnapshot.activityLogSyncedCount = useAppStore.getState().activityLog.length
  localStorage.setItem(lsKey(ACTIVITY_LOG_KEY), JSON.stringify(useAppStore.getState().activityLog))
}

function handleRealtimeOrders(payload: any) {
  const store = useAppStore.getState()
  if (payload.eventType === "DELETE") {
    store.setOrders((prev) => prev.filter((o) => o.id !== payload.old.id))
    delete cloudSnapshot.orders[payload.old.id]
    delete cloudSnapshot.updatedAt.orders[payload.old.id]
  } else {
    if (isStaleRealtimeRow(cloudSnapshot.updatedAt.orders, payload.new.id, payload.new.updated_at)) return
    const o = normalizeOrder(rowToOrder(payload.new), store.appSettings)
    const existing = store.orders.find((x) => x.id === o.id)
    if (hasUnsentLocalChanges(cloudSnapshot.orders, o.id, existing)) {
      cloudSnapshot.updatedAt.orders[o.id] = payload.new.updated_at
      return
    }
    store.setOrders((prev) => {
      const idx = prev.findIndex((x) => x.id === o.id)
      return idx >= 0 ? prev.map((x, i) => (i === idx ? o : x)) : [...prev, o]
    })
    cloudSnapshot.orders[o.id] = snapshotCopy(o)
    cloudSnapshot.updatedAt.orders[o.id] = payload.new.updated_at
  }
  resyncPlanning()
}

function handleRealtimeTasks(payload: any) {
  const store = useAppStore.getState()
  if (payload.eventType === "DELETE") {
    store.setTasks((prev) => prev.filter((t) => t.id !== payload.old.id))
    delete cloudSnapshot.tasks[payload.old.id]
    delete cloudSnapshot.updatedAt.tasks[payload.old.id]
  } else {
    if (isStaleRealtimeRow(cloudSnapshot.updatedAt.tasks, payload.new.id, payload.new.updated_at)) return
    const t = normalizeTask(rowToTask(payload.new))
    const existing = store.tasks.find((x) => x.id === t.id)
    if (hasUnsentLocalChanges(cloudSnapshot.tasks, t.id, existing)) {
      cloudSnapshot.updatedAt.tasks[t.id] = payload.new.updated_at
      return
    }
    store.setTasks((prev) => {
      const idx = prev.findIndex((x) => x.id === t.id)
      return idx >= 0 ? prev.map((x, i) => (i === idx ? t : x)) : [...prev, t]
    })
    cloudSnapshot.tasks[t.id] = snapshotCopy(t)
    cloudSnapshot.updatedAt.tasks[t.id] = payload.new.updated_at
  }
}

function handleRealtimeAdvances(payload: any) {
  const store = useAppStore.getState()
  if (payload.eventType === "DELETE") {
    store.setAdvances((prev) => prev.filter((a) => a.id !== payload.old.id))
    delete cloudSnapshot.advances[payload.old.id]
    delete cloudSnapshot.updatedAt.advances[payload.old.id]
  } else {
    if (isStaleRealtimeRow(cloudSnapshot.updatedAt.advances, payload.new.id, payload.new.updated_at)) return
    const a = normalizeAdvance(rowToAdvance(payload.new))
    const existing = store.advances.find((x) => x.id === a.id)
    if (hasUnsentLocalChanges(cloudSnapshot.advances, a.id, existing)) {
      cloudSnapshot.updatedAt.advances[a.id] = payload.new.updated_at
      return
    }
    store.setAdvances((prev) => {
      const idx = prev.findIndex((x) => x.id === a.id)
      return idx >= 0 ? prev.map((x, i) => (i === idx ? a : x)) : [...prev, a]
    })
    cloudSnapshot.advances[a.id] = snapshotCopy(a)
    cloudSnapshot.updatedAt.advances[a.id] = payload.new.updated_at
  }
}

function handleRealtimeBoards(payload: any) {
  const store = useAppStore.getState()
  if (payload.eventType === "DELETE") {
    store.setPlanningBoards((prev) => prev.filter((b) => b.id !== payload.old.id))
    delete cloudSnapshot.planningBoards[payload.old.id]
    delete cloudSnapshot.updatedAt.planningBoards[payload.old.id]
  } else {
    if (isStaleRealtimeRow(cloudSnapshot.updatedAt.planningBoards, payload.new.id, payload.new.updated_at)) return
    const rowBoard = rowToBoard(payload.new)
    const existing = store.planningBoards.find((b) => b.id === rowBoard.id)
    if (hasUnsentLocalChanges(cloudSnapshot.planningBoards, rowBoard.id, existing ? boardSnapshotShape(existing) : null)) {
      cloudSnapshot.updatedAt.planningBoards[rowBoard.id] = payload.new.updated_at
      return
    }
    store.setPlanningBoards((prev) => {
      const idx = prev.findIndex((b) => b.id === rowBoard.id)
      if (idx >= 0) return prev.map((b, i) => (i === idx ? { ...rowBoard, lessons: b.lessons } : b))
      return [...prev, rowBoard]
    })
    cloudSnapshot.planningBoards[rowBoard.id] = boardSnapshotShape(rowBoard)
    cloudSnapshot.updatedAt.planningBoards[rowBoard.id] = payload.new.updated_at
  }
}

function handleRealtimeLessons(payload: any) {
  const store = useAppStore.getState()
  if (payload.eventType === "DELETE") {
    store.setPlanningBoards((prev) => prev.map((b) => ({ ...b, lessons: b.lessons.filter((l) => l.id !== payload.old.id) })))
    delete cloudSnapshot.planningLessons[payload.old.id]
    delete cloudSnapshot.updatedAt.planningLessons[payload.old.id]
  } else {
    if (isStaleRealtimeRow(cloudSnapshot.updatedAt.planningLessons, payload.new.id, payload.new.updated_at)) return
    const lesson = rowToLesson(payload.new)
    const board = store.planningBoards.find((b) => b.id === payload.new.board_id)
    const existingLesson = board ? board.lessons.find((l) => l.id === lesson.id) : null
    if (hasUnsentLocalChanges(cloudSnapshot.planningLessons, lesson.id, existingLesson ? { ...existingLesson, boardId: payload.new.board_id } : null)) {
      cloudSnapshot.updatedAt.planningLessons[lesson.id] = payload.new.updated_at
      return
    }
    store.setPlanningBoards((prev) =>
      prev.map((b) => {
        if (b.id !== payload.new.board_id) return b
        const idx = b.lessons.findIndex((l) => l.id === lesson.id)
        const lessons = idx >= 0 ? b.lessons.map((l, i) => (i === idx ? lesson : l)) : [...b.lessons, lesson]
        return { ...b, lessons }
      })
    )
    cloudSnapshot.planningLessons[lesson.id] = snapshotCopy({ ...lesson, boardId: payload.new.board_id })
    cloudSnapshot.updatedAt.planningLessons[lesson.id] = payload.new.updated_at
  }
}

function handleRealtimeSettings(payload: any) {
  if (payload.eventType === "DELETE") return
  const store = useAppStore.getState()
  if (JSON.stringify(store.appSettings) !== JSON.stringify(cloudSnapshot.appSettings)) return
  const merged = applySettingsMigrations(payload.new.data || {})
  store.setAppSettings(merged)
  cloudSnapshot.appSettings = snapshotCopy(merged)
}
