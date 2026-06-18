// 📄 core/specialSquares.js
// توليد وتوزيع العناصر الخاصة على المربعات

// أنواع العناصر (نبدأ باثنين، نتوسّع لاحقاً)
export const ELEMENTS = {
  water: { icon: '🐟', color: 0x3b82f6, glow: 0x60a5fa, weight: 3 },
  gem:   { icon: '💎', color: 0xfbbf24, glow: 0xfcd34d, weight: 2 },
};

// خريطة العناصر للعبة الحالية: { "r,c": "water" }
let _map = {};

export function getElementAt(r, c) { return _map[`${r},${c}`] || null; }
export function getElementMap()    { return _map; }

// توليد توزيع عشوائي متناظر — نسبة ~30%
export function generateSpecialSquares(cfg) {
  _map = {};
  const rows = cfg.rows - 1;   // عدد المربعات
  const cols = cfg.cols - 1;
  const total = rows * cols;
  if (total < 2) return _map;

  const target = Math.round(total * 0.3); // 30%
  const types = Object.keys(ELEMENTS);
  const weighted = [];
  types.forEach(t => { for (let i=0;i<ELEMENTS[t].weight;i++) weighted.push(t); });

  // قائمة كل المربعات
  const cells = [];
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) cells.push([r,c]);

  // خلط
  for (let i=cells.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [cells[i],cells[j]]=[cells[j],cells[i]]; }

  let placed = 0;
  for (const [r,c] of cells) {
    if (placed >= target) break;
    const key = `${r},${c}`;
    if (_map[key]) continue;
    const type = weighted[Math.floor(Math.random()*weighted.length)];
    _map[key] = type;
    placed++;

    // التناظر — المربع المقابل (أفقياً) يأخذ نفس النوع للعدالة
    const mc = cols - 1 - c;
    const mkey = `${r},${mc}`;
    if (mc !== c && !_map[mkey] && placed < target) {
      _map[mkey] = type;
      placed++;
    }
  }
  return _map;
}
