// 📄 auth.js — v12.0
// إدارة تسجيل الدخول عبر Firebase Authentication

import { initializeApp, getApps }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
                                     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, set, get, update }
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

// ─── تسجيل الدخول بـ Google ──────────────────────────────────
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result   = await signInWithPopup(auth, provider);
  return result.user;
}

// ─── تسجيل الخروج ────────────────────────────────────────────
export async function logout() {
  await signOut(auth);
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
    // مستخدم جديد
    await set(userRef, {
      uid:      user.uid,
      name:     user.displayName || "لاعب",
      email:    user.email,
      photo:    user.photoURL || "",
      wins:     0,
      losses:   0,
      joinedAt: Date.now(),
      friends:  {},
    });
  } else {
    // حدّث آخر ظهور
    await update(userRef, { lastSeen: Date.now() });
  }
}

// ─── جلب ملف مستخدم ──────────────────────────────────────────
export async function getUserProfile(uid) {
  const snap = await get(ref(db, `users/${uid}`));
  return snap.exists() ? snap.val() : null;
}

// ─── تحديث اسم المستخدم ──────────────────────────────────────
export async function updateDisplayName(newName) {
  if (!currentUser) return;
  await update(ref(db, `users/${currentUser.uid}`), { name: newName });
}
