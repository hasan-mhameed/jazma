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
