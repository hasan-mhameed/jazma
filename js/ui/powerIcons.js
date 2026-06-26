// 📄 ui/powerIcons.js
// أيقونات SVG موحّدة للقدرات — تطابق رسم اللوحة (السمكة الذهبية)
// تُستخدم في المخزون وبطاقة التعريف بدل الإيموجي

// السمكة الذهبية (نفس أسلوب اللوحة: جسم منحني + ذيل + زعانف + عين)
export const FISH_SVG = `
<svg viewBox="0 0 100 70" xmlns="http://www.w3.org/2000/svg" class="power-svg">
  <defs>
    <radialGradient id="fishBodyGrad" cx="62%" cy="38%" r="65%">
      <stop offset="0%" stop-color="#fef3c7"/>
      <stop offset="35%" stop-color="#fbbf24"/>
      <stop offset="75%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </radialGradient>
  </defs>
  <!-- الذيل -->
  <path d="M30 35 Q10 12 4 26 Q16 35 4 44 Q10 58 30 35 Z" fill="#f59e0b"/>
  <!-- زعنفة علوية -->
  <path d="M52 22 Q62 6 76 14 Q68 26 52 30 Z" fill="#fbbf24" opacity="0.92"/>
  <!-- زعنفة سفلية -->
  <path d="M56 48 Q62 62 74 56 Q66 46 56 44 Z" fill="#fbbf24" opacity="0.88"/>
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
  <path d="M86 36 Q92 35 89 42" fill="none" stroke="#b45309" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
</svg>`;

// الجوهرة الذهبية (ماسة بأوجه لامعة)
export const GEM_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="power-svg">
  <!-- الطاولة العلوية -->
  <polygon points="25,28 75,28 66,45 34,45" fill="#fde68a"/>
  <!-- الوجه الأيسر -->
  <polygon points="25,28 34,45 50,90" fill="#f59e0b"/>
  <!-- الوجه الأيمن -->
  <polygon points="75,28 66,45 50,90" fill="#d97706"/>
  <!-- الوجه الأوسط -->
  <polygon points="34,45 66,45 50,90" fill="#fbbf24"/>
  <!-- حدود -->
  <polygon points="25,28 75,28 50,90" fill="none" stroke="#fffbeb" stroke-width="1.2" opacity="0.5"/>
  <!-- بريق -->
  <polygon points="30,32 42,32 37,40 32,40" fill="#ffffff" opacity="0.55"/>
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
