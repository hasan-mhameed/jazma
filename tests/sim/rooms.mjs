// سيناريوهات تحضير قفل الغرف (3.3ب-1): الكود الحقيقي (firebase.js + onlineGame.js) فوق قواعد الأمان
// كل دالة ترجع { pass, fail, notes[] } — لا تطبع إلا عند verbose
import vm from 'node:vm';
import { World, clock, RULES } from './harness.mjs';
import { memberOnlyRooms } from '../shared/roomsOverlay.mjs';

const waitFor = async (w, cond, ms = 40000) => { for (let t = 0; t < ms && !cond(); t += 100) await w.run(100); return cond(); };
function suite(title) {
  const r = { title, pass: 0, fail: 0, known: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push('❌ ' + msg); } if (r.verbose) console.log((cond ? '  ✅ ' : '  ❌ ') + msg); };
  return r;
}
const noErr = (r, w) => r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
const crownOf = c => c.lobbyList().find(p => p.host)?.num;
const roomDenials = w => w.server.denied.filter(d => String(d.path).startsWith('rooms'));

// قواعد "اللاعبون وحدهم يكتبون في غرفتهم" (تقريب لما ستفرضه 3.3ب-2 — tests/shared/roomsOverlay.mjs)
const memberOnly = () => memberOnlyRooms(RULES);

// ── 1) المنشئ يغادر لوبي الغرفة بالكود: إزالته ونقل التاج بكتابة واحدة وهو ما زال لاعباً فيها ──
export async function lobbyLeaveUnderMemberRules(verbose = false) {
  const r = suite('3.3ب-1: المنشئ يغادر اللوبي الجماعي — إزالته والعدّاد والتاج بكتابة واحدة يقبلها "اللاعبون وحدهم يكتبون"'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  w.server.rules = memberOnly();
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  A.createCodeRoom(4); await w.run(400);
  const code = A.codeShown();
  r.ok(/^\d{6}$/.test(code), `أُنشئت الغرفة (${code})`);
  B.joinCode(code); await w.run(600); C.joinCode(code); await w.run(800);
  A.leaveCode(); await w.run(1500);
  const room = w.server.getAt('rooms/' + code) || {};
  r.ok(roomDenials(w).length === 0, `رُفضت كتابة على الغرفة: ${JSON.stringify(roomDenials(w).map(d => [d.who, d.op, d.path]))}`);
  r.ok(!(room.players || {})[A.uid] && Object.keys(room.players || {}).length === 2, `المغادر خرج من القائمة (${Object.keys(room.players || {})})`);
  r.ok(room.hostNum === 2 && room.playerCount === 2, `التاج والعدّاد على الخادم: hostNum=${room.hostNum} playerCount=${room.playerCount} (المطلوب 2 و2)`);
  r.ok(crownOf(B) === 2 && crownOf(C) === 2 && B.startBtnVisible() && !C.startBtnVisible(), `التاج لباسل عند الاثنين وزر البدء عنده وحده (${crownOf(B)}/${crownOf(C)})`);
  B.startCode();
  r.ok(await waitFor(w, () => B.matches.length && C.matches.length, 8000), 'الوريث بدأ المباراة');
  // آخر من في اللوبي يغادر: الغرفة تُحذف (حذف لوبي فارغ)
  const D = await w.client('داني'), E = await w.client('إياد');
  D.createCodeRoom(3); await w.run(400);
  const code2 = D.codeShown();
  E.joinCode(code2); await w.run(800);
  E.leaveCode(); await w.run(1500);
  const r2 = w.server.getAt('rooms/' + code2) || {};
  r.ok(Object.keys(r2.players || {}).length === 1 && r2.hostNum === 1 && r2.playerCount === 1, `منضمّ غادر: بقي المنشئ وحده (${JSON.stringify({ n: Object.keys(r2.players || {}).length, h: r2.hostNum, c: r2.playerCount })})`);
  D.leaveCode(); await w.run(1500);
  r.ok(w.server.getAt('rooms/' + code2) == null, 'آخر من في اللوبي غادر: الغرفة حُذفت');
  // آخر اثنين يغادران بنفس اللحظة (كلٌّ يرى الآخر في قائمته): لا تبقى عقدة لوبي فارغة
  const F = await w.client('فادي'), G = await w.client('غسان');
  F.createCodeRoom(3); await w.run(400);
  const code3 = F.codeShown();
  G.joinCode(code3); await w.run(800);
  F.leaveCode(); await w.run(10); G.leaveCode(); await w.run(2000);
  r.ok(w.server.getAt('rooms/' + code3) == null, `آخر اثنين غادرا معاً: الغرفة حُذفت (${JSON.stringify(w.server.getAt('rooms/' + code3))?.slice(0, 80)})`);
  r.ok(roomDenials(w).length === 0, `رفض على الغرف: ${JSON.stringify(roomDenials(w).map(d => [d.who, d.op, d.path]))}`);
  noErr(r, w);
  w.dispose(); return r;
}

// رقم الغرفة التالي عند لاعب = الرقم المطلوب (مرة واحدة)، ثم عشوائي كالعادة
function forceNextCode(c, code) {
  const r = (Number(code) - 100000 + 0.5) / 900000;
  vm.runInContext(`(() => { const orig = Math.random; let once = true;
    Math.random = () => { if (once) { once = false; return ${r}; } return orig(); }; })()`, c.ctx);
}
// غرفة قائمة لغيري برقم ستصادفه — وكتابة إنشائها فوقها مرفوضة (كما ستفعل قواعد 3.3ب-2 بغرفة ليست لي).
// الرفض للإنشاء (set) وحده عمداً: أمر "امسح الغرفة عند الانقطاع" المسلّح قبل الإنشاء يُقبل تسجيله — فإن لم يُلغِه
// الكود بعد الرفض، يمسح إغلاقُ الصفحة غرفةَ الغريب (يُفحص أدناه — مراجعة 3.3ب-1)
function foreignRoom(w, code, owner) {
  const room = { cfg: { rows: 4, cols: 4 }, status: 'playing', p1name: 'غريب', p1uid: owner, p2name: 'آخر', p2uid: 'uid_آخر',
    createdAt: clock.now, move: { key: 'h1', by: 1, seq: 1 } };
  w.server.setAt('rooms/' + code, room);
  w.server.denyIf = (client, writes, op) => op === 'set' && client.uid !== owner && writes.some(([p]) => p === 'rooms/' + code || String(p).startsWith('rooms/' + code + '/'));
  return JSON.stringify(room);
}

// ── 2) رقم غرفة صادف غرفة قائمة لغيري: لا كتابة فوقها، ورقم آخر، والمباراة تكمل ──
export async function roomCodeCollision(verbose = false) {
  const r = suite('3.3ب-1: رقم غرفة جديد صادف غرفة قائمة لغيري — لا يكتب فوقها ويجرّب رقماً آخر (ثنائي بالكود، عشوائي، جماعي)'); r.verbose = verbose;
  const TAKEN = '111111';
  // (أ) الغرفة الثنائية بالكود
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    const before = foreignRoom(w, TAKEN, 'uid_غريب');
    forceNextCode(A, TAKEN);
    A.createDuoRoom(); await w.run(800);
    const code = A.duoCodeShown();
    r.ok(/^\d{6}$/.test(code) && code !== TAKEN, `(أ) رقم آخر ظهر للمنشئ (${code})`);
    r.ok(JSON.stringify(w.server.getAt('rooms/' + TAKEN)) === before, '(أ) غرفة الغريب لم تُمسّ');
    r.ok(w.server.denied.some(d => d.injected && d.op === 'set'), '(أ) محاولة الكتابة فوقها رُفضت فعلاً (السيناريو اختبر شيئاً)');
    B.joinCode(code);
    r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), '(أ) باسل انضم بالرقم الظاهر وبدأت المباراة');
    r.ok(A.matches[0]?.room === code && B.matches[0]?.room === code, `(أ) في الغرفة الجديدة (${A.matches[0]?.room})`);
    A.closeTab(); await w.run(2000);
    r.ok(JSON.stringify(w.server.getAt('rooms/' + TAKEN)) === before, '(أ) إغلاق تبويب المنشئ لم يمسح غرفة الغريب (لا أمر انقطاع عليها)');
    noErr(r, w); w.dispose();
  }
  // (ب) البحث العشوائي الثنائي: لا غرفة تنتظر → ينشئ غرفة عامة
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    const before = foreignRoom(w, TAKEN, 'uid_غريب');
    forceNextCode(A, TAKEN);
    await A.startSearch(2); await w.run(1500);
    r.ok(A.om.roomCode && A.om.roomCode !== TAKEN && w.server.getAt('rooms/' + A.om.roomCode)?.status === 'waiting', `(ب) غرفة عامة برقم آخر تنتظر (${A.om.roomCode})`);
    r.ok(JSON.stringify(w.server.getAt('rooms/' + TAKEN)) === before, '(ب) غرفة الغريب لم تُمسّ');
    await B.startSearch(2);
    r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), '(ب) باسل وجدها وبدأت المباراة');
    A.closeTab(); await w.run(2000);
    r.ok(JSON.stringify(w.server.getAt('rooms/' + TAKEN)) === before, '(ب) إغلاق تبويب المنشئ لم يمسح غرفة الغريب (أمر المسح على رقمها أُلغي)');
    noErr(r, w); w.dispose();
  }
  // (ج) الغرفة الجماعية بالكود
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    const before = foreignRoom(w, TAKEN, 'uid_غريب');
    forceNextCode(A, TAKEN);
    A.createCodeRoom(3); await w.run(800);
    const code = A.codeShown();
    r.ok(/^\d{6}$/.test(code) && code !== TAKEN, `(ج) رقم آخر ظهر للمنشئ (${code})`);
    r.ok(JSON.stringify(w.server.getAt('rooms/' + TAKEN)) === before, '(ج) غرفة الغريب لم تُمسّ');
    B.joinCode(code); await w.run(1000);
    r.ok(B.lobbyList().length === 2 && crownOf(B) === 1, `(ج) باسل في اللوبي مع المنشئ (${B.lobbyList().map(p => p.num + ':' + p.name)})`);
    noErr(r, w); w.dispose();
  }
  return r;
}
