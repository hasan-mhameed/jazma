// يولّد لكل جهاز نسخة من js/firebase.js الحقيقي موصولة بالخادم الوهمي المحلي (لا تلمس Firebase الحقيقي):
// الاستيرادات من حزمة npm بدل الرابط، مصادقة وهمية للجهاز، وconnectDatabaseEmulator على المنفذ المحلي.
// JAZAM_FIREBASE_JS: ملف firebase.js آخر (لفحص الطفرات: النسخة القديمة يجب أن تفشل)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.JAZAM_DIR || path.resolve(HERE, '../..');
const SRC = process.env.JAZAM_FIREBASE_JS || path.join(PROJECT, 'js/firebase.js');

export function gen(dev, port) {
  let s = fs.readFileSync(SRC, 'utf8');
  const rep = (re, to) => { if (!re.test(s)) throw new Error('gen.mjs: لم أجد ' + re); s = s.replace(re, to); };
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app\.js"/, 'from "firebase/app"');
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-database\.js"/, 'from "firebase/database"');
  rep(/from "\.\/auth\.js(\?v=\d+)?"/, `from "./auth_${dev}.mjs"`);
  rep(/const app = initializeApp\(firebaseConfig\);/,
    `import { connectDatabaseEmulator, goOffline as __gOff, goOnline as __gOn } from "firebase/database";\n` +
    `const app = initializeApp({ ...firebaseConfig, databaseURL: "http://localhost:${port}?ns=jazam" }, "${dev}_${port}");`);
  rep(/const db\s+= getDatabase\(app\);/,
    `const db = getDatabase(app); connectDatabaseEmulator(db, "localhost", ${port});\n` +
    `export const __off = () => __gOff(db); export const __on = () => __gOn(db);`);
  const dir = path.join(HERE, '.gen');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `fb_${dev}_${port}.mjs`);
  fs.writeFileSync(out, s);
  fs.writeFileSync(path.join(dir, `auth_${dev}.mjs`), `export function getCurrentUser() { return { uid: "u${dev}", displayName: "${dev}" }; }\n`);
  return out;
}

// invite.js (v35.9 — الخطوة 1.8): نسخة لكل جهاز موصولة بالخادم الوهمي (تطبيق Firebase مستقل لكل جهاز).
// JAZAM_INVITE_JS: ملف invite.js آخر (لفحص الطفرات)
export function genInvite(dev, port) {
  gen(dev, port);   // يكتب auth_<dev>.mjs
  let s = fs.readFileSync(process.env.JAZAM_INVITE_JS || path.join(PROJECT, 'js/invite.js'), 'utf8');
  const rep = (re, to) => { if (!re.test(s)) throw new Error('genInvite: لم أجد ' + re); s = s.replace(re, to); };
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app\.js"/, 'from "firebase/app"');
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-database\.js"/, 'from "firebase/database"');
  rep(/from "\.\/auth\.js(\?v=\d+)?"/, `from "./auth_${dev}.mjs"`);
  rep(/const app = getApps\(\)\.length \? getApps\(\)\[0\] : initializeApp\(firebaseConfig\);/,
    `import { connectDatabaseEmulator, goOffline as __gOff, goOnline as __gOn } from "firebase/database";\n` +
    `const app = initializeApp({ ...firebaseConfig, databaseURL: "http://localhost:${port}?ns=jazam" }, "inv_${dev}_${port}");`);
  rep(/const db\s+= getDatabase\(app\);/,
    `const db = getDatabase(app); connectDatabaseEmulator(db, "localhost", ${port});\n` +
    `export const __off = () => __gOff(db); export const __on = () => __gOn(db);`);
  const out = path.join(HERE, '.gen', `inv_${dev}_${port}.mjs`);
  fs.writeFileSync(out, s);
  return out;
}

// auth.js (v36.0 — الخطوة 1.11، مراجعة 1.11 الثالثة): نسخة لكل جهاز — قاعدة البيانات من الحزمة الحقيقية موصولة
// بالخادم الوهمي (أو بوسيط يضيف تأخير الشبكة)، والمصادقة بديل صغير (لا خادم مصادقة محلي): إنشاء حساب يطلق
// onAuthStateChanged فوراً، وupdateProfile رحلة للخادم بمدة globalThis.__UPDATE_PROFILE_MS.
// JAZAM_AUTH_JS: ملف auth.js آخر (لفحص الطفرات)
export function genAuth(dev, port) {
  let s = fs.readFileSync(process.env.JAZAM_AUTH_JS || path.join(PROJECT, 'js/auth.js'), 'utf8');
  const rep = (re, to) => { if (!re.test(s)) throw new Error('genAuth: لم أجد ' + re); s = s.replace(re, to); };
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app\.js"/, 'from "firebase/app"');
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-auth\.js"/, `from "./fakeauth_${dev}_${port}.mjs"`);
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-database\.js"/, 'from "firebase/database"');
  rep(/const app\s+= getApps\(\)\.length \? getApps\(\)\[0\] : initializeApp\(firebaseConfig\);/,
    `import { connectDatabaseEmulator } from "firebase/database";\n` +
    `const app = initializeApp({ ...firebaseConfig, databaseURL: "http://localhost:${port}?ns=jazam" }, "auth_${dev}_${port}");`);
  rep(/const db\s+= getDatabase\(app\);/, `const db = getDatabase(app); connectDatabaseEmulator(db, "localhost", ${port});`);
  const dir = path.join(HERE, '.gen');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `fakeauth_${dev}_${port}.mjs`), `
const listeners = new Set(); let current = null;
const later = fn => setTimeout(fn, 0);
export function getAuth() { return { get currentUser() { return current; } }; }
export class GoogleAuthProvider {}
export const EmailAuthProvider = { credential: (email, password) => ({ providerId: "password", email, password }) };
export function onAuthStateChanged(_a, cb) { listeners.add(cb); later(() => cb(current)); return () => listeners.delete(cb); }
const notify = () => { for (const cb of [...listeners]) later(() => cb(current)); };
export async function createUserWithEmailAndPassword(_a, email) {
  current = { uid: "uid_" + String(email).replace(/\\W/g, "_"), email, displayName: null, photoURL: null, isAnonymous: false, providerData: [] };
  notify(); return { user: current };
}
export async function updateProfile(user, p) { await new Promise(r => setTimeout(r, globalThis.__UPDATE_PROFILE_MS || 0)); Object.assign(user, p); }
export async function signInWithEmailAndPassword() { throw new Error("n/a"); }
export async function signInWithPopup() { throw new Error("n/a"); }
export async function signInAnonymously() { throw new Error("n/a"); }
export async function signOut() { current = null; notify(); }
export async function linkWithPopup() { throw new Error("n/a"); }
export async function linkWithCredential() { throw new Error("n/a"); }
`);
  const out = path.join(dir, `auth_real_${dev}_${port}.mjs`);
  fs.writeFileSync(out, s);
  return out;
}
