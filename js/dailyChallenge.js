// 📄 dailyChallenge.js
import { getDatabase, ref, get, set, serverTimestamp, onValue }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { currentUser } from "./auth.js?v=1794502787";

const db = getDatabase();

// 3.3ج-4: "اليوم" من ساعة الخادم كما يقدّرها الجهاز (.info/serverTimeOffset) لا من ساعة الجهاز — التحدي واحد للجميع،
// والنتيجة تُكتب ليومها (جهاز ساعته متأخرة يوماً كان يلعب تحدي الأمس ويكتب فيه)
let _serverOffset = 0;
try { onValue(ref(db, ".info/serverTimeOffset"), s => { const v = s.val(); _serverOffset = typeof v === "number" ? v : 0; }); } catch {}
const serverNow = () => Date.now() + _serverOffset;

// ── توليد رقم عشوائي من seed ──────────────────────────────────────
function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ── توليد إعداد التحدي من التاريخ ────────────────────────────────
export function getDailyConfig(dateStr = null) {
  const today = dateStr || todayStr();
  const seed  = parseInt(today.replace(/-/g, ''), 10);
  const rand  = seededRandom(seed);
  const grids = [4, 4, 4, 5, 5, 6];
  const diffs = ['easy', 'medium', 'medium', 'nightmare'];
  return {
    date:       today,
    gridSize:   grids[Math.floor(rand() * grids.length)],
    difficulty: diffs[Math.floor(rand() * diffs.length)],
  };
}

export function difficultyName(d) {
  return { easy: 'سهل 😊', medium: 'متوسط 🧠', nightmare: 'صعب 🔥' }[d] || d;
}

export function todayStr() {
  return new Date(serverNow()).toISOString().slice(0, 10);
}

// مربعات لوحة بحجم g نقاط (4 نقاط = 3×3 = 9 مربعات)
export const boardSquares = g => (g - 1) * (g - 1);

// 3.3ج-4: فوزٌ يُعرض في متصدري يومه؟ — القواعد لا تستطيع مقارنة التاريخ في المسار بالوقت (ولا تعرف لوحة ذلك اليوم)،
// فيتجاهل القارئ ما لا يطابق: وقت كتابته (وقت الخادم — القواعد تفرضه) خارج ذلك اليوم بهامش ربع ساعة، أو نقاطه ليست
// لوحة ذلك اليوم كاملة بفوز. ما كُتب ليوم آخر أو بلوحة أخرى لا يظهر في أي قائمة
const DAY_MS = 86_400_000, TS_GRACE_MS = 15 * 60_000;
export function isValidDailyWin(v, dateStr) {
  if (!v || typeof v !== "object" || v.result !== "win") return false;
  const start = Date.parse(`${dateStr}T00:00:00Z`);
  if (!isFinite(start) || typeof v.ts !== "number" || v.ts < start - TS_GRACE_MS || v.ts > start + DAY_MS + TS_GRACE_MS) return false;
  const sq = boardSquares(getDailyConfig(dateStr).gridSize);
  return typeof v.myScore === "number" && typeof v.oppScore === "number" && v.myScore + v.oppScore === sq && v.myScore > v.oppScore;
}

// ── هل لعب اليوم؟ ─────────────────────────────────────────────────
// dateStr: يوم بعينه (يوم التحدي الذي بدأت به المباراة) — بدونه اليوم
export async function hasPlayedToday(dateStr = null) {
  if (!currentUser) return false;
  const snap = await get(ref(db, `dailyChallenges/${dateStr || todayStr()}/results/${currentUser.uid}`));
  return snap.exists();
}

// ── حفظ النتيجة ──────────────────────────────────────────────────
// dateStr: يوم التحدي الذي بدأت به المباراة (تحدٍّ بدأ قبل منتصف الليل يُكتب ليومه ولوحته — لا لليوم التالي)
// 3.3ج-4: النتيجة تُكتب مرة واحدة (القواعد). رفضٌ والنتيجة المحفوظة هي هذه المحاولة نفسها = حُفظت فعلاً: ردّ الخادم
// ضاع مع انقطاع فأعادت الحزمة إرسالها بعد العودة، والإعادة تُرفض (مراجعة ج-4) — فلا خطأ. وغير ذلك يُرمى الخطأ
// ومعه e.daily: "already" (نتيجة أخرى لهذا اليوم سبقتها — صفحة أو جهاز آخر) أو "failed" (لم يُحفظ شيء)
export async function saveDailyResult(result, myScore, oppScore, duration, displayName, dateStr = null) {
  if (!currentUser) return;
  const r = ref(db, `dailyChallenges/${dateStr || todayStr()}/results/${currentUser.uid}`);
  const name = displayName || 'لاعب';
  try {
    await set(r, { result, myScore, oppScore, duration, name, ts: serverTimestamp() });   // 3.3ج-1: وقت الخادم
  } catch (e) {
    const snap = await get(r).catch(() => null);
    const v = snap && snap.exists() ? snap.val() : null;
    if (v && v.result === result && v.myScore === myScore && v.oppScore === oppScore && v.duration === duration && v.name === name) return;
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { daily: v ? "already" : "failed" });
  }
}

// ── leaderboard اليوم ─────────────────────────────────────────────
export async function getDailyLeaderboard() {
  const day  = todayStr();
  const snap = await get(ref(db, `dailyChallenges/${day}/results`));
  if (!snap.exists()) return [];
  return Object.entries(snap.val())
    .filter(([, v]) => isValidDailyWin(v, day))
    .map(([uid, v]) => ({ uid, ...v }))
    .sort((a, b) => b.myScore !== a.myScore
      ? b.myScore - a.myScore
      : a.duration - b.duration)
    .slice(0, 10);
}
