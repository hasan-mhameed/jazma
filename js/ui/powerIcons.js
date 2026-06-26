// 📄 ui/powerIcons.js
// أيقونات SVG موحّدة للقدرات — تطابق رسم اللوحة (السمكة الذهبية)
// تُستخدم في المخزون وبطاقة التعريف بدل الإيموجي

// السمكة الذهبية (نفس أسلوب اللوحة: جسم منحني + ذيل + زعانف + عين)
export const FISH_SVG = `
<svg viewBox="0 0 100 70" xmlns="http://www.w3.org/2000/svg" class="power-svg">
  <defs>
    <radialGradient id="fishBodyGrad" cx="62%" cy="38%" r="65%">
      <stop offset="0%" stop-color="#fecaca"/>
      <stop offset="35%" stop-color="#f87171"/>
      <stop offset="75%" stop-color="#ef4444"/>
      <stop offset="100%" stop-color="#b91c1c"/>
    </radialGradient>
  </defs>
  <!-- الذيل -->
  <path d="M30 35 Q10 12 4 26 Q16 35 4 44 Q10 58 30 35 Z" fill="#ef4444"/>
  <!-- زعنفة علوية -->
  <path d="M52 22 Q62 6 76 14 Q68 26 52 30 Z" fill="#f87171" opacity="0.92"/>
  <!-- زعنفة سفلية -->
  <path d="M56 48 Q62 62 74 56 Q66 46 56 44 Z" fill="#f87171" opacity="0.88"/>
  <!-- الجسم -->
  <path d="M28 35 Q28 8 60 8 Q92 10 96 35 Q92 60 60 62 Q28 62 28 35 Z" fill="url(#fishBodyGrad)"/>
  <!-- بطن فاتح -->
  <ellipse cx="58" cy="48" rx="22" ry="7" fill="#fffbeb" opacity="0.4"/>
  <!-- انعكاس -->
  <ellipse cx="46" cy="26" rx="4" ry="11" fill="#ffffff" opacity="0.28"/>
  <!-- العين -->
  <circle cx="76" cy="28" r="8" fill="#ffffff"/>
  <circle cx="78" cy="28" r="4.5" fill="#1a1505"/>
  <circle cx="80" cy="25.5" r="1.6" fill="#ffffff"/>
  <!-- ابتسامة -->
  <path d="M86 36 Q92 35 89 42" fill="none" stroke="#7f1d1d" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
</svg>`;

// الجوهرة الذهبية (ماسة بأوجه لامعة)
export const GEM_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="power-svg">
  <polygon points="18,40 32,28 68,28 82,40" fill="#fde68a"/>
  <polygon points="32,28 50,40 50,28" fill="#fef3c7"/>
  <polygon points="68,28 50,40 50,28" fill="#fcd34d"/>
  <polygon points="18,40 50,40 32,28" fill="#fbbf24"/>
  <polygon points="82,40 50,40 68,28" fill="#f59e0b"/>
  <polygon points="18,40 50,40 50,84" fill="#f59e0b"/>
  <polygon points="82,40 50,40 50,84" fill="#d97706"/>
  <polygon points="18,40 82,40 50,84" fill="none" stroke="#fffbeb" stroke-width="1" opacity="0.45"/>
  <line x1="50" y1="40" x2="50" y2="84" stroke="#fffbeb" stroke-width="0.8" opacity="0.3"/>
  <polygon points="26,35 36,35 32,40 28,40" fill="#ffffff" opacity="0.6"/>
</svg>`;

// خريطة الأيقونات حسب نوع القدرة
export const POWER_ICONS = {
  water: FISH_SVG,
  gem: GEM_SVG,
};

// نرجّع أيقونة القدرة (SVG لو متوفّر، وإلا الإيموجي fallback)
export function getPowerIcon(type, fallbackEmoji) {
  return POWER_ICONS[type] || fallbackEmoji || '';
}
