// 📄 history.js
// حفظ وجلب تاريخ المباريات من Firebase

import { getDatabase, ref, push, get, query, orderByKey, limitToLast }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { currentUser } from "./auth.js?v=1782473608";

const db = getDatabase();
const PAGE_SIZE = 20;

// ── حفظ مباراة ───────────────────────────────────────────────────
export async function saveMatch(data) {
  if (!currentUser) return;
  const { mode, result, myScore, oppScore, vs, grid, duration } = data;
  await push(ref(db, `users/${currentUser.uid}/matchHistory`), {
    mode,        // 'ai' | 'local' | 'online' | 'multi'
    result,      // 'win' | 'loss' | 'draw'
    myScore:  myScore  || 0,
    oppScore: oppScore || 0,
    vs:       vs       || '',
    grid:     grid     || '4x4',
    duration: duration || 0,
    ts:       Date.now(),
  });
}

// ── جلب أول صفحة ────────────────────────────────────────────────
export async function fetchHistory(uid, afterKey = null) {
  const base = ref(db, `users/${uid}/matchHistory`);
  const q    = afterKey
    ? query(base, orderByKey(), limitToLast(PAGE_SIZE + 1))
    : query(base, orderByKey(), limitToLast(PAGE_SIZE));

  const snap = await get(q);
  if (!snap.exists()) return { matches: [], hasMore: false };

  const all = Object.entries(snap.val())
    .map(([key, val]) => ({ key, ...val }))
    .sort((a, b) => b.ts - a.ts);   // الأحدث أولاً

  const hasMore = all.length > PAGE_SIZE;
  return {
    matches: hasMore ? all.slice(0, PAGE_SIZE) : all,
    hasMore,
    lastKey: all[all.length - 1]?.key,
  };
}
