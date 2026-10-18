// سيناريوهات دعوات الأصدقاء (الخطوة 1.8 — v35.9): inviteUI.js وinvite.js الحقيقيان فوق firebase.js الحقيقي
// كل دالة ترجع { pass, fail, notes[] } — لا تطبع إلا عند verbose
import { World, clock } from './harness.mjs';

const waitFor = async (w, cond, ms = 40000) => { for (let t = 0; t < ms && !cond(); t += 100) await w.run(100); return cond(); };
function suite(title) {
  const r = { title, pass: 0, fail: 0, known: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push('❌ ' + msg); } if (r.verbose) console.log((cond ? '  ✅ ' : '  ❌ ') + msg); };
  return r;
}
const noErr = (r, w) => r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
const onStep = (c, s) => !c.hidden('online-step-' + s);
const roomOf = (w, code) => (code ? w.server.getAt('rooms/' + code) : null);
const inviteSlot = (w, c) => w.server.getAt('invites/' + c.uid);
const replySlot = (w, c) => w.server.getAt('inviteRejections/' + c.uid);
const waitingRooms = w => Object.entries(w.rooms()).filter(([, rm]) => rm && rm.status === 'waiting');
const endsOf = (c, kind) => c.ends.filter(e => e.kind === kind);

// مباراة ثنائية عشوائية جارية بين لاعبين (للمشغول)
async function duoMatch(w, X, Y) {
  await X.startSearch(2); await w.run(1500); await Y.startSearch(2);
  await waitFor(w, () => X.matches.length && Y.matches.length, 8000);
  await w.run(5000);
}
// نهاية طبيعية للمباراة الثنائية: آخر حركة تكمل اللوحة عند الخصم، والمحرّك عند صاحبها يعلّمها منتهية
async function finishDuo(w, mover) {
  mover.safe(() => mover.om.pushMove('__final__', 999));
  mover.mods.state.gameFinished = true;
  await w.run(1500);
}
// دعوة حتى يظهر الإشعار عند صديقه
async function inviteShown(w, from, to) {
  from.invite(to);
  return await waitFor(w, () => !!to.invitePopup() && from.outgoing()?.phase === 'waiting', 6000);
}

// ── 1) القبول + دعوة ثانية بعد نهاية المباراة (فحص المستخدم 5 لـv35.8: الزر بقي ⏳) ──
export async function inviteAcceptAndAgain(verbose = false) {
  const r = suite('دعوة صديق: القبول يبدأ المباراة، والزر يرجع فوراً، ودعوة ثانية بعد نهايتها تعمل'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await w.run(500);
  A.invite(B);
  r.ok(A.outgoing()?.friendUid === B.uid, 'لحظة الضغط: زر الدعوة لباسل صار ⏳');
  await w.run(1500);
  const code = A.om.roomCode;
  r.ok(onStep(A, 'lobby') && /^بانتظار باسل\.\.\. ⏳ (59|60)$/.test(A.lobbyText()), `أحمد ينتظر بعدّ تنازلي: "${A.lobbyText()}"`);
  r.ok(B.invitePopup() === '🎮 أحمد يدعوك للعب!', `الإشعار عند باسل: "${B.invitePopup()}"`);
  await w.run(3000);
  r.ok(/^بانتظار باسل\.\.\. ⏳ 5[5-7]$/.test(A.lobbyText()), `العدّ ينقص: "${A.lobbyText()}"`);
  B.acceptInvite();
  r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), 'بدأت المباراة للاثنين');
  r.ok(A.matches[0]?.room === code && B.matches[0]?.room === code, 'في غرفة الدعوة نفسها');
  r.ok(A.outgoing() === null, 'زر الدعوة رجع "🎮 دعوة" مع بدء المباراة');
  r.ok(inviteSlot(w, B) == null && replySlot(w, A) == null, 'لا بقايا: الدعوة مُسحت من خانة باسل');
  r.ok(!B.invitePopup(), 'الإشعار اختفى عند باسل');
  await w.run(4000);
  await finishDuo(w, A);
  r.ok(A.mods.state.gameFinished && B.mods.state.gameFinished, 'انتهت المباراة طبيعياً عند الاثنين');
  A.exitToMenu(); await w.run(1500);
  r.ok(A.onlineUI.activity() === 'idle', 'أحمد خرج للقائمة');
  // باسل ما زال على شاشة النتيجة: الدعوة الثانية تُعرض، وقبولها يُخرجه منها بهدوء ثم يبدأ
  r.ok(B.onlineUI.activity() === 'done', 'باسل على شاشة النتيجة');
  r.ok(await inviteShown(w, A, B), 'الدعوة الثانية لنفس الصديق أُرسلت وظهرت عنده');
  B.acceptInvite();
  r.ok(await waitFor(w, () => A.matches.length === 2 && B.matches.length === 2, 10000), 'بدأت المباراة الثانية للاثنين');
  r.ok(A.matches[1]?.room && A.matches[1].room === B.matches[1]?.room && A.matches[1].room !== code, 'في غرفة جديدة');
  r.ok(endsOf(B, 'forfeit').length === 0 && endsOf(A, 'forfeit').length === 0, 'الخروج من نتيجة الأولى هادئ (لا خسارة لأحد)');
  r.ok(roomOf(w, code)?.leftBy == null, 'ولا "انسحب" في غرفة المباراة الأولى');
  noErr(r, w); w.dispose(); return r;
}

// ── 2) الرفض ──
export async function inviteReject(verbose = false) {
  const r = suite('دعوة صديق: الرفض يعيد صاحبها للقائمة برسالة، وتُحذف غرفتها، والزر يرجع'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await w.run(500);
  r.ok(await inviteShown(w, A, B), 'الدعوة ظهرت عند باسل');
  const code = A.om.roomCode;
  B.rejectInvite(); await w.run(1500);
  r.ok(A.inviteEnds.join() === 'rejected' && /😔 باسل رفض الدعوة/.test(A.toasts()), 'أحمد يرى "😔 باسل رفض الدعوة"');
  r.ok(roomOf(w, code) == null && A.om.roomCode == null, 'غرفة الدعوة حُذفت');
  r.ok(A.outgoing() === null && A.onlineUI.activity() === 'idle', 'الزر رجع وأحمد في القائمة');
  r.ok(replySlot(w, A) == null && inviteSlot(w, B) == null, 'لا بقايا: الرد والدعوة مُسحا');
  r.ok(!B.invitePopup() && B.matches.length === 0, 'الإشعار اختفى عند باسل ولا مباراة');
  noErr(r, w); w.dispose(); return r;
}

// ── 3) ردّ متأخر على دعوة قديمة (الخلل 1 من v12.2: كان يُخرج صاحبها من أي مباراة) ──
export async function inviteStaleReply(verbose = false) {
  const r = suite('دعوة صديق: ردّ متأخر على دعوة قديمة لا يمسّ مباراة لاحقة ولا دعوة لاحقة'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم'), D = await w.client('دانة');
  await w.run(500);
  r.ok(await inviteShown(w, A, B), 'دعوة أحمد لباسل ظهرت');
  const oldCode = A.om.roomCode;
  A.cancelDuoRoom(); await w.run(1500);
  r.ok(A.outgoing() === null && roomOf(w, oldCode) == null, 'أحمد ألغى دعوته: الغرفة حُذفت والزر رجع');
  r.ok(!B.invitePopup() && /📭 انتهت دعوة أحمد/.test(B.toasts()), 'الإشعار اختفى عند باسل مع "📭 انتهت دعوة أحمد"');
  r.ok(inviteSlot(w, B) == null, 'الدعوة سُحبت من خانة باسل');
  // (أ) أثناء دعوة جديدة لكريم يصل ردّ باسل المتأخر (برمز الغرفة القديمة، ثم بلا رمز كنسخة قديمة)
  r.ok(await inviteShown(w, A, C), 'دعوة جديدة لكريم ظهرت');
  const code2 = A.om.roomCode;
  w.server.setAt('inviteRejections/' + A.uid, { rejectedBy: B.uid, name: 'باسل', ts: clock.now, roomCode: oldCode, reason: 'rejected' });
  w.server.notify(); await w.run(1500);
  r.ok(A.outgoing()?.friendUid === C.uid && A.om.roomCode === code2 && C.invitePopup(), 'ردّ باسل (لغرفة قديمة) لم يُنهِ دعوة كريم');
  r.ok(replySlot(w, A) == null, 'والرد القديم مُسح بلا أثر');
  w.server.setAt('inviteRejections/' + A.uid, { rejectedBy: B.uid, name: 'باسل', ts: clock.now });
  w.server.notify(); await w.run(1500);
  r.ok(A.outgoing()?.friendUid === C.uid && C.invitePopup() && !/رفض/.test(A.toasts()), 'ولا ردّ باسل بلا رمز (نسخة قديمة) — ليس من المدعوّ');
  // (ب) نسخة قديمة عند المدعوّ نفسه: رفضه بلا رمز غرفة يُقبل
  w.server.setAt('inviteRejections/' + A.uid, { rejectedBy: C.uid, name: 'كريم', ts: clock.now });
  w.server.notify(); await w.run(1500);
  r.ok(A.inviteEnds.includes('rejected') && /😔 كريم رفض الدعوة/.test(A.toasts()) && A.om.roomCode == null, 'رفض كريم من نسخة قديمة (بلا رمز) يُفهم رفضاً');
  // (ج) ثم مباراة عشوائية لأحمد مع دانة، ويصل أثناءها ردّ متأخر على دعوته لكريم
  await duoMatch(w, A, D);
  r.ok(A.matches.length === 1 && D.matches.length === 1, 'أحمد في مباراة مع دانة');
  const mcode = A.om.roomCode;
  w.server.setAt('inviteRejections/' + A.uid, { rejectedBy: C.uid, name: 'كريم', ts: clock.now, roomCode: code2, reason: 'rejected' });
  w.server.notify(); await w.run(3000);
  w.server.setAt('inviteRejections/' + A.uid, { rejectedBy: C.uid, name: 'كريم', ts: clock.now });
  w.server.notify(); await w.run(3000);
  const rm = roomOf(w, mcode) || {};
  r.ok(A.om.roomCode === mcode && rm.status === 'playing' && rm.leftBy == null, `أحمد ما زال في مباراته (${rm.status}) — لم يُسحب منها`);
  r.ok(endsOf(D, 'end').length === 0 && endsOf(A, 'forfeit').length === 0, 'لا فوز مجاني لدانة ولا خسارة لأحمد');
  noErr(r, w); w.dispose(); return r;
}

// ── 4) دعوة أُلغيت / صفحة صاحبها أُغلقت / بقايا قديمة (الخلل 2 من v12.2: تبقى ويفشل قبولها بصمت) ──
export async function inviteCancelled(verbose = false) {
  const r = suite('دعوة صديق: دعوة انتهت لا تُعرض، وقبولها في لحظة إلغائها يعرض رسالة واضحة'); r.verbose = verbose;
  // (أ) إلغاء صاحبها وقبول الصديق بنفس اللحظة (قبل أن يرى السحب)
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await w.run(500);
    r.ok(await inviteShown(w, A, B), '(أ) الدعوة ظهرت عند باسل');
    const code = A.om.roomCode;
    A.cancelDuoRoom(); B.acceptInvite();
    await w.run(4000);
    r.ok(B.matches.length === 0 && A.matches.length === 0, '(أ) لا مباراة لأحد');
    r.ok(B.joinFails.length === 1 && /الدعوة لم تعد متاحة — ربما ألغاها أحمد/.test(B.toasts()),
      `(أ) باسل يرى رسالة واضحة: "${B.joinFails[0] || '—'}"`);
    r.ok(B.onlineUI.activity() === 'idle' && roomOf(w, code) == null && !waitingRooms(w).length, '(أ) باسل في القائمة ولا غرفة منتظرة باقية');
    r.ok(inviteSlot(w, B) == null && A.outgoing() === null, '(أ) لا بقايا دعوة، وزر أحمد رجع');
    noErr(r, w); w.dispose();
  }
  // (ب) صفحة صاحب الدعوة أُغلقت: الإشعار يختفي فوراً (غرفتها مُسحت)، والدعوة تُمسح بعد مهلة قصيرة
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await w.run(500);
    r.ok(await inviteShown(w, A, B), '(ب) الدعوة ظهرت عند باسل');
    A.closeTab(150); await w.run(1500);
    r.ok(!B.invitePopup(), '(ب) أُغلقت صفحة أحمد → الإشعار اختفى');
    await w.run(11000);
    r.ok(inviteSlot(w, B) == null && /📭 انتهت دعوة أحمد/.test(B.toasts()), '(ب) بعد المهلة: الدعوة مُسحت مع "📭 انتهت دعوة أحمد"');
    noErr(r, w); w.dispose();
  }
  // (ج) بقايا دعوة قديمة (غرفتها لم تعد موجودة) عند فتح اللعبة: لا تظهر أبداً وتُمسح
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    w.server.setAt('invites/uid_باسل', { fromUid: 'uid_قديم', fromName: 'قديم', roomCode: '123456', cfg: { rows: 4, cols: 4 }, sentAt: clock.now - 3600e3 });
    const B = await w.client('باسل');
    let seen = false;
    for (let t = 0; t < 12000; t += 100) { await w.run(100); if (B.invitePopup()) seen = true; }
    r.ok(!seen, '(ج) دعوة قديمة بلا غرفة لم تظهر إطلاقاً');
    r.ok(inviteSlot(w, B) == null, '(ج) ومُسحت من خانته');
    r.ok(!/انتهت دعوة/.test(B.toasts()), '(ج) بلا تنبيه (لم يرها أصلاً)');
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 5) المستلم في مباراة: لا مقاطعة، ردّ تلقائي فوري ──
export async function inviteBusy(verbose = false) {
  const r = suite('دعوة صديق: المدعوّ في مباراة → لا إشعار يقاطعه، وصاحب الدعوة يعرف فوراً'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  await duoMatch(w, B, C);
  const mcode = B.om.roomCode;
  r.ok(B.onlineUI.activity() === 'playing', 'باسل في مباراة جارية');
  let popped = false;
  A.invite(B);
  for (let t = 0; t < 4000; t += 100) { await w.run(100); if (B.invitePopup()) popped = true; }
  r.ok(!popped, 'لم يظهر إشعار الدعوة لباسل أثناء مباراته');
  r.ok(A.inviteEnds.join() === 'playing' && /🎮 باسل في مباراة الآن — جرّب بعد قليل/.test(A.toasts()), 'أحمد يرى "🎮 باسل في مباراة الآن — جرّب بعد قليل" خلال ثوانٍ');
  r.ok(A.om.roomCode == null && A.outgoing() === null && !waitingRooms(w).length, 'غرفة الدعوة حُذفت والزر رجع');
  r.ok(/📩 أحمد دعاك للعب — أخبرناه أنك في مباراة/.test(B.toasts()), 'باسل يرى تنبيهاً صغيراً "📩 أحمد دعاك للعب — أخبرناه أنك في مباراة"');
  const rm = roomOf(w, mcode) || {};
  r.ok(B.om.roomCode === mcode && rm.status === 'playing' && endsOf(B, 'end').length === 0 && endsOf(C, 'end').length === 0,
    'مباراة باسل وكريم لم تتأثر');
  r.ok(inviteSlot(w, B) == null && replySlot(w, A) == null, 'لا بقايا دعوة ولا رد');
  // أحمد نفسه في مباراة لا يستطيع الدعوة (الطريق إليها من المحادثة أثناء اللعب)
  const before = Object.keys(w.rooms()).length;
  B.invite(A);
  await w.run(1500);
  r.ok(/⚠️ لا يمكنك إرسال دعوة أثناء مباراة — أنهِها أولاً/.test(B.toasts()) && B.om.roomCode === mcode
    && Object.keys(w.rooms()).length === before && !A.invitePopup(), 'باسل أثناء مباراته: "⚠️ لا يمكنك إرسال دعوة أثناء مباراة" ولا غرفة جديدة');
  noErr(r, w); w.dispose(); return r;
}

// ── 6) قبول الدعوة من بحث أو غرفة تنتظر: يُلغى ما هو فيه بهدوء ثم ينضم ──
export async function inviteFromWaiting(verbose = false) {
  const r = suite('دعوة صديق: قبولها من بحث عشوائي أو غرفة بالكود أو لوبي جماعي → يُلغى بهدوء وتبدأ المباراة'); r.verbose = verbose;
  for (const where of ['بحث عشوائي', 'غرفة بالكود', 'لوبي جماعي']) {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
    if (where === 'بحث عشوائي') await B.startSearch(2);
    else if (where === 'غرفة بالكود') B.createDuoRoom();
    else B.createCodeRoom(3);
    await w.run(2000);
    const bcode = B.om.roomCode;
    r.ok(!!bcode && B.onlineUI.activity() === 'waiting', `(${where}) باسل ينتظر`);
    r.ok(await inviteShown(w, A, B), `(${where}) الدعوة ظهرت فوق شاشة انتظاره`);
    B.acceptInvite();
    r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 10000), `(${where}) بدأت مباراة أحمد وباسل`);
    r.ok(roomOf(w, bcode) == null, `(${where}) غرفة باسل السابقة حُذفت (لا غرفة شبحية)`);
    if (where === 'بحث عشوائي') {
      await C.startSearch(2); await w.run(4000);
      r.ok(C.matches.length === 0 && !waitingRooms(w).some(([k]) => k === bcode), `(${where}) باحث جديد لا يعلق في غرفة باسل القديمة`);
    }
    noErr(r, w); w.dispose();
  }
  // القبول في اللحظة نفسها التي بدأ فيها بحثاً (البحث يقرأ الغرف ولا غرفة له بعد): يُلغى البحث، لا غرفتان
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
    await w.run(500);
    r.ok(await inviteShown(w, A, B), '(بحث لحظة القبول) الدعوة ظهرت عند باسل');
    await B.startSearch(2);
    r.ok(B.om.roomCode == null && onStep(B, 'searching'), '(بحث لحظة القبول) البحث بدأ ولا غرفة له بعد');
    B.acceptInvite();
    r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 10000), '(بحث لحظة القبول) بدأت مباراة أحمد وباسل');
    await w.run(3000);
    r.ok(!waitingRooms(w).length && B.om.roomCode === A.om.roomCode, '(بحث لحظة القبول) لا غرفة منتظرة باقية لباسل');
    await C.startSearch(2); await w.run(4000);
    r.ok(C.matches.length === 0, '(بحث لحظة القبول) باحث جديد لا يدخل مباراة مع باسل');
    noErr(r, w); w.dispose();
  }
  // صاحب الدعوة نفسه كان يبحث: بحثه يُلغى ثم تُرسل الدعوة
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await A.startSearch(2); await w.run(2000);
    const acode = A.om.roomCode;
    r.ok(await inviteShown(w, A, B), '(صاحب الدعوة يبحث) بحثه أُلغي وأُرسلت الدعوة');
    r.ok(roomOf(w, acode) == null && onStep(A, 'lobby'), '(صاحب الدعوة يبحث) غرفة بحثه حُذفت وهو في شاشة انتظار الدعوة');
    B.acceptInvite();
    r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), '(صاحب الدعوة يبحث) بدأت المباراة');
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 7) انقطاع لحظي عند صاحب الدعوة: الإشعار يختفي ثم يعود مع عودة غرفته ──
export async function inviteInviterBlip(verbose = false) {
  const r = suite('دعوة صديق: انقطاع لحظي عند صاحبها → تعود غرفته وتعود الدعوة، والقبول يعمل'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await w.run(500);
  r.ok(await inviteShown(w, A, B), 'الدعوة ظهرت عند باسل');
  const code = A.om.roomCode;
  A.drop({ offlineMs: 4000, serverDetectMs: 500 });
  r.ok(await waitFor(w, () => roomOf(w, code) == null && !B.invitePopup(), 3000), 'الخادم مسح الغرفة → الإشعار اختفى عند باسل');
  r.ok(await waitFor(w, () => !!B.invitePopup(), 9000), 'عاد اتصال أحمد → عادت غرفته وعاد الإشعار');
  r.ok(A.outgoing()?.phase === 'waiting' && roomOf(w, code)?.status === 'waiting', 'أحمد ما زال ينتظر في غرفته نفسها');
  B.acceptInvite();
  r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), 'القبول بعد العودة يبدأ المباراة');
  r.ok(A.matches[0]?.room === code && B.matches[0]?.room === code, 'في غرفة الدعوة نفسها');
  noErr(r, w); w.dispose();
  // (ب) انقطاع أطول من مهلة الانتظار عند المستلم (14ث): تنتهي الدعوة عنده وتُمسح، ثم يعيد صاحبها إرسالها مع عودة غرفته
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await w.run(500);
    r.ok(await inviteShown(w, A, B), '(ب) الدعوة ظهرت عند باسل');
    const code = A.om.roomCode;
    A.drop({ offlineMs: 14000, serverDetectMs: 500 });
    await w.run(12500);
    r.ok(!B.invitePopup() && inviteSlot(w, B) == null && /📭 انتهت دعوة أحمد/.test(B.toasts()), '(ب) بعد مهلة الانتظار: انتهت الدعوة عند باسل ومُسحت');
    r.ok(await waitFor(w, () => !!B.invitePopup(), 8000), '(ب) عاد أحمد → أعاد إرسال دعوته فظهرت من جديد');
    r.ok(inviteSlot(w, B)?.roomCode === code, '(ب) الدعوة المُعادة لغرفته نفسها');
    B.acceptInvite();
    r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), '(ب) والقبول يبدأ المباراة');
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 8) انتهاء المهلة ──
export async function inviteExpires(verbose = false) {
  const r = suite('دعوة صديق: لم يردّ خلال 60 ثانية → تنتهي عند الاثنين برسالة، بلا بقايا'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل');
  await w.run(500);
  r.ok(await inviteShown(w, A, B), 'الدعوة ظهرت عند باسل');
  const code = A.om.roomCode;
  await w.run(30000);
  r.ok(/^بانتظار باسل\.\.\. ⏳ (2[7-9]|30)$/.test(A.lobbyText()) && B.invitePopup(), `بعد 30ث: "${A.lobbyText()}" والإشعار ما زال عند باسل`);
  await w.run(31000);
  r.ok(A.inviteEnds.join() === 'expired' && /⌛ لم يردّ باسل على الدعوة/.test(A.toasts()), 'أحمد يرى "⌛ لم يردّ باسل على الدعوة"');
  r.ok(A.om.roomCode == null && roomOf(w, code) == null && A.outgoing() === null, 'غرفة الدعوة حُذفت والزر رجع');
  r.ok(!B.invitePopup() && /📭 انتهت دعوة أحمد/.test(B.toasts()), 'الإشعار اختفى عند باسل مع "📭 انتهت دعوة أحمد"');
  r.ok(inviteSlot(w, B) == null && replySlot(w, A) == null, 'لا بقايا');
  noErr(r, w); w.dispose(); return r;
}

// ── 9) دعوة واحدة في كل مرة + الدعوة المتبادلة ──
export async function inviteOneAtATime(verbose = false) {
  const r = suite('دعوة صديق: دعوة واحدة قائمة في كل مرة، والدعوتان المتبادلتان تنتهيان بمباراة واحدة'); r.verbose = verbose;
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
    await w.run(500);
    r.ok(await inviteShown(w, A, B), 'دعوة أحمد لباسل قائمة');
    const code = A.om.roomCode;
    A.invite(C); await w.run(1500);
    r.ok(/⚠️ عندك دعوة قائمة لـباسل — ألغِها أولاً/.test(A.toasts()) && !C.invitePopup() && inviteSlot(w, C) == null,
      'دعوة كريم مرفوضة محلياً: "⚠️ عندك دعوة قائمة لـباسل — ألغِها أولاً"');
    r.ok(A.om.roomCode === code && A.outgoing()?.friendUid === B.uid && B.invitePopup(), 'ودعوة باسل باقية كما هي');
    noErr(r, w); w.dispose();
  }
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await w.run(500);
    A.invite(B); B.invite(A);
    r.ok(await waitFor(w, () => !!A.invitePopup() && !!B.invitePopup(), 6000), '(متبادلة) كلٌّ يرى دعوة الآخر وهو ينتظر');
    const bcode = B.om.roomCode, acode = A.om.roomCode;
    A.acceptInvite();
    r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 10000), '(متبادلة) أحمد قبل → مباراة واحدة');
    r.ok(A.matches[0]?.room === bcode && B.matches[0]?.room === bcode, '(متبادلة) في غرفة باسل');
    await w.run(2000);
    r.ok(roomOf(w, acode) == null && !B.invitePopup() && A.outgoing() === null && B.outgoing() === null,
      '(متبادلة) غرفة أحمد حُذفت، وإشعار دعوته اختفى عند باسل، والزران رجعا');
    r.ok(inviteSlot(w, A) == null && inviteSlot(w, B) == null, '(متبادلة) لا بقايا دعوات');
    noErr(r, w); w.dispose();
  }
  // دعوة صديق دعوتُه لك ظاهرة أمامك: تدخل دعوته (لا غرفة ثانية)
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await w.run(500);
    r.ok(await inviteShown(w, A, B), '(دعوته أمامك) دعوة أحمد ظاهرة عند باسل');
    const acode = A.om.roomCode, before = Object.keys(w.rooms()).length;
    B.invite(A);
    r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), '(دعوته أمامك) باسل ضغط "دعوة" لأحمد → دخل دعوة أحمد وبدأت المباراة');
    r.ok(A.matches[0]?.room === acode && Object.keys(w.rooms()).length === before && !A.invitePopup(), '(دعوته أمامك) في غرفة أحمد، بلا غرفة ثانية ولا إشعار عند أحمد');
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 10) مراجعة v35.9: تسجيل الخروج أثناء انتظار الدعوة، وقبول دعوة أثناء تجهيز دعوتي، وترك شاشة الانتظار لِلعبة أخرى ──
export async function inviteReviewFixes(verbose = false) {
  const r = suite('دعوة صديق: تسجيل الخروج أثناء الانتظار، قبول دعوة أثناء تجهيز دعوتي، وترك الانتظار للعبة أخرى'); r.verbose = verbose;
  // (أ) تسجيل الخروج أثناء الانتظار: الغرفة تُلغى والدعوة تُسحب (بالترتيب الصحيح، وبالترتيب الأسوأ)
  for (const late of [false, true]) {
    const tag = late ? '(أ2 المستخدم صار null أولاً)' : '(أ)';
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await w.run(500);
    r.ok(await inviteShown(w, A, B), `${tag} الدعوة ظهرت عند باسل`);
    const code = A.om.roomCode;
    A.signOut({ late }); await w.run(2500);
    r.ok(roomOf(w, code) == null, `${tag} تسجيل خروج أحمد ألغى غرفة الدعوة (${JSON.stringify(roomOf(w, code) || null)})`);
    r.ok(inviteSlot(w, B) == null && !B.invitePopup(), `${tag} وسُحبت الدعوة واختفى الإشعار عند باسل`);
    r.ok(A.outgoing() === null && !A.inviteEnds.length, `${tag} بلا رسالة عند أحمد`);
    noErr(r, w); w.dispose();
  }
  // (ب) باسل يدعو كريم ثم يقبل دعوة أحمد قبل أن تجهز دعوته: لا شاشة انتظار فوق المباراة، ولا دعوة معلّقة لكريم
  //     (30ms: أثناء إنشاء الغرفة؛ 90ms: بعد إنشائها وأثناء إرسال الدعوة)
  for (const at of [30, 90]) {
    const tag = `(ب ${at}ms)`;
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
    await w.run(500);
    r.ok(await inviteShown(w, A, B), `${tag} دعوة أحمد ظاهرة عند باسل`);
    B.invite(C); await w.run(at);
    B.acceptInvite();
    r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), `${tag} بدأت مباراة أحمد وباسل`);
    await w.run(3000);
    r.ok(!onStep(B, 'lobby') && onStep(B, 'playing'), `${tag} لا شاشة "بانتظار كريم" فوق المباراة (${B.visibleStep()})`);
    r.ok(B.outgoing() === null && inviteSlot(w, C) == null && !C.invitePopup(), `${tag} دعوة كريم أُلغيت بهدوء (لا إشعار عنده)`);
    r.ok(!waitingRooms(w).length && B.om.roomCode === A.matches[0]?.room, `${tag} لا غرفة منتظرة باقية، وباسل في غرفة أحمد`);
    noErr(r, w); w.dispose();
  }
  // (ج) ترك شاشة الانتظار إلى لعبة أخرى (تحدي اليوم من القائمة): تُلغى الدعوة بهدوء مع تنبيه
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await w.run(500);
    r.ok(await inviteShown(w, A, B), '(ج) الدعوة ظاهرة عند باسل');
    const code = A.om.roomCode;
    A.mods.state.gameFinished = false; A.el('board').classList.remove('hidden');   // لعبة محلية بدأت من القائمة
    await w.run(2000);
    r.ok(A.outgoing() === null && roomOf(w, code) == null && /📭 أُلغيت دعوتك لـباسل/.test(A.toasts()), '(ج) دعوة أحمد أُلغيت مع "📭 أُلغيت دعوتك لـباسل"');
    r.ok(!B.invitePopup() && inviteSlot(w, B) == null, '(ج) واختفت عند باسل');
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 11) مراجعة v35.9 الثانية: القبول في منتصف طلب انضمام أو إنشاء لم تظهر شاشته بعد → "لحظة"، لا غرفتان ──
export async function inviteDuringPendingOp(verbose = false) {
  const r = suite('دعوة صديق: القبول أثناء انضمام بالكود أو إنشاء غرفة جارٍ → "انتظر لحظة"، ثم القبول يعمل بلا غرفتين'); r.verbose = verbose;
  for (const op of ['انضمام بالكود', 'إنشاء غرفة ثنائية', 'إنشاء غرفة جماعية']) {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
    await w.run(500);
    let codeC = null;
    if (op === 'انضمام بالكود') { C.createDuoRoom(); await w.run(1000); codeC = C.om.roomCode; }
    r.ok(await inviteShown(w, A, B), `(${op}) دعوة أحمد ظاهرة عند باسل`);
    const codeA = A.om.roomCode;
    if (op === 'انضمام بالكود') B.joinCode(codeC);
    else if (op === 'إنشاء غرفة ثنائية') B.createDuoRoom();
    else B.createCodeRoom(3);
    await w.run(20);
    r.ok(B.onlineUI.activity() === 'busy', `(${op}) الطلب جارٍ: الحالة "busy" (${B.onlineUI.activity()})`);
    B.acceptInvite(); await w.run(200);
    r.ok(/⏳ انتظر لحظة ثم اضغط قبول/.test(B.toasts()) && !!B.invitePopup(), `(${op}) "⏳ انتظر لحظة ثم اضغط قبول" والدعوة باقية ظاهرة`);
    await w.run(3000);
    if (op === 'انضمام بالكود') {
      // انضمّ لكريم فعلاً: صار في مباراة → ردّ تلقائي لأحمد، ولا غرفتان
      await waitFor(w, () => B.matches.length > 0, 8000);   // المنضمّ ينتظر خريطة العناصر قليلاً قبل اللوحة
      r.ok(B.matches.length === 1 && B.matches[0].room === codeC && C.matches.length === 1, `(${op}) باسل في مباراة كريم وحدها`);
      r.ok(A.matches.length === 0 && A.inviteEnds.join() === 'playing' && roomOf(w, codeA) == null, `(${op}) أحمد عرف "في مباراة الآن" وغرفته حُذفت`);
    } else {
      r.ok(B.onlineUI.activity() === 'waiting' && !!B.invitePopup(), `(${op}) باسل في شاشة انتظار غرفته والدعوة ما زالت ظاهرة`);
      const bcode = B.om.roomCode;
      B.acceptInvite();
      r.ok(await waitFor(w, () => A.matches.length && B.matches.length, 8000), `(${op}) القبول الآن يبدأ مباراة أحمد وباسل`);
      await w.run(2000);
      r.ok(roomOf(w, bcode) == null && !waitingRooms(w).length && B.om.roomCode === codeA, `(${op}) غرفة باسل حُذفت، ولا غرفة منتظرة باقية`);
    }
    noErr(r, w); w.dispose();
  }
  // مراجعة v35.9 الثالثة: بحث عشوائي يبدأ أثناء إنشاء غرفة بالكود (نقرات سريعة على شبكة بطيئة) → يُرفض البحث،
  // وتبقى الغرفة بالكود سليمة بمستمعيها ويدخلها صديق بالكود
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const B = await w.client('باسل'), C = await w.client('كريم');
    await w.run(500);
    B.createDuoRoom(); await w.run(5);
    const codeB = B.om.roomCode;
    B.el('random-match-btn').click(); B.el('random-search-start').click();
    await w.run(3000);
    r.ok(onStep(B, 'lobby') && B.duoCodeShown() === codeB && B.om.roomCode === codeB && Object.keys(w.rooms()).length === 1,
      `(بحث أثناء الإنشاء) رُفض البحث، وباسل في غرفته بالكود (${B.visibleStep()})`);
    C.joinCode(codeB);
    r.ok(await waitFor(w, () => B.matches.length && C.matches.length, 8000), '(بحث أثناء الإنشاء) كريم يدخل بالكود وتبدأ مباراتهما');
    noErr(r, w); w.dispose();
  }
  // firebase.js مباشرة: مغادرة أثناء إنشاء الغرفة (ثنائية وجماعية) → لا مستمعين لغرفة تُركت، ولا غرفة باقية
  for (const kind of ['ثنائية', 'جماعية']) {
    const w = new World(); w.quiet = true;
    const B = await w.client('باسل');
    await w.run(300);
    let res = null;
    const p = kind === 'ثنائية' ? B.om.createRoom({ rows: 4, cols: 4 }, 'باسل') : B.om.createMultiRoom({ rows: 4, cols: 4 }, 'باسل', 3);
    p.then(v => { res = v; });
    const code = B.om.roomCode;
    await w.run(10);
    B.safe(() => B.om.leaveRoom());
    await w.run(3000);
    const left = kind === 'ثنائية' ? res === code : !!(res && res.left);
    r.ok(left && B.om.roomCode == null && B.om._unsubs.length === 0 && roomOf(w, code) == null,
      `(غرفة ${kind} تُركت أثناء إنشائها) لا مستمعين لها ولا غرفة باقية (${JSON.stringify(res)}، مستمعون=${B.om._unsubs.length})`);
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── 12) الحضور يتبع المباراة (v35.9 — ملاحظة فحص 1): "في مباراة" ما دامت جارية، و"متصل" لحظة انتهائها ──
// (كان "في مباراة" من دخول شاشة اللعب حتى الخروج منها، فيظهر الصديق مشغولاً وهو على شاشة النتيجة والدعوة تعمل)
// ما يراه الأصدقاء فعلاً: حالة الحضور المخزّنة عند الخادم (يكتبها presence.js الحقيقي)
const pres = c => c.world.server.getAt('users/' + c.uid + '/presence/state');
export async function presenceFollowsMatch(verbose = false) {
  const r = suite('الحضور: "في مباراة" ما دامت المباراة جارية فقط — "متصل" لحظة انتهائها بأي شكل'); r.verbose = verbose;
  // (أ) ثنائي بدعوة: نهاية طبيعية والاثنان ما زالا على شاشة النتيجة
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await w.run(500);
    await inviteShown(w, A, B); B.acceptInvite();
    // لحظة بدء التحميل (قبل ظهور اللوحة): "في مباراة" من الآن — كما تعاملها الدعوات (مراجعة v35.9)
    await waitFor(w, () => onStep(B, 'playing') && onStep(A, 'playing'), 4000);
    await w.run(300);
    r.ok(pres(A) === 'playing' && pres(B) === 'playing' && B.matches.length === 0,
      `(أ) لحظة بدء التحميل وقبل اللوحة: الاثنان "في مباراة" (${pres(A)}/${pres(B)}، لوحة باسل=${B.matches.length})`);
    await waitFor(w, () => A.matches.length && B.matches.length, 8000);
    await w.run(3000);
    r.ok(pres(A) === 'playing' && pres(B) === 'playing', `(أ) أثناء المباراة: الاثنان "في مباراة" (${pres(A)}/${pres(B)})`);
    await finishDuo(w, A);
    r.ok(A.onlineUI.activity() === 'done' && B.onlineUI.activity() === 'done', '(أ) انتهت والاثنان على شاشة النتيجة');
    r.ok(pres(A) === 'online' && pres(B) === 'online', `(أ) خلال ثانية: الاثنان "متصل" (${pres(A)}/${pres(B)})`);
    const n = A.presence.length;
    await w.run(5000);
    r.ok(A.presence.length === n, '(أ) لا كتابات حضور متكررة وهو على شاشة النتيجة');
    A.exitToMenu(); await w.run(3000);
    r.ok(pres(A) === 'online' && A.presence.length === n, '(أ) بعد الخروج للقائمة: "متصل" بلا كتابة زائدة');
    // مباراة ثانية بعد الخروج: تعود "في مباراة"
    await inviteShown(w, A, B); B.acceptInvite();
    await waitFor(w, () => A.matches.length === 2 && B.matches.length === 2, 10000);
    await w.run(2000);
    r.ok(pres(A) === 'playing' && pres(B) === 'playing', `(أ) المباراة الثانية: "في مباراة" من جديد (${pres(A)}/${pres(B)})`);
    noErr(r, w); w.dispose();
  }
  // (أ2) الانضمام بالكود: "في مباراة" من لحظة ظهور شاشة اللعب، قبل اللوحة (مراجعة v35.9)
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    A.createDuoRoom(); await w.run(800);
    B.joinCode(A.duoCodeShown());
    await waitFor(w, () => onStep(B, 'playing'), 4000);
    await w.run(300);
    r.ok(pres(B) === 'playing' && B.matches.length === 0, `(أ2) بالكود: الضيف "في مباراة" أثناء تحميلها وقبل اللوحة (${pres(B)})`);
    await waitFor(w, () => A.matches.length && B.matches.length, 8000);
    r.ok(pres(A) === 'playing' && pres(B) === 'playing', '(أ2) وأثناء المباراة: الاثنان "في مباراة"');
    noErr(r, w); w.dispose();
  }
  // (ب) ثنائي: الخصم ينسحب → الباقي "متصل" (فاز ونافذة النتيجة ظاهرة)
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل');
    await duoMatch(w, A, B);
    r.ok(pres(A) === 'playing' && pres(B) === 'playing', '(ب) أثناء المباراة: "في مباراة"');
    B.withdraw(); await w.run(4000);
    r.ok(A.mods.state.gameFinished && pres(A) === 'online', `(ب) باسل انسحب → أحمد "متصل" على شاشة فوزه (${pres(A)})`);
    noErr(r, w); w.dispose();
  }
  // (ج) جماعي: من خرج من مباراة ما زالت جارية "متصل"، والباقون "في مباراة"؛ وعودة اتصاله لا تعيده "في مباراة"
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
    A.createCodeRoom(3); await w.run(400);
    const code = A.codeShown();
    B.joinCode(code); await w.run(600); C.joinCode(code); await w.run(800);
    A.startCode();
    await waitFor(w, () => A.matches.length && B.matches.length && C.matches.length, 8000);
    await w.run(6000);
    r.ok([A, B, C].every(c => pres(c) === 'playing'), `(ج) أثناء المباراة: الثلاثة "في مباراة"`);
    C.drop({ offlineMs: 16000, serverDetectMs: 1500 });
    await w.run(20000);    // خرج بعد المهلة، ثم عاد اتصاله
    r.ok(C.mods.og.isOutOfMatch() === true, '(ج) كريم خارج المباراة (يتابع)');
    r.ok(pres(C) === 'online', `(ج) كريم "متصل" بعد خروجه وعودة اتصاله (${pres(C)})`);
    r.ok(pres(A) === 'playing' && pres(B) === 'playing', '(ج) وأحمد وباسل ما زالا "في مباراة"');
    // انقطاع ثانٍ قصير وهو خارجها: عودة الاتصال لا تكتب "في مباراة" ولو لحظة
    const k = C.presence.length;
    C.drop({ offlineMs: 2000, serverDetectMs: 500 });
    await w.run(5000);
    const after = C.presence.slice(k).map(x => x.s);
    r.ok(!after.includes('playing') && pres(C) === 'online', `(ج) انقطاع ثانٍ وهو خارجها: لا "في مباراة" ولو لحظة (${after.join('→') || '—'})`);
    noErr(r, w); w.dispose();
  }
  // (د) المشاهد: "متصل" (متاح للدعوة — حالة "يشاهد" مخطّطة في 2.2)، واللاعبان "في مباراة"
  {
    const w = new World(); w.quiet = true; w.startSampler(100);
    const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
    await duoMatch(w, A, B);
    C.el('room-code-input').value = A.om.roomCode;
    C.el('spectate-btn').click();
    await w.run(8000);
    r.ok(C.mods.config.spectator === true && C.matches.length === 1, '(د) كريم يشاهد مباراتهما');
    r.ok(pres(C) === 'online' && pres(A) === 'playing' && pres(B) === 'playing', `(د) المشاهد "متصل" واللاعبان "في مباراة" (${pres(C)}/${pres(A)}/${pres(B)})`);
    noErr(r, w); w.dispose();
  }
  return r;
}

// ── مستكشف عشوائي: دعوات/قبول/رفض/إلغاء/بحث/انقطاع/إغلاق بين 3 أصدقاء داخل نوافذ السباق ──
// الثوابت بعد الهدوء: لا غرفة منتظرة بلا صاحب حاضر ينتظر فيها، لا دعوة صادرة بلا غرفتها، لا مباراة بطرف واحد،
// ≤2 في كل غرفة ثنائية، لا لاعب في مباراتين، ولا إشعار ظاهر لدعوة غرفتها لا تنتظر
export async function fuzzInvites(seed) {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const w = new World(); w.quiet = true;
  const P = [await w.client('أحمد'), await w.client('باسل'), await w.client('كريم')];
  const findings = [];
  const steps = 10 + Math.floor(rnd() * 8);
  for (let i = 0; i < steps; i++) {
    const c = pick(P.filter(p => !p.dead && !p.signedOut));
    if (!c) break;
    const others = P.filter(p => p !== c && !p.dead);
    const a = rnd();
    // لعبة محلية من القائمة (تحدي اليوم/ضد الكمبيوتر) تبدأ وتنتهي — تترك أي انتظار (مراجعة v35.9)
    if (rnd() < 0.06) {
      if (c.onlineUI.activity() === 'idle' || c.onlineUI.activity() === 'waiting') {
        c.event('act', 'لعبة محلية'); c.mods.state.gameFinished = false; c.el('board').classList.remove('hidden');
        await w.run(Math.floor(rnd() * 3000)); c.mods.state.gameFinished = true; c.exitToMenu();
      }
    } else if (rnd() < 0.04 && P.filter(p => !p.dead && !p.signedOut).length > 2) { c.signOut({ late: rnd() < 0.5 }); c.signedOut = true; }
    else if (a < 0.30 && others.length) c.invite(pick(others));
    else if (a < 0.45) { if (c.invitePopup()) c.acceptInvite(); }
    else if (a < 0.55) { if (c.invitePopup()) c.rejectInvite(); }
    else if (a < 0.63) { if (onStep(c, 'lobby')) c.cancelDuoRoom(); }
    else if (a < 0.71) { if (c.onlineUI.activity() === 'idle') await c.startSearch(2); }
    else if (a < 0.78) { if (onStep(c, 'searching')) c.cancelSearch(); }
    else if (a < 0.86) c.drop({ offlineMs: 500 + Math.floor(rnd() * 3500), serverDetectMs: 100 + Math.floor(rnd() * 1500) });
    else if (a < 0.90) { if (P.filter(p => !p.dead).length > 2) c.closeTab(50 + Math.floor(rnd() * 400)); }
    // زر الخروج موجود فقط على اللوحة (بعد النهاية هنا — الانسحاب له مستكشفاته)
    else if (a < 0.95) { if (c.onlineUI.activity() === 'done') c.exitToMenu(); }
    else { if (c.onlineUI.activity() === 'playing' && c.matches.length) await finishDuo(w, c); }
    await w.run(Math.floor(rnd() * 1500));
  }
  await w.run(75000);   // هدوء: كل مهلة دعوة انتهت، وكل غرفة اختفت عادت أو انتهت
  const rooms = w.rooms();
  const live = P.filter(p => !p.dead);
  for (const [code, rm] of Object.entries(rooms)) {
    if (!rm || rm.multi) continue;
    if (rm.status === 'waiting') {
      const host = live.find(p => p.uid === rm.p1uid);
      if (!host || host.om.roomCode !== code) findings.push(`غرفة ${code} تنتظر بلا صاحب حاضر فيها`);
    }
  }
  for (const p of live) {
    const o = p.outgoing();
    if (o) findings.push(`${p.name}: دعوة صادرة باقية بعد انتهاء مهلتها (${p.om.roomCode === o.code ? 'في غرفتها' : 'بلا غرفتها'})`);
    const pop = p.invitePopup();
    if (pop) {
      const inv = w.server.getAt('invites/' + p.uid);
      const rm = inv ? rooms[inv.roomCode] : null;
      if (!rm || rm.status !== 'waiting') findings.push(`${p.name}: إشعار دعوة ظاهر وغرفتها لا تنتظر`);
    }
    const m = p.matches[p.matches.length - 1];
    if (m && !p.mods.state.gameFinished && p.om.roomCode === m.room) {
      const rm = rooms[m.room];
      const other = live.find(q => q !== p && q.om.roomCode === m.room);
      if (rm && rm.status === 'playing' && !other) findings.push(`${p.name}: مباراة بطرف واحد في ${m.room}`);
    }
  }
  if (w.errors.length) findings.push('خطأ JS: ' + w.errors[0].slice(0, 160));
  w.dispose();
  return { findings };
}
