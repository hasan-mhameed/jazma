// 📄 chat.js — v12.5
import { getDatabase, ref, push, onValue, update, get, query, limitToLast, orderByChild, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getApps, initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getCurrentUser } from "./auth.js?v=1794502787";

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
// 3.3ج-1: آخر الرسائل بوقتها (ts — من الخادم) لا بمفتاحها: مفاتيح push يختارها الكاتب، فكان صديقٌ يكتب رسائل بمفاتيح
// تُرتَّب بعد كل الحقيقية يُخرج الجديدة من نافذة آخر 100 للأبد. والوقت نفسه من الخادم، والقواعد لا تقبل وقتاً أبعد من
// دقائق في المستقبل (رسالة "من المستقبل" كانت تبقى "الأخيرة" فتُسكت إشعاراته وتعلّق عدّاد غير المقروء)
const lastMessages = (key, n) => query(ref(db, `chats/${key}`), orderByChild("ts"), limitToLast(n));

// ─── إرسال رسالة ─────────────────────────────────────────────
// 3.3أ-3: القواعد تعرف طرفي المحادثة من مفتاحها (chatKey) — لا يقرؤها ولا يكتب فيها غيرهما؛ والرسالة الجديدة
// لصديق فقط (يحملني في قائمته) وباسمي الحقيقي (fromUid)، ولا تُعدَّل بعد إرسالها، والمستلم يغيّر status فقط.
// الحقول المقبولة: fromUid وfromName وtext وts وstatus — أي حقل جديد يحتاج سطراً في القواعد أولاً.
export async function sendMessage(toUid, text) {
  const from = getCurrentUser();
  if (!from || !text.trim()) return;
  const key = chatKey(from.uid, toUid);
  const msgRef = await push(ref(db, `chats/${key}`), {
    fromUid:   from.uid,
    fromName:  from.displayName || "لاعب",
    text:      text.trim(),
    ts:        serverTimestamp(),   // 3.3ج-1: وقت الخادم (الترتيب والإشعارات)
    status:    "sent", // sent → delivered → read
  });
  return msgRef.key;
}

// ─── تعليم الرسائل كـ delivered ──────────────────────────────
export function markDelivered(toUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  const key = chatKey(myUid, toUid);
  const q   = lastMessages(key, 50);
  get(q).then(snap => {
    const updates = {};
    snap.forEach(child => {
      const msg = child.val();
      if (msg.fromUid !== myUid && msg.status === "sent") {
        updates[`chats/${key}/${child.key}/status`] = "delivered";
      }
    });
    if (Object.keys(updates).length > 0) return update(ref(db), updates);
  }).catch(e => console.debug("markDelivered", e?.code || e));   // 3.3أ-3: لا رفض صامت غير مُعالَج
}

// ─── تعليم الرسائل كـ read ────────────────────────────────────
// 3.3ج-1 (مراجعة): "قرأتُ حتى" = وقت أحدث رسالة **رأيتها** (upToTs — وقت خادم كأوقات الرسائل)، لا لحظة الكتابة: كتابة
// بوقت الخادم وأنا بلا شبكة تنتظر حتى أعود فتأخذ وقت عودتي — فتُعدّ رسائل وصلت في غيابي مقروءة وأنا لم أرها.
// بلا upToTs (لا رسائل معروفة بعد) لا نكتب شيئاً — أول لقطة للمحادثة تكتبه.
// ولا يرجع للوراء (مراجعة ج-1، الجولة 3): القواعد ترفض قيمة أقدم من المخزّنة (جهاز بنسخة محلية أقدم كان يُرجع رسائل قرأها
// جهاز آخر "غير مقروءة")؛ وهنا لا نعيد كتابة ما لا يتقدّم على آخر ما كتبته هذه الصفحة (chatUI يستدعي markAsRead
// وmarkRead معاً في كل لقطة، فكانت القيمة نفسها تُكتب مرتين كل مرة)
const _wroteLastRead = new Map();
const writeLastRead = (myUid, key, upToTs) => {
  if (typeof upToTs !== "number" || !isFinite(upToTs)) return;
  const k = `${myUid}/${key}`;
  if (_wroteLastRead.get(k) >= upToTs) return;
  _wroteLastRead.set(k, upToTs);
  update(ref(db), { [`users/${myUid}/lastRead/${key}`]: upToTs }).catch(e => console.debug("lastRead", e?.code || e));
};
export function markRead(toUid, upToTs) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  const key = chatKey(myUid, toUid);
  // نخزّن آخر قراءة في Firebase (يتبع الحساب على أي جهاز)
  writeLastRead(myUid, key, upToTs);
  const q = lastMessages(key, 50);
  get(q).then(snap => {
    const updates = {};
    snap.forEach(child => {
      const msg = child.val();
      if (msg.fromUid !== myUid && msg.status !== "read") {
        updates[`chats/${key}/${child.key}/status`] = "read";
      }
    });
    if (Object.keys(updates).length > 0) return update(ref(db), updates);
  }).catch(e => console.debug("markRead", e?.code || e));   // 3.3أ-3: لا رفض صامت غير مُعالَج
}

// ─── الاستماع للرسائل ────────────────────────────────────────
export function listenMessages(toUid, cb) {
  const from = getCurrentUser();
  if (!from) return () => {};
  const key = chatKey(from.uid, toUid);
  const chatQuery = lastMessages(key, 100);
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
    const q        = lastMessages(key, 50);
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

export function markAsRead(toUid, upToTs) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  writeLastRead(myUid, chatKey(myUid, toUid), upToTs);
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
