// سيناريوهات المحاكي: تأكيدات موجّهة + مستكشف عشوائي بثوابت
// كل دالة ترجع { pass, fail, notes[] } — لا تطبع إلا عند verbose
import { World, clock } from './harness.mjs';

const waitFor = async (w, cond, ms = 40000) => { for (let t = 0; t < ms && !cond(); t += 100) await w.run(100); return cond(); };
const names = c => (c.el('approval-players').innerHTML.match(/<span>([^<]+)<\/span>/g) || []).map(x => x.replace(/<\/?span>/g, ''));
const num = c => Number((c.el('search-countdown').textContent.match(/\d+/) || [])[0]);

function suite(title) {
  const r = { title, pass: 0, fail: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push('❌ ' + msg); } if (r.verbose) console.log((cond ? '  ✅ ' : '  ❌ ') + msg); };
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
export async function fuzzOne(seed, verbose = false) {
  const R = rng(seed);
  const w = new World(); w.quiet = !verbose; w.startSampler(100);
  const P = [await w.client('أحمد'), await w.client('باسل'), await w.client('كريم')];
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
