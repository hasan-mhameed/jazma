// 📄 ui/navMenu.js — زر القائمة يفتح modal بطاقات
export function initNavMenu() {
  const userInfo = document.getElementById('user-info');
  if (!userInfo) return;
  if (document.getElementById('nav-menu-toggle')) return;

  const toggle = document.createElement('button');
  toggle.id = 'nav-menu-toggle';
  toggle.type = 'button';
  toggle.textContent = '☰';
  toggle.setAttribute('aria-label', 'القائمة');
  userInfo.after(toggle);

  const modal = document.createElement('div');
  modal.id = 'nav-menu-modal';
  modal.className = 'hidden';
  modal.innerHTML = `
    <div id="nav-menu-box">
      <div class="nav-menu-header">
        <h3>القائمة</h3>
        <button id="nav-menu-close" type="button">✕</button>
      </div>
      <div id="nav-menu-grid"></div>
    </div>`;
  document.body.appendChild(modal);

  const grid = modal.querySelector('#nav-menu-grid');

  // كل بطاقة: أيقونة + اسم + لون
  const menuItems = [
    { id: 'stats-btn',        icon: '📊', label: 'إحصائياتي', color: 'p1' },
    { id: 'daily-btn',        icon: '📅', label: 'تحدي اليوم', color: 'p2' },
    { id: 'history-btn',      icon: '📜', label: 'المباريات', color: 'p1' },
    { id: 'achievements-btn', icon: '🏆', label: 'الإنجازات', color: 'gold' },
    { id: 'leaderboard-btn',  icon: '🥇', label: 'المتصدرين', color: 'lime' },
    { id: 'logout-btn',       icon: '🚪', label: 'خروج', color: 'p2' },
  ];

  menuItems.forEach(({ id, icon, label, color }) => {
    const original = document.getElementById(id);
    if (!original) return;
    const card = document.createElement('button');
    card.className = `nav-menu-card nmc-${color}`;
    card.type = 'button';
    card.innerHTML = `<span class="nmc-icon">${icon}</span><span class="nmc-label">${label}</span>`;
    card.addEventListener('click', () => {
      closeMenu();
      setTimeout(() => original.click(), 50);
    });
    grid.appendChild(card);
  });

  function openMenu()  { modal.classList.remove('hidden'); }
  function closeMenu() { modal.classList.add('hidden'); }

  toggle.addEventListener('click', openMenu);
  modal.querySelector('#nav-menu-close').addEventListener('click', closeMenu);
  modal.addEventListener('click', e => { if (e.target === modal) closeMenu(); });
}
