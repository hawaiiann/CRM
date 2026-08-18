/* ============================================================
 * overview.js — Дашборд (Обзор): статистика и графики
 * ============================================================ */

// Графики считают ширину контейнера через getBoundingClientRect() в момент рендера —
// при повороте экрана/изменении окна пересчитываем, иначе останутся "заточены" под старую ширину.
let overviewResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(overviewResizeTimer);
  overviewResizeTimer = setTimeout(() => { if (currentView === 'overview') renderOverview(); }, 200);
});

/* ПЛАНИРОВАНИЕ НЕДЕЛИ — мини-Гант на 7 дней текущей недели, на Дашборде */
function getOrderWeekLabel(o) {
  if (o.subject && o.grade && o.lesson) {
    return [o.subject, o.grade, o.quarter, 'Урок ' + o.lesson].filter(Boolean).join(', ');
  }
  return o.title || 'Заказ';
}

let weekWidgetShowDone = false;
function toggleWeekWidgetShowDone() {
  weekWidgetShowDone = !weekWidgetShowDone;
  renderWeekPlanningWidget();
}

function renderWeekPlanningWidget() {
  const el = document.getElementById('ovWeekPlanning');
  if (!el) return;

  const today = new Date();
  const dayOfWeek = (today.getDay() + 6) % 7; // Понедельник = 0
  const monday = addDays(today, -dayOfWeek);
  const weekDays = [];
  for (let i = 0; i < 7; i++) weekDays.push(addDays(monday, i));
  const weekStartKey = dateKey(weekDays[0]);
  const weekEndKey = dateKey(weekDays[6]);
  const todayKey = dateKey(today);
  const weekdayLabels = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'];

  const headerHtml = weekDays.map((d, i) => {
    const isToday = dateKey(d) === todayKey;
    return `
      <div style="text-align:center; padding:6px 2px; border-radius:8px; ${isToday ? 'background: var(--green-soft);' : ''}">
        <div style="font-size:9.5px; font-weight:700; color:${isToday ? 'var(--green)' : 'var(--text-faint)'}; letter-spacing:0.03em;">${weekdayLabels[i]}</div>
        <div style="font-size:12px; font-weight:700; color:${isToday ? 'var(--green)' : 'var(--text-faint)'}; margin-top:1px;" class="num-font">${d.getDate()}</div>
      </div>
    `;
  }).join('');

  // Заказы, чей диапазон (начало—сдача) пересекается с этой неделей.
  // Завершённые по умолчанию скрыты — они больше не требуют внимания на этой неделе.
  const allWeekOrders = orders.filter(o => {
    if (o.status === 'cancelled') return false;
    const startStr = o.start || o.deadline;
    const endStr = o.deadline || o.start;
    if (!startStr && !endStr) return false;
    return startStr <= weekEndKey && endStr >= weekStartKey;
  }).sort((a, b) => (a.start || a.deadline || '').localeCompare(b.start || b.deadline || ''));
  const doneCount = allWeekOrders.filter(o => o.status === 'done').length;
  const weekOrders = weekWidgetShowDone ? allWeekOrders : allWeekOrders.filter(o => o.status !== 'done');

  const rowsHtml = weekOrders.map(o => {
    const startStr = o.start || o.deadline;
    const endStr = o.deadline || o.start;
    const startCol = Math.max(1, Math.min(7, dateDiffDays(weekStartKey, startStr) + 1));
    const endCol = Math.max(1, Math.min(7, dateDiffDays(weekStartKey, endStr) + 1));
    const span = Math.max(1, endCol - startCol + 1);
    const label = getOrderWeekLabel(o);
    return `
      <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:4px;">
        <div class="gantt-item-bar status-${o.status}" title="${escapeHtml(label)}" onclick="goToOrderCard('${o.id}')"
             style="grid-column:${startCol} / span ${span}; border-radius:7px; padding:6px 8px; font-size:10.5px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-height:14px; cursor:pointer;">
          ${escapeHtml(label)}
        </div>
      </div>
    `;
  }).join('');

  const weekChevronSvg = `<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l5 5 5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const doneToggleHtml = doneCount > 0 ? `
    <div style="text-align:center;">
      <div class="plan-completed-toggle ${weekWidgetShowDone ? 'expanded' : ''}" style="margin-top:8px; padding:5px 12px; font-size:11px;" onclick="toggleWeekWidgetShowDone()">
        <span>${weekWidgetShowDone ? 'Скрыть завершённые' : 'Показать завершённые'}</span>
        ${!weekWidgetShowDone ? `<span class="plan-completed-count">${doneCount}</span>` : ''}
        ${weekChevronSvg}
      </div>
    </div>
  ` : '';

  el.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:4px; margin-bottom:10px;">${headerHtml}</div>
    <div style="display:flex; flex-direction:column; gap:5px; max-height:150px; overflow-y:auto;">
      ${rowsHtml || '<div style="font-size:12.5px; color:var(--text-faint); padding:8px 0;">На этой неделе заказов нет</div>'}
    </div>
    ${doneToggleHtml}
  `;
}

function renderOverview(){
  const active = orders.filter(o=>['progress','review'].includes(o.status));
  const done = orders.filter(o=>o.status==='done');
  const now = new Date();
  
  const typeStats = {};
  getVisibleCatalog('types').forEach(t => {
    typeStats[t] = { itemsCount: 0, totalUnits: 0 };
  });

  orders.forEach(o => {
    if (o.status === 'cancelled') return;
    const refDate = parseLocalDate(o.deadline) || new Date(o.createdAt);
    if(refDate.getFullYear() === now.getFullYear() && refDate.getMonth() === now.getMonth()){
      (o.lines||[]).forEach(l => {
        const typeName = l.label || 'Прочее';
        if (!typeStats[typeName]) {
          typeStats[typeName] = { itemsCount: 0, totalUnits: 0 };
        }
        typeStats[typeName].itemsCount += 1;
        typeStats[typeName].totalUnits += parseNum(l.qty);
      });
    }
  });

  renderTasksWidget('dashTasksWidget', dashTaskPeriod, 'changeDashTaskPeriod');

  let currentMonthRev = 0, currentMonthNet = 0, prevMonthRev = 0;
  let doneThisMonth = 0, doneLastMonth = 0;
  const prevMonthRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  orders.forEach(o => {
    if (o.status === 'cancelled') return;
    if (!o.deadline) return;
    const parts = o.deadline.split('-').map(Number);
    const isThisMonth = parts[0] === now.getFullYear() && (parts[1] - 1) === now.getMonth();
    const isLastMonth = parts[0] === prevMonthRef.getFullYear() && (parts[1] - 1) === prevMonthRef.getMonth();
    if (isThisMonth) {
      const rec = orderRecognizedRevenue(o);
      currentMonthRev += rec.revenue;
      currentMonthNet += rec.net;
    }
    if (isLastMonth) {
      prevMonthRev += orderRecognizedRevenue(o).revenue;
    }
    if (o.status === 'done') {
      if (isThisMonth) doneThisMonth++;
      if (isLastMonth) doneLastMonth++;
    }
  });

  // "Ожидает оплаты" — сумма реальных остатков (стоимость − аванс − полученные деньги),
  // а не полная стоимость всех заказов без галочки "оплачено".
  const activeRev = orders.filter(o => o.status !== 'cancelled')
    .reduce((s, o) => s + orderPaymentState(o).remaining, 0);

  // Процент изменения относительно прошлого месяца — только там, где для сравнения
  // есть за что зацепиться (Выручка, Выполнено). "Активных" и "Ожидает оплаты" — моментальные
  // срезы "сколько сейчас", у них нет точки отсчёта на начало прошлого месяца — процент не считаем.
  function pctChange(cur, prev) {
    if (!prev) return null;
    return Math.round(((cur - prev) / prev) * 100);
  }
  const revPct = pctChange(currentMonthRev, prevMonthRev);
  const donePct = pctChange(doneThisMonth, doneLastMonth);

  function pctBadgeHtml(pct, dark) {
    if (pct === null) return '';
    const up = pct >= 0;
    const color = up ? '#7CB518' : '#E4483F';
    const arrow = up ? '↑' : '↓';
    return `<div style="font-size:12px; font-weight:700; color:${dark ? '#fff' : color}; margin-top:10px;">${arrow} ${Math.abs(pct)}% за месяц</div>`;
  }

  const statIcons = {
    active: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.3 4.6L11.4 8L6.3 11.4V4.6Z"/></svg>`,
    done: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.4 8.4L6.4 11.4L12.6 4.6"/></svg>`,
    revenue: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.4 12.6V3.6H8.6C10.1 3.6 11.2 4.6 11.2 6C11.2 7.4 10.1 8.4 8.6 8.4H5.4M3.8 7.2H9.6M3.8 9.4H8.6"/></svg>`,
    pending: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.6V8.2L10.6 9.9"/></svg>`
  };

  document.getElementById('ovStats').innerHTML = [
    { num: active.length, lbl: 'Активных заказов', icon: statIcons.active, featured: true, tone: '', pctHtml: '' },
    { num: done.length, lbl: 'Выполнено заказов', icon: statIcons.done, featured: false, tone: 'green', pctHtml: pctBadgeHtml(donePct, false) },
    { num: fmtMoney(currentMonthRev), lbl: 'Выручка (с налогом)', icon: statIcons.revenue, featured: false, tone: 'amber', pctHtml: pctBadgeHtml(revPct, false) },
    { num: activeRev ? fmtMoney(activeRev) : '0 ₽', lbl: 'Ожидает оплаты', icon: statIcons.pending, featured: false, tone: 'rose', pctHtml: '' }
  ].map(s => `
    <div class="card stat-card ${s.featured ? 'stat-card-featured' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <span class="lbl" style="${s.featured ? 'color:#fff;' : ''}">${s.lbl}</span>
        <div class="stat-icon-circle ${s.featured ? 'featured' : 'tone-' + s.tone}">${s.icon}</div>
      </div>
      <div class="num num-font" style="${s.featured ? 'color:#fff;' : ''}">${s.num}</div>
      ${s.pctHtml}
    </div>`).join('');

  const tilesHtml = Object.keys(typeStats).map(tName => {
    const stat = typeStats[tName];
    const lower = tName.toLowerCase();
    let unitName = 'ед.';
    if (lower.includes('презентац')) unitName = 'слайдов';
    else if (lower.includes('лист') || lower.includes('страниц')) unitName = 'страниц';
    else if (lower.includes('карточ')) unitName = 'карточек';

    return `
      <div class="prod-tile">
        <div class="prod-tile-header">
          <div class="prod-tile-icon">${getItemIcon(tName)}</div>
          <div class="prod-tile-title">${escapeHtml(tName)}</div>
        </div>
        <div class="prod-tile-value">${stat.itemsCount} шт.</div>
        <div class="prod-tile-sub">${stat.totalUnits} ${unitName} за месяц</div>
      </div>
    `;
  }).join('');

  const ovMatStatsEl = document.getElementById('ovMatStats');
  if (ovMatStatsEl) {
    ovMatStatsEl.innerHTML = `
      <div class="prod-grid-2x2">
        ${tilesHtml}
      </div>
    `;
  }

  renderWeekPlanningWidget();
  renderClassProgressWidget();

  const months = [];
  for(let i=5; i>=0; i--) months.push(new Date(now.getFullYear(), now.getMonth()-i, 1));
  const monthNames = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  
  const sums = months.map(m => {
    const mYear = m.getFullYear();
    const mMonth = m.getMonth();
    return orders.filter(o => {
      if (o.status === 'cancelled') return false;
      if(!o.deadline && !o.start) return false;
      const dStr = o.deadline || o.start;
      const parts = dStr.split('-').map(Number);
      if(parts.length < 2) return false;
      return parts[0] === mYear && (parts[1] - 1) === mMonth;
    }).reduce((s,o)=>s+orderRecognizedRevenue(o).revenue,0);
  });
  
  const maxSum = Math.max(1, ...sums);
  document.getElementById('ovRevenueChart').innerHTML = months.map((m,i)=>{
    const h = Math.max(4, Math.round((sums[i]/maxSum)*120));
    return `<div class="col ${sums[i]===0?'empty':''}">
      <div class="val num-font">${sums[i]>0?fmtMoney(sums[i]):''}</div>
      <div class="bar" style="height:${h}px"></div>
      <div class="mo">${monthNames[m.getMonth()]}</div>
    </div>`;
  }).join('');

  renderDashboardMetricsGrid();
  populateActiveDaysMonthSelect();
}

/* КАЛЕНДАРЬ "АКТИВНЫЕ ДНИ" */
function populateActiveDaysMonthSelect() {
  const sel = document.getElementById('activeDaysMonthSelect');
  if (!sel) return;
  if (sel.dataset.populated) { renderActiveDaysCalendar(sel.value); return; }

  const now = new Date();
  const monthNamesFull = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  let optionsHtml = '';
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${d.getMonth()}`;
    optionsHtml += `<option value="${val}" ${i===0?'selected':''}>${monthNamesFull[d.getMonth()]} ${d.getFullYear()}</option>`;
  }
  sel.innerHTML = optionsHtml;
  sel.dataset.populated = '1';
  renderActiveDaysCalendar(sel.value);
  adjustSelectWidth(sel);
}

function renderActiveDaysCalendar(monthValue) {
  const grid = document.getElementById('activeDaysGrid');
  if (!grid) return;
  adcOpenDayDetail = null; // сетка перерисовывается с нуля — открытая деталь всё равно исчезает
  const sel = document.getElementById('activeDaysMonthSelect');
  const val = monthValue || (sel ? sel.value : `${new Date().getFullYear()}-${new Date().getMonth()}`);
  const [yearStr, monthStr] = val.split('-');
  const year = parseInt(yearStr, 10), month = parseInt(monthStr, 10);

  const todayStr = dateKey(new Date());
  // Даты, по которым в журнале активности есть хоть одна запись — "активный" день
  const activeDatesSet = new Set(activityLog.map(e => e.date));

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  // Понедельник = 0 (европейская неделя, как в референсе)
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;

  const weekdaysHtml = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'].map(d => `<span>${d}</span>`).join('');

  let cells = [];
  for (let i = firstWeekday - 1; i >= 0; i--) {
    cells.push({ num: daysInPrevMonth - i, outside: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({ num: d, outside: false, dateStr: ds, isToday: ds === todayStr, isActive: activeDatesSet.has(ds) });
  }
  // Всегда 6 полных недель (42 ячейки) — если месяц короче, свободное место
  // заполняется днями следующего месяца, а не остаётся пустым.
  const TOTAL_CELLS = 42;
  let nextMonthDay = 1;
  while (cells.length < TOTAL_CELLS) {
    cells.push({ num: nextMonthDay, outside: true });
    nextMonthDay++;
  }

  const daysHtml = cells.map(c => {
    const cls = ['adc-day'];
    if (c.outside) cls.push('outside');
    if (c.isToday) cls.push('today');
    if (c.isActive && !c.outside && !c.isToday) cls.push('active');
    if (!c.outside && c.isActive) cls.push('clickable');
    const clickAttr = (!c.outside && c.isActive) ? `onclick="showActiveDayDetail('${c.dateStr}')"` : '';
    return `<div class="${cls.join(' ')}" ${clickAttr}>${c.num}</div>`;
  }).join('');

  // Сводка по месяцу — как и раньше, коротко: активных дней + часов. Разбивку по
  // остальным показателям смотрим по клику на конкретный день (см. showActiveDayDetail).
  const monthPrefix = `${year}-${String(month+1).padStart(2,'0')}-`;
  const activeDaysInMonth = new Set(activityLog.filter(e => e.date.startsWith(monthPrefix)).map(e => e.date)).size;
  const hoursInMonth = activityLog.filter(e => e.field === 'hours' && e.date.startsWith(monthPrefix)).reduce((s,e)=>s+e.delta, 0);

  grid.innerHTML = `
    <div class="adc-weekdays">${weekdaysHtml}</div>
    <div class="adc-days-grid">${daysHtml}</div>
    <div class="adc-summary">
      <div class="adc-summary-item">
        <span class="adc-summary-num">${activeDaysInMonth}</span>
        <span class="adc-summary-lbl">активных дней</span>
      </div>
      <div class="adc-summary-item">
        <span class="adc-summary-num">${fmtHours(hoursInMonth)}</span>
        <span class="adc-summary-lbl">за месяц</span>
      </div>
    </div>
    <div id="adcDayDetail"></div>
  `;
}

// Клик по активному дню в календаре — показывает разбивку записей активности
// именно за этот день (по факту записи в журнале, а не пересчитанные заново).
let adcOpenDayDetail = null;

function showActiveDayDetail(dateStr) {
  const detailEl = document.getElementById('adcDayDetail');
  if (!detailEl) return;

  // Повторный клик по уже открытой дате — закрывает панель, а не перерисовывает её же
  if (adcOpenDayDetail === dateStr) {
    adcOpenDayDetail = null;
    detailEl.innerHTML = '';
    return;
  }
  adcOpenDayDetail = dateStr;

  const dayEntries = activityLog.filter(e => e.date === dateStr);
  if (!dayEntries.length) { detailEl.innerHTML = ''; return; }

  const byField = {};
  dayEntries.forEach(e => { byField[e.field] = (byField[e.field] || 0) + e.delta; });

  const fieldOrder = ['hours', 'slides', 'pages', 'presentations', 'worksheets', 'revenue', 'netRevenue'];
  const fieldMeta = {
    hours: { label: 'Часы', unit: 'ч' }, slides: { label: 'Слайды', unit: 'шт.' }, pages: { label: 'Страницы', unit: 'шт.' },
    presentations: { label: 'Презентации', unit: 'шт.' }, worksheets: { label: 'Рабочие листы', unit: 'шт.' },
    revenue: { label: 'Выручка', unit: '₽' }, netRevenue: { label: 'Чистый доход', unit: '₽' }
  };
  const rowsHtml = fieldOrder.filter(f => byField[f]).map(f => {
    const valText = formatMetricValue(fieldMeta[f], byField[f]);
    return `<div style="display:flex; justify-content:space-between; font-size:12.5px; padding:4px 0;"><span style="color:var(--text-faint);">${fieldMeta[f].label}</span><b style="color:var(--text);">${valText}</b></div>`;
  }).join('');

  const [y, m, d] = dateStr.split('-').map(Number);
  const dateLabel = `${d} ${MONTH_SHORT_RU[m - 1]} ${y}`;

  detailEl.innerHTML = `
    <div style="margin-top:12px; padding:12px 14px; background:var(--subcard); border-radius:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <b style="font-size:12.5px;">${dateLabel}</b>
        <span style="font-size:11px; color:var(--text-faint); cursor:pointer;" onclick="adcOpenDayDetail=null; document.getElementById('adcDayDetail').innerHTML=''">Закрыть ✕</span>
      </div>
      ${rowsHtml || '<div style="font-size:12px; color:var(--text-faint);">Нет записей</div>'}
    </div>
  `;
}

/* ГИБКАЯ СЕТКА ПОКАЗАТЕЛЕЙ ДАШБОРДА (настраивается в Справочниках) */
let dashboardMetricsPeriod = 'day';

function switchDashboardMetricsPeriod(period) {
  dashboardMetricsPeriod = period;
  const subtitles = { day: 'Сегодня, по показателям из Справочников', week: 'На этой неделе, по показателям из Справочников', month: 'В этом месяце, по показателям из Справочников', year: 'В этом году, по показателям из Справочников' };
  const sub = document.getElementById('dashboardMetricsSubtitle');
  if (sub) sub.textContent = subtitles[period] || subtitles.day;
  renderDashboardMetricsGrid();
}

function getPeriodStart(d, period) {
  const dt = new Date(d);
  if (period === 'week') {
    const day = dt.getDay();
    const diff = (day === 0 ? -6 : 1) - day; // сдвиг до понедельника
    return addDays(dt, diff);
  }
  if (period === 'month') return new Date(dt.getFullYear(), dt.getMonth(), 1);
  if (period === 'year') return new Date(dt.getFullYear(), 0, 1);
  return dt; // day
}
function addPeriod(d, period, n) {
  const dt = new Date(d);
  if (period === 'week') return addDays(dt, n * 7);
  if (period === 'month') { dt.setMonth(dt.getMonth() + n); return dt; }
  if (period === 'year') { dt.setFullYear(dt.getFullYear() + n); return dt; }
  return addDays(dt, n); // day
}

// Возвращает массив сумм показателя по "корзинам" выбранного периода — последняя корзина текущая (сегодня/эта неделя/этот месяц/этот год)
function getMetricSeriesForPeriod(activityField, period, cumulative) {
  const counts = { day: 14, week: 10, month: 8, year: 5 };
  const N = counts[period] || 14;
  const curStart = getPeriodStart(new Date(), period);
  const buckets = [];
  // Для "накопительных" показателей (кол-во позиций, реально существующих в системе)
  // бегущий итог должен стартовать не с нуля, а с суммы всех записей ДО первой корзины.
  let runningTotal = 0;
  if (cumulative) {
    const firstBucketStart = addPeriod(curStart, period, -(N - 1));
    const beforeStr = dateKey(firstBucketStart);
    runningTotal = activityLog
      .filter(e => e.field === activityField && e.date < beforeStr)
      .reduce((s, e) => s + e.delta, 0);
  }
  for (let i = N - 1; i >= 0; i--) {
    const bStart = addPeriod(curStart, period, -i);
    const bEndInclusive = addDays(addPeriod(bStart, period, 1), -1);
    const startStr = dateKey(bStart), endStr = dateKey(bEndInclusive);
    const sum = activityLog
      .filter(e => e.field === activityField && e.date >= startStr && e.date <= endStr)
      .reduce((s, e) => s + e.delta, 0);
    if (cumulative) {
      runningTotal += sum;
      buckets.push(Math.max(0, runningTotal));
    } else {
      buckets.push(Math.max(0, sum));
    }
  }
  return buckets;
}

function formatMetricValue(info, value) {
  const v = Math.round(value * 100) / 100;
  if (info.unit === 'ч') return fmtHours(v);
  if (info.unit === '₽') return fmtMoney(v);
  return Math.round(v) + ' ' + info.unit;
}

// Доп. показатель ("двойной" график) подписывается словом, а не единицей — "106 слайдов",
// а не "106 шт. слайдов": слово само по себе уже понятная единица измерения.
function formatSecondaryValue(sec, value) {
  const v = Math.round(value * 100) / 100;
  if (sec.unit === '₽') return fmtMoney(v) + ' ' + sec.label;
  return Math.round(v) + ' ' + sec.label;
}

// Границы (даты начала/конца) тех же "корзин", что строит getMetricSeriesForPeriod —
// нужны только для подписи в тултипе при наведении на график, не для самих сумм.
function getPeriodBucketRanges(period) {
  const counts = { day: 14, week: 10, month: 8, year: 5 };
  const N = counts[period] || 14;
  const curStart = getPeriodStart(new Date(), period);
  const ranges = [];
  for (let i = N - 1; i >= 0; i--) {
    const bStart = addPeriod(curStart, period, -i);
    const bEndInclusive = addDays(addPeriod(bStart, period, 1), -1);
    ranges.push({ start: bStart, end: bEndInclusive });
  }
  return ranges;
}

const MONTH_SHORT_RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

function formatBucketLabel(range, period) {
  if (period === 'day') return `${range.start.getDate()} ${MONTH_SHORT_RU[range.start.getMonth()]}`;
  if (period === 'week') return `${range.start.getDate()}–${range.end.getDate()} ${MONTH_SHORT_RU[range.end.getMonth()]}`;
  if (period === 'year') return `${range.start.getFullYear()}`;
  return `${MONTH_SHORT_RU[range.start.getMonth()]} ${range.start.getFullYear()}`;
}

function renderDashboardMetricsGrid() {
  const grid = document.getElementById('dashboardMetricsGrid');
  if (!grid) return;
  const metrics = (appSettings.dashboardMetrics || []).filter(m => !m.hidden);
  const isDark = document.body.classList.contains('dark-theme');
  const colors = isDark ? DASHBOARD_METRIC_COLORS_DARK : DASHBOARD_METRIC_COLORS_LIGHT;
  const goalMultiplier = { day: 1, week: 7, month: 30, year: 365 }[dashboardMetricsPeriod] || 1;

  // На узких экранах графики друг рядом с другом становятся ~90px и превращаются в кашу —
  // схлопываем в один столбец (друг под другом), каждый на всю ширину контейнера.
  const isMobileLayout = window.matchMedia('(max-width: 760px)').matches;
  const colCount = isMobileLayout ? 1 : metrics.length;
  grid.style.cssText = 'display:grid; grid-template-columns:' + Array(colCount).fill('1fr').join(' ') + ';';

  // Меряем реальную ширину контейнера, чтобы viewBox графика точно совпадал с пикселями —
  // тогда не нужно искажать пропорции (что превратило бы точки в овалы, а текст растянуло).
  const gridWidth = grid.getBoundingClientRect().width || 600;
  const colGap = 40; // суммарные боковые паддинги одной колонки (20px + 20px)
  const colWidth = Math.max(80, Math.round(gridWidth / Math.max(1, colCount) - colGap));

  // Контекст по каждой колонке (точки графика, подписи корзин) — нужен после вставки
  // innerHTML, чтобы навесить обработчики наведения мышью без пере-парсинга разметки.
  const colContexts = [];

  grid.innerHTML = metrics.map((m, idx) => {
    const info = DASHBOARD_METRIC_TYPES[m.type] || DASHBOARD_METRIC_TYPES.hours;
    const color = colors[idx % colors.length];
    const series = getMetricSeriesForPeriod(info.activityField, dashboardMetricsPeriod, info.cumulative);
    const ranges = getPeriodBucketRanges(dashboardMetricsPeriod);
    const curVal = series[series.length - 1];
    const avgVal = series.reduce((s,v)=>s+v,0) / series.length;
    // Для накопительных показателей цель — это абсолютное число (напр. "10 презентаций
    // всего"), а не дневная норма, поэтому множитель периода к ней не применяется.
    const goalVal = (m.goal || 0) * (info.cumulative ? 1 : goalMultiplier);

    // Показатель "двойного назначения" — доп. серия рисуется вторым, более бледным графиком
    // (своя, независимая от основной, вертикальная шкала — иначе при разных порядках величин
    // один из графиков выглядел бы плоской линией) и вторым числом рядом с основным.
    const secSeries = info.secondary ? getMetricSeriesForPeriod(info.secondary.activityField, dashboardMetricsPeriod, info.secondary.cumulative) : null;
    const secCurVal = secSeries ? secSeries[secSeries.length - 1] : null;
    const secAvgVal = secSeries ? secSeries.reduce((s,v)=>s+v,0) / secSeries.length : null;
    const secGoalVal = info.secondary ? (m.secondaryGoal || 0) * (info.secondary.cumulative ? 1 : goalMultiplier) : null;

    // Геометрия: верхняя зона (0–24) под плашку-подсказку, график — ниже (28–74).
    // Нижний отступ (74, не 80) — чтобы обводка линии и точка на нулевой отметке не обрезались краем SVG.
    const w = colWidth, chartTop = 28, chartBottom = 74;
    const maxV = Math.max(...series, 1);
    const pts = series.map((v, i) => ({ x: (i/(series.length-1)) * w, y: chartBottom - (v/maxV) * (chartBottom-chartTop-8) }));
    let path = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i-1], cur = pts[i];
      const midX = (prev.x + cur.x) / 2;
      path += ` C ${midX} ${prev.y}, ${midX} ${cur.y}, ${cur.x} ${cur.y}`;
    }
    const areaPath = `${path} L${w} ${chartBottom} L0 ${chartBottom} Z`;
    const lastPt = pts[pts.length-1];

    let secPts = null, secPath = '';
    if (secSeries) {
      const maxSec = Math.max(...secSeries, 1);
      secPts = secSeries.map((v, i) => ({ x: (i/(secSeries.length-1)) * w, y: chartBottom - (v/maxSec) * (chartBottom-chartTop-8) }));
      secPath = `M${secPts[0].x} ${secPts[0].y}`;
      for (let i = 1; i < secPts.length; i++) {
        const prev = secPts[i-1], cur = secPts[i];
        const midX = (prev.x + cur.x) / 2;
        secPath += ` C ${midX} ${prev.y}, ${midX} ${cur.y}, ${cur.x} ${cur.y}`;
      }
    }

    const bubbleText = formatMetricValue(info, curVal);
    const bubbleW = Math.max(50, bubbleText.length * 7 + 20);
    const bubbleX = Math.min(Math.max(lastPt.x - bubbleW/2, 0), w - bubbleW);
    const gradId = 'dmGrad' + idx;

    const isFirst = idx === 0, isLast = idx === metrics.length - 1;
    // На мобильном столбцы идут друг под другом — разделитель сверху, а не слева, и без
    // "срезающего" паддинга по бокам (там и так уже вся ширина экрана).
    const padStyle = isMobileLayout
      ? (isFirst ? '' : 'padding-top:16px; margin-top:16px; border-top:1px solid var(--border);')
      : (isFirst ? 'padding-right:20px;' : isLast ? 'padding-left:20px;' : 'padding:0 20px;') + (!isFirst ? 'border-left:1px solid var(--border);' : '');

    colContexts.push({ pts, series, secSeries, secInfo: info.secondary, ranges, info, color, w, chartBottom });

    return `
      <div class="dm-col" style="${padStyle}">
        <svg width="100%" height="80" viewBox="0 0 ${w} 80" style="overflow:visible;">
          <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.26"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient></defs>
          <path d="${areaPath}" fill="url(#${gradId})"/>
          ${secPath ? `<path d="${secPath}" fill="none" stroke="var(--text-faint)" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.75"/>` : ''}
          <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
          <g class="dm-tooltip">
            <line x1="${lastPt.x}" y1="${lastPt.y}" x2="${lastPt.x}" y2="${chartBottom}" stroke="var(--border)" stroke-width="1" stroke-dasharray="2,3"/>
            <circle cx="${lastPt.x}" cy="${lastPt.y}" r="4.5" fill="${color}"/>
            <rect x="${bubbleX}" y="2" width="${bubbleW}" height="22" rx="11" fill="${color}"/>
            <text x="${bubbleX + bubbleW/2}" y="16.5" text-anchor="middle" font-size="11" fill="#17190A" font-weight="700" font-family="'Space Grotesk', sans-serif">${escapeHtml(bubbleText)}</text>
          </g>
          <g class="dm-hover" style="display:none;">
            <line class="dm-hover-line" x1="0" y1="0" x2="0" y2="${chartBottom}" stroke="var(--text-faint)" stroke-width="1" stroke-dasharray="2,3"/>
            <circle class="dm-hover-dot" cx="0" cy="0" r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="1.5"/>
            <rect class="dm-hover-bubble-rect" x="0" y="2" width="50" height="22" rx="11" fill="var(--text)"/>
            <text class="dm-hover-bubble-text" x="0" y="16.5" text-anchor="middle" font-size="11" fill="var(--surface)" font-weight="700" font-family="'Space Grotesk', sans-serif"></text>
          </g>
          <rect class="dm-hover-capture" x="0" y="0" width="${w}" height="80" fill="transparent" style="cursor:crosshair;"/>
        </svg>
        <div style="color:var(--text-faint); font-size:13px; margin-top:6px;">${escapeHtml(info.label)}</div>
        <div style="display:flex; align-items:baseline; gap:6px; margin-top:2px; flex-wrap:wrap;">
          <span class="num-font" style="color:${color}; font-size:26px; font-weight:700;">${escapeHtml(formatMetricValue(info, curVal))}</span>
          ${info.secondary ? `<span class="num-font" style="color:var(--text-faint); font-size:13px; font-weight:600;">· ${escapeHtml(formatSecondaryValue(info.secondary, secCurVal))}</span>` : ''}
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-faint); margin-top:14px;">
          <span>Цель</span>
          <span style="color:var(--text-soft); text-align:right;">${escapeHtml(formatMetricValue(info, goalVal))}${info.secondary && secGoalVal ? ` <span style="color:var(--text-faint);">· ${escapeHtml(formatSecondaryValue(info.secondary, secGoalVal))}</span>` : ''}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-faint); margin-top:4px;">
          <span>Среднее</span>
          <span style="color:var(--text-soft); text-align:right;">${escapeHtml(formatMetricValue(info, avgVal))}${info.secondary ? ` <span style="color:var(--text-faint);">· ${escapeHtml(formatSecondaryValue(info.secondary, secAvgVal))}</span>` : ''}</span>
        </div>
      </div>
    `;
  }).join('');

  const periodSelect = document.getElementById('dashboardMetricsPeriodSelect');
  if (periodSelect) { periodSelect.value = dashboardMetricsPeriod; adjustSelectWidth(periodSelect); }

  grid.querySelectorAll('.dm-col svg').forEach((svg, idx) => attachMetricChartHover(svg, colContexts[idx]));
}

// Наведение мышью на график "Активности" — двигает точку/бабл по ближайшей корзине
// под курсором вместо статичного значения последней точки (которое остаётся, пока
// мышь не над графиком). Работает одинаково для дня/недели/месяца/года — просто
// корзины и подписи разного масштаба (см. getPeriodBucketRanges).
function attachMetricChartHover(svg, ctx) {
  if (!ctx) return;
  const { pts, series, secSeries, secInfo, ranges, info, color, w, chartBottom } = ctx;
  const staticTooltip = svg.querySelector('.dm-tooltip');
  const hoverGroup = svg.querySelector('.dm-hover');
  const hoverLine = svg.querySelector('.dm-hover-line');
  const hoverDot = svg.querySelector('.dm-hover-dot');
  const hoverRect = svg.querySelector('.dm-hover-bubble-rect');
  const hoverText = svg.querySelector('.dm-hover-bubble-text');
  const capture = svg.querySelector('.dm-hover-capture');
  if (!capture) return;

  function showAt(i) {
    const p = pts[i];
    const secPart = secSeries ? ` · ${formatSecondaryValue(secInfo, secSeries[i])}` : '';
    const text = `${formatMetricValue(info, series[i])}${secPart} · ${formatBucketLabel(ranges[i], dashboardMetricsPeriod)}`;
    const bw = Math.max(60, text.length * 6.2 + 20);
    const bx = Math.min(Math.max(p.x - bw / 2, 0), w - bw);
    hoverLine.setAttribute('x1', p.x); hoverLine.setAttribute('x2', p.x); hoverLine.setAttribute('y2', chartBottom);
    hoverDot.setAttribute('cx', p.x); hoverDot.setAttribute('cy', p.y);
    hoverRect.setAttribute('x', bx); hoverRect.setAttribute('width', bw);
    hoverText.setAttribute('x', bx + bw / 2);
    hoverText.textContent = text;
    hoverGroup.style.display = '';
    staticTooltip.style.display = 'none';
  }
  function hide() {
    hoverGroup.style.display = 'none';
    staticTooltip.style.display = '';
  }

  capture.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const mx = (e.clientX - rect.left) * (w / rect.width);
    let nearest = 0, minDist = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p.x - mx); if (d < minDist) { minDist = d; nearest = i; } });
    showAt(nearest);
  });
  capture.addEventListener('mouseleave', hide);
}

let _dmResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_dmResizeTimer);
  _dmResizeTimer = setTimeout(() => {
    if (currentView === 'overview') renderDashboardMetricsGrid();
  }, 150);
});

/* FINANCE & ADVANCES SYSTEM */
