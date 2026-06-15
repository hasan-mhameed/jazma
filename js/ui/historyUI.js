// 📄 ui/historyUI.js
// عرض تاريخ المباريات مع فلتر وpagination

import { fetchHistory } from "../history.js?v=1781535907";
import { getCurrentUser } from "../auth.js?v=1781535907";

let _filter   = 'all';   // 'all' | 'ai' | 'local' | 'online' | 'multi'
let _lastKey  = null;
let _hasMore  = false;
let _loading  = false;

// ── تنسيق الوقت ──────────────────────────────────────────────────
function formatTime(ts) {
  const now  = Date.now();
  const diff = now - ts;
  const min  = Math.floor(diff / 60000);
  const hr   = Math.floor(diff / 3600000);
  const day  = Math.floor(diff / 86400000);
  if (min < 1)   return 'الآن';
  if (min < 60)  return `منذ ${min} دقيقة`;
  if (hr  < 24)  return `منذ ${hr} ساعة`;
  if (day < 7)   return `منذ ${day} يوم`;
  return new Date(ts).toLocaleDateString('ar', { day: 'numeric', month: 'short' });
}

// ── تنسيق المدة ──────────────────────────────────────────────────
function formatDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}د ${s}ث` : `${s}ث`;
}

// ── أيقونة النتيجة ────────────────────────────────────────────────
function resultIcon(result) {
  return result === 'win' ? '🏆' : result === 'loss' ? '💔' : '🤝';
}

// ── اسم الوضع ────────────────────────────────────────────────────
function modeName(mode) {
  return { ai: '🤖 ضد AI', local: '👥 محلي', online: '🌐 أونلاين', multi: '🎮 متعدد' }[mode] || mode;
}

// ── بناء بطاقة مباراة ────────────────────────────────────────────
function buildMatchCard(match) {
  const card = document.createElement('div');
  card.className = `history-card result-${match.result}`;

  const isMulti = match.mode === 'multi';
  const score   = isMulti
    ? `${match.myScore} نقطة`
    : `${match.myScore} – ${match.oppScore}`;

  const vsText = match.vs
    ? `vs ${match.vs}`
    : modeName(match.mode);

  card.innerHTML = `
    <div class="hc-result">${resultIcon(match.result)}</div>
    <div class="hc-info">
      <div class="hc-vs">${vsText}</div>
      <div class="hc-meta">
        <span>${modeName(match.mode)}</span>
        <span>${match.grid}</span>
        ${match.duration ? `<span>${formatDuration(match.duration)}</span>` : ''}
      </div>
    </div>
    <div class="hc-right">
      <div class="hc-score">${score}</div>
      <div class="hc-time">${formatTime(match.ts)}</div>
    </div>`;

  return card;
}

// ── تجميع المباريات حسب اليوم ────────────────────────────────────
function groupByDay(matches) {
  const groups = {};
  matches.forEach(m => {
    const date = new Date(m.ts);
    const today     = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    let label;
    if (date.toDateString() === today.toDateString())     label = 'اليوم';
    else if (date.toDateString() === yesterday.toDateString()) label = 'أمس';
    else label = date.toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'short' });
    if (!groups[label]) groups[label] = [];
    groups[label].push(m);
  });
  return groups;
}

// ── رسم المباريات ─────────────────────────────────────────────────
function renderMatches(matches, container, append = false) {
  if (!append) container.innerHTML = '';

  const filtered = _filter === 'all'
    ? matches
    : matches.filter(m => m.mode === _filter);

  if (filtered.length === 0 && !append) {
    container.innerHTML = '<p class="history-empty">لا مباريات في هذه الفئة</p>';
    return;
  }

  const groups = groupByDay(filtered);
  Object.entries(groups).forEach(([day, dayMatches]) => {
    const dayEl = document.createElement('div');
    dayEl.className = 'history-day-group';
    const label = document.createElement('div');
    label.className = 'history-day-label';
    label.textContent = day;
    dayEl.appendChild(label);
    dayMatches.forEach(m => dayEl.appendChild(buildMatchCard(m)));
    container.appendChild(dayEl);
  });
}

// ── الدالة الرئيسية ──────────────────────────────────────────────
export function initHistoryUI() {
  const historyBtn      = document.getElementById('history-btn');
  const historyModal    = document.getElementById('history-modal');
  const closeHistoryBtn = document.getElementById('close-history-btn');
  const historyList     = document.getElementById('history-list');
  const loadMoreBtn     = document.getElementById('history-load-more');
  const filterBtns      = document.querySelectorAll('.hf-btn');

  if (!historyBtn) return;

  // ── فتح المودال ────────────────────────────────────────────────
  historyBtn.addEventListener('click', async () => {
    historyModal.classList.remove('hidden');
    _filter  = 'all';
    _lastKey = null;
    filterBtns.forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    await loadPage(historyList, loadMoreBtn, false);
  });

  // ── إغلاق ──────────────────────────────────────────────────────
  closeHistoryBtn?.addEventListener('click', () => historyModal.classList.add('hidden'));
  historyModal?.addEventListener('click', e => {
    if (e.target === historyModal) historyModal.classList.add('hidden');
  });

  // ── فلاتر ──────────────────────────────────────────────────────
  filterBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      _filter  = btn.dataset.filter;
      _lastKey = null;
      filterBtns.forEach(b => b.classList.toggle('active', b === btn));
      await loadPage(historyList, loadMoreBtn, false);
    });
  });

  // ── تحميل المزيد ───────────────────────────────────────────────
  loadMoreBtn?.addEventListener('click', async () => {
    await loadPage(historyList, loadMoreBtn, true);
  });
}

async function loadPage(container, loadMoreBtn, append) {
  if (_loading) return;
  _loading = true;

  const uid = getCurrentUser()?.uid;
  if (!uid) { _loading = false; return; }

  if (!append) {
    container.innerHTML = '<p class="history-loading">⏳ جاري التحميل...</p>';
    _lastKey = null;
  } else {
    loadMoreBtn.disabled    = true;
    loadMoreBtn.textContent = '⏳ جاري التحميل...';
  }

  const { matches, hasMore, lastKey } = await fetchHistory(uid, append ? _lastKey : null);
  _hasMore = hasMore;
  _lastKey = lastKey;

  renderMatches(matches, container, append);

  if (loadMoreBtn) {
    loadMoreBtn.classList.toggle('hidden', !_hasMore);
    loadMoreBtn.disabled    = false;
    loadMoreBtn.textContent = '⬇️ تحميل المزيد';
  }

  _loading = false;
}
