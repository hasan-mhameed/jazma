// 📄 friends.js — v12.1
// نظام الأصدقاء الكامل

import { getDatabase, ref, get, update, onValue, remove }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getApps, initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getCurrentUser } from "./auth.js?v=1781646243";

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
    if (user.uid === getCurrentUser()?.uid) return; // استثني نفسك
    if (user.name?.toLowerCase().includes(query.toLowerCase())) {
      results.push(user);
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
  const fromData    = fromProfile.val();

  await update(ref(db, `users/${toUid}/friendRequests/${fromUid}`), {
    uid:  fromUid,
    name: fromData.name,
    photo: fromData.photo || "",
    sentAt: Date.now(),
  });
}

// ─── قبول طلب صداقة ──────────────────────────────────────────
export async function acceptFriendRequest(fromUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;

  const fromSnap = await get(ref(db, `users/${fromUid}`));
  const mySnap   = await get(ref(db, `users/${myUid}`));
  const fromData = fromSnap.val();
  const myData   = mySnap.val();

  // أضف كل واحد لقائمة أصدقاء الثاني
  await update(ref(db, `users/${myUid}/friends/${fromUid}`), {
    uid:   fromUid,
    name:  fromData.name,
    photo: fromData.photo || "",
    since: Date.now(),
  });
  await update(ref(db, `users/${fromUid}/friends/${myUid}`), {
    uid:   myUid,
    name:  myData.name,
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

// ─── جلب قائمة الأصدقاء ──────────────────────────────────────
export async function getFriends() {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return [];
  const snap = await get(ref(db, `users/${myUid}/friends`));
  if (!snap.exists()) return [];
  return Object.values(snap.val());
}

// ─── الاستماع لطلبات الصداقة الواردة ────────────────────────
export function listenFriendRequests(cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  const unsub = onValue(ref(db, `users/${myUid}/friendRequests`), (snap) => {
    const requests = snap.exists() ? Object.values(snap.val()) : [];
    cb(requests);
  });
  return unsub;
}

// ─── الاستماع للأصدقاء ───────────────────────────────────────
export function listenFriends(cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  const unsub = onValue(ref(db, `users/${myUid}/friends`), (snap) => {
    const friends = snap.exists() ? Object.values(snap.val()) : [];
    cb(friends);
  });
  return unsub;
}
