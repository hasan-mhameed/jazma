// 📄 ui/statsModal.js
// عرض modal الإحصائيات مع فلتر زمني
import { getAllStats } from "../auth.js?v=1784404579";

let _statsFilter = 'all';

// ── حساب 1v1 من history ─────────────────────────────────────────
export function computeFromHistory(historyObj, filter) {
  if (!historyObj || typeof historyObj !== 'object')
    return { w: 0, l: 0, d: 0, total: 0 };

  let records = Object.entries(historyObj)
    .map(([ts, v]) => ({ ts: Number(ts), r: v.r }))
    .sort((a, b) => a.ts - b.ts);

  if (filter === 'month') {
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    records = records.filter(g => g.ts >= start);
  } else if (filter === 'last10') {
    records = records.slice(-10);
  }

  const w = records.filter(g => g.r === 'w').length;
  const l = records.filter(g => g.r === 'l').length;
  const d = records.filter(g => g.r === 'd').length;
  return { w, l, d, total: w + l + d };
}

// ── حساب متعدد اللاعبين من history ──────────────────────────────
function computeMultiFiltered(historyObj, filter) {
  if (!historyObj || typeof historyObj !== 'object') return [];

  let records = Object.entries(historyObj)
    .map(([ts, v]) => ({ ts: Number(ts), ...v }))
    .sort((a, b) => a.ts - b.ts);

  if (filter === 'month') {
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    records = records.filter(r => r.ts >= start);
  } else if (filter === 'last10') {
    records = records.slice(-10);
  }

  return records;
}

// ── بناء صف 1v1 ─────────────────────────────────────────────────
function vsRow(name, { w, l, d, total }) {
  if (total === 0) return `<p class="stats-empty">لا مباريات في هذه الفترة</p>`;
  return `
    <div class="stats-vs-row">
      <span class="vs-name">${name}</span>
      <span class="sh-win">🏆 ${w}</span>
      <span class="sh-sep">–</span>
      <span class="sh-loss">💔 ${l}</span>
      ${d > 0 ? `<span class="sh-sep">·</span><span class="sh-draw">🤝 ${d}</span>` : ''}
    </div>`;
}

// ── sortByLastPlayed ─────────────────────────────────────────────
function sortByLast(entries) {
  return entries.sort((a, b) => {
    const lastA = Math.max(...Object.keys(a[1].history).map(Number));
    const lastB = Math.max(...Object.keys(b[1].history).map(Number));
    return lastB - lastA;
  });
}

// ── الدالة الرئيسية ──────────────────────────────────────────────
export async function renderStatsModal(uid) {
  const statsContent = document.getElementById('stats-content');
  if (!statsContent) return;

  const stats = await getAllStats(uid);

  // تبويبات الفلتر
  const tabs = [
    { id: 'all',    label: 'كل الوقت' },
    { id: 'month',  label: 'هذا الشهر' },
    { id: 'last10', label: 'آخر 10' },
  ];
  let html = `
    <div class="stats-filter-tabs">
      ${tabs.map(t => `
        <button class="sft-btn ${_statsFilter === t.id ? 'active' : ''}"
          data-filter="${t.id}">${t.label}</button>`).join('')}
    </div>`;

  // ── AI ───────────────────────────────────────────────────────
  html += `<div class="stats-section">
    <div class="stats-section-title">🤖 ضد الكمبيوتر</div>
    ${vsRow('الكمبيوتر', computeFromHistory(stats.ai?.history, _statsFilter))}
  </div>`;

  // ── محلي ─────────────────────────────────────────────────────
  const localEntries = sortByLast(
    Object.entries(stats.local || {}).filter(([, v]) => v?.history)
  );
  html += `<div class="stats-section"><div class="stats-section-title">👥 محلي مع صديق</div>`;
  if (localEntries.length === 0) {
    html += '<p class="stats-empty">لم تلعب محلياً بعد</p>';
  } else {
    localEntries.forEach(([, v]) =>
      html += vsRow(v.name || 'لاعب', computeFromHistory(v.history, _statsFilter))
    );
  }
  html += `</div>`;

  // ── متعدد اللاعبين ───────────────────────────────────────────
  const allMulti      = computeMultiFiltered(stats.multi?.history, 'all');
  const filteredMulti = computeMultiFiltered(stats.multi?.history, _statsFilter);
  const medals        = ['🥇', '🥈', '🥉'];

  html += `<div class="stats-section"><div class="stats-section-title">🎮 متعدد اللاعبين</div>`;
  if (filteredMulti.length === 0) {
    html += `<p class="stats-empty">${allMulti.length === 0 ? 'لم تلعب بعد' : 'لا مباريات في هذه الفترة'}</p>`;
  } else {
    const total    = filteredMulti.length;
    const avgScore = (filteredMulti.reduce((s, r) => s + (r.score || 0), 0) / total).toFixed(1);
    const maxRank  = Math.max(...filteredMulti.map(r => r.rank || 1));
    const rankChips = Array.from({ length: maxRank }, (_, i) => {
      const rank  = i + 1;
      const count = filteredMulti.filter(r => r.rank === rank).length;
      const pct   = Math.round((count / total) * 100);
      const label = medals[i] ?? `#${rank}`;
      return `<div class="smg-rank-chip ${rank <= 3 ? `smg-rank-${rank}` : 'smg-rank-other'}">
        <span class="smg-rank-label">${label}</span>
        <span class="smg-rank-pct">${pct}%</span>
      </div>`;
    }).join('');
    html += `
      <div class="stats-multi-grid">
        <div class="smg-cell"><span class="smg-val">${total}</span><span class="smg-lbl">🎮 مباراة</span></div>
        <div class="smg-cell"><span class="smg-val">⌀ ${avgScore}</span><span class="smg-lbl">متوسط النقاط</span></div>
      </div>
      <div class="smg-ranks-row">${rankChips}</div>`;
  }
  html += `</div>`;

  // ── أونلاين ──────────────────────────────────────────────────
  const onlineEntries = sortByLast(
    Object.entries(stats.online || {}).filter(([, v]) => v?.history)
  );
  html += `<div class="stats-section"><div class="stats-section-title">🌐 أونلاين</div>`;
  if (onlineEntries.length === 0) {
    html += '<p class="stats-empty">لم تلعب أونلاين بعد</p>';
  } else {
    onlineEntries.forEach(([oppUid, v]) =>
      html += vsRow(v.name || oppUid.slice(0, 8), computeFromHistory(v.history, _statsFilter))
    );
  }
  html += `</div>`;

  statsContent.innerHTML = html;

  // ربط تبويبات الفلتر
  statsContent.querySelectorAll('.sft-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _statsFilter = btn.dataset.filter;
      renderStatsModal(uid);
    });
  });
}
