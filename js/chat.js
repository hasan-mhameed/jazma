// 📄 chat.js — v12.4 Production Ready

import { getDatabase, ref, push, onValue, off, serverTimestamp, query, limitToLast }
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

function chatKey(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

export async function sendMessage(toUid, text) {
  const from = getCurrentUser();
  if (!from || !text.trim()) return;
  const key = chatKey(from.uid, toUid);
  await push(ref(db, `chats/${key}`), {
    fromUid:  from.uid,
    fromName: from.displayName || "لاعب",
    text:     text.trim(),
    ts:       serverTimestamp(),
  });
}

export function listenMessages(toUid, cb) {
  const from = getCurrentUser();
  if (!from) return () => {};
  const key = chatKey(from.uid, toUid);
  const chatQuery = query(ref(db, `chats/${key}`), limitToLast(100));
  const listener = onValue(chatQuery, (snap) => {
    const messages = [];
    snap.forEach(child => messages.push({ id: child.key, ...child.val() }));
    messages.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    cb(messages);
  });
  return () => off(chatQuery);
}

export function listenUnread(friends, cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  const unsubs = [];
  const unreadMap = {};
  friends.forEach(friend => {
    const key      = chatKey(myUid, friend.uid);
    const lastRead = parseInt(localStorage.getItem(`lastRead_${key}`) || "0");
    const chatQuery = query(ref(db, `chats/${key}`), limitToLast(50));
    onValue(chatQuery, (snap) => {
      let count = 0;
      snap.forEach(child => {
        const msg = child.val();
        if (msg.fromUid !== myUid && (msg.ts || 0) > lastRead) count++;
      });
      unreadMap[friend.uid] = count;
      cb(Object.values(unreadMap).reduce((a, b) => a + b, 0));
    });
    unsubs.push(() => off(chatQuery));
  });
  return () => unsubs.forEach(fn => fn());
}

export function markAsRead(toUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  const key = chatKey(myUid, toUid);
  localStorage.setItem(`lastRead_${key}`, Date.now().toString());
}
