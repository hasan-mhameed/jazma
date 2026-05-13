// 📄 chat.js — v12.4
import { getDatabase, ref, push, onValue, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getApps, initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getCurrentUser } from "./auth.js";

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

// ─── مفتاح المحادثة (نفسه لكلا الطرفين) ─────────────────────
function chatKey(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

// ─── إرسال رسالة ─────────────────────────────────────────────
export async function sendMessage(toUid, text) {
  const from = getCurrentUser();
  console.log("📤 sendMessage:", { fromUid: from?.uid, toUid, text });
  if (!from || !text.trim()) return;
  const key = chatKey(from.uid, toUid);
  console.log("🔑 key:", key);
  await push(ref(db, `chats/${key}`), {
    fromUid:  from.uid,
    fromName: from.displayName || "لاعب",
    text:     text.trim(),
    ts:       Date.now(),
  });
  console.log("✅ sent");
}

// ─── الاستماع للرسائل ────────────────────────────────────────
export function listenMessages(toUid, cb) {
  const from = getCurrentUser();
  console.log("👂 listenMessages:", { fromUid: from?.uid, toUid });
  if (!from) return () => {};
  const key  = chatKey(from.uid, toUid);
  console.log("🔑 listening on:", key);
  const unsub = onValue(ref(db, `chats/${key}`), (snap) => {
    console.log("📨 received:", snap.val());
    const messages = [];
    snap.forEach(child => messages.push({ id: child.key, ...child.val() }));
    cb(messages);
  });
  return unsub;
}

// ─── الاستماع للرسائل الجديدة (badge) ───────────────────────
export function listenUnread(friends, cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  const unsubs = [];
  let unreadCount = 0;
  const unreadMap = {};

  friends.forEach(friend => {
    const key = chatKey(myUid, friend.uid);
    const lastRead = parseInt(localStorage.getItem(`lastRead_${key}`) || "0");
    const unsub = onValue(ref(db, `chats/${key}`), (snap) => {
      let count = 0;
      snap.forEach(child => {
        const msg = child.val();
        if (msg.fromUid !== myUid && msg.ts > lastRead) count++;
      });
      unreadMap[friend.uid] = count;
      const total = Object.values(unreadMap).reduce((a,b) => a+b, 0);
      cb(total);
    });
    unsubs.push(unsub);
  });

  return () => unsubs.forEach(u => u());
}

// ─── تعليم المحادثة كمقروءة ──────────────────────────────────
export function markAsRead(toUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  const key = chatKey(myUid, toUid);
  localStorage.setItem(`lastRead_${key}`, Date.now().toString());
}
