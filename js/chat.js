// 📄 chat.js — v12.5
import { getDatabase, ref, push, onValue, update, get, query, limitToLast }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getApps, initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getCurrentUser } from "./auth.js?v=1782829249";

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

function chatKey(uid1, uid2) { return [uid1, uid2].sort().join("_"); }

// ─── إرسال رسالة ─────────────────────────────────────────────
export async function sendMessage(toUid, text) {
  const from = getCurrentUser();
  if (!from || !text.trim()) return;
  const key = chatKey(from.uid, toUid);
  const msgRef = await push(ref(db, `chats/${key}`), {
    fromUid:   from.uid,
    fromName:  from.displayName || "لاعب",
    text:      text.trim(),
    ts:        Date.now(),
    status:    "sent", // sent → delivered → read
  });
  return msgRef.key;
}

// ─── تعليم الرسائل كـ delivered ──────────────────────────────
export function markDelivered(toUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  const key = chatKey(myUid, toUid);
  const q   = query(ref(db, `chats/${key}`), limitToLast(50));
  get(q).then(snap => {
    const updates = {};
    snap.forEach(child => {
      const msg = child.val();
      if (msg.fromUid !== myUid && msg.status === "sent") {
        updates[`chats/${key}/${child.key}/status`] = "delivered";
      }
    });
    if (Object.keys(updates).length > 0) update(ref(db), updates);
  });
}

// ─── تعليم الرسائل كـ read ────────────────────────────────────
export function markRead(toUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  const key = chatKey(myUid, toUid);
  // نخزّن آخر قراءة في Firebase (يتبع الحساب على أي جهاز)
  update(ref(db), { [`users/${myUid}/lastRead/${key}`]: Date.now() });
  const q = query(ref(db, `chats/${key}`), limitToLast(50));
  get(q).then(snap => {
    const updates = {};
    snap.forEach(child => {
      const msg = child.val();
      if (msg.fromUid !== myUid && msg.status !== "read") {
        updates[`chats/${key}/${child.key}/status`] = "read";
      }
    });
    if (Object.keys(updates).length > 0) update(ref(db), updates);
  });
}

// ─── الاستماع للرسائل ────────────────────────────────────────
export function listenMessages(toUid, cb) {
  const from = getCurrentUser();
  if (!from) return () => {};
  const key = chatKey(from.uid, toUid);
  const chatQuery = query(ref(db, `chats/${key}`), limitToLast(100));
  const unsubscribe = onValue(chatQuery, (snap) => {
    const messages = [];
    snap.forEach(child => {
      const val = child.val();
      const ts  = typeof val.ts === "number" ? val.ts : 0;
      messages.push({ id: child.key, ...val, ts });
    });
    messages.sort((a, b) => a.ts - b.ts);
    cb(messages);
  });
  return unsubscribe;
}

// ─── الاستماع لعدد الرسائل غير المقروءة ─────────────────────
// ─── (قديمة — لم تعد مستخدمة، messagesUI يستخدم Firebase الآن) ─
export function listenUnread(friends, cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  const unsubs   = [];
  const unreadMap = {};
  friends.forEach(friend => {
    const key      = chatKey(myUid, friend.uid);
    const lastRead = 0;
    const q        = query(ref(db, `chats/${key}`), limitToLast(50));
    const unsubscribe = onValue(q, (snap) => {
      let count = 0;
      snap.forEach(child => {
        const msg = child.val();
        if (msg.fromUid !== myUid && (msg.ts || 0) > lastRead) count++;
      });
      unreadMap[friend.uid] = count;
      cb(Object.values(unreadMap).reduce((a, b) => a + b, 0));
    });
    unsubs.push(unsubscribe);
  });
  return () => unsubs.forEach(fn => fn());
}

export function markAsRead(toUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  const key = chatKey(myUid, toUid);
  update(ref(db), { [`users/${myUid}/lastRead/${key}`]: Date.now() });
}

// ─── جلب خريطة آخر قراءة من Firebase ─────────────────────────
export async function getLastReadMap() {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return {};
  const snap = await get(ref(db, `users/${myUid}/lastRead`));
  return snap.exists() ? snap.val() : {};
}

// ─── الاستماع لآخر قراءة (live) ──────────────────────────────
export function listenLastRead(cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  return onValue(ref(db, `users/${myUid}/lastRead`), snap => {
    cb(snap.exists() ? snap.val() : {});
  });
}

export { chatKey };
