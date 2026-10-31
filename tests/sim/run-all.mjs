// تشغيل كل فحوص المحاكي:
//   node --experimental-vm-modules --no-warnings run-all.mjs [عدد_الجلسات_العشوائية] [-v] [--only=كلمة]
import * as S from './scenarios.mjs';
import * as RS from './results.mjs';
import * as IV from './invites.mjs';
import * as TS from './textsafety.mjs';
import * as RM from './rooms.mjs';

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
  ['⚔️ البحث الثنائي', [() => S.duoBasics(verbose), () => S.duoCancel(verbose), () => S.duoRaces(verbose),
    () => S.duoJoinerCancels(verbose), () => S.duoCancelMidSearch(verbose), () => S.duoHostVanishes(verbose),
    () => S.duoHostClosesAtCreate(verbose), () => S.duoCancelThenClose(verbose), () => S.duoHostBlip(verbose),
    () => S.duoCodeRaces(verbose)]],
  ['🚪 نهايات الانسحاب', [
    () => S.duoWithdrawEnding(verbose), () => S.duoDropEnding(verbose), () => S.duoRealDrop(verbose), () => S.duoLongDrop(verbose),
    () => S.duoSecondMatch(verbose), () => S.multiLastStanding(verbose), () => S.multiLateMark(verbose)]],
  ['🚷 الخروج من مباراة جماعية جارية', [
    () => S.multiOutDropped(verbose), () => S.multiOutTime(verbose), () => S.multiExitOrder(verbose),
    () => S.multiOutWatchToEnd(verbose), () => S.multiOutNaturalEndWhileAway(verbose), () => S.multiNearSimultaneousExits(verbose),
    () => S.multiTimeoutThenQuickExit(verbose), () => S.multiNoSelfExpiry(verbose),
    () => S.multiCreatorDrops(verbose), () => S.multiWithdrawSilent(verbose)]],
  ['🏁 نافذة نهاية المباراة', [() => RS.resultsPure(verbose), () => RS.resultsEndGame(verbose), () => RS.resultsExitEndings(verbose),
    () => RS.resultsElimination(verbose)]],
  ['🎮 دعوات الأصدقاء', [() => IV.inviteAcceptAndAgain(verbose), () => IV.inviteReject(verbose), () => IV.inviteStaleReply(verbose),
    () => IV.inviteCancelled(verbose), () => IV.inviteBusy(verbose), () => IV.inviteFromWaiting(verbose),
    () => IV.inviteInviterBlip(verbose), () => IV.inviteExpires(verbose), () => IV.inviteOneAtATime(verbose),
    () => IV.inviteReviewFixes(verbose), () => IV.inviteDuringPendingOp(verbose)]],
  ['🟢 الحضور', [() => IV.presenceFollowsMatch(verbose), () => IV.presenceHeals(verbose)]],
  ['🔤 أمان النصوص', [() => TS.namesInSearchAndVote(verbose), () => TS.namesInCodeLobby(verbose), () => TS.roomMaxIsText(verbose)]],
  ['🔐 تحضير قفل الغرف (3.3ب-1)', [() => RM.lobbyLeaveUnderMemberRules(verbose), () => RM.roomCodeCollision(verbose)]],
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
  await explore('مستكشف البحث الثنائي — 3 لاعبين (بحث/إلغاء/إغلاق داخل نوافذ السباق)', N, s => S.fuzzDuo(s));
  await explore('مستكشف دعوات الأصدقاء — 3 أصدقاء (دعوة/قبول/رفض/إلغاء/بحث/انقطاع/إغلاق)', Math.ceil(N / 2), s => IV.fuzzInvites(s));
}

// رفض القواعد خلال التشغيل كله (3.3ب-1): مُجمَّع بنمط المسار — كل سطر هنا كتابة/قراءة رفضتها القواعد ومرّت بصمت
{
  const { ALL_DENIED, RULES } = await import('./harness.mjs');
  const pat = p => String(p).replace(/uid_[^/]+/g, '<uid>').replace(/\b\d{6}\b/g, '<code>').replace(/-K\d+/g, '<key>');
  const groups = new Map();
  for (const d of ALL_DENIED) { const k = `${d.op} ${pat(d.path)}`; groups.set(k, (groups.get(k) || 0) + 1); }
  console.log(`\n🔐 القواعد: ${RULES ? 'مطبَّقة' : 'مطفأة (JAZAM_SIM_RULES=off)'} — ${ALL_DENIED.length} رفض${groups.size ? ':' : ''}`);
  [...groups.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`     ${n}× ${k}`));
}
console.log(bad ? `\n❌ فشل ${bad} فحص` : '\n✅ كل الفحوص نجحت'
  + (knownTotal ? ` (مع ${knownTotal} خلل معروف موثّق للدفعة التالية ⚠️)` : ''));
process.exit(bad ? 1 : 0);
