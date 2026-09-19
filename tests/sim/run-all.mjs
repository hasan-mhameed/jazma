// تشغيل كل فحوص المحاكي: node --experimental-vm-modules --no-warnings run-all.mjs [عدد_الجلسات_العشوائية] [-v]
import { rejoinTwo, waiterFlow, groupCountdown, noSearchDuringMatch, fuzzOne } from './scenarios.mjs';

const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 100);
const verbose = process.argv.includes('-v');
let bad = 0;

for (const run of [() => rejoinTwo(true, verbose), () => rejoinTwo(false, verbose), () => waiterFlow(verbose),
                   () => groupCountdown(verbose), () => noSearchDuringMatch(verbose)]) {
  const r = await run();
  console.log(`${r.fail ? '❌' : '✅'} ${r.title} — ${r.pass}/${r.pass + r.fail}`);
  r.notes.forEach(n => console.log('     ' + n));
  if (r.fail) bad++;
}

process.stdout.write(`\n🎲 مستكشف عشوائي (${N} جلسة، 3 لاعبين): `);
let fz = 0;
for (let s = 1; s <= N; s++) {
  const { findings } = await fuzzOne(s);
  if (findings.length) { fz++; console.log(`\n   seed ${s}: ${findings.join(' ؛ ')}`); }
  else if (s % 10 === 0) process.stdout.write('.');
}
console.log(`\n${fz ? '❌' : '✅'} المستكشف: ${N - fz}/${N} جلسة سليمة`);
if (fz) bad++;
console.log(bad ? `\n❌ فشل ${bad} فحص` : '\n✅ كل الفحوص نجحت');
process.exit(bad ? 1 : 0);
