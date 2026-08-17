/* ============================================================
 * finance.js — Финансы: таблица финансов, авансы клиентов, депозиты
 * ============================================================ */

function switchFinanceTab(tab) {
  activeFinanceTab = tab;
  document.getElementById('finTabOverview').classList.toggle('active', tab==='overview');
  document.getElementById('finTabAdvances').classList.toggle('active', tab==='advances');
  document.getElementById('financeOverviewTab').style.display = tab==='overview' ? 'block' : 'none';
  document.getElementById('financeAdvancesTab').style.display = tab==='advances' ? 'block' : 'none';
  renderFinance();
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
        if (o.isPaid) return 1;
        const adv = parseNum(o.advanceUsed);
        const full = orderTotal(o);
        if (adv >= full) return 2;
        if (adv > 0) return 3;
        return 4;
      };
      return getStatusScore(a) - getStatusScore(b);
    });
  } else if (finSort === 'price_desc') {
    finList.sort((a,b) => orderTotal(b) - orderTotal(a));
  } else if (finSort === 'price_asc') {
    finList.sort((a,b) => orderTotal(a) - orderTotal(b));
  } else if (finSort === 'pending_desc') {
    finList.sort((a,b) => {
      const remA = a.isPaid ? 0 : Math.max(0, orderTotal(a) - parseNum(a.advanceUsed));
      const remB = b.isPaid ? 0 : Math.max(0, orderTotal(b) - parseNum(b.advanceUsed));
      return remB - remA;
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
    const advUsed = parseNum(o.advanceUsed);
    const remToPay = o.isPaid ? 0 : Math.max(0, full - advUsed);
    let statusText = 'Не оплачено';
    if (o.isPaid) statusText = 'Оплачен полностью';
    else if (advUsed > 0) statusText = `Аванс ${fmtMoney(advUsed)}, доплата ${fmtMoney(remToPay)}`;
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

    if(!o.isPaid) {
      const advUsed = Math.min(parseNum(o.advanceUsed), full);
      const rem = Math.max(0, full - advUsed);
      totalPending += rem;
    }
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
    const advUsed = parseNum(o.advanceUsed);
    const remToPay = o.isPaid ? 0 : Math.max(0, full - advUsed);

    let statusHtml = `<span class="unpaid-badge" title="Кликните для смены статуса оплаты" onclick="togglePaymentStatus('${o.id}', event)">Не оплачено</span>`;
    if (o.isPaid) {
      statusHtml = `<span class="paid-badge" title="Кликните для смены статуса оплаты" onclick="togglePaymentStatus('${o.id}', event)">Оплачен полностью</span>`;
    } else if (advUsed > 0) {
      statusHtml = `<span class="badge review" title="Кликните для смены статуса оплаты" onclick="togglePaymentStatus('${o.id}', event)">Аванс: ${fmtMoney(advUsed)} · Доплата: ${fmtMoney(remToPay)}</span>`;
    }

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
  const baseTotal = currentLines.reduce((s,l)=> s + calculateLineTotal(l), 0);
  const taxSel = document.getElementById('f_taxType');
  const rate = taxSel ? (taxSel.value==='individual' ? 0.04 : (taxSel.value==='entity' ? 0.06 : 0)) : 0;
  const totalWithTax = baseTotal * (1 + rate);
  const diff = Math.max(0, totalWithTax - advUsed);
  document.getElementById('advanceCalcSummary').textContent = fmtMoney(diff);
}

// Подсвечивает поле "Использовано аванса" красным, если вбили больше, чем реально стоит заказ.
// Это частая причина расхождений в выручке — цифра не пересчитывается сама при правке позиций.
function warnIfAdvanceExceedsOrder() {
  const input = document.getElementById('f_advanceUsed');
  const advUsed = parseNum(input.value);
  const baseTotal = currentLines.reduce((s,l)=> s + calculateLineTotal(l), 0);
  const taxSel = document.getElementById('f_taxType');
  const rate = taxSel ? (taxSel.value==='individual' ? 0.04 : (taxSel.value==='entity' ? 0.06 : 0)) : 0;
  const totalWithTax = baseTotal * (1 + rate);
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
