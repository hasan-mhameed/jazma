// 📄 core/wallet.js
// محفظة العملات الدائمة (تتراكم بين المباريات)

import { getDatabase, ref, get, set, runTransaction }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getCurrentUser } from "../auth.js?v=1782550166";

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
export async function commitMatchCoins() {
  const uid = getCurrentUser()?.uid;
  if (!uid || _matchCoins <= 0) return { earned: _matchCoins, total: await getCoins() };
  const earned = _matchCoins;
  const r = ref(db, `users/${uid}/coins`);
  await runTransaction(r, current => (current || 0) + earned);
  _matchCoins = 0;
  const total = await getCoins();
  return { earned, total };
}

// تحديث شارة العملات في الواجهة
export async function refreshCoinsBadge() {
  const el = document.getElementById('coins-count');
  if (!el) return;
  const total = await getCoins();
  el.textContent = total;
}
