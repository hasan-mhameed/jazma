// 📄 core/wallet.js
// محفظة العملات الدائمة (تتراكم بين المباريات)

import { getDatabase, ref, get, set, runTransaction }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getCurrentUser } from "../auth.js?v=1794502787";

const db = getDatabase();

// عملات كُسبت في المباراة الحالية (مؤقت — يُضاف للمحفظة عند النهاية)
let _matchCoins = 0;

export function resetMatchCoins() { _matchCoins = 0; }
export function addMatchCoins(n)  { _matchCoins += n; }
export function getMatchCoins()   { return _matchCoins; }

// جلب الرصيد الدائم
export async function getCoins() {
  const uid = getCurrentUser()?.uid;
  if (!uid) return 0;
  const snap = await get(ref(db, `users/${uid}/coins`));
  return snap.exists() ? (snap.val() || 0) : 0;
}

// إضافة عملات المباراة للرصيد الدائم (عند نهاية المباراة)
// 3.3ج-4: القواعد لا تقبل أكثر من 100 في الكتابة الواحدة (أعلى مكسب حقيقي 75: لوحة 6×6 كلها جواهر) — فوقها كانت
// تُرفض كلها؛ غرفة بلوحة أكبر (إعداد غير عادي) تأخذ 100 (مراجعة ج-4)
const COINS_STEP_MAX = 100;
export async function commitMatchCoins() {
  const uid = getCurrentUser()?.uid;
  if (!uid || _matchCoins <= 0) return { earned: _matchCoins, total: await getCoins() };
  const earned = Math.min(_matchCoins, COINS_STEP_MAX);
  const r = ref(db, `users/${uid}/coins`);
  await runTransaction(r, current => (current || 0) + earned);
  _matchCoins = 0;
  const total = await getCoins();
  return { earned, total };
}

// خصم عملات من الرصيد الدائم (لشراء أدوات) — يرجّع true لو نجح
export async function spendCoins(amount) {
  const uid = getCurrentUser()?.uid;
  if (!uid || amount <= 0) return false;
  let ok = false;
  const r = ref(db, `users/${uid}/coins`);
  await runTransaction(r, current => {
    const cur = current || 0;
    if (cur < amount) { ok = false; return cur; } // رصيد غير كافٍ
    ok = true;
    return cur - amount;
  });
  if (ok) refreshCoinsBadge();
  return ok;
}

// تحديث شارة العملات في الواجهة
export async function refreshCoinsBadge() {
  const el = document.getElementById('coins-count');
  if (!el) return;
  const total = await getCoins();
  el.textContent = total;
}
