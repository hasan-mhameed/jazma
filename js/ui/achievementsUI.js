// 📄 ui/achievementsUI.js
import { ACHIEVEMENTS, getUnlocked } from "../achievements.js?v=1781554385";
import { getCurrentUser } from "../auth.js?v=1781554385";

export function showAchievementPopup(key) {
  const def = ACHIEVEMENTS[key];
  if (!def) return;
  document.getElementById('achievement-popup')?.remove();
  const popup = document.createElement('div');
  popup.id = 'achievement-popup';
  popup.innerHTML = `
    <div class="ach-popup-inner">
      <div class="ach-popup-label">🏆 إنجاز جديد!</div>
      <div class="ach-popup-icon">${def.icon}</div>
      <div class="ach-popup-name">${def.name}</div>
      <div class="ach-popup-desc">${def.desc}</div>
    </div>`;
  document.body.appendChild(popup);
  setTimeout(() => {
    popup.classList.add('ach-popup-hide');
    setTimeout(() => popup.remove(), 400);
  }, 4000);
}

export async function showNewAchievements(keys) {
  for (let i = 0; i < keys.length; i++) {
    await new Promise(r => setTimeout(r, i * 1500));
    showAchievementPopup(keys[i]);
  }
}

export function initAchievementsUI() {
  const btn   = document.getElementById('achievements-btn');
  const modal = document.getElementById('achievements-modal');
  const close = document.getElementById('close-achievements-btn');
  const list  = document.getElementById('achievements-list');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    modal.classList.remove('hidden');
    list.innerHTML = '<p class="history-loading">⏳ جاري التحميل...</p>';
    const uid      = getCurrentUser()?.uid;
    const unlocked = uid ? await getUnlocked(uid) : {};
    renderAchievements(unlocked, list);
  });
  close?.addEventListener('click',  () => modal.classList.add('hidden'));
  modal?.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
}

function renderAchievements(unlocked, container) {
  container.innerHTML = '';
  const total     = Object.keys(ACHIEVEMENTS).length;
  const doneCount = Object.keys(unlocked).length;
  const pct       = Math.round((doneCount / total) * 100);

  const header = document.createElement('div');
  header.className = 'ach-progress-wrap';
  header.innerHTML = `
    <div class="ach-progress-label">${doneCount} / ${total} إنجاز</div>
    <div class="ach-progress-bar"><div class="ach-progress-fill" style="width:${pct}%"></div></div>`;
  container.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'ach-grid';
  Object.entries(ACHIEVEMENTS).forEach(([key, def]) => {
    const done = !!unlocked[key];
    const date = done && unlocked[key].unlockedAt
      ? new Date(unlocked[key].unlockedAt).toLocaleDateString('ar', { day: 'numeric', month: 'short' })
      : null;
    const card = document.createElement('div');
    card.className = `ach-card ${done ? 'ach-done' : 'ach-locked'}`;
    card.innerHTML = `
      <div class="ach-card-icon">${done ? def.icon : '🔒'}</div>
      <div class="ach-card-name">${def.name}</div>
      <div class="ach-card-desc">${def.desc}</div>
      ${date ? `<div class="ach-card-date">${date}</div>` : ''}`;
    grid.appendChild(card);
  });
  container.appendChild(grid);
}
