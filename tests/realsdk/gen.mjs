// يولّد لكل جهاز نسخة من js/firebase.js الحقيقي موصولة بالخادم الوهمي المحلي (لا تلمس Firebase الحقيقي):
// الاستيرادات من حزمة npm بدل الرابط، مصادقة وهمية للجهاز، وconnectDatabaseEmulator على المنفذ المحلي.
// JAZAM_FIREBASE_JS: ملف firebase.js آخر (لفحص الطفرات: النسخة القديمة يجب أن تفشل)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
    `const db = getDatabase(app); connectDatabaseEmulator(db, "localhost", ${port}, { mockUserToken: { sub: "u${dev}" } });\n` +
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
    `const db = getDatabase(app); connectDatabaseEmulator(db, "localhost", ${port}, { mockUserToken: { sub: "u${dev}" } });\n` +
    `export const __off = () => __gOff(db); export const __on = () => __gOn(db);`);
  const out = path.join(HERE, '.gen', `inv_${dev}_${port}.mjs`);
  fs.writeFileSync(out, s);
  return out;
}

// auth.js (v36.0 — الخطوة 1.11، مراجعة 1.11 الثالثة): نسخة لكل جهاز — قاعدة البيانات من الحزمة الحقيقية موصولة
// بالخادم الوهمي (أو بوسيط يضيف تأخير الشبكة)، والمصادقة بديل صغير (لا خادم مصادقة محلي): إنشاء حساب يطلق
// onAuthStateChanged فوراً، وupdateProfile رحلة للخادم بمدة globalThis.__UPDATE_PROFILE_MS.
// JAZAM_AUTH_JS: ملف auth.js آخر (لفحص الطفرات)
// uid: هوية الجهاز عند الخادم (قواعد الأمان — v36.1): معرّف الحساب الذي سيُنشأ
export function genAuth(dev, port, uid = 'u' + dev) {
  let s = fs.readFileSync(process.env.JAZAM_AUTH_JS || path.join(PROJECT, 'js/auth.js'), 'utf8');
  const rep = (re, to) => { if (!re.test(s)) throw new Error('genAuth: لم أجد ' + re); s = s.replace(re, to); };
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app\.js"/, 'from "firebase/app"');
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-auth\.js"/, `from "./fakeauth_${dev}_${port}.mjs"`);
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-database\.js"/, 'from "firebase/database"');
  rep(/const app\s+= getApps\(\)\.length \? getApps\(\)\[0\] : initializeApp\(firebaseConfig\);/,
    `import { connectDatabaseEmulator } from "firebase/database";\n` +
    `const app = initializeApp({ ...firebaseConfig, databaseURL: "http://localhost:${port}?ns=jazam" }, "auth_${dev}_${port}");`);
  rep(/const db\s+= getDatabase\(app\);/, `const db = getDatabase(app); connectDatabaseEmulator(db, "localhost", ${port}, { mockUserToken: { sub: ${JSON.stringify(uid)} } });`);
  // v36.1 (1.12): مفتاح الإحصائيات من ملف المشروع نفسه (وحدة نقية بلا استيرادات) — النسخ القديمة بلا هذا الاستيراد
  s = s.replace(/from "\.\/core\/statsKey\.js(\?v=\d+)?"/, `from "${pathToFileURL(path.join(PROJECT, 'js/core/statsKey.js')).href}"`);
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

// friends.js (v36.1 — الخطوة 1.13): نسخة لكل جهاز موصولة بالخادم الوهمي بهويته (قواعد الأمان تُطبَّق عليها)،
// ومعها __db لكتابات "يدوية" في الفحص (محاولات دخول غير مشروعة بالحزمة نفسها)
// uid: هوية الصفحة (صفحتان بالحساب نفسه = uid واحد بجهازين مختلفين)؛ src: ملف friends.js بعينه (نسخة سابقة من
// tests/fixtures لفحص تعايش النسخ). JAZAM_FRIENDS_JS: ملف friends.js آخر للكل (لفحص الطفرات)
export function genFriends(dev, port, { uid = 'u' + dev, src = null } = {}) {
  const dir = path.join(HERE, '.gen');
  fs.mkdirSync(dir, { recursive: true });
  const authMod = `fauth_${dev}_${port}.mjs`;
  fs.writeFileSync(path.join(dir, authMod), `export function getCurrentUser() { return { uid: ${JSON.stringify(uid)}, displayName: ${JSON.stringify(dev)} }; }\n`);
  let s = fs.readFileSync(src || process.env.JAZAM_FRIENDS_JS || path.join(PROJECT, 'js/friends.js'), 'utf8');
  const rep = (re, to) => { if (!re.test(s)) throw new Error('genFriends: لم أجد ' + re); s = s.replace(re, to); };
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-database\.js"/, 'from "firebase/database"');
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app\.js"/, 'from "firebase/app"');
  rep(/from "\.\/auth\.js(\?v=\d+)?"/, `from "./${authMod}"`);
  rep(/const app = getApps\(\)\.length \? getApps\(\)\[0\] : initializeApp\(firebaseConfig\);/,
    `import { connectDatabaseEmulator, goOffline as __gOff, goOnline as __gOn } from "firebase/database";\n` +
    `const app = initializeApp({ ...firebaseConfig, databaseURL: "http://localhost:${port}?ns=jazam" }, "fr_${dev}_${port}");`);
  rep(/const db\s+= getDatabase\(app\);/,
    `const db = getDatabase(app); connectDatabaseEmulator(db, "localhost", ${port}, { mockUserToken: { sub: ${JSON.stringify(uid)} } });\n` +
    `export const __db = db; export const __off = () => __gOff(db); export const __on = () => __gOn(db);`);
  const out = path.join(HERE, '.gen', `fr_${dev}_${port}.mjs`);
  fs.writeFileSync(out, s);
  return out;
}

// presence.js (v36.1 — الخطوة 1.14): نسخة لكل صفحة موصولة بالخادم الوهمي بهوية حسابها (صفحتان بالحساب نفسه = هوية واحدة
// وتطبيقا Firebase مستقلان)، والمصادقة بديل صغير: __setUser(user) يطلق onUserChange كما يفعل auth.js.
// src: ملف presence.js بعينه (نسخة سابقة من tests/fixtures). JAZAM_PRESENCE_JS: ملف آخر للكل (لفحص الطفرات)
export function genPresence(dev, port, uid, { src = null } = {}) {
  let s = fs.readFileSync(src || process.env.JAZAM_PRESENCE_JS || path.join(PROJECT, 'js/presence.js'), 'utf8');
  const rep = (re, to) => { if (!re.test(s)) throw new Error('genPresence: لم أجد ' + re); s = s.replace(re, to); };
  const dir = path.join(HERE, '.gen');
  fs.mkdirSync(dir, { recursive: true });
  const authMod = `pauth_${dev}_${port}.mjs`;
  fs.writeFileSync(path.join(dir, authMod),
    `let cur = null; const ls = new Set();\n` +
    `export function getCurrentUser() { return cur; }\n` +
    `export function onUserChange(cb) { ls.add(cb); return () => ls.delete(cb); }\n` +
    `export function __setUser(u) { cur = u; for (const cb of [...ls]) cb(u); }\n`);
  rep(/from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-database\.js"/, 'from "firebase/database"');
  rep(/from "\.\/auth\.js(\?v=\d+)?"/, `from "./${authMod}"`);
  rep(/const db = getDatabase\(\);/,
    `import { initializeApp as __initApp } from "firebase/app";\n` +
    `import { connectDatabaseEmulator, goOffline as __gOff, goOnline as __gOn } from "firebase/database";\n` +
    `export { __setUser } from "./${authMod}";\n` +
    `const __app = __initApp({ apiKey: "fake", projectId: "jazam", databaseURL: "http://localhost:${port}?ns=jazam" }, "pr_${dev}_${port}");\n` +
    `const db = getDatabase(__app); connectDatabaseEmulator(db, "localhost", ${port}, { mockUserToken: { sub: ${JSON.stringify(uid)} } });\n` +
    `export const __db = db; export const __off = () => __gOff(db); export const __on = () => __gOn(db);`);
  const out = path.join(dir, `pr_${dev}_${port}.mjs`);
  fs.writeFileSync(out, s);
  return out;
}
