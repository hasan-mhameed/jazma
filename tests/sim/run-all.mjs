// تشغيل كل فحوص المحاكي:
//   node --experimental-vm-modules --no-warnings run-all.mjs [عدد_الجلسات_العشوائية] [-v] [--only=كلمة]
import * as S from './scenarios.mjs';
import * as RS from './results.mjs';

const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 100);
const verbose = process.argv.includes('-v');
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
let bad = 0, knownTotal = 0;

const sections = [
  ['🎲 البحث الجماعي العشوائي', [
    () => S.rejoinTwo(true, verbose), () => S.rejoinTwo(false, verbose), () => S.waiterFlow(verbose),
    () => S.groupCountdown(verbose), () => S.noSearchDuringMatch(verbose), () => S.randomHostClosesTab(verbose)]],
  ['👥 4 لاعبين', [() => S.fourFull(verbose), () => S.fourWaiterFills(verbose), () => S.fourWantThree(verbose)]],
  ['🔑 الغرفة بالكود', [
    () => S.codeBasics(verbose), () => S.codeStartTwoAndLimits(verbose), () => S.codeHostLeaves(verbose),
    () => S.codeSeatReuse(verbose), () => S.codeExHostRejoins(verbose), () => S.codeHostClosesTab(verbose),
    () => S.abandonedRoomIgnored(verbose)]],
  ['⚔️ البحث الثنائي', [() => S.duoBasics(verbose), () => S.duoCancel(verbose), () => S.duoRaces(verbose)]],
  ['🏁 نافذة نهاية المباراة', [() => RS.resultsPure(verbose), () => RS.resultsEndGame(verbose)]],
];

for (const [title, runs] of sections) {
  if (only && !title.includes(only)) continue;
  console.log(`\n${title}`);
  for (const run of runs) {
    const r = await run();
    const icon = r.fail ? '❌' : (r.known ? '⚠️' : '✅');
    console.log(`${icon} ${r.title} — ${r.pass}/${r.pass + r.fail + r.known}`);
    r.notes.forEach(n => console.log('     ' + n));
    if (r.fail) bad++;
    knownTotal += r.known;
  }
}

async function explore(label, count, fn) {
  process.stdout.write(`\n🔎 ${label} (${count} جلسة): `);
  let fz = 0;
  for (let s = 1; s <= count; s++) {
    const { findings } = await fn(s);
    if (findings.length) { fz++; console.log(`\n   seed ${s}: ${findings.join(' ؛ ')}`); }
    else if (s % 10 === 0) process.stdout.write('.');
  }
  console.log(`\n${fz ? '❌' : '✅'} ${label}: ${count - fz}/${count} سليمة`);
  if (fz) bad++;
}
if (!only || only === 'مستكشف') {
  await explore('مستكشف البحث الجماعي — 3 لاعبين', N, s => S.fuzzOne(s, false, 3));
  await explore('مستكشف البحث الجماعي — 4 لاعبين', Math.ceil(N / 2), s => S.fuzzOne(s, false, 4));
  await explore('مستكشف الغرفة بالكود — 4 لاعبين', Math.ceil(N / 2), s => S.fuzzCode(s));
}

console.log(bad ? `\n❌ فشل ${bad} فحص` : '\n✅ كل الفحوص نجحت'
  + (knownTotal ? ` (مع ${knownTotal} خلل معروف موثّق للدفعة التالية ⚠️)` : ''));
process.exit(bad ? 1 : 0);
