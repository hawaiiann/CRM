/* ============================================================
 * tasks.js — Виджеты задач (To-Do): отрисовка, добавление, статус, удаление
 * ============================================================ */

let editingTaskId = null; // id задачи, которая сейчас редактируется прямо в строке (инлайн)

function renderTaskRow(t) {
  if (t.id === editingTaskId) {
    return `
    <div class="task-item task-item-editing">
      <div class="task-left" style="gap:8px;">
        <div class="task-checkbox" onclick="toggleTaskStatus('${t.id}')">${t.done ? `<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 10l4 4 8-8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}</div>
        <input type="text" class="task-edit-input" id="taskEditText-${t.id}" value="${escapeHtml(t.text)}" placeholder="Текст задачи" onkeydown="handleTaskEditKey(event, '${t.id}')">
        <input type="text" class="task-edit-time" id="taskEditTime-${t.id}" value="${escapeHtml(t.time || '')}" placeholder="Время" onkeydown="handleTaskEditKey(event, '${t.id}')">
      </div>
      <div style="display:flex; align-items:center; gap:4px;">
        <button class="task-btn-action" title="Сохранить" onclick="saveTaskEdit('${t.id}')">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 10l4 4 8-8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="task-btn-action del" title="Отменить" onclick="cancelTaskEdit()">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>`;
  }

  return `
    <div class="task-item ${t.done ? 'done' : ''}">
      <div class="task-left">
        <div class="task-checkbox" onclick="toggleTaskStatus('${t.id}')">${t.done ? `<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 10l4 4 8-8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}</div>
        <span class="task-text" title="Нажмите, чтобы отредактировать" onclick="startEditTask('${t.id}')">${escapeHtml(t.text)}</span>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        ${t.time ? `<span class="task-time" onclick="startEditTask('${t.id}')" style="cursor:pointer;">${escapeHtml(t.time)}</span>` : ''}
        <button class="task-btn-action" title="Редактировать" onclick="startEditTask('${t.id}')">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
        </button>
        <button class="task-btn-action del" title="Удалить" onclick="deleteTask('${t.id}')">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>`;
}

function startEditTask(id) {
  editingTaskId = id;
  refreshAllTaskWidgets();
  // Автофокус и курсор в конец текста, как только поле появится на экране
  setTimeout(() => {
    const input = document.getElementById(`taskEditText-${id}`);
    if (input) { input.focus(); input.selectionStart = input.selectionEnd = input.value.length; }
  }, 0);
}

function saveTaskEdit(id) {
  const t = appTasks.find(x => x.id === id);
  if (!t) return;
  const textInput = document.getElementById(`taskEditText-${id}`);
  const timeInput = document.getElementById(`taskEditTime-${id}`);
  const newText = textInput ? textInput.value.trim() : t.text;
  if (!newText) { cancelTaskEdit(); return; } // пустой текст — не сохраняем, просто выходим из режима правки
  t.text = newText;
  t.time = timeInput ? timeInput.value.trim() : t.time;
  editingTaskId = null;
  saveData();
  refreshAllTaskWidgets();
}

function cancelTaskEdit() {
  editingTaskId = null;
  refreshAllTaskWidgets();
}

function handleTaskEditKey(event, id) {
  if (event.key === 'Enter') { event.preventDefault(); saveTaskEdit(id); }
  else if (event.key === 'Escape') { event.preventDefault(); cancelTaskEdit(); }
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

  const activeHtml = activeTasks.map(t => renderTaskRow(t)).join('');

  const doneHtml = doneTasks.map(t => renderTaskRow(t)).join('');

  container.innerHTML = `
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
        <input type="text" id="inputNewTask-${containerId}" placeholder="+ Добавить задачу... (Enter)" onkeydown="handleAddTask(event, '${containerId}', '${activePeriod}')">
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
  if (e.key === 'Enter') {
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

    appTasks.push({ id: 't' + Date.now(), text: taskText, time: timeStr, done: false, period: targetPeriod || 'today' });
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
