// 📄 ui/navMenu.js — زر القائمة ☰ للموبايل
export function initNavMenu() {
  const userBar   = document.getElementById('user-bar');
  const userStats = document.getElementById('user-stats');
  const userInfo  = document.getElementById('user-info');
  if (!userBar || !userStats || document.getElementById('nav-menu-toggle')) return;

  // زر ☰
  const toggle = document.createElement('button');
  toggle.id = 'nav-menu-toggle';
  toggle.textContent = '☰';
  toggle.setAttribute('aria-label', 'القائمة');
  userInfo.after(toggle);

  // ننقل المتصدرين والخروج لقائمة user-stats المنسدلة (نسخة)
  const leaderboardBtn = document.getElementById('leaderboard-btn');
  const logoutBtn      = document.getElementById('logout-btn');

  // أزرار بديلة داخل القائمة تنقر الأصلية
  function addMirror(originalBtn, label) {
    if (!originalBtn) return;
    const m = document.createElement('button');
    m.className = 'menu-extra';
    m.textContent = label;
    m.addEventListener('click', () => { originalBtn.click(); userStats.classList.remove('menu-open'); });
    userStats.appendChild(m);
  }
  addMirror(leaderboardBtn, '🏆 المتصدرين');
  addMirror(logoutBtn, '🚪 خروج');

  // فتح/إغلاق
  toggle.addEventListener('click', () => {
    userStats.classList.toggle('menu-open');
    toggle.textContent = userStats.classList.contains('menu-open') ? '✕' : '☰';
  });

  // إغلاق عند الضغط على زر داخل القائمة
  userStats.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      userStats.classList.remove('menu-open');
      toggle.textContent = '☰';
    });
  });
}
