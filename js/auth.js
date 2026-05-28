// 📄 auth.js — v12.0
// إدارة تسجيل الدخول عبر Firebase Authentication

import { initializeApp, getApps }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
         createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
         signInAnonymously, linkWithPopup, linkWithCredential, EmailAuthProvider }
                                     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, set, get, update, remove }
                                     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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
  return result.user;
}

// ── ترقية الضيف بإيميل وكلمة سر ─────────────────────────────
export async function upgradeGuestWithEmail(name, email, password) {
  const credential = EmailAuthProvider.credential(email, password);
  const result     = await linkWithCredential(auth.currentUser, credential);
  await updateProfile(result.user, { displayName: name });
  await saveUserProfile(result.user);
  return result.user;
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
async function saveUserProfile(user) {
  const userRef = ref(db, `users/${user.uid}`);
  const snap    = await get(userRef);
  if (!snap.exists()) {
    await set(userRef, {
      uid:      user.uid,
      name:     user.displayName || "لاعب",
      email:    user.email,
      photo:    user.photoURL || "",
      joinedAt: Date.now(),
      friends:  {},
      stats: {
        ai:    { wins: 0, losses: 0 },
        local: { wins: 0, losses: 0 },
        online: {},
      },
    });
  } else {
    await update(userRef, { lastSeen: Date.now() });
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
  const key  = vsName
    ? `vs_${vsName.trim().toLowerCase().replace(/\s+/g, '_')}`
    : '__general__';
  const base = `users/${currentUser.uid}/stats/local/${key}`;
  // نحفظ الاسم مرة واحدة على المسار الرئيسي
  await update(ref(db, base), { name: vsName || '' });
  const r = result === 'win' ? 'w' : result === 'loss' ? 'l' : 'd';
  await _pushGame(base, r);
}

export async function updateOnlineStats(result, opponentUid, opponentName) {
  if (!currentUser || !opponentUid) return;
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
