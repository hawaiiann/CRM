/* ============================================================
 * db.js — Хранилище данных: нормализация, загрузка/сохранение в localStorage, импорт/экспорт JSON
 * ============================================================ */

function normalizeOrder(o){
  return {
    id: o.id, title:o.title||'', client:o.client||'', 
    subject: o.subject||'', grade: o.grade||o.class||'',
    quarter: o.quarter || '', lesson: o.lesson||'',
    status:o.status||'queue', isPaid: !!o.isPaid, priority: !!o.priority, 
    advanceUsed: parseNum(o.advanceUsed || o.advance || 0),
    taxType: o.taxType||'none',
    start:o.start||dateKey(new Date()), deadline:o.deadline||dateKey(addDays(new Date(),7)), 
    estimatedHours: o.estimatedHours ?? '', actualHours: o.actualHours ?? '',
    lines: (o.lines && o.lines.length) ? o.lines.map(l => ({
      id: l.id || ('l'+Math.random().toString(36).substr(2,9)),
      label: l.label || (getVisibleCatalog('types')[0] || 'Презентация'),
      type: l.type || getVisibleCatalog('units')[0] || 'Слайд',
      qty: l.qty ?? 1,
      pomoHours: l.pomoHours ?? 0,
      rate: l.rate ?? 0,
      ignorePrice: !!l.ignorePrice,
      ready: !!l.ready
    })) : [{id:'l0',label: getVisibleCatalog('types')[0] || 'Презентация',type:getVisibleCatalog('units')[0] || 'Слайд',qty:10,pomoHours:0,rate:500,ignorePrice:false,ready:false}],
    notes:o.notes||'', createdAt:o.createdAt||Date.now(),
    linkedLessonId: o.linkedLessonId || null
  };
}

function normalizeTask(t) {
  return {
    id: t.id || ('t' + Math.random().toString(36).substr(2, 9)),
    text: t.text || '',
    time: t.time || '',
    done: !!t.done,
    period: t.period || 'today',
    createdAt: t.createdAt || ''
  };
}

function normalizeAdvance(a) {
  return {
    id: a.id || ('adv' + Math.random().toString(36).substr(2,9)),
    client: a.client || '',
    amount: parseNum(a.amount || 0),
    date: a.date || dateKey(new Date()),
    note: a.note || ''
  };
}

function getOrderDisplayHours(o) {
  let manualAct = parseNum(o.actualHours);
  let pomoSum = (o.lines || []).reduce((s, l) => s + parseHours(l.pomoHours), 0);
  if (manualAct > 0) return manualAct;
  if (pomoSum > 0) return pomoSum;
  return parseNum(o.estimatedHours) || 0;
}

// Сравнивает старую и новую версии заказа и записывает в журнал активности
// только РАЗНИЦУ (дельту) по часам/слайдам/страницам/выручке, с сегодняшней датой.
function recordActivityChanges(oldOrder, newOrder, onDate) {
  const today = onDate || dateKey(new Date());

  const oldHours = oldOrder ? getOrderDisplayHours(oldOrder) : 0;
  const newHours = getOrderDisplayHours(newOrder);
  const hoursDelta = newHours - oldHours;

  const oldUnits = splitLineUnits(oldOrder ? oldOrder.lines : []);
  const newUnits = splitLineUnits(newOrder.lines);
  const slidesDelta = newUnits.slides - oldUnits.slides;
  const pagesDelta = newUnits.pages - oldUnits.pages;

  const oldTypes = splitLineTypes(oldOrder ? oldOrder.lines : []);
  const newTypes = splitLineTypes(newOrder.lines);
  const presentationsDelta = newTypes.presentations - oldTypes.presentations;
  const worksheetsDelta = newTypes.worksheets - oldTypes.worksheets;

  const oldRec = oldOrder ? orderRecognizedRevenue(oldOrder) : { revenue: 0, net: 0 };
  const newRec = orderRecognizedRevenue(newOrder);
  const revenueDelta = newRec.revenue - oldRec.revenue;
  const netDelta = newRec.net - oldRec.net;

  if (hoursDelta) activityLog.push({ date: today, orderId: newOrder.id, field: 'hours', delta: hoursDelta });
  if (slidesDelta) activityLog.push({ date: today, orderId: newOrder.id, field: 'slides', delta: slidesDelta });
  if (pagesDelta) activityLog.push({ date: today, orderId: newOrder.id, field: 'pages', delta: pagesDelta });
  if (presentationsDelta) activityLog.push({ date: today, orderId: newOrder.id, field: 'presentations', delta: presentationsDelta });
  if (worksheetsDelta) activityLog.push({ date: today, orderId: newOrder.id, field: 'worksheets', delta: worksheetsDelta });
  if (revenueDelta) activityLog.push({ date: today, orderId: newOrder.id, field: 'revenue', delta: revenueDelta });
  if (netDelta) activityLog.push({ date: today, orderId: newOrder.id, field: 'netRevenue', delta: netDelta });
}

/* Data Loading & Saving */
function loadData(){
  try{
    const rawS = localStorage.getItem(SETTINGS_KEY);
    if(rawS) {
      const parsed = JSON.parse(rawS);
      appSettings = { ...appSettings, ...parsed };
      if(!appSettings.clients) appSettings.clients = ['Школа №1', 'Издательство "Просвещение"', 'Частный заказчик'];
      if(!appSettings.types) appSettings.types = ['Презентация', 'Рабочий лист', 'Карточка'];
      if(!appSettings.units) appSettings.units = ['Слайд', 'Страница', 'Урок', 'Час', 'Другое'];
      if(!appSettings.dashboardMetrics) appSettings.dashboardMetrics = [
        { id: 'dm1', type: 'hours', goal: 4 },
        { id: 'dm2', type: 'presentations', goal: 0 },
        { id: 'dm3', type: 'worksheets', goal: 0 },
        { id: 'dm4', type: 'revenue', goal: 4000 }
      ];
      if(!appSettings.subjects) appSettings.subjects = ['Математика', 'Русский язык', 'Литература', 'Дизайн'];
      if(!appSettings.classes) appSettings.classes = ['5 класс', '6 класс', '7 класс', 'Без класса'];
      if(!appSettings.hiddenEntries) appSettings.hiddenEntries = { clients: [], types: [], units: [], subjects: [], classes: [] };
      ['clients','types','units','subjects','classes'].forEach(k => { if (!appSettings.hiddenEntries[k]) appSettings.hiddenEntries[k] = []; });

      // Миграция: "Слайды" и "Чистый доход" стали доп. показателями внутри "Презентации"
      // и "Доход" (двойные графики) — старые отдельные плитки таких типов больше не существуют
      // как самостоятельный выбор, переносим их на объединяющую метрику (без дублей).
      const metricRemap = { slides: 'presentations', netIncome: 'revenue' };
      const seenMetricTypes = new Set();
      appSettings.dashboardMetrics = appSettings.dashboardMetrics
        .map(m => metricRemap[m.type] ? { ...m, type: metricRemap[m.type] } : m)
        .filter(m => {
          if (seenMetricTypes.has(m.type)) return false;
          seenMetricTypes.add(m.type);
          return true;
        });
    }
    
    const raw = localStorage.getItem(STORAGE_KEY);
    orders = raw ? JSON.parse(raw).map(normalizeOrder) : [];

    const rawT = localStorage.getItem(TASKS_KEY);
    if (rawT) appTasks = JSON.parse(rawT).map(normalizeTask);

    const rawAdv = localStorage.getItem(ADVANCES_KEY);
    if (rawAdv) advances = JSON.parse(rawAdv).map(normalizeAdvance);

    const rawP = localStorage.getItem(PLANNING_KEY);
    if (rawP) {
      planningBoards = JSON.parse(rawP);
      // Подстраховка для старых данных без id (нужен для явной привязки заказа к уроку)
      planningBoards.forEach(board => {
        if (!board.id) board.id = 'pb_' + Date.now() + Math.random().toString(36).slice(2, 7);
        (board.lessons || []).forEach(lesson => {
          if (!lesson.id) lesson.id = 'l_' + Date.now() + Math.random().toString(36).slice(2, 7);
        });
      });
    } else {
      planningBoards = [
        {
          id: 'pb_1',
          subject: 'Математика',
          title: '5 класс',
          quarter: '1 четверть',
          deadline: '2026-09-01',
          baseTemplate: ['Презентация', 'Рабочий лист'],
          collapsed: false,
          archived: false,
          lessons: Array.from({length: 24}, (_, i) => ({
            id: 'l_' + (i + 1),
            num: i + 1,
            title: `Урок ${i + 1}`,
            color: 'gray',
            items: [
              { id: 'i1', text: 'Презентация', done: false },
              { id: 'i2', text: 'Рабочий лист', done: false }
            ]
          }))
        },
        {
          id: 'pb_2',
          subject: 'Русский язык',
          title: '6 класс',
          quarter: '1 четверть',
          deadline: '2026-10-15',
          baseTemplate: ['Презентация', 'Рабочий лист'],
          collapsed: false,
          archived: false,
          lessons: Array.from({length: 24}, (_, i) => ({
            id: 'l_' + (i + 1),
            num: i + 1,
            title: `Урок ${i + 1}`,
            color: 'gray',
            items: []
          }))
        }
      ];
    }

    const rawBcfg = localStorage.getItem(BACKUP_CFG_KEY);
    if (rawBcfg) backupSettings = { ...backupSettings, ...JSON.parse(rawBcfg) };

    const rawLog = localStorage.getItem(ACTIVITY_LOG_KEY);
    if (rawLog) {
      activityLog = JSON.parse(rawLog);
    } else {
      // Журнал ещё ни разу не создавался — считаем текущие часы/слайды/страницы
      // по всем заказам "внесёнными сегодня", чтобы статистика не начиналась с пустоты.
      activityLog = [];
      const seedToday = dateKey(new Date());
      orders.forEach(o => {
        recordActivityChanges(null, o, seedToday);
      });
      localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(activityLog));
    }

    // Отдельная разовая довставка: если журнал уже существовал (создан до того,
    // как в него добавили учёт выручки), но в нём совсем нет записей о выручке —
    // досчитываем текущую признанную выручку по всем заказам, тоже сегодняшним днём.
    if (activityLog.length && !activityLog.some(e => e.field === 'revenue')) {
      const seedToday = dateKey(new Date());
      orders.forEach(o => {
        const rec = orderRecognizedRevenue(o);
        if (rec.revenue) activityLog.push({ date: seedToday, orderId: o.id, field: 'revenue', delta: rec.revenue });
        if (rec.net) activityLog.push({ date: seedToday, orderId: o.id, field: 'netRevenue', delta: rec.net });
      });
      localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(activityLog));
    }

    syncPlanningWithOrders();

  }catch(e){ console.error(e); orders=[]; appTasks=[]; advances=[]; planningBoards=[]; activityLog=[]; }
}

function saveData(isAutoBackupTrigger = true){
  syncPlanningWithOrders();

  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings));
  localStorage.setItem(TASKS_KEY, JSON.stringify(appTasks));
  localStorage.setItem(ADVANCES_KEY, JSON.stringify(advances));
  localStorage.setItem(PLANNING_KEY, JSON.stringify(planningBoards));
  localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(activityLog));

  if (isAutoBackupTrigger && backupSettings.enabled && backupSettings.interval === 'change') {
    triggerAutoBackupProcess();
  }
}

// Находит заказ, который сейчас управляет цветом конкретного урока — та же логика поиска,
// что и в syncPlanningWithOrders(), но возвращает сам заказ (а не только красит ячейку).
// Нужна для подсказки в модалке урока: "почему цвет именно такой".
function findGoverningOrder(board, lesson) {
  if (!orders) return null;

  const explicit = orders.find(o => o.status !== 'cancelled' && o.linkedLessonId === lesson.id);
  if (explicit) return explicit;

  const boardTitle = (board.title || '').trim().toLowerCase();
  const boardSubject = (board.subject || '').trim().toLowerCase();
  const boardQuarter = (board.quarter || '').trim().toLowerCase();

  return orders.find(o => {
    if (o.status === 'cancelled') return false;
    if (o.linkedLessonId) return false; // у этого заказа своя явная привязка — не к этому уроку, раз explicit не нашёлся
    if (!o.grade || !o.lesson) return false;
    const lessonNumMatch = String(o.lesson).match(/\d+/);
    if (!lessonNumMatch || parseInt(lessonNumMatch[0], 10) !== lesson.num) return false;

    const orderGrade = (o.grade || '').trim().toLowerCase();
    const orderSubject = (o.subject || '').trim().toLowerCase();
    const orderQuarter = (o.quarter || '').trim().toLowerCase();

    const isGradeMatch = boardTitle === orderGrade || boardTitle.includes(orderGrade) || orderGrade.includes(boardTitle);
    const isSubjectMatch = !boardSubject || !orderSubject || boardSubject === orderSubject || boardSubject.includes(orderSubject) || orderSubject.includes(boardSubject);
    const isQuarterMatch = !boardQuarter || !orderQuarter || boardQuarter === orderQuarter || boardQuarter.includes(orderQuarter) || orderQuarter.includes(boardQuarter);

    return isGradeMatch && isSubjectMatch && isQuarterMatch;
  }) || null;
}

/* АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ ЗАКАЗОВ И ПЛАНИРОВАНИЯ */
function syncPlanningWithOrders() {
  if (!orders || !planningBoards) return;

  const lessonsSyncedByOrder = new Set(); // уроки, чей цвет уже выставлен по статусу заказа — их не трогает пересчёт по чек-листу

  // Сбрасываем метку "привязан к заказу" у всех уроков — расставим заново по актуальным заказам ниже.
  // Иначе урок, у которого заказ удалили/переименовали, так и остался бы "занят" навсегда.
  planningBoards.forEach(board => {
    (board.lessons || []).forEach(lesson => { lesson.orderLinked = false; });
  });

  // Применяет статус/наполнение заказа к конкретному, уже найденному уроку —
  // общая часть для явной привязки (linkedLessonId) и для нечёткого поиска по тексту ниже.
  function applyOrderToLesson(o, lesson, lessonsSyncedByOrder) {
    if (!lesson.items) lesson.items = [];

    // Чекбокс "Готов" у позиции заказа сразу отражается в чек-листе урока — не нужно
    // ждать, пока весь заказ станет "Завершён". Работает в обе стороны по мере
    // отметки позиций, при любом сохранении заказа (toggleLineReady тоже вызывает saveData).
    (o.lines || []).forEach(line => {
      const lineLabel = line.label || line.type || 'Работа';
      if (!lineLabel.trim()) return;
      let item = lesson.items.find(i => i.text.toLowerCase() === lineLabel.toLowerCase());
      if (!item) {
        item = { id: 'i_' + Date.now() + Math.random().toString(36).substr(2, 5), text: lineLabel, done: false, fromOrder: true };
        lesson.items.push(item);
      }
      item.done = !!line.ready;
    });

    // Позицию удалили из заказа — убираем и пункт чек-листа, но только если он сам
    // когда-то появился ИЗ позиции заказа (fromOrder). Пункты базового наполнения
    // класса (заданы в шаблоне доски заранее, до заказа) трогать нельзя — они законно
    // остаются "незакрытыми", пока по ним вообще не появится заказ (см. комментарий ниже).
    const currentLineLabels = new Set((o.lines || []).map(l => (l.label || l.type || 'Работа').trim().toLowerCase()).filter(Boolean));
    lesson.items = lesson.items.filter(item => !item.fromOrder || currentLineLabels.has(item.text.trim().toLowerCase()));

    // Заказ завершён целиком (в т.ч. если статус переключили вручную, минуя чекбоксы
    // "Готов" по каждой позиции) — подчищаем как завершённые все пункты, что совпадают
    // с позициями этого заказа, даже если конкретный line.ready почему-то не стоял.
    if (o.status === 'done') {
      (o.lines || []).forEach(line => {
        const lineLabel = line.label || line.type || 'Работа';
        let item = lesson.items.find(i => i.text.toLowerCase() === lineLabel.toLowerCase());
        if (item) item.done = true;
      });
    }

    // Ручной ("принудительный") выбор цвета — если он стоит, статус заказа цвет ячейки
    // не трогает (но чек-лист выше синхронизируется в любом случае).
    if (!lesson.colorLocked) {
      if (o.status === 'done') {
        // У урока в чек-листе могли быть пункты, которых в этом заказе просто не было
        // (другие позиции по базовому наполнению класса) — они остались незакрытыми.
        // Цвет должен отражать реальную долю закрытых пунктов, а не всегда быть "готово".
        const totalInL = lesson.items.length;
        const doneInL = lesson.items.filter(i => i.done).length;
        if (totalInL === 0 || doneInL === 0) {
          lesson.color = 'gray';
        } else {
          const ratio = doneInL / totalInL;
          lesson.color = ratio >= 0.99 ? 'green-3' : (ratio >= 0.5 ? 'green-2' : 'green-1');
        }
        lessonsSyncedByOrder.add(lesson);
        lesson.orderLinked = true;
      } else if (['progress', 'review'].includes(o.status)) {
        // Реально идёт работа — "В работе"
        lesson.color = 'yellow';
        lessonsSyncedByOrder.add(lesson);
        lesson.orderLinked = true;
      } else if (o.status === 'queue') {
        // Заказ ещё не взят в работу — "Неактив", а не "В работе"
        lesson.color = 'gray';
        lessonsSyncedByOrder.add(lesson);
        lesson.orderLinked = true;
      }
    }
  }

  orders.forEach(o => {
    if (o.status === 'cancelled') return;

    // Явная привязка (выбрана в форме заказа) — надёжнее нечёткого совпадения по тексту,
    // не ломается при малейшем расхождении в написании класса/предмета/четверти.
    if (o.linkedLessonId) {
      let linkedLesson = null;
      for (const board of planningBoards) {
        linkedLesson = (board.lessons || []).find(l => l.id === o.linkedLessonId);
        if (linkedLesson) break;
      }
      if (linkedLesson) {
        applyOrderToLesson(o, linkedLesson, lessonsSyncedByOrder);
        return; // урок найден явно — нечёткий поиск по тексту не нужен
      }
      // привязанный урок не найден (удалён) — падаем в нечёткий поиск по тексту как раньше
    }

    if (!o.grade || !o.lesson) return;

    const orderGrade = (o.grade || '').trim().toLowerCase();
    const orderSubject = (o.subject || '').trim().toLowerCase();
    const orderQuarter = (o.quarter || '').trim().toLowerCase();

    const lessonNumMatch = String(o.lesson).match(/\d+/);
    if (!lessonNumMatch) return;
    const orderLessonNum = parseInt(lessonNumMatch[0], 10);

    planningBoards.forEach(board => {
      const boardTitle = (board.title || '').trim().toLowerCase();
      const boardSubject = (board.subject || '').trim().toLowerCase();
      const boardQuarter = (board.quarter || '').trim().toLowerCase();

      const isGradeMatch = boardTitle === orderGrade || boardTitle.includes(orderGrade) || orderGrade.includes(boardTitle);
      const isSubjectMatch = !boardSubject || !orderSubject || boardSubject === orderSubject || boardSubject.includes(orderSubject) || orderSubject.includes(boardSubject);
      const isQuarterMatch = !boardQuarter || !orderQuarter || boardQuarter === orderQuarter || boardQuarter.includes(orderQuarter) || orderQuarter.includes(boardQuarter);

      if (isGradeMatch && isSubjectMatch && isQuarterMatch) {
        let lesson = (board.lessons || []).find(l => l.num === orderLessonNum);
        if (lesson) {
          applyOrderToLesson(o, lesson, lessonsSyncedByOrder);
        }
      }
    });
  });

  // Расчет цвета ячейки по уровню закрытия галочек — но только для уроков, у которых
  // цвет не выбран вручную И не выставлен только что по статусу связанного заказа
  planningBoards.forEach(board => {
    (board.lessons || []).forEach(lesson => {
      if (lesson.colorLocked) return; // ручной выбор — ничего не пересчитываем
      if (lessonsSyncedByOrder.has(lesson)) return; // цвет уже выставлен по статусу заказа — не перезаписываем

      const items = lesson.items || [];
      const totalInL = items.length;
      const doneInL = items.filter(i => i.done).length;

      if (totalInL === 0 || doneInL === 0) {
        lesson.color = 'gray';
      } else {
        const ratio = doneInL / totalInL;
        if (ratio >= 0.99) {
          lesson.color = 'green-3';
        } else if (ratio >= 0.5) {
          lesson.color = 'green-2';
        } else {
          lesson.color = 'green-1';
        }
      }
    });
  });
}

/* View Switch */
document.getElementById('btnExport').addEventListener('click', ()=>{
  const backupData = {
    orders: orders,
    settings: appSettings,
    tasks: appTasks,
    advances: advances,
    planning: planningBoards,
    activityLog: activityLog
  };
  const blob = new Blob([JSON.stringify(backupData, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'crm-backup-'+dateKey(new Date())+'.json';
  a.click(); URL.revokeObjectURL(url);
});

document.getElementById('btnImport').addEventListener('click', ()=>document.getElementById('fileInput').click());
document.getElementById('fileInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (evt)=>{
    try{
      const parsed = JSON.parse(evt.target.result);
      if (Array.isArray(parsed)) {
        orders = parsed.map(normalizeOrder);
      } else if (parsed && typeof parsed === 'object') {
        if (parsed.orders && Array.isArray(parsed.orders)) orders = parsed.orders.map(normalizeOrder);
        if (parsed.settings && typeof parsed.settings === 'object') appSettings = { ...appSettings, ...parsed.settings };
        if (parsed.tasks && Array.isArray(parsed.tasks)) appTasks = parsed.tasks.map(normalizeTask);
        if (parsed.advances && Array.isArray(parsed.advances)) advances = parsed.advances.map(normalizeAdvance);
        if (parsed.planning && Array.isArray(parsed.planning)) planningBoards = parsed.planning;
        if (parsed.activityLog && Array.isArray(parsed.activityLog)) activityLog = parsed.activityLog;
      }
      saveData();
      fillSelects();
      renderSettings();
      renderCurrent();
    }catch(err){ console.error(err); }
  };
  reader.readAsText(file);
  e.target.value='';
});

/* PERIODIC AUTO BACKUP TIMER */
setInterval(() => {
  if (!backupSettings.enabled) return;
  const intervalMap = {
    '1h': 3600000,
    '6h': 21600000,
    '24h': 86400000,
    '7d': 604800000
  };
  const periodMs = intervalMap[backupSettings.interval];
  if (periodMs) {
    const last = backupSettings.lastBackup || 0;
    if (Date.now() - last >= periodMs) {
      triggerAutoBackupProcess();
    }
  }
}, 60000);
