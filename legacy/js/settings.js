/* ============================================================
 * settings.js — Настройки: справочники (клиенты/предметы/классы), автобэкап
 * ============================================================ */

const EYE_OPEN_SVG = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"/><circle cx="10" cy="10" r="2.5"/></svg>`;
const EYE_CLOSED_SVG = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 2.5l15 15M6.2 6.5C3.7 8 1 10 1 10s3.5 6 9 6c1.7 0 3.2-.5 4.5-1.2M9 4.1c.3 0 .7 0 1-0 5.5 0 9 6 9 6-.4.7-1.3 2-2.6 3.2M8.2 8.3a2.5 2.5 0 0 0 3.5 3.5" stroke-linecap="round"/></svg>`;

function renderSettings(){
  ['clients','types','units','subjects','classes'].forEach(key=>{
    const el = document.getElementById(`set-${key}`);
    if(!el) return;
    const hiddenList = (appSettings.hiddenEntries && appSettings.hiddenEntries[key]) || [];
    el.innerHTML = appSettings[key].map((val, idx) => {
      const isHidden = hiddenList.includes(val);
      return `
      <div class="settings-row" style="${isHidden ? 'opacity:0.5;' : ''}">
        <button class="btn-move" title="Вверх" onclick="moveSetting('${key}', ${idx}, -1)" ${idx===0?'disabled style="opacity:0.3"':''}>
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 12l-5-5-5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn-move" title="Вниз" onclick="moveSetting('${key}', ${idx}, 1)" ${idx===appSettings[key].length-1?'disabled style="opacity:0.3"':''}>
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l5 5 5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <input type="text" value="${escapeHtml(val)}" title="${escapeHtml(val)}" style="${isHidden ? 'text-decoration:line-through;' : ''}" oninput="this.title=this.value; updateSettingSilent('${key}', ${idx}, this.value)">
        <button class="btn secondary small" style="padding:6px 8px;" title="${isHidden ? 'Показать в списках выбора' : 'Скрыть из списков выбора (без удаления)'}" onclick="toggleSettingHidden('${key}', ${idx})">
          ${isHidden ? EYE_CLOSED_SVG : EYE_OPEN_SVG}
        </button>
        <button class="btn danger small" style="padding:6px 8px;" onclick="removeSetting('${key}', ${idx})">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;
    }).join('');
  });

  document.getElementById('cfg_backupEnabled').value = String(backupSettings.enabled);
  document.getElementById('cfg_backupInterval').value = backupSettings.interval || 'change';
  document.getElementById('cfg_backupPath').value = backupSettings.path || '';
  document.getElementById('lastBackupTimeDisplay').textContent = backupSettings.lastBackup ? new Date(backupSettings.lastBackup).toLocaleString('ru') : 'Еще не производился';

  renderDashboardMetricsSettings();
  renderOrderTemplatesSettings();
}

/* ---------- Шаблоны заказов ----------
 * Готовый набор позиций (тип/ед.изм/кол-во/ставка) для быстрого создания заказа —
 * применяется через выпадающий список "Вставить шаблон" в форме заказа (см. orders.js
 * applyOrderTemplate/populateOrderTemplateSelect). Черновик редактора живёт в
 * currentTemplateLines по тому же принципу, что currentLines для позиций заказа. */
let currentTemplateLines = [];

function renderOrderTemplatesSettings() {
  const list = document.getElementById('orderTemplatesList');
  if (!list) return;
  const templates = appSettings.orderTemplates || [];
  list.innerHTML = templates.length ? templates.map(t => `
    <div class="order-template-row">
      <div>
        <div class="order-template-row-name">${escapeHtml(t.name)}</div>
        <div class="order-template-row-lines">${(t.lines || []).map(l => escapeHtml(l.label || '?')).join(', ') || 'нет позиций'}</div>
      </div>
      <div class="order-template-row-actions">
        <button type="button" class="btn secondary small" onclick="openTemplateEditor('${t.id}')">Изменить</button>
        <button type="button" class="btn danger small" onclick="deleteOrderTemplate('${t.id}')">Удалить</button>
      </div>
    </div>
  `).join('') : `<div style="font-size:12.5px; color:var(--text-faint);">Шаблонов пока нет.</div>`;
}

function openTemplateEditor(id) {
  const t = id ? (appSettings.orderTemplates || []).find(x => x.id === id) : null;
  document.getElementById('templateId').value = t ? t.id : '';
  document.getElementById('templateModalTitle').textContent = t ? 'Изменить шаблон' : 'Новый шаблон';
  document.getElementById('tpl_name').value = t ? t.name : '';
  currentTemplateLines = t ? JSON.parse(JSON.stringify(t.lines || [])) : [];
  if (!currentTemplateLines.length) addTemplateLine(); // хотя бы одна пустая строка для старта
  else renderTemplateLinesEditor();
  const ov = document.getElementById('templateOverlay');
  ov.classList.add('show');
  ov.scrollTop = 0; // см. openModal() в orders.js — та же защита от "открылось прокрученным"
}

function closeTemplateEditor() {
  document.getElementById('templateOverlay').classList.remove('show');
}

function addTemplateLine() {
  currentTemplateLines.push({ id: 'tl_' + Date.now() + Math.random().toString(36).slice(2, 7), label: '', type: '', qty: 1, rate: 0 });
  renderTemplateLinesEditor();
}

function removeTemplateLine(id) {
  currentTemplateLines = currentTemplateLines.filter(l => l.id !== id);
  renderTemplateLinesEditor();
}

function updateTemplateLineField(id, field, value) {
  const l = currentTemplateLines.find(x => x.id === id);
  if (l) l[field] = value;
}

function renderTemplateLinesEditor() {
  const body = document.getElementById('templateLinesBody');
  if (!body) return;
  body.innerHTML = currentTemplateLines.map(l => `
    <div class="tpl-line-row" data-id="${l.id}">
      ${renderComboField(`tplLabel-${l.id}`, l.label, 'Тип...', catalogWithCurrent('types', l.label), `updateTemplateLineField('${l.id}','label',this.value);`)}
      ${renderComboField(`tplUnit-${l.id}`, l.type, 'Ед. изм...', catalogWithCurrent('units', l.type), `updateTemplateLineField('${l.id}','type',this.value);`)}
      <input type="text" inputmode="decimal" value="${l.qty}" placeholder="1" oninput="updateTemplateLineField('${l.id}','qty',this.value);">
      <input type="text" inputmode="decimal" value="${l.rate}" placeholder="0 ₽" oninput="updateTemplateLineField('${l.id}','rate',this.value);">
      <button type="button" class="line-rm" onclick="removeTemplateLine('${l.id}')">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
      </button>
    </div>
  `).join('');
}

function saveTemplateFromEditor() {
  const name = document.getElementById('tpl_name').value.trim();
  if (!name) { alert('Введите название шаблона.'); return; }
  const lines = currentTemplateLines
    .filter(l => (l.label || '').trim() !== '')
    .map(l => ({ id: l.id, label: l.label.trim(), type: (l.type || '').trim(), qty: parseNum(l.qty) || 1, rate: parseNum(l.rate) || 0 }));
  if (!lines.length) { alert('Добавьте хотя бы одну позицию с названием.'); return; }

  const id = document.getElementById('templateId').value;
  if (id) {
    const t = appSettings.orderTemplates.find(x => x.id === id);
    if (t) { t.name = name; t.lines = lines; }
  } else {
    appSettings.orderTemplates.push({ id: 'tpl_' + Date.now() + Math.random().toString(36).slice(2, 7), name, lines });
  }
  saveData();
  renderOrderTemplatesSettings();
  populateOrderTemplateSelect();
  closeTemplateEditor();
}

function deleteOrderTemplate(id) {
  if (!confirm('Удалить этот шаблон? Уже созданные заказы это не затронет.')) return;
  appSettings.orderTemplates = (appSettings.orderTemplates || []).filter(t => t.id !== id);
  saveData();
  renderOrderTemplatesSettings();
  populateOrderTemplateSelect();
}

function renderDashboardMetricsSettings() {
  const el = document.getElementById('dashboardMetricsList');
  if (!el) return;
  const usedTypes = appSettings.dashboardMetrics.map(m => m.type);
  el.innerHTML = appSettings.dashboardMetrics.map((m, idx) => {
    const info = DASHBOARD_METRIC_TYPES[m.type] || DASHBOARD_METRIC_TYPES.hours;
    const isHidden = !!m.hidden;
    return `
    <div class="settings-row" style="gap:10px; flex-wrap:wrap; ${isHidden ? 'opacity:0.5;' : ''}">
      <select style="flex:1.4; min-width:150px;" onchange="updateDashboardMetricType(${idx}, this.value)">
        ${Object.entries(DASHBOARD_METRIC_TYPES).map(([key, i2]) => `
          <option value="${key}" ${m.type === key ? 'selected' : ''} ${usedTypes.includes(key) && m.type !== key ? 'disabled' : ''}>${i2.label}${i2.secondary ? ' + ' + i2.secondary.pairLabel : ''}</option>
        `).join('')}
      </select>
      <input type="number" min="0" step="any" value="${m.goal}" placeholder="Цель: ${escapeHtml(info.label)}" title="Цель: ${escapeHtml(info.label)}" style="flex:1; min-width:110px;" oninput="updateDashboardMetricGoal(${idx}, this.value)">
      ${info.secondary ? `<input type="number" min="0" step="any" value="${m.secondaryGoal || 0}" placeholder="Цель: ${escapeHtml(info.secondary.pairLabel)}" title="Цель: ${escapeHtml(info.secondary.pairLabel)}" style="flex:1; min-width:110px;" oninput="updateDashboardMetricSecondaryGoal(${idx}, this.value)">` : ''}
      <button class="btn secondary small" style="padding:6px 8px;" title="${isHidden ? 'Показать на дашборде' : 'Скрыть с дашборда (настройки и цель сохранятся)'}" onclick="toggleDashboardMetricHidden(${idx})">
        ${isHidden ? EYE_CLOSED_SVG : EYE_OPEN_SVG}
      </button>
      <button class="btn danger small" style="padding:6px 8px;" onclick="removeDashboardMetric(${idx})" ${appSettings.dashboardMetrics.length <= 1 ? 'disabled style="opacity:0.3;"' : ''}>
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
      </button>
    </div>
  `;
  }).join('');
}

function addDashboardMetric() {
  const usedTypes = appSettings.dashboardMetrics.map(m => m.type);
  const freeType = Object.keys(DASHBOARD_METRIC_TYPES).find(k => !usedTypes.includes(k)) || Object.keys(DASHBOARD_METRIC_TYPES)[0];
  appSettings.dashboardMetrics.push({ id: 'dm' + Date.now(), type: freeType, goal: 0, secondaryGoal: 0, hidden: false });
  saveData();
  renderDashboardMetricsSettings();
  renderCurrent();
}

function updateDashboardMetricType(idx, val) {
  if (appSettings.dashboardMetrics[idx]) appSettings.dashboardMetrics[idx].type = val;
  saveData();
  renderDashboardMetricsSettings();
  renderCurrent();
}

function updateDashboardMetricGoal(idx, val) {
  if (appSettings.dashboardMetrics[idx]) appSettings.dashboardMetrics[idx].goal = parseNum(val);
  saveData();
  renderDashboardMetricsGrid(); // обновляем сам дашборд, но НЕ список настроек — иначе поле теряет фокус после каждой цифры
}

function updateDashboardMetricSecondaryGoal(idx, val) {
  if (appSettings.dashboardMetrics[idx]) appSettings.dashboardMetrics[idx].secondaryGoal = parseNum(val);
  saveData();
  renderDashboardMetricsGrid();
}

// Скрыть показатель с дашборда, не удаляя настройку (цель, доп. цель) — можно вернуть обратно.
function toggleDashboardMetricHidden(idx) {
  if (!appSettings.dashboardMetrics[idx]) return;
  appSettings.dashboardMetrics[idx].hidden = !appSettings.dashboardMetrics[idx].hidden;
  saveData();
  renderDashboardMetricsSettings();
  renderCurrent();
}

function removeDashboardMetric(idx) {
  if (appSettings.dashboardMetrics.length <= 1) return;
  const m = appSettings.dashboardMetrics[idx];
  const label = m && DASHBOARD_METRIC_TYPES[m.type] ? DASHBOARD_METRIC_TYPES[m.type].label : 'этот показатель';
  if (!confirm(`Убрать показатель «${label}» с графика "Активность"?`)) return;
  appSettings.dashboardMetrics.splice(idx, 1);
  saveData();
  renderDashboardMetricsSettings();
  renderCurrent();
}

function updateSettingSilent(key, idx, val){
  // Скрытая запись отслеживается по тексту — при переименовании переносим её
  // в hiddenEntries на новый текст, иначе скрытие молча слетит.
  const oldVal = appSettings[key][idx];
  const hiddenList = appSettings.hiddenEntries[key];
  const hiddenIdx = hiddenList.indexOf(oldVal);
  if (hiddenIdx !== -1) hiddenList[hiddenIdx] = val;
  appSettings[key][idx] = val;
  saveData(); fillSelects();
}
function moveSetting(key, idx, dir){
  const newIdx = idx + dir;
  if(newIdx < 0 || newIdx >= appSettings[key].length) return;
  const temp = appSettings[key][idx];
  appSettings[key][idx] = appSettings[key][newIdx];
  appSettings[key][newIdx] = temp;
  saveData(); fillSelects(); renderSettings();
}
// Скрыть/показать позицию в списках выбора вместо удаления — старые заказы/уроки,
// где значение уже использовано, продолжают ссылаться на тот же текст без изменений.
function toggleSettingHidden(key, idx){
  const val = appSettings[key][idx];
  const hiddenList = appSettings.hiddenEntries[key];
  const pos = hiddenList.indexOf(val);
  if (pos === -1) hiddenList.push(val); else hiddenList.splice(pos, 1);
  saveData(); fillSelects(); renderSettings();
}
function removeSetting(key, idx){
  const val = appSettings[key][idx];
  if (!confirm(`Удалить «${val}» из справочника? Если позиция где-то ещё используется — лучше скрыть её глазком, а не удалять.`)) return;
  appSettings[key].splice(idx,1);
  const hiddenList = appSettings.hiddenEntries[key];
  const hiddenIdx = hiddenList.indexOf(val);
  if (hiddenIdx !== -1) hiddenList.splice(hiddenIdx, 1);
  saveData(); fillSelects(); renderSettings();
}
function addSetting(key){ appSettings[key].push('Новая запись'); saveData(); fillSelects(); renderSettings(); }

function saveBackupSettings() {
  backupSettings.enabled = document.getElementById('cfg_backupEnabled').value === 'true';
  backupSettings.interval = document.getElementById('cfg_backupInterval').value;
  backupSettings.path = document.getElementById('cfg_backupPath').value.trim();
  localStorage.setItem(BACKUP_CFG_KEY, JSON.stringify(backupSettings));
}

// Раньше здесь было одно имя на все бэкапы, и файл затирал сам себя при каждом
// сохранении. Из-за этого 20.08.2026, когда миграция снесла журнал часов,
// автобэкап тут же записал испорченные данные поверх целых, и откатываться
// стало не на что. Теперь на каждый аккаунт и каждый день — отдельный файл.
const BACKUP_RETENTION_DAYS = 45;

function backupDayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function backupAccountSlug() {
  const base = String((typeof cloudUserEmail !== 'undefined' && cloudUserEmail) || (typeof cloudUserId !== 'undefined' && cloudUserId) || 'account').toLowerCase();
  return base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'account';
}

// Если новый бэкап заметно беднее уже лежащего за сегодня — затирать нельзя:
// ровно так выглядела потеря журнала 20.08.2026.
function backupLooksLikeLoss(prev, next) {
  const pairs = [['orders', 'заказы'], ['advances', 'авансы'], ['tasks', 'задачи'], ['activityLog', 'журнал']];
  for (const [k, label] of pairs) {
    const a = Array.isArray(prev && prev[k]) ? prev[k].length : 0;
    const b = Array.isArray(next && next[k]) ? next[k].length : 0;
    if (a >= 5 && b < a * 0.7) return label + ': было ' + a + ', стало ' + b;
  }
  return null;
}

async function pruneOldBackups(dir) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BACKUP_RETENTION_DAYS);
  const cutoffKey = backupDayKey(cutoff);
  try {
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file') continue;
      // Шаблон намеренно строгий. Широкий вариант сносил бы и ручные выгрузки
      // crm-backup-<дата>.json (в том числе файл от 18.08.2026 с единственной
      // уцелевшей историей часов), и аварийные «-ВНИМАНИЕ-данных-меньше-» —
      // то есть ровно те, что нужны дольше всех. Автоочистка, стирающая
      // невосстановимое, хуже, чем её отсутствие.
      if (entry.name.indexOf('crm-backup-') === 0) continue;
      const m = /^crm-(.+)-(\d{4}-\d{2}-\d{2})\.json$/.exec(entry.name);
      if (m && m[2] < cutoffKey) { try { await dir.removeEntry(entry.name); } catch (e) {} }
    }
  } catch (e) { /* перебор недоступен — чистка не критична */ }
}
const BACKUP_HANDLE_DB = 'design_crm_dirhandle_db';
const BACKUP_HANDLE_STORE = 'handles';

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_HANDLE_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(BACKUP_HANDLE_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirectoryHandleToDB(handle) {
  try {
    const db = await openHandleDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BACKUP_HANDLE_STORE, 'readwrite');
      tx.objectStore(BACKUP_HANDLE_STORE).put(handle, 'backupDir');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch(e) { console.error('Не удалось сохранить доступ к папке', e); }
}

// Пытается восстановить доступ к ранее выбранной папке при открытии CRM,
// чтобы не приходилось выбирать её заново каждый раз.
async function restoreBackupDirectoryHandle() {
  try {
    const db = await openHandleDB();
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction(BACKUP_HANDLE_STORE, 'readonly');
      const req = tx.objectStore(BACKUP_HANDLE_STORE).get('backupDir');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (!handle) { updateBackupStatusUI(); return; }
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      directoryHandle = handle;
    } else {
      // Браузер требует явного клика пользователя, чтобы разрешить доступ заново —
      // сама папка "помнится", но её нужно один раз подтвердить кнопкой.
      directoryHandle = null;
    }
  } catch(e) { directoryHandle = null; }
  updateBackupStatusUI();
}

// Честно показывает, реально ли есть доступ к папке на диске прямо сейчас
function updateBackupStatusUI() {
  const warn = document.getElementById('backupDirWarning');
  if (!warn) return;
  if (backupSettings.path && !directoryHandle) {
    warn.style.display = 'block';
    warn.textContent = 'Доступ к папке нужно подтвердить заново — нажмите "Выбрать папку".';
  } else {
    warn.style.display = 'none';
  }
}

async function selectBackupDirectory() {
  if ('showDirectoryPicker' in window) {
    try {
      directoryHandle = await window.showDirectoryPicker();
      backupSettings.path = directoryHandle.name;
      document.getElementById('cfg_backupPath').value = directoryHandle.name;
      saveBackupSettings();
      await saveDirectoryHandleToDB(directoryHandle);
      updateBackupStatusUI();
    } catch(err) { console.log('Directory pick cancelled'); }
  } else {
    alert('Укажите полный путь к вашей папке на диске в текстовом поле.');
  }
}

async function triggerAutoBackupProcess() {
  if (!backupSettings.enabled) return;

  const backupData = {
    orders: orders,
    settings: appSettings,
    tasks: appTasks,
    advances: advances,
    planning: planningBoards,
    activityLog: activityLog,
    timestamp: Date.now()
  };
  const jsonStr = JSON.stringify(backupData, null, 2);

  let saved = false;
  if (directoryHandle) {
    try {
      // Проверяем/запрашиваем разрешение на запись — на случай, если доступ протух
      let perm = await directoryHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await directoryHandle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        const slug = backupAccountSlug();
        const todayName = 'crm-' + slug + '-' + backupDayKey() + '.json';

        let prev = null;
        try {
          const fh = await directoryHandle.getFileHandle(todayName);
          prev = JSON.parse(await (await fh.getFile()).text());
        } catch (e) { /* сегодняшнего файла ещё нет */ }

        const shrink = prev ? backupLooksLikeLoss(prev, backupData) : null;
        // Данных стало меньше — прежний файл не трогаем, новый кладём рядом,
        // чтобы уцелели оба и расхождение было видно.
        const name = shrink
          ? 'crm-' + slug + '-' + backupDayKey() + '-ВНИМАНИЕ-данных-меньше-' + new Date().toTimeString().slice(0,5).replace(':','-') + '.json'
          : todayName;
        if (shrink) console.warn('Бэкап не перезаписан: данных стало меньше (' + shrink + '). Прежний файл сохранён.');

        const fileHandle = await directoryHandle.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
        await pruneOldBackups(directoryHandle);
        saved = true;
      }
    } catch(e) { console.error('Directory write error', e); }
  }

  if (!saved) {
    // Реальной папки на диске сейчас нет — сохраняем только внутри браузера
    // и ЧЕСТНО сообщаем, что бэкап "на диск" не выгружен.
    localStorage.setItem('crm_last_auto_backup', jsonStr);
    const timeDisp = document.getElementById('lastBackupTimeDisplay');
    if(timeDisp) timeDisp.textContent = 'Не удалось сохранить в папку — нажмите "Выбрать папку" заново';
    updateBackupStatusUI();
    return;
  }

  backupSettings.lastBackup = Date.now();
  localStorage.setItem(BACKUP_CFG_KEY, JSON.stringify(backupSettings));
  const timeDisp = document.getElementById('lastBackupTimeDisplay');
  if(timeDisp) timeDisp.textContent = new Date().toLocaleString('ru') + ' — файл сохранён в папку';

}

function triggerManualBackup() {
  triggerAutoBackupProcess();
  document.getElementById('btnExport').click();
}

function ensureSelectOption(selectId, val) {
  if (!val) return;
  const select = document.getElementById(selectId);
  if (!select) return;
  let exists = false;
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].value === val) { exists = true; break; }
  }
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = val;
    select.appendChild(opt);
  }
}

function fillSelects(){
  const makeOpts = arr => (arr||[]).map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
  const subjEl = document.getElementById('f_subject');
  const classEl = document.getElementById('f_class');
  
  const curSubj = subjEl ? subjEl.value : '';
  const curClass = classEl ? classEl.value : '';

  if(subjEl) subjEl.innerHTML = `<option value="">- Выбрать -</option>` + makeOpts(getVisibleCatalog('subjects'));
  if(classEl) classEl.innerHTML = `<option value="">- Выбрать -</option>` + makeOpts(getVisibleCatalog('classes'));
  
  if(curSubj) {
    ensureSelectOption('f_subject', curSubj);
    subjEl.value = curSubj;
  }
  if(curClass) {
    ensureSelectOption('f_class', curClass);
    classEl.value = curClass;
  }

  document.getElementById('clientsDatalist').innerHTML = getVisibleCatalog('clients').map(c=>`<option value="${escapeHtml(c)}">`).join('');
  populateOrderTemplateSelect();
}

/* ORDERS LIST WITH ARCHIVE SECTION */
