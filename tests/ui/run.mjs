// تشغيل فحوص أمان النصوص والحساب (v36.0 — الخطوتان 1.10 و1.11):
//   npm test     (أو: node --experimental-vm-modules --no-warnings run.mjs [--only=كلمة])
// (1) الحارس الثابت: لا قيمة غير مُهرَّبة تُدرج في HTML في أي ملف من js/
// (2) العرض الحقيقي: كل واجهة تعرض أسماء/رسائل/أرقاماً يكتبها غيرنا، بكودها الحقيقي في صفحة اللعبة (jsdom)
// (3) اللعبة كاملة: main.js الحقيقي فوق Firebase وهمي — الدخول والخروج وتغيّر الحساب وترقية الضيف والأصدقاء
import { runGuard } from './guard.mjs';
import { guardProbes } from './guardProbes.mjs';
import { ALL } from './render.mjs';
import { APP_ALL } from './app.mjs';

const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
let bad = 0;

if (!only || 'الحارس'.includes(only) || only === 'guard') {
  console.log('\n🛡️ الحارس الثابت (كل ملفات js/)');
  const g = runGuard();
  const ok = !g.findings.length;
  console.log(`${ok ? '✅' : '❌'} لا قيمة غير آمنة تصل إلى HTML أو رابط أو CSS أو شيفرة — ${g.files} ملفاً، ${g.findings.length} موضع غير آمن`);
  g.findings.forEach(f => console.log('     ❌ ' + f));
  if (!ok) bad++;
  const pr = guardProbes();
  console.log(`${pr.fail ? '❌' : '✅'} ${pr.title} — ${pr.pass}/${pr.pass + pr.fail}`);
  pr.notes.forEach(n => console.log('     ' + n));
  if (pr.fail) bad++;
}

console.log('\n🔤 العرض الحقيقي بأسماء ورسائل خبيثة (jsdom + صفحة اللعبة)');
for (const t of ALL) {
  const r = await t();
  if (only && !r.title.includes(only) && only !== 'عرض') continue;
  console.log(`${r.fail ? '❌' : '✅'} ${r.title} — ${r.pass}/${r.pass + r.fail}`);
  r.notes.forEach(n => console.log('     ' + n));
  if (r.fail) bad++;
}

console.log('\n🎮 اللعبة كاملة (main.js الحقيقي فوق Firebase وهمي): الحساب والخروج والأصدقاء وأسماء الآخرين');
for (const t of APP_ALL) {
  const r = await t();
  if (only && !r.title.includes(only) && only !== 'اللعبة') continue;
  console.log(`${r.fail ? '❌' : '✅'} ${r.title} — ${r.pass}/${r.pass + r.fail}`);
  r.notes.forEach(n => console.log('     ' + n));
  if (r.fail) bad++;
}

console.log(bad ? `\n❌ فشل ${bad} فحص` : '\n✅ كل فحوص أمان النصوص والحساب نجحت');
process.exit(bad ? 1 : 0);
