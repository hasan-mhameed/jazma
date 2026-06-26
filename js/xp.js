// 📄 xp.js
// نظام XP والمستويات

import { getDatabase, ref, get, update }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { currentUser } from "./auth.js?v=1782474528";

const db = getDatabase();

// ── المستويات ─────────────────────────────────────────────────────
export const LEVELS = [
  { level: 1,  xp: 0,     title: 'مبتدئ',   icon: '🌱' },
  { level: 2,  xp: 100,   title: 'متعلم',   icon: '📚' },
  { level: 3,  xp: 250,   title: 'لاعب',    icon: '🎮' },
  { level: 4,  xp: 500,   title: 'ماهر',    icon: '⚡' },
  { level: 5,  xp: 1000,  title: 'محترف',   icon: '🔥' },
  { level: 6,  xp: 2000,  title: 'خبير',    icon: '💎' },
  { level: 7,  xp: 3500,  title: 'أسطورة',  icon: '⭐' },
  { level: 8,  xp: 5500,  title: 'بطل',     icon: '👑' },
  { level: 9,  xp: 8000,  title: 'عبقري',   icon: '🧠' },
  { level: 10, xp: 12000, title: 'لا يُهزم', icon: '🏆' },
];

// ── حساب المستوى من XP ────────────────────────────────────────────
export function getLevelFromXP(xp) {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (xp >= lvl.xp) current = lvl;
    else break;
  }
  const nextIdx = LEVELS.findIndex(l => l.level === current.level) + 1;
  const next    = LEVELS[nextIdx] || null;
  const progress = next
    ? Math.round(((xp - current.xp) / (next.xp - current.xp)) * 100)
    : 100;
  return { current, next, progress, xp };
}

// ── حساب XP المكتسب من مباراة ─────────────────────────────────────
export function calcXP(matchData) {
  const { mode, result, aiDifficulty, gridSize, rank, players } = matchData;
  if (result === 'loss') return 0;

  // حساب الـ base XP
  let base = 0;
  if (result === 'draw') {
    // التعادل = نص الفوز
    if (mode === 'ai') {
      if (aiDifficulty === 'easy')      base = 5;
      if (aiDifficulty === 'medium')    base = 10;
      if (aiDifficulty === 'nightmare') base = 20;
    } else if (mode === 'online') base = 12;
    else if (mode === 'local')   base = 7;
    else if (mode === 'multi')   base = 10;
    // bonus اللوحة للتعادل أيضاً (نص الـ bonus)
    const gridBonus = { 5: 2, 6: 5, 7: 7 };
    base += gridBonus[gridSize] || 0;
    return base;
  }

  if (mode === 'ai') {
    if (aiDifficulty === 'easy')      base = 10;
    if (aiDifficulty === 'medium')    base = 20;
    if (aiDifficulty === 'nightmare') base = 40;
  } else if (mode === 'online') {
    base = 25;
  } else if (mode === 'local') {
    base = 15;
  } else if (mode === 'multi') {
    if (rank === 1) base = 30;
    else if (rank === 2) base = 20;
    else                 base = 10;
  }

  if (result === 'draw') base = 5;

  // bonus حجم اللوحة
  const gridBonus = { 5: 5, 6: 10, 7: 15 };
  base += gridBonus[gridSize] || 0;

  return base;
}

// ── جلب XP الحالي ────────────────────────────────────────────────
export async function getXP(uid) {
  const snap = await get(ref(db, `users/${uid}/xp`));
  return snap.exists() ? snap.val() : 0;
}

// ── إضافة XP وإرجاع النتيجة ──────────────────────────────────────
export async function addXP(amount) {
  if (!currentUser || amount <= 0) return null;
  const uid      = currentUser.uid;
  const current  = await getXP(uid);
  const newXP    = current + amount;
  const before   = getLevelFromXP(current);
  const after    = getLevelFromXP(newXP);
  await update(ref(db, `users/${uid}`), { xp: newXP });
  return {
    gained:      amount,
    totalXP:     newXP,
    before,
    after,
    leveledUp:   after.current.level > before.current.level,
    newLevel:    after.current,
  };
}
