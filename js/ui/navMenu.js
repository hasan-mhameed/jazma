// 📄 ui/navMenu.js — زر القائمة يفتح modal للموبايل
export function initNavMenu() {
  const userInfo = document.getElementById('user-info');
  if (!userInfo || document.getElementById('nav-menu-toggle')) return;

  // ── زر القائمة ☰ ──
  const toggle = document.createElement('button');
  toggle.id = 'nav-menu-toggle';
  toggle.textContent = '☰';
  toggle.setAttribute('aria-label', 'القائمة');
  userInfo.after(toggle);

  // ── modal القائمة ──
  const modal = document.createElement('div');
  modal.id = 'nav-menu-modal';
  modal.className = 'hidden';
  modal.innerHTML = `
    <div id="nav-menu-box">
      <div class="nav-menu-header">
        <h3>القائمة</h3>
        <button id="nav-menu-close">✕</button>
      </div>
      <div id="nav-menu-items"></div>
    </div>`;
  document.body.appendChild(modal);

  const itemsBox = modal.querySelector('#nav-menu-items');

  // ── الأزرار اللي تنتقل للقائمة (كلها ما عدا أصدقاء/رسائل) ──
  const menuButtons = [
    { id: 'stats-btn',        label: '📊 إحصائياتي' },
    { id: 'daily-btn',        label: '📅 تحدي اليوم' },
    { id: 'history-btn',      label: '📜 المباريات' },
    { id: 'achievements-btn', label: '🏆 الإنجازات' },
    { id: 'leaderboard-btn',  label: '🥇 المتصدرين' },
    { id: 'logout-btn',       label: '🚪 خروج' },
  ];

  menuButtons.forEach(({ id, label }) => {
    const original = document.getElementById(id);
    if (!original) return;
    const item = document.createElement('button');
    item.className = 'nav-menu-item';
    item.textContent = label;
    item.addEventListener('click', () => {
      closeMenu();
      original.click();
    });
    itemsBox.appendChild(item);
  });

  function openMenu()  { modal.classList.remove('hidden'); }
  function closeMenu() { modal.classList.add('hidden'); }

  toggle.addEventListener('click', openMenu);
  modal.querySelector('#nav-menu-close').addEventListener('click', closeMenu);
  modal.addEventListener('click', e => { if (e.target === modal) closeMenu(); });
}
