/* ============================================================
 * app.js — Запуск, глобальное состояние, навигация между разделами, обвязка (event listeners) главных кнопок
 * ============================================================ */

// Версия приложения — см. CHANGELOG.md за подробностями. Обновляется вручную при каждом наборе правок.
const APP_VERSION = '1.16.1';

const STORAGE_KEY = 'design_crm_orders_v10';
const SETTINGS_KEY = 'design_crm_settings_v6';
const TASKS_KEY = 'design_crm_tasks_v2';
const ADVANCES_KEY = 'design_crm_advances_v1';
const PLANNING_KEY = 'design_crm_planning_v8';
const BACKUP_CFG_KEY = 'design_crm_backup_cfg';
const ACTIVITY_LOG_KEY = 'design_crm_activity_log_v1';

let orders = [];
let appTasks = [];
let advances = [];
let planningBoards = [];
let activityLog = []; // журнал правок: [{date:'YYYY-MM-DD', orderId, field:'hours'|'slides'|'pages', delta:number}]
let currentLines = [];
let currentView = 'overview';
let activeDailyMetric = 'hours';
let activeDailyPeriod = 'month'; // week, month, year
let activeFinanceTab = 'overview';
let expandedTimelineOrderId = null;
let archiveExpanded = false;
let cameFromView = null; // откуда пришли на карточку заказа (для быстрого возврата, напр. из Финансов)
let archivedPlanningExpanded = false;

// Временный массив материалов при редактировании шаблона класса
let currentBmTemplate = [];

// Состояние открытой ячейки удаляемого урока
let cellPendingDeleteKey = null;

// Активное состояние открытого урока в модальном окне
let activeLessonState = { bIdx: null, lIdx: null };

let backupSettings = {
  enabled: true,
  interval: 'change',
  path: '',
  lastBackup: null
};
let directoryHandle = null;

let dashTaskPeriod = 'today';
let tasksCol1Period = 'today';
let tasksCol2Period = 'month';
let taskDoneExpanded = {}; // { containerId: true/false } — свёрнут/развёрнут блок "Выполнено", отдельно для каждого виджета задач

const periodLabels = { today: 'Сегодня', week: 'Неделя', month: 'Месяц', year: 'Год' };

let tlMode = '2w';
let tlAnchor = new Date();

let appSettings = {
  subjects: ['Математика', 'Русский язык', 'Литература', 'Дизайн'],
  classes: ['5 класс', '6 класс', '7 класс', 'Без класса'],
  clients: ['Школа №1', 'Издательство "Просвещение"', 'Частный заказчик'],
  types: ['Презентация', 'Рабочий лист', 'Карточка'],
  units: ['Слайд', 'Страница', 'Урок', 'Час', 'Другое'],
  hiddenEntries: { clients: [], types: [], units: [], subjects: [], classes: [] },
  dashboardMetrics: [
    { id: 'dm1', type: 'hours', goal: 4 },
    { id: 'dm2', type: 'presentations', goal: 0 },
    { id: 'dm3', type: 'worksheets', goal: 0 },
    { id: 'dm4', type: 'revenue', goal: 4000 }
  ]
};

// Реестр доступных типов показателей для графика "Активность" — источник значения и подпись.
// Цвета назначаются по порядку (позиции), а не хранятся тут — задавать их вручную нельзя специально.
// cumulative: true — показывать не "сколько добавлено за период" (как часы/слайды),
// а бегущий итог "сколько таких позиций сейчас существует в системе" (по факту записи,
// не завязано на статус заказа или чекбокс "Готов" — они и так не участвуют в подсчёте).
// secondary — показатель "двойного назначения": рисуется вторым, более бледным графиком
// и вторым числом рядом с основным (напр. "6 шт. · 106 слайдов"), без своей цели/настройки.
// pairLabel — краткая форма для выпадающего списка в Справочниках ("Презентации + слайды"),
// отдельно от label ("слайдов" — родительный падеж, нужен в числовом контексте "106 слайдов").
const DASHBOARD_METRIC_TYPES = {
  hours:         { label: 'Часы',            unit: 'ч',   activityField: 'hours' },
  presentations: { label: 'Презентации',     unit: 'шт.', activityField: 'presentations', cumulative: true,
                    secondary: { label: 'слайдов', pairLabel: 'слайды', unit: 'шт.', activityField: 'slides' } },
  worksheets:    { label: 'Рабочие листы',   unit: 'шт.', activityField: 'worksheets', cumulative: true,
                    secondary: { label: 'страниц', pairLabel: 'страницы', unit: 'шт.', activityField: 'pages' } },
  revenue:       { label: 'Выручка',         unit: '₽',   activityField: 'revenue',
                    secondary: { label: 'чистыми', pairLabel: 'чистый доход', unit: '₽', activityField: 'netRevenue' } }
};
const DASHBOARD_METRIC_COLORS_LIGHT = ['#7CB518', '#F5A623', '#6C63FF', '#E4483F', '#0E9AA7'];
const DASHBOARD_METRIC_COLORS_DARK  = ['#A8E10C', '#F2B84D', '#8C84FF', '#FF6259', '#3BC9DB'];

const statusLabels = {queue:'В очереди', progress:'В работе', review:'Согласование', done:'Завершён', cancelled:'Отменён'};

/* Theme init */
function switchView(view){
  // Если уходим с "Заказов" на что-то ещё не через кнопку "Назад" — метка возврата больше не актуальна
  if (currentView === 'orders' && view !== 'orders') cameFromView = null;
  currentView = view;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+view).classList.add('active');
  document.querySelectorAll('.navitem').forEach(n=>n.dataset.view===view ? n.classList.add('active') : n.classList.remove('active'));
  renderCurrent();
}

function renderCurrent(){
  fillSelects();
  if(currentView==='overview') renderOverview();
  else if(currentView==='finance') renderFinance();
  else if(currentView==='planning') renderPlanning();
  else if(currentView==='orders') renderOrders();
  else if(currentView==='timeline') renderTimeline();
  else if(currentView==='tasks') renderTasksSection();
  else if(currentView==='settings') renderSettings();

  setTimeout(() => {
    adjustAllBadgeSelects();
    adjustAllAdaptiveInputs();
  }, 20);
}

/* TASKS WIDGET */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.overlay').forEach(ov => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov) {
        ov.classList.remove('show');
        if (ov.id === 'lessonModalOverlay') closeLessonModal();
        if (ov.id === 'boardModalOverlay') closeBoardModal();
        if (ov.id === 'depositOverlay') closeDepositModal();
        if (ov.id === 'deleteOrderOverlay') closeDeleteOrderModal();
        if (ov.id === 'overlay') closeModal();
      }
    });
  });
});

/* EXPORT / IMPORT */

/* INIT — запуск приложения. Обязательно должен быть в самом конце,
   после того как загружены все остальные js-файлы. */
loadData();
renderCurrent();
restoreBackupDirectoryHandle();

const versionEl = document.getElementById('appVersionDisplay');
if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
