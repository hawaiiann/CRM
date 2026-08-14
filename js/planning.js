/* ============================================================
 * planning.js — Планирование уроков: доски классов, модалка урока, чек-листы
 * ============================================================ */

function togglePlanningArchive() {
  archivedPlanningExpanded = !archivedPlanningExpanded;
  renderPlanning();
}

function toggleBoardArchived(bIdx) {
  if (planningBoards[bIdx]) {
    planningBoards[bIdx].archived = !planningBoards[bIdx].archived;
    saveData();
    renderPlanning();
  }
}

function updateBoardDeadline(bIdx, val) {
  if (planningBoards[bIdx]) {
    planningBoards[bIdx].deadline = val;
    saveData();
  }
}

function renderPlanningBoardCard(board, bIdx) {
  const lessons = board.lessons || [];
  const totalLessons = lessons.length;
  let greenLessons = 0;
  let totalItems = 0;
  let doneItems = 0;

  const typeBreakdown = {};

  lessons.forEach(l => {
    const items = l.items || [];
    const totalInLesson = items.length;
    const doneInLesson = items.filter(i => i.done).length;

    if ((l.color && l.color.startsWith('green')) || (totalInLesson > 0 && doneInLesson === totalInLesson)) {
      greenLessons++;
    }

    items.forEach(item => {
      const typeName = item.text.trim();
      if (!typeName) return;
      if (!typeBreakdown[typeName]) typeBreakdown[typeName] = { done: 0, total: 0 };
      typeBreakdown[typeName].total++;
      if (item.done) typeBreakdown[typeName].done++;

      totalItems++;
      if (item.done) doneItems++;
    });
  });

  // Главный процент рассчитывается из закрытых пунктов/материалов уроков
  const mainPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : (totalLessons > 0 ? Math.round((greenLessons / totalLessons) * 100) : 0);

  const typeBoxesHtml = Object.keys(typeBreakdown).map(tName => {
    const stat = typeBreakdown[tName];
    const pct = stat.total > 0 ? Math.round((stat.done / stat.total) * 100) : 0;
    return `
      <div style="background:var(--subcard); border-radius:12px; padding:10px 12px;">
        <div style="font-size:10px; font-weight:700; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.03em;">${escapeHtml(tName)}</div>
        <div style="font-size:13px; font-weight:700; color:var(--text); margin-top:3px;" class="num-font">${stat.done}/${stat.total}</div>
        <div style="height:4px; border-radius:999px; background:var(--border); margin-top:7px; overflow:hidden;">
          <div style="height:100%; width:${pct}%; background:var(--green); border-radius:999px;"></div>
        </div>
      </div>
    `;
  }).join('');

  const lessonsPct = totalLessons > 0 ? Math.round((greenLessons / totalLessons) * 100) : 0;
  const statsGridHtml = `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(100px, 1fr)); gap:8px; margin-top:12px;">
      <div style="background:var(--surface); border:1.5px solid var(--rose); border-radius:12px; padding:10px 12px;">
        <div style="font-size:10px; font-weight:700; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.03em;">Пункты</div>
        <div style="font-size:13px; font-weight:700; color:var(--rose); margin-top:3px;" class="num-font">${doneItems}/${totalItems} · ${mainPct}%</div>
        <div style="height:4px; border-radius:999px; background:var(--border); margin-top:7px; overflow:hidden;">
          <div style="height:100%; width:${mainPct}%; background:var(--rose); border-radius:999px;"></div>
        </div>
      </div>
      <div style="background:var(--subcard); border-radius:12px; padding:10px 12px;">
        <div style="font-size:10px; font-weight:700; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.03em;">Уроки</div>
        <div style="font-size:13px; font-weight:700; color:var(--text); margin-top:3px;" class="num-font">${greenLessons}/${totalLessons}</div>
        <div style="height:4px; border-radius:999px; background:var(--border); margin-top:7px; overflow:hidden;">
          <div style="height:100%; width:${lessonsPct}%; background:var(--green); border-radius:999px;"></div>
        </div>
      </div>
      ${typeBoxesHtml}
    </div>
  `;

  const cellsHtml = lessons.map((lesson, lIdx) => {
    const items = lesson.items || [];
    const totalInL = items.length;
    const doneInL = items.filter(i => i.done).length;

    let colorClass = lesson.color || 'gray';

    // Ручной ("принудительный") выбор цвета — рендер его не пересчитывает.
    // Урок, привязанный к активному заказу (orderLinked) — тоже: его цвет ведёт статус заказа,
    // а не процент выполнения чек-листа (иначе "В работе" тут же затиралось бы обратно на серый/зелёный).
    if (!lesson.colorLocked && !lesson.orderLinked) {
      if (totalInL === 0 || doneInL === 0) {
        colorClass = 'gray';
      } else {
        const ratio = doneInL / totalInL;
        if (ratio >= 0.99) {
          colorClass = 'green-3';
        } else if (ratio >= 0.5) {
          colorClass = 'green-2';
        } else {
          colorClass = 'green-1';
        }
      }
    }

    const cellKey = `${bIdx}_${lIdx}`;
    const isPendingDel = cellPendingDeleteKey === cellKey;
    const displayNum = lesson.num ?? (lIdx + 1);

    return `
      <div class="plan-cell ${colorClass}" 
           onmouseenter="showPlanCellTooltip(event, '${escapeHtml(lesson.title || ('Урок ' + displayNum))}')"
           onmouseleave="hidePlanCellTooltip()"
           onclick="handleCellClick(event, ${bIdx}, ${lIdx})" 
           oncontextmenu="handleCellContextMenu(event, ${bIdx}, ${lIdx})">
        ${isPendingDel ? `<div class="plan-cell-del-overlay" onclick="confirmCellDelete(event, ${bIdx}, ${lIdx})">✕</div>` : displayNum}
      </div>
    `;
  }).join('');

  const subjectOptsHtml = (appSettings.subjects || []).map(s =>
    `<option value="${escapeHtml(s)}" ${board.subject === s ? 'selected' : ''}>${escapeHtml(s)}</option>`
  ).join('');

  const classOptsHtml = (appSettings.classes || []).map(c =>
    `<option value="${escapeHtml(c)}" ${board.title === c ? 'selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');

  return `
    <div class="plan-class-card ${board.collapsed ? 'collapsed' : ''}" data-board-idx="${bIdx}">
      <div class="plan-class-header" onclick="if(!event.target.closest('select, input, button, .occ-deadline-badge')) toggleCollapseBoard(${bIdx})">
        <div class="plan-title-group">
          <select class="plan-class-subject" onchange="updateBoardSubject(${bIdx}, this.value)">
            <option value="">Предмет...</option>
            ${subjectOptsHtml}
          </select>

          <select class="plan-class-title" onchange="updateBoardTitle(${bIdx}, this.value)">
            <option value="">Класс...</option>
            ${classOptsHtml}
          </select>

          <input type="text" inputmode="numeric" class="plan-class-quarter" value="${escapeHtml(board.quarter || '')}" 
                 oninput="normalizeQuarterInput(this)" onfocus="focusQuarterInput(this)" onblur="formatQuarterOnBlur(this, ${bIdx})" placeholder="Четверть...">

          ${board.deadline ? `
            <div class="occ-deadline-badge" style="margin-top:0; cursor:pointer;" onclick="openBoardModal(${bIdx})" title="Дедлайн класса (клик для изменения)">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle; margin-right:4px;"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M7 2v4M13 2v4M3 8h14"/></svg>
              <b>${fmtDeadline(board.deadline)}</b>
            </div>
          ` : `
            <button class="btn secondary small" style="padding:4px 10px; font-size:11.5px;" onclick="openBoardModal(${bIdx})" title="Задать дедлайн класса">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M7 2v4M13 2v4M3 8h14"/></svg> + Дедлайн
            </button>
          `}
        </div>
        <div class="plan-class-controls">
          <button class="btn secondary small" style="padding: 6px 8px;" onclick="openBoardModal(${bIdx})" title="Настройки класса и наполнения">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="3"/><path d="M10 2v2m0 12v2M15.66 4.34l-1.42 1.42M5.76 14.24l-1.42 1.42M18 10h-2M4 10H2M15.66 15.66l-1.42-1.42M5.76 5.76L4.34 4.34" stroke-linecap="round"/></svg>
          </button>
          <button class="btn secondary small" onclick="addLessonToBoard(${bIdx})">Добавить урок</button>
          <button class="btn secondary small" style="padding: 6px 8px;" onclick="toggleBoardArchived(${bIdx})" title="${board.archived ? 'Вернуть из архива' : 'Перенести в архив'}">
            ${board.archived 
              ? `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12l6-6 6 6M10 6v10" stroke-linecap="round" stroke-linejoin="round"/></svg>`
              : `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h12v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"/><path d="M2 4h16"/><path d="M8 9h4" stroke-linecap="round"/></svg>`
            }
          </button>
          <button class="btn danger small" style="padding:4px 8px;" title="Удалить класс" onclick="deletePlanningBoard(${bIdx})">✕</button>
          <button class="plan-collapse-btn" onclick="toggleCollapseBoard(${bIdx})">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l5 5 5-5" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>

      <div class="plan-collapsible-wrapper">
        <div class="plan-collapsible-inner">
          ${statsGridHtml}

          <div class="plan-cells-grid">
            ${cellsHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPlanning() {
  const container = document.getElementById('planningContainer');
  if (!container) return;

  if (!planningBoards || planningBoards.length === 0) {
    container.innerHTML = `
      <div class="card empty" style="padding: 40px; text-align: center;">
        <b style="font-size: 16px;">Список планирования пуст</b>
        <p style="color: var(--text-soft); font-size: 13.5px; margin-top: 6px;">Создайте первый класс для ведения уроков.</p>
        <button class="btn btn-accent" style="margin-top: 14px;" onclick="openBoardModal()">Добавить класс</button>
      </div>
    `;
    return;
  }

  const sortVal = document.getElementById('planningSortBy') ? document.getElementById('planningSortBy').value : 'class';
  let boardsWithIdx = planningBoards.map((b, idx) => ({ board: b, originalIdx: idx }));

  const searchVal = (document.getElementById('planningSearch')?.value || '').trim().toLowerCase();
  if (searchVal) {
    boardsWithIdx = boardsWithIdx.filter(item =>
      (item.board.subject || '').toLowerCase().includes(searchVal) ||
      (item.board.title || '').toLowerCase().includes(searchVal) ||
      (item.board.quarter || '').toLowerCase().includes(searchVal)
    );
  }

  if (sortVal === 'class') {
    boardsWithIdx.sort((a, b) => (a.board.title || '').localeCompare(b.board.title || ''));
  } else if (sortVal === 'subject') {
    boardsWithIdx.sort((a, b) => (a.board.subject || '').localeCompare(b.board.subject || ''));
  } else if (sortVal === 'deadline') {
    boardsWithIdx.sort((a, b) => (a.board.deadline || '9999').localeCompare(b.board.deadline || '9999'));
  }

  const activeBoards = boardsWithIdx.filter(item => !item.board.archived);
  const archivedBoards = boardsWithIdx.filter(item => item.board.archived);

  const activeHtml = activeBoards.map(item => renderPlanningBoardCard(item.board, item.originalIdx)).join('');

  let archiveSectionHtml = '';
  if (archivedBoards.length > 0) {
    const archivedCardsHtml = archivedBoards.map(item => renderPlanningBoardCard(item.board, item.originalIdx)).join('');
    archiveSectionHtml = `
      <div class="archive-section">
        <div class="archive-header" onclick="togglePlanningArchive()">
          <div class="archive-title">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 5h12M4 9h12M4 13h12" stroke-linecap="round"/>
            </svg>
            Архив классов (${archivedBoards.length})
          </div>
          <span class="btn secondary small">${archivedPlanningExpanded ? 'Свернуть ▲' : 'Развернуть ▼'}</span>
        </div>
        ${archivedPlanningExpanded ? `<div class="planning-container">${archivedCardsHtml}</div>` : ''}
      </div>
    `;
  }

  const emptyMsg = searchVal ? 'По вашему запросу ничего не найдено' : 'Нет активных классов в планировании';
  container.innerHTML = (activeHtml || `<div style="font-size:13px; color:var(--text-soft); padding:12px 0;">${emptyMsg}</div>`) + archiveSectionHtml;

  setTimeout(adjustAllAdaptiveInputs, 10);
}

/* РЕНДЕР БЛОКА С КРУГОВЫМИ ДИАГРАММАМИ (DONUTS) НА ДАШБОРДЕ ПРАВИЛЬНО ПО МАКЕТУ */
function renderClassProgressWidget() {
  const container = document.getElementById('ovClassProgressContainer');
  if (!container) return;

  const activeBoards = (planningBoards || []).filter(b => !b.archived);

  if (activeBoards.length === 0) {
    container.innerHTML = `<div style="font-size:12.5px; color:var(--text-faint); padding:10px 0;">Нет активных классов</div>`;
    return;
  }

  let totalItemsAll = 0, doneItemsAll = 0;

  const itemsHtml = activeBoards.map((board, idx) => {
    const lessons = board.lessons || [];
    let totalItems = 0, doneItems = 0;
    lessons.forEach(l => {
      (l.items || []).forEach(item => {
        totalItems++;
        if (item.done) doneItems++;
      });
    });
    totalItemsAll += totalItems;
    doneItemsAll += doneItems;

    const pct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

    return `
      <div class="cpw-item" title="${escapeHtml(board.subject ? board.subject + ' · ' : '')}${escapeHtml(board.title)}: ${pct}%">
        <div class="cpw-circle-ring" style="background: conic-gradient(var(--green) 0%, var(--green) ${pct}%, var(--border) ${pct}%, var(--border) 100%);">
          <div class="cpw-circle-inner"><span class="cpw-circle-num">${pct}%</span></div>
        </div>
        <div class="cpw-label">${escapeHtml(board.title)}</div>
      </div>
    `;
  }).join('');

  const overallPct = totalItemsAll > 0 ? Math.round((doneItemsAll / totalItemsAll) * 100) : 0;

  container.innerHTML = `
    <div class="cpw-row">${itemsHtml}</div>
    <div class="cpw-milestone">
      <span>Итого по всем классам</span>
      <div class="cpw-milestone-bar"><div class="cpw-milestone-fill" style="width:${overallPct}%;"></div></div>
      <span class="cpw-milestone-pct">${overallPct}%</span>
    </div>
  `;
}

document.addEventListener('click', function(e) {
  if (cellPendingDeleteKey && !e.target.closest('.plan-cell')) {
    cellPendingDeleteKey = null;
    renderPlanning();
  }
});

function handleCellContextMenu(e, bIdx, lIdx) {
  e.preventDefault();
  cellPendingDeleteKey = `${bIdx}_${lIdx}`;
  renderPlanning();
}

function handleCellClick(e, bIdx, lIdx) {
  const cellKey = `${bIdx}_${lIdx}`;
  if (cellPendingDeleteKey === cellKey) {
    return;
  }
  openLessonModal(bIdx, lIdx);
}

function confirmCellDelete(e, bIdx, lIdx) {
  e.stopPropagation();
  if (planningBoards[bIdx] && planningBoards[bIdx].lessons[lIdx]) {
    planningBoards[bIdx].lessons.splice(lIdx, 1);
    cellPendingDeleteKey = null;
    saveData();
    renderPlanning();
  }
}

/* МОДАЛЬНОЕ ОКНО НАСТРОЕК / СОЗДАНИЯ КЛАССА С ИНТЕРАКТИВНЫМ НАПОЛНЕНИЕМ */
function renderBmTemplateItems() {
  const container = document.getElementById('bmTemplateList');
  if (!container) return;
  container.innerHTML = currentBmTemplate.map((itemVal, idx) => `
    <div class="settings-row" style="margin-bottom:0;">
      ${renderComboField(`bmTplItem-${idx}`, itemVal, 'Выберите тип работы или введите...', appSettings.types, `currentBmTemplate[${idx}] = this.value;`)}
      <button type="button" class="btn danger small" style="padding:6px 8px;" onclick="removeBmTemplateItem(${idx})">✕</button>
    </div>
  `).join('');
}

function addBmTemplateItem(val = '') {
  currentBmTemplate.push(val);
  renderBmTemplateItems();
}

function removeBmTemplateItem(idx) {
  currentBmTemplate.splice(idx, 1);
  renderBmTemplateItems();
}

function openBoardModal(bIdx = null) {
  document.getElementById('boardForm').reset();
  document.getElementById('bmBoardIdx').value = bIdx !== null ? bIdx : '';

  document.getElementById('subjectsDatalist').innerHTML = (appSettings.subjects || []).map(s => `<option value="${escapeHtml(s)}">`).join('');
  document.getElementById('classesDatalist').innerHTML = (appSettings.classes || []).map(c => `<option value="${escapeHtml(c)}">`).join('');

  if (bIdx !== null && planningBoards[bIdx]) {
    const board = planningBoards[bIdx];
    document.getElementById('boardModalTitle').textContent = 'Редактировать класс';
    document.getElementById('bm_subject').value = board.subject || '';
    document.getElementById('bm_title').value = board.title || '';
    document.getElementById('bm_quarter').value = board.quarter || '';
    document.getElementById('bm_deadline').value = board.deadline || '';
    document.getElementById('bm_startNum').value = (board.lessons && board.lessons[0]) ? board.lessons[0].num || 1 : 1;
    document.getElementById('bm_count').value = (board.lessons || []).length || 24;
    currentBmTemplate = board.baseTemplate && board.baseTemplate.length ? [...board.baseTemplate] : ['Презентация', 'Рабочий лист'];
  } else {
    document.getElementById('boardModalTitle').textContent = 'Добавить новый класс';
    document.getElementById('bm_subject').value = appSettings.subjects[0] || 'Математика';
    document.getElementById('bm_title').value = appSettings.classes[0] || '5 класс';
    document.getElementById('bm_quarter').value = '1 четверть';
    document.getElementById('bm_deadline').value = '';
    document.getElementById('bm_startNum').value = 1;
    document.getElementById('bm_count').value = 24;
    currentBmTemplate = ['Презентация', 'Рабочий лист'];
  }

  renderBmTemplateItems();
  document.getElementById('boardModalOverlay').classList.add('show');
}

function closeBoardModal() {
  document.getElementById('boardModalOverlay').classList.remove('show');
}

function handleBoardSubmit(e) {
  e.preventDefault();
  const bIdxStr = document.getElementById('bmBoardIdx').value;
  const subject = document.getElementById('bm_subject').value.trim();
  const title = document.getElementById('bm_title').value.trim();
  const quarter = document.getElementById('bm_quarter').value.trim();
  const deadline = document.getElementById('bm_deadline').value;
  const startNum = parseInt(document.getElementById('bm_startNum').value) || 1;
  const count = parseInt(document.getElementById('bm_count').value) || 12;
  const templateItems = currentBmTemplate.map(s => s.trim()).filter(Boolean);

  if (subject && !appSettings.subjects.includes(subject)) appSettings.subjects.push(subject);
  if (title && !appSettings.classes.includes(title)) appSettings.classes.push(title);

  if (bIdxStr !== '' && planningBoards[parseInt(bIdxStr)]) {
    const bIdx = parseInt(bIdxStr);
    const board = planningBoards[bIdx];

    const oldTemplate = board.baseTemplate || [];
    board.subject = subject;
    board.title = title;
    board.quarter = quarter;
    board.deadline = deadline;
    board.baseTemplate = templateItems;

    // Находим убранные элементы из базового наполнения
    const removedItems = oldTemplate.filter(oldT => !templateItems.some(newT => newT.toLowerCase() === oldT.toLowerCase()));

    // Обновляем количество уроков
    if (board.lessons.length !== count) {
      if (count > board.lessons.length) {
        const addCount = count - board.lessons.length;
        const maxNum = board.lessons.reduce((m, l) => Math.max(m, l.num || 0), startNum - 1);
        for (let i = 0; i < addCount; i++) {
          board.lessons.push({
            id: 'l_' + Date.now() + '_' + i,
            num: maxNum + 1 + i,
            title: `Урок ${maxNum + 1 + i}`,
            color: 'gray',
            items: templateItems.map(t => ({ id: 'i_' + Math.random().toString(36).substr(2, 6), text: t, done: false }))
          });
        }
      } else {
        board.lessons = board.lessons.slice(0, count);
      }
    }

    // Синхронизируем базовое наполнение со ВСЕМИ уроками (удаляем убранные материалы из уроков везде)
    board.lessons.forEach(l => {
      if (!l.items) l.items = [];
      l.items = l.items.filter(item => !removedItems.some(rem => rem.toLowerCase() === item.text.trim().toLowerCase()));

      templateItems.forEach(newT => {
        const exists = l.items.some(item => item.text.trim().toLowerCase() === newT.toLowerCase());
        if (!exists) {
          l.items.push({ id: 'i_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), text: newT, done: false });
        }
      });
    });

  } else {
    const lessons = Array.from({length: count}, (_, i) => ({
      id: 'l_' + Date.now() + '_' + i,
      num: startNum + i,
      title: `Урок ${startNum + i}`,
      color: 'gray',
      items: templateItems.map(t => ({ id: 'i_' + Math.random().toString(36).substr(2, 6), text: t, done: false }))
    }));

    planningBoards.push({
      id: 'pb_' + Date.now(),
      subject: subject,
      title: title,
      quarter: quarter,
      deadline: deadline,
      baseTemplate: templateItems,
      collapsed: false,
      archived: false,
      lessons: lessons
    });
  }

  saveData();
  closeBoardModal();
  renderPlanning();
}

// Свой тултип для ячеек урока — вместо нативного title="", который иногда
// обрезался краем карточки. Сам следит, чтобы не вылезать за границы окна.
function showPlanCellTooltip(event, text) {
  const tip = document.getElementById('planCellTooltip');
  if (!tip) return;
  tip.textContent = text;
  tip.classList.add('show');

  const cellRect = event.currentTarget.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();

  let left = cellRect.left + cellRect.width / 2 - tipRect.width / 2;
  let top = cellRect.top - tipRect.height - 8;

  // Не даём тултипу вылезти за левый/правый край окна
  const margin = 6;
  if (left < margin) left = margin;
  if (left + tipRect.width > window.innerWidth - margin) left = window.innerWidth - margin - tipRect.width;

  // Если сверху не хватает места (ячейка у самого верха) — показываем тултип снизу от ячейки
  if (top < margin) top = cellRect.bottom + 8;

  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function hidePlanCellTooltip() {
  const tip = document.getElementById('planCellTooltip');
  if (tip) tip.classList.remove('show');
}

function toggleCollapseBoard(bIdx) {
  if (planningBoards[bIdx]) {
    planningBoards[bIdx].collapsed = !planningBoards[bIdx].collapsed;
    saveData();
    // Не перерисовываем всю доску целиком — при полной перерисовке DOM-узел
    // пересоздаётся заново уже в конечном состоянии, и CSS-анимации не из чего играть.
    // Просто переключаем класс на уже существующем элементе — как в карточках заказов.
    const card = document.querySelector(`.plan-class-card[data-board-idx="${bIdx}"]`);
    if (card) card.classList.toggle('collapsed');
  }
}

function updateBoardSubject(bIdx, val) {
  if (planningBoards[bIdx]) {
    planningBoards[bIdx].subject = val.trim();
    saveData();
  }
}

function updateBoardTitle(bIdx, val) {
  if (planningBoards[bIdx]) {
    planningBoards[bIdx].title = val.trim() || 'Без названия';
    saveData();
  }
}

function updateBoardQuarter(bIdx, val) {
  if (planningBoards[bIdx]) {
    planningBoards[bIdx].quarter = val.trim();
    saveData();
  }
}

// Поле "Четверть": во время редактирования принимает только цифру,
// при потере фокуса сама подставляется в формат "N четверть".
function normalizeQuarterInput(el) {
  el.value = el.value.replace(/\D/g, '').slice(0, 1);
  adjustInputWidth(el);
}

function focusQuarterInput(el) {
  // При клике убираем слово "четверть", оставляя только цифру — удобнее менять
  const m = el.value.match(/^(\d+)/);
  el.value = m ? m[1] : el.value.replace(/\D/g, '').slice(0, 1);
  adjustInputWidth(el);
}

function formatQuarterOnBlur(el, bIdx) {
  const digit = el.value.replace(/\D/g, '').slice(0, 1);
  const formatted = digit ? `${digit} четверть` : '';
  el.value = formatted;
  updateBoardQuarter(bIdx, formatted);
  adjustInputWidth(el);
}

function deletePlanningBoard(bIdx) {
  if (confirm(`Удалить "${planningBoards[bIdx].title}" со всеми уроками?`)) {
    planningBoards.splice(bIdx, 1);
    saveData();
    renderPlanning();
  }
}

function addLessonToBoard(bIdx) {
  if (!planningBoards[bIdx]) return;
  const board = planningBoards[bIdx];
  const lessons = board.lessons || [];
  const maxNum = lessons.reduce((m, l) => Math.max(m, l.num || 0), 0);
  const baseItems = (board.baseTemplate && board.baseTemplate.length)
    ? board.baseTemplate.map(t => ({ id: 'i_' + Math.random().toString(36).substr(2, 6), text: t, done: false }))
    : [];

  lessons.push({
    id: 'l_' + Date.now(),
    num: maxNum + 1,
    title: `Урок ${maxNum + 1}`,
    color: 'gray',
    items: baseItems
  });
  saveData();
  renderPlanning();
}

/* УПРАВЛЕНИЕ УРОКОМ В ПОП-АПЕ */
function openLessonModal(bIdx, lIdx) {
  activeLessonState = { bIdx, lIdx };
  const board = planningBoards[bIdx];
  const lesson = board.lessons[lIdx];
  const displayNum = lesson.num ?? (lIdx + 1);

  document.getElementById('lmClassTitle').textContent = `${board.subject ? board.subject + ' · ' : ''}${board.title} ${board.quarter ? '· ' + board.quarter : ''} — Урок ${displayNum}`;
  document.getElementById('lmLessonTitle').value = lesson.title || `Урок ${displayNum}`;
  document.getElementById('lmLessonNumInput').value = displayNum;
  document.getElementById('lmNotes').value = lesson.notes || '';

  updateColorPillButtons(lesson.color || 'gray');
  updateResetColorLockBtn(lesson.colorLocked);
  renderLessonChecklist();

  document.getElementById('lessonModalOverlay').classList.add('show');
}

function updateResetColorLockBtn(isLocked) {
  const btn = document.getElementById('lmResetColorLockBtn');
  if (btn) btn.style.display = isLocked ? 'inline-flex' : 'none';
}

// Снимает принудительный (вручную выбранный) цвет ячейки — дальше он снова считается
// сам, по чек-листу урока или по статусу связанного заказа (как до ручного выбора).
function resetLessonColorLock() {
  const { bIdx, lIdx } = activeLessonState;
  if (bIdx === null || lIdx === null || !planningBoards[bIdx]) return;
  const lesson = planningBoards[bIdx].lessons[lIdx];
  lesson.colorLocked = false;
  syncPlanningWithOrders();
  saveData();
  updateColorPillButtons(lesson.color || 'gray');
  updateResetColorLockBtn(false);
  renderPlanning();
}

function closeLessonModal() {
  document.getElementById('lessonModalOverlay').classList.remove('show');
  activeLessonState = { bIdx: null, lIdx: null };
  renderPlanning();
}

function saveLessonNum(val) {
  const { bIdx, lIdx } = activeLessonState;
  if (bIdx !== null && lIdx !== null && planningBoards[bIdx]) {
    const num = parseInt(val) || 1;
    planningBoards[bIdx].lessons[lIdx].num = num;
    saveData();
  }
}

function updateColorPillButtons(activeColor) {
  ['gray', 'yellow', 'green', 'red'].forEach(c => {
    const btn = document.getElementById(`cpBtn${c.charAt(0).toUpperCase() + c.slice(1)}`);
    if (btn) btn.classList.toggle('active', c === activeColor || (activeColor && activeColor.startsWith('green') && c === 'green'));
  });
}

function setLessonColor(color) {
  const { bIdx, lIdx } = activeLessonState;
  if (bIdx !== null && lIdx !== null && planningBoards[bIdx]) {
    // Ручной выбор цвета — "принудительный" статус, который больше не пересчитывается
    // автоматическим скриптом по проценту выполнения чек-листа.
    planningBoards[bIdx].lessons[lIdx].color = color;
    planningBoards[bIdx].lessons[lIdx].colorLocked = true;
    updateColorPillButtons(color);
    updateResetColorLockBtn(true);
    saveData();
  }
}

function saveLessonTitle(val) {
  const { bIdx, lIdx } = activeLessonState;
  if (bIdx !== null && lIdx !== null && planningBoards[bIdx]) {
    const lesson = planningBoards[bIdx].lessons[lIdx];
    const displayNum = lesson.num ?? (lIdx + 1);
    lesson.title = val.trim() || `Урок ${displayNum}`;
    saveData();
  }
}

function saveLessonNotes(val) {
  const { bIdx, lIdx } = activeLessonState;
  if (bIdx !== null && lIdx !== null && planningBoards[bIdx]) {
    planningBoards[bIdx].lessons[lIdx].notes = val;
    saveData();
  }
}

function renderLessonChecklist() {
  const { bIdx, lIdx } = activeLessonState;
  if (bIdx === null || lIdx === null || !planningBoards[bIdx]) return;

  const lesson = planningBoards[bIdx].lessons[lIdx];
  const items = lesson.items || [];
  const doneCount = items.filter(i => i.done).length;

  document.getElementById('lmProgressBadge').textContent = `${doneCount}/${items.length}`;

  const container = document.getElementById('lmChecklist');
  container.innerHTML = items.map((item, iIdx) => `
    <div class="task-item ${item.done ? 'done' : ''}" style="padding: 6px 10px;">
      <div class="task-left">
        <div class="task-checkbox" onclick="toggleLessonItemDone(${iIdx})">
          ${item.done ? `<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 10l4 4 8-8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
        </div>
        <span class="task-text">${escapeHtml(item.text)}</span>
      </div>
      <button class="task-btn-action del" onclick="deleteLessonItem(${iIdx})">
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16" stroke-linecap="round"/></svg>
      </button>
    </div>
  `).join('') || '<div style="font-size:12px; color:var(--text-faint); padding: 4px 0;">Состав урока пуст</div>';

  // Заполняем список из справочника "Типы работ" — те же значения, что и в позициях заказа
  const catalogList = document.getElementById('lmNewItemCatalogList');
  if (catalogList) {
    const types = appSettings.types || [];
    catalogList.innerHTML = types.length
      ? types.map(t => `<div class="combo-option" onclick="pickLessonItemFromCatalog('${escapeHtml(t)}')">${escapeHtml(t)}</div>`).join('')
        + `<div class="combo-empty" style="display:none;">Ничего не найдено</div>`
      : `<div class="combo-empty">Справочник пуст</div>`;
  }
}

// Клик по варианту из справочника — сразу добавляет позицию в состав урока (не просто заполняет поле)
function pickLessonItemFromCatalog(value) {
  const { bIdx, lIdx } = activeLessonState;
  if (bIdx !== null && lIdx !== null && planningBoards[bIdx]) {
    if (!planningBoards[bIdx].lessons[lIdx].items) planningBoards[bIdx].lessons[lIdx].items = [];
    planningBoards[bIdx].lessons[lIdx].items.push({ id: 'i_' + Date.now(), text: value, done: false });
    saveData();
    closeAllCombos();
    const input = document.getElementById('lmNewItemInput');
    if (input) { input.value = ''; input.focus(); }
    renderLessonChecklist();
  }
}

function handleLessonAddItem(e) {
  if (e.key === 'Enter') {
    const val = e.target.value.trim();
    if (!val) return;
    const { bIdx, lIdx } = activeLessonState;
    if (bIdx !== null && lIdx !== null && planningBoards[bIdx]) {
      if (!planningBoards[bIdx].lessons[lIdx].items) planningBoards[bIdx].lessons[lIdx].items = [];
      planningBoards[bIdx].lessons[lIdx].items.push({
        id: 'i_' + Date.now(),
        text: val,
        done: false
      });
      e.target.value = '';
      saveData();
      renderLessonChecklist();
    }
  }
}

function toggleLessonItemDone(iIdx) {
  const { bIdx, lIdx } = activeLessonState;
  if (bIdx !== null && lIdx !== null && planningBoards[bIdx]) {
    const item = planningBoards[bIdx].lessons[lIdx].items[iIdx];
    if (item) {
      item.done = !item.done;
      saveData();
      renderLessonChecklist();
    }
  }
}

function deleteLessonItem(iIdx) {
  const { bIdx, lIdx } = activeLessonState;
  if (bIdx !== null && lIdx !== null && planningBoards[bIdx]) {
    planningBoards[bIdx].lessons[lIdx].items.splice(iIdx, 1);
    saveData();
    renderLessonChecklist();
  }
}

function deleteCurrentLesson() {
  const { bIdx, lIdx } = activeLessonState;
  if (bIdx !== null && lIdx !== null && planningBoards[bIdx]) {
    if (confirm('Удалить этот урок?')) {
      planningBoards[bIdx].lessons.splice(lIdx, 1);
      saveData();
      closeLessonModal();
    }
  }
}

/* OVERVIEW DASHBOARD & СТАТИСТИКА ПРОИЗВОДСТВА */
