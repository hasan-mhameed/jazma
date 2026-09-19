// 📄 presence.js
// نظام الحضور: يحدّث حالة المستخدم على Firebase ويقرأ حالات الآخرين
// الحالات: online (متصل) | playing (في مباراة) | away (انقطاع مؤقت) | offline (غير متصل)
import { getDatabase, ref, onValue, onDisconnect, update, serverTimestamp, off }
                            from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getCurrentUser, onUserChange } from "./auth.js?v=1789847044";

const db = getDatabase();

let _myUid = null;
let _myState = "online";
let _connUnsub = null;
const _watchers = new Map(); // uid -> unsubscribe

// ── تسجيل حضورنا ومتابعة الاتصال ────────────────────────────
// مهم: نربط التسجيل بتغيّر حالة الدخول — استدعاء واحد عند التشغيل يفشل
// لأن currentUser تكون null قبل اكتمال المصادقة
export function initPresence() {
  // نسجّل فوراً إن كان المستخدم جاهزاً
  const now = getCurrentUser();
  if (now?.uid) _startFor(now.uid);
  // ونتابع أي تغيّر لاحق (دخول/خروج/ترقية حساب ضيف)
  onUserChange((user) => {
    if (user?.uid) _startFor(user.uid);
    else { _myUid = null; if (_connUnsub) { try { _connUnsub(); } catch {} _connUnsub = null; } }
  });
}

function _startFor(uid) {
  if (_myUid === uid && _connUnsub) return; // مسجَّل بالفعل لنفس المستخدم
  _myUid = uid;

  const myRef = ref(db, `users/${_myUid}/presence`);
  const connRef = ref(db, ".info/connected");

  if (_connUnsub) { try { _connUnsub(); } catch {} }
  _connUnsub = onValue(connRef, (snap) => {
    if (snap.val() !== true) return; // غير متصل — Firebase سيكتب offline عبر onDisconnect
    // درس v29.8: onDisconnect يُستهلك بعد انطلاقه → نعيد تسجيله عند كل عودة اتصال
    onDisconnect(myRef).update({ state: "offline", lastSeen: serverTimestamp() });
    update(myRef, { state: _myState, lastSeen: serverTimestamp() }).catch(() => {});
  });
}

// تغيير حالتنا (مثلاً عند دخول مباراة أو الخروج منها)
export function setMyPresence(state) {
  _myState = state || "online";
  if (!_myUid) return;
  update(ref(db, `users/${_myUid}/presence`), {
    state: _myState, lastSeen: serverTimestamp(),
  }).catch(() => {});
}

// ── متابعة حضور مستخدم آخر ──────────────────────────────────
export function watchPresence(uid, cb) {
  if (!uid || _watchers.has(uid)) return;
  const r = ref(db, `users/${uid}/presence`);
  const unsub = onValue(r, (snap) => cb(snap.val() || { state: "offline", lastSeen: null }));
  _watchers.set(uid, () => { try { off(r); } catch {} unsub && unsub(); });
}

export function unwatchAllPresence() {
  _watchers.forEach(fn => { try { fn(); } catch {} });
  _watchers.clear();
}

// مهلة اعتبار الانقطاع "مؤقتاً" — مطابقة لمهلة السماح داخل المباراة
const GRACE_MS = 10000;

// الحالة المعروضة: نستنتج "انقطاع مؤقت" محلياً بدل انتظار كتابة من جهاز مقطوع
// (عند الانقطاع الفعلي لا يستطيع الجهاز الكتابة، فـ onDisconnect يكتب offline مباشرة)
export function displayState(p) {
  const st = p?.state || "offline";
  if (st !== "offline") return st;
  const ls = p?.lastSeen;
  if (typeof ls === "number" && (Date.now() - ls) < GRACE_MS) return "away";
  return "offline";
}

// ── أدوات العرض ─────────────────────────────────────────────
export const PRESENCE_META = {
  online:  { dot: "🟢", label: "متصل" },
  playing: { dot: "🔵", label: "في مباراة" },
  away:    { dot: "🟡", label: "انقطاع مؤقت" },
  offline: { dot: "⚫", label: "غير متصل" },
};

// نص "آخر ظهور" بصيغة مفهومة
export function lastSeenText(ts) {
  if (typeof ts !== "number") return "";
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1)  return "الآن";
  if (min < 60) return `قبل ${min} دقيقة`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `قبل ${hr} ساعة`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "أمس";
  if (day < 7)   return `قبل ${day} أيام`;
  return "قبل فترة طويلة";
}
