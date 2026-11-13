// 📄 xp.js
// نظام XP والمستويات

import { getDatabase, ref, get, update }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { currentUser } from "./auth.js?v=1794502787";
import { warmTransaction } from "./core/txn.js?v=1794502787";

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
// 3.3أ: من الملف العام profiles (يقرؤه الجميع) — يصلح لشريطي ولخبرة الخصم في scoreboard
export async function getXP(uid) {
  // 3.3أ: لا يُسقط الواجهة إن تعذّرت القراءة (نشر متدرّج: الكود قبل نشر قاعدة profiles) — الخبرة 0 مؤقتاً
  try {
    const snap = await get(ref(db, `profiles/${uid}/xp`));
    return snap.exists() ? snap.val() : 0;
  } catch (e) { console.debug('getXP', uid, e?.code || e); return 0; }   // 3.3أ-2: لا نُسقط الواجهة، لكن لا نُخفي خطأ قواعد حقيقياً تماماً
}

// ── إضافة XP وإرجاع النتيجة ──────────────────────────────────────
// 3.3ج-4: الخبرة بمعاملة على الملف الخاص (القواعد: لا تنقص، ولا تزيد أكثر من 100 في الكتابة) — صفحتان تكسبان معاً
// تُضاف خبرة الاثنتين (كانت القراءة ثم الكتابة تجعل الثانية تكتب فوق الأولى فتضيع خبرتها)، ثم العام بالقيمة المعتمدة
// (القواعد: الخبرة العامة = الخاصة دائماً). إن تأخّر العام عن معاملة أحدث رُفض ولا يضرّ: الأحدث يكتب قيمته
const XP_STEP_MAX = 100;   // كما في القواعد — أعلى مكسب حقيقي 70 (تحدي اليوم الصعب)
export async function addXP(amount) {
  if (!currentUser || amount <= 0) return null;
  const uid  = currentUser.uid;
  const gain = Math.min(Math.round(amount), XP_STEP_MAX);
  // من قيمة الخادم الحقيقية (core/txn.js): بتخمين فارغ تقترح "المكسب وحده" — أقل من المخزّن، فترفضه القواعد
  const res  = await warmTransaction(ref(db, `users/${uid}/xp`), cur => (typeof cur === "number" ? cur : 0) + gain);
  if (!res || !res.committed) return null;
  const newXP   = res.snapshot.val();
  const current = newXP - gain;
  const before  = getLevelFromXP(current);
  const after   = getLevelFromXP(newXP);
  try { await update(ref(db), { [`profiles/${uid}/xp`]: newXP }); } catch (e) { console.debug("profile xp", e?.code || e); }
  return {
    gained:      gain,
    totalXP:     newXP,
    before,
    after,
    leveledUp:   after.current.level > before.current.level,
    newLevel:    after.current,
  };
}
