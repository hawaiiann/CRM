/* ============================================================
 * cloudSync.js — облачная синхронизация с Supabase (см. CHANGELOG).
 * Каждый пользователь видит и правит ТОЛЬКО свои данные (RLS в базе,
 * user_id = auth.uid()) — это не общая база на двоих, а два независимых
 * личных кабинета на одном экране входа.
 *
 * Устройство синхронизации: db.js как был единственным местом чтения/записи
 * (loadData/saveData), так и остался — только теперь loadData() в начале
 * тянет данные из Supabase, а saveData() в конце дербит их туда обратно.
 * Внутри — diff по id против последнего отправленного снимка (cloudSnapshot),
 * чтобы в облаке жили честные отдельные строки на каждый заказ/задачу/урок,
 * а не один большой JSON-блок целиком при каждом сохранении.
 * ============================================================ */

// Чекбокс "Запомнить меня" переключает, куда supabase-js пишет сессию: localStorage
// (переживает закрытие браузера) при включённой галочке, sessionStorage (только пока
// открыта вкладка) — при выключенной. getItem проверяет оба места, чтобы найти сессию
// независимо от того, куда её в прошлый раз записали.
let rememberMeOnNextSignIn = true;
const authStorageAdapter = {
  getItem: (key) => localStorage.getItem(key) ?? sessionStorage.getItem(key),
  setItem: (key, value) => {
    if (rememberMeOnNextSignIn) { localStorage.setItem(key, value); sessionStorage.removeItem(key); }
    else { sessionStorage.setItem(key, value); localStorage.removeItem(key); }
  },
  removeItem: (key) => { localStorage.removeItem(key); sessionStorage.removeItem(key); }
};

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage: authStorageAdapter }
});

let cloudUserId = null;
let cloudSyncInFlight = false;
let cloudSyncPending = false;
let cloudSyncDebounceTimer = null;
let realtimeChannel = null;
let resolveAuthWait = null;

// Последнее отправленное/полученное из облака состояние — с ним сравниваем перед
// каждой отправкой, чтобы посылать только реально изменившиеся записи.
let cloudSnapshot = {
  orders: {}, tasks: {}, advances: {}, planningBoards: {}, planningLessons: {},
  appSettings: null, activityLogSyncedCount: 0
};

/* ---------- Вход ---------- */

// Ждёт активную сессию — если её нет, показывает экран входа и виснет,
// пока handleAuthSubmit() её не разрешит после успешного логина.
async function ensureAuthenticated() {
  const { data } = await supabaseClient.auth.getSession();
  let session = data.session;
  if (!session) {
    document.getElementById('authOverlay').classList.add('show');
    session = await new Promise(resolve => { resolveAuthWait = resolve; });
  }
  cloudUserId = session.user.id;
  return session;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('auth_email').value.trim();
  const password = document.getElementById('auth_password').value;
  const errEl = document.getElementById('authError');
  const btn = document.getElementById('authSubmitBtn');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Вход...';
  rememberMeOnNextSignIn = document.getElementById('auth_remember').checked;
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    document.getElementById('authOverlay').classList.remove('show');
    document.getElementById('authForm').reset();
    if (resolveAuthWait) { resolveAuthWait(data.session); resolveAuthWait = null; }
  } catch (err) {
    errEl.textContent = 'Не удалось войти: проверьте email и пароль.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
}

async function signOutCloud() {
  await supabaseClient.auth.signOut();
  window.location.reload(); // проще всего сбросить всё in-memory состояние и снова показать экран входа
}

/* ---------- JS-объект <-> строка таблицы ---------- */

function orderToRow(o) {
  return {
    id: o.id, user_id: cloudUserId, title: o.title || '', client: o.client || '', subject: o.subject || '',
    grade: o.grade || '', quarter: o.quarter || '', lesson: o.lesson || '', status: o.status || 'queue',
    is_paid: !!o.isPaid, priority: !!o.priority, advance_used: parseNum(o.advanceUsed),
    tax_type: o.taxType || 'none', start_date: o.start || null, deadline: o.deadline || null,
    estimated_hours: String(o.estimatedHours ?? ''), actual_hours: String(o.actualHours ?? ''),
    lines: o.lines || [], notes: o.notes || '', created_at: o.createdAt || Date.now(),
    linked_lesson_id: o.linkedLessonId || null
  };
}
function rowToOrder(r) {
  return {
    id: r.id, title: r.title || '', client: r.client || '', subject: r.subject || '',
    grade: r.grade || '', quarter: r.quarter || '', lesson: r.lesson || '', status: r.status || 'queue',
    isPaid: !!r.is_paid, priority: !!r.priority, advanceUsed: r.advance_used || 0,
    taxType: r.tax_type || 'none', start: r.start_date || '', deadline: r.deadline || '',
    estimatedHours: r.estimated_hours ?? '', actualHours: r.actual_hours ?? '',
    lines: r.lines || [], notes: r.notes || '', createdAt: r.created_at || Date.now(),
    linkedLessonId: r.linked_lesson_id || null
  };
}

function taskToRow(t) {
  return { id: t.id, user_id: cloudUserId, text: t.text || '', time: t.time || '', done: !!t.done, period: t.period || 'today', created_at: t.createdAt || '' };
}
function rowToTask(r) {
  return { id: r.id, text: r.text || '', time: r.time || '', done: !!r.done, period: r.period || 'today', createdAt: r.created_at || '' };
}

function advanceToRow(a) {
  return { id: a.id, user_id: cloudUserId, client: a.client || '', amount: parseNum(a.amount), date: a.date || null, note: a.note || '' };
}
function rowToAdvance(r) {
  return { id: r.id, client: r.client || '', amount: r.amount || 0, date: r.date || '', note: r.note || '' };
}

// Только "верхнеуровневые" поля доски — уроки идут отдельной таблицей/сравнением.
function boardToRow(b) {
  return {
    id: b.id, user_id: cloudUserId, subject: b.subject || '', title: b.title || '', quarter: b.quarter || '',
    deadline: b.deadline || null, base_template: b.baseTemplate || [], collapsed: !!b.collapsed, archived: !!b.archived
  };
}
function rowToBoard(r) {
  return { id: r.id, subject: r.subject || '', title: r.title || '', quarter: r.quarter || '', deadline: r.deadline || '', baseTemplate: r.base_template || [], collapsed: !!r.collapsed, archived: !!r.archived, lessons: [] };
}
function boardSnapshotShape(b) {
  return { id: b.id, subject: b.subject || '', title: b.title || '', quarter: b.quarter || '', deadline: b.deadline || '', baseTemplate: b.baseTemplate || [], collapsed: !!b.collapsed, archived: !!b.archived };
}

function lessonToRow(l) {
  return {
    id: l.id, user_id: cloudUserId, board_id: l.boardId, num: l.num || 0, title: l.title || '', color: l.color || 'gray',
    items: l.items || [], color_locked: !!l.colorLocked, order_linked: !!l.orderLinked, notes: l.notes || ''
  };
}
function rowToLesson(r) {
  return { id: r.id, num: r.num || 0, title: r.title || '', color: r.color || 'gray', items: r.items || [], colorLocked: !!r.color_locked, orderLinked: !!r.order_linked, notes: r.notes || '' };
}

/* ---------- Diff по id против последнего снимка ---------- */

function diffById(currentArr) {
  const currentMap = {};
  currentArr.forEach(item => { currentMap[item.id] = item; });
  return { currentMap };
}

// ВАЖНО: раньше здесь же вычислялись id "пропавшие из массива с прошлого снимка" и они
// удалялись из облака — но массив в памяти может "похудеть" не только от реального удаления
// пользователем (сетевой сбой при загрузке, гонка состояний, любой баг рендера) — то есть
// такая логика рисковала стереть данные без явного действия пользователя. Теперь этот
// diff отвечает ТОЛЬКО за upsert; настоящее удаление — только через deleteFromCloud(),
// вызываемый explicit-но из самих функций удаления (confirmDeleteOrder, deleteTask и т.д.).
function collectionChanged(currentMap, snapshotMap) {
  const toUpsert = [];
  for (const id in currentMap) {
    if (JSON.stringify(currentMap[id]) !== JSON.stringify(snapshotMap[id])) toUpsert.push(currentMap[id]);
  }
  return { toUpsert };
}

// Единственный источник настоящего удаления записи из облака — вызывается explicit-но
// в момент, когда пользователь ЯВНО нажал "Удалить" (см. orders.js/tasks.js/finance.js/planning.js).
async function deleteFromCloud(table, id) {
  if (!cloudUserId || !id) return;
  try {
    await supabaseClient.from(table).delete().eq('id', id);
  } catch (err) {
    console.error(`Не удалось удалить запись из облака (${table}/${id}):`, err);
  }
}

/* ---------- Отправка изменений в облако ---------- */

async function performCloudSync() {
  if (!cloudUserId) return;
  if (cloudSyncInFlight) { cloudSyncPending = true; return; }
  cloudSyncInFlight = true;
  try {
    const { currentMap: ordersMap } = diffById(orders);
    const ordersDiff = collectionChanged(ordersMap, cloudSnapshot.orders);
    if (ordersDiff.toUpsert.length) await supabaseClient.from('orders').upsert(ordersDiff.toUpsert.map(orderToRow));
    cloudSnapshot.orders = ordersMap;

    const { currentMap: tasksMap } = diffById(appTasks);
    const tasksDiff = collectionChanged(tasksMap, cloudSnapshot.tasks);
    if (tasksDiff.toUpsert.length) await supabaseClient.from('tasks').upsert(tasksDiff.toUpsert.map(taskToRow));
    cloudSnapshot.tasks = tasksMap;

    const { currentMap: advMap } = diffById(advances);
    const advDiff = collectionChanged(advMap, cloudSnapshot.advances);
    if (advDiff.toUpsert.length) await supabaseClient.from('advances').upsert(advDiff.toUpsert.map(advanceToRow));
    cloudSnapshot.advances = advMap;

    const { currentMap: boardsMap } = diffById(planningBoards.map(boardSnapshotShape));
    const boardsDiff = collectionChanged(boardsMap, cloudSnapshot.planningBoards);
    if (boardsDiff.toUpsert.length) await supabaseClient.from('planning_boards').upsert(boardsDiff.toUpsert.map(boardToRow));
    cloudSnapshot.planningBoards = boardsMap;

    const allLessons = [];
    planningBoards.forEach(b => (b.lessons || []).forEach(l => allLessons.push({ ...l, boardId: b.id })));
    const { currentMap: lessonsMap } = diffById(allLessons);
    const lessonsDiff = collectionChanged(lessonsMap, cloudSnapshot.planningLessons);
    if (lessonsDiff.toUpsert.length) await supabaseClient.from('planning_lessons').upsert(lessonsDiff.toUpsert.map(lessonToRow));
    cloudSnapshot.planningLessons = lessonsMap;

    if (JSON.stringify(appSettings) !== JSON.stringify(cloudSnapshot.appSettings)) {
      await supabaseClient.from('app_settings').upsert({ user_id: cloudUserId, data: appSettings });
      cloudSnapshot.appSettings = JSON.parse(JSON.stringify(appSettings));
    }

    if (activityLog.length > cloudSnapshot.activityLogSyncedCount) {
      const newEntries = activityLog.slice(cloudSnapshot.activityLogSyncedCount);
      await supabaseClient.from('activity_log').insert(newEntries.map(e => ({ user_id: cloudUserId, date: e.date, order_id: e.orderId, field: e.field, delta: e.delta })));
      cloudSnapshot.activityLogSyncedCount = activityLog.length;
    }
  } catch (err) {
    console.error('Ошибка облачной синхронизации:', err);
  } finally {
    cloudSyncInFlight = false;
    if (cloudSyncPending) { cloudSyncPending = false; performCloudSync(); }
  }
}

function scheduleCloudSync() {
  if (!cloudUserId) return;
  clearTimeout(cloudSyncDebounceTimer);
  cloudSyncDebounceTimer = setTimeout(performCloudSync, 600);
}

/* ---------- Первая загрузка из облака ---------- */

async function cloudLoadData() {
  const [ordersRes, tasksRes, advRes, boardsRes, lessonsRes, settingsRes, logRes] = await Promise.all([
    supabaseClient.from('orders').select('*'),
    supabaseClient.from('tasks').select('*'),
    supabaseClient.from('advances').select('*'),
    supabaseClient.from('planning_boards').select('*'),
    supabaseClient.from('planning_lessons').select('*').order('num'),
    supabaseClient.from('app_settings').select('*').maybeSingle(),
    supabaseClient.from('activity_log').select('*').order('id')
  ]);
  [ordersRes, tasksRes, advRes, boardsRes, lessonsRes, logRes].forEach(r => { if (r.error) throw r.error; });
  if (settingsRes.error) throw settingsRes.error;

  const pulledOrders = (ordersRes.data || []).map(rowToOrder);
  const pulledTasks = (tasksRes.data || []).map(rowToTask);
  const pulledAdvances = (advRes.data || []).map(rowToAdvance);
  const boards = (boardsRes.data || []).map(rowToBoard);
  const boardsById = {};
  boards.forEach(b => { boardsById[b.id] = b; });
  (lessonsRes.data || []).forEach(r => {
    const board = boardsById[r.board_id];
    if (board) board.lessons.push(rowToLesson(r));
  });
  const pulledSettings = settingsRes.data ? settingsRes.data.data : null;
  const pulledLog = (logRes.data || []).map(r => ({ date: r.date, orderId: r.order_id, field: r.field, delta: r.delta }));

  cloudSnapshot.orders = {}; pulledOrders.forEach(o => { cloudSnapshot.orders[o.id] = o; });
  cloudSnapshot.tasks = {}; pulledTasks.forEach(t => { cloudSnapshot.tasks[t.id] = t; });
  cloudSnapshot.advances = {}; pulledAdvances.forEach(a => { cloudSnapshot.advances[a.id] = a; });
  cloudSnapshot.planningBoards = {}; boards.forEach(b => { cloudSnapshot.planningBoards[b.id] = boardSnapshotShape(b); });
  cloudSnapshot.planningLessons = {};
  boards.forEach(b => (b.lessons || []).forEach(l => { cloudSnapshot.planningLessons[l.id] = { ...l, boardId: b.id }; }));
  cloudSnapshot.appSettings = pulledSettings ? JSON.parse(JSON.stringify(pulledSettings)) : null;
  cloudSnapshot.activityLogSyncedCount = pulledLog.length;

  return { orders: pulledOrders, tasks: pulledTasks, advances: pulledAdvances, planningBoards: boards, appSettings: pulledSettings, activityLog: pulledLog };
}

/* ---------- Входящие правки с других СВОИХ устройств (Realtime) ---------- */

function subscribeRealtime() {
  if (!cloudUserId || realtimeChannel) return;
  realtimeChannel = supabaseClient.channel('crm-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${cloudUserId}` }, handleRealtimeOrders)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${cloudUserId}` }, handleRealtimeTasks)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'advances', filter: `user_id=eq.${cloudUserId}` }, handleRealtimeAdvances)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_boards', filter: `user_id=eq.${cloudUserId}` }, handleRealtimeBoards)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_lessons', filter: `user_id=eq.${cloudUserId}` }, handleRealtimeLessons)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: `user_id=eq.${cloudUserId}` }, handleRealtimeSettings)
    .subscribe();
}

function handleRealtimeOrders(payload) {
  if (payload.eventType === 'DELETE') {
    orders = orders.filter(o => o.id !== payload.old.id);
    delete cloudSnapshot.orders[payload.old.id];
  } else {
    const o = normalizeOrder(rowToOrder(payload.new));
    const idx = orders.findIndex(x => x.id === o.id);
    if (idx >= 0) orders[idx] = o; else orders.push(o);
    cloudSnapshot.orders[o.id] = o;
  }
  syncPlanningWithOrders();
  renderCurrent();
}

function handleRealtimeTasks(payload) {
  if (payload.eventType === 'DELETE') {
    appTasks = appTasks.filter(t => t.id !== payload.old.id);
    delete cloudSnapshot.tasks[payload.old.id];
  } else {
    const t = normalizeTask(rowToTask(payload.new));
    const idx = appTasks.findIndex(x => x.id === t.id);
    if (idx >= 0) appTasks[idx] = t; else appTasks.push(t);
    cloudSnapshot.tasks[t.id] = t;
  }
  renderCurrent();
}

function handleRealtimeAdvances(payload) {
  if (payload.eventType === 'DELETE') {
    advances = advances.filter(a => a.id !== payload.old.id);
    delete cloudSnapshot.advances[payload.old.id];
  } else {
    const a = normalizeAdvance(rowToAdvance(payload.new));
    const idx = advances.findIndex(x => x.id === a.id);
    if (idx >= 0) advances[idx] = a; else advances.push(a);
    cloudSnapshot.advances[a.id] = a;
  }
  renderCurrent();
}

function handleRealtimeBoards(payload) {
  if (payload.eventType === 'DELETE') {
    planningBoards = planningBoards.filter(b => b.id !== payload.old.id);
    delete cloudSnapshot.planningBoards[payload.old.id];
  } else {
    const rowBoard = rowToBoard(payload.new);
    const existing = planningBoards.find(b => b.id === rowBoard.id);
    if (existing) { Object.assign(existing, rowBoard, { lessons: existing.lessons || [] }); }
    else { planningBoards.push(rowBoard); }
    cloudSnapshot.planningBoards[rowBoard.id] = boardSnapshotShape(rowBoard);
  }
  renderCurrent();
}

function handleRealtimeLessons(payload) {
  if (payload.eventType === 'DELETE') {
    planningBoards.forEach(b => { b.lessons = (b.lessons || []).filter(l => l.id !== payload.old.id); });
    delete cloudSnapshot.planningLessons[payload.old.id];
  } else {
    const lesson = rowToLesson(payload.new);
    const board = planningBoards.find(b => b.id === payload.new.board_id);
    if (board) {
      if (!board.lessons) board.lessons = [];
      const idx = board.lessons.findIndex(l => l.id === lesson.id);
      if (idx >= 0) board.lessons[idx] = lesson; else board.lessons.push(lesson);
    }
    cloudSnapshot.planningLessons[lesson.id] = { ...lesson, boardId: payload.new.board_id };
  }
  renderCurrent();
}

function handleRealtimeSettings(payload) {
  if (payload.eventType === 'DELETE') return;
  appSettings = payload.new.data;
  cloudSnapshot.appSettings = JSON.parse(JSON.stringify(appSettings));
  fillSelects();
  renderCurrent();
}
