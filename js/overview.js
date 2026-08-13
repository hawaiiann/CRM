/* ============================================================
 * overview.js — Дашборд (Обзор): статистика и графики
 * ============================================================ */

function renderOverview(){
  const active = orders.filter(o=>['progress','review'].includes(o.status));
  const done = orders.filter(o=>o.status==='done');
  const now = new Date();
  
  const typeStats = {};
  (appSettings.types || []).forEach(t => {
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

  const activeRev = orders.filter(o=>!o.isPaid && o.status!=='cancelled')
    .reduce((s,o)=>s+Math.max(0, orderTotal(o)-parseNum(o.advanceUsed)),0);

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
    active: `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="3" width="12" height="14" rx="2"/><path d="M7 8h6M7 11h6M7 14h3" stroke-linecap="round"/></svg>`,
    done: `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7"/><path d="M7 10l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    revenue: `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="6" width="14" height="10" rx="2"/><path d="M3 9h14M13 13h1.5" stroke-linecap="round"/></svg>`,
    pending: `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  };

  document.getElementById('ovStats').innerHTML = [
    { num: active.length, lbl: 'Активных заказов', icon: statIcons.active, featured: true, pctHtml: '' },
    { num: done.length, lbl: 'Выполнено заказов', icon: statIcons.done, featured: false, pctHtml: pctBadgeHtml(donePct, false) },
    { num: fmtMoney(currentMonthRev), lbl: 'Выручка (с налогом)', icon: statIcons.revenue, featured: false, pctHtml: pctBadgeHtml(revPct, false) },
    { num: activeRev ? fmtMoney(activeRev) : '0 ₽', lbl: 'Ожидает оплаты', icon: statIcons.pending, featured: false, pctHtml: '' }
  ].map(s => `
    <div class="card stat-card ${s.featured ? 'stat-card-featured' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <span class="lbl" style="${s.featured ? 'color:#fff;' : ''}">${s.lbl}</span>
        <div class="stat-icon-circle ${s.featured ? 'featured' : ''}">${s.icon}</div>
      </div>
      <div class="num" style="${s.featured ? 'color:#fff;' : ''}">${s.num}</div>
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

  document.getElementById('ovMatStats').innerHTML = `
    <div class="prod-grid-2x2">
      ${tilesHtml}
    </div>
  `;

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
      <div class="val">${sums[i]>0?fmtMoney(sums[i]):''}</div>
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
    cells.push({ num: d, outside: false, isToday: ds === todayStr, isActive: activeDatesSet.has(ds) });
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
    return `<div class="${cls.join(' ')}">${c.num}</div>`;
  }).join('');

  // Сводка по месяцу — чем заполнить пустое место под сеткой, если карточка выше, чем нужно
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
function getMetricSeriesForPeriod(activityField, period) {
  const counts = { day: 14, week: 10, month: 8, year: 5 };
  const N = counts[period] || 14;
  const curStart = getPeriodStart(new Date(), period);
  const buckets = [];
  for (let i = N - 1; i >= 0; i--) {
    const bStart = addPeriod(curStart, period, -i);
    const bEndInclusive = addDays(addPeriod(bStart, period, 1), -1);
    const startStr = dateKey(bStart), endStr = dateKey(bEndInclusive);
    const sum = activityLog
      .filter(e => e.field === activityField && e.date >= startStr && e.date <= endStr)
      .reduce((s, e) => s + e.delta, 0);
    buckets.push(Math.max(0, sum));
  }
  return buckets;
}

function formatMetricValue(info, value) {
  const v = Math.round(value * 100) / 100;
  if (info.unit === 'ч') return fmtHours(v);
  if (info.unit === '₽') return fmtMoney(v);
  return Math.round(v) + ' ' + info.unit;
}

function renderDashboardMetricsGrid() {
  const grid = document.getElementById('dashboardMetricsGrid');
  if (!grid) return;
  const metrics = appSettings.dashboardMetrics || [];
  const isDark = document.body.classList.contains('dark-theme');
  const colors = isDark ? DASHBOARD_METRIC_COLORS_DARK : DASHBOARD_METRIC_COLORS_LIGHT;
  const goalMultiplier = { day: 1, week: 7, month: 30, year: 365 }[dashboardMetricsPeriod] || 1;

  grid.style.cssText = 'display:grid; grid-template-columns:' + metrics.map(()=>'1fr').join(' ') + ';';

  // Меряем реальную ширину контейнера, чтобы viewBox графика точно совпадал с пикселями —
  // тогда не нужно искажать пропорции (что превратило бы точки в овалы, а текст растянуло).
  const gridWidth = grid.getBoundingClientRect().width || 600;
  const colGap = 40; // суммарные боковые паддинги одной колонки (20px + 20px)
  const colWidth = Math.max(80, Math.round(gridWidth / Math.max(1, metrics.length) - colGap));

  grid.innerHTML = metrics.map((m, idx) => {
    const info = DASHBOARD_METRIC_TYPES[m.type] || DASHBOARD_METRIC_TYPES.hours;
    const color = colors[idx % colors.length];
    const series = getMetricSeriesForPeriod(info.activityField, dashboardMetricsPeriod);
    const curVal = series[series.length - 1];
    const avgVal = series.reduce((s,v)=>s+v,0) / series.length;
    const goalVal = (m.goal || 0) * goalMultiplier;

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
    const bubbleText = formatMetricValue(info, curVal);
    const bubbleW = Math.max(50, bubbleText.length * 7 + 20);
    const bubbleX = Math.min(Math.max(lastPt.x - bubbleW/2, 0), w - bubbleW);
    const gradId = 'dmGrad' + idx;

    const isFirst = idx === 0, isLast = idx === metrics.length - 1;
    const padStyle = (isFirst ? 'padding-right:20px;' : isLast ? 'padding-left:20px;' : 'padding:0 20px;') + (!isFirst ? 'border-left:1px solid var(--border);' : '');

    return `
      <div class="dm-col" style="${padStyle}">
        <svg width="100%" height="80" viewBox="0 0 ${w} 80">
          <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.26"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient></defs>
          <path d="${areaPath}" fill="url(#${gradId})"/>
          <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
          <g class="dm-tooltip">
            <line x1="${lastPt.x}" y1="${lastPt.y}" x2="${lastPt.x}" y2="${chartBottom}" stroke="var(--border)" stroke-width="1" stroke-dasharray="2,3"/>
            <circle cx="${lastPt.x}" cy="${lastPt.y}" r="4.5" fill="${color}"/>
            <rect x="${bubbleX}" y="2" width="${bubbleW}" height="22" rx="11" fill="${color}"/>
            <text x="${bubbleX + bubbleW/2}" y="16.5" text-anchor="middle" font-size="11" fill="#17190A" font-weight="700">${escapeHtml(bubbleText)}</text>
          </g>
        </svg>
        <div style="color:var(--text-faint); font-size:13px; margin-top:6px;">${escapeHtml(info.label)}</div>
        <div style="color:var(--text); font-size:26px; font-weight:600; margin-top:2px;">${escapeHtml(formatMetricValue(info, curVal))}</div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-faint); margin-top:14px;">
          <span>Цель</span><span style="color:var(--text-soft);">${escapeHtml(formatMetricValue(info, goalVal))}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-faint); margin-top:4px;">
          <span>Среднее</span><span style="color:var(--text-soft);">${escapeHtml(formatMetricValue(info, avgVal))}</span>
        </div>
      </div>
    `;
  }).join('');

  const periodSelect = document.getElementById('dashboardMetricsPeriodSelect');
  if (periodSelect) { periodSelect.value = dashboardMetricsPeriod; adjustSelectWidth(periodSelect); }
}

let _dmResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_dmResizeTimer);
  _dmResizeTimer = setTimeout(() => {
    if (currentView === 'overview') renderDashboardMetricsGrid();
  }, 150);
});

/* FINANCE & ADVANCES SYSTEM */
