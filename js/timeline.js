/* ============================================================
 * timeline.js — Таймлайн: шкала заказов по датам
 * ============================================================ */

function setTlMode(mode){
  tlMode = mode;
  ['1w','2w','1m'].forEach(m=>document.getElementById('seg'+m).classList.toggle('active', m===mode));
  renderTimeline();
}

function navTlRange(dir){
  if(dir===0){ tlAnchor = new Date(); }
  else if(tlMode==='1m'){
    tlAnchor = new Date(tlAnchor.getFullYear(), tlAnchor.getMonth() + dir, 1);
  } else {
    const daysToAdd = tlMode==='1w' ? 7 : 14;
    tlAnchor = addDays(tlAnchor, dir * daysToAdd);
  }
  renderTimeline();
}

function getTlDays(){
  const start = new Date(tlAnchor);
  start.setHours(0,0,0,0);

  if(tlMode==='1m'){
    // Полный календарный месяц — от 1-го числа до последнего дня месяца
    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
    const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    return Array.from({length:daysInMonth}, (_,i)=>addDays(monthStart, i));
  }

  let totalDays = tlMode==='1w' ? 7 : 14;
  const dow = (start.getDay()+6)%7;
  start.setDate(start.getDate()-dow);
  return Array.from({length:totalDays}, (_,i)=>addDays(start, i));
}

function toggleTimelineExpand(id, event) {
  if(event) event.stopPropagation();
  expandedTimelineOrderId = expandedTimelineOrderId === id ? null : id;
  renderTimeline();
}

function renderTimeline(){
  const days = getTlDays();
  const container = document.getElementById('tlContainerMain');

  document.getElementById('tlRangeLabel').textContent = `${days[0].getDate()} ${days[0].toLocaleString('ru',{month:'short'})} — ${days[days.length-1].getDate()} ${days[days.length-1].toLocaleString('ru',{month:'short'})}`;

  container.classList.toggle('tl-scroll-x', tlMode === '1m');

  if (tlMode === '1m') {
    // Полноценная сетка месяца в одной прокручиваемой по горизонтали доске —
    // у каждого дня фиксированная ширина колонки, а не растяжение под контейнер (как у 1/2 недель).
    container.innerHTML = renderTimelineSubBoard(days, 56);
  } else {
    container.innerHTML = renderTimelineSubBoard(days);
  }
  setTimeout(adjustAllBadgeSelects, 10);
}

function renderTimelineSubBoard(subDays, fixedColWidth) {
  const colStyle = fixedColWidth ? `style="flex:0 0 ${fixedColWidth}px; min-width:${fixedColWidth}px;"` : '';
  const rowWidthStyle = fixedColWidth ? `style="width:${fixedColWidth * subDays.length}px;"` : '';
  const todayStr = dateKey(new Date());

  const headerHtml = `<div class="tl-grid-header" ${rowWidthStyle}>` + subDays.map(d => {
    const isWknd = d.getDay()===0 || d.getDay()===6;
    const isToday = dateKey(d) === todayStr;
    return `
      <div class="tl-header-cell ${isWknd?'weekend':''} ${isToday?'today':''}" ${colStyle}>
        ${d.toLocaleString('ru',{weekday:'short'})}<br><b>${d.getDate()}</b>
      </div>
    `;
  }).join('') + `</div>`;

  const activeOrders = orders.filter(o=>o.status!=='cancelled' && o.start && o.deadline);
  activeOrders.sort((a,b) => {
    // Базовая хронология — по дате начала (приоритет здесь не участвует,
    // он применяется отдельным шагом ниже, только среди пересекающихся по датам заказов).
    const startCmp = a.start.localeCompare(b.start);
    if (startCmp !== 0) return startCmp;
    // Сначала группируем по "курсу" (предмет + класс + четверть), чтобы уроки одного курса
    // шли подряд, а не перемешивались с уроками другого предмета/класса на ту же дату
    const seqA = [a.subject||'', a.grade||'', a.quarter||''].join('|');
    const seqB = [b.subject||'', b.grade||'', b.quarter||''].join('|');
    if (seqA !== seqB) return seqA.localeCompare(seqB);
    // Внутри одного курса — сортируем по номеру урока,
    // чтобы, например, Урок 3 шёл ниже Урока 2, а Урок 6 ниже Урока 4, даже если Урок 4 ещё в очереди
    const lessonA = parseNum(a.lesson), lessonB = parseNum(b.lesson);
    if (lessonA && lessonB && lessonA !== lessonB) return lessonA - lessonB;
    const deadlineCmp = (a.deadline||'').localeCompare(b.deadline||'');
    if (deadlineCmp !== 0) return deadlineCmp;
    return (a.createdAt||0) - (b.createdAt||0);
  });

  // Приоритетные заказы "всплывают" вверх сквозь любой незавершённый заказ —
  // просроченный, но не отмеченный "Завершён", всё ещё считается активным и уступает место.
  // Останавливаются только на уже завершённых заказах (их порядок не трогаем).
  for (let i = 1; i < activeOrders.length; i++) {
    if (!activeOrders[i].priority) continue;
    let j = i;
    while (j > 0 && !activeOrders[j-1].priority && activeOrders[j-1].status !== 'done') {
      const tmp = activeOrders[j-1];
      activeOrders[j-1] = activeOrders[j];
      activeOrders[j] = tmp;
      j--;
    }
  }

  const rangeStart = subDays[0];
  const rangeEnd = subDays[subDays.length-1];

  const filteredOrders = activeOrders.filter(o => parseLocalDate(o.deadline) >= rangeStart && parseLocalDate(o.start) <= rangeEnd);

  // Экономия места по вертикали сейчас не важна — каждый заказ получает свою строку,
  // строго в порядке сортировки выше. Никакой "умной" упаковки в общие дорожки.
  const lanes = filteredOrders.map(o => [o]);

  const totalRangeDays = subDays.length;

  let boardHtml = '';
  lanes.forEach(lane => {
    let laneBarsHtml = '';

    lane.forEach(o => {
      const oStart = parseLocalDate(o.start);
      const oEnd = parseLocalDate(o.deadline);
      const displayTitle = o.title || [o.subject, o.grade, o.quarter, o.lesson ? 'Урок ' + o.lesson : ''].filter(Boolean).join(', ') || 'Без названия';

      const statusOptions = Object.keys(statusLabels).map(k=> `<option value="${k}" ${o.status===k?'selected':''}>${statusLabels[k]}</option>`).join('');

      const offsetDays = Math.max(0, daysBetween(rangeStart, oStart));
      const durationDays = daysBetween(oStart < rangeStart ? rangeStart : oStart, oEnd > rangeEnd ? rangeEnd : oEnd) + 1;

      const leftPct = (offsetDays / totalRangeDays) * 100;
      const widthPct = (durationDays / totalRangeDays) * 100;
      const alignClass = leftPct > 50 ? 'align-right' : 'align-left';

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

      const expandedDetailHtml = `
        <div class="timeline-expanded-card ${alignClass}" onclick="event.stopPropagation()">
          <div class="te-header">
            <div class="te-title-area">
              <span class="te-title">${escapeHtml(displayTitle)}</span>
              ${o.priority ? `<span class="badge" style="background:var(--rose-soft); color:var(--rose);">🔥 Приоритет</span>` : ''}
              <select class="badge ${o.status}" onchange="quickChangeStatus('${o.id}', this.value); adjustSelectWidth(this);">
                ${statusOptions}
              </select>
              ${o.isPaid ? `<span class="paid-badge" onclick="togglePaymentStatus('${o.id}', event)">Оплачено</span>` : `<span class="unpaid-badge" onclick="togglePaymentStatus('${o.id}', event)">Не оплачено</span>`}
            </div>
          </div>

          <div class="details-meta-box" style="margin-bottom:14px;">
            <div>
              <div class="details-box-label">Клиент</div>
              <div class="details-client-name">${o.client ? `<span style="cursor:pointer; text-decoration:underline dotted;" onclick="event.stopPropagation(); openClientCard('${escapeHtml(o.client)}')">${escapeHtml(o.client)}</span>` : '—'}</div>
            </div>
            <div class="details-mini-grid">
              <div class="details-mini-card">
                <div class="details-box-label">Сроки работы</div>
                <div class="details-mini-value">${fmtDateRangeCompact(o.start, o.deadline)}</div>
              </div>
              <div class="details-mini-card">
                <div class="details-box-label">Сумма</div>
                <div class="details-mini-value">${fmtMoney(orderTotal(o))}</div>
              </div>
            </div>
          </div>

          <div class="items-stack-container" style="margin-bottom:14px;">
            <span class="items-stack-label">Наполнение заказа (${(o.lines||[]).length} поз.):</span>
            <div class="items-stack">
              ${linesStackHtml}
            </div>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn btn-accent small" data-order-timer-btn="${o.id}" onclick="startSidebarTimer('${o.id}', '${escapeHtml(displayTitle)}')">
              <span class="timer-btn-icon">${(activeTimer.id===o.id && activeTimer.running) ? spcPauseIconTiny : spcPlayIconTiny}</span> <span class="timer-btn-label">${(activeTimer.id===o.id && activeTimer.running) ? 'Пауза' : 'Старт'}</span>
            </button>
            <button class="btn secondary small" onclick="editOrder('${o.id}')">Редактировать заказ</button>
          </div>
        </div>
      `;

      laneBarsHtml += `
        <div class="gantt-item-wrapper" style="left:${leftPct}%; width:${Math.min(widthPct, 100 - leftPct)}%;">
          <div class="gantt-item-bar status-${o.status} ${o.priority ? 'is-priority' : ''}" title="${escapeHtml(displayTitle)}${o.priority ? ' (приоритет)' : ''}" onclick="toggleTimelineExpand('${o.id}', event)">
            <span class="title-text">${escapeHtml(displayTitle)}</span>
            <span class="item-sub-count">${(o.lines||[]).length} поз.</span>
          </div>
          ${expandedDetailHtml}
        </div>
      `;
    });

    boardHtml += `
      <div class="gantt-row-container" ${rowWidthStyle}>
        <div class="gantt-bg-grid">
          ${subDays.map((d)=>{
            const isWknd = d.getDay()===0 || d.getDay()===6;
            const isToday = dateKey(d) === todayStr;
            return `<div class="gantt-bg-cell ${isWknd?'weekend':''} ${isToday?'today':''}" ${colStyle}></div>`;
          }).join('')}
        </div>
        ${laneBarsHtml}
      </div>
    `;
  });

  if(!lanes.length){
    boardHtml = `<div class="empty" style="padding:24px;text-align:center; color:var(--text-soft);">Нет заказов в этом периоде</div>`;
  }

  return headerHtml + `<div class="gantt-board">${boardHtml}</div>`;
}

/* COMBO BOX HELPERS */
