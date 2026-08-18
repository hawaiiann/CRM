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
let cloudUserEmail = null;
let cloudSyncInFlight = false;
let cloudSyncPending = false;
let cloudSyncDebounceTimer = null;
let realtimeChannel = null;
let resolveAuthWait = null;

// Последнее отправленное/полученное из облака состояние — с ним сравниваем перед
// каждой отправкой, чтобы посылать только реально изменившиеся записи.
let cloudSnapshot = {
  orders: {}, tasks: {}, advances: {}, planningBoards: {}, planningLessons: {},
  appSettings: null, activityLogSyncedCount: 0,
  // updated_at последней ИЗВЕСТНОЙ НАМ версии каждой записи — основа для защиты от гонки
  // при записи (см. upsertWithConflictCheck ниже).
  updatedAt: { orders: {}, tasks: {}, advances: {}, planningBoards: {}, planningLessons: {} }
};

/* ---------- Вход + переключатель аккаунтов ---------- */

const KNOWN_ACCOUNTS_KEY = 'design_crm_known_accounts_v1';

// Аккаунты, куда когда-либо входили с "Запомнить меня" — email + токены сессии (не пароль!),
// чтобы переключатель в шапке сайдбара мог войти в них заново без повторного ввода пароля.
function getKnownAccounts() {
  try { return JSON.parse(localStorage.getItem(KNOWN_ACCOUNTS_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveKnownAccountsMap(map) {
  localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(map));
}
function rememberAccount(session) {
  const map = getKnownAccounts();
  map[session.user.id] = {
    email: session.user.email,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    lastUsed: Date.now()
  };
  saveKnownAccountsMap(map);
}
function forgetAccount(userId) {
  const map = getKnownAccounts();
  delete map[userId];
  saveKnownAccountsMap(map);
  renderAccountSwitcher();
}

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
  cloudUserEmail = session.user.email;
  // Держим токены свежими для УЖЕ запомненных аккаунтов (supabase-js их периодически ротирует) —
  // не добавляет новых записей сама по себе, только обновляет то, что уже было сохранено раньше.
  supabaseClient.auth.onAuthStateChange((event, s) => {
    if (s && getKnownAccounts()[s.user.id]) rememberAccount(s);
  });
  renderAccountSwitcher();
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
    if (rememberMeOnNextSignIn) rememberAccount(data.session);
    document.getElementById('authOverlay').classList.remove('show');
    document.getElementById('authForm').reset();
    if (resolveAuthWait) {
      resolveAuthWait(data.session);
      resolveAuthWait = null;
    } else {
      // Вход под другим аккаунтом поверх уже работающего приложения — проще и надёжнее
      // перезагрузить страницу, чтобы весь стейт (заказы, реалтайм-подписка) пересобрался с нуля.
      window.location.reload();
    }
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

/* ---------- UI переключателя аккаунтов (шапка сайдбара) ---------- */

function renderAccountSwitcher() {
  const emailEl = document.getElementById('accountSwitcherEmail');
  const menuEl = document.getElementById('accountSwitcherMenu');
  if (!emailEl || !menuEl) return;

  const map = getKnownAccounts();
  emailEl.textContent = cloudUserEmail || '';

  const others = Object.entries(map)
    .filter(([id]) => id !== cloudUserId)
    .sort((a, b) => b[1].lastUsed - a[1].lastUsed);

  const othersHtml = others.map(([id, acc]) => `
    <div class="account-switcher-item" onclick="switchToAccount('${id}')">
      <span>${escapeHtml(acc.email)}</span>
      <button type="button" class="account-switcher-remove" onclick="event.stopPropagation(); forgetAccount('${id}')" title="Забыть аккаунт (выйти из списка)">×</button>
    </div>
  `).join('');

  menuEl.innerHTML = `
    ${othersHtml}
    ${others.length ? '<div class="account-switcher-divider"></div>' : ''}
    <div class="account-switcher-item" onclick="addAnotherAccount()"><span>+ Войти под другим аккаунтом</span></div>
    <div class="account-switcher-item account-switcher-signout" onclick="signOutCloud()"><span>Выйти</span></div>
  `;
}

function toggleAccountSwitcherMenu(e) {
  if (e) e.stopPropagation();
  document.getElementById('accountSwitcher').classList.toggle('open');
}
function closeAccountSwitcherMenu() {
  const sw = document.getElementById('accountSwitcher');
  if (sw) sw.classList.remove('open');
}
document.addEventListener('click', (e) => {
  const sw = document.getElementById('accountSwitcher');
  if (sw && !sw.contains(e.target)) sw.classList.remove('open');
});

// Переключение на уже посещённый аккаунт — без пароля, по сохранённым токенам сессии.
async function switchToAccount(userId) {
  closeAccountSwitcherMenu();
  const acc = getKnownAccounts()[userId];
  if (!acc) return;
  const { error } = await supabaseClient.auth.setSession({ access_token: acc.access_token, refresh_token: acc.refresh_token });
  if (error) {
    alert('Не удалось переключиться — сессия этого аккаунта истекла. Войдите в него заново через "Войти под другим аккаунтом".');
    forgetAccount(userId);
    return;
  }
  window.location.reload();
}

// Показывает форму входа ПОВЕРХ уже работающего приложения (не разлогинивая текущего,
// пока не введут другие корректные данные) — для добавления ещё одного известного аккаунта.
function addAnotherAccount() {
  closeAccountSwitcherMenu();
  document.getElementById('authCloseBtn').style.display = '';
  document.getElementById('authOverlay').classList.add('show');
}
// Закрыть форму входа обратно, если её открыли поверх уже работающего приложения
// (при обязательном первом входе кнопки закрытия не показываем — см. authCloseBtn в index.html).
function closeAuthOverlayIfDismissable() {
  if (resolveAuthWait) return; // обязательный первый вход — так просто не закрыть
  document.getElementById('authOverlay').classList.remove('show');
  document.getElementById('authForm').reset();
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
// baseTemplate копируем, а не берём ссылкой — иначе снимок доски меняется вместе с живой
// доской и правки шаблона наполнения класса не доезжают до облака (см. snapshotCopy).
function boardSnapshotShape(b) {
  return { id: b.id, subject: b.subject || '', title: b.title || '', quarter: b.quarter || '', deadline: b.deadline || '', baseTemplate: JSON.parse(JSON.stringify(b.baseTemplate || [])), collapsed: !!b.collapsed, archived: !!b.archived };
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

// КРИТИЧНО: в снимок всегда кладём ГЛУБОКУЮ КОПИЮ, а не ссылку на живой объект из
// orders/appTasks/planningBoards. Иначе снимок и текущее состояние — одна и та же память,
// сравнение "что изменилось" сравнивает объект сам с собой и правки, сделанные ПО МЕСТУ
// (клик "Оплачено", чекбокс "Готов", списание времени таймером, галочки в чек-листе урока),
// никогда не попадают в облако: локально применилось, в облаке старое, после перезагрузки
// значение "слетает" обратно. Правки через форму заказа при этом сохранялись — там создаётся
// новый объект, и разница была видна. Отсюда и эффект "часть данных сохраняется, часть нет".
function snapshotCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

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

// Защита от гонки при ОБНОВЛЕНИИ (не только удалении — см. v1.19.3 для удаления): если
// одновременно открыты 2 сессии одного аккаунта (телефон + компьютер), устаревшая копия
// не должна молча перезаписать полями то, что сервер уже получил от свежей сессии.
//
// updated_at генерируем на клиенте при каждой записи (без правок схемы БД — не нужен
// доп. SQL/триггер) и используем его же как условие для следующей записи: если запись уже
// существовала — UPDATE идёт с WHERE updated_at = <последнее известное нам значение>.
// Если сервер её с тех пор изменил кто-то другой, 0 строк совпадёт — вместо слепой
// перезаписи забираем актуальную версию с сервера и подставляем её локально.
// Одна попытка условного UPDATE — WHERE id = ... AND updated_at = compareAt.
// true = применилось (и updatedAtMap обновлён свежим значением), false = 0 строк совпало.
async function tryConditionalUpdate(table, id, item, toRowFn, compareAt, updatedAtMap) {
  const payload = { ...toRowFn(item), updated_at: new Date().toISOString() };
  const { data, error } = await supabaseClient.from(table)
    .update(payload).eq('id', id).eq('updated_at', compareAt)
    .select('updated_at');
  if (error) throw error;
  if (!data || !data.length) return false;
  updatedAtMap[id] = data[0].updated_at;
  return true;
}

async function upsertWithConflictCheck(table, items, toRowFn, cloudSnapshotMap, updatedAtMap, mergeServerRow) {
  for (const item of items) {
    const id = item.id;
    const known = updatedAtMap[id];
    try {
      if (known) {
        let applied = await tryConditionalUpdate(table, id, item, toRowFn, known, updatedAtMap);
        if (!applied) {
          // 0 строк совпало — это НЕ обязательно чужая правка: наш собственный known мог
          // просто отстать (гонка внутри той же сессии, задержка realtime-эха и т.п.).
          // Прежде чем сдаться и подставить чужую версию поверх только что сделанной
          // локальной правки — один раз перечитываем актуальный updated_at и пробуем ещё раз.
          const { data: freshRow } = await supabaseClient.from(table).select('updated_at').eq('id', id).maybeSingle();
          if (freshRow) applied = await tryConditionalUpdate(table, id, item, toRowFn, freshRow.updated_at, updatedAtMap);
        }
        if (!applied) {
          // Действительно конфликт (или запись успела исчезнуть) — здесь уже разумно
          // считать сервер источником истины и подставить его версию локально.
          await resolveSyncConflict(table, id, updatedAtMap, mergeServerRow);
          continue;
        }
      } else {
        const payload = { ...toRowFn(item), updated_at: new Date().toISOString() };
        const { data, error } = await supabaseClient.from(table).insert(payload).select('updated_at').single();
        if (error) throw error;
        updatedAtMap[id] = data.updated_at;
      }
      cloudSnapshotMap[id] = snapshotCopy(item);
    } catch (err) {
      console.error(`Ошибка синхронизации записи (${table}/${id}):`, err);
    }
  }
}

// Конфликт обнаружен — сервер новее нашей последней известной версии. Сервер прав
// (там правки другой, более свежей сессии), забираем его версию и применяем локально.
async function resolveSyncConflict(table, id, updatedAtMap, mergeServerRow) {
  const { data } = await supabaseClient.from(table).select('*').eq('id', id).maybeSingle();
  if (!data) { delete updatedAtMap[id]; mergeServerRow(null, id); return; } // тем временем удалена кем-то другим
  updatedAtMap[id] = data.updated_at;
  mergeServerRow(data, id);
}

/* ---------- Отправка изменений в облако ---------- */

async function performCloudSync() {
  if (!cloudUserId) return;
  if (cloudSyncInFlight) { cloudSyncPending = true; return; }
  cloudSyncInFlight = true;
  try {
    const { currentMap: ordersMap } = diffById(orders);
    const ordersDiff = collectionChanged(ordersMap, cloudSnapshot.orders);
    if (ordersDiff.toUpsert.length) {
      await upsertWithConflictCheck('orders', ordersDiff.toUpsert, orderToRow, cloudSnapshot.orders, cloudSnapshot.updatedAt.orders, (row, id) => {
        if (row) {
          const o = normalizeOrder(rowToOrder(row));
          const idx = orders.findIndex(x => x.id === o.id);
          if (idx >= 0) orders[idx] = o; else orders.push(o);
          cloudSnapshot.orders[o.id] = snapshotCopy(o);
        } else {
          orders = orders.filter(x => x.id !== id); // сервер: запись удалена другой сессией тем временем
          delete cloudSnapshot.orders[id];
        }
        syncPlanningWithOrders();
        renderCurrent();
      });
    }

    const { currentMap: tasksMap } = diffById(appTasks);
    const tasksDiff = collectionChanged(tasksMap, cloudSnapshot.tasks);
    if (tasksDiff.toUpsert.length) {
      await upsertWithConflictCheck('tasks', tasksDiff.toUpsert, taskToRow, cloudSnapshot.tasks, cloudSnapshot.updatedAt.tasks, (row, id) => {
        if (row) {
          const t = normalizeTask(rowToTask(row));
          const idx = appTasks.findIndex(x => x.id === t.id);
          if (idx >= 0) appTasks[idx] = t; else appTasks.push(t);
          cloudSnapshot.tasks[t.id] = snapshotCopy(t);
        } else {
          appTasks = appTasks.filter(x => x.id !== id);
          delete cloudSnapshot.tasks[id];
        }
        renderCurrent();
      });
    }

    const { currentMap: advMap } = diffById(advances);
    const advDiff = collectionChanged(advMap, cloudSnapshot.advances);
    if (advDiff.toUpsert.length) {
      await upsertWithConflictCheck('advances', advDiff.toUpsert, advanceToRow, cloudSnapshot.advances, cloudSnapshot.updatedAt.advances, (row, id) => {
        if (row) {
          const a = normalizeAdvance(rowToAdvance(row));
          const idx = advances.findIndex(x => x.id === a.id);
          if (idx >= 0) advances[idx] = a; else advances.push(a);
          cloudSnapshot.advances[a.id] = snapshotCopy(a);
        } else {
          advances = advances.filter(x => x.id !== id);
          delete cloudSnapshot.advances[id];
        }
        renderCurrent();
      });
    }

    const { currentMap: boardsMap } = diffById(planningBoards.map(boardSnapshotShape));
    const boardsDiff = collectionChanged(boardsMap, cloudSnapshot.planningBoards);
    if (boardsDiff.toUpsert.length) {
      await upsertWithConflictCheck('planning_boards', boardsDiff.toUpsert, boardToRow, cloudSnapshot.planningBoards, cloudSnapshot.updatedAt.planningBoards, (row, id) => {
        if (row) {
          const rowBoard = rowToBoard(row);
          const existing = planningBoards.find(b => b.id === rowBoard.id);
          if (existing) Object.assign(existing, rowBoard, { lessons: existing.lessons || [] });
          else planningBoards.push(rowBoard);
          cloudSnapshot.planningBoards[rowBoard.id] = boardSnapshotShape(rowBoard);
        } else {
          planningBoards = planningBoards.filter(b => b.id !== id);
          delete cloudSnapshot.planningBoards[id];
        }
        renderCurrent();
      });
    }

    const allLessons = [];
    planningBoards.forEach(b => (b.lessons || []).forEach(l => allLessons.push({ ...l, boardId: b.id })));
    const { currentMap: lessonsMap } = diffById(allLessons);
    const lessonsDiff = collectionChanged(lessonsMap, cloudSnapshot.planningLessons);
    if (lessonsDiff.toUpsert.length) {
      await upsertWithConflictCheck('planning_lessons', lessonsDiff.toUpsert, lessonToRow, cloudSnapshot.planningLessons, cloudSnapshot.updatedAt.planningLessons, (row, id) => {
        if (row) {
          const lesson = rowToLesson(row);
          const board = planningBoards.find(b => b.id === row.board_id);
          if (board) {
            if (!board.lessons) board.lessons = [];
            const idx = board.lessons.findIndex(l => l.id === lesson.id);
            if (idx >= 0) board.lessons[idx] = lesson; else board.lessons.push(lesson);
          }
          cloudSnapshot.planningLessons[lesson.id] = snapshotCopy({ ...lesson, boardId: row.board_id });
        } else {
          planningBoards.forEach(b => { b.lessons = (b.lessons || []).filter(l => l.id !== id); });
          delete cloudSnapshot.planningLessons[id];
        }
        renderCurrent();
      });
    }

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

  // Тоже глубокие копии: planningBoards уходят в приложение теми же объектами, что и здесь,
  // а orders/tasks/advances хоть и пересобираются через normalize*() в db.js — полагаться на
  // это опасно, снимок обязан быть независимой копией (см. snapshotCopy).
  cloudSnapshot.orders = {}; pulledOrders.forEach(o => { cloudSnapshot.orders[o.id] = snapshotCopy(o); });
  cloudSnapshot.tasks = {}; pulledTasks.forEach(t => { cloudSnapshot.tasks[t.id] = snapshotCopy(t); });
  cloudSnapshot.advances = {}; pulledAdvances.forEach(a => { cloudSnapshot.advances[a.id] = snapshotCopy(a); });
  cloudSnapshot.planningBoards = {}; boards.forEach(b => { cloudSnapshot.planningBoards[b.id] = boardSnapshotShape(b); });
  cloudSnapshot.planningLessons = {};
  boards.forEach(b => (b.lessons || []).forEach(l => { cloudSnapshot.planningLessons[l.id] = snapshotCopy({ ...l, boardId: b.id }); }));
  cloudSnapshot.appSettings = pulledSettings ? JSON.parse(JSON.stringify(pulledSettings)) : null;
  cloudSnapshot.activityLogSyncedCount = pulledLog.length;

  // updated_at каждой записи — точка отсчёта для защиты от гонки при следующей записи
  // (см. upsertWithConflictCheck): без этого самая первая правка после открытия страницы
  // не с чем было бы сверить.
  cloudSnapshot.updatedAt = { orders: {}, tasks: {}, advances: {}, planningBoards: {}, planningLessons: {} };
  (ordersRes.data || []).forEach(r => { cloudSnapshot.updatedAt.orders[r.id] = r.updated_at; });
  (tasksRes.data || []).forEach(r => { cloudSnapshot.updatedAt.tasks[r.id] = r.updated_at; });
  (advRes.data || []).forEach(r => { cloudSnapshot.updatedAt.advances[r.id] = r.updated_at; });
  (boardsRes.data || []).forEach(r => { cloudSnapshot.updatedAt.planningBoards[r.id] = r.updated_at; });
  (lessonsRes.data || []).forEach(r => { cloudSnapshot.updatedAt.planningLessons[r.id] = r.updated_at; });

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
    delete cloudSnapshot.updatedAt.orders[payload.old.id];
  } else {
    const o = normalizeOrder(rowToOrder(payload.new));
    const idx = orders.findIndex(x => x.id === o.id);
    if (idx >= 0) orders[idx] = o; else orders.push(o);
    cloudSnapshot.orders[o.id] = snapshotCopy(o);
    cloudSnapshot.updatedAt.orders[o.id] = payload.new.updated_at;
  }
  syncPlanningWithOrders();
  renderCurrent();
}

function handleRealtimeTasks(payload) {
  if (payload.eventType === 'DELETE') {
    appTasks = appTasks.filter(t => t.id !== payload.old.id);
    delete cloudSnapshot.tasks[payload.old.id];
    delete cloudSnapshot.updatedAt.tasks[payload.old.id];
  } else {
    const t = normalizeTask(rowToTask(payload.new));
    const idx = appTasks.findIndex(x => x.id === t.id);
    if (idx >= 0) appTasks[idx] = t; else appTasks.push(t);
    cloudSnapshot.tasks[t.id] = snapshotCopy(t);
    cloudSnapshot.updatedAt.tasks[t.id] = payload.new.updated_at;
  }
  renderCurrent();
}

function handleRealtimeAdvances(payload) {
  if (payload.eventType === 'DELETE') {
    advances = advances.filter(a => a.id !== payload.old.id);
    delete cloudSnapshot.advances[payload.old.id];
    delete cloudSnapshot.updatedAt.advances[payload.old.id];
  } else {
    const a = normalizeAdvance(rowToAdvance(payload.new));
    const idx = advances.findIndex(x => x.id === a.id);
    if (idx >= 0) advances[idx] = a; else advances.push(a);
    cloudSnapshot.advances[a.id] = snapshotCopy(a);
    cloudSnapshot.updatedAt.advances[a.id] = payload.new.updated_at;
  }
  renderCurrent();
}

function handleRealtimeBoards(payload) {
  if (payload.eventType === 'DELETE') {
    planningBoards = planningBoards.filter(b => b.id !== payload.old.id);
    delete cloudSnapshot.planningBoards[payload.old.id];
    delete cloudSnapshot.updatedAt.planningBoards[payload.old.id];
  } else {
    const rowBoard = rowToBoard(payload.new);
    const existing = planningBoards.find(b => b.id === rowBoard.id);
    if (existing) { Object.assign(existing, rowBoard, { lessons: existing.lessons || [] }); }
    else { planningBoards.push(rowBoard); }
    cloudSnapshot.planningBoards[rowBoard.id] = boardSnapshotShape(rowBoard);
    cloudSnapshot.updatedAt.planningBoards[rowBoard.id] = payload.new.updated_at;
  }
  renderCurrent();
}

function handleRealtimeLessons(payload) {
  if (payload.eventType === 'DELETE') {
    planningBoards.forEach(b => { b.lessons = (b.lessons || []).filter(l => l.id !== payload.old.id); });
    delete cloudSnapshot.planningLessons[payload.old.id];
    delete cloudSnapshot.updatedAt.planningLessons[payload.old.id];
  } else {
    const lesson = rowToLesson(payload.new);
    const board = planningBoards.find(b => b.id === payload.new.board_id);
    if (board) {
      if (!board.lessons) board.lessons = [];
      const idx = board.lessons.findIndex(l => l.id === lesson.id);
      if (idx >= 0) board.lessons[idx] = lesson; else board.lessons.push(lesson);
    }
    cloudSnapshot.planningLessons[lesson.id] = snapshotCopy({ ...lesson, boardId: payload.new.board_id });
    cloudSnapshot.updatedAt.planningLessons[lesson.id] = payload.new.updated_at;
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
