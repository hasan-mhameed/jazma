// 📄 friends.js — v12.1
// نظام الأصدقاء الكامل

import { getDatabase, ref, get, update, onValue, remove }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getApps, initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getCurrentUser } from "./auth.js?v=1792364320";

const firebaseConfig = {
  apiKey:            "AIzaSyDnPrPobXSL8vc7Cr_AAVO6K03sc7gAgWA",
  authDomain:        "jazma-e17c5.firebaseapp.com",
  databaseURL:       "https://jazma-e17c5-default-rtdb.firebaseio.com",
  projectId:         "jazma-e17c5",
  storageBucket:     "jazma-e17c5.firebasestorage.app",
  messagingSenderId: "924710370216",
  appId:             "1:924710370216:web:99d697db3cfca06492fb9d",
};
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ─── البحث عن مستخدم بالاسم ──────────────────────────────────
export async function searchUsers(query) {
  const snap = await get(ref(db, "users"));
  if (!snap.exists()) return [];
  const results = [];
  snap.forEach(child => {
    const user = child.val();
    if (!user || typeof user !== "object") return;
    // v36.0: المعرّف هو مفتاح الملف — لا حقل uid بداخله (يكتبه صاحبه، وقد يغيب في ملف ناقص فيذهب الطلب لـ users/undefined)
    const uid = child.key;
    if (uid === getCurrentUser()?.uid) return; // استثني نفسك
    // v36.0: الاسم يكتبه صاحبه — قد لا يكون نصاً (رقم/مصفوفة) فكان toLowerCase يكسر البحث لكل المستخدمين
    if (String(user.name ?? "").toLowerCase().includes(String(query).toLowerCase())) {
      results.push({ ...user, uid });
    }
  });
  return results.slice(0, 10);
}

// ─── إرسال طلب صداقة ─────────────────────────────────────────
export async function sendFriendRequest(toUid) {
  const fromUid = getCurrentUser()?.uid;
  if (!fromUid) return;

  // تحقق إذا موجود مسبقاً
  const existing = await get(ref(db, `users/${toUid}/friendRequests/${fromUid}`));
  if (existing.exists()) return;

  const fromProfile = await get(ref(db, `users/${fromUid}`));
  const fromData    = fromProfile.val() || {};   // v36.0: ملف ناقص/غائب لا يكسر الإرسال

  await update(ref(db, `users/${toUid}/friendRequests/${fromUid}`), {
    uid:  fromUid,
    name: fromData.name ?? "لاعب",
    photo: fromData.photo || "",
    sentAt: Date.now(),
  });
}

// ─── قبول طلب صداقة ──────────────────────────────────────────
export async function acceptFriendRequest(fromUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;

  const fromSnap = await get(ref(db, `users/${fromUid}`));
  // v36.0: طلب بلا ملف لصاحبه (مفتاح وهمي أو حساب حُذف) طلبٌ بائد — يُحذف ولا تُكتب صداقة (مراجعة v36.0 الخامسة)
  if (!fromSnap.exists()) { await remove(ref(db, `users/${myUid}/friendRequests/${fromUid}`)); return; }
  const mySnap   = await get(ref(db, `users/${myUid}`));
  const fromData = fromSnap.val() || {};   // v36.0: ملف ناقص/غائب (طلب بمفتاح لا ملف له) لا يكسر القبول
  const myData   = mySnap.val() || {};

  // أضف كل واحد لقائمة أصدقاء الثاني
  await update(ref(db, `users/${myUid}/friends/${fromUid}`), {
    uid:   fromUid,
    name:  fromData.name ?? "لاعب",
    photo: fromData.photo || "",
    since: Date.now(),
  });
  await update(ref(db, `users/${fromUid}/friends/${myUid}`), {
    uid:   myUid,
    name:  myData.name ?? "لاعب",
    photo: myData.photo || "",
    since: Date.now(),
  });

  // احذف الطلب
  await remove(ref(db, `users/${myUid}/friendRequests/${fromUid}`));
}

// ─── رفض طلب صداقة ───────────────────────────────────────────
export async function rejectFriendRequest(fromUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  await remove(ref(db, `users/${myUid}/friendRequests/${fromUid}`));
}

// ─── حذف صديق ────────────────────────────────────────────────
export async function removeFriend(friendUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  await remove(ref(db, `users/${myUid}/friends/${friendUid}`));
  await remove(ref(db, `users/${friendUid}/friends/${myUid}`));
}

// v36.0: كل مدخل (صديق أو طلب صداقة) قد يكتبه الطرف الآخر — المعرّف من مفتاحه، لا من حقل uid داخله. كان طلب مخزَّن
// تحت مفتاح فلان ويدّعي uid غيره يجعل "قبول" يصادق شخصاً ثالثاً لم يطلب، وطلب بلا uid لا يُرفض أبداً (مراجعة v36.0 الرابعة)
export function entriesWithKey(val) {
  if (!val || typeof val !== "object") return [];
  return Object.entries(val)
    .filter(([, v]) => v && typeof v === "object")
    .map(([key, v]) => ({ ...v, uid: key }));
}

// ─── جلب قائمة الأصدقاء ──────────────────────────────────────
export async function getFriends() {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return [];
  const snap = await get(ref(db, `users/${myUid}/friends`));
  if (!snap.exists()) return [];
  return entriesWithKey(snap.val());
}

// ─── الاستماع لطلبات الصداقة الواردة ────────────────────────
export function listenFriendRequests(cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  const unsub = onValue(ref(db, `users/${myUid}/friendRequests`), (snap) => {
    const requests = snap.exists() ? entriesWithKey(snap.val()) : [];
    cb(requests);
  });
  return unsub;
}

// ─── الاستماع للأصدقاء ───────────────────────────────────────
export function listenFriends(cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  const unsub = onValue(ref(db, `users/${myUid}/friends`), (snap) => {
    const friends = snap.exists() ? entriesWithKey(snap.val()) : [];
    cb(friends);
  });
  return unsub;
}
