// سيناريوهات المحاكي: تأكيدات موجّهة + مستكشف عشوائي بثوابت
// كل دالة ترجع { pass, fail, notes[] } — لا تطبع إلا عند verbose
import { World, clock } from './harness.mjs';

const waitFor = async (w, cond, ms = 40000) => { for (let t = 0; t < ms && !cond(); t += 100) await w.run(100); return cond(); };
const names = c => (c.el('approval-players').innerHTML.match(/<span>([^<]+)<\/span>/g) || []).map(x => x.replace(/<\/?span>/g, ''));
const num = c => Number((c.el('search-countdown').textContent.match(/\d+/) || [])[0]);

function suite(title) {
  const r = { title, pass: 0, fail: 0, known: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push('❌ ' + msg); } if (r.verbose) console.log((cond ? '  ✅ ' : '  ❌ ') + msg); };
  // خلل معروف وموثّق (للدفعة التالية): يُبلَّغ ولا يُفشل الفحص
  r.knownIssue = (cond, msg) => { if (cond) r.pass++; else { r.known++; r.notes.push('⚠️ معروف: ' + msg); } if (r.verbose) console.log((cond ? '  ✅ ' : '  ⚠️ ') + msg); };
  return r;
}

// ── 1) لاعبان: الرافض يعود ويدخل التصويت (المنشئ ثم المنضم) — جذر v35.0 ──
export async function rejoinTwo(rejecterIsCreator, verbose = false) {
  const r = suite(`لاعبان: ${rejecterIsCreator ? 'المنشئ' : 'المنضم'} يرفض ثم يعود`); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await A.startSearch(3); await w.run(2000); await B.startSearch(3);
  await waitFor(w, () => A.approvalVisible() && B.approvalVisible());
  const R = rejecterIsCreator ? A : B, S = rejecterIsCreator ? B : A;
  await w.run(1000); R.reject(); await w.run(3000);
  await R.startSearch(3);
  r.ok(await waitFor(w, () => R.approvalVisible() && S.approvalVisible(), 30000), 'التصويت يظهر عند الاثنين بعد العدّ');
  r.ok(names(R).length === 2 && names(S).length === 2, `الاسمان في التصويت: [${names(S)}]`);
  R.accept(); await w.run(400); S.accept();
  r.ok(await waitFor(w, () => R.matches.length && S.matches.length, 15000), 'المباراة بدأت للاثنين');
  const m = R.matches[0], n = S.matches[0];
  r.ok(m && n && m.room === n.room && JSON.stringify(m.nums) === JSON.stringify(n.nums), `نفس المباراة ونفس اللاعبين [${m?.nums}]`);
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 2) ثلاثة: العائد أثناء تصويت الباقيَين ينتظر ولا يدخل مباراتهم (البدء الذرّي v35.0) ──
export async function waiterFlow(verbose = false) {
  const r = suite('ثلاثة على 4: العائد ينتظر ولا يدخل مباراة لم يصوّت عليها'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  await A.startSearch(4); await w.run(2000); await B.startSearch(4); await w.run(2000); await C.startSearch(4);
  await waitFor(w, () => A.approvalVisible() && B.approvalVisible() && C.approvalVisible());
  await w.run(1000); A.reject(); await w.run(1500);
  await A.startSearch(4);
  r.ok(await waitFor(w, () => /يصوّتون/.test(A.el('searching-text').innerHTML), 5000), 'العائد يرى "لاعبون يصوّتون الآن"');
  await waitFor(w, () => B.approvalVisible() && C.approvalVisible(), 5000);
  r.ok(!names(B).includes('أحمد'), `العائد ليس ضمن الجولة الجارية: [${names(B)}]`);
  B.accept(); await w.run(400); C.accept();
  r.ok(await waitFor(w, () => B.matches.length && C.matches.length, 15000), 'المباراة بدأت للمصوّتين');
  r.ok(A.matches.length === 0, 'العائد لم يدخل مباراتهم');
  const m = B.matches[0];
  r.ok(m && m.nums.length === 2 && m.nums.includes(m.turn), `لاعبو المباراة [${m?.nums}] والدور الأول (${m?.turn}) لأحدهم`);
  await w.run(3000);
  r.ok(!A.hidden('online-step-searching') && A.om.roomCode && A.om.roomCode !== m?.room, 'العائد عاد للبحث في غرفة أخرى');
  r.ok(A.hidden('search-countdown'), 'العائد وحيد بلا عدّاد');
  await w.run(21000);
  r.ok(!A.hidden('ai-suggest-box'), 'بديل الكمبيوتر يظهر بعد 20ث وحيداً');
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 3) عدّاد المجموعة: يبدأ لحظة تكوّنها (لا عدّاد للوحيد)، والمنضمّ اللاحق يكمل ──
export async function groupCountdown(verbose = false) {
  const r = suite('عدّاد المجموعة يبدأ بلاعبَين ويكمل للثالث — والوحيد بلا عدّاد'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  await A.startSearch(4); await w.run(9000);
  r.ok(A.hidden('search-countdown'), 'وحيد 9 ثوانٍ: بلا عدّاد');
  await B.startSearch(4); await w.run(1200);
  r.ok(/⏳ (20|19)/.test(A.el('search-countdown').textContent) && /⏳ (20|19)/.test(B.el('search-countdown').textContent),
    `عند تكوّن المجموعة يبدأ من 20: ${A.el('search-countdown').textContent} / ${B.el('search-countdown').textContent}`);
  let diff = 0, maxd = 0;
  for (let i = 0; i < 80; i++) { await w.run(100); const d = Math.abs(num(A) - num(B)); if (d) diff++; maxd = Math.max(maxd, d); }
  r.ok(maxd <= 1 && diff <= 24, `تزامن العرض بين الجهازين (اختلاف ${diff}/80 لحظة، أقصى فرق ${maxd})`);
  await C.startSearch(4); await w.run(1000);
  r.ok(Math.abs(num(C) - num(A)) <= 1 && num(C) <= 11, `الثالث يكمل نفس العدّ: ${C.el('search-countdown').textContent}`);
  r.ok(await waitFor(w, () => A.approvalVisible() && B.approvalVisible() && C.approvalVisible(), 13000), 'التصويت عند انتهاء الـ20');
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 4) آلة البحث لا تعمل أثناء المباراة (كانت تكتب ~34 مرة بالدقيقة وتفتح تصويتاً داخل مباراة) ──
export async function noSearchDuringMatch(verbose = false) {
  const r = suite('لا كتابات بحث أثناء مباراة جارية'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await A.startSearch(3); await w.run(2000); await B.startSearch(3);
  await waitFor(w, () => A.approvalVisible() && B.approvalVisible());
  await w.run(1000); A.accept(); await w.run(400); B.accept();
  await waitFor(w, () => A.matches.length && B.matches.length, 15000);
  const code = A.om.roomCode;
  const before = (A.writes || 0) + (B.writes || 0);
  for (let i = 0; i < 30; i++) {
    const key = w.server.genKey();
    w.server.setAt(`rooms/${code}/moves/${key}`, { key: 'h' + i, by: (i % 2) + 1, seq: clock.now, nextTurn: ((i + 1) % 2) + 1 });
    w.server.setAt(`rooms/${code}/turn`, ((i + 1) % 2) + 1);
    w.server.notify();
    await w.run(2000);
  }
  const room = w.server.getAt(`rooms/${code}`) || {};
  r.ok(((A.writes || 0) + (B.writes || 0)) - before === 0, `كتابات العملاء خلال 30 حركة: ${((A.writes || 0) + (B.writes || 0)) - before}`);
  r.ok(room.waitStartedAt == null && room.approval == null, 'لا ختم تجميع ولا جولة تصويت داخل المباراة');
  r.ok(w.errors.length === 0, 'بلا أخطاء JS');
  w.dispose(); return r;
}

// ── 5) مستكشف عشوائي: 3 لاعبين بأفعال عشوائية + ثوابت يجب ألّا تُكسر أبداً ──
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
export async function fuzzOne(seed, verbose = false, players = 3) {
  const R = rng(seed + (players === 4 ? 100003 : 0));
  const w = new World(); w.quiet = !verbose; w.startSampler(100);
  const P = [await w.client('أحمد'), await w.client('باسل'), await w.client('كريم')];
  if (players === 4) P.push(await w.client('داني'));
  const wanted = R() < 0.5 ? 3 : 4;
  const findings = [];
  const once = (key, msg) => { if (!findings.some(f => f.startsWith(key))) findings.push(key + msg); };
  const loneSince = new Map(), stuckSince = new Map();
  const inv = clock.setInterval(() => {
    const rooms = w.server.getAt('rooms') || {};
    // (أ) لا مقعدان بنفس الرقم في أي غرفة
    for (const [code, rm] of Object.entries(rooms)) {
      const nums = Object.values(rm.players || {}).map(p => p && p.num).filter(n => typeof n === 'number');
      if (new Set(nums).size !== nums.length) once('مقاعد مكرّرة', ` في ${code}: [${nums}]`);
    }
    for (const c of P) {
      if (c.dead) continue;
      const code = c.om?.roomCode, rm = code ? rooms[code] : null;
      const onSearch = !c.hidden('online-step-searching');
      const n = rm ? Object.keys(rm.players || {}).length : 0;
      // (ب) الوحيد لا يرى عدّاداً (بعد ثانية سماح لوصول تحديث الغرفة)
      if (onSearch && n === 1) {
        if (!loneSince.has(c)) loneSince.set(c, clock.now);
        if (!c.hidden('search-countdown') && clock.now - loneSince.get(c) > 1000)
          once('عدّاد عند وحيد', `: ${c.name} [${c.el('search-countdown').textContent}]`);
      } else loneSince.delete(c);
      // (ج) مجموعة في اللوبي لا تبقى بلا عدّاد ولا تصويت أكثر من 26ث
      const busy = !c.hidden('search-countdown') || c.approvalVisible() || !c.hidden('start-countdown')
        || /يصوّتون/.test(c.el('searching-text').innerHTML);
      if (onSearch && rm && rm.status === 'lobby' && n >= 2 && !busy) {
        if (!stuckSince.has(c)) stuckSince.set(c, clock.now);
        if (clock.now - stuckSince.get(c) > 26000) once('مجموعة عالقة', `: ${c.name} (${n} لاعبين) بلا عدّاد ولا تصويت`);
      } else stuckSince.delete(c);
    }
  }, 250);
  for (let step = 0; step < 40; step++) {
    const c = P[Math.floor(R() * P.length)];
    if (c.dead) { await w.run(1000); continue; }
    const x = R();
    const onMenu = !c.hidden('online-step-name') || !c.hidden('online-step-random-count');
    if (onMenu) { if (x < 0.7) await c.startSearch(wanted); }
    else if (c.approvalVisible()) { if (x < 0.5) c.accept(); else if (x < 0.8) c.reject(); }
    else if (!c.hidden('online-step-searching')) {
      if (x < 0.08) c.cancelSearch();
      else if (x < 0.12 && !c.hidden('ai-suggest-box')) c.dismissAI();
      else if (x < 0.14) c.closeTab();
    }
    await w.run(Math.floor(500 + R() * 6000));
  }
  await w.run(70000);
  clock.clearInterval(inv);
  // (د) لا كتابات أثناء دقيقة هدوء (لا حلقات خفية)
  const before = w.server.writes; await w.run(60000);
  if (w.server.writes - before > 3) once('كتابات في الهدوء', `: ${w.server.writes - before} خلال دقيقة`);
  // (هـ) سلامة المباريات: كل داخل من لاعبيها، الجميع متّفقون، والدور الأول لمقعد موجود
  const byRoom = {};
  for (const c of P) for (const m of c.matches) (byRoom[m.room] ||= []).push({ c, m });
  for (const [room, arr] of Object.entries(byRoom)) {
    if (new Set(arr.map(x => JSON.stringify([x.m.nums, x.m.turn]))).size > 1) once('اختلاف', ` بين لاعبي مباراة ${room}`);
    for (const x of arr) if (!x.m.nums.includes(x.m.num)) once('دخيل', `: ${x.c.name} في مباراة ${room}`);
    if (arr.some(x => !x.m.nums.includes(x.m.turn))) once('دور شبحي', ` في ${room}`);
  }
  if (w.errors.length) once('أخطاء JS', `: ${w.errors[0].slice(0, 160)}`);
  w.dispose();
  return { seed, findings };
}

// ═════════════════════ الغرفة بالكود ═════════════════════
const crownOf = c => c.lobbyList().find(p => p.host)?.num;
async function makeCodeRoom(w, host, max) {
  host.createCodeRoom(max); await w.run(400);
  const code = host.codeShown();
  if (!/^\d{6}$/.test(code)) throw new Error('لم يُنشأ كود: ' + code);
  return code;
}

// ── 6) أساسيات: إنشاء، انضمام، التاج وزر البدء للمضيف فقط، بدء بالعدد الكامل ──
export async function codeBasics(verbose = false) {
  const r = suite('غرفة بالكود: التاج وزر البدء للمضيف فقط + بدء بالعدد الكامل'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  const code = await makeCodeRoom(w, A, 3);
  B.joinCode(code); await w.run(600);
  // الخطوة 1.4: البدء بعدد ناقص مسموح، لكن الزر يقولها صراحةً
  const btn = c => c.el('multi-start-btn').textContent, hint = c => c.el('multi-wait-hint').textContent;
  r.ok(btn(A) === '🚀 ابدأ بلاعبَين (من 3)', `زر البدء بعدد ناقص يقولها صراحةً: "${btn(A)}"`);
  C.joinCode(code); await w.run(800);
  r.ok([A, B, C].every(c => c.lobbyList().length === 3), 'الثلاثة يرون القائمة كاملة');
  r.ok([A, B, C].every(c => crownOf(c) === 1), 'التاج 👑 على المنشئ عند الجميع');
  r.ok(A.startBtnVisible() && !B.startBtnVisible() && !C.startBtnVisible(), 'زر البدء عند المضيف وحده');
  r.ok(btn(A) === '🚀 ابدأ المباراة' && /اكتمل العدد/.test(hint(A)) && /اكتمل العدد/.test(hint(B)) && !/انتظار المزيد/.test(hint(A)),
    `عند الاكتمال: "${btn(A)}" / المضيف: "${hint(A)}" / غيره: "${hint(B)}"`);
  A.startCode();
  r.ok(await waitFor(w, () => A.matches.length && B.matches.length && C.matches.length, 8000), 'المباراة بدأت للثلاثة');
  const sig = new Set([A, B, C].map(c => JSON.stringify([c.matches[0]?.nums, c.matches[0]?.turn])));
  r.ok(sig.size === 1 && A.matches[0]?.nums.join() === '1,2,3' && A.matches[0]?.turn === 1, `الجميع متّفقون: اللاعبون [${A.matches[0]?.nums}] الدور الأول ${A.matches[0]?.turn}`);
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 7) البدء بلاعبَين من 3 + منع الانضمام بعد البدء + الغرفة الممتلئة ──
export async function codeStartTwoAndLimits(verbose = false) {
  const r = suite('غرفة بالكود: بدء بلاعبَين من 3 + منع الانضمام بعد البدء + الممتلئة'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  const code = await makeCodeRoom(w, A, 3);
  B.joinCode(code); await w.run(800);
  A.startCode();
  r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), 'بدأت بلاعبَين من 3');
  r.ok(A.matches[0]?.nums.join() === '1,2' && B.matches[0]?.nums.join() === '1,2', `اللاعبون [${A.matches[0]?.nums}]`);
  C.joinCode(code); await w.run(800);
  r.ok(/بدأت/.test(C.errorText()) && C.matches.length === 0, `المتأخّر يُمنع: "${C.errorText()}"`);
  // غرفة ممتلئة (حدّها 2)
  const D = await w.client('داني'), E = await w.client('إياد'), F = await w.client('فادي');
  const code2 = await makeCodeRoom(w, D, 2);
  E.joinCode(code2); await w.run(800); F.joinCode(code2); await w.run(800);
  r.ok(/ممتلئة/.test(F.errorText()), `الغرفة الممتلئة تمنع الثالث: "${F.errorText()}"`);
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 8) المضيف يغادر بالزر: أصغر رقم يرث التاج وزر البدء (واحد فقط) ثم يبدأ ──
export async function codeHostLeaves(verbose = false) {
  const r = suite('غرفة بالكود: المضيف يغادر بالزر → وريث واحد يبدأ'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  const code = await makeCodeRoom(w, A, 4);
  B.joinCode(code); await w.run(600); C.joinCode(code); await w.run(800);
  A.leaveCode(); await w.run(1500);
  r.ok(B.lobbyList().length === 2 && C.lobbyList().length === 2, 'المغادر اختفى من القائمة');
  r.ok(crownOf(B) === 2 && crownOf(C) === 2, `التاج انتقل لباسل عند الاثنين (${crownOf(B)}/${crownOf(C)})`);
  r.ok(B.startBtnVisible() && !C.startBtnVisible(), 'زر البدء عند الوريث وحده');
  r.ok(w.timeline.some(l => l.includes('باسل') && l.includes('صرت مضيف')), 'إشعار "👑 صرت مضيف الغرفة" للوريث');
  B.startCode();
  r.ok(await waitFor(w, () => B.matches.length && C.matches.length, 8000), 'الوريث بدأ المباراة');
  r.ok(B.matches[0]?.nums.join() === '2,3' && B.matches[0]?.turn === 2 && C.matches[0]?.turn === 2, `اللاعبون [${B.matches[0]?.nums}] والدور الأول 2`);
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 9) إعادة استخدام المقعد بعد مغادرة المضيف: القادم الجديد يأخذ 1 ولا يصير مضيفاً ──
export async function codeSeatReuse(verbose = false) {
  const r = suite('غرفة بالكود: القادم الجديد يأخذ المقعد الفارغ ولا يسرق التاج'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم'), D = await w.client('داني');
  const code = await makeCodeRoom(w, A, 4);
  B.joinCode(code); await w.run(600); C.joinCode(code); await w.run(600);
  A.leaveCode(); await w.run(1500);
  D.joinCode(code); await w.run(1500);
  const dSeat = D.lobbyList().find(p => p.name === 'داني')?.num;
  r.ok(dSeat === 1, `داني أخذ المقعد الفارغ 1 (أخذ ${dSeat})`);
  r.ok([B, C, D].every(c => crownOf(c) === 2), `التاج بقي لباسل عند الجميع (${[B, C, D].map(crownOf)})`);
  r.ok(B.startBtnVisible() && !C.startBtnVisible() && !D.startBtnVisible(), 'زر البدء عند باسل وحده');
  const nums = D.lobbyList().map(p => p.num);
  r.ok(new Set(nums).size === nums.length, `لا مقاعد مكرّرة [${nums}]`);
  B.startCode();
  r.ok(await waitFor(w, () => B.matches.length && C.matches.length && D.matches.length, 8000), 'المباراة بدأت للثلاثة');
  const sig = new Set([B, C, D].map(c => JSON.stringify([c.matches[0]?.nums, c.matches[0]?.turn])));
  r.ok(sig.size === 1 && B.matches[0]?.nums.join() === '1,2,3', `متّفقون: [${B.matches[0]?.nums}] الدور الأول ${B.matches[0]?.turn}`);
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 10) المنشئ يغلق تبويبه في اللوبي: الغرفة تستمر والتاج ينتقل (إصلاح 1.2) ──
export async function codeHostClosesTab(verbose = false) {
  const r = suite('غرفة بالكود: المنشئ يغلق تبويبه → الغرفة تستمر والتاج ينتقل'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  const code = await makeCodeRoom(w, A, 3);
  B.joinCode(code); await w.run(600); C.joinCode(code); await w.run(800);
  A.closeTab(); await w.run(3000);
  r.ok(!!w.server.getAt('rooms/' + code), 'الغرفة لم تُحذف بإغلاق تبويب المنشئ');
  r.ok(B.lobbyList().length === 2 && C.lobbyList().length === 2, `المنشئ وحده اختفى من القائمة (${B.lobbyList().map(p => p.name)})`);
  r.ok(crownOf(B) === 2 && crownOf(C) === 2, `التاج انتقل لأصغر رقم حاضر عند الاثنين (${crownOf(B)}/${crownOf(C)})`);
  r.ok(B.startBtnVisible() && !C.startBtnVisible(), 'زر البدء عند الوريث وحده');
  B.startCode();
  r.ok(await waitFor(w, () => B.matches.length && C.matches.length, 8000), 'الوريث يستطيع بدء المباراة');
  r.ok(B.matches[0]?.nums.join() === '2,3' && B.matches[0]?.turn === 2, `اللاعبون [${B.matches[0]?.nums}] والدور الأول ${B.matches[0]?.turn}`);
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 10ب) المنشئ وحده يغلق تبويبه: لا تبقى غرفة مهجورة في المطابقة ──
export async function abandonedRoomIgnored(verbose = false) {
  const r = suite('غرفة مهجورة بعد انقطاع آخر من فيها لا تبتلع الباحثين'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await A.startSearch(3); await w.run(2000);
  const ghost = A.om.roomCode;
  A.closeTab(); await w.run(2000);
  r.ok(!Object.keys(w.server.getAt('rooms/' + ghost + '/players') || {}).length, 'الغرفة بقيت بلا لاعبين');
  await B.startSearch(3); await w.run(3000);
  r.ok(B.om.roomCode && B.om.roomCode !== ghost, 'الباحث الجديد أنشأ غرفته ولم يدخل المهجورة');
  r.ok(w.errors.length === 0, 'بلا أخطاء JS');
  w.dispose(); return r;
}

// ═════════════════════ البحث الثنائي ═════════════════════
// ── 11) وحيد بلا عدّاد + بديل الكمبيوتر + المباراة عند انضمام الخصم ──
export async function duoBasics(verbose = false) {
  const r = suite('البحث الثنائي: الوحيد بلا عدّاد ثم المباراة عند انضمام خصم'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await A.startSearch(2);
  let cdSeen = false;
  for (let i = 0; i < 250; i++) { await w.run(100); if (A.countdownVisible()) cdSeen = true; }
  r.ok(!cdSeen, 'لا عدّاد طوال 25 ثانية وحيداً');
  r.ok(!A.hidden('ai-suggest-box'), 'بديل الكمبيوتر ظهر بعد 20ث');
  await B.startSearch(2);
  r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), 'المباراة بدأت للاثنين');
  r.ok(A.matches[0]?.room === B.matches[0]?.room && A.matches[0]?.num === 1 && B.matches[0]?.num === 2, `نفس الغرفة: أحمد=${A.matches[0]?.num} باسل=${B.matches[0]?.num}`);
  r.ok(A.hidden('ai-suggest-box'), 'صندوق الكمبيوتر اختفى عند بدء المباراة');
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 12) الإلغاء: لا غرفة شبحية يدخلها القادم بعده ──
export async function duoCancel(verbose = false) {
  const r = suite('البحث الثنائي: الإلغاء يزيل الغرفة (لا يدخلها أحد بعده)'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await A.startSearch(2); await w.run(3000);
  A.cancelSearch(); await w.run(1000);
  r.ok(Object.keys(w.server.getAt('rooms') || {}).length === 0, 'الغرفة حُذفت بعد الإلغاء');
  await B.startSearch(2); await w.run(3000);
  r.ok(B.matches.length === 0 && !B.hidden('online-step-searching'), 'القادم بعده يبحث (لم يدخل مباراة وهمية)');
  r.ok(w.errors.length === 0, 'بلا أخطاء JS');
  w.dispose(); return r;
}

// ── 13) سباقات الثنائي (الخطوة 1.3 — v35.8): الانضمام والإلغاء الذرّيان ──
// كانت "خلل معروف" حتى v35.7: منضمّان بنفس اللحظة يدخلان معاً، والمُلغي يُسحب لمباراة، والمنضمّ يدخل غرفة شبحية.
const CANCELLED_MSG = /ألغى الخصم قبل أن تبدأ المباراة — لم تُحسب/;
const VANISHED_MSG  = /غادر الخصم قبل أن تبدأ المباراة — لم تُحسب/;
const onStep = (c, s) => !c.hidden('online-step-' + s);
// ننتظر (بخطوات 1ms) حتى يعتمد الخادم حالة بعينها — لنضرب الفعل التالي داخل نافذة السباق بالضبط
async function untilServer(w, pred, maxMs = 3000) {
  for (let i = 0; i < maxMs; i++) { if (pred()) return true; await w.run(1); }
  return false;
}
// الباحث الوحيد الباقي: ينتظر في غرفته العامة (لا مباراة وهمية ولا شاشة معلّقة)
function hostingAlone(w, c) {
  const code = c.om.roomCode, rm = code ? w.server.getAt('rooms/' + code) : null;
  return !!(onStep(c, 'searching') && c.matches.length === 0 && rm && rm.status === 'waiting'
    && rm.public === true && rm.p1uid === c.uid && !rm.p2uid);
}
export async function duoRaces(verbose = false) {
  const r = suite('البحث الثنائي: سباقات الانضمام والإلغاء (ذرّية)'); r.verbose = verbose;
  // (أ) منضمّان بنفس اللحظة لنفس المنتظر
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
    await A.startSearch(2); await w.run(3000);
    await B.startSearch(2); await C.startSearch(2);            // نفس اللحظة
    await w.run(8000);
    const roomA = A.matches[0]?.room;
    const withA = [B, C].filter(c => c.matches.some(m => m.room === roomA));
    r.ok(A.matches.length === 1 && withA.length === 1, `منضمّان بنفس اللحظة لنفس المنتظر: واحد فقط دخل غرفته (${withA.length})`);
    const other = [B, C].find(c => !withA.includes(c));
    r.ok(other && hostingAlone(w, other), `والآخر (${other?.name}) يكمل البحث في غرفته المنتظرة — لا مباراة وهمية`);
    const rm = w.server.getAt('rooms/' + roomA) || {};
    r.ok(withA[0] && rm.p2uid === withA[0].uid && rm.p2name === withA[0].name, 'الغرفة تحمل خصماً واحداً متّسقاً (الاسم والمعرّف للاعب نفسه)');
    r.ok(!A.ends.length && !B.ends.length && !C.ends.length, 'لا نتائج مسجّلة لأحد');
    noErr(r, w); w.dispose();
  }
  // (ب) المنتظر يُلغي قبل أن يصل انضمام الخصم الخادم: تُحذف غرفته، والخصم يكمل البحث
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    const code = A.om.roomCode;
    A.cancelSearch(); await B.startSearch(2);
    await w.run(6000);
    r.ok(A.matches.length === 0 && onStep(A, 'name'), 'الإلغاء أولاً: من ألغى في القائمة بلا مباراة');
    r.ok(w.server.getAt('rooms/' + code) == null, 'وغرفته حُذفت');
    r.ok(hostingAlone(w, B), 'والقادم يكمل البحث في غرفته هو (لم يدخل غرفة شبحية)');
    noErr(r, w); w.dispose();
  }
  // (ج) الانضمام يصل الخادم أولاً ثم يضغط المنتظر "إلغاء" قبل أن تصله اللقطة: لا يُسحب لمباراة،
  //     ومباراة المنضمّ تُلغى قبل بدئها برسالة واضحة — لا فوز ولا خسارة لأحد
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    const code = A.om.roomCode;
    await B.startSearch(2);
    const hit = await untilServer(w, () => (w.server.getAt('rooms/' + code) || {}).status === 'playing');
    A.cancelSearch();                                          // داخل نافذة السباق (اللقطة لم تصل أحمد بعد)
    await w.run(8000);
    const rm = w.server.getAt('rooms/' + code) || {};
    r.ok(hit && A.matches.length === 0 && onStep(A, 'name'), 'الانضمام سبق الإلغاء: من ألغى لا يُسحب لمباراة (يبقى في القائمة)');
    r.ok(rm.status === 'finished' && rm.abortedBy === 1 && rm.p1uid === A.uid, `الغرفة: أُلغيت قبل البدء بيد المنشئ (${rm.status}/${rm.abortedBy})`);
    r.ok(CANCELLED_MSG.test(B.toasts()), 'المنضمّ يرى "ألغى الخصم قبل أن تبدأ المباراة — لم تُحسب"');
    r.ok(B.matches.length === 0, 'ولم تُبنَ له لوحة مباراة لن تُلعب');
    r.ok(!A.ends.length && !B.ends.length, 'لا فوز ولا خسارة لأحد');
    noErr(r, w); w.dispose();
  }
  // (ج2) نفسه لكن رفع المُلغي بطيء: الإلغاء يصل بعد أن بُنيت لوحة المنضمّ — يُبلَّغ من داخل المباراة
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    const code = A.om.roomCode;
    await B.startSearch(2);
    const hit = await untilServer(w, () => (w.server.getAt('rooms/' + code) || {}).status === 'playing');
    A.up = 7000;                                               // رفعه يبطؤ الآن: إلغاؤه يصل بعد 7 ثوانٍ
    A.cancelSearch();
    await w.run(12000);
    const rm = w.server.getAt('rooms/' + code) || {};
    r.ok(hit && A.matches.length === 0 && B.matches.length === 1, 'رفع بطيء: لوحة المنضمّ بُنيت قبل وصول الإلغاء');
    r.ok(rm.status === 'finished' && rm.abortedBy === 1, `ثم وصل الإلغاء (${rm.status}/${rm.abortedBy})`);
    r.ok(CANCELLED_MSG.test(B.toasts()) && !B.ends.length, 'فيُبلَّغ من داخل المباراة "ألغى الخصم قبل أن تبدأ المباراة" بلا نتيجة');
    r.ok(B.mods.state.gameFinished === true, 'واللوحة مقفلة بعدها');
    noErr(r, w); w.dispose();
  }
  // (هـ) نقرة "إلغاء" وصلت بعد أن تحوّل البحث لمباراة: لا تُلغي مباراة بدأت ولا تخفي اللوحة
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    await B.startSearch(2); await w.run(3000);
    const code = A.om.roomCode;
    r.ok(A.matches.length === 1 && onStep(A, 'playing'), 'المباراة بدأت للمنتظر');
    A.cancelSearch(); await w.run(2000);
    const rm = w.server.getAt('rooms/' + code) || {};
    r.ok(onStep(A, 'playing') && A.om.roomCode === code, 'النقرة المتأخرة لا تُخرجه من شاشة المباراة');
    r.ok(rm.status === 'playing' && rm.abortedBy == null, 'ولا تمسّ الغرفة الجارية');
    // وحتى لو استُدعي الإلغاء نفسه مباشرة أثناء المباراة (للمضيف والمنضمّ): لا شيء يتغيّر
    await A.om.cancelRandomMatch(); await B.om.cancelRandomMatch(); await w.run(1000);
    const rm2 = w.server.getAt('rooms/' + code) || {};
    r.ok(A.om.roomCode === code && B.om.roomCode === code && rm2.status === 'playing' && rm2.abortedBy == null,
      'إلغاء البحث لا يمسّ مباراة قائمة (حارس داخل firebase.js نفسه)');
    noErr(r, w); w.dispose();
  }
  // (د) بنفس اللحظة تماماً (بلا ترتيب مفروض): أي النتيجتين، لكن دائماً متّسقة
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    await B.startSearch(2); A.cancelSearch();
    await w.run(8000);
    const code = B.matches[0]?.room;
    const rm = code ? w.server.getAt('rooms/' + code) : null;
    r.ok(A.matches.length === 0, 'من ألغى البحث بلحظة انضمام خصم لا يُسحب لمباراة رغم إلغائه');
    r.ok(!(B.matches.length && !(rm && rm.p1uid)), `الخصم لا يدخل غرفة شبحية بلا منشئ${rm && !rm.p1uid ? ' (دخل ' + code + ')' : ''}`);
    r.ok(hostingAlone(w, B) || CANCELLED_MSG.test(B.toasts()), 'والخصم: يكمل البحث في غرفته، أو يرى أن المباراة أُلغيت قبل بدئها');
    r.ok(!A.ends.length && !B.ends.length, 'لا نتائج مسجّلة');
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 13ب) المنضمّ يُلغي بحثه ومعاملة انضمامه في الطريق (v35.8) ──
export async function duoJoinerCancels(verbose = false) {
  const r = suite('البحث الثنائي: المنضمّ يُلغي بلحظة انضمامه → لا مباراة له، والمنتظر لا يعلق'); r.verbose = verbose;
  // (أ) المنتظر رأى الانضمام وبدأ: يُبلَّغ بإلغاء المباراة قبل بدئها
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    const code = A.om.roomCode;
    await B.startSearch(2);
    const hit = await untilServer(w, () => (w.server.getAt('rooms/' + code) || {}).status === 'playing');
    B.cancelSearch();                                          // الانضمام اعتُمد، والرد لم يصل باسل بعد
    await w.run(8000);
    const rm = w.server.getAt('rooms/' + code) || {};
    r.ok(hit && B.matches.length === 0 && onStep(B, 'name'), 'من ألغى (المنضمّ) في القائمة بلا مباراة');
    r.ok(rm.status === 'finished' && rm.abortedBy === 2, `مباراته أُلغيت قبل البدء (${rm.status}/${rm.abortedBy})`);
    r.ok(CANCELLED_MSG.test(A.toasts()) || hostingAlone(w, A), 'المنتظر: يُبلَّغ بالإلغاء أو يكمل الانتظار — لا يلعب وحده');
    r.ok(!A.ends.length && !B.ends.length, 'لا فوز ولا خسارة لأحد');
    noErr(r, w); w.dispose();
  }
  // (ب) المنتظر لم يرَ إلا الإلغاء (لقطتان وصلتاه معاً — مثلاً بعد رجوعه): يعيد فتح غرفته ويكمل الانتظار
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), C = await w.client('كريم');
    await A.startSearch(2); await w.run(3000);
    const code = A.om.roomCode;
    // معالج "خرج الخصم" باقٍ من مباراة سابقة في الجلسة نفسها: المنتظر يجب ألّا يستدعيه لغرفته وهو يبحث
    let staleCalled = false; A.om.onOpponentLeft(() => { staleCalled = true; });
    const room = w.server.getAt('rooms/' + code);
    w.server.setAt('rooms/' + code, { ...room, status: 'finished', abortedBy: 2, p2uid: 'uid_زائر', p2name: 'زائر', public: false });
    w.server.notify();
    await w.run(2000);
    r.ok(!staleCalled, 'المنتظر لا يعامل نهاية لم يبدأها كخروج خصم (معالج قديم لا يُستدعى)');
    const rm = w.server.getAt('rooms/' + code) || {};
    r.ok(rm.status === 'waiting' && rm.public === true && !rm.p2uid && rm.abortedBy == null, `أعاد فتح غرفته كما كانت (${rm.status}، عامة=${rm.public})`);
    r.ok(onStep(A, 'searching') && A.matches.length === 0 && !/لم تُحسب/.test(A.toasts()), 'وما زال يبحث بهدوء (لا مباراة ولا رسالة)');
    await C.startSearch(2); await w.run(6000);
    r.ok(A.matches.length === 1 && C.matches[0]?.room === code && A.matches[0]?.room === code, 'والقادم التالي يدخل غرفته وتبدأ مباراتهما');
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 13ج) الإلغاء أثناء البحث نفسه (قبل أن يكتمل): لا غرفة منتظرة ولا مباراة لمن ألغى (v35.8) ──
export async function duoCancelMidSearch(verbose = false) {
  const r = suite('البحث الثنائي: إلغاء قبل اكتمال البحث → لا غرفة ولا مباراة لمن ألغى'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد', { up: 400, down: 400 }), B = await w.client('باسل');
  await A.startSearch(2);
  await w.run(100);                                            // قراءة الغرف ما زالت في الطريق
  A.cancelSearch();
  await w.run(5000);
  r.ok(onStep(A, 'name') && A.om.roomCode == null, 'من ألغى في القائمة وبلا غرفة');
  r.ok(!Object.values(w.server.getAt('rooms') || {}).some(rm => rm && rm.p1uid === A.uid), 'لم تُنشأ له غرفة منتظرة بعد الإلغاء');
  await B.startSearch(2); await w.run(8000);
  r.ok(A.matches.length === 0 && B.matches.length === 0 && hostingAlone(w, B), 'والقادم بعده لا يجده (لا مباراة تسحب من ألغى)');
  noErr(r, w); w.dispose();
  return r;
}

// ── 13د) اختفاء غرفة المنشئ بلحظة الانضمام (أُغلقت صفحته قبل أن يثبّت البدء): المنضمّ لا يعلق (v35.8) ──
export async function duoHostVanishes(verbose = false) {
  const r = suite('البحث الثنائي: صفحة المنتظر أُغلقت بلحظة الانضمام → المنضمّ يُبلَّغ ولا يعلق'); r.verbose = verbose;
  // 150ms: الخادم يمسح الغرفة بعد أن يسجّل المنضمّ مستمعه؛ 5ms: قبل أن يسجّله (أول لقطة له "لا غرفة")
  for (const detect of [150, 5]) {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    const code = A.om.roomCode;
    await B.startSearch(2);
    const hit = await untilServer(w, () => (w.server.getAt('rooms/' + code) || {}).status === 'playing');
    A.closeTab(detect);                                        // قبل أن تصله لقطة الانضمام: أمر انقطاعه ما زال "امسح الغرفة"
    await w.run(8000);
    const tag = `(${detect}ms) `;
    r.ok(hit && w.server.getAt('rooms/' + code) == null, tag + 'الخادم مسح الغرفة بأمر انقطاع المنشئ');
    r.ok(VANISHED_MSG.test(B.toasts()), tag + 'المنضمّ يرى "غادر الخصم قبل أن تبدأ المباراة — لم تُحسب" (لا انتظار للأبد)');
    r.ok(!B.ends.length && B.matches.length === 0, tag + 'لا فوز ولا خسارة، ولا لوحة لمباراة لن تُلعب');
    r.ok(B.mods.state.gameFinished === true, tag + 'والمباراة عنده مغلقة (زر الخروج بعدها هادئ)');
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 13و) المنتظر يغلق صفحته لحظة إنشاء غرفته: لا تبقى غرفة منتظرة بلا صاحب يدخلها باحث ويعلق (v35.8) ──
export async function duoHostClosesAtCreate(verbose = false) {
  const r = suite('البحث الثنائي: إغلاق الصفحة لحظة إنشاء الغرفة → تُمسح (لا غرفة بلا صاحب)'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await A.startSearch(2);
  // ننتظر وصول الإنشاء للخادم، ونغلق قبل أن يصل ردّه أحمد (ما بين الكتابة وتسجيل ما بعدها)
  const hit = await untilServer(w, () => Object.values(w.server.getAt('rooms') || {}).some(rm => rm && rm.p1uid === A.uid));
  A.closeTab(150);
  await w.run(2000);
  r.ok(hit && !Object.values(w.server.getAt('rooms') || {}).some(rm => rm && rm.p1uid === A.uid), 'الخادم مسح غرفته بأمر انقطاعها (سُجّل قبل الإنشاء)');
  await B.startSearch(2); await w.run(6000);
  r.ok(B.matches.length === 0 && hostingAlone(w, B), 'والقادم بعده لا يدخل غرفة بلا صاحب — يكمل البحث في غرفته');
  noErr(r, w); w.dispose();
  return r;
}

// ── 13ز) الإلغاء ثم إغلاق الصفحة فوراً (مراجعة v35.8 المستقلة): أمر المسح عند الانقطاع يبقى مسلّحاً حتى يُحسم
// الإلغاء — كان يُلغى أولاً، فإغلاق الصفحة قبل وصول الحذف ترك غرفة "تنتظر" عامة بلا صاحب يدخلها الباحث التالي ويعلق ──
export async function duoCancelThenClose(verbose = false) {
  const r = suite('البحث الثنائي: إلغاء ثم إغلاق الصفحة فوراً → لا غرفة منتظرة بلا صاحب، ولا منضمّ عالق'); r.verbose = verbose;
  for (const gap of [5, 20, 60]) {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    const code = A.om.roomCode;
    A.cancelSearch(); await w.run(gap); A.closeTab(150);      // أُغلقت الصفحة قبل أن يصل الحذف (أو بعده)
    await w.run(2000);
    const tag = `(${gap}ms) `;
    r.ok(w.server.getAt('rooms/' + code) == null, tag + 'غرفته حُذفت (بالإلغاء، أو بأمر المسح عند إغلاق الصفحة)');
    await B.startSearch(2); await w.run(4000);
    r.ok(B.matches.length === 0 && hostingAlone(w, B), tag + 'والقادم بعده لا يعلق في غرفته — يكمل البحث في غرفته هو');
    noErr(r, w); w.dispose();
  }
  // الغرفة بالكود: إلغاؤها ثم إغلاق الصفحة فوراً → تُحذف، ومن معه الكود لا يدخل غرفة بلا صاحب
  for (const gap of [5, 20]) {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    A.createDuoRoom(); await w.run(500);
    const code = A.duoCodeShown();
    A.cancelDuoRoom(); await w.run(gap); A.closeTab(150);
    await w.run(2000);
    const tag = `(بالكود ${gap}ms) `;
    r.ok(w.server.getAt('rooms/' + code) == null, tag + 'الغرفة حُذفت');
    B.joinCode(code); await w.run(2000);
    r.ok(B.matches.length === 0 && /الغرفة غير موجودة/.test(B.errorText()), tag + `ومن معه الكود يرى "الغرفة غير موجودة!" (${B.errorText() || '—'})`);
    noErr(r, w); w.dispose();
  }
  // الانضمام يصل الخادم بلحظة الإلغاء، ثم تُغلق الصفحة قبل أن يصل الإلغاء: المنضمّ يُبلَّغ ولا يعلق
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    const code = A.om.roomCode;
    await B.startSearch(2);
    const hit = await untilServer(w, () => (w.server.getAt('rooms/' + code) || {}).status === 'playing');
    A.cancelSearch(); await w.run(5); A.closeTab(150);
    await w.run(8000);
    r.ok(hit && (CANCELLED_MSG.test(B.toasts()) || VANISHED_MSG.test(B.toasts())),
      'الانضمام بلحظة الإلغاء ثم الإغلاق: المنضمّ يُبلَّغ أن المباراة أُلغيت أو غادر الخصم قبل بدئها');
    r.ok(!A.ends.length && !B.ends.length && B.mods.state.gameFinished === true, 'لا نتيجة لأحد، والمباراة عند المنضمّ مغلقة (لا انتظار للأبد)');
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 13ح) انقطاع لحظي للمنتظر (قديم — كُشف أثناء إصلاحات مراجعة v35.8): الخادم ينفّذ أمر "امسح الغرفة" المسجّل لإغلاق
// الصفحة، والصفحة ما زالت تنتظر — كان ينتظر للأبد في غرفة لا يراها أحد. الآن تعود كما كانت ويدخلها القادم ──
export async function duoHostBlip(verbose = false) {
  const r = suite('الثنائي: غرفة المنتظر تختفي بانقطاع لحظي → تعود كما كانت ويدخلها الخصم (لا انتظار للأبد)'); r.verbose = verbose;
  // (أ) بحث عشوائي، والخادم وحده لاحظ الانقطاع (نفّذ أمر المسح والصفحة لم تشعر): تعود الغرفة، والقادم يدخلها
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    const code = A.om.roomCode;
    A.blip(150);
    const gone = await untilServer(w, () => w.server.getAt('rooms/' + code) == null, 3000);
    await w.run(3000);
    const rm = w.server.getAt('rooms/' + code) || {};
    r.ok(gone && rm.status === 'waiting' && rm.public === true && rm.p1uid === A.uid && !rm.p2uid,
      `(عشوائية) اختفت عند الخادم ثم عادت تنتظر كما كانت (${rm.status || 'غير موجودة'})`);
    r.ok(onStep(A, 'searching') && A.matches.length === 0, '(عشوائية) والمنتظر ما زال يبحث بهدوء');
    await B.startSearch(2); await w.run(6000);
    r.ok(A.matches[0]?.room === code && B.matches[0]?.room === code, '(عشوائية) القادم يدخلها وتبدأ مباراتهما');
    noErr(r, w); w.dispose();
  }
  // (ب) غرفة بالكود وانقطاع حقيقي (2ث): شاشة الكود باقية — كانت الغرفة تُمسح وصديقه يرى "الغرفة غير موجودة!"
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    A.createDuoRoom(); await w.run(500);
    const code = A.duoCodeShown();
    A.drop({ offlineMs: 2000, serverDetectMs: 500 });
    const gone = await untilServer(w, () => w.server.getAt('rooms/' + code) == null, 3000);
    await w.run(3000);
    const rm = w.server.getAt('rooms/' + code) || {};
    r.ok(gone && rm.status === 'waiting' && rm.p1uid === A.uid && !rm.p2uid, `(بالكود) مُسحت عند السقوط ثم عادت بعد العودة (${rm.status || 'غير موجودة'})`);
    B.joinCode(code); await w.run(6000);
    r.ok(A.matches[0]?.room === code && B.matches[0]?.room === code, `(بالكود) صديقه يدخل بالكود وتبدأ مباراتهما${B.errorText() ? ' — ' + B.errorText() : ''}`);
    noErr(r, w); w.dispose();
  }
  // (ب2) مراجعة v35.8 الثانية: سقط اتصال المنشئ والخادم لم يلاحظ بعد، فدخل صديقه بالكود؛ ثم نفّذ الخادم أمر المسح
  //      (والصديق فيها) وعاد المنشئ فأعادها "تنتظر" — الصديق يُبلَّغ ولا تمحو الغرفةُ المُعادة ذلك، وخروجه هادئ
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    A.createDuoRoom(); await w.run(500);
    const code = A.duoCodeShown();
    A.drop({ offlineMs: 2500, serverDetectMs: 1200 });
    await w.run(100);
    B.joinCode(code);                                          // يصل قبل أن ينفّذ الخادم أمر مسح المنشئ
    const joinedHit = await untilServer(w, () => (w.server.getAt('rooms/' + code) || {}).p2uid === B.uid, 1000);
    await w.run(8000);
    const rm = w.server.getAt('rooms/' + code) || {};
    r.ok(joinedHit && VANISHED_MSG.test(B.toasts()), '(بالكود، دخل الصديق لحظة سقوط المنشئ) يُبلَّغ "غادر الخصم قبل أن تبدأ المباراة — لم تُحسب"');
    r.ok(B.om.lastRoom() && B.om.lastRoom().vanished === true && B.mods.state.gameFinished === true && !B.ends.length,
      '"اختفت" باقية بعد عودة الغرفة، والمباراة عنده مغلقة بلا نتيجة');
    r.ok(rm.status === 'waiting' && !rm.p2uid && A.matches.length === 0, `والمنشئ أعاد غرفته تنتظر بلا خصم (${rm.status || '-'})`);
    B.withdraw(); await w.run(1500);
    const rm2 = w.server.getAt('rooms/' + code) || {};
    r.ok(rm2.status === 'waiting' && rm2.leftBy == null && !B.ends.length, 'وخروج الصديق هادئ: لا خسارة ولا "انسحب" في غرفة المنشئ');
    noErr(r, w); w.dispose();
  }
  // (ج) بحث عشوائي وانقطاع يلاحظه الجهاز: القرار الموثّق — يرجع للقائمة برسالة واضحة، ولا تبقى له غرفة شبحية
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    A.drop({ offlineMs: 2000, serverDetectMs: 500 });
    await w.run(4000);
    r.ok(!onStep(A, 'searching') && /انقطع اتصالك/.test(A.toasts()), '(عشوائية، انقطاع حقيقي) يرجع للقائمة برسالة "انقطع اتصالك"');
    r.ok(!Object.values(w.server.getAt('rooms') || {}).some(x => x && x.p1uid === A.uid), 'ولا تبقى له غرفة منتظرة بعد العودة');
    await B.startSearch(2); await w.run(4000);
    r.ok(B.matches.length === 0 && hostingAlone(w, B), 'والقادم بعده ينتظر في غرفته (لا مباراة مع غائب)');
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 13هـ) الغرفة الثنائية بالكود: الانضمام الذرّي والإلغاء بلا "فوز مجاني" (v35.8) ──
export async function duoCodeRaces(verbose = false) {
  const r = suite('الغرفة الثنائية بالكود: منضمّان بنفس اللحظة + إلغاء المنشئ بلحظة الانضمام'); r.verbose = verbose;
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
    A.createDuoRoom(); await w.run(500);
    const code = A.duoCodeShown();
    r.ok(/^\d{6}$/.test(code), 'أُنشئت الغرفة وظهر كودها');
    B.joinCode(code); C.joinCode(code);                        // نفس اللحظة
    await w.run(6000);
    const inRoom = [B, C].filter(c => c.matches.some(m => m.room === code));
    const other = [B, C].find(c => !inRoom.includes(c));
    r.ok(A.matches.length === 1 && inRoom.length === 1, `واحد فقط دخل (${inRoom.map(c => c.name).join('،') || '—'})`);
    r.ok(other && other.matches.length === 0 && /الغرفة ممتلئة أو انتهت/.test(other.errorText()), `والآخر يرى "الغرفة ممتلئة أو انتهت!" (${other?.errorText() || '—'})`);
    const rm = w.server.getAt('rooms/' + code) || {};
    r.ok(inRoom[0] && rm.p2uid === inRoom[0].uid && rm.p2name === inRoom[0].name, 'الغرفة تحمل خصماً واحداً متّسقاً');
    noErr(r, w); w.dispose();
  }
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    A.createDuoRoom(); await w.run(500);
    const code = A.duoCodeShown();
    B.joinCode(code);
    const hit = await untilServer(w, () => (w.server.getAt('rooms/' + code) || {}).status === 'playing');
    A.cancelDuoRoom();                                         // المنشئ يلغي والانضمام سبقه بلحظة
    await w.run(8000);
    const rm = w.server.getAt('rooms/' + code) || {};
    r.ok(hit && A.matches.length === 0, 'المنشئ الذي ألغى لا يُسحب لمباراة');
    r.ok(rm.status === 'finished' && rm.abortedBy === 1 && rm.leftBy == null, `الغرفة أُلغيت قبل البدء لا "انسحاب" (${rm.status}/${rm.abortedBy}/${rm.leftBy ?? '-'})`);
    r.ok(!B.ends.length && CANCELLED_MSG.test(B.toasts()), 'المنضمّ لا يأخذ فوزاً مجانياً من إلغاء — يرى "ألغى الخصم قبل أن تبدأ المباراة"');
    noErr(r, w); w.dispose();
  }
  {
    // إلغاء الغرفة قبل أن يدخلها أحد: تُحذف (لا تبقى "منتهية" أو "تنتظر" بلا مضيف)
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    A.createDuoRoom(); await w.run(500);
    const code = A.duoCodeShown();
    A.cancelDuoRoom(); await w.run(1000);
    r.ok(w.server.getAt('rooms/' + code) == null, 'إلغاء غرفة تنتظر وحدها يحذفها');
    B.joinCode(code); await w.run(2000);
    r.ok(B.matches.length === 0 && /الغرفة غير موجودة/.test(B.errorText()), `ومن يحاول دخولها بعدها يرى "الغرفة غير موجودة!" (${B.errorText() || '—'})`);
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── مستكشف البحث الثنائي (v35.8): 3 لاعبين يبحثون ويلغون ويغلقون عشوائياً + ثوابت ──
export async function fuzzDuo(seed, verbose = false) {
  const R = rng(seed + 7777);
  const w = new World(); w.quiet = !verbose; w.startSampler(100);
  const P = [await w.client('أحمد'), await w.client('باسل'), await w.client('كريم')];
  const findings = [];
  const once = (key, msg) => { if (!findings.some(f => f.startsWith(key))) findings.push(key + msg); };
  const lastSearch = new Map(), lastCancel = new Map(), matchCount = new Map(P.map(c => [c, 0]));
  const staleSince = new Map(), lostSince = new Map();
  const inv = clock.setInterval(() => {
    const rooms = w.server.getAt('rooms') || {};
    for (const [code, rm] of Object.entries(rooms)) {
      if (!rm || rm.multi) continue;
      // (أ) لا غرفة شبحية: خصم بلا منشئ
      if (rm.p2uid && !rm.p1name) once('غرفة شبحية', ` ${code}`);
      // (ب) غرفة عامة تنتظر يجب أن يكون صاحبها يبحث فيها فعلاً (مهلة ثانيتين لأمر الانقطاع/الإلغاء)
      if (rm.status === 'waiting' && rm.public === true) {
        const owner = P.find(c => c.uid === rm.p1uid);
        const ok = owner && !owner.dead && owner.om.roomCode === code && onStep(owner, 'searching');
        if (!ok) {
          if (!staleSince.has(code)) staleSince.set(code, clock.now);
          if (clock.now - staleSince.get(code) > 2000) once('غرفة منتظرة بلا صاحب يبحث', ` ${code} (${owner?.name || '?'})`);
        } else staleSince.delete(code);
      } else staleSince.delete(code);
    }
    for (const c of P) {
      // (و) منتظر يبحث في غرفته: يجب أن تكون موجودة عند الخادم (مهلة 3ث للإنشاء، وللإعادة بعد انقطاع لحظي)
      const hc = c.om.roomCode;
      if (!c.dead && hc && c.om.playerNum === 1 && !c.om._gameStarted && onStep(c, 'searching') && !rooms[hc]) {
        if (!lostSince.has(c)) lostSince.set(c, clock.now);
        if (clock.now - lostSince.get(c) > 3000) once('منتظر في غرفة مختفية', `: ${c.name} (${hc})`);
      } else lostSince.delete(c);
      // (ج) لا مباراة لمن ألغى: مباراة بدأت بعد آخر إلغاء وبلا بحث جديد بعده
      const n = c.matches.length;
      if (n > matchCount.get(c)) {
        const m = c.matches[n - 1];
        if ((lastCancel.get(c) || -1) > (lastSearch.get(c) || -1) && m.at > lastCancel.get(c)) once('سُحب لمباراة بعد إلغائه', `: ${c.name}`);
        const rm = rooms[m.room];
        if (!rm || !rm.p1name || !rm.p2uid) once('مباراة بلا طرفين', `: ${c.name} في ${m.room}`);
        matchCount.set(c, n);
      }
    }
  }, 50);
  for (let step = 0; step < 30; step++) {
    const c = P[Math.floor(R() * P.length)];
    if (c.dead) { await w.run(500); continue; }
    const x = R();
    const onMenu = onStep(c, 'name') || onStep(c, 'random-count');
    if (onMenu) { if (x < 0.8) { lastSearch.set(c, clock.now); await c.startSearch(2); } }
    else if (onStep(c, 'searching')) {
      if (x < 0.35) { lastCancel.set(c, clock.now); c.cancelSearch(); }
      else if (x < 0.40) c.closeTab();
      // إلغاء ثم إغلاق الصفحة داخل زمن رفع الإلغاء (مراجعة v35.8: أمر المسح يجب أن يبقى حتى يُحسم الإلغاء)
      else if (x < 0.45) { lastCancel.set(c, clock.now); c.cancelSearch(); await w.run(Math.floor(R() * 40)); c.closeTab(); }
      // انقطاع لحظي للمنتظر: الخادم ينفّذ أمر مسح غرفته والصفحة باقية (يجب أن تعود غرفته — الثابت "و")
      else if (x < 0.52 && c.om.playerNum === 1 && !c.om._gameStarted) c.blip(50 + Math.floor(R() * 300));
    }
    await w.run(Math.floor(R() < 0.5 ? R() * 120 : 300 + R() * 3000));   // نصفها داخل نوافذ السباق
  }
  await w.run(15000);
  clock.clearInterval(inv);
  // (د) كل مباراة بدأت: طرفاها في غرفة واحدة بمقعدين مختلفين، ولا مقعد لغير أصحابها
  const byRoom = {};
  for (const c of P) for (const m of c.matches) (byRoom[m.room] ||= []).push({ c, m });
  for (const [room, arr] of Object.entries(byRoom)) {
    if (arr.length > 2) once('أكثر من لاعبين', ` في ${room}`);
    if (arr.length === 2 && arr[0].m.num === arr[1].m.num) once('مقعد مكرّر', ` في ${room}`);
  }
  // (هـ) لا نتائج: لا أحد انسحب أو لعب — كل ما حدث بحث وإلغاء وإغلاق
  for (const c of P) if (c.ends.length) once('نتيجة مسجّلة', `: ${c.name} (${c.ends.map(e => e.kind).join(',')})`);
  if (w.errors.length) once('أخطاء JS', `: ${w.errors[0].slice(0, 160)}`);
  w.dispose();
  return { seed, findings };
}

// ═════════════════════ 4 لاعبين ═════════════════════
// ── 14) أربعة على 4: الغرفة تمتلئ → بدء مباشر بلا تصويت ──
export async function fourFull(verbose = false) {
  const r = suite('4 لاعبين على 4: الامتلاء يبدأ مباشرة بلا تصويت'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const P = [await w.client('أحمد'), await w.client('باسل'), await w.client('كريم'), await w.client('داني')];
  let voteSeen = false;
  for (const c of P) { await c.startSearch(4); for (let i = 0; i < 20; i++) { await w.run(100); if (P.some(x => x.approvalVisible())) voteSeen = true; } }
  r.ok(await waitFor(w, () => P.every(c => c.matches.length), 10000), 'المباراة بدأت للأربعة');
  r.ok(!voteSeen, 'لا نافذة تصويت (العدد اكتمل)');
  const sig = new Set(P.map(c => JSON.stringify([c.matches[0]?.nums, c.matches[0]?.turn])));
  r.ok(sig.size === 1 && P[0].matches[0]?.nums.join() === '1,2,3,4', `متّفقون: [${P[0].matches[0]?.nums}] الدور الأول ${P[0].matches[0]?.turn}`);
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 15) ثلاثة يصوّتون والرابع يدخل منتظراً فيكتمل العدد → الأربعة معاً ──
export async function fourWaiterFills(verbose = false) {
  const r = suite('4 على 4: الرابع يدخل أثناء التصويت فيكتمل العدد → مباراة للأربعة'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const P = [await w.client('أحمد'), await w.client('باسل'), await w.client('كريم'), await w.client('داني')];
  await P[0].startSearch(4); await w.run(1500); await P[1].startSearch(4); await w.run(1500); await P[2].startSearch(4);
  await waitFor(w, () => P.slice(0, 3).every(c => c.approvalVisible()));
  await w.run(1500);
  await P[3].startSearch(4);
  r.ok(await waitFor(w, () => P.every(c => c.matches.length), 10000), 'المباراة بدأت للأربعة (بما فيهم من دخل أثناء التصويت)');
  const sig = new Set(P.map(c => JSON.stringify([c.matches[0]?.nums, c.matches[0]?.turn])));
  r.ok(sig.size === 1 && P[0].matches[0]?.nums.join() === '1,2,3,4', `متّفقون: [${P[0].matches[0]?.nums}]`);
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 16) أربعة يبحثون عن 3: ثلاثة يبدأون والرابع في غرفة أخرى وحيداً بلا عدّاد ──
export async function fourWantThree(verbose = false) {
  const r = suite('4 لاعبين يبحثون عن 3: ثلاثة يلعبون والرابع يواصل البحث'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const P = [await w.client('أحمد'), await w.client('باسل'), await w.client('كريم'), await w.client('داني')];
  for (const c of P) { await c.startSearch(3); await w.run(1500); }
  await w.run(6000);
  const playing = P.filter(c => c.matches.length), searching = P.filter(c => !c.hidden('online-step-searching'));
  r.ok(playing.length === 3 && searching.length === 1, `يلعبون ${playing.length} ويبحث ${searching.length}`);
  const rest = searching[0];
  r.ok(rest && rest.om.roomCode !== playing[0]?.matches[0]?.room && rest.hidden('search-countdown'), 'الرابع في غرفة أخرى وحيداً بلا عدّاد');
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ═════════════════════ مستكشف الغرفة بالكود ═════════════════════
// أفعال عشوائية: انضمام/مغادرة/بدء — الثوابت: لا مقاعد مكرّرة، تاج واحد متّفق عليه وحامله حاضر،
// زر البدء لحامل التاج وحده، ومباريات متّسقة
export async function fuzzCode(seed, verbose = false) {
  const R = rng(seed * 7919 + 13);
  const w = new World(); w.quiet = !verbose; w.startSampler(100);
  const P = [await w.client('أحمد'), await w.client('باسل'), await w.client('كريم'), await w.client('داني')];
  const findings = [];
  const once = (key, msg) => { if (!findings.some(f => f.startsWith(key))) findings.push(key + msg); };
  const max = R() < 0.5 ? 3 : 4;
  const code = await makeCodeRoom(w, P[0], max);
  let lastChange = clock.now, lastSig = '';
  const inv = clock.setInterval(() => {
    const rm = w.server.getAt('rooms/' + code);
    if (!rm) return;
    const nums = Object.values(rm.players || {}).map(p => p && p.num).filter(n => typeof n === 'number');
    if (new Set(nums).size !== nums.length) once('مقاعد مكرّرة', `: [${nums}]`);
    const inLobby = P.filter(c => !c.dead && c.om?.roomCode === code && !c.hidden('online-step-multi-lobby'));
    const sig = JSON.stringify([rm.hostNum, nums.sort(), rm.status]);
    if (sig !== lastSig) { lastSig = sig; lastChange = clock.now; }
    if (rm.status !== 'lobby' || clock.now - lastChange < 1500 || !inLobby.length) return;
    const crowns = new Set(inLobby.map(crownOf));
    if (crowns.size !== 1) once('تاج مختلف', ` بين اللاعبين: [${[...crowns]}]`);
    const holder = [...crowns][0];
    if (!nums.includes(holder)) once('تاج لغائب', `: المقعد ${holder} غير حاضر [${nums}]`);
    const withBtn = inLobby.filter(c => c.startBtnVisible()).map(c => c.om.playerNum);
    if (nums.length >= 2 && (withBtn.length !== 1 || withBtn[0] !== holder)) once('زر البدء', ` عند [${withBtn}] والتاج على ${holder}`);
  }, 250);
  let started = false;
  for (let step = 0; step < 30 && !started; step++) {
    const c = P[Math.floor(R() * P.length)];
    const x = R();
    const inLobby = c.om?.roomCode === code && !c.hidden('online-step-multi-lobby');
    if (!inLobby) { if (x < 0.6) c.joinCode(code); }
    else if (c.startBtnVisible() && x < 0.12) { c.startCode(); started = true; }
    else if (x < 0.25) c.leaveCode();
    await w.run(Math.floor(300 + R() * 2500));
    if (!w.server.getAt('rooms/' + code)) break;       // غادر الجميع
  }
  await w.run(6000);
  clock.clearInterval(inv);
  const byRoom = {};
  for (const c of P) for (const m of c.matches) (byRoom[m.room] ||= []).push({ c, m });
  for (const [room, arr] of Object.entries(byRoom)) {
    if (new Set(arr.map(x => JSON.stringify([x.m.nums, x.m.turn]))).size > 1) once('اختلاف', ` بين لاعبي مباراة ${room}`);
    for (const x of arr) if (!x.m.nums.includes(x.m.num)) once('دخيل', `: ${x.c.name}`);
  }
  if (w.errors.length) once('أخطاء JS', `: ${w.errors[0].slice(0, 160)}`);
  w.dispose();
  return { seed, findings };
}

// ── 17) المضيف السابق يعود للغرفة: لا تاج ولا زر بدء، ولا يستطيع البدء ولو نقر ──
export async function codeExHostRejoins(verbose = false) {
  const r = suite('غرفة بالكود: المضيف السابق يعود — بلا زر بدء ولا يستطيع البدء'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(50);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  const code = await makeCodeRoom(w, A, 4);
  B.joinCode(code); await w.run(800);
  A.leaveCode(); await w.run(1500);
  A.joinCode(code);
  // من لحظة ظهور اللوبي عند العائد: لا نرى تاجاً عليه ولا زر بدء عنده أبداً
  let staleCrown = false, staleBtn = false;
  for (let i = 0; i < 40; i++) {
    await w.run(50);
    if (!A.hidden('online-step-multi-lobby')) {
      if (A.lobbyList().some(p => p.name === 'أحمد' && p.host)) staleCrown = true;
      if (A.startBtnVisible()) staleBtn = true;
    }
  }
  r.ok(!staleCrown, 'العائد لا يرى التاج على نفسه ولو لحظة');
  r.ok(!staleBtn, 'العائد لا يرى زر البدء');
  r.ok(crownOf(A) === 2 && crownOf(B) === 2 && B.startBtnVisible(), 'التاج وزر البدء عند باسل (المضيف الحالي)');
  A.el('multi-start-btn').click(); await w.run(3000);     // نقرة قسرية على الزر المخفي
  r.ok(!A.matches.length && !B.matches.length && w.server.getAt(`rooms/${code}/status`) === 'lobby', 'نقرة غير المضيف لا تبدأ المباراة');
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 18) البحث العشوائي: المنشئ يغلق تبويبه أثناء التجميع → الباقون يكملون (إصلاح 1.2) ──
export async function randomHostClosesTab(verbose = false) {
  const r = suite('البحث العشوائي: المنشئ يغلق تبويبه أثناء التجميع → الباقون يكملون معاً'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  await A.startSearch(4); await w.run(2000); await B.startSearch(4); await w.run(2000); await C.startSearch(4); await w.run(3000);
  const code = B.om.roomCode;
  A.closeTab(); await w.run(3000);
  r.ok(!!w.server.getAt('rooms/' + code), 'الغرفة لم تُحذف بإغلاق تبويب المنشئ');
  r.ok(B.om.roomCode === code && C.om.roomCode === code, 'الباقون ما زالوا في نفس الغرفة');
  r.ok(!B.hidden('online-step-searching') && !C.hidden('online-step-searching'), 'لم يُطردا لشاشة اختيار العدد');
  r.ok(!w.timeline.some(l => l.includes('غادر منشئ الغرفة')), 'لا رسالة "غادر منشئ الغرفة"');
  r.ok(Object.keys(w.server.getAt('rooms/' + code + '/players') || {}).length === 2, 'بقي لاعبان في الغرفة');
  r.ok(await waitFor(w, () => B.approvalVisible() && C.approvalVisible(), 25000), 'التجميع يكمل حتى التصويت بالعدد المتبقي');
  B.accept(); await w.run(400); C.accept();
  r.ok(await waitFor(w, () => B.matches.length && C.matches.length, 12000), 'المباراة تبدأ لهما');
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ═════════════════════ نهايات الانسحاب (v35.6 — الخطوة 1.6) ═════════════════════
// كل نهاية بخروج الخصوم تمرّ على نافذة النتيجة (فوز مسجّل + عملات) بدل رسالة ثم إعادة تحميل،
// والمنسحب بالزر تُسجَّل خسارته. نلتقط النهايات عبر بديل gameEnd.js في المحاكي.
const endsOf = (c, kind) => c.ends.filter(e => e.kind === kind);
const noErr = (r, w) => r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
async function duoMatch(w) {
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await A.startSearch(2); await w.run(1500); await B.startSearch(2);
  await waitFor(w, () => A.matches.length && B.matches.length, 8000);
  await w.run(5000);   // معالجات نهاية المباراة تُسجَّل بعد تحميل اللوحة (المنضم ينتظر خريطة العناصر)
  return { A, B };
}

// ── 19) الثنائي: الانسحاب بالزر — بالاتجاهين (المنضم ينسحب، ثم المنشئ) ──
// المنشئ والمنضم مستمعاتهما مختلفة (المنشئ على الغرفة مرتين، المنضم مرة) — نفحص الاتجاهين
export async function duoWithdrawEnding(verbose = false) {
  const r = suite('الثنائي: المنسحب بالزر تُسجَّل خسارته، وخصمه يرى فوزه بنافذة النتيجة'); r.verbose = verbose;
  for (const who of ['المنضم', 'المنشئ']) {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const { A, B } = await duoMatch(w);
    const L = who === 'المنضم' ? B : A;        // المنسحب
    const S = who === 'المنضم' ? A : B;        // الباقي (الفائز)
    const lNum = who === 'المنضم' ? 2 : 1;
    r.ok(A.matches.length && B.matches.length, `${who} ينسحب: بدأت المباراة`);
    L.withdraw(); await w.run(4000);
    const e = endsOf(S, 'end');
    r.ok(e.length === 1, `${who}: نافذة نتيجة واحدة عند الفائز (${e.length}) — إشارتا "أنهى" و"غادر" لا تكرّرانها`);
    r.ok(e[0]?.forced && e[0]?.exitInfo?.[lNum] === 'انسحب', `${who}: بشارة "انسحب" (${JSON.stringify(e[0]?.exitInfo)})`);
    r.ok(/فزت/.test(e[0]?.title || '') && new RegExp('انسحب ' + L.name).test(e[0]?.title || ''), `${who}: العنوان "${e[0]?.title}"`);
    r.ok(endsOf(L, 'forfeit').length === 1 && endsOf(L, 'end').length === 0, `${who}: خسارته مسجّلة ولا نافذة فوز عنده`);
    r.ok(!/الخصم أنهى اللعبة/.test(S.toasts()), `${who}: لا رسالة "الخصم أنهى اللعبة" القديمة`);
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 20) الثنائي: الخصم يغلق تبويبه ──
export async function duoDropEnding(verbose = false) {
  const r = suite('الثنائي: الخصم يغلق تبويبه → فوز مسجّل للباقي'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const { A, B } = await duoMatch(w);
  const code = A.om.roomCode;
  B.closeTab(); await w.run(3000);
  r.ok(w.server.getAt(`rooms/${code}/dropped2`) === true, 'الغرفة تعرف من انقطع (dropped2)');
  const e = endsOf(A, 'end');
  r.ok(e.length === 1 && e[0].exitInfo?.[2] === 'انقطع' && /انقطع اتصال باسل/.test(e[0].title || ''), `الفائز: "${e[0]?.title}" ${JSON.stringify(e[0]?.exitInfo)}`);
  noErr(r, w); w.dispose(); return r;
}

// ── 21) الثنائي: انقطاع حقيقي (Firebase يطبّق onDisconnect محلياً أولاً) — من انقطع لا يفوز ──
// اكتشفه مراجع v35.6: المنقطع يرى "انتهت" قبل الخادم؛ لو قرأ الغرفة من الشبكة وجدها "جارية" فأعلن فوزه
async function dropCase(r, dropper, label, timing) {
  const w = new World(); w.quiet = true; w.startSampler(100);
  const { A, B } = await duoMatch(w);
  const D = dropper === 'A' ? A : B, S = dropper === 'A' ? B : A;
  const dNum = dropper === 'A' ? 1 : 2;
  D.drop(timing); await w.run(Math.max(timing.offlineMs, timing.serverDetectMs) + 4000);
  const eS = endsOf(S, 'end');
  r.ok(eS.length === 1 && eS[0].exitInfo?.[dNum] === 'انقطع' && /فزت/.test(eS[0].title || ''), `${label}: الباقي يفوز: "${eS[0]?.title}"`);
  r.ok(endsOf(D, 'end').length === 0, `${label}: من انقطع لا نافذة فوز عنده ولا تسجيل`);
  r.ok(/انقطع اتصالك/.test(D.toasts()), `${label}: ومن انقطع يرى "انقطع اتصالك — انتهت المباراة"`);
  noErr(r, w); w.dispose();
}
export async function duoRealDrop(verbose = false) {
  const r = suite('الثنائي: انقطاع حقيقي للمضيف أو المنضم → الباقي يفوز، ومن انقطع لا يعلن فوزه'); r.verbose = verbose;
  // الخادم يلاحظ أولاً، ثم يعود الجهاز
  await dropCase(r, 'A', 'المضيف ينقطع (الخادم يلاحظ أولاً)', { offlineMs: 4000, serverDetectMs: 1500 });
  await dropCase(r, 'B', 'المنضم ينقطع (الخادم يلاحظ أولاً)', { offlineMs: 4000, serverDetectMs: 1500 });
  // الأصعب والأشيع: انقطاع قصير يعود منه الجهاز قبل أن يلاحظ الخادم (قد يتأخر حتى دقيقة) —
  // الخادم ما زال "جارية" عند العودة، فأي قراءة شبكة كانت تُعلن فوز المنقطع
  await dropCase(r, 'A', 'المضيف ينقطع (يعود قبل الخادم)', { offlineMs: 3000, serverDetectMs: 20000 });
  await dropCase(r, 'B', 'المنضم ينقطع (يعود قبل الخادم)', { offlineMs: 3000, serverDetectMs: 20000 });
  return r;
}

// ── 21ب) انقطاع طويل: الفائز يخرج (أو يغلق صفحته) قبل عودة المنقطع — لا يُقرأ خروجه انسحاباً ──
export async function duoLongDrop(verbose = false) {
  const r = suite('الثنائي: انقطاع طويل ثم خروج الفائز → العائد لا يعلن فوزه'); r.verbose = verbose;
  for (const how of ['زر الخروج', 'إغلاق الصفحة']) {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const { A, B } = await duoMatch(w);
    const code = A.om.roomCode;
    B.drop({ offlineMs: 20000, serverDetectMs: 1500 }); await w.run(4000);
    r.ok(endsOf(A, 'end').length === 1, `${how}: المضيف فاز بانقطاع المنضم`);
    if (how === 'زر الخروج') A.withdraw(); else A.closeTab();
    await w.run(3000);
    r.ok(w.server.getAt(`rooms/${code}/leftBy`) == null && w.server.getAt(`rooms/${code}/dropped1`) == null,
      `${how}: خروج الفائز بعد النهاية صامت (لا leftBy ولا dropped1 فوق غرفة انتهت)`);
    r.ok(endsOf(A, 'forfeit').length === 0, `${how}: الفائز لا تُسجَّل عليه خسارة بخروجه بعد النهاية`);
    await w.run(20000);   // المنقطع يعود
    r.ok(endsOf(B, 'end').length === 0 && /انقطع اتصالك/.test(B.toasts()), `${how}: العائد يعرف أنه هو من انقطع، بلا فوز`);
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 21ج) مباراة ثانية بعد الأولى: معالجات الأولى لا تبقى، وما يصل قبل تحميل الثانية لا يضيع ──
// (مراجعة v35.6: المعالجات القديمة كانت تلتقط أحداث الغرفة الجديدة قبل أن تسجّل معالجاتها
//  فيُسجَّل الفوز مرتين؛ وبفصلها يجب أن يُسلَّم "انتهت" المبكر عند التسجيل لا أن يضيع)
export async function duoSecondMatch(verbose = false) {
  const r = suite('الثنائي: مباراة ثانية — معالجات الأولى تُفصل، وانسحاب مبكر في الثانية يُسجَّل مرة واحدة'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const { A, B } = await duoMatch(w);
  B.withdraw(); await w.run(4000);
  r.ok(endsOf(A, 'end').length === 1, 'المباراة الأولى: أحمد فاز بانسحاب باسل');
  A.mods.og.leaveOnlineMatch(); await w.run(1500);      // "العب مجدداً" بعد النهاية
  r.ok(A.om._cbLeft == null && A.om._cbRestart == null && A.om._cbMove == null,
    'بعد المغادرة: لا معالجات نهاية ولا حركات من المباراة الأولى');
  const C = await w.client('كريم');
  await A.startSearch(2); await w.run(1500); await C.startSearch(2);
  // كريم ينسحب فور بدء المباراة — قبل أن يكمل أحمد تحميلها ويسجّل معالجاتها (800ms)
  r.ok(await waitFor(w, () => C.matches.length > 0 || (C.om.roomCode && A.om.roomCode === C.om.roomCode), 8000), 'بدأت المباراة الثانية');
  C.withdraw(); await w.run(6000);
  const e = endsOf(A, 'end');
  r.ok(e.length === 2, `أحمد: نافذة نتيجة واحدة للمباراة الثانية (المجموع ${e.length} من 2)`);
  r.ok(e[1]?.exitInfo?.[2] === 'انسحب' && /انسحب كريم/.test(e[1]?.title || ''), `الثانية: "${e[1]?.title}"`);
  noErr(r, w); w.dispose(); return r;
}

// ── 22ب) الجماعي: ختم انقطاع متأخر لا يُخرج لاعباً عاد ──
// (مراجعة v35.6: بعد انقطاع قصير قد ينفّذ الخادم onDisconnect الاتصال القديم بعد العودة —
//  فيُكتب ختم لا يمسحه أحد، ويُخرَج اللاعب المتصل بعد 10ث وتُسجَّل خسارته)
export async function multiLateMark(verbose = false) {
  const r = suite('الجماعي: ختم انقطاع متأخر بعد العودة لا يُخرج اللاعب'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  const code = await makeCodeRoom(w, A, 3);
  B.joinCode(code); await w.run(600); C.joinCode(code); await w.run(800);
  A.startCode();
  r.ok(await waitFor(w, () => A.matches.length && B.matches.length && C.matches.length, 8000), 'بدأت المباراة للثلاثة');
  await w.run(6000);
  C.drop({ offlineMs: 3000, serverDetectMs: 20000 });   // يعود بعد 3ث، والخادم يلاحظ بعد 20ث
  await w.run(40000);
  // الختم المتأخر ظهر فعلاً عند الباقين (بعد عودة كريم بـ17ث) — الحالة التي نفحصها
  r.ok(/كريم يعاني انقطاعاً/.test(A.toasts()), 'الخادم كتب ختم الانقطاع متأخراً بعد عودة كريم');
  r.ok(w.server.getAt(`rooms/${code}/players/${C.uid}/active`) !== false, 'كريم ما زال في المباراة (لم يُخرَج)');
  r.ok(w.server.getAt(`rooms/${code}/players/${C.uid}/disconnectedAt`) == null, 'الختم المتأخر مُسح');
  r.ok([A, B, C].every(c => endsOf(c, 'end').length === 0 && endsOf(c, 'forfeit').length === 0), 'لا نهاية ولا خسارة لأحد');
  noErr(r, w); w.dispose(); return r;
}

// ── 22) الجماعي: آخر الباقين يفوز، ومن خرج وبقيت صفحته تُسجَّل خسارته ──
export async function multiLastStanding(verbose = false) {
  const r = suite('الجماعي: انسحاب الجميع إلا واحداً → فوزه بنافذة النتيجة، والخارج الحاضر خسارة'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  const code = await makeCodeRoom(w, A, 3);
  B.joinCode(code); await w.run(600); C.joinCode(code); await w.run(800);
  A.startCode();
  r.ok(await waitFor(w, () => A.matches.length && B.matches.length && C.matches.length, 8000), 'بدأت المباراة للثلاثة');
  await w.run(6000);
  B.withdraw(); await w.run(2000);
  r.ok(endsOf(B, 'forfeit').length === 1, 'باسل انسحب بالزر: خسارته مسجّلة');
  r.ok(endsOf(A, 'end').length === 0 && endsOf(C, 'end').length === 0, 'بقي اثنان: المباراة تكمل بلا نهاية');
  C.drop({ offlineMs: 15000, serverDetectMs: 1500 }); await w.run(17000);   // كريم ينقطع أكثر من مهلة السماح (10ث) وصفحته مفتوحة
  const eA = endsOf(A, 'end'), eC = endsOf(C, 'end');
  r.ok(eA.length === 1 && /فزت بالمباراة/.test(eA[0].title || '') && /جميع خصومك/.test(eA[0].title || ''), `أحمد آخر الباقين: "${eA[0]?.title}"`);
  r.ok(eC.length === 1 && /كنت خارجها/.test(eC[0].title || ''), `كريم (خرج وصفحته مفتوحة): "${eC[0]?.title}"`);
  r.ok(endsOf(B, 'end').length === 0, 'المنسحب بالزر لا تصله نافذة (غادر الغرفة)');
  await w.run(5000);
  r.ok(endsOf(A, 'end').length === 1 && endsOf(C, 'end').length === 1, 'لا تكرار للنهاية مع تحديثات الغرفة اللاحقة');
  noErr(r, w); w.dispose(); return r;
}

// ═════════ 🚪 الخروج من مباراة جماعية جارية (v35.7) ═════════
// فحصك 6: من خرج (انقطع ولم يعد خلال المهلة) يعود مشاهداً، وزر الخروج كان يحذّره من خسارة وقعت
// أصلاً. ووراءها: خسارته تُسجَّل فقط لو بقي للنهاية أو ضغط خروج (إغلاق الصفحة يُسقطها)، وعملاته
// تتبع صبره، والخارجون يُرتَّبون بالنقاط في النهاية فتتكرّر المراكز. الإصلاح: التسجيل لحظة الخروج،
// بطاقة واضحة، خروج هادئ بعدها، سبب ولحظة الخروج في الغرفة، والمراكز بترتيب الخروج.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cardOf = c => c.toasts().split('\n').filter(l => /خرجت من المباراة/.test(l) && /تابع المشاهدة/.test(l));
const setScores = (cs, sc) => cs.forEach(c => { c.mods.state.scores = { ...sc }; });
const seat = (w, code, c) => w.server.getAt(`rooms/${code}/players/${c.uid}`) || {};
async function codeMatch3(w) {
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  const code = await makeCodeRoom(w, A, 3);
  B.joinCode(code); await w.run(600); C.joinCode(code); await w.run(800);
  A.startCode();
  const ok = await waitFor(w, () => A.matches.length && B.matches.length && C.matches.length, 8000);
  await w.run(6000);
  return { A, B, C, code, ok };
}

// ── 23) انقطع ولم يعد: خسارته لحظة خروجه + بطاقة، ثم خروج هادئ (فحصك 6 بالضبط) ──
export async function multiOutDropped(verbose = false) {
  const r = suite('الجماعي: انقطع ولم يعد → خروجه يُسجَّل فوراً مع بطاقة، وزر الخروج بعدها هادئ'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const { A, B, C, code, ok } = await codeMatch3(w);
  r.ok(ok, 'بدأت المباراة للثلاثة');
  setScores([A, B, C], { 1: 2, 2: 1, 3: 3 });
  C.drop({ offlineMs: 16000, serverDetectMs: 1500 });
  await w.run(14000);   // الخادم لاحظ بعد 1.5ث، ومهلة 10ث انقضت عند الباقين
  const s = seat(w, code, C);
  r.ok(s.active === false && s.outReason === 'dropped' && typeof s.outAt === 'number',
    `المقعد: خارج بسبب "انقطع" مع لحظة الخروج (${JSON.stringify({ active: s.active, why: s.outReason ?? null, at: typeof s.outAt })})`);
  r.ok(/انقطع كريم ولم يعد/.test(A.toasts()) && !/كريم انسحب/.test(A.toasts()), 'الباقون يرون "انقطع كريم ولم يعد" لا "انسحب"');
  await w.run(4000);    // عاد كريم
  const e = endsOf(C, 'elim');
  r.ok(e.length === 1 && e[0].reason === 'dropped' && e[0].myRank === 3 && e[0].count === 3,
    `عند عودته: خروجه مسجّل فوراً (${JSON.stringify(e[0] ? { why: e[0].reason, rank: e[0].myRank, of: e[0].count } : null)})`);
  r.ok(e.length === 1 && e[0].silent === false, 'تسجيل عادي (هو في الصفحة ويرى بطاقته — لا مغادرة)');
  const card = cardOf(C);
  r.ok(card.length === 1 && /انقطع اتصالك ولم تعد خلال المهلة/.test(card[0]) && /المركز 3 من 3/.test(card[0]) && /العودة للقائمة/.test(card[0]),
    `بطاقة بمركزه وخيارين: ${card[0] ? card[0].replace(/^.*toast\s+/, '').slice(0, 150) : '—'}`);
  r.ok(C.mods.og.isOutOfMatch?.() === true, 'حالته: خارج المباراة (يشاهد)');
  r.ok(!C.onDisc.some(o => o.path.endsWith(`${C.uid}/disconnectedAt`)), 'لا أمر انقطاع مسلّح على مقعده الخارج (مراجعة v35.7)');
  // النص الظاهر فوق اللوحة (nat-turn-text) — كان الفحص على عنصر شاشة الأونلاين المخفي أثناء اللعب فنجح والمستخدم لا يرى شيئاً
  const shown = C.el('nat-turn-text').textContent || '';
  r.ok(/خرجت من المباراة/.test(shown) && /تشاهد/.test(shown) && /دور /.test(shown), `فوق اللوحة: "${shown}"`);
  r.ok([A, B, C].every(c => endsOf(c, 'end').length === 0), 'المباراة مستمرة لأحمد وباسل');
  // زر الخروج بعد خروجه: هادئ — لا خسارة ثانية ولا كتابة فوق سبب خروجه ولحظته
  const before = JSON.stringify(seat(w, code, C));
  C.withdraw(); await w.run(3000);
  r.ok(endsOf(C, 'forfeit').length === 0, 'الخروج بعدها: لا "خسارة انسحاب" ثانية (ولا تحذير منها)');
  r.ok(JSON.stringify(seat(w, code, C)) === before, 'ولا تُعاد كتابة سبب خروجه ولحظته');
  r.ok(endsOf(C, 'elim').length === 1, 'وتسجيل الخروج بقي مرة واحدة');
  noErr(r, w); w.dispose(); return r;
}

// ── 24) نفد وقته: سبب "نفد وقته"، ولا إخراج ثانٍ يغيّر سببه أو لحظته ──
export async function multiOutTime(verbose = false) {
  const r = suite('الجماعي: نفد وقته → خروجه مسجّل بسببه ومركزه، وإخراج متأخر لا يكتب فوقه'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const { A, B, C, code, ok } = await codeMatch3(w);
  r.ok(ok, 'بدأت المباراة للثلاثة');
  setScores([A, B, C], { 1: 1, 2: 1, 3: 5 });
  C.safe(() => C.om.markSelfInactive());   // ما يفعله main.js عند نفاد بنك كريم
  await w.run(1500);
  const s = seat(w, code, C);
  r.ok(s.active === false && s.outReason === 'time' && typeof s.outAt === 'number', `المقعد: "نفد وقته" مع لحظة الخروج (${s.outReason ?? null})`);
  const e = endsOf(C, 'elim');
  r.ok(e.length === 1 && e[0].reason === 'time' && e[0].myRank === 3,
    `كريم: خروجه مسجّل فوراً بالمركز 3 رغم تقدّمه بالنقاط (${JSON.stringify(e[0] ? { why: e[0].reason, rank: e[0].myRank } : null)})`);
  r.ok(cardOf(C).some(l => /نفد وقتك — خرجت من المباراة/.test(l)), 'بطاقة "نفد وقتك — خرجت من المباراة"');
  r.ok(/خرجت من المباراة — تشاهد/.test(C.el('nat-turn-text').textContent || ''), `فوق اللوحة: "${C.el('nat-turn-text').textContent}"`);
  r.ok(!/كريم انسحب/.test(A.toasts() + B.toasts()), 'الباقون لا يرون "كريم انسحب" (السبب نفاد الوقت)');
  // أجهزة أخرى "تنقذ" متأخرة (ظنّته منقطعاً): لا تغيّر سبب خروجه ولا لحظته
  B.safe(() => B.om.markPlayerInactiveByNum(3)); A.safe(() => A.om.expirePlayerByNum(3));
  await w.run(1500);
  const s2 = seat(w, code, C);
  r.ok(s2.outReason === 'time' && s2.outAt === s.outAt, `إخراج ثانٍ لا يكتب فوق الأول (${s2.outReason}، ${s2.outAt === s.outAt ? 'نفس اللحظة' : 'تغيّرت اللحظة'})`);
  r.ok(endsOf(C, 'elim').length === 1, 'وتسجيل الخروج مرة واحدة');
  // جهاز منقطع (قائمته قديمة: يظن نفسه ما زال في المباراة) يعلن نفاد وقته بعد أن أخرجه غيره —
  // الفحص المسبق لا يكفي هنا؛ المعاملة الذرّية ترفض الإخراج الثاني فلا تتغيّر لحظة خروجه
  B.drop({ offlineMs: 8000, serverDetectMs: 30000 });
  A.safe(() => A.om.markPlayerInactiveByNum(2)); await w.run(1500);
  const b1 = seat(w, code, B);
  B.safe(() => B.om.markSelfInactive()); await w.run(1500);
  const b2 = seat(w, code, B);
  r.ok(b1.active === false && b2.outReason === 'time' && b2.outAt === b1.outAt,
    `إخراج من جهاز بقائمة قديمة لا يكتب فوق الأول (${b2.outAt === b1.outAt ? 'نفس اللحظة' : 'تغيّرت اللحظة'})`);
  noErr(r, w); w.dispose(); return r;
}

// ── 25) أربعة لاعبين: المراكز بترتيب الخروج، كل مركز لواحد فقط ──
export async function multiExitOrder(verbose = false) {
  const r = suite('الجماعي: المراكز بترتيب الخروج — أول من خرج آخرها، بلا تكرار (4 لاعبين)'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم'), D = await w.client('دانة');
  const code = await makeCodeRoom(w, A, 4);
  B.joinCode(code); await w.run(600); C.joinCode(code); await w.run(600); D.joinCode(code); await w.run(800);
  A.startCode();
  r.ok(await waitFor(w, () => [A, B, C, D].every(c => c.matches.length), 8000), 'بدأت المباراة للأربعة');
  await w.run(6000);
  setScores([A, B, C, D], { 1: 1, 2: 2, 3: 8, 4: 0 });   // كريم متقدّم بفارق وسيخرج أولاً
  C.withdraw(); await w.run(2000);
  B.withdraw(); await w.run(2000);
  const fC = endsOf(C, 'forfeit')[0], fB = endsOf(B, 'forfeit')[0];
  r.ok(fC?.myRank === 4, `كريم (خرج أولاً، متقدّم بالنقاط): المركز 4 (${fC?.myRank})`);
  r.ok(fB?.myRank === 3, `باسل (خرج ثانياً): المركز 3 — لا يتكرّر مع كريم (${fB?.myRank})`);
  D.drop({ offlineMs: 16000, serverDetectMs: 1500 }); await w.run(19000);   // دانة لا تعود بالمهلة → أحمد آخر الباقين
  const eA = endsOf(A, 'end')[0];
  const order = eA ? eA.ranking.map(x => `${x.player}:${x.rank}`).join(' ') : '—';
  r.ok(eA && same(eA.ranking.map(x => [x.player, x.rank]), [[1, 1], [4, 2], [2, 3], [3, 4]]), `نافذة أحمد بترتيب الخروج (${order})`);
  const eD = endsOf(D, 'elim')[0], endD = endsOf(D, 'end')[0];
  r.ok(eD?.reason === 'dropped' && eD?.myRank === 2 && endD?.myRank === 2, `دانة: خروجها مسجّل بالمركز 2 ونافذتها تطابقه (${eD?.myRank}/${endD?.myRank})`);
  r.ok(cardOf(D).length === 0, 'دانة: خروجها أنهى المباراة → نافذة النتيجة وحدها بلا بطاقة');
  const ranks = [eA?.myRank, eD?.myRank, fB?.myRank, fC?.myRank];
  r.ok(same([...ranks].sort(), [1, 2, 3, 4]), `كل مركز لواحد فقط (${ranks})`);
  noErr(r, w); w.dispose(); return r;
}

// ── 26) الخارج يتابع حتى النهاية: النافذة النهائية بمركزه نفسه، بلا تسجيل ثانٍ ──
export async function multiOutWatchToEnd(verbose = false) {
  const r = suite('الجماعي: الخارج يتابع حتى النهاية → النافذة النهائية بمركزه نفسه، بلا تسجيل ثانٍ'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const { A, B, C, ok } = await codeMatch3(w);
  r.ok(ok, 'بدأت المباراة للثلاثة');
  setScores([A, B, C], { 1: 1, 2: 0, 3: 6 });
  C.drop({ offlineMs: 16000, serverDetectMs: 1500 }); await w.run(18000);
  r.ok(endsOf(C, 'elim')[0]?.myRank === 3, `كريم خرج (انقطع) ومركزه 3 (${endsOf(C, 'elim')[0]?.myRank})`);
  B.withdraw(); await w.run(3000);
  const fB = endsOf(B, 'forfeit')[0];
  r.ok(fB?.myRank === 2, `باسل انسحب بعد خروج كريم: المركز 2 (${fB?.myRank})`);
  const eA = endsOf(A, 'end')[0], eC = endsOf(C, 'end')[0];
  r.ok(eA && /جميع خصومك/.test(eA.title || '') && eA.myRank === 1, 'أحمد آخر الباقين: فاز');
  r.ok(eC && /كنت خارجها/.test(eC.title || '') && eC.myRank === 3, `كريم يرى النتيجة النهائية بمركزه نفسه (${eC?.myRank})`);
  r.ok(endsOf(C, 'elim').length === 1 && endsOf(C, 'forfeit').length === 0, 'بلا تسجيل ثانٍ لكريم');
  noErr(r, w); w.dispose(); return r;
}

// ═════════ مراجعة v35.7: حالات كشفها المراجع المستقل ═════════

// ── 27) أُخرج أثناء غيابه واكتملت اللوحة قبل عودته: لا فوز له (الحركات تصل قبل القائمة) ──
export async function multiOutNaturalEndWhileAway(verbose = false) {
  const r = suite('الجماعي: أُخرج أثناء غيابه واكتملت اللوحة قبل عودته → خسارته لا فوز'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const { A, B, C, code, ok } = await codeMatch3(w);
  r.ok(ok, 'بدأت المباراة للثلاثة');
  setScores([A, B, C], { 1: 2, 2: 1, 3: 6 });   // كريم متقدّم بالنقاط
  C.drop({ offlineMs: 30000, serverDetectMs: 1500 });
  await w.run(14000);                            // أُخرج كريم بعد المهلة ("انقطع")
  r.ok(seat(w, code, C).outReason === 'dropped', 'كريم أُخرج أثناء غيابه');
  A.safe(() => A.om.pushMultiMove('__final__', 2, Date.now()));   // اكتملت اللوحة وكريم غائب
  await w.run(2000);
  const eB = endsOf(B, 'end')[0];
  r.ok(eB && eB.ranking.find(x => x.player === 3)?.exited === 'انقطع', 'عند باسل: كريم خارج ("انقطع")');
  await w.run(16000);                            // عاد كريم: الحركات ثم القائمة في دفعة واحدة
  const eC = endsOf(C, 'end')[0], xC = endsOf(C, 'elim');
  r.ok(xC.length === 1 && xC[0].reason === 'dropped' && xC[0].myRank === 3, `خروجه مسجّل قبل النهاية (${JSON.stringify(xC[0] ? { why: xC[0].reason, rank: xC[0].myRank } : null)})`);
  r.ok(eC && eC.myResult === 'loss' && eC.myRank === 3, `نافذته: خسارة بالمركز 3 لا فوز (${eC?.myResult}/${eC?.myRank})`);
  r.ok(cardOf(C).length === 0, 'بلا بطاقة (نافذة النتيجة النهائية وحدها)');
  noErr(r, w); w.dispose(); return r;
}

// ── 28) انسحاب ونفاد وقت شبه متزامنين (المنسحب على شبكة أبطأ): مركزان مختلفان يطابقان النافذة ──
export async function multiNearSimultaneousExits(verbose = false) {
  const r = suite('الجماعي: خروجان متقاربان (انسحاب على شبكة بطيئة + نفاد وقت) → مركزان مختلفان'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم', { up: 250, down: 30 }), D = await w.client('دانة');
  const code = await makeCodeRoom(w, A, 4);
  B.joinCode(code); await w.run(600); C.joinCode(code); await w.run(800); D.joinCode(code); await w.run(800);
  A.startCode();
  r.ok(await waitFor(w, () => [A, B, C, D].every(c => c.matches.length), 8000), 'بدأت المباراة للأربعة');
  await w.run(6000);
  setScores([A, B, C, D], { 1: 3, 2: 2, 3: 1, 4: 0 });
  C.withdraw();                                                              // كريم يضغط خروج
  await w.run(100);
  D.safe(() => D.mods.og.noteMyExitPending('time', D.om.markSelfInactive()));   // بعد 100ms ينفد وقت دانة
  await w.run(3000);
  const fC = endsOf(C, 'forfeit')[0], xD = endsOf(D, 'elim')[0];
  const sC = seat(w, code, C), sD = seat(w, code, D);
  r.ok(sC.outAt > sD.outAt, 'الخادم اعتمد خروج دانة أولاً (شبكة كريم أبطأ)');
  r.ok(xD?.myRank === 4 && fC?.myRank === 3, `المركزان من ترتيب الخادم: دانة 4 وكريم 3 (${xD?.myRank}/${fC?.myRank})`);
  B.withdraw(); await w.run(3000);                                            // أحمد آخر الباقين
  const eA = endsOf(A, 'end')[0];
  const got = eA ? Object.fromEntries(eA.ranking.map(x => [x.player, x.rank])) : {};
  r.ok(eA && got[3] === fC?.myRank && got[4] === xD?.myRank && got[2] === endsOf(B, 'forfeit')[0]?.myRank,
    `نافذة أحمد تطابق ما سُجّل لكلٍّ منهم (${eA ? eA.ranking.map(x => `${x.player}:${x.rank}`).join(' ') : '—'})`);
  noErr(r, w); w.dispose(); return r;
}

// ── 29) نفد وقتي وضغطت خروج قبل أن يؤكّده الخادم: لا تحذير ولا انسحاب — خروج "نفد وقته" ──
export async function multiTimeoutThenQuickExit(verbose = false) {
  const r = suite('الجماعي: نفد وقته وضغط خروج خلال رحلة التأكيد → خروج بسبب الوقت لا انسحاب'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const { A, B, C, code, ok } = await codeMatch3(w);
  r.ok(ok, 'بدأت المباراة للثلاثة');
  setScores([A, B, C], { 1: 1, 2: 1, 3: 4 });
  C.safe(() => C.mods.og.noteMyExitPending('time', C.om.markSelfInactive()));   // ما يفعله main.js عند نفاد بنكه
  await w.run(5);
  r.ok(C.mods.og.isOutOfMatch() === true, 'خارج فوراً قبل تأكيد الخادم (فلا تحذير "الانسحاب = خسارة")');
  C.withdraw(); await w.run(3000);
  r.ok(endsOf(C, 'forfeit').length === 0, 'لا "خسارة انسحاب"');
  const x = endsOf(C, 'elim');
  r.ok(x.length === 1 && x[0].reason === 'time' && x[0].myRank === 3, `خروجه مسجّل مرة بسبب الوقت (${JSON.stringify(x.map(e => e.reason + ':' + e.myRank))})`);
  r.ok(x.length === 1 && x[0].silent === true, 'وبصمت: سُجّل لحظة المغادرة (لا إشعارات فوق القائمة — مراجعة v35.7 الثانية)');
  r.ok(seat(w, code, C).outReason === 'time', `الغرفة: "نفد وقته" (${seat(w, code, C).outReason})`);
  noErr(r, w); w.dispose(); return r;
}

// ── 30) انقطاع لم يلاحظه أحد (الخادم لم يكتشفه): العائد لا يُخرج نفسه ──
export async function multiNoSelfExpiry(verbose = false) {
  const r = suite('الجماعي: انقطاع 12ث لم يلاحظه الخادم → العائد يكمل، لا يُخرج جهازه نفسه'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const { A, B, C, code, ok } = await codeMatch3(w);
  r.ok(ok, 'بدأت المباراة للثلاثة');
  C.drop({ offlineMs: 12000, serverDetectMs: 60000 });   // كنمط الطيران: الخادم لا يلاحظ خلال الغياب
  await w.run(16000);
  r.ok(seat(w, code, C).active !== false, 'كريم ما زال في المباراة');
  r.ok(!/انقطع كريم/.test(A.toasts() + B.toasts()), 'لا "انقطع كريم" عند الباقين');
  r.ok(endsOf(C, 'elim').length === 0 && C.mods.og.isOutOfMatch() === false, 'لا خروج مسجّل عند كريم');
  noErr(r, w); w.dispose(); return r;
}

// ═════════ مراجعة v35.7 الثانية ═════════

// ── 31) المنشئ (المقعد 1) ينقطع أثناء المباراة: يُخرَج بعد المهلة كغيره ──
// كان يسلّح ختم انقطاعه ثم يلغي أوامر الغرفة كلها (والإلغاء يشمل ما تحت المسار) فيُمسح الختم:
// لا يُخرَج بانقطاعه أبداً، والباقون ينتظرون بنكه كاملاً.
export async function multiCreatorDrops(verbose = false) {
  const r = suite('الجماعي: المنشئ ينقطع ولا يعود → يُخرَج بعد المهلة كغيره (ختمه لا يُمسح)'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const { A, B, C, code, ok } = await codeMatch3(w);
  r.ok(ok, 'بدأت المباراة للثلاثة');
  r.ok(A.onDisc.some(o => o.path.endsWith(`${A.uid}/disconnectedAt`) && o.op === 'set'), 'المنشئ: أمر ختم الانقطاع مسلّح بعد البدء');
  setScores([A, B, C], { 1: 3, 2: 1, 3: 1 });
  A.drop({ offlineMs: 16000, serverDetectMs: 1500 });
  await w.run(14000);
  const s = seat(w, code, A);
  r.ok(s.active === false && s.outReason === 'dropped', `المقعد 1: خارج بسبب "انقطع" بعد المهلة (${JSON.stringify({ active: s.active, why: s.outReason ?? null })})`);
  r.ok(/انقطع أحمد ولم يعد/.test(B.toasts()), 'الباقون يرون "انقطع أحمد ولم يعد"');
  await w.run(4000);   // عاد أحمد
  const e = endsOf(A, 'elim');
  r.ok(e.length === 1 && e[0].reason === 'dropped' && e[0].myRank === 3, `عند عودته: خروجه مسجّل بالمركز 3 رغم تقدّمه (${JSON.stringify(e[0] ? { why: e[0].reason, rank: e[0].myRank } : null)})`);
  r.ok(cardOf(A).length === 1, 'وبطاقة "خرجت من المباراة"');
  noErr(r, w); w.dispose(); return r;
}

// ── 32) الانسحاب بالزر يُسجَّل بصمت ومرة واحدة، أياً كان المسار الذي سجّله ──
// صدى الخادم لخروجي يصل قبل تأكيد المعاملة: كان مستمع القائمة يسجّله كـ"خروج" عادي (خبرة وإنجازات
// تقفز فوق القائمة) بدل الانسحاب الصامت. والمركز من لحظة الخروج الحقيقية عند الخادم.
export async function multiWithdrawSilent(verbose = false) {
  const r = suite('الجماعي: الانسحاب بالزر يُسجَّل بصمت كانسحاب (لا "خروج" بإشعارات)، وأمر الانقطاع يُلغى بعده'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const { A, B, C, code, ok } = await codeMatch3(w);
  r.ok(ok, 'بدأت المباراة للثلاثة');
  setScores([A, B, C], { 1: 1, 2: 4, 3: 2 });
  B.withdraw(); await w.run(3000);
  const s = seat(w, code, B);
  r.ok(s.active === false && s.outReason === 'left' && typeof s.outAt === 'number', `المقعد: "انسحب" مع لحظة الخروج (${s.outReason ?? null})`);
  const elims = endsOf(B, 'elim'), fs = endsOf(B, 'forfeit');
  r.ok(elims.length === 0, `لا تسجيل "خروج" بإشعارات للمنسحب (${JSON.stringify(elims.map(x => x.reason))})`);
  r.ok(fs.length >= 1 && fs.every(f => f.myRank === 3), `خسارة انسحاب صامتة بالمركز 3 رغم تقدّمه (${JSON.stringify(fs.map(f => f.myRank))})`);
  r.ok(!B.onDisc.some(o => o.path.includes(`/players/${B.uid}`)), 'لا أمر انقطاع باقٍ على مقعده بعد اعتماد انسحابه');
  r.ok(/باسل انسحب/.test(A.toasts()) && endsOf(A, 'end').length === 0, 'أحمد يرى "باسل انسحب" والمباراة مستمرة');
  noErr(r, w); w.dispose(); return r;
}
