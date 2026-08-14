/* ============================================================
 * tasks.js — Виджеты задач (To-Do): отрисовка, добавление, статус, удаление
 * ============================================================ */

let editingTaskId = null; // id задачи, которая сейчас редактируется прямо в строке (инлайн)
let editingContainerId = null; // в каком именно виджете (Дашборд/Задачи-1/Задачи-2) её сейчас редактируют —
// одна и та же задача (напр. период "Сегодня") может одновременно отрисовываться в нескольких виджетах,
// и без этого id полей ввода совпадали бы, а сохранение читало бы значение из чужого (скрытого) виджета.

// Задача из периода "Сегодня", не выполненная и добавленная в предыдущий день —
// день сменился, а она так и осталась несделанной.
function isTaskOverdue(t) {
  return !t.done && (t.period || 'today') === 'today' && t.createdAt && t.createdAt < dateKey(new Date());
}

function renderTaskRow(t, containerId) {
  if (t.id === editingTaskId && containerId === editingContainerId) {
    return `
    <div class="task-item task-item-editing">
      <div class="task-left" style="gap:8px; align-items:flex-start;">
        <div class="task-checkbox" style="margin-top:2px;" onclick="toggleTaskStatus('${t.id}')">${t.done ? `<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 10l4 4 8-8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}</div>
        <textarea class="task-edit-input" id="taskEditText-${containerId}-${t.id}" placeholder="Текст задачи (Shift+Enter — новая строка)" rows="1"
          onkeydown="handleTaskEditKey(event, '${t.id}', '${containerId}')" oninput="autoGrowTaskArea(this)">${escapeHtml(t.text)}</textarea>
        <input type="text" class="task-edit-time" id="taskEditTime-${containerId}-${t.id}" value="${escapeHtml(t.time || '')}" placeholder="Время" onkeydown="handleTaskEditKey(event, '${t.id}', '${containerId}')">
      </div>
      <div style="display:flex; align-items:center; gap:4px;">
        <button class="task-btn-action" title="Сохранить" onclick="saveTaskEdit('${t.id}', '${containerId}')">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 10l4 4 8-8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="task-btn-action del" title="Отменить" onclick="cancelTaskEdit()">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>`;
  }

  const overdue = isTaskOverdue(t);
  return `
    <div class="task-item ${t.done ? 'done' : ''} ${overdue ? 'overdue' : ''}">
      <div class="task-left">
        <div class="task-checkbox" onclick="toggleTaskStatus('${t.id}')">${t.done ? `<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 10l4 4 8-8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}</div>
        <span class="task-text" title="${overdue ? 'Просрочено — добавлено ' + fmtDeadline(t.createdAt) : 'Нажмите, чтобы отредактировать'}" onclick="startEditTask('${t.id}', '${containerId}')">${overdue ? '⏰ ' : ''}${escapeHtml(t.text)}</span>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        ${t.time ? `<span class="task-time" onclick="startEditTask('${t.id}', '${containerId}')" style="cursor:pointer;">${escapeHtml(t.time)}</span>` : ''}
        <button class="task-btn-action" title="Редактировать" onclick="startEditTask('${t.id}', '${containerId}')">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
        </button>
        <button class="task-btn-action del" title="Удалить" onclick="deleteTask('${t.id}')">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>`;
}

// Плавно растягивает textarea по высоте контента (для полей ввода/правки задачи)
function autoGrowTaskArea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function startEditTask(id, containerId) {
  editingTaskId = id;
  editingContainerId = containerId;
  refreshAllTaskWidgets();
  // Автофокус и курсор в конец текста, как только поле появится на экране
  setTimeout(() => {
    const input = document.getElementById(`taskEditText-${containerId}-${id}`);
    if (input) { input.focus(); input.selectionStart = input.selectionEnd = input.value.length; autoGrowTaskArea(input); }
  }, 0);
}

function saveTaskEdit(id, containerId) {
  const t = appTasks.find(x => x.id === id);
  if (!t) return;
  const textInput = document.getElementById(`taskEditText-${containerId}-${id}`);
  const timeInput = document.getElementById(`taskEditTime-${containerId}-${id}`);
  const newText = textInput ? textInput.value.trim() : t.text;
  if (!newText) { cancelTaskEdit(); return; } // пустой текст — не сохраняем, просто выходим из режима правки
  t.text = newText;
  t.time = timeInput ? timeInput.value.trim() : t.time;
  editingTaskId = null;
  editingContainerId = null;
  saveData();
  refreshAllTaskWidgets();
}

function cancelTaskEdit() {
  editingTaskId = null;
  editingContainerId = null;
  refreshAllTaskWidgets();
}

function handleTaskEditKey(event, id, containerId) {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); saveTaskEdit(id, containerId); }
  else if (event.key === 'Escape') { event.preventDefault(); cancelTaskEdit(); }
  // Shift+Enter в текстовом поле задачи — не перехватываем, браузер сам вставит перенос строки
}

function renderTasksWidget(containerId, activePeriod, periodChangeFnName) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const periodTasks = appTasks.filter(t => (t.period || 'today') === activePeriod);
  const activeTasks = periodTasks.filter(t => !t.done);
  const doneTasks = periodTasks.filter(t => t.done);

  const periods = ['today', 'week', 'month', 'year'];
  const tabsHtml = `
    <div class="task-tabs">
      ${periods.map(p => `
        <button class="task-tab ${p === activePeriod ? 'active' : ''}" onclick="${periodChangeFnName}('${p}')">
          ${periodLabels[p]}
        </button>
      `).join('')}
    </div>
  `;

  const activeHtml = activeTasks.map(t => renderTaskRow(t, containerId)).join('');

  const doneHtml = doneTasks.map(t => renderTaskRow(t, containerId)).join('');

  // "Горит" — только на дашбордовском виджете (не дублируем на вкладке "Задачи",
  // там это не в тему: список там строго про задачи, а не про заказы)
  let burningHtml = '';
  if (containerId === 'dashTasksWidget') {
    const burningOrders = orders.filter(isOrderOverdue).sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''));
    if (burningOrders.length) {
      burningHtml = `
        <div class="burning-orders-block">
          <div class="burning-orders-title">🔥 Горят заказы — ${burningOrders.length}</div>
          <div class="burning-orders-list">
            ${burningOrders.map(o => {
              const displayTitle = o.title || [o.subject, o.grade, o.quarter, o.lesson ? 'Урок ' + o.lesson : ''].filter(Boolean).join(', ') || 'Без названия';
              return `
                <div class="burning-order-row" onclick="goToOrderCard('${o.id}')">
                  <span class="burning-order-name" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</span>
                  <span class="burning-order-date">${fmtDeadline(o.deadline)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = `
    ${burningHtml}
    ${tabsHtml}
    <div class="tw-top-row">
      <h3>Задачи: ${periodLabels[activePeriod]}</h3>
      <span class="active-count">${activeTasks.length} активных</span>
    </div>

    <div class="tasks-list">
      ${activeHtml || `
        <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; font-size:13.5px; color:var(--text-faint);">
          <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2.6" y="1.6" width="10.8" height="12.8" rx="1.8"/><path d="M5.4 5.6H10.6M5.4 8.4H10.6M5.4 11.2H8.4"/></svg>
          Нет активных задач
        </div>
      `}
    </div>

    <div class="tasks-bottom-pinned">
      ${doneTasks.length > 0 ? `
        <div class="tasks-done-section">
          <div class="archive-header" onclick="toggleTaskDoneExpanded('${containerId}')">
            <div class="archive-title">Выполнено — ${doneTasks.length}</div>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" style="transform: rotate(${taskDoneExpanded[containerId] ? '180' : '0'}deg); transition: transform 0.2s ease;"><path d="M5 8l5 5 5-5" stroke-linecap="round"/></svg>
          </div>
          ${taskDoneExpanded[containerId] ? `<div class="tasks-done-items">${doneHtml}</div>` : ''}
        </div>
      ` : ''}

      <div class="add-task-input-row">
        <textarea id="inputNewTask-${containerId}" rows="1" placeholder="+ Добавить задачу... (Enter, Shift+Enter — новая строка)" onkeydown="handleAddTask(event, '${containerId}', '${activePeriod}')" oninput="autoGrowTaskArea(this)"></textarea>
      </div>
    </div>
  `;
}

function toggleTaskDoneExpanded(containerId) {
  taskDoneExpanded[containerId] = !taskDoneExpanded[containerId];
  refreshAllTaskWidgets();
}

function changeDashTaskPeriod(newPeriod) { dashTaskPeriod = newPeriod; renderTasksWidget('dashTasksWidget', dashTaskPeriod, 'changeDashTaskPeriod'); }
function changeCol1TaskPeriod(newPeriod) { tasksCol1Period = newPeriod; renderTasksWidget('tasksCol1Widget', tasksCol1Period, 'changeCol1TaskPeriod'); }
function changeCol2TaskPeriod(newPeriod) { tasksCol2Period = newPeriod; renderTasksWidget('tasksCol2Widget', tasksCol2Period, 'changeCol2TaskPeriod'); }

function handleAddTask(e, containerId, targetPeriod) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const input = document.getElementById(`inputNewTask-${containerId}`);
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    let timeStr = '';
    const timeMatch = val.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
    let taskText = val;
    if (timeMatch) {
      timeStr = timeMatch[0];
      taskText = val.replace(timeMatch[0], '').trim();
    } else {
      const now = new Date();
      timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    }

    appTasks.push({ id: 't' + Date.now(), text: taskText, time: timeStr, done: false, period: targetPeriod || 'today', createdAt: dateKey(new Date()) });
    saveData();
    refreshAllTaskWidgets();
  }
}

function editTask(id) {
  // Устаревшая функция — редактирование задачи теперь происходит инлайн (см. startEditTask)
  startEditTask(id);
}

function toggleTaskStatus(id) {
  const t = appTasks.find(x => x.id === id);
  if (t) { t.done = !t.done; saveData(); refreshAllTaskWidgets(); }
}

function deleteTask(id) {
  const t = appTasks.find(x => x.id === id);
  const label = t ? (t.text.length > 60 ? t.text.slice(0, 60) + '…' : t.text) : 'эту задачу';
  if (!confirm(`Удалить задачу «${label}»?`)) return;
  appTasks = appTasks.filter(x => x.id !== id);
  saveData();
  refreshAllTaskWidgets();
}

function refreshAllTaskWidgets() {
  if (document.getElementById('dashTasksWidget')) renderTasksWidget('dashTasksWidget', dashTaskPeriod, 'changeDashTaskPeriod');
  if (document.getElementById('tasksCol1Widget')) renderTasksWidget('tasksCol1Widget', tasksCol1Period, 'changeCol1TaskPeriod');
  if (document.getElementById('tasksCol2Widget')) renderTasksWidget('tasksCol2Widget', tasksCol2Period, 'changeCol2TaskPeriod');
}

function renderTasksSection() {
  renderTasksWidget('tasksCol1Widget', tasksCol1Period, 'changeCol1TaskPeriod');
  renderTasksWidget('tasksCol2Widget', tasksCol2Period, 'changeCol2TaskPeriod');
}

/* PLANNING SECTION LOGIC */
