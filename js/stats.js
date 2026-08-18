/* ============================================================
 * stats.js — расчёт показателей Дашборда НАПРЯМУЮ из заказов и авансов.
 *
 * Зачем. Сейчас одни и те же числа считаются двумя способами: Финансы берут их из
 * заказов, а Дашборд — из журнала событий activityLog. Два источника правды весь
 * день расходились, и лечилось это кнопкой пересчёта, которая переписывала журнал.
 *
 * Но выручка и количества материалов ПОЛНОСТЬЮ выводятся из заказов и реестра авансов —
 * журнал для них не нужен. Здесь эти функции и живут: чистые, без обращения к глобальному
 * состоянию и без побочных эффектов, поэтому их можно проверять тестами (см. tests.html).
 *
 * Журнал остаётся нужен ТОЛЬКО для часов: их пишет таймер по ходу работы, и восстановить
 * из текущего состояния заказов невозможно — это настоящий временной ряд.
 * ============================================================ */

/* ---------- События (что, когда и сколько) ---------- */

// Дата аванса клиента — момент, когда деньги реально поступили.
// Берём самый ранний аванс: он и открыл клиенту баланс, из которого списывают заказы.
function advanceDateForClient(advancesList, client) {
  const list = (advancesList || [])
    .filter(a => a.client === client && a.date)
    .sort((a, b) => a.date < b.date ? -1 : 1);
  return list.length ? list[0].date : null;
}

// Дата, к которой относим "материалы заказа существуют" — своя дата заказа,
// а не день, когда его завели в систему.
function orderContributionDate(o) {
  return o.start || o.deadline || (o.createdAt ? dateKey(new Date(o.createdAt)) : dateKey(new Date()));
}

// Поступления денег по заказу: часть по авансу — датой аванса, доплата — датой оплаты.
// Ровно то же правило, что и в orderRecognizedRevenue, только разложенное по датам.
function revenueEventsForOrder(o, advancesList) {
  const events = [];
  const fullExact = orderTotal(o);
  const full = Math.round(fullExact);
  const base = orderBaseTotal(o);
  if (full <= 0) return events;

  const advUsed = Math.min(parseNum(o.advanceUsed), full);
  const netForAdvance = fullExact > 0 ? advUsed * (base / fullExact) : 0;
  if (advUsed > 0) {
    events.push({
      date: advanceDateForClient(advancesList, o.client) || orderContributionDate(o),
      orderId: o.id,
      revenue: Math.round(advUsed * 100) / 100,
      net: Math.round(netForAdvance * 100) / 100
    });
  }

  const paidMoney = Math.min(parseNum(o.paidAmount), Math.max(0, full - advUsed));
  if (paidMoney > 0) {
    const netForMoney = fullExact > 0 ? paidMoney * (base / fullExact) : 0;
    events.push({
      date: o.paidAt || o.deadline || orderContributionDate(o),
      orderId: o.id,
      revenue: Math.round(paidMoney * 100) / 100,
      net: Math.round(netForMoney * 100) / 100
    });
  }
  return events;
}

function revenueEvents(ordersList, advancesList) {
  const all = [];
  (ordersList || []).forEach(o => {
    revenueEventsForOrder(o, advancesList).forEach(e => all.push(e));
  });
  return all;
}

// Вклад заказа в счётчики материалов, отнесённый к дате заказа.
function countEvents(ordersList) {
  return (ordersList || []).map(o => {
    const types = splitLineTypes(o.lines);
    const units = splitLineUnits(o.lines);
    return {
      date: orderContributionDate(o),
      orderId: o.id,
      presentations: types.presentations,
      worksheets: types.worksheets,
      slides: units.slides,
      pages: units.pages
    };
  });
}

/* ---------- Раскладка событий по корзинам периода ---------- */

// Какие поля откуда берутся. hours сознательно отсутствует — он остаётся в журнале.
const DERIVED_METRIC_SOURCES = {
  revenue:       { from: 'revenue', field: 'revenue', cumulative: false },
  netRevenue:    { from: 'revenue', field: 'net',     cumulative: false },
  presentations: { from: 'counts',  field: 'presentations', cumulative: true },
  worksheets:    { from: 'counts',  field: 'worksheets',    cumulative: true },
  slides:        { from: 'counts',  field: 'slides',        cumulative: true },
  pages:         { from: 'counts',  field: 'pages',         cumulative: true }
};

function isDerivedMetric(metricField) {
  return Object.prototype.hasOwnProperty.call(DERIVED_METRIC_SOURCES, metricField);
}

// Возвращает массив значений по корзинам периода — той же формы, что и
// getMetricSeriesForPeriod, чтобы график можно было переключить без правок отрисовки.
// ranges — границы корзин (см. getPeriodBucketRanges), передаём явно, чтобы функция
// оставалась чистой и проверяемой.
function computeDerivedSeries(metricField, ranges, ordersList, advancesList) {
  const src = DERIVED_METRIC_SOURCES[metricField];
  if (!src) return ranges.map(() => 0);

  const events = src.from === 'revenue'
    ? revenueEvents(ordersList, advancesList)
    : countEvents(ordersList);

  const bucketKeys = ranges.map(r => ({ start: dateKey(r.start), end: dateKey(r.end) }));
  const buckets = ranges.map(() => 0);

  // Накопительные показатели считают "сколько существует на конец корзины", поэтому
  // всё, что случилось ДО первой корзины, должно войти в стартовый остаток.
  let carriedOver = 0;

  events.forEach(e => {
    const value = e[src.field] || 0;
    if (!value) return;
    if (src.cumulative && e.date < bucketKeys[0].start) { carriedOver += value; return; }
    for (let i = 0; i < bucketKeys.length; i++) {
      if (e.date >= bucketKeys[i].start && e.date <= bucketKeys[i].end) { buckets[i] += value; break; }
    }
  });

  if (!src.cumulative) return buckets.map(v => Math.round(v * 100) / 100);

  let running = carriedOver;
  return buckets.map(v => {
    running += v;
    return Math.round(running * 100) / 100;
  });
}

/* ---------- Итоги "на сейчас" (для сверки со старым расчётом) ---------- */

function derivedTotals(ordersList, advancesList) {
  const totals = { revenue: 0, netRevenue: 0, presentations: 0, worksheets: 0, slides: 0, pages: 0 };
  revenueEvents(ordersList, advancesList).forEach(e => {
    totals.revenue += e.revenue;
    totals.netRevenue += e.net;
  });
  countEvents(ordersList).forEach(e => {
    totals.presentations += e.presentations;
    totals.worksheets += e.worksheets;
    totals.slides += e.slides;
    totals.pages += e.pages;
  });
  Object.keys(totals).forEach(k => { totals[k] = Math.round(totals[k] * 100) / 100; });
  return totals;
}
