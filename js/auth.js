// 📄 auth.js — v12.0
// إدارة تسجيل الدخول عبر Firebase Authentication

import { initializeApp, getApps }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
         createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
         signInAnonymously, linkWithPopup, linkWithCredential, EmailAuthProvider }
                                     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, update, remove }
                                     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { localStatsKey, isSafeKey }   from "./core/statsKey.js?v=1792621208";

const firebaseConfig = {
  apiKey:            "AIzaSyDnPrPobXSL8vc7Cr_AAVO6K03sc7gAgWA",
  authDomain:        "jazma-e17c5.firebaseapp.com",
  databaseURL:       "https://jazma-e17c5-default-rtdb.firebaseio.com",
  projectId:         "jazma-e17c5",
  storageBucket:     "jazma-e17c5.firebasestorage.app",
  messagingSenderId: "924710370216",
  appId:             "1:924710370216:web:99d697db3cfca06492fb9d",
};

// نستخدم نفس الـ app إذا كان موجود
const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

export let currentUser = null;
export function getCurrentUser() { return currentUser; }

// ─── تسجيل بـ Google ──────────────────────────────────────────
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result   = await signInWithPopup(auth, provider);
  return result.user;
}

// ─── تسجيل حساب جديد بإيميل ─────────────────────────────────
export async function registerWithEmail(name, email, password) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, { displayName: name });
  // v36.0 (1.11): الدخول يحفظ الملف فور إنشاء الحساب — غالباً قبل أن يصل الاسم فيُحفظ "لاعب". نعيد الحفظ بعد وصوله:
  // يُنشئ الملف كاملاً إن لم يوجد بعد، أو يصحّح "لاعب". لا كتابة جزئية مستقلة هنا: على اتصال بارد (أول دخول) تُرسَل
  // الكتابات المعلّقة قبل القراءات المعلّقة، فكانت كتابة الاسم وحده تجعل الملف "موجوداً" ناقصاً بلا uid (مراجعة v36.0 الثالثة)
  try { await saveUserProfile(result.user); } catch {}
  return result.user;
}

// ─── تسجيل دخول بإيميل ───────────────────────────────────────
export async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

// ─── تسجيل الخروج ────────────────────────────────────────────
export async function logout() {
  await signOut(auth);
}

// ── دخول كضيف ────────────────────────────────────────────────
export async function loginAsGuest() {
  const result = await signInAnonymously(auth);
  return result.user;
}

// ── ترقية الضيف لحساب Google ─────────────────────────────────
export async function upgradeGuestWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result   = await linkWithPopup(auth.currentUser, provider);
  await saveUserProfile(result.user);
  await syncProfileIdentity(result.user);
  return result.user;
}

// ── ترقية الضيف بإيميل وكلمة سر ─────────────────────────────
export async function upgradeGuestWithEmail(name, email, password) {
  const credential = EmailAuthProvider.credential(email, password);
  const result     = await linkWithCredential(auth.currentUser, credential);
  await updateProfile(result.user, { displayName: name });
  await saveUserProfile(result.user);
  await syncProfileIdentity(result.user, name);
  return result.user;
}

// v36.0 (الخطوة 1.11): الاسم والصورة في الملف العام من الحساب نفسه — بعد ترقية الضيف (ملفه أُنشئ باسم "لاعب"،
// و saveUserProfile لا يحدّث ملفاً موجوداً) وبعد التسجيل بإيميل (الملف يُحفظ قبل وصول الاسم). كان يبقى "لاعب" عند
// الأصدقاء وفي البحث. (والاسم في حساب الدخول نفسه إن بقي فارغاً بعد ربط Google — يظهر في الشريط والدعوات.)
// لا إيميل هنا: الملف العام يقرؤه كل من يبحث عن صديق. وإن فشلت الكتابة، يصحّحها saveUserProfile في الدخول التالي.
async function syncProfileIdentity(user, name = "") {
  try {
    const g = (user.providerData || []).find(p => p && p.providerId === "google.com") || {};
    const displayName = String(name || user.displayName || g.displayName || "").trim();
    const photo = user.photoURL || g.photoURL || "";
    if (displayName && !user.displayName) {
      await updateProfile(user, { displayName, ...(photo && !user.photoURL ? { photoURL: photo } : {}) }).catch(() => {});
    }
    const patch = {};
    if (displayName) patch.name = displayName;
    if (photo) patch.photo = photo;
    if (Object.keys(patch).length) await update(ref(db, `users/${user.uid}`), patch);
  } catch {}
}

// ── هل المستخدم ضيف؟ ─────────────────────────────────────────
export function isGuest() {
  return auth.currentUser?.isAnonymous ?? false;
}

// ─── الاستماع لحالة الدخول ───────────────────────────────────
export function onUserChange(cb) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) await saveUserProfile(user);
    cb(user);
  });
}

// ─── حفظ/تحديث ملف المستخدم في DB ───────────────────────────
const NEW_STATS = () => ({ ai: { wins: 0, losses: 0 }, local: { wins: 0, losses: 0 } });
async function saveUserProfile(user) {
  const userRef = ref(db, `users/${user.uid}`);
  const snap    = await get(userRef);
  const cur     = snap.exists() ? snap.val() : null;
  if (!cur || typeof cur !== "object") {
    // ملف جديد — دمج لا استبدال (v36.0): لا يمحو ما كُتب تحته للتوّ (كحالة الحضور لحظة الاتصال)
    await update(userRef, {
      uid:      user.uid,
      name:     user.displayName || "لاعب",
      email:    user.email,
      photo:    user.photoURL || "",
      joinedAt: Date.now(),
      stats:    NEW_STATS(),
    });
  } else {
    const patch = { lastSeen: Date.now() };
    // v36.0 (1.11): ملف ناقص (كتابة جزئية سبقت إنشاءه) تُكمَل حقوله الأساسية دون مسّ الموجود
    if (cur.uid !== user.uid) patch.uid = user.uid;
    if (!cur.joinedAt) patch.joinedAt = Date.now();
    // stats ناقصة: أوراقها فقط (لا استبدال العقدة كلها — نتيجة مباراة كُتبت للتوّ من جهاز آخر لا تضيع)
    if (!cur.stats) Object.assign(patch, { "stats/ai/wins": 0, "stats/ai/losses": 0, "stats/local/wins": 0, "stats/local/losses": 0 });
    // واسم "لاعب" المؤقت (ضيف ترقّى، أو تسجيل سبق حفظُ ملفه وصولَ الاسم) أو صورة ناقصة تُصحَّح من الحساب
    const accName = String(user.displayName || "").trim();
    if (accName && (!cur.name || cur.name === "لاعب")) patch.name = accName;
    if (user.photoURL && !cur.photo) patch.photo = user.photoURL;
    await update(userRef, patch);
  }
}

// ─── جلب ملف مستخدم ──────────────────────────────────────────
export async function getUserProfile(uid) {
  const snap = await get(ref(db, `users/${uid}`));
  return snap.exists() ? snap.val() : null;
}

// ─── تحديث إحصائيات AI ───────────────────────────────────────
// r: 'w' | 'l' | 'd'  (نضغط الحجم — كل record 1 حرف + timestamp)
function _pushGame(basePath, r) {
  const ts = Date.now();
  return update(ref(db, `${basePath}/history/${ts}`), { r });
}

export async function updateAIStats(result) {
  if (!currentUser) return;
  const r = result === 'win' ? 'w' : result === 'loss' ? 'l' : 'd';
  await _pushGame(`users/${currentUser.uid}/stats/ai`, r);
}

export async function updateLocalStats(result, vsName) {
  if (!currentUser) return;
  // v36.1 (1.12): مفتاح آمن — الاسم كما كُتب كان يُستعمل مفتاحاً (". # $ [ ]" تُفشل الحفظ، و"/" يقسم المسار)
  const base = `users/${currentUser.uid}/stats/local/${localStatsKey(vsName)}`;
  // نحفظ الاسم مرة واحدة على المسار الرئيسي
  await update(ref(db, base), { name: vsName || '' });
  const r = result === 'win' ? 'w' : result === 'loss' ? 'l' : 'd';
  await _pushGame(base, r);
}

export async function updateOnlineStats(result, opponentUid, opponentName) {
  // v36.1 (1.12): معرّف الخصم من قائمة لاعبي الغرفة (يكتبه هو) — يصير مفتاحاً فقط إن كان معرّفاً سليماً
  if (!currentUser || !isSafeKey(opponentUid)) return;
  const base = `users/${currentUser.uid}/stats/online/${opponentUid}`;
  await update(ref(db, base), { name: opponentName || opponentUid });
  const r = result === 'win' ? 'w' : result === 'loss' ? 'l' : 'd';
  await _pushGame(base, r);
}

// ─── جلب كل الإحصائيات ───────────────────────────────────────
export async function getAllStats(uid) {
  const snap = await get(ref(db, `users/${uid}/stats`));
  return snap.exists() ? snap.val() : { ai: {}, local: {}, online: {} };
}

// ─── للتوافق مع الكود القديم ──────────────────────────────────
export async function updateStats(won) {
  const result = won === true ? 'win' : won === false ? 'loss' : won;
  await updateAIStats(result);
}

// ─── تحديث اسم المستخدم ──────────────────────────────────────
export async function updateDisplayName(newName) {
  if (!currentUser) return;
  await update(ref(db, `users/${currentUser.uid}`), { name: newName });
}

// type: 'ai' | 'local' | 'online'
// key:  null للـ AI، أو مفتاح الخصم (vs_سيمو أو uid)
export async function resetStats(type, key) {
  if (!currentUser) return;
  const path = key
    ? `users/${currentUser.uid}/stats/${type}/${key}`
    : `users/${currentUser.uid}/stats/${type}`;
  await remove(ref(db, path));
}

// ─── إحصائيات متعدد اللاعبين (3-4) ──────────────────────────
// rank: مركزك (1=أول)، players: عدد اللاعبين، score: نقاطك
export async function updateMultiStats(rank, players, score) {
  if (!currentUser) return;
  const ts = Date.now();
  await update(
    ref(db, `users/${currentUser.uid}/stats/multi/history/${ts}`),
    { rank, players, score }
  );
}
