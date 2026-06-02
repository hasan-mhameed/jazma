// 📄 ui/xpUI.js
// شريط XP في user-bar + popup ترقية المستوى

import { getXP, getLevelFromXP, LEVELS } from "../xp.js?v=1780438051";
import { getCurrentUser } from "../auth.js?v=1780438051";

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
}
