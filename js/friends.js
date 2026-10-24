// 📄 friends.js — v12.1 (أُعيد بناء الإرسال والقبول والحذف في v36.1 — الخطوة 1.13)
// نظام الأصدقاء الكامل — يعمل مع قواعد الأمان في database.rules.json (كل واحد يكتب في ملفه، وفي ملف غيره ما يخصّه فقط)

import { getDatabase, ref, get, update, onValue, remove }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getApps, initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getCurrentUser } from "./auth.js?v=1792834692";

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
  // 3.3أ (الخصوصية): البحث من الملفات العامة profiles (الاسم/الصورة/الخبرة) — users صار لصاحبه وحده
  const snap = await get(ref(db, "profiles"));
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
// v36.1 (الخطوة 1.13): كتابة واحدة ذرّية — الطلب في صندوق المستقبل + دليل الطلب في ملفي (sentRequests/<المستقبل>).
// قواعد الأمان لا تسمح لأحد أن يضيف نفسه لقائمة غيره إلا بهذا الدليل، وهو في ملف المرسل وحده فلا يزوّره أحد
// (صندوق المستقبل يملكه هو). فشل الكتابة يصل من يستدعيها: الواجهة تقول "لم يُرسل" — كانت تقول "أُرسل" قبل الكتابة.
export async function sendFriendRequest(toUid) {
  const fromUid = getCurrentUser()?.uid;
  if (!fromUid || !toUid || toUid === fromUid) throw new Error("طلب صداقة غير صالح");
  const fromData = (await get(ref(db, `users/${fromUid}`))).val() || {};   // ملف ناقص/غائب لا يكسر الإرسال
  const at = Date.now();
  await update(ref(db), {
    [`users/${toUid}/friendRequests/${fromUid}`]: {
      uid: fromUid,                       // للنسخ القديمة فقط — الجديدة تأخذ المعرّف من المفتاح
      name: fromData.name ?? "لاعب",
      photo: fromData.photo || "",
      sentAt: at,
    },
    [`users/${fromUid}/sentRequests/${toUid}`]: at,
  });
}

// ─── قبول طلب صداقة ──────────────────────────────────────────
// v36.1: الطرفان وحذف الطلب واستهلاك دليله بكتابة واحدة — صداقة كاملة أو لا شيء (لا صداقة من طرف واحد أبداً)،
// والدليل إذنٌ لمرة واحدة: بعد القبول لا يعيد به أحدٌ نفسه لقائمة المرسل (القواعد تسمح للمستقبل بحذفه فقط).
// يرجع { ok: true } أو { ok: false, reason }: "gone" صاحب الطلب لا ملف له؛ "stale" طلب بلا دليل في ملف مرسله
// (من نسخة قبل v36.1) — لا يمكن إتمامه، فيُحذف ويُطلب من صاحبه إرساله من جديد.
export async function acceptFriendRequest(fromUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid || !fromUid) throw new Error("طلب صداقة غير صالح");
  // 3.3أ: لا نقرأ ملف المرسل الكامل (صار لصاحبه وحده). اسمه وصورته من طلبه في صندوقي (كتبهما هو عند الإرسال)،
  // والدليل وصداقته لي من مسارين تسمح القاعدة لي بقراءتهما: sentRequests/<أنا> وfriends/<أنا> في ملفه
  const [mySnap, proofSnap, fromFriendsMe] = await Promise.all([
    get(ref(db, `users/${myUid}`)),
    get(ref(db, `users/${fromUid}/sentRequests/${myUid}`)),
    get(ref(db, `users/${fromUid}/friends/${myUid}`)),
  ]);
  const myData   = mySnap.val() || {};
  const reqEntry = (myData.friendRequests && myData.friendRequests[fromUid]) || null;
  const dropRequest = () => remove(ref(db, `users/${myUid}/friendRequests/${fromUid}`));
  if (!proofSnap.exists()) {
    // قُبل للتو من صفحة أخرى لي (القبول يستهلك الدليل) والصداقة قائمة من الطرفين: لا شيء ناقص
    if (isEntry(myData.friends?.[fromUid]) && isEntry(fromFriendsMe.val())) { await dropRequest(); return { ok: true }; }
    // لم يعد في صندوقي: حُسم من صفحة أخرى (رُفض) — بطاقة قديمة
    if (!isEntry(reqEntry)) return { ok: false, reason: "gone" };
    // طلب في صندوقي بلا دليل: نسخة قبل v36.1 — يُحذف ويُطلب إرساله من جديد
    await dropRequest();
    return { ok: false, reason: "stale" };
  }
  const since = Date.now();
  try {
    await update(ref(db), {
      [`users/${myUid}/friends/${fromUid}`]: { uid: fromUid, name: reqEntry?.name ?? "لاعب", photo: reqEntry?.photo || "", since },
      [`users/${fromUid}/friends/${myUid}`]: { uid: myUid, name: myData.name ?? "لاعب", photo: myData.photo || "", since },
      [`users/${myUid}/friendRequests/${fromUid}`]: null,
      [`users/${fromUid}/sentRequests/${myUid}`]: null,
    });
  } catch (e) {
    // قبولان بنفس اللحظة من صفحتين لي: الأول استهلك الدليل فرُفض الثاني — والصداقة قائمة من الطرفين: نجاح لا خطأ
    const [mine, theirs] = await Promise.all([
      get(ref(db, `users/${myUid}/friends/${fromUid}`)),
      get(ref(db, `users/${fromUid}/friends/${myUid}`)),
    ]).catch(() => [null, null]);
    if (mine?.exists() && theirs?.exists()) { await dropRequest().catch(() => {}); return { ok: true }; }
    throw e;
  }
  return { ok: true };
}
const isEntry = v => !!v && typeof v === "object";

// ─── رفض طلب صداقة ───────────────────────────────────────────
// v36.1: ومعه دليل الطلب في ملف مرسله (إذنه ينتهي برفضه) — خطوة ثانية لا تُفشل الرفض: طلب قديم بلا دليل، أو
// القواعد القديمة قبل نشر الجديدة (ترفض حذفه)، لا يضرّ بقاؤه
export async function rejectFriendRequest(fromUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid || !fromUid) throw new Error("طلب صداقة غير صالح");
  await remove(ref(db, `users/${myUid}/friendRequests/${fromUid}`));
  await remove(ref(db, `users/${fromUid}/sentRequests/${myUid}`)).catch(() => {});
}

// ─── حذف صديق ────────────────────────────────────────────────
// v36.1: من الطرفين بكتابة واحدة (كانت كتابتين: الثانية ترفضها القواعد فتبقى صداقة من طرف واحد بصمت)، ومعها
// سحب طلبي إليه إن بقي (من صندوقه، ودليله من ملفي) — فلا يعيد نفسه لقائمتي بطلب قديم، ولا يقبل طلباً سحبته
export async function removeFriend(friendUid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid || !friendUid) throw new Error("صديق غير صالح");
  await update(ref(db), {
    [`users/${myUid}/friends/${friendUid}`]: null,
    [`users/${friendUid}/friends/${myUid}`]: null,
    [`users/${friendUid}/friendRequests/${myUid}`]: null,
    [`users/${myUid}/sentRequests/${friendUid}`]: null,
  });
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

// ─── طلباتي القائمة (لم يُقبل أو يُرفض بعد) ─────────────────────
// v36.2 (1.15): مفاتيح users/<أنا>/sentRequests — بطاقة البحث تقول "✅ أُرسل" ما دام الطلب قائماً، وتعود
// "➕ إضافة" إن رُفض أو سحبته، ولو أُعيد البحث أو فُتحت اللوحة من جديد (من القاعدة لا من ذاكرة الصفحة)
export function listenSentRequests(cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  return onValue(ref(db, `users/${myUid}/sentRequests`), (snap) => {
    const v = snap.val();
    cb(v && typeof v === "object" ? Object.keys(v) : []);
  });
}

// هل أنا في قائمته؟ (صداقة من الطرفين — v36.2: بطاقة البحث بعد قبول طلب إصلاح صداقة من طرف واحد)
export async function isMutualFriend(uid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid || !uid) return false;
  return isEntry((await get(ref(db, `users/${uid}/friends/${myUid}`))).val());
}

// هل طلبي الصادر ما زال في صندوقه؟ (3.3أ: أقرأ مدخلي أنا وحده في صندوق طلباته — friendRequests/<أنا>).
// دليلٌ بقي في ملفي بلا طلب في صندوقه (رفضته نسخة أقدم فلم يستهلك الدليل) لا يُبقي بطاقة البحث "✅ أُرسل" للأبد
export async function isRequestPending(uid) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid || !uid) return false;
  return isEntry((await get(ref(db, `users/${uid}/friendRequests/${myUid}`))).val());
}

// ─── الاستماع للأصدقاء ───────────────────────────────────────
// v36.1: ومعه تنظيف أدلة الطلبات — دليل طلبي لمن صارت الصداقة معه من الطرفين أدّى مهمته، فيُسحب ولا يبقى إذنٌ مفتوح
// يعيد به نفسه لقائمتي بعد أن أحذفه (القبول من v36.1 يستهلكه بنفسه؛ هذا لما قبلته نسخة أقدم). صديقٌ في قائمتي وحدها
// (صداقة من طرف واحد من v36.0) أرسلت له طلباً لإصلاحها: دليله باقٍ حتى يقبل — كان التنظيف يمحوه فوراً (مراجعة v36.1)
const _sweeping = new Set();   // مفاتيح قيد الفحص — المستمع مشترك بين واجهتين في الصفحة
export function listenFriends(cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  let friendsVal = null, sentVal = null;
  const sweep = () => {
    if (!friendsVal || !sentVal || typeof sentVal !== "object") return;
    for (const k of Object.keys(sentVal)) {
      if (!isEntry(friendsVal[k]) || _sweeping.has(k)) continue;
      _sweeping.add(k);
      get(ref(db, `users/${k}/friends/${myUid}`))
        .then(s => (isEntry(s.val()) ? remove(ref(db, `users/${myUid}/sentRequests/${k}`)) : null))
        .catch(() => {})
        .finally(() => _sweeping.delete(k));
    }
  };
  const unsubFriends = onValue(ref(db, `users/${myUid}/friends`), (snap) => {
    friendsVal = snap.val() || {};
    cb(entriesWithKey(friendsVal));
    sweep();
  });
  const unsubSent = onValue(ref(db, `users/${myUid}/sentRequests`), (snap) => {
    sentVal = snap.val() || {};
    sweep();
  });
  return () => { unsubFriends(); unsubSent(); };
}
