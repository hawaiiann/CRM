/* ============================================================
 * utils.js — Общие утилиты: тема оформления, форматирование денег/дат/часов, расчёт сумм по позициям заказа
 * ============================================================ */

const THEME_KEY = 'design_crm_theme'; // объявлено здесь, а не в app.js — используется сразу же ниже, до загрузки app.js

function setTheme(mode) {
  if (mode === 'dark') {
    document.body.classList.add('dark-theme');
    localStorage.setItem(THEME_KEY, 'dark');
    document.getElementById('btnThemeDark').classList.add('active');
    document.getElementById('btnThemeLight').classList.remove('active');
  } else {
    document.body.classList.remove('dark-theme');
    localStorage.setItem(THEME_KEY, 'light');
    document.getElementById('btnThemeLight').classList.add('active');
    document.getElementById('btnThemeDark').classList.remove('active');
  }
}

if(localStorage.getItem(THEME_KEY)==='dark'){ setTheme('dark'); } else { setTheme('light'); }

/* Dynamic Select Width Helper for Status Badges */
function adjustSelectWidth(el) {
  if (!el) return;
  let span = document.getElementById('text-measure-span');
  if (!span) {
    span = document.createElement('span');
    span.id = 'text-measure-span';
    span.style.visibility = 'hidden';
    span.style.position = 'absolute';
    span.style.whiteSpace = 'nowrap';
    document.body.appendChild(span);
  }
  const selText = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : el.value;
  const cs = window.getComputedStyle(el);
  span.style.fontSize = cs.fontSize;
  span.style.fontWeight = cs.fontWeight;
  span.style.fontFamily = cs.fontFamily;
  span.textContent = selText;
  const textWidth = span.getBoundingClientRect().width;
  // Запас считаем по РЕАЛЬНЫМ отступам самого элемента (padding + border),
  // а не по фиксированному числу — иначе у select с нестандартным padding текст обрезается.
  const horizontalChrome = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  const buffer = horizontalChrome > 0 ? horizontalChrome + 4 : 28;
  el.style.width = (textWidth + buffer) + 'px';
}

function adjustAllBadgeSelects() {
  document.querySelectorAll('select.badge').forEach(adjustSelectWidth);
}

/* Helper for adaptive text input width */
function adjustInputWidth(el) {
  if (!el) return;
  let span = document.getElementById('input-measure-span');
  if (!span) {
    span = document.createElement('span');
    span.id = 'input-measure-span';
    span.style.visibility = 'hidden';
    span.style.position = 'absolute';
    span.style.whiteSpace = 'pre';
    document.body.appendChild(span);
  }
  const cs = window.getComputedStyle(el);
  span.style.fontSize = cs.fontSize;
  span.style.fontWeight = cs.fontWeight;
  span.style.fontFamily = cs.fontFamily;
  span.textContent = el.value || el.placeholder || ' ';
  const textWidth = span.getBoundingClientRect().width;
  el.style.width = (textWidth + 16) + 'px';
}

function adjustAllAdaptiveInputs() {
  document.querySelectorAll('.plan-class-quarter').forEach(adjustInputWidth);
}

/* Format Deadline Date Helper */
function fmtDeadline(dStr) {
  if (!dStr) return '—';
  const parts = dStr.split('-').map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return dStr;
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const day = String(parts[2]).padStart(2, '0');
  const month = months[parts[1] - 1] || parts[1];
  const year = parts[0];
  return `${day} ${month} ${year} г.`;
}

// Компактный диапазон дат для узких карточек — "1–6 авг 2026", без "г." и без дублирования года/месяца
function fmtDateRangeCompact(startStr, endStr) {
  if (!startStr || !endStr) return `${fmtDeadline(startStr)} — ${fmtDeadline(endStr)}`.replace(/ г\./g, '');
  const s = startStr.split('-').map(Number);
  const e = endStr.split('-').map(Number);
  if (s.length < 3 || e.length < 3 || s.some(isNaN) || e.some(isNaN)) return `${startStr} — ${endStr}`;
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const [sy, sm, sd] = s, [ey, em, ed] = e;
  if (sy === ey && sm === em) return `${sd}–${ed} ${months[em - 1]} ${ey}`;
  if (sy === ey) return `${sd} ${months[sm - 1]} – ${ed} ${months[em - 1]} ${ey}`;
  return `${sd} ${months[sm - 1]} ${sy} – ${ed} ${months[em - 1]} ${ey}`;
}

/* Helpers */
function parseNum(v){ const n = parseFloat(String(v||'').replace(',','.').replace(/[^\d.-]/g,'')); return isNaN(n) ? 0 : n; }
function fmtMoney(n){ return new Intl.NumberFormat('ru-RU').format(Math.round(n||0)) + ' ₽'; }
function dateKey(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function addDays(d,n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
// Просрочен — дедлайн уже прошёл, а заказ не завершён и не отменён
function isOrderOverdue(o){ return !!(o.deadline && o.deadline < dateKey(new Date()) && !['done','cancelled'].includes(o.status)); }

// Справочник без скрытых глазком позиций — для выпадающих списков/автокомплитов при
// выборе НОВОГО значения. Уже проставленные старые значения (в заказах/уроках) — просто
// текст, скрытие каталога на них не влияет.
function getVisibleCatalog(key) {
  const list = appSettings[key] || [];
  const hidden = (appSettings.hiddenEntries && appSettings.hiddenEntries[key]) || [];
  return list.filter(v => !hidden.includes(v));
}

// Как getVisibleCatalog, но гарантированно включает текущее значение поля, даже если
// оно скрыто — иначе выпадающий список молча "потерял" бы уже выбранное значение.
function catalogWithCurrent(key, current) {
  const visible = getVisibleCatalog(key);
  if (current && !visible.includes(current)) return [...visible, current];
  return visible;
}
// Разница в днях между двумя датами-строками "YYYY-MM-DD" (b - a)
function dateDiffDays(aStr, bStr){
  const a = parseLocalDate(aStr), b = parseLocalDate(bStr);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86400000);
}
function daysBetween(a,b){ return Math.round((new Date(b)-new Date(a))/86400000); }
function parseLocalDate(str){
  if(!str) return null;
  const parts = String(str).split('-').map(Number);
  if(parts.length < 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1]-1, parts[2]);
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function fmtHours(h) {
  const num = parseNum(h);
  if (num === 0) return '0 ч 0 мин';
  const hrs = Math.floor(num);
  const mins = Math.round((num - hrs) * 60);
  if (hrs === 0) return `${mins} мин`;
  if (mins === 0) return `${hrs} ч 0 мин`;
  return `${hrs} ч ${mins} мин`;
}

function isHourlyUnit(l){ return (l.type||'').toLowerCase().includes('час'); }

// Понимает часы в формате "1.5", "1,5", "1:30" и "1ч 30м" — везде возвращает десятичные часы.
function parseHours(v){
  const s = String(v||'').trim().toLowerCase();
  if (!s) return 0;
  if (s.includes(':')) {
    const [h, m] = s.split(':');
    return (parseNum(h)) + (parseNum(m)) / 60;
  }
  if (s.includes('ч') || s.includes('м')) {
    const hMatch = s.match(/(\d+[.,]?\d*)\s*ч/);
    const mMatch = s.match(/(\d+[.,]?\d*)\s*м/);
    const h = hMatch ? parseNum(hMatch[1]) : 0;
    const m = mMatch ? parseNum(mMatch[1]) : 0;
    return h + m / 60;
  }
  return parseNum(s);
}

// Раскладывает позиции заказа на "слайды" и "страницы" по единице измерения (l.type)
function splitLineUnits(lines) {
  let slides = 0, pages = 0;
  (lines || []).forEach(l => {
    const unit = (l.type || '').toLowerCase();
    const qty = parseNum(l.qty);
    if (unit.includes('слайд')) slides += qty;
    else if (unit.includes('лист') || unit.includes('страниц')) pages += qty;
  });
  return { slides, pages };
}

// Считает КОЛИЧЕСТВО позиций (не сумму qty) по типу работы — для показателей
// "Презентации" и "Рабочие листы" на дашборде (отдельно от штук слайдов/страниц).
// Карточки с вопросами по сути тот же класс материала, что и рабочий лист — считаются вместе.
function splitLineTypes(lines) {
  let presentations = 0, worksheets = 0;
  (lines || []).forEach(l => {
    const label = (l.label || '').toLowerCase();
    if (label.includes('презентац')) presentations++;
    else if (label.includes('рабочий лист') || label.includes('карточ')) worksheets++;
  });
  return { presentations, worksheets };
}

function calculateLineTotal(l) {
  if (l.ignorePrice) return 0;
  if (isHourlyUnit(l)) return parseHours(l.pomoHours) * parseNum(l.rate);
  return parseNum(l.qty) * parseNum(l.rate);
}

function orderBaseTotal(o){
  return (o.lines||[]).reduce((s,l)=> s + calculateLineTotal(l), 0);
}

function orderTaxRate(o){
  if(o && o.taxType==='individual') return 0.04;
  if(o && o.taxType==='entity') return 0.06;
  return 0;
}

function orderTaxLabel(o){
  if(o && o.taxType==='individual') return 'Физ. лицо (+4%)';
  if(o && o.taxType==='entity') return 'Юр. лицо (+6%)';
  return 'Без налога';
}

function orderTotal(o){
  return orderBaseTotal(o) * (1 + orderTaxRate(o));
}

// Сколько по заказу реально "признано" как полученная выручка:
// если заказ полностью оплачен — вся сумма; если нет, но часть покрыта
// авансом клиента — эта часть аванса тоже считается полученной выручкой.
// Сумму с налогом округляем до целого рубля — именно так выставляется реальный счёт клиенту,
// а не с дробными копейками, которые появляются чисто из-за умножения на ставку налога.
function orderRecognizedRevenue(o){
  const base = orderBaseTotal(o);
  const fullExact = orderTotal(o);
  const full = Math.round(fullExact);
  if (o.isPaid) return { revenue: full, net: Math.round(base) };
  const advUsed = Math.min(parseNum(o.advanceUsed), full);
  if (advUsed > 0) {
    const net = fullExact > 0 ? advUsed * (base / fullExact) : 0;
    return { revenue: advUsed, net };
  }
  return { revenue: 0, net: 0 };
}

function getItemIcon(type) {
  const t = (type || '').toLowerCase();
  if(t.includes('презентац')) {
    return `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="14" height="10" rx="1.5"/><path d="M7 17l3-4 3 4M10 13v4" stroke-linecap="round"/></svg>`;
  }
  if(t.includes('лист') || t.includes('страниц')) {
    return `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 3h7l4 4v10a1.5 1.5 0 01-1.5 1.5h-8A1.5 1.5 0 015 17V3z"/><path d="M12 3v4h4"/></svg>`;
  }
  if(t.includes('карточ')) {
    return `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="M3 9h14"/></svg>`;
  }
  return `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7l7-4 7 4-7 4-7-4z"/><path d="M3 7v6l7 4 7-4V7"/></svg>`;
}

