/* ============================================================
 * clients.js — раздел "Клиенты": все заказчики одним списком.
 *
 * До этого узнать что-то про клиента можно было только кликнув по его имени из заказа
 * или из Финансов — попап с одним клиентом за раз. Окинуть взглядом сразу всех (у кого
 * просрочка, у кого заканчивается аванс, кто должен доплатить) было нечем. Сам расчёт уже
 * был готов (getClientAdvanceStats в finance.js) — не хватало только списка.
 * ============================================================ */

function clientsList() {
  // Источник имён — объединение справочника (appSettings.clients) и того, что реально
  // встречается в заказах: клиент в заказе — свободный текст и может не совпадать с
  // каталогом (переименовали, ввели вручную и т.п.) — такой клиент не должен потеряться.
  const names = new Set((appSettings.clients || []).filter(Boolean));
  orders.forEach(o => { if (o.client) names.add(o.client); });
  return [...names];
}

function renderClients() {
  const body = document.getElementById('clientsTableBody');
  if (!body) return;

  const search = (document.getElementById('searchClients').value || '').toLowerCase().trim();
  const sortBy = document.getElementById('clientsSortBy').value;

  let rows = clientsList().map(name => {
    const stats = getClientAdvanceStats(name);
    const clientOrders = orders.filter(o => (o.client || '').toLowerCase() === name.toLowerCase() && o.status !== 'cancelled');
    const activeOrders = clientOrders.filter(o => o.status !== 'done');
    const totalDue = activeOrders.reduce((s, o) => s + orderPaymentState(o).remaining, 0);
    const hasOverdue = activeOrders.some(isOrderOverdue);
    return { name, available: stats.available, totalDue, activeCount: activeOrders.length, hasOverdue };
  });

  if (search) rows = rows.filter(r => r.name.toLowerCase().includes(search));

  if (sortBy === 'due_desc') rows.sort((a, b) => b.totalDue - a.totalDue);
  else if (sortBy === 'advance_desc') rows.sort((a, b) => b.available - a.available);
  else if (sortBy === 'orders_desc') rows.sort((a, b) => b.activeCount - a.activeCount);
  else rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  body.innerHTML = rows.length ? rows.map(r => `
    <tr style="cursor:pointer;" onclick="openClientCard('${escapeHtml(r.name)}')">
      <td data-label="Клиент"><b>${escapeHtml(r.name)}</b></td>
      <td data-label="Активных заказов" class="num-font">${r.activeCount}</td>
      <td data-label="Доступный аванс" class="num-font" style="color:var(--green); font-weight:700;">${fmtMoney(r.available)}</td>
      <td data-label="К доплате всего" class="num-font" style="${r.totalDue > 0 ? 'color:var(--rose); font-weight:700;' : ''}">${r.totalDue > 0 ? fmtMoney(r.totalDue) : '—'}</td>
      <td data-label="Статус">${r.hasOverdue ? `<span class="badge" style="background:var(--rose-soft); color:var(--rose);">⏰ Есть просрочка</span>` : (r.activeCount ? `<span class="badge review">В работе</span>` : '—')}</td>
    </tr>
  `).join('') : `<tr><td colspan="5" style="text-align:center; color:var(--text-faint); padding:24px;">${search ? 'Ничего не найдено' : 'Клиентов пока нет'}</td></tr>`;
}
