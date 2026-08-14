/* ============================================================
 * settings.js — Настройки: справочники (клиенты/предметы/классы), автобэкап
 * ============================================================ */

function renderSettings(){
  ['clients','types','units','subjects','classes'].forEach(key=>{
    const el = document.getElementById(`set-${key}`);
    if(!el) return;
    el.innerHTML = appSettings[key].map((val, idx) => `
      <div class="settings-row">
        <button class="btn-move" title="Вверх" onclick="moveSetting('${key}', ${idx}, -1)" ${idx===0?'disabled style="opacity:0.3"':''}>
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 12l-5-5-5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn-move" title="Вниз" onclick="moveSetting('${key}', ${idx}, 1)" ${idx===appSettings[key].length-1?'disabled style="opacity:0.3"':''}>
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l5 5 5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <input type="text" value="${escapeHtml(val)}" title="${escapeHtml(val)}" oninput="this.title=this.value; updateSettingSilent('${key}', ${idx}, this.value)">
        <button class="btn danger small" style="padding:6px 8px;" onclick="removeSetting('${key}', ${idx})">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
        </button>
      </div>
    `).join('');
  });

  document.getElementById('cfg_backupEnabled').value = String(backupSettings.enabled);
  document.getElementById('cfg_backupInterval').value = backupSettings.interval || 'change';
  document.getElementById('cfg_backupPath').value = backupSettings.path || '';
  document.getElementById('lastBackupTimeDisplay').textContent = backupSettings.lastBackup ? new Date(backupSettings.lastBackup).toLocaleString('ru') : 'Еще не производился';

  renderDashboardMetricsSettings();
}

function renderDashboardMetricsSettings() {
  const el = document.getElementById('dashboardMetricsList');
  if (!el) return;
  const usedTypes = appSettings.dashboardMetrics.map(m => m.type);
  el.innerHTML = appSettings.dashboardMetrics.map((m, idx) => `
    <div class="settings-row" style="gap:10px;">
      <select style="flex:1.4;" onchange="updateDashboardMetricType(${idx}, this.value)">
        ${Object.entries(DASHBOARD_METRIC_TYPES).map(([key, info]) => `
          <option value="${key}" ${m.type === key ? 'selected' : ''} ${usedTypes.includes(key) && m.type !== key ? 'disabled' : ''}>${info.label}</option>
        `).join('')}
      </select>
      <input type="number" min="0" step="any" value="${m.goal}" placeholder="Цель на день" style="flex:1;" oninput="updateDashboardMetricGoal(${idx}, this.value)">
      <button class="btn danger small" style="padding:6px 8px;" onclick="removeDashboardMetric(${idx})" ${appSettings.dashboardMetrics.length <= 1 ? 'disabled style="opacity:0.3;"' : ''}>
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
      </button>
    </div>
  `).join('');
}

function addDashboardMetric() {
  const usedTypes = appSettings.dashboardMetrics.map(m => m.type);
  const freeType = Object.keys(DASHBOARD_METRIC_TYPES).find(k => !usedTypes.includes(k)) || Object.keys(DASHBOARD_METRIC_TYPES)[0];
  appSettings.dashboardMetrics.push({ id: 'dm' + Date.now(), type: freeType, goal: 0 });
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

function updateSettingSilent(key, idx, val){ appSettings[key][idx] = val; saveData(); fillSelects(); }
function moveSetting(key, idx, dir){
  const newIdx = idx + dir;
  if(newIdx < 0 || newIdx >= appSettings[key].length) return;
  const temp = appSettings[key][idx];
  appSettings[key][idx] = appSettings[key][newIdx];
  appSettings[key][newIdx] = temp;
  saveData(); fillSelects(); renderSettings();
}
function removeSetting(key, idx){
  const val = appSettings[key][idx];
  if (!confirm(`Удалить «${val}» из справочника?`)) return;
  appSettings[key].splice(idx,1); saveData(); fillSelects(); renderSettings();
}
function addSetting(key){ appSettings[key].push('Новая запись'); saveData(); fillSelects(); renderSettings(); }

function saveBackupSettings() {
  backupSettings.enabled = document.getElementById('cfg_backupEnabled').value === 'true';
  backupSettings.interval = document.getElementById('cfg_backupInterval').value;
  backupSettings.path = document.getElementById('cfg_backupPath').value.trim();
  localStorage.setItem(BACKUP_CFG_KEY, JSON.stringify(backupSettings));
}

const BACKUP_FILE_NAME = 'crm-autobackup.json'; // одно и то же имя — файл каждый раз перезаписывается, а не плодится
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
        const fileHandle = await directoryHandle.getFileHandle(BACKUP_FILE_NAME, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
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

  if(subjEl) subjEl.innerHTML = `<option value="">- Выбрать -</option>` + makeOpts(appSettings.subjects);
  if(classEl) classEl.innerHTML = `<option value="">- Выбрать -</option>` + makeOpts(appSettings.classes);
  
  if(curSubj) {
    ensureSelectOption('f_subject', curSubj);
    subjEl.value = curSubj;
  }
  if(curClass) {
    ensureSelectOption('f_class', curClass);
    classEl.value = curClass;
  }

  document.getElementById('clientsDatalist').innerHTML = (appSettings.clients||[]).map(c=>`<option value="${escapeHtml(c)}">`).join('');
}

/* ORDERS LIST WITH ARCHIVE SECTION */
