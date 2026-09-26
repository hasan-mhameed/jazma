// يجهّز نسخة من حزمة قاعدة البيانات تصدّر nodeFromJSON: الخادم الوهمي يحسب بها بصمة القيم (hash)
// بنفس طريقة الحزمة — فتُقبل المعاملات أو تُرفض كما عند Firebase الحقيقي.
import fs from 'node:fs';
const src = new URL('./node_modules/@firebase/database/dist/node-esm/index.node.esm.js', import.meta.url);
const dir = new URL('./.gen/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
// بلا تسجيل مكوّن "database": نسخة ثانية تسجّله أولاً كانت تجعل getDatabase تبني قاعدة من صنفها
// بينما ref/runTransaction من الحزمة الأصلية — خليط يتعطّل. هذه النسخة للبصمة فقط.
let code = fs.readFileSync(src, 'utf8');
if (!code.includes("registerDatabase('node');")) throw new Error('prepare.mjs: لم أجد registerDatabase');
code = code.replace("registerDatabase('node');", "/* registerDatabase('node') — محذوف: نسخة البصمة فقط */");
fs.writeFileSync(new URL('./sdk-hash.mjs', dir), code + '\nexport { nodeFromJSON as __nodeFromJSON };\n');
console.log('realsdk: .gen/sdk-hash.mjs جاهز');
