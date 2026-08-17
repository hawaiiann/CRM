/* ============================================================
 * orders.js — Заказы: список, карточки, форма заказа, позиции, комбобоксы, таймер
 * ============================================================ */

function togglePaymentStatus(id, event) {
  if(event) event.stopPropagation();
  const o = orders.find(x => x.id === id);
  if(o) {
    const before = JSON.parse(JSON.stringify(o));
    o.isPaid = !o.isPaid;
    recordActivityChanges(before, o);
    saveData();
    renderCurrent();
  }
}

/* Навигация к карточке заказа из вкладки Финансы */
function goToOrderCard(orderId) {
  const order = orders.find(o => o.id === orderId);
  cameFromView = currentView; // запоминаем, откуда пришли — для кнопки "Назад"
  switchView('orders');
  setTimeout(() => {
    // Сбрасываем фильтр по статусу и поиск — иначе заказ может быть скрыт ими
    const filterEl = document.getElementById('filterStatus');
    const searchEl = document.getElementById('searchOrders');
    if (filterEl && filterEl.value !== 'all') filterEl.value = 'all';
    if (searchEl && searchEl.value) searchEl.value = '';
    // Если заказ в архиве (Завершён/Отменён) — разворачиваем архив, иначе карточки не будет в DOM
    if (order && (order.status === 'done' || order.status === 'cancelled')) {
      archiveExpanded = true;
    }
    renderOrders();

    setTimeout(() => {
      // Сворачиваем ВСЕ остальные карточки — открытой должна остаться только целевая
      document.querySelectorAll('.order-card-compact.expanded').forEach(el => {
        if (el.id !== 'occ-' + orderId) el.classList.remove('expanded');
      });
      // Включаем режим "в фокусе" — другие карточки больше не разворачиваются просто по наведению
      const list = document.getElementById('orderList');
      if (list) list.classList.add('focus-mode');

      const card = document.getElementById('occ-' + orderId);
      if (card) {
        if (!card.classList.contains('expanded')) {
          card.classList.add('expanded');
        }
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const origBorder = card.style.borderColor;
        const origShadow = card.style.boxShadow;
        card.style.borderColor = 'var(--accent-yellow)';
        card.style.boxShadow = '0 0 0 4px var(--accent-blue)';
        setTimeout(() => {
          card.style.borderColor = origBorder;
          card.style.boxShadow = origShadow;
        }, 2000);
      }
    }, 50);
  }, 100);
}

// Рисует (или скрывает) плашку быстрого возврата на исходную вкладку —
// появляется только когда на Заказы попали через переход из другого раздела (напр. Финансы)
function renderBackToPrevViewSlot() {
  const slot = document.getElementById('backToPrevViewSlot');
  if (!slot) return;
  if (!cameFromView || cameFromView === 'orders') { slot.innerHTML = ''; return; }
  const labels = { finance: 'Финансы', overview: 'Дашборд', timeline: 'Таймлайн', tasks: 'Задачи', planning: 'Планирование', settings: 'Справочники' };
  const label = labels[cameFromView] || cameFromView;
  slot.innerHTML = `
    <button class="btn secondary small" style="margin-bottom:12px;" onclick="returnToPrevView()">
      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Назад в «${label}»
    </button>
  `;
}

function returnToPrevView() {
  const target = cameFromView;
  cameFromView = null;
  if (target) switchView(target);
}

function toggleArchive() {
  archiveExpanded = !archiveExpanded;
  renderOrders();
}

function renderOrders(){
  renderBackToPrevViewSlot();
  const listElForFocusReset = document.getElementById('orderList');
  if (listElForFocusReset) listElForFocusReset.classList.remove('focus-mode');
  const filter = document.getElementById('filterStatus').value;
  const groupBy = document.getElementById('groupStatus').value;
  const sortBy = document.getElementById('sortBy').value;
  const searchQuery = (document.getElementById('searchOrders').value || '').toLowerCase().trim();
  
  let list = orders.slice();

  if(searchQuery) {
    list = list.filter(o => {
      const matchTitle = (o.title || '').toLowerCase().includes(searchQuery);
      const matchClient = (o.client || '').toLowerCase().includes(searchQuery);
      const matchSubject = (o.subject || '').toLowerCase().includes(searchQuery);
      const matchQuarter = (o.quarter || '').toLowerCase().includes(searchQuery);
      const matchLesson = (o.lesson || '').toLowerCase().includes(searchQuery);
      const matchNotes = (o.notes || '').toLowerCase().includes(searchQuery);
      return matchTitle || matchClient || matchSubject || matchQuarter || matchLesson || matchNotes;
    });
  }

  if(filter !== 'all') list = list.filter(o=>o.status===filter);
  
  if(sortBy==='deadline') list.sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999'));
  else if(sortBy==='deadline_desc') list.sort((a,b)=>(b.deadline||'').localeCompare(a.deadline||''));
  else if(sortBy==='created') list.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  else if(sortBy==='price_desc') list.sort((a,b)=>orderTotal(b)-orderTotal(a));
  else if(sortBy==='price_asc') list.sort((a,b)=>orderTotal(a)-orderTotal(b));
  else if(sortBy==='client') list.sort((a,b)=>(a.client||'').localeCompare(b.client||''));

  // Приоритетные заказы всегда поднимаются наверх, поверх любой выбранной сортировки
  list.sort((a,b)=>(b.priority?1:0)-(a.priority?1:0));

  const activeList = list.filter(o => o.status !== 'done' && o.status !== 'cancelled');
  const archiveList = list.filter(o => o.status === 'done' || o.status === 'cancelled');

  const el = document.getElementById('orderList');
  if(!list.length){ el.innerHTML = `<div class="card empty" style="padding:40px;text-align:center;"><b>Заказы не найдены</b></div>`; return; }

  let activeHtml = '';
  if(groupBy === 'class'){
    const groups = {};
    activeList.forEach(o=>{ const g = o.grade || 'Без класса'; if(!groups[g]) groups[g]=[]; groups[g].push(o); });
    Object.keys(groups).sort().forEach(g => {
      activeHtml += `<div class="order-group-title">${escapeHtml(g)}</div>`;
      activeHtml += groups[g].map(renderOrderCard).join('');
    });
  } else {
    activeHtml = activeList.map(renderOrderCard).join('');
  }

  let archiveHtml = '';
  if (archiveList.length > 0) {
    let archiveItemsHtml = '';
    if (groupBy === 'class') {
      const aGroups = {};
      archiveList.forEach(o=>{ const g = o.grade || 'Без класса'; if(!aGroups[g]) aGroups[g]=[]; aGroups[g].push(o); });
      Object.keys(aGroups).sort().forEach(g => {
        archiveItemsHtml += `<div class="order-group-title">${escapeHtml(g)}</div>`;
        archiveItemsHtml += aGroups[g].map(renderOrderCard).join('');
      });
    } else {
      archiveItemsHtml = archiveList.map(renderOrderCard).join('');
    }

    archiveHtml = `
      <div class="archive-section">
        <div class="archive-header" onclick="toggleArchive()">
          <div class="archive-title">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 5h12M4 9h12M4 13h12" stroke-linecap="round"/>
            </svg>
            Архив заказов (${archiveList.length})
          </div>
          <span class="btn secondary small">${archiveExpanded ? 'Свернуть ▲' : 'Развернуть ▼'}</span>
        </div>
        ${archiveExpanded ? `<div class="order-list">${archiveItemsHtml}</div>` : ''}
      </div>
    `;
  }

  el.innerHTML = (activeHtml || `<div style="font-size:13px; color:var(--text-soft); padding:12px 0;">Нет активных заказов</div>`) + archiveHtml;
  setTimeout(adjustAllBadgeSelects, 10);
}

/* ORDER CARD */
function renderOrderCard(o){
  const itemsSummary = o.lines.map(l => `${l.label} (${l.qty} ${l.type})`).join(' · ');
  const displayTitle = o.title || [o.subject, o.grade, o.quarter, o.lesson ? 'Урок ' + o.lesson : ''].filter(Boolean).join(', ') || 'Без названия';
  const statusOptions = Object.keys(statusLabels).map(k=> `<option value="${k}" ${o.status===k?'selected':''}>${statusLabels[k]}</option>`).join('');

  const fullPrice = orderTotal(o);
  const advUsed = parseNum(o.advanceUsed);
  // Заказ отмечен "Оплачено" (в т.ч. напрямую, минуя аванс) — доплаты по нему больше нет,
  // даже если списанный аванс формально меньше полной цены (та же логика, что в Финансах).
  const remToPay = o.isPaid ? 0 : Math.max(0, fullPrice - advUsed);

  const isOverdue = isOrderOverdue(o);

  let advBadgeHtml = '';
  if (advUsed > 0) advBadgeHtml = `<span class="badge review">Аванс: ${fmtMoney(advUsed)} · Доплата: ${fmtMoney(remToPay)}</span>`;

  const linesStackHtml = (o.lines || []).map(l => {
    const isIgnored = l.ignorePrice;
    const itemTotal = calculateLineTotal(l);
    return `
      <div class="item-subcard ${isIgnored ? 'item-subcard-no-pay' : ''}">
        <div class="item-subcard-main">
          <div class="item-subcard-icon">${getItemIcon(l.label || l.type)}</div>
          <div>
            <div class="item-subcard-name" title="${escapeHtml(l.label)}">${escapeHtml(l.label)} ${isIgnored ? '(Без опл.)' : ''}</div>
            <div class="item-subcard-type">${l.qty} ${l.type} × ${fmtMoney(l.rate)}</div>
          </div>
        </div>
        <div class="item-subcard-price">${isIgnored ? '0 ₽' : fmtMoney(itemTotal)}</div>
      </div>
    `;
  }).join('');

  return `
  <div class="order-card-compact ${o.priority ? 'is-priority' : ''}" id="occ-${o.id}">
    <div class="occ-main" onclick="toggleOrderCard('${o.id}')">
      <div class="occ-info">
        <div class="occ-title-row">
          <button class="btn-start-badge" data-order-timer-btn="${o.id}" onclick="event.stopPropagation(); startSidebarTimer('${o.id}', '${escapeHtml(displayTitle)}')">
            <span class="timer-btn-icon">${(activeTimer.id===o.id && activeTimer.running) ? spcPauseIconTiny : spcPlayIconTiny}</span><span class="timer-btn-label">${(activeTimer.id===o.id && activeTimer.running) ? 'Пауза' : 'Старт'}</span>
          </button>
          <span class="occ-title">${escapeHtml(displayTitle)}</span>
          ${o.priority ? `<span class="badge" style="background:var(--rose-soft); color:var(--rose);">🔥 Приоритет</span>` : ''}
          <select class="badge ${o.status}" onclick="event.stopPropagation()" onchange="quickChangeStatus('${o.id}', this.value); adjustSelectWidth(this);">
            ${statusOptions}
          </select>
          ${o.isPaid ? `<span class="paid-badge" onclick="togglePaymentStatus('${o.id}', event)">Оплачено</span>` : `<span class="unpaid-badge" onclick="togglePaymentStatus('${o.id}', event)">Не оплачено</span>`}
          ${isOverdue ? `<span class="badge" style="background:var(--rose-soft); color:var(--rose);">⏰ Просрочен</span>` : ''}
          ${advBadgeHtml}
        </div>
        <div class="occ-items-summary">${o.client ? `<span style="cursor:pointer; text-decoration:underline dotted;" onclick="event.stopPropagation(); openClientCard('${escapeHtml(o.client)}')">${escapeHtml(o.client)}</span> — ` : ''}${escapeHtml(itemsSummary)}</div>
      </div>
      <div class="occ-right">
        <div>
          <div class="occ-price">${fmtMoney(fullPrice)}</div>
          <div class="occ-deadline-badge ${isOverdue ? 'overdue' : ''}">сдача: <b>${fmtDeadline(o.deadline)}</b></div>
        </div>
        <span class="occ-expand-icon">▼</span>
      </div>
    </div>
    
    <div class="occ-details-wrapper">
      <div class="occ-details-inner">
        <div class="occ-details">
          <div class="details-grid">
            <div class="details-left-col">
              <div class="items-stack-container">
                <span class="items-stack-label">Позиции в заказе:</span>
                <div class="items-stack">
                  ${linesStackHtml}
                </div>
              </div>
              <button type="button" class="details-add-item-btn" onclick="event.stopPropagation();editOrder('${o.id}')">+ Добавить позицию</button>

              <div>
                <div class="details-box-label" style="margin-bottom:6px;">Заметка к заказу</div>
                <div class="details-notes-box" onclick="event.stopPropagation();editOrder('${o.id}')">${o.notes ? escapeHtml(o.notes) : 'Идеи, правки, ссылки на материалы...'}</div>
              </div>
            </div>

            <div class="details-meta-box">
              <div>
                <div class="details-box-label">Клиент</div>
                <div class="details-client-name">${o.client ? `<span style="cursor:pointer; text-decoration:underline dotted;" onclick="event.stopPropagation(); openClientCard('${escapeHtml(o.client)}')">${escapeHtml(o.client)}</span>` : '—'}</div>
                <div class="details-client-sub">${[o.subject, o.grade, o.quarter, o.lesson ? 'Урок ' + o.lesson : ''].filter(Boolean).map(escapeHtml).join(' · ') || '—'}</div>
              </div>

              <div class="details-mini-grid">
                <div class="details-mini-card">
                  <div class="details-box-label">Сроки работы</div>
                  <div class="details-mini-value">${fmtDateRangeCompact(o.start, o.deadline)}</div>
                </div>
                <div class="details-mini-card">
                  <div class="details-box-label">Часы (план / факт)</div>
                  <div class="details-mini-value">${fmtHours(o.estimatedHours)} / ${fmtHours(getOrderDisplayHours(o))}</div>
                </div>
              </div>

              <div class="details-sum-card">
                <div class="details-sum-top">
                  <div class="details-box-label">Сумма позиций</div>
                  <div class="details-tax-label">${orderTaxLabel(o)}</div>
                </div>
                <div class="details-sum-value num-font">${fmtMoney(fullPrice)}</div>
                <div class="details-sum-footer">
                  <span>Из аванса <b>${fmtMoney(advUsed)}</b></span>
                  <span>К доплате <b class="amber">${fmtMoney(remToPay)}</b></span>
                </div>
              </div>

              <div style="display:flex; gap:8px;">
                <button type="button" class="details-edit-btn" style="flex:1;" onclick="event.stopPropagation();editOrder('${o.id}')">Редактировать заказ</button>
                <button type="button" class="details-edit-btn" style="flex:0 0 44px; padding:0;" title="Дублировать заказ (следующий урок)" onclick="event.stopPropagation();duplicateOrder('${o.id}')">
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" style="vertical-align:middle;"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><path d="M13.5 6.5V4.5A1.5 1.5 0 0012 3H4.5A1.5 1.5 0 003 4.5V12a1.5 1.5 0 001.5 1.5h2"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function toggleOrderCard(id){
  document.getElementById('occ-'+id).classList.toggle('expanded');
  // Ручной клик по любой карточке — выходим из режима "в фокусе одного заказа"
  const list = document.getElementById('orderList');
  if (list) list.classList.remove('focus-mode');
}
function quickChangeStatus(id, newStatus){
  const o = orders.find(x=>x.id===id);
  if(o){ o.status = newStatus; syncPlanningWithOrders(); saveData(); renderCurrent(); }
}

/* SIDEBAR POMODORO CONTROLLER */
const SPC_RING_CIRCUMFERENCE = 263.89; // 2 * PI * 42 (радиус кольца в SVG)
const SPC_CYCLE_DURATION = 3600; // за сколько секунд кольцо делает один полный круг (1 час)
let activeTimer = { id: 'standalone', title: 'Свободный замер', start: 0, elapsed: 0, segmentStart: 0, interval: null, running: false, nextMilestoneMs: 0 };

// Шаг всплывающих уведомлений о вехах таймера — каждые 30 минут в работе.
const TIMER_MILESTONE_STEP_MS = 30 * 60 * 1000;

const spcPlayIcon = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M5.45 4.6L10.55 8L5.45 11.4V4.6Z"/></svg>`;
const spcPauseIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="1"/></svg>`;
const spcPlayIconTiny = `<svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><path d="M5 4l12 6-12 6V4z"/></svg>`;
const spcPauseIconTiny = `<svg width="9" height="9" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="3" width="4" height="14" rx="1"/><rect x="12" y="3" width="4" height="14" rx="1"/></svg>`;

// Обновляет вид всех кнопок "Старт" на карточках заказов (список + таймлайн),
// показывая "Пауза", если таймер сейчас идёт именно по этому заказу.
function refreshTimerButtons() {
  document.querySelectorAll('[data-order-timer-btn]').forEach(btn => {
    const oid = btn.getAttribute('data-order-timer-btn');
    const isActive = activeTimer.id === oid && activeTimer.running;
    const icon = btn.querySelector('.timer-btn-icon');
    const label = btn.querySelector('.timer-btn-label');
    if (icon) icon.innerHTML = isActive ? spcPauseIconTiny : spcPlayIconTiny;
    if (label) label.textContent = isActive ? 'Пауза' : 'Старт';
  });
}

function spcFormatTime(totalSeconds) {
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return h > 0
    ? `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`
    : `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

function updateSidebarTimerUI() {
  if (activeTimer.running) {
    activeTimer.elapsed = Date.now() - activeTimer.start;
  }
  // Секундомер считает СНАЧАЛА (с нуля вверх), без ограничения по времени.
  const elapsedSec = Math.floor(activeTimer.elapsed / 1000);

  // Раз в минуту подстраховочно списываем накопленное время в часы активной позиции —
  // без этого всё время, накопленное с последнего "Готов"/"Завершить", жило только в
  // памяти вкладки и терялось бесследно при перезагрузке/случайном закрытии страницы,
  // пока заказ ещё "не завершён".
  if (activeTimer.running && activeTimer.id !== 'standalone' && elapsedSec > 0 && elapsedSec % 60 === 0) {
    flushTimerSegment(activeTimer.id);
    saveData();
  }

  // Вехи "отработали N минут/часов" — проверяем через while (не if), чтобы не потерять
  // веху, если вкладка была свёрнута/в фоне и таймер интервалов пропустил несколько тиков разом.
  while (activeTimer.running && activeTimer.id !== 'standalone' && activeTimer.elapsed >= activeTimer.nextMilestoneMs) {
    notifyTimerMilestone(activeTimer.nextMilestoneMs);
    activeTimer.nextMilestoneMs += TIMER_MILESTONE_STEP_MS;
  }

  const disp = document.getElementById('spcDisplay');
  if (disp) disp.textContent = spcFormatTime(elapsedSec);

  // Кольцо показывает прогресс внутри ТЕКУЩЕГО часа и зацикливается —
  // прошёл час, кольцо снова начинает заполняться с нуля.
  const progress = (elapsedSec % SPC_CYCLE_DURATION) / SPC_CYCLE_DURATION;
  const ring = document.getElementById('spcRingProgress');
  if (ring) ring.style.strokeDashoffset = SPC_RING_CIRCUMFERENCE * (1 - progress);

  persistTimerState();
}

// Виджет таймера живёт только в памяти вкладки (activeTimer) — без этого пауза или
// незавершённая сессия молча "слетали" на 00:00 при перезагрузке страницы.
function persistTimerState() {
  localStorage.setItem(TIMER_STATE_KEY, JSON.stringify({
    id: activeTimer.id, title: activeTimer.title, elapsed: activeTimer.elapsed,
    segmentStart: activeTimer.segmentStart, nextMilestoneMs: activeTimer.nextMilestoneMs
  }));
}

// Восстанавливает виджет после перезагрузки — ВСЕГДА на паузе, даже если при сохранении
// он тикал: если вкладка была закрыта неизвестно на сколько (например, на ночь), автоматически
// продолжать отсчёт было бы опасно — молча накрутило бы лишние часы. Пользователь сам жмёт "Старт".
function restoreTimerState() {
  const raw = localStorage.getItem(TIMER_STATE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (!saved || !saved.id || !saved.elapsed) return;
    activeTimer.id = saved.id;
    activeTimer.title = saved.title || 'Свободный замер';
    activeTimer.elapsed = saved.elapsed;
    activeTimer.segmentStart = saved.segmentStart || 0;
    activeTimer.nextMilestoneMs = saved.nextMilestoneMs || TIMER_MILESTONE_STEP_MS;
    activeTimer.running = false;

    const elapsedSec = Math.floor(activeTimer.elapsed / 1000);
    const disp = document.getElementById('spcDisplay');
    if (disp) disp.textContent = spcFormatTime(elapsedSec);
    const nameEl = document.getElementById('spcTaskName');
    if (nameEl) nameEl.textContent = activeTimer.title;
    const progress = (elapsedSec % SPC_CYCLE_DURATION) / SPC_CYCLE_DURATION;
    const ring = document.getElementById('spcRingProgress');
    if (ring) ring.style.strokeDashoffset = SPC_RING_CIRCUMFERENCE * (1 - progress);
    refreshTimerButtons();
  } catch(e) { console.error('Не удалось восстановить состояние таймера:', e); }
}

function toggleSidebarTimer() {
  const icon = document.getElementById('spcRingIcon');
  if (activeTimer.running) {
    activeTimer.running = false;
    clearInterval(activeTimer.interval);
    if(icon) icon.innerHTML = spcPlayIcon;
    // Пауза раньше не списывала время — до минуты могло потеряться, если пользователь
    // после паузы просто закрывал вкладку, ничего явно не завершив.
    if (activeTimer.id !== 'standalone') {
      flushTimerSegment(activeTimer.id);
      saveData();
    }
    persistTimerState();
  } else {
    if (activeTimer.id !== 'standalone') requestTimerNotificationPermission();
    activeTimer.start = Date.now() - activeTimer.elapsed;
    activeTimer.running = true;
    activeTimer.interval = setInterval(updateSidebarTimerUI, 1000);
    if(icon) icon.innerHTML = spcPauseIcon;
    updateSidebarTimerUI();
  }
  refreshTimerButtons();
}

function resetSidebarTimer() {
  activeTimer.running = false;
  clearInterval(activeTimer.interval);
  activeTimer.elapsed = 0;
  activeTimer.segmentStart = 0;
  activeTimer.id = 'standalone';
  activeTimer.title = 'Свободный замер';
  activeTimer.nextMilestoneMs = TIMER_MILESTONE_STEP_MS;
  dismissAllTimerToasts();
  localStorage.removeItem(TIMER_STATE_KEY);
  const disp = document.getElementById('spcDisplay');
  if(disp) disp.textContent = spcFormatTime(0);
  const ring = document.getElementById('spcRingProgress');
  if(ring) ring.style.strokeDashoffset = SPC_RING_CIRCUMFERENCE;
  const icon = document.getElementById('spcRingIcon');
  if(icon) icon.innerHTML = spcPlayIcon;
  const nameEl = document.getElementById('spcTaskName');
  if(nameEl) nameEl.textContent = 'Свободный замер';
  refreshTimerButtons();
}

/* ВЕХИ ТАЙМЕРА ("отработали 30 минут") — тост в углу экрана, пока вкладка активна,
 * системное уведомление ОС — если вкладка свёрнута/не в фокусе. */

function requestTimerNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') Notification.requestPermission();
}

function notifyTimerMilestone(ms) {
  const label = fmtMilestoneDuration(ms);
  const title = activeTimer.title;
  const orderId = activeTimer.id;
  const isBackground = document.hidden || !document.hasFocus();
  if (isBackground) {
    sendSystemTimerNotification(label, title, orderId);
  } else {
    showTimerToast(label, title, orderId);
  }
}

function sendSystemTimerNotification(label, title, orderId) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = new Notification('Таймер CRM', { body: `Отработано ${label} — «${title}»` });
  n.onclick = () => {
    window.focus();
    n.close();
    if (orderId && orderId !== 'standalone') goToOrderCard(orderId);
  };
}

function showTimerToast(label, title, orderId) {
  const root = document.getElementById('timerToastRoot');
  if (!root) return;
  const toast = document.createElement('div');
  toast.className = 'timer-toast';
  toast.innerHTML = `
    <div class="timer-toast-icon"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8.2L10.6 9.9"/></svg></div>
    <div class="timer-toast-body">
      <div class="timer-toast-title">Отработано ${label}</div>
      <div class="timer-toast-sub">${escapeHtml(title)}</div>
    </div>`;
  toast.addEventListener('click', () => {
    dismissTimerToast(toast);
    if (orderId && orderId !== 'standalone') goToOrderCard(orderId);
  });
  root.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => dismissTimerToast(toast), 7000);
}

function dismissTimerToast(toast) {
  if (!toast || !toast.parentNode || toast.classList.contains('hide')) return;
  toast.classList.remove('show');
  toast.classList.add('hide');
  setTimeout(() => toast.remove(), 300);
}

function dismissAllTimerToasts() {
  const root = document.getElementById('timerToastRoot');
  if (root) root.innerHTML = '';
}

// Позиция, в которую сейчас "капает" время таймера — первая ещё не отмеченная "Готов".
// Если все позиции уже готовы, лишнее время уходит в последнюю (деть его больше некуда).
function getActiveLineForTimer(order) {
  if (!order || !order.lines || !order.lines.length) return null;
  return order.lines.find(l => !l.ready) || order.lines[order.lines.length - 1];
}

// Списывает время, прошедшее с прошлого "разреза", в часы текущей активной позиции заказа.
// Двигает точку отсчёта вперёд, чтобы то же время не засчиталось дважды.
function flushTimerSegment(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  const nowElapsed = activeTimer.running ? (Date.now() - activeTimer.start) : activeTimer.elapsed;
  const segmentMs = nowElapsed - (activeTimer.segmentStart || 0);
  activeTimer.segmentStart = nowElapsed;
  if (segmentMs <= 0) return;

  const line = getActiveLineForTimer(order);
  if (!line) return;
  const before = JSON.parse(JSON.stringify(order));
  // Точность храним высокую (4 знака — чистим только "хвосты" float, не сами часы) —
  // раньше округление до 2 знаков применялось на КАЖДОМ списании, а не к итогу, и при
  // частых списаниях (в т.ч. новом периодическом автосписании раз в минуту) устойчиво
  // завышало сумму: 60 секунд = 0.01667ч, округлённые до 0.02ч на каждом шаге.
  const addHours = segmentMs / 1000 / 3600;
  line.pomoHours = String(Math.round((parseHours(line.pomoHours) + addHours) * 10000) / 10000);
  recordActivityChanges(before, order);
}

// "Завершить" — единственное место, где таймер по-настоящему останавливается.
// Если он шёл по конкретному заказу — дописывает оставшееся время в часы текущей позиции.
function stopSidebarTimer() {
  if (activeTimer.id !== 'standalone') {
    const orderId = activeTimer.id;
    flushTimerSegment(orderId);
    saveData();
    if (document.getElementById('orderId').value === orderId) {
      const order = orders.find(o => o.id === orderId);
      if (order) { currentLines = JSON.parse(JSON.stringify(order.lines)); renderLines(); }
    }
    resetSidebarTimer();
    renderCurrent();
    return;
  }
  resetSidebarTimer();
}

function startSidebarTimer(orderId, title) {
  // Если таймер уже идёт именно по этому заказу — просто ставим на паузу/продолжаем,
  // а не перезапускаем с нуля.
  if (activeTimer.id === orderId) {
    toggleSidebarTimer();
    return;
  }
  // Переключение на другой заказ, пока таймер уже шёл (по прошлому заказу или
  // "Свободному замеру") — сначала списываем накопленное время в текущую активную
  // позицию ПРЕЖНЕГО заказа, иначе resetSidebarTimer() ниже стёр бы его молча, без следа.
  if (activeTimer.id !== 'standalone') {
    flushTimerSegment(activeTimer.id);
    saveData();
  }
  resetSidebarTimer();
  activeTimer.id = orderId;
  activeTimer.title = title;
  activeTimer.segmentStart = 0;
  const nameEl = document.getElementById('spcTaskName');
  if(nameEl) nameEl.textContent = title;
  toggleSidebarTimer();
}

// Чекбокс "Готов" у позиции заказа. Если по этому заказу сейчас идёт таймер и отмечаемая
// позиция была текущей активной — сначала списываем ей набежавшее время, потом ставим "Готов",
// и таймер дальше сам "потечёт" в следующую незавершённую позицию.
function toggleLineReady(lineId) {
  const orderId = document.getElementById('orderId').value;
  const draftLine = currentLines.find(l => l.id === lineId);
  if (!draftLine) return;
  const makingReady = !draftLine.ready;

  if (orderId) {
    const order = orders.find(o => o.id === orderId);
    if (order) {
      if (makingReady && activeTimer.id === orderId) {
        const activeLine = getActiveLineForTimer(order);
        if (activeLine && activeLine.id === lineId) {
          flushTimerSegment(orderId);
        }
      }
      const orderLine = order.lines.find(l => l.id === lineId);
      if (orderLine) orderLine.ready = makingReady;
      saveData();
      // Переносим в черновик формы только то, что реально могло измениться от флаша
      // (pomoHours активной позиции) и сам ready — НЕ весь массив целиком, чтобы не
      // затереть несохранённые правки количества/ставки/новых строк, которые ещё не
      // ушли в orders через "Сохранить".
      draftLine.ready = makingReady;
      order.lines.forEach(ol => {
        const dl = currentLines.find(l => l.id === ol.id);
        if (dl) dl.pomoHours = ol.pomoHours;
      });
      renderLines();
      return;
    }
  }

  // Заказ ещё не сохранён (создаётся впервые) — просто переключаем в черновике
  draftLine.ready = makingReady;
  renderLines();
}

/* TIMELINE */
function closeAllCombos(exceptWrap){
  document.querySelectorAll('.combo-list.open').forEach(l=>{
    if(exceptWrap && l.closest('.combo-wrap') === exceptWrap) return;
    l.classList.remove('open');
  });
}
function toggleCombo(btn, event){
  if(event) event.stopPropagation();
  const wrap = btn.closest('.combo-wrap');
  const list = wrap.querySelector('.combo-list');
  const wasOpen = list.classList.contains('open');
  closeAllCombos();
  if(!wasOpen){
    openComboList(wrap.querySelector('input'));
  }
}

// Показывает ВСЕ варианты списка, не фильтруя по уже выбранному значению —
// иначе при открытии список схлопывался бы до одного пункта, совпадающего с текущим текстом поля.
function openComboList(inputEl){
  const wrap = inputEl.closest('.combo-wrap');
  const list = wrap.querySelector('.combo-list');
  const options = list.querySelectorAll('.combo-option');
  options.forEach(opt => { opt.style.display = ''; });
  const emptyEl = list.querySelector('.combo-empty');
  if(emptyEl) emptyEl.style.display = options.length ? 'none' : '';
  if (!suppressComboAutoOpen) list.classList.add('open');
}

function filterCombo(inputEl){
  const wrap = inputEl.closest('.combo-wrap');
  const list = wrap.querySelector('.combo-list');
  const q = inputEl.value.trim().toLowerCase();
  let anyVisible = false;
  list.querySelectorAll('.combo-option').forEach(opt=>{
    const match = !q || opt.textContent.toLowerCase().includes(q);
    opt.style.display = match ? '' : 'none';
    if(match) anyVisible = true;
  });
  const emptyEl = list.querySelector('.combo-empty');
  if(emptyEl) emptyEl.style.display = anyVisible ? 'none' : '';
  if (!suppressComboAutoOpen) list.classList.add('open');
}

let suppressComboAutoOpen = false; // предотвращает повторное открытие списка сразу после выбора значения

function pickComboValue(inputId, value){
  const el = document.getElementById(inputId);
  if(!el) return;
  suppressComboAutoOpen = true;
  el.value = value;
  el.dispatchEvent(new Event('input', {bubbles:true}));
  closeAllCombos();
  el.focus();
  setTimeout(() => { suppressComboAutoOpen = false; }, 0);
}

document.addEventListener('click', function(e){
  const wrap = e.target.closest ? e.target.closest('.combo-wrap') : null;
  closeAllCombos(wrap);
});

/* MODAL LINES */
function renderComboField(inputId, value, placeholder, options, onInputExtra){
  const opts = options && options.length
    ? options.map(o => `<div class="combo-option" data-target="${inputId}" data-value="${escapeHtml(o)}" onclick="pickComboValue(this.dataset.target, this.dataset.value)">${escapeHtml(o)}</div>`).join('')
    : '';
  return `
    <div class="combo-wrap">
      <input type="text" id="${inputId}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"
        oninput="${onInputExtra} filterCombo(this);" onfocus="openComboList(this)">
      <button type="button" class="combo-toggle" onclick="toggleCombo(this, event)" tabindex="-1">
        <svg width="10" height="10" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="combo-list">
        ${opts}
        <div class="combo-empty" style="display:${opts?'none':''}">${(options&&options.length) ? 'Ничего не найдено' : 'Справочник пуст'}</div>
      </div>
    </div>
  `;
}

// Каждое поле обёрнуто в .line-field-wrap с подписью .line-field-label — на десктопе
// обёртка "прозрачна" (display:contents), сетка/колонки как были; на мобильном экране
// (см. @media в styles.css) превращается в карточку-строку с явными подписями полей.
function renderLines(){
  document.getElementById('linesBody').innerHTML = currentLines.map(l=>`
    <div class="line-row" data-id="${l.id}">
      <div class="line-field-wrap lf-type">
        <label class="line-field-label">Тип</label>
        ${renderComboField(`lineLabel-${l.id}`, l.label, 'Тип...', catalogWithCurrent('types', l.label), `updateLineDirect('${l.id}','label',this.value);`)}
      </div>

      <div class="line-field-wrap lf-unit">
        <label class="line-field-label">Ед. изм.</label>
        ${renderComboField(`lineUnit-${l.id}`, l.type, 'Ед. изм...', catalogWithCurrent('units', l.type), `updateLineDirect('${l.id}','type',this.value); updateLinesCalcUI('${l.id}');`)}
      </div>

      <div class="line-field-wrap lf-qty">
        <label class="line-field-label">Кол-во</label>
        <input type="text" inputmode="decimal" value="${l.qty}" placeholder="1" oninput="updateLineDirect('${l.id}','qty',this.value); updateLinesCalcUI('${l.id}');">
      </div>

      <div class="line-field-wrap lf-hours">
        <label class="line-field-label">Часы</label>
        <input type="text" inputmode="text" value="${l.pomoHours}" placeholder="0 ч, или 1:30" oninput="updateLineDirect('${l.id}','pomoHours',this.value); updateLinesCalcUI('${l.id}');" onchange="normalizeLineHours('${l.id}');">
      </div>

      <div class="line-field-wrap lf-rate">
        <label class="line-field-label">Ставка</label>
        <input type="text" inputmode="decimal" value="${l.rate}" placeholder="0 ₽" oninput="updateLineDirect('${l.id}','rate',this.value); updateLinesCalcUI('${l.id}');">
      </div>

      <div class="line-field-wrap lf-sum">
        <label class="line-field-label">Сумма</label>
        <div class="line-calc-val" id="calcVal-${l.id}">${l.ignorePrice ? '0 ₽' : fmtMoney(calculateLineTotal(l))}</div>
      </div>

      <div class="line-field-wrap lf-ready">
        <input type="checkbox" ${l.ready ? 'checked' : ''} onchange="toggleLineReady('${l.id}');" title="Готово — таймер переключится на следующую позицию">
        <label class="line-field-label">Готово</label>
      </div>

      <div class="line-field-wrap lf-remove">
        <button type="button" class="line-rm" onclick="removeLine('${l.id}')">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
        </button>
        <label class="line-field-label">Удалить</label>
      </div>
    </div>`).join('');

  updateLinesTotalSum();
}

function updateLineDirect(id, field, val){
  const l = currentLines.find(x=>x.id===id);
  if(l){ l[field] = val; }
}

// Когда пользователь закончил ввод часов (ушёл из поля) — приводим "1:30" / "1ч 30м" к десятичному виду "1.5"
function normalizeLineHours(id){
  const l = currentLines.find(x=>x.id===id);
  if(!l) return;
  const parsed = parseHours(l.pomoHours);
  l.pomoHours = parsed ? String(Math.round(parsed*100)/100) : '';
  const input = document.querySelector(`#linesBody [data-id="${id}"] input[placeholder^="0 ч"]`);
  if (input) input.value = l.pomoHours;
  updateLinesCalcUI(id);
}

function updateLinesCalcUI(id) {
  const l = currentLines.find(x=>x.id===id);
  if(l) {
    const calcEl = document.getElementById(`calcVal-${id}`);
    if(calcEl) calcEl.textContent = l.ignorePrice ? '0 ₽' : fmtMoney(calculateLineTotal(l));
    updateLinesTotalSum();
    warnIfAdvanceExceedsOrder();
  }
}

function updateLinesTotalSum() {
  const total = currentLines.reduce((s,l)=> s + calculateLineTotal(l), 0);
  document.getElementById('linesTotal').textContent = fmtMoney(total);
  const taxSel = document.getElementById('f_taxType');
  const rate = taxSel ? (taxSel.value==='individual' ? 0.04 : (taxSel.value==='entity' ? 0.06 : 0)) : 0;
  const totalWithTax = total * (1+rate);
  const totalWithTaxEl = document.getElementById('linesTotalWithTax');
  if(totalWithTaxEl) totalWithTaxEl.textContent = fmtMoney(totalWithTax);
  calculateModalAdvanceDiff();
}

function addLine(){
  currentLines.push({id:'l'+Date.now(), label: getVisibleCatalog('types')[0] || 'Презентация', type: getVisibleCatalog('units')[0] || 'Слайд', qty:1, pomoHours:0, rate:0, ignorePrice:false, ready:false});
  renderLines();
}
function removeLine(id){ currentLines = currentLines.filter(l=>l.id!==id); renderLines(); }
document.getElementById('btnAddLine').addEventListener('click', addLine);

/* MODAL STATE ORDER FORM */
const overlay = document.getElementById('overlay');
const form = document.getElementById('orderForm');

// Красит сам select "Статус" в форме заказа в цвет статуса — тем же набором цветов, что и бейдж в списке заказов
function syncModalStatusColor(){
  const sel = document.getElementById('f_status');
  sel.className = 'status-' + sel.value;
}
// Приоритетный заказ — блок аванса в форме тоже уходит в красный монохром (см. .modal.priority-theme в styles.css)
function syncModalPriorityTheme(){
  document.querySelector('.modal').classList.toggle('priority-theme', document.getElementById('f_priority').checked);
}

function openModal(edit){
  fillSelects();
  document.getElementById('modalTitle').textContent = edit ? 'Изменить заказ' : 'Новый заказ';
  document.getElementById('btnDelete').style.display = edit ? 'inline-block' : 'none';
  overlay.classList.add('show');
}
function closeModal(){ overlay.classList.remove('show'); form.reset(); }

document.getElementById('btnAdd').addEventListener('click', ()=>{
  form.reset();
  document.getElementById('orderId').value='';
  document.getElementById('f_start').value = dateKey(new Date());
  document.getElementById('f_deadline').value = dateKey(addDays(new Date(), 7));
  document.getElementById('f_taxType').value = 'none';
  document.getElementById('f_advanceUsed').value = '';
  document.getElementById('f_quarter').value = '';
  currentLines = [{id:'l0', label: getVisibleCatalog('types')[0] || 'Презентация', type: getVisibleCatalog('units')[0] || 'Слайд', qty:10, pomoHours:0, rate:500, ignorePrice:false, ready:false}];
  renderLines();
  openModal(false);
  populateLinkedLessonSelect('');
  syncModalStatusColor();
  syncModalPriorityTheme();
});
document.getElementById('btnAdd2').addEventListener('click', ()=>{ document.getElementById('btnAdd').click(); });

document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('btnCancel').addEventListener('click', closeModal);

// Открывает форму нового заказа, предзаполненную по образцу существующего —
// тот же клиент/предмет/класс/четверть/позиции, но следующий урок и сдвинутые даты.
// Финансовые и статусные поля намеренно НЕ копируются — это новая, ещё не начатая работа.
function duplicateOrder(id){
  const o = orders.find(x=>x.id===id);
  if(!o) return;

  openModal(false);
  document.getElementById('orderId').value = '';
  document.getElementById('f_title').value = '';
  document.getElementById('f_client').value = o.client||'';

  ensureSelectOption('f_subject', o.subject);
  document.getElementById('f_subject').value = o.subject||'';

  ensureSelectOption('f_class', o.grade);
  document.getElementById('f_class').value = o.grade||'';

  document.getElementById('f_quarter').value = o.quarter||'';

  const lessonNumMatch = String(o.lesson||'').match(/^\d+$/);
  document.getElementById('f_lesson').value = lessonNumMatch ? String(parseInt(o.lesson,10)+1) : (o.lesson||'');

  document.getElementById('f_status').value = 'queue';
  document.getElementById('f_isPaid').checked = false;
  document.getElementById('f_priority').checked = false;
  document.getElementById('f_advanceUsed').value = '';

  const origStart = parseLocalDate(o.start), origDeadline = parseLocalDate(o.deadline);
  const durationDays = (origStart && origDeadline) ? Math.max(1, daysBetween(o.start, o.deadline)) : 7;
  const newStart = origDeadline ? addDays(origDeadline, 1) : new Date();
  document.getElementById('f_start').value = dateKey(newStart);
  document.getElementById('f_deadline').value = dateKey(addDays(newStart, durationDays));

  document.getElementById('f_est').value = o.estimatedHours||'';
  document.getElementById('f_act').value = '';
  document.getElementById('f_notes').value = '';
  document.getElementById('f_taxType').value = o.taxType || 'none';

  currentLines = (o.lines&&o.lines.length) ? JSON.parse(JSON.stringify(o.lines)).map(l => ({...l, ready:false})) : [];
  renderLines();
  updateModalAdvanceInfo();
  warnIfAdvanceExceedsOrder();
  populateLinkedLessonSelect(''); // связь с уроком не копируем — она указывала бы на тот же (уже пройденный) урок
  syncModalStatusColor();
  syncModalPriorityTheme();
}

function editOrder(id){
  const o = orders.find(x=>x.id===id);
  if(!o) return;

  openModal(true);

  document.getElementById('orderId').value = o.id;
  document.getElementById('f_title').value = o.title||'';
  document.getElementById('f_client').value = o.client||'';
  
  ensureSelectOption('f_subject', o.subject);
  document.getElementById('f_subject').value = o.subject||'';

  ensureSelectOption('f_class', o.grade);
  document.getElementById('f_class').value = o.grade||'';

  document.getElementById('f_quarter').value = o.quarter||'';
  document.getElementById('f_lesson').value = o.lesson||'';
  document.getElementById('f_status').value = o.status||'queue';
  document.getElementById('f_isPaid').checked = !!o.isPaid;
  document.getElementById('f_priority').checked = !!o.priority;
  document.getElementById('f_advanceUsed').value = o.advanceUsed || '';

  document.getElementById('f_start').value = o.start||'';
  document.getElementById('f_deadline').value = o.deadline||'';
  document.getElementById('f_est').value = o.estimatedHours||'';
  document.getElementById('f_act').value = o.actualHours||'';
  document.getElementById('f_notes').value = o.notes||'';
  document.getElementById('f_taxType').value = o.taxType || 'none';

  currentLines = (o.lines&&o.lines.length) ? JSON.parse(JSON.stringify(o.lines)) : [];
  renderLines();
  updateModalAdvanceInfo();
  warnIfAdvanceExceedsOrder();
  populateLinkedLessonSelect(o.linkedLessonId || '');
  syncModalStatusColor();
  syncModalPriorityTheme();
}

// Ищет уже существующий (не отменённый, не тот же самый) заказ с тем же клиентом,
// предметом, классом, четвертью и номером урока — верный признак случайного дубля.
function findSimilarOrder(data, excludeId) {
  if (!data.client || !data.grade || !data.lesson) return null;
  return orders.find(o =>
    o.id !== excludeId &&
    o.status !== 'cancelled' &&
    (o.client||'').trim().toLowerCase() === data.client.trim().toLowerCase() &&
    (o.subject||'').trim().toLowerCase() === (data.subject||'').trim().toLowerCase() &&
    (o.grade||'').trim().toLowerCase() === data.grade.trim().toLowerCase() &&
    (o.quarter||'').trim().toLowerCase() === (data.quarter||'').trim().toLowerCase() &&
    String(o.lesson).trim() === String(data.lesson).trim()
  );
}

form.addEventListener('submit', (e)=>{
  e.preventDefault();
  const id = document.getElementById('orderId').value;
  let t = document.getElementById('f_title').value.trim();
  const subj = document.getElementById('f_subject').value;
  const cls = document.getElementById('f_class').value;
  const qtr = document.getElementById('f_quarter').value.trim();
  const les = document.getElementById('f_lesson').value.trim();

  if (subj && !appSettings.subjects.includes(subj)) appSettings.subjects.push(subj);
  if (cls && !appSettings.classes.includes(cls)) appSettings.classes.push(cls);

  if(!t) t = [subj, cls, qtr, les ? 'Урок ' + les : ''].filter(Boolean).join(', ');

  const data = {
    id: id || (Date.now().toString(36)),
    title: t,
    client: document.getElementById('f_client').value.trim(),
    subject: subj,
    grade: cls,
    quarter: qtr,
    lesson: les,
    status: document.getElementById('f_status').value,
    isPaid: document.getElementById('f_isPaid').checked,
    priority: document.getElementById('f_priority').checked,
    advanceUsed: parseNum(document.getElementById('f_advanceUsed').value),
    taxType: document.getElementById('f_taxType').value,
    start: document.getElementById('f_start').value,
    deadline: document.getElementById('f_deadline').value,
    estimatedHours: document.getElementById('f_est').value.trim(),
    actualHours: document.getElementById('f_act').value.trim(),
    lines: currentLines.filter(l=>l.label.trim()!=='' || parseNum(l.qty) || parseNum(l.pomoHours)),
    notes: document.getElementById('f_notes').value.trim(),
    createdAt: id ? (orders.find(o=>o.id===id)||{}).createdAt || Date.now() : Date.now(),
    linkedLessonId: document.getElementById('f_linkedLessonId').value || null
  };

  // Похожий заказ (тот же клиент/предмет/класс/четверть/номер урока) уже существует —
  // частая случайность при повторном сохранении или сбитой нумерации при дублировании.
  const similar = findSimilarOrder(data, id);
  if (similar) {
    const similarTitle = similar.title || [similar.subject, similar.grade, similar.quarter, similar.lesson ? 'Урок ' + similar.lesson : ''].filter(Boolean).join(', ') || 'Без названия';
    const proceed = confirm(`Похожий заказ уже есть: «${similarTitle}» (клиент: ${similar.client || '—'}, сдача: ${fmtDeadline(similar.deadline)}).\n\nВсё равно сохранить этот заказ?`);
    if (!proceed) return;
  }

  const oldOrder = id ? orders.find(o=>o.id===id) : null;

  if(id) orders = orders.map(o=>o.id===id?data:o);
  else orders.push(data);

  recordActivityChanges(oldOrder, data);

  syncPlanningWithOrders();
  saveData();
  renderCurrent();
  closeModal();
});

let pendingDeleteOrderId = null;

document.getElementById('btnDelete').addEventListener('click', ()=>{
  const id = document.getElementById('orderId').value;
  if(!id) return;
  pendingDeleteOrderId = id;
  document.getElementById('deleteOrderOverlay').classList.add('show');
});

function closeDeleteOrderModal() {
  pendingDeleteOrderId = null;
  document.getElementById('deleteOrderOverlay').classList.remove('show');
}

// wipeStats = true — вместе с заказом стереть из журнала активности всё, что было
// записано по нему (часы/слайды/страницы/выручка). false — оставить как исторический факт.
function confirmDeleteOrder(wipeStats) {
  const id = pendingDeleteOrderId;
  if (!id) return;

  orders = orders.filter(o=>o.id!==id);
  deleteFromCloud('orders', id);
  if (wipeStats) {
    activityLog = activityLog.filter(e => e.orderId !== id);
  }
  if (activeTimer.id === id) resetSidebarTimer();

  syncPlanningWithOrders();
  saveData();
  closeDeleteOrderModal();
  renderCurrent();
  closeModal();
}

/* Listeners */
document.getElementById('filterStatus').addEventListener('change', renderOrders);
document.getElementById('groupStatus').addEventListener('change', renderOrders);
document.getElementById('sortBy').addEventListener('change', renderOrders);

/* ЗАКРЫТИЕ ЛЮБЫХ ПОП-АПОВ ПО КЛИКУ НА ТЕМНЫЙ ФОН (OVERLAY) */
