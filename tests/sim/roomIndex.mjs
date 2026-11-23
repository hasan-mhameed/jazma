// 3.3ج-5ب: الغرف لا تُقرأ كلها — فهرس الغرف المفتوحة وأعمار الغرف، بالكود الحقيقي (firebase.js + onlineGame.js) فوق القواعد
// كل دالة ترجع { pass, fail, notes[] }
import { World, clock } from './harness.mjs';

const waitFor = async (w, cond, ms = 40000) => { for (let t = 0; t < ms && !cond(); t += 100) await w.run(100); return cond(); };
function suite(title) {
  const r = { title, pass: 0, fail: 0, known: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push('❌ ' + msg); } if (r.verbose) console.log((cond ? '  ✅ ' : '  ❌ ') + msg); };
  return r;
}
const noErr = (r, w) => r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
const noDenied = (r, w) => r.ok(w.server.denied.length === 0, 'لا رفض من القواعد'
  + (w.server.denied[0] ? `: ${w.server.denied.length}× أولها ${w.server.denied[0].op} ${w.server.denied[0].path}` : ''));
// كل المدخلات تحت openRooms: [{ kind, rows, code, v }]
const entries = w => {
  const out = []; const o = w.server.getAt('openRooms') || {};
  for (const [kind, byRows] of Object.entries(o)) for (const [rows, byCode] of Object.entries(byRows || {}))
    for (const [code, v] of Object.entries(byCode || {})) out.push({ kind, rows, code, v });
  return out;
};
const age = (w, code) => w.server.getAt('roomAge/' + code);
// لا قراءة لشجرة الغرف كلها ولا لجذر الفهرس، وكل قراءة للفهرس أو الأعمار باستعلام
const noWholeReads = (r, w) => {
  const reads = w.server.reads || [];
  const bad = reads.filter(x => x.path === 'rooms' || x.path === '' || x.path === 'openRooms' || x.path === 'roomAge' && !x.q
    || (String(x.path).startsWith('openRooms/') && !x.q));
  r.ok(bad.length === 0, 'لا قراءة لشجرة الغرف أو الفهرس كاملين' + (bad[0] ? `: ${bad[0].who} ${bad[0].path}` : ''));
  return reads;
};

// ── 1) البحث الثنائي: المدخل مع الغرفة، ويُمحى عند الانضمام ──
export async function duoIndexLifecycle(verbose = false) {
  const r = suite('3.3ج-5ب: البحث الثنائي من الفهرس — المنتظر يُفهرَس مع غرفته وعمرها، ويُمحى مدخله لحظة الانضمام'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await A.startSearch(2); await w.run(1500);
  const es = entries(w);
  const code = A.om.roomCode;
  r.ok(es.length === 1 && es[0].kind === 'd' && es[0].code === code, `مدخل واحد للمنتظر في الفهرس (${es.map(e => e.kind + '/' + e.rows + '/' + e.code)})`);
  r.ok(es[0]?.v?.u === A.uid && typeof es[0]?.v?.t === 'number', 'المدخل باسم منشئه ووقت الخادم');
  r.ok(typeof age(w, code) === 'number' && age(w, code) === w.server.getAt(`rooms/${code}/createdAt`), 'عمر الغرفة = وقت إنشائها');
  await B.startSearch(2);
  r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), 'وجده الباحث الثاني من الفهرس وبدأت المباراة');
  await w.run(1000);
  r.ok(entries(w).length === 0, 'المدخل مُحي بعد الانضمام (لا غرفة جارية في الفهرس)');
  const reads = noWholeReads(r, w);
  r.ok(reads.some(x => String(x.path).startsWith('openRooms/d/') && x.q), 'البحث قرأ الفهرس باستعلام');
  noDenied(r, w); noErr(r, w);
  w.dispose(); return r;
}

// ── 1ب) المحو من الطرفين: المنضمّ يمحوه ولو كان المنتظر بلا اتصال، والمنتظر يمحوه ولو دخل خصمه بالرمز ──
export async function duoIndexBothSidesDrop(verbose = false) {
  const r = suite('3.3ج-5ب: محو المدخل من الطرفين — المنضمّ يمحوه والمنتظر منقطع، والمنتظر يمحوه حين يدخل خصمه بالرمز'); r.verbose = verbose;
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(1500);
    const code = A.om.roomCode;
    A.closeTab(7000);                                             // صفحة المنتظر أُغلقت والخادم لم يلاحظ بعد (لا كتابة منها)
    await w.run(200);
    await B.startSearch(2); await w.run(1500);
    r.ok(B.om.playerNum === 2 && B.om.roomCode === code, '(أ) الثاني دخل غرفة المنتظر قبل أن يلاحظ الخادم إغلاقها');
    r.ok(entries(w).length === 0, '(أ) المنضمّ محا المدخل (صفحة المنتظر لا تستطيع)');
    noErr(r, w); w.dispose();
  }
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(1500);
    B.joinCode(A.om.roomCode);
    r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), '(ب) دخلها الخصم برمزها وبدأت المباراة');
    await w.run(800);
    r.ok(entries(w).length === 0, '(ب) المنتظر محا مدخله لحظة البدء');
    noDenied(r, w); noErr(r, w); w.dispose();
  }
  return r;
}

// ── 1ج) الحساب نفسه في صفحتين: الباحث لا يجرّب دخول غرفته هو (مدخل باسمه) ──
export async function ownEntrySkipped(verbose = false) {
  const r = suite('3.3ج-5ب: الحساب نفسه في صفحتين — الصفحة الثانية لا تحاول دخول غرفة الأولى من الفهرس'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A1 = await w.client('أحمد'), A2 = await w.client('أحمد٢', { uid: 'uid_أحمد' });
  await A1.startSearch(2); await w.run(1500);
  const code = A1.om.roomCode;
  const tx = []; const orig = w.server.transaction.bind(w.server);
  w.server.transaction = (client, path, fn) => { tx.push({ who: client.name, path }); return orig(client, path, fn); };
  await A2.startSearch(2); await w.run(2000);
  r.ok(!tx.some(t => t.who === 'أحمد٢' && t.path === 'rooms/' + code), 'لم تُجرَّب معاملة دخول على غرفة الحساب نفسه');
  r.ok(A2.om.roomCode && A2.om.roomCode !== code && A2.om.playerNum === 1, 'وأنشأت الثانية غرفتها');
  noErr(r, w);
  w.dispose(); return r;
}

// ── 2) الإلغاء والإغلاق: لا مدخل يدلّ على غرفة لم تعد تنتظر ──
export async function duoIndexCancelClose(verbose = false) {
  const r = suite('3.3ج-5ب: إلغاء البحث أو إغلاق الصفحة يمحو المدخل مع الغرفة'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد');
  await A.startSearch(2); await w.run(1500);
  r.ok(entries(w).length === 1, 'مدخل للمنتظر');
  A.cancelSearch(); await w.run(1500);
  r.ok(entries(w).length === 0 && !Object.keys(w.server.getAt('rooms') || {}).length, 'الإلغاء: لا مدخل ولا غرفة');
  await A.startSearch(2); await w.run(1500);
  r.ok(entries(w).length === 1, 'بحث ثانٍ: مدخل جديد');
  A.closeTab(); await w.run(1500);
  r.ok(entries(w).length === 0 && !Object.keys(w.server.getAt('rooms') || {}).length, 'إغلاق الصفحة: أمر الانقطاع محا المدخل والغرفة');
  noDenied(r, w); noErr(r, w);
  w.dispose(); return r;
}

// ── 2ب) غرفة المنتظر اختفت بانقطاع لحظي فأعادها: عمرها الجديد ومدخلها يعودان معها ──
export async function restoreReindexes(verbose = false) {
  const r = suite('3.3ج-5ب: المنتظر يعيد غرفته بعد انقطاع لحظي — يعود مدخلها في الفهرس وعمرها بوقت إعادتها'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد');
  await A.startSearch(2); await w.run(1500);
  const code = A.om.roomCode, c0 = w.server.getAt(`rooms/${code}/createdAt`);
  await w.run(1000);
  A.blip(150);
  let gone = false;
  for (let i = 0; i < 60 && !(gone && w.server.getAt(`rooms/${code}/status`) === 'waiting'); i++) { await w.run(100); if (!w.server.getAt('rooms/' + code)) gone = true; }
  await w.run(1500);
  const rm = w.server.getAt('rooms/' + code) || {};
  r.ok(gone && rm.status === 'waiting' && rm.createdAt > c0, `اختفت ثم أُعيدت (${rm.status})`);
  r.ok(entries(w).some(e => e.code === code && e.v.u === A.uid), 'مدخلها عاد إلى الفهرس');
  r.ok(age(w, code) >= rm.createdAt, `عمرها بوقت إعادتها (${age(w, code) - c0}ms بعد الأول)`);
  noDenied(r, w); noErr(r, w);
  w.dispose(); return r;
}

// ── 3) مدخلات قديمة: من يصادفها يمحوها ويكمل ──
export async function staleEntries(verbose = false) {
  const r = suite('3.3ج-5ب: مدخل غرفته اختفت أو بدأت — الباحث يمحوه ويكمل (ينشئ غرفته)'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const B = await w.client('باسل');
  // مدخل بلا غرفة، ومدخل غرفته جارية (لغيري)، أقدم من أي منتظر
  w.server.setAt('openRooms/d/4/222222', { t: clock.now - 5000, u: 'uid_شبح' });
  w.server.setAt('rooms/333333', { cfg: { rows: 4, cols: 4 }, status: 'playing', p1name: 'س', p1uid: 'uid_س', p2name: 'ص', p2uid: 'uid_ص',
    createdAt: clock.now - 4000, move: { key: '', by: 0, seq: 0 } });
  w.server.setAt('openRooms/d/4/333333', { t: clock.now - 4000, u: 'uid_س' });
  // ومدخل تحت الحجم 4 لغرفة تنتظر بحجم 5 (لا يطابق — من بيانات أقدم من القواعد)
  w.server.setAt('rooms/343434', { cfg: { rows: 5, cols: 5 }, status: 'waiting', public: true, p1name: 'ش', p1uid: 'uid_ش', p2name: '', p2uid: '',
    createdAt: clock.now - 3000, move: { key: '', by: 0, seq: 0 } });
  w.server.setAt('openRooms/d/4/343434', { t: clock.now - 3000, u: 'uid_ش' });
  // وغرفة "تنتظر" عامة بعلامة نهاية (leftBy) — قاعدة الانضمام ترفضها (مراجعة R1)
  w.server.setAt('rooms/353535', { cfg: { rows: 4, cols: 4 }, status: 'waiting', public: true, p1name: 'ط', p1uid: 'uid_ط', p2name: '', p2uid: '', leftBy: 1,
    createdAt: clock.now - 2500, move: { key: '', by: 0, seq: 0 } });
  w.server.setAt('openRooms/d/4/353535', { t: clock.now - 2500, u: 'uid_ط' });
  // وغرفة محا صاحبها خانة الخصم (p2uid): تبدو للصفحة "تنتظر" وترفض القواعد الانضمام إليها مرتين — مدخلها يُمحى (مراجعة R2)
  w.server.setAt('rooms/363636', { cfg: { rows: 4, cols: 4 }, status: 'waiting', public: true, p1name: 'ظ', p1uid: 'uid_ظ', p2name: '',
    createdAt: clock.now - 2400, move: { key: '', by: 0, seq: 0 } });
  w.server.setAt('openRooms/d/4/363636', { t: clock.now - 2400, u: 'uid_ظ' });
  await B.startSearch(2); await w.run(2500);
  const es = entries(w);
  r.ok(!es.some(e => e.code === '222222' || e.code === '333333' || e.code === '343434' || e.code === '353535' || e.code === '363636'), `المدخلات القديمة والتي لا تطابق حجمها مُحيت (${es.map(e => e.code)})`);
  r.ok(w.server.getAt('rooms/343434/status') === 'waiting', 'وغرفة الحجم الآخر لم تُمسّ');
  r.ok(B.om.roomCode && B.om.playerNum === 1 && es.some(e => e.code === B.om.roomCode && e.v.u === B.uid), 'أنشأ غرفته ومدخلها (لم يعلق)');
  r.ok(w.server.getAt('rooms/333333/status') === 'playing', 'الغرفة الجارية لم تُمسّ');
  const other = w.server.denied.filter(d => d.path !== 'rooms/363636');
  r.ok(other.length === 0, 'لا رفض من القواعد إلا محاولتي الانضمام إلى الغرفة بلا خانة خصم' + (other[0] ? `: ${other[0].op} ${other[0].path}` : ''));
  noErr(r, w);
  w.dispose(); return r;
}

// ── 4) البحث الجماعي: الفهرس، البدء يمحو المدخل، واللوبي المهجور يُمسح ──
export async function multiIndex(verbose = false) {
  const r = suite('3.3ج-5ب: البحث الجماعي من الفهرس — البدء يمحو المدخل، واللوبي المهجور يُمسح هو وعمره ومدخله'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  // لوبي مهجور (آخر من فيه انقطع) أقدم من أي غرفة
  w.server.setAt('rooms/555555', { cfg: { rows: 4, cols: 4 }, status: 'lobby', multi: true, public: true, maxPlayers: 3, hostUid: 'uid_ك',
    playerCount: 1, turn: 1, move: { key: '', by: 0, seq: 0 }, createdAt: clock.now - 9000 });
  w.server.setAt('roomAge/555555', clock.now - 9000);
  w.server.setAt('openRooms/m3/4/555555', { t: clock.now - 9000, u: 'uid_ك' });
  // ومدخل جماعي غرفته اختفت (بلا غرفة)
  w.server.setAt('openRooms/m3/4/565656', { t: clock.now - 8000, u: 'uid_ك' });
  // ولوبي لأربعة مفهرس تحت نوع الثلاثة (لا يطابق)
  w.server.setAt('rooms/575757', { cfg: { rows: 4, cols: 4 }, status: 'lobby', multi: true, public: true, maxPlayers: 4, hostUid: 'uid_ل',
    players: { 'uid_ل': { name: 'ل', num: 1, active: true } }, playerCount: 1, turn: 1, move: { key: '', by: 0, seq: 0 }, createdAt: clock.now - 7000 });
  w.server.setAt('openRooms/m3/4/575757', { t: clock.now - 7000, u: 'uid_ل' });
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  await A.startSearch(3); await w.run(1500);
  r.ok(w.server.getAt('rooms/555555') === null && age(w, '555555') === null && !entries(w).some(e => e.code === '555555'),
    'اللوبي المهجور مُسح مع عمره ومدخله');
  r.ok(!entries(w).some(e => e.code === '565656' || e.code === '575757'), 'المدخل الجماعي الذي اختفت غرفته أو لا يطابق عدده مُحي');
  const code = A.om.roomCode;
  r.ok(entries(w).some(e => e.kind === 'm3' && e.code === code && e.v.u === A.uid), 'أنشأ غرفة عامة ومدخلها (m3)');
  r.ok(typeof age(w, code) === 'number', 'وعمرها');
  await B.startSearch(3); await w.run(1200); await C.startSearch(3);
  r.ok(await waitFor(w, () => A.matches.length && B.matches.length && C.matches.length, 30000), 'الثلاثة وجدوا الغرفة نفسها وبدأت المباراة');
  r.ok(new Set([A, B, C].map(c => c.matches[0]?.room)).size === 1, 'غرفة واحدة');
  await w.run(1000);
  r.ok(entries(w).length === 0, 'البدء محا المدخل');
  noWholeReads(r, w); noDenied(r, w); noErr(r, w);
  w.dispose(); return r;
}

// ── 4ب) (مراجعة ج-5ب H1/L1) لوبيات ممتلئة بلاعبين وهميين تملأ أول الفهرس: الباحث يرى الصفحات التالية،
//      والمدخلات الأقدم من ساعة يتخطّاها ويمحوها ──
export async function poisonedBucket(verbose = false) {
  const r = suite('3.3ج-5ب: أول الفهرس ملأته لوبيات لا تُدخل — الصفحات التالية تُرى، والأقدم من ساعة يُمحى'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const full = (i) => ({ cfg: { rows: 4, cols: 4 }, status: 'lobby', multi: true, public: true, maxPlayers: 3, hostUid: 'uid_س' + i,
    players: { ['uid_س' + i]: { name: 'س', num: 1, active: true }, ['uid_ص' + i]: { name: 'ص', num: 2, active: true }, ['uid_ع' + i]: { name: 'ع', num: 3, active: true } },
    playerCount: 3, turn: 1, move: { key: '', by: 0, seq: 0 }, createdAt: clock.now - 5000 });
  for (let i = 0; i < 3; i++) {          // أقدم من ساعة
    const c = String(610000 + i); w.server.setAt('rooms/' + c, full(i)); w.server.setAt(`openRooms/m3/4/${c}`, { t: clock.now - 2 * 3600 * 1000 + i, u: 'uid_س' + i });
  }
  for (let i = 3; i < 15; i++) {         // حديثة، كلها بالوقت نفسه (كتبها في كتابة واحدة — مراجعة R3: المؤشر بالوقت وحده كان يتوقف)
    const c = String(610000 + i); w.server.setAt('rooms/' + c, full(i)); w.server.setAt(`openRooms/m3/4/${c}`, { t: clock.now - 5000, u: 'uid_س' + i });
  }
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await A.startSearch(3); await w.run(2500);
  r.ok(['610000', '610001', '610002'].every(c => !entries(w).some(e => e.code === c)), 'المدخلات الأقدم من ساعة مُحيت');
  const code = A.om.roomCode;
  r.ok(code && A.om.playerNum === 1 && entries(w).some(e => e.code === code), 'الأول أنشأ لوبيه (لا لوبي يُدخل)');
  await B.startSearch(3); await w.run(2500);
  r.ok(B.om.roomCode === code, `الثاني وجد لوبي الأول بعد الصفحة الأولى (${B.om.roomCode} / ${code})`);
  noDenied(r, w); noErr(r, w);
  w.dispose(); return r;
}

// ── 5) التنظيف من الأعمار: القديم يُمسح مع عمره، والحديث لا يُمسّ ──
export async function cleanupByAge(verbose = false) {
  const r = suite('3.3ج-5ب: التنظيف من أعمار الغرف — ما تجاوز الساعة يُمسح مع عمره، والحديث لا يُمسّ ولا يُكشف'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  A.createDuoRoom(); await w.run(1200);
  const fresh = A.duoCodeShown();
  r.ok(/^\d{6}$/.test(fresh) && typeof age(w, fresh) === 'number', `غرفة خاصة حديثة بعمرها (${fresh})`);
  const old = clock.now - 2 * 3600 * 1000;
  w.server.setAt('rooms/777777', { cfg: { rows: 4, cols: 4 }, status: 'playing', p1name: 'س', p1uid: 'uid_س', p2name: 'ص', p2uid: 'uid_ص',
    createdAt: old, move: { key: '', by: 0, seq: 0 } });
  w.server.setAt('roomAge/777777', old);
  w.server.setAt('roomAge/888888', old);   // عمر بلا غرفة (مُسحت بأمر انقطاع)
  // (مراجعة L2) أكثر من صفحة: 25 غرفة قديمة أخرى
  for (let i = 0; i < 25; i++) {
    const c = String(700100 + i);
    w.server.setAt('rooms/' + c, { cfg: { rows: 4, cols: 4 }, status: 'finished', p1name: 'س', p1uid: 'uid_س', p2name: 'ص', p2uid: 'uid_ص',
      createdAt: old + i, move: { key: '', by: 0, seq: 0 } });
    w.server.setAt('roomAge/' + c, old + i);
  }
  w.server.reads = [];
  B.safe(() => B.mods.fb.cleanupOldRooms()); await w.run(1500);   // لا ننتظره: يكمل مع تقدّم الساعة
  r.ok(w.server.getAt('rooms/777777') === null && age(w, '777777') === null, 'الغرفة القديمة وعمرها مُسحا معاً');
  r.ok(age(w, '888888') === null, 'العمر بلا غرفة مُسح');
  r.ok(Array.from({ length: 25 }, (_, i) => String(700100 + i)).every(c => w.server.getAt('rooms/' + c) === null && age(w, c) === null),
    'وأكثر من صفحة (27 غرفة قديمة) مُسحت في تشغيل واحد');
  r.ok(w.server.getAt('rooms/' + fresh) !== null && typeof age(w, fresh) === 'number', 'الغرفة الحديثة وعمرها باقيان');
  const q = (w.server.reads || []).find(x => x.path === 'roomAge');
  r.ok(!!q && q.q && q.q.some(c => c.type === 'endAt'), 'قراءة الأعمار باستعلام محدود بما تجاوز الساعة');
  noWholeReads(r, w); noDenied(r, w); noErr(r, w);
  w.dispose(); return r;
}
