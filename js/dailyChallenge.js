// 📄 dailyChallenge.js
import { getDatabase, ref, get, set }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { currentUser } from "./auth.js?v=1783033864";

const db = getDatabase();

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
  const today = dateStr || new Date().toISOString().slice(0, 10);
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
  return new Date().toISOString().slice(0, 10);
}

// ── هل لعب اليوم؟ ─────────────────────────────────────────────────
export async function hasPlayedToday() {
  if (!currentUser) return false;
  const snap = await get(ref(db, `dailyChallenges/${todayStr()}/results/${currentUser.uid}`));
  return snap.exists();
}

// ── حفظ النتيجة ──────────────────────────────────────────────────
export async function saveDailyResult(result, myScore, oppScore, duration, displayName) {
  if (!currentUser) return;
  await set(ref(db, `dailyChallenges/${todayStr()}/results/${currentUser.uid}`), {
    result, myScore, oppScore, duration,
    name: displayName || 'لاعب',
    ts:   Date.now(),
  });
}

// ── leaderboard اليوم ─────────────────────────────────────────────
export async function getDailyLeaderboard() {
  const snap = await get(ref(db, `dailyChallenges/${todayStr()}/results`));
  if (!snap.exists()) return [];
  return Object.entries(snap.val())
    .map(([uid, v]) => ({ uid, ...v }))
    .filter(v => v.result === 'win')
    .sort((a, b) => b.myScore !== a.myScore
      ? b.myScore - a.myScore
      : a.duration - b.duration)
    .slice(0, 10);
}
