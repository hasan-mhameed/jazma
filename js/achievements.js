// 📄 achievements.js
// تعريف الإنجازات + منطق الفتح + Firebase

import { getDatabase, ref, get, set }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { currentUser } from "./auth.js?v=1781998311";

const db = getDatabase();

// ── تعريف الإنجازات ──────────────────────────────────────────────
export const ACHIEVEMENTS = {
  first_win:     { icon: '🎯', name: 'أول فوز',           desc: 'فز بمبارتك الأولى' },
  first_online:  { icon: '🌐', name: 'أول مباراة أونلاين', desc: 'العب أونلاين لأول مرة' },
  ai_easy:       { icon: '🤖', name: 'قاهر المبتدئ',       desc: 'هزم AI على صعوبة سهل' },
  ai_medium:     { icon: '⚡', name: 'قاهر المتوسط',       desc: 'هزم AI على صعوبة متوسط' },
  ai_hard:       { icon: '💀', name: 'قاهر الآلة',         desc: 'هزم AI على صعوبة صعب' },
  win_streak_3:  { icon: '🔥', name: 'سلسلة نار',          desc: 'فز 3 مباريات متتالية' },
  win_streak_5:  { icon: '👑', name: 'لا يُهزم',           desc: 'فز 5 مباريات متتالية' },
  social_3:      { icon: '👥', name: 'اجتماعي',            desc: 'العب مع 3 أصدقاء مختلفين' },
  online_wins_5: { icon: '🏅', name: 'بطل الأونلاين',      desc: 'فز 5 مرات أونلاين' },
  total_10:      { icon: '🎮', name: 'متمرن',              desc: 'العب 10 مباريات' },
  total_50:      { icon: '⭐', name: 'محترف',              desc: 'العب 50 مباراة' },
  perfect_win:   { icon: '💎', name: 'مثالي',              desc: 'فز بفارق 5 نقاط أو أكثر' },
};

// ── جلب الإنجازات المفتوحة ────────────────────────────────────────
export async function getUnlocked(uid) {
  const snap = await get(ref(db, `users/${uid}/achievements`));
  return snap.exists() ? snap.val() : {};
}

// ── فتح إنجاز (يرجع true لو فُتح الآن لأول مرة) ─────────────────
async function unlock(key) {
  if (!currentUser) return false;
  const path = `users/${currentUser.uid}/achievements/${key}`;
  const snap = await get(ref(db, path));
  if (snap.exists()) return false;
  await set(ref(db, path), { unlockedAt: Date.now() });
  return true;
}

// ── التحقق بعد كل مباراة ─────────────────────────────────────────
export async function checkAchievements(matchData, allStats, historyCount) {
  if (!currentUser) return [];
  const { mode, result, myScore, oppScore, aiDifficulty, currentStreak } = matchData;
  const newlyUnlocked = [];

  async function tryUnlock(key) {
    if (await unlock(key)) newlyUnlocked.push(key);
  }

  // أول فوز
  if (result === 'win') await tryUnlock('first_win');

  // AI — بنتحقق من الصعوبة الفعلية بس
  if (mode === 'ai' && result === 'win') {
    if (aiDifficulty === 'easy')      await tryUnlock('ai_easy');
    if (aiDifficulty === 'medium')    await tryUnlock('ai_medium');
    if (aiDifficulty === 'nightmare') await tryUnlock('ai_hard');
  }

  // أول أونلاين
  if (mode === 'online') await tryUnlock('first_online');

  // مثالي — فارق 5+
  if (result === 'win' && (myScore - oppScore) >= 5) await tryUnlock('perfect_win');

  // 5 انتصارات أونلاين — من history فقط
  if (mode === 'online' && result === 'win') {
    const onlineWins = Object.values(allStats.online || {}).reduce((sum, v) => {
      if (!v?.history) return sum;
      return sum + Object.values(v.history).filter(r => r.r === 'w').length;
    }, 0);
    if (onlineWins >= 5) await tryUnlock('online_wins_5');
  }

  // اجتماعي — نحسب من matchHistory (بيانات حقيقية بس)
  const histSnap = await get(ref(db, `users/${currentUser.uid}/matchHistory`));
  if (histSnap.exists()) {
    const histMatches = Object.values(histSnap.val());
    const uniqueOpponents = new Set(
      histMatches
        .filter(m => m.vs && m.mode !== 'ai')
        .map(m => m.vs.toLowerCase().trim())
    );
    if (uniqueOpponents.size >= 3) await tryUnlock('social_3');
  }

  // إجمالي المباريات
  if (historyCount >= 10) await tryUnlock('total_10');
  if (historyCount >= 50) await tryUnlock('total_50');

  // سلسلة انتصارات — من streak المحسوب من history فقط
  if (currentStreak >= 3) await tryUnlock('win_streak_3');
  if (currentStreak >= 5) await tryUnlock('win_streak_5');

  return newlyUnlocked;
}

// ── تحديث السلسلة في Firebase بعد كل مباراة ─────────────────────
export async function updateStreak(result) {
  if (!currentUser) return 0;
  const streakRef = ref(db, `users/${currentUser.uid}/stats/currentStreak`);
  const snap      = await get(streakRef);
  const current   = snap.exists() ? snap.val() : 0;
  let newStreak;
  if (result === 'win')        newStreak = current + 1;
  else                         newStreak = 0; // خسارة أو تعادل يكسر السلسلة
  await set(streakRef, newStreak);
  return newStreak;
}

// ── جلب السلسلة الحالية ────────────────────────────────────────
export async function getCurrentStreak(uid) {
  const snap = await get(ref(db, `users/${uid}/stats/currentStreak`));
  return snap.exists() ? snap.val() : 0;
}

// ── إجمالي المباريات ──────────────────────────────────────────────
export async function getTotalMatches(uid) {
  const snap = await get(ref(db, `users/${uid}/matchHistory`));
  return snap.exists() ? Object.keys(snap.val()).length : 0;
}
