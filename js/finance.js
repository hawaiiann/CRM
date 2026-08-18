/* ============================================================
 * finance.js — Финансы: таблица финансов, авансы клиентов, депозиты
 * ============================================================ */

function switchFinanceTab(tab) {
  activeFinanceTab = tab;
  document.getElementById('finTabOverview').classList.toggle('active', tab==='overview');
  document.getElementById('finTabAdvances').classList.toggle('active', tab==='advances');
  document.getElementById('finTabTimeReport').classList.toggle('active', tab==='timereport');
  document.getElementById('financeOverviewTab').style.display = tab==='overview' ? 'block' : 'none';
  document.getElementById('financeAdvancesTab').style.display = tab==='advances' ? 'block' : 'none';
  document.getElementById('financeTimeReportTab').style.display = tab==='timereport' ? 'block' : 'none';
  renderFinance();
}

/* ---------- Отчёт по времени ----------
 * Часы — единственный показатель, что до сих пор живёт в журнале активности (см. js/stats.js:
 * выручка и количества считаются напрямую из заказов, а часы пишет таймер по ходу работы и
 * восстановить их из состояния заказов нельзя — это настоящий временной ряд). Отчёт группирует
 * их по клиенту/предмету/заказу за произвольный период — обосновать клиенту, сколько времени
 * реально ушло на работу, было нечем: сами часы были только внутри карточки каждого заказа. */
function timeReportRows() {
  const fromEl = document.getElementById('tr_from');
  const toEl = document.getElementById('tr_to');
  const groupEl = document.getElementById('tr_groupBy');
  if (!fromEl || !toEl || !groupEl) return { rows: [], totalHours: 0, totalOrders: 0, groupBy: 'client' };

  // По умолчанию — текущий месяц, но только если поля ещё пустые (первое открытие вкладки).
  // При каждой обычной перерисовке (после любого изменения данных, пока открыта эта вкладка)
  // уже выбранный пользователем период трогать нельзя.
  if (!fromEl.value) fromEl.value = dateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  if (!toEl.value) toEl.value = dateKey(new Date());

  const from = fromEl.value, to = toEl.value, groupBy = groupEl.value;

  const hoursByOrder = {};
  activityLog.forEach(e => {
    if (e.field !== 'hours' || !e.orderId) return;
    if (e.date < from || e.date > to) return;
    hoursByOrder[e.orderId] = (hoursByOrder[e.orderId] || 0) + e.delta;
  });

  const groups = {};
  let totalOrders = 0;
  Object.keys(hoursByOrder).forEach(orderId => {
    const hours = hoursByOrder[orderId];
    if (Math.abs(hours) < 0.001) return; // откат ("Готово" снято обратно) может дать чистый ноль
    totalOrders++;
    const o = orders.find(x => x.id === orderId);
    let key, label;
    if (groupBy === 'order') {
      key = orderId;
      label = o ? (o.title || [o.subject, o.grade, o.quarter, o.lesson ? 'Урок ' + o.lesson : ''].filter(Boolean).join(', ') || 'Без названия') : 'Удалённый заказ';
    } else if (groupBy === 'subject') {
      key = label = (o && o.subject) || '—';
    } else {
      key = label = (o && o.client) || '—';
    }
    if (!groups[key]) groups[key] = { label, hours: 0, orderIds: new Set() };
    groups[key].hours += hours;
    groups[key].orderIds.add(orderId);
  });

  const rows = Object.values(groups).sort((a, b) => b.hours - a.hours);
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  return { rows, totalHours, totalOrders, groupBy };
}

function renderTimeReport() {
  const body = document.getElementById('timeReportBody');
  if (!body) return;
  const { rows, totalHours, totalOrders, groupBy } = timeReportRows();

  document.getElementById('tr_groupHeader').textContent = groupBy === 'order' ? 'Заказ' : groupBy === 'subject' ? 'Предмет' : 'Клиент';
  body.innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td>${fmtHours(r.hours)}</td>
      <td>${r.orderIds.size}</td>
    </tr>
  `).join('') : `<tr><td colspan="3" style="color:var(--text-faint); text-align:center; padding:20px;">Нет данных за выбранный период</td></tr>`;
  document.getElementById('timeReportTotalHours').textContent = fmtHours(totalHours);
  document.getElementById('timeReportTotalOrders').textContent = totalOrders;
}

function exportTimeReportCSV() {
  const { rows, totalHours, totalOrders, groupBy } = timeReportRows();
  const groupLabel = groupBy === 'order' ? 'Заказ' : groupBy === 'subject' ? 'Предмет' : 'Клиент';
  const header = [groupLabel, 'Часов', 'Заказов'];
  const dataRows = rows.map(r => [r.label, fmtHours(r.hours), r.orderIds.size]);
  dataRows.push(['Итого', fmtHours(totalHours), totalOrders]);
  const csvLines = [header, ...dataRows].map(row => row.map(csvEscape).join(';'));
  const csvStr = '﻿' + csvLines.join('\r\n');
  const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'time-report-' + dateKey(new Date()) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* КАРТОЧКА КЛИЕНТА — сводка по одному заказчику: заказы, выручка, баланс аванса */
function openClientCard(clientName) {
  if (!clientName) return;
  const stats = getClientAdvanceStats(clientName);
  const clientOrders = orders.filter(o => (o.client || '').toLowerCase() === clientName.toLowerCase() && o.status !== 'cancelled');
  const revenue = clientOrders.reduce((s, o) => s + orderTotal(o), 0);

  document.getElementById('clientCardName').textContent = clientName;
  document.getElementById('clientCardOrdersCount').textContent = clientOrders.length;
  document.getElementById('clientCardRevenue').textContent = fmtMoney(revenue);
  document.getElementById('clientCardAvailable').textContent = fmtMoney(stats.available);
  document.getElementById('clientCardTotalIn').textContent = fmtMoney(stats.totalIn);
  document.getElementById('clientCardUsed').textContent = fmtMoney(stats.used);

  const sortedOrders = clientOrders.slice().sort((a, b) => (b.deadline || '').localeCompare(a.deadline || ''));
  document.getElementById('clientCardOrdersList').innerHTML = sortedOrders.map(o => {
    const displayTitle = o.title || [o.subject, o.grade, o.quarter, o.lesson ? 'Урок ' + o.lesson : ''].filter(Boolean).join(', ') || 'Без названия';
    return `
      <div class="item-subcard" style="cursor:pointer;" onclick="closeClientCard(); goToOrderCard('${o.id}')">
        <div class="item-subcard-main">
          <div class="item-subcard-icon">${getItemIcon('')}</div>
          <div>
            <div class="item-subcard-name" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</div>
            <div class="item-subcard-type">${statusLabels[o.status] || o.status} · сдача ${fmtDeadline(o.deadline)}</div>
          </div>
        </div>
        <div class="item-subcard-price">${fmtMoney(orderTotal(o))}</div>
      </div>
    `;
  }).join('') || `<div style="font-size:12.5px; color:var(--text-faint);">Заказов не найдено</div>`;

  document.getElementById('clientCardOverlay').classList.add('show');
}
function closeClientCard() {
  document.getElementById('clientCardOverlay').classList.remove('show');
}

function getClientAdvanceStats(clientName) {
  if (!clientName) return { totalIn: 0, used: 0, available: 0 };
  const clientAdvs = advances.filter(a => a.client.toLowerCase() === clientName.toLowerCase());
  const totalIn = clientAdvs.reduce((s, a) => s + parseNum(a.amount), 0);
  
  const used = orders
    .filter(o => o.client.toLowerCase() === clientName.toLowerCase() && o.status !== 'cancelled')
    .reduce((s, o) => s + parseNum(o.advanceUsed), 0);

  return {
    totalIn: totalIn,
    used: used,
    available: Math.max(0, totalIn - used)
  };
}

function getSortedFinanceList() {
  let finList = orders.slice();
  const finSort = document.getElementById('finSortBy') ? document.getElementById('finSortBy').value : 'default';

  if (finSort === 'status') {
    finList.sort((a,b) => {
      const getStatusScore = (o) => {
        const p = orderPaymentState(o);
        if (p.isFullyPaid) return 1;
        if (p.covered > 0) return 2;
        return 3;
      };
      return getStatusScore(a) - getStatusScore(b);
    });
  } else if (finSort === 'price_desc') {
    finList.sort((a,b) => orderTotal(b) - orderTotal(a));
  } else if (finSort === 'price_asc') {
    finList.sort((a,b) => orderTotal(a) - orderTotal(b));
  } else if (finSort === 'pending_desc') {
    finList.sort((a,b) => {
      return orderPaymentState(b).remaining - orderPaymentState(a).remaining;
    });
  } else if (finSort === 'adv_desc') {
    finList.sort((a,b) => parseNum(b.advanceUsed) - parseNum(a.advanceUsed));
  }
  return finList;
}

// Экранирует поле для CSV (кавычки удваиваются, поле в кавычках, если внутри запятая/кавычка/перевод строки)
function csvEscape(val) {
  const s = String(val ?? '');
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportFinanceCSV() {
  const finList = getSortedFinanceList();
  const header = ['Проект', 'Заказчик', 'Выручка (с налогом)', 'Налог', 'Оплачено из аванса', 'К доплате', 'Статус оплаты'];
  const rows = finList.map(o => {
    const base = orderBaseTotal(o);
    const full = orderTotal(o);
    const tax = full - base;
    const pay = orderPaymentState(o);
    const advUsed = pay.advUsed;
    const remToPay = pay.remaining;
    let statusText = 'Не оплачено';
    if (pay.isFullyPaid) statusText = 'Оплачен полностью';
    else if (pay.covered > 0) statusText = `Получено ${fmtMoney(pay.covered)}, к доплате ${fmtMoney(remToPay)}`;
    return [o.title || 'Без названия', o.client || '—', full, tax, advUsed, remToPay, statusText];
  });
  const csvLines = [header, ...rows].map(row => row.map(csvEscape).join(';'));
  const csvStr = '﻿' + csvLines.join('\r\n'); // BOM — чтобы Excel сразу открыл кириллицу как UTF-8
  const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'finance-' + dateKey(new Date()) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function renderFinance() {
  let totalRevenue = 0, totalNetIncome = 0, totalTax = 0, totalAdvancesIn = 0, totalPending = 0;

  advances.forEach(a => totalAdvancesIn += parseNum(a.amount));

  orders.forEach(o => {
    if(o.status === 'cancelled') return;
    const full = orderTotal(o);
    const rec = orderRecognizedRevenue(o);

    totalRevenue += rec.revenue;
    totalNetIncome += rec.net;
    totalTax += rec.revenue - rec.net;

    // "Ожидает оплаты" — только реально висящий остаток. Раньше при снятой галочке
    // "оплачено" сюда попадала вся сумма заказа целиком, даже если деньги частично уже
    // получены (это и ломалось при дозаказе в оплаченный заказ).
    totalPending += orderPaymentState(o).remaining;
  });

  const totalAdvUsed = orders.reduce((s,o) => s + parseNum(o.advanceUsed), 0);
  const totalAdvAvailable = Math.max(0, totalAdvancesIn - totalAdvUsed);

  document.getElementById('financeCardsGrid').innerHTML = `
    <div class="card stat-card">
      <div class="num" style="color:var(--green);">${fmtMoney(totalRevenue)}</div>
      <div class="lbl">Выручка (с налогом)</div>
      <div class="sub-text">Оплачено + покрыто авансом</div>
    </div>
    <div class="card stat-card">
      <div class="num">${fmtMoney(totalNetIncome)}</div>
      <div class="lbl">Чистый доход</div>
      <div class="sub-text">За вычетом налогов</div>
    </div>
    <div class="card stat-card">
      <div class="num" style="color:var(--rose);">${fmtMoney(totalTax)}</div>
      <div class="lbl">Налог к уплате</div>
      <div class="sub-text">Справочно по ставкам</div>
    </div>
    <div class="card stat-card">
      <div class="num" style="color:var(--amber);">${fmtMoney(totalAdvancesIn)}</div>
      <div class="lbl">Всего авансов внесено</div>
      <div class="sub-text">Остаток доступен: ${fmtMoney(totalAdvAvailable)}</div>
    </div>
    <div class="card stat-card">
      <div class="num">${fmtMoney(totalPending)}</div>
      <div class="lbl">Остаток к получению</div>
      <div class="sub-text">Ожидает доплаты клиентов</div>
    </div>
  `;

  const finList = getSortedFinanceList();

  const tbody = document.getElementById('financeTableBody');
  tbody.innerHTML = finList.map(o => {
    const base = orderBaseTotal(o);
    const full = orderTotal(o);
    const tax = full - base;
    const pay = orderPaymentState(o);
    const advUsed = pay.advUsed;
    const remToPay = pay.remaining;
    const statusHtml = paymentBadgeHtml(o);

    return `
      <tr>
        <td data-label="Проект">
          <a class="project-link" href="javascript:void(0)" onclick="goToOrderCard('${o.id}')">
            ${escapeHtml(o.title || 'Без названия')}
          </a>
        </td>
        <td data-label="Заказчик">${o.client ? `<a class="project-link" href="javascript:void(0)" onclick="openClientCard('${escapeHtml(o.client)}')">${escapeHtml(o.client)}</a>` : '—'}</td>
        <td data-label="Выручка (с налогом)"><b class="num-font">${fmtMoney(full)}</b></td>
        <td data-label="Налог" class="num-font" style="color:var(--text-soft);">${fmtMoney(tax)}</td>
        <td data-label="Оплачено из аванса" class="num-font" style="color:var(--amber); font-weight:700;">${advUsed > 0 ? fmtMoney(advUsed) : '—'}</td>
        <td data-label="К доплате" class="num-font" style="color:var(--rose); font-weight:700;">${remToPay > 0 ? fmtMoney(remToPay) : '0 ₽'}</td>
        <td data-label="Статус оплаты">${statusHtml}</td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="7" style="text-align:center; color:var(--text-faint);">Нет данных</td></tr>`;

  const advBody = document.getElementById('advancesRegistryBody');
  advBody.innerHTML = advances.map(a => {
    const stats = getClientAdvanceStats(a.client);
    return `
      <tr>
        <td data-label="Дата">${a.date}</td>
        <td data-label="Заказчик"><b>${escapeHtml(a.client)}</b></td>
        <td data-label="Внесённая сумма"><b>${fmtMoney(a.amount)}</b></td>
        <td data-label="Списано на заказы" style="color:var(--text-soft);">${fmtMoney(stats.used)}</td>
        <td data-label="Доступный остаток" style="color:var(--green); font-weight:800;">${fmtMoney(stats.available)}</td>
        <td data-label="Примечание">${escapeHtml(a.note || '—')}</td>
        <td data-label="Действие">
          <button class="btn danger small" style="padding:4px 8px;" onclick="deleteAdvance('${a.id}')">Удалить</button>
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="7" style="text-align:center; color:var(--text-faint);">Авансы еще не вносились</td></tr>`;

  renderTimeReport();
  resizeFinanceTable();
}

// Растягивает таблицу "Финансовая статистика по заказам" до низа видимой области экрана,
// вместо того чтобы упираться в фиксированную высоту.
function resizeFinanceTable() {
  const wrapper = document.getElementById('financeTableWrapper');
  if (!wrapper || wrapper.offsetParent === null) return; // вкладка сейчас скрыта — нечего считать
  const top = wrapper.getBoundingClientRect().top;
  const available = window.innerHeight - top - 24; // небольшой отступ снизу
  wrapper.style.maxHeight = Math.max(200, available) + 'px';
}
window.addEventListener('resize', resizeFinanceTable);

function openDepositModal() {
  document.getElementById('depositForm').reset();
  document.getElementById('dep_date').value = dateKey(new Date());
  document.getElementById('depositOverlay').classList.add('show');
}
function closeDepositModal() {
  document.getElementById('depositOverlay').classList.remove('show');
}

function handleDepositSubmit(e) {
  e.preventDefault();
  const client = document.getElementById('dep_client').value.trim();
  const amount = parseNum(document.getElementById('dep_amount').value);
  const date = document.getElementById('dep_date').value;
  const note = document.getElementById('dep_note').value.trim();

  if(!client || !amount) return;

  advances.push({
    id: 'adv' + Date.now(),
    client: client,
    amount: amount,
    date: date,
    note: note
  });

  saveData();
  closeDepositModal();
  renderFinance();
}

function deleteAdvance(id) {
  const a = advances.find(x => x.id === id);
  const label = a ? `${fmtMoney(a.amount)} от ${a.client} (${a.date})` : 'эту запись';
  if (!confirm(`Удалить запись об авансе — ${label}?`)) return;
  advances = advances.filter(x => x.id !== id);
  deleteFromCloud('advances', id);
  saveData();
  renderFinance();
}

/* MODAL ADVANCE LOGIC */
function updateModalAdvanceInfo() {
  const clientName = document.getElementById('f_client').value.trim();
  const badge = document.getElementById('clientAvailableAdvanceBadge');
  if(!clientName) {
    badge.textContent = '0 ₽';
    return;
  }
  const stats = getClientAdvanceStats(clientName);
  // Показываем ЧЕСТНЫЙ общий остаток по клиенту (как и в реестре авансов на Финансах) —
  // а не "остаток + то, что уже списано на этот заказ". Раньше при редактировании заказа
  // с уже выделенным авансом бейдж показывал ложно доступную сумму, даже если у клиента
  // по факту 0 свободного (то, что видите здесь — уже целиком закреплено за этим заказом).
  badge.textContent = fmtMoney(stats.available);
  calculateModalAdvanceDiff();
}

function calculateModalAdvanceDiff() {
  const advUsed = parseNum(document.getElementById('f_advanceUsed').value);
  const diff = Math.max(0, currentFormOrderTotal() - advUsed);
  document.getElementById('advanceCalcSummary').textContent = fmtMoney(diff);
  updatePaymentSummary();
}

// Текущая стоимость заказа в форме (по позициям + налог) — берём напрямую из черновика,
// а не из уже округлённого текста на экране. Округляем до целого рубля — так же, как
// orderTotal/orderRecognizedRevenue: именно с округлённой суммой выставляется счёт клиенту,
// и её же показывает бейдж "Стоимость заказа". Раньше здесь возвращалось точное дробное
// число (например, 2329.6 при налоге 4%), а пользователь естественно вводит платёж по
// округлённой сумме с экрана (2330) — разница в 40 копеек превышала допуск в 1 копейку и
// ложно подсвечивала поле платежа как "больше, чем можно" при полностью оплаченном заказе.
function currentFormOrderTotal() {
  const baseTotal = currentLines.reduce((s, l) => s + calculateLineTotal(l), 0);
  const taxSel = document.getElementById('f_taxType');
  const rate = taxSel ? (taxSel.value === 'individual' ? 0.04 : (taxSel.value === 'entity' ? 0.06 : 0)) : 0;
  return Math.round(baseTotal * (1 + rate));
}

/* ---------- Блок "Оплата по заказу": список платежей ----------
 * Черновик платежей формы живёт в currentPayments — по тому же принципу, что currentLines
 * для позиций: правки применяются к заказу только при сохранении. */
let currentPayments = [];

function renderOrderPayments() {
  const list = document.getElementById('paymentsList');
  if (!list) return;

  list.innerHTML = currentPayments.length ? currentPayments.map(p => `
    <div class="payment-row" data-id="${p.id}">
      <input type="text" inputmode="decimal" value="${escapeHtml(String(p.amount || ''))}" placeholder="Сумма ₽"
             oninput="updatePaymentField('${p.id}','amount',this.value)">
      <input type="date" value="${escapeHtml(p.date || '')}"
             onchange="updatePaymentField('${p.id}','date',this.value)">
      <input type="text" value="${escapeHtml(p.note || '')}" placeholder="Примечание"
             oninput="updatePaymentField('${p.id}','note',this.value)">
      <button type="button" class="line-rm" title="Удалить платёж" onclick="removeOrderPayment('${p.id}')">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
      </button>
    </div>
  `).join('') : `<div style="font-size:12.5px; color:var(--text-faint);">Платежей пока нет. Аванс учитывается отдельно, выше.</div>`;

  updatePaymentSummary();
}

function addOrderPaymentRow() {
  // Сумма нового платежа по умолчанию — остаток к доплате: чаще всего платят именно его.
  const rest = Math.max(0, Math.round(remainingForFormOrder() * 100) / 100);
  currentPayments.push(normalizePayment({ amount: rest || '', date: dateKey(new Date()), note: '' }));
  renderOrderPayments();
}

function removeOrderPayment(id) {
  currentPayments = currentPayments.filter(p => p.id !== id);
  renderOrderPayments();
}

function updatePaymentField(id, field, value) {
  const p = currentPayments.find(x => x.id === id);
  if (!p) return;
  p[field] = field === 'amount' ? value : value;
  updatePaymentSummary();
}

function paymentsDraftTotal() {
  return currentPayments.reduce((s, p) => s + parseNum(p.amount), 0);
}

function remainingForFormOrder() {
  const totalWithTax = currentFormOrderTotal();
  const advUsed = Math.min(parseNum(document.getElementById('f_advanceUsed').value), totalWithTax);
  return Math.max(0, totalWithTax - advUsed - paymentsDraftTotal());
}

// Стоимость, полученные деньги и остаток. Остаток = стоимость − аванс − платежи,
// поэтому при дозаказе он растёт сам, а полученное никуда не девается.
function updatePaymentSummary() {
  const totalEl = document.getElementById('payOrderTotalBadge');
  const receivedEl = document.getElementById('payReceivedBadge');
  const remainEl = document.getElementById('payRemainingBadge');
  if (!totalEl || !remainEl || !receivedEl) return;

  const totalWithTax = currentFormOrderTotal();
  const advUsed = Math.min(parseNum(document.getElementById('f_advanceUsed').value), totalWithTax);
  const received = paymentsDraftTotal();
  const remaining = Math.max(0, totalWithTax - advUsed - received);

  totalEl.textContent = fmtMoney(totalWithTax);
  receivedEl.textContent = fmtMoney(received);
  remainEl.textContent = fmtMoney(remaining);
  remainEl.style.color = remaining <= 0.01 ? 'var(--green)' : 'var(--amber)';

  // Платежей больше, чем осталось после аванса — почти всегда опечатка, подсвечиваем.
  const maxPayable = Math.max(0, totalWithTax - advUsed);
  const over = received > maxPayable + 0.01;
  document.querySelectorAll('#paymentsList .payment-row input:first-child').forEach(inp => {
    inp.style.borderColor = over ? 'var(--rose)' : '';
    inp.title = over ? `Сумма платежей (${fmtMoney(received)}) больше остатка после аванса (${fmtMoney(maxPayable)}). Проверьте.` : '';
  });
}

// Кнопка "Получил всё" — добавляет один платёж ровно на остаток, сегодняшней датой.
function fillFullPaymentForOrder() {
  const rest = Math.max(0, Math.round(remainingForFormOrder() * 100) / 100);
  if (rest <= 0) { updatePaymentSummary(); return; }
  currentPayments.push(normalizePayment({ amount: rest, date: dateKey(new Date()), note: '' }));
  renderOrderPayments();
}

// Подсвечивает поле "Использовано аванса" красным, если вбили больше, чем реально стоит заказ.
// Это частая причина расхождений в выручке — цифра не пересчитывается сама при правке позиций.
function warnIfAdvanceExceedsOrder() {
  const input = document.getElementById('f_advanceUsed');
  const advUsed = parseNum(input.value);
  const totalWithTax = currentFormOrderTotal();
  input.style.borderColor = advUsed > totalWithTax + 0.01 ? 'var(--rose)' : '';
  input.title = advUsed > totalWithTax + 0.01
    ? `Это больше, чем стоимость заказа (${fmtMoney(totalWithTax)}). Проверьте сумму.`
    : '';
}

function fillMaxAdvanceForOrder() {
  const clientName = document.getElementById('f_client').value.trim();
  if(!clientName) return;
  const stats = getClientAdvanceStats(clientName);
  const currentOrderId = document.getElementById('orderId').value;
  const curOrder = orders.find(o => o.id === currentOrderId);
  const curOrderUsed = curOrder ? parseNum(curOrder.advanceUsed) : 0;
  
  const trueAvail = stats.available + curOrderUsed;

  // Точная сумма заказа с налогом — считаем напрямую по позициям,
  // а не берём из уже округлённого текста на экране (там могут теряться копейки).
  const baseTotal = currentLines.reduce((s,l)=> s + calculateLineTotal(l), 0);
  const taxSel = document.getElementById('f_taxType');
  const rate = taxSel ? (taxSel.value==='individual' ? 0.04 : (taxSel.value==='entity' ? 0.06 : 0)) : 0;
  const totalWithTax = baseTotal * (1 + rate);
  
  const fillVal = Math.min(trueAvail, totalWithTax);
  // Округляем до целого рубля — выручка и все связанные суммы в приложении теперь
  // тоже считаются в целых рублях, поле аванса должно быть с этим согласовано.
  document.getElementById('f_advanceUsed').value = Math.round(fillVal);
  calculateModalAdvanceDiff();
  warnIfAdvanceExceedsOrder();
}

/* SETTINGS & AUTO-BACKUP SYSTEM */
