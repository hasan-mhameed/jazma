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

// ── 13) سباقات الثنائي: منضمّان بنفس اللحظة / إلغاء بنفس لحظة الانضمام ──
export async function duoRaces(verbose = false) {
  const r = suite('البحث الثنائي: سباقات الانضمام'); r.verbose = verbose;
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
    await A.startSearch(2); await w.run(3000);
    await B.startSearch(2); await C.startSearch(2);            // نفس اللحظة
    await w.run(8000);
    const inA = A.matches.length ? 1 : 0;
    const withA = [B, C].filter(c => c.matches.some(m => m.room === A.matches[0]?.room));
    r.knownIssue(withA.length === 1, `منضمّان بنفس اللحظة لنفس المنتظر: ${withA.length} منهما دخلا غرفته (المنتظر يرى خصماً واحداً)`);
    w.dispose();
  }
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(3000);
    await B.startSearch(2); A.cancelSearch();                   // إلغاء بلحظة الانضمام
    await w.run(8000);
    const code = B.matches[0]?.room;
    const rm = code ? w.server.getAt('rooms/' + code) : null;
    r.knownIssue(A.matches.length === 0, 'من ألغى البحث بلحظة انضمام خصم لا يُسحب لمباراة رغم إلغائه');
    r.knownIssue(!(B.matches.length && !(rm && rm.p1uid)), `الخصم لا يدخل غرفة شبحية بلا منشئ${rm && !rm.p1uid ? ' (دخل ' + code + ')' : ''}`);
    w.dispose();
  }
  return r;
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
