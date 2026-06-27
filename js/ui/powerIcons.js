// 📄 ui/powerIcons.js
// أيقونات SVG موحّدة للقدرات — تطابق رسم اللوحة (السمكة الذهبية)
// تُستخدم في المخزون وبطاقة التعريف بدل الإيموجي

// السمكة الذهبية (نفس أسلوب اللوحة: جسم منحني + ذيل + زعانف + عين)
export const FISH_SVG = `
<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" class="power-svg">
  <defs>
    <radialGradient id="fishBodyGrad" cx="62%" cy="38%" r="68%">
      <stop offset="0%" stop-color="#fecaca"/>
      <stop offset="35%" stop-color="#f87171"/>
      <stop offset="75%" stop-color="#ef4444"/>
      <stop offset="100%" stop-color="#b91c1c"/>
    </radialGradient>
  </defs>
  <!-- الذيل -->
  <path d="M40 40 C22 22 12 28 14 38 C8 40 8 40 14 42 C12 52 22 58 40 40 Z" fill="#ef4444"/>
  <!-- زعنفة علوية -->
  <path d="M58 24 C66 8 78 12 80 22 C72 26 64 28 60 32 Z" fill="#f87171" opacity="0.9"/>
  <!-- زعنفة سفلية -->
  <path d="M62 56 C66 70 78 66 78 56 C72 54 66 52 62 52 Z" fill="#f87171" opacity="0.85"/>
  <!-- الجسم -->
  <path d="M38 40 C38 16 60 12 82 18 C100 24 104 34 100 40 C104 46 100 56 82 62 C60 68 38 64 38 40 Z" fill="url(#fishBodyGrad)"/>
  <!-- بطن فاتح -->
  <ellipse cx="72" cy="52" rx="22" ry="7" fill="#fffbeb" opacity="0.35"/>
  <!-- انعكاس -->
  <ellipse cx="58" cy="30" rx="4" ry="12" fill="#ffffff" opacity="0.25"/>
  <!-- العين -->
  <circle cx="88" cy="34" r="8" fill="#ffffff"/>
  <circle cx="90" cy="34" r="4.5" fill="#1a1505"/>
  <circle cx="92" cy="31.5" r="1.6" fill="#ffffff"/>
  <!-- ابتسامة -->
  <path d="M98 42 Q104 41 101 48" fill="none" stroke="#7f1d1d" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
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

// أيقونة تمديد الوقت (ساعة بنفسجية + علامة + خضراء)
export const TIME_EXTEND_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="power-svg">
  <circle cx="50" cy="54" r="34" fill="#14342b" stroke="#a78bfa" stroke-width="4"/>
  <circle cx="50" cy="54" r="34" fill="none" stroke="#c4b5fd" stroke-width="1.5" opacity="0.5"/>
  <rect x="40" y="10" width="20" height="7" rx="3" fill="#a78bfa"/>
  <line x1="50" y1="54" x2="50" y2="34" stroke="#e9d5ff" stroke-width="4" stroke-linecap="round"/>
  <line x1="50" y1="54" x2="64" y2="60" stroke="#e9d5ff" stroke-width="4" stroke-linecap="round"/>
  <circle cx="78" cy="30" r="16" fill="#10b981"/>
  <line x1="78" y1="23" x2="78" y2="37" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="71" y1="30" x2="85" y2="30" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>
</svg>`;

// أيقونة تقصير وقت الخصم (ساعة حمراء + علامة − حمراء)
export const TIME_REDUCE_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="power-svg">
  <circle cx="50" cy="54" r="34" fill="#14342b" stroke="#f87171" stroke-width="4"/>
  <circle cx="50" cy="54" r="34" fill="none" stroke="#fca5a5" stroke-width="1.5" opacity="0.5"/>
  <rect x="40" y="10" width="20" height="7" rx="3" fill="#f87171"/>
  <line x1="50" y1="54" x2="50" y2="34" stroke="#fecaca" stroke-width="4" stroke-linecap="round"/>
  <line x1="50" y1="54" x2="64" y2="60" stroke="#fecaca" stroke-width="4" stroke-linecap="round"/>
  <circle cx="78" cy="30" r="16" fill="#ef4444"/>
  <line x1="71" y1="30" x2="85" y2="30" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>
</svg>`;

// خريطة الأيقونات حسب نوع القدرة
export const POWER_ICONS = {
  water: FISH_SVG,
  gem: GEM_SVG,
  time_extend: TIME_EXTEND_SVG,
  time_reduce: TIME_REDUCE_SVG,
};

// نرجّع أيقونة القدرة (SVG لو متوفّر، وإلا الإيموجي fallback)
export function getPowerIcon(type, fallbackEmoji) {
  return POWER_ICONS[type] || fallbackEmoji || '';
}
