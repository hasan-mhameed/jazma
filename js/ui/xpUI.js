// 📄 ui/xpUI.js
// شريط XP في user-bar + popup ترقية المستوى

import { getXP, getLevelFromXP, LEVELS } from "../xp.js?v=1781647508";
import { getCurrentUser } from "../auth.js?v=1781647508";

// ── تحديث شريط XP ─────────────────────────────────────────────────
export async function refreshXPBar() {
  const uid = getCurrentUser()?.uid;
  if (!uid) return;

  const xp      = await getXP(uid);
  const { current, next, progress } = getLevelFromXP(xp);

  const bar     = document.getElementById('xp-bar-fill');
  const label   = document.getElementById('xp-level-label');
  const xpText  = document.getElementById('xp-text');

  if (label)  label.textContent  = `${current.icon} ${current.title}`;
  if (xpText) xpText.textContent = next
    ? `${xp - current.xp} / ${next.xp - current.xp} XP`
    : `${xp} XP ✓`;
  if (bar) {
    bar.style.width = `${progress}%`;
    bar.style.background = current.level >= 8
      ? 'linear-gradient(90deg, #fbbf24, #f59e0b)'
      : 'linear-gradient(90deg, #7c6af7, #a78bfa)';
  }
}

// ── popup اكتساب XP + ترقية ────────────────────────────────────────
export function showXPGain(result) {
  if (!result || result.gained <= 0) return;

  document.getElementById('xp-gain-popup')?.remove();

  const popup = document.createElement('div');
  popup.id    = 'xp-gain-popup';

  if (result.leveledUp) {
    popup.innerHTML = `
      <div class="xp-popup-inner xp-levelup">
        <div class="xp-popup-title">🎉 ترقية مستوى!</div>
        <div class="xp-popup-level">
          ${result.before.current.icon} ${result.before.current.title}
          <span class="xp-arrow">→</span>
          ${result.newLevel.icon} ${result.newLevel.title}
        </div>
        <div class="xp-popup-gained">+${result.gained} XP</div>
      </div>`;
  } else {
    popup.innerHTML = `
      <div class="xp-popup-inner">
        <div class="xp-popup-gained">+${result.gained} XP</div>
        <div class="xp-popup-level">${result.after.current.icon} ${result.after.current.title}</div>
      </div>`;
  }

  document.body.appendChild(popup);
  setTimeout(() => {
    popup.classList.add('xp-popup-hide');
    setTimeout(() => {
      popup.remove();
      refreshXPBar();
    }, 400);
  }, result.leveledUp ? 3500 : 2500);
}

// ── init ──────────────────────────────────────────────────────────
export function initXPUI() {
  refreshXPBar();

  const infoBtn  = document.getElementById('xp-info-btn');
  const modal    = document.getElementById('xp-guide-modal');
  const closeBtn = document.getElementById('close-xp-guide-btn');
  const content  = document.getElementById('xp-guide-content');

  infoBtn?.addEventListener('click', () => {
    modal.classList.remove('hidden');
    if (content) renderXPGuide(content);
  });
  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));
  modal?.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
}

// ── جدول XP ──────────────────────────────────────────────────────
function renderXPGuide(container) {
  container.innerHTML = `
    <div class="xpg-section">
      <div class="xpg-title">🏆 فوز</div>
      <div class="xpg-grid">
        <div class="xpg-row"><span>🤖 AI سهل</span><span class="xpg-val">+10 XP</span></div>
        <div class="xpg-row"><span>🤖 AI متوسط</span><span class="xpg-val">+20 XP</span></div>
        <div class="xpg-row"><span>🤖 AI صعب</span><span class="xpg-val">+40 XP</span></div>
        <div class="xpg-row"><span>🌐 أونلاين</span><span class="xpg-val">+25 XP</span></div>
        <div class="xpg-row"><span>👥 محلي</span><span class="xpg-val">+15 XP</span></div>
        <div class="xpg-row"><span>🎮 متعدد 🥇</span><span class="xpg-val">+30 XP</span></div>
        <div class="xpg-row"><span>🎮 متعدد 🥈</span><span class="xpg-val">+20 XP</span></div>
        <div class="xpg-row"><span>🎮 متعدد 🥉</span><span class="xpg-val">+10 XP</span></div>
      </div>
    </div>

    <div class="xpg-section">
      <div class="xpg-title">🤝 تعادل (نص الفوز)</div>
      <div class="xpg-grid">
        <div class="xpg-row"><span>🤖 AI سهل</span><span class="xpg-val">+5 XP</span></div>
        <div class="xpg-row"><span>🤖 AI متوسط</span><span class="xpg-val">+10 XP</span></div>
        <div class="xpg-row"><span>🤖 AI صعب</span><span class="xpg-val">+20 XP</span></div>
        <div class="xpg-row"><span>🌐 أونلاين</span><span class="xpg-val">+12 XP</span></div>
        <div class="xpg-row"><span>👥 محلي</span><span class="xpg-val">+7 XP</span></div>
      </div>
    </div>

    <div class="xpg-section">
      <div class="xpg-title">🗺️ bonus حجم اللوحة (فوز)</div>
      <div class="xpg-grid">
        <div class="xpg-row"><span>5×5</span><span class="xpg-val">+5 XP</span></div>
        <div class="xpg-row"><span>6×6</span><span class="xpg-val">+10 XP</span></div>
        <div class="xpg-row"><span>7×7</span><span class="xpg-val">+15 XP</span></div>
      </div>
    </div>

    <div class="xpg-section">
      <div class="xpg-title">💔 خسارة</div>
      <div class="xpg-grid">
        <div class="xpg-row"><span>أي وضع</span><span class="xpg-val xpg-zero">0 XP</span></div>
      </div>
    </div>

    <div class="xpg-levels">
      <div class="xpg-title">🎖️ المستويات</div>
      ${LEVELS.map(l => `
        <div class="xpg-level-row">
          <span class="xpg-level-icon">${l.icon}</span>
          <span class="xpg-level-name">${l.title}</span>
          <span class="xpg-level-xp">${l.xp.toLocaleString()} XP</span>
        </div>`).join('')}
    </div>`;
}
