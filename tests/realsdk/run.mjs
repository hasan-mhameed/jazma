// 🔬 فحوص firebase.js بحزمة Firebase الحقيقية (10.12.0، نفس نسخة الموقع) فوق خادم وهمي محلي.
// المحاكي (tests/sim) يختبر منطق اللعبة كله لكن بقاعدة بيانات مبسّطة؛ هنا نختبر ما لا يراه:
// سلوك الحزمة الداخلي — المعاملة تُلغى بكتابة محلية على مسارها أو بتطبيق أوامر الانقطاع محلياً لحظة
// الانقطاع، والإلغاء على مسار يشمل ما تحته، والكتابات تنتظر عودة الشبكة. (أُضيفت في مراجعة v35.7 الثانية)
// ومنذ v36.0: auth.js الحقيقي (التسجيل بإيميل) فوق وسيط يضيف زمن الشبكة — ترتيب الحزمة للعمليات المعلّقة عند أول اتصال.
// التشغيل: cd tests/realsdk && npm install && npm test
// فحص الطفرات: JAZAM_FIREBASE_JS=<نسخة قديمة من firebase.js> npm test  (يجب أن تفشل) — وكذلك JAZAM_INVITE_JS وJAZAM_AUTH_JS
import { pathToFileURL } from 'node:url';
import { FakeRTDB } from './fakertdb.mjs';
import { gen, genInvite, genAuth } from './gen.mjs';
import net from 'node:net';

const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function suite(name) {
  const r = { name, pass: 0, fail: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push(msg); } };
  results.push(r);
  return r;
}

// عالم: خادم + ثلاثة أجهزة (أحمد A = المنشئ/المقعد 1، باسل B، كريم C) ومباراة جماعية جارية
async function liveMatch3({ start = true } = {}) {
  const S = new FakeRTDB(); const port = await S.listen();
  const devs = {};
  for (const d of ['A', 'B', 'C']) devs[d] = await import(pathToFileURL(gen(d, port)).href);
  const A = devs.A.onlineManager, B = devs.B.onlineManager, C = devs.C.onlineManager;
  const { code } = await A.createMultiRoom({ rows: 4, cols: 4 }, 'أحمد', 3);
  await B.joinMultiRoom(code, 'باسل'); await C.joinMultiRoom(code, 'كريم');
  await wait(200);
  if (start) { await A.startMultiGame(); await wait(700); }
  const seat = uid => S.getAt(`rooms/${code}/players/${uid}`) || {};
  const armedFor = uid => [...S.conns].reduce((n, c) => n + c.ondisc.filter(o => String(o.p).includes(`/players/${uid}`)).length, 0);
  return { S, port, devs, A, B, C, code, seat, armedFor };
}

// ── 1) زر الخروج بلا شبكة ثم العودة: لا مقعد عالق "نشط" ──
// (مراجعة v35.7 الثانية: معاملة الانسحاب تنتظر الشبكة، وعند العودة كان معالج العودة يمسح ختم الانقطاع
//  بكتابة على المقعد فيُلغي المعاملة، ثم تُلغى كل أوامر الانقطاع: مقعد نشط بلا ختم والباقون ينتظرون بنكه)
async function offlineExitThenReconnect() {
  const r = suite('زر الخروج بلا شبكة ثم العودة → المقعد يخرج (لا مقعد عالق)، والزر لا يعلّق');
  const W = await liveMatch3();
  const { B, devs, seat } = W;
  // معالج العودة كما في الواجهة، لكن بلا حارسها (نثبت أن firebase.js نفسه لا يكتب على مقعد ينسحب)
  B.onConnectionChange(c => { if (c) B.clearMyDisconnectMark(); });
  devs.B.__off(); await wait(300);
  const t0 = Date.now();
  const res = await Promise.race([B.leaveRoom({ announce: true }), wait(6000).then(() => 'hung')]);
  r.ok(res !== 'hung' && Date.now() - t0 < 1500, `زر الخروج بلا شبكة لا يعلّق (${res === 'hung' ? 'علّق' : (Date.now() - t0) + 'ms'})`);
  await wait(300); devs.B.__on(); await wait(2000);
  const s = seat('uB');
  r.ok(s.active === false, `بعد العودة: مقعد باسل خارج (${JSON.stringify({ active: s.active ?? null, why: s.outReason ?? null })})`);
  r.ok(s.outReason === 'left', `وسببه "انسحب" (${s.outReason ?? null})`);
  r.ok(W.armedFor('uB') === 0, `لا أوامر انقطاع باقية لمقعده بعد حسم انسحابه (${W.armedFor('uB')})`);
  W.S.close();
}

// ── 2) انقطاع لحظي بعد ضغط الخروج مباشرة: الانسحاب يُعاد ويُعتمد ──
// (Firebase يطبّق أوامر الانقطاع محلياً لحظة الانقطاع — كتابة على المقعد تُلغي المعاملة المنتظرة)
async function blipDuringWithdraw() {
  const r = suite('انقطاع لحظي أثناء الانسحاب → المعاملة تُعاد بعد العودة ويُعتمد "انسحب"');
  const W = await liveMatch3();
  const { B, devs, seat } = W;
  B.onConnectionChange(c => { if (c) B.clearMyDisconnectMark(); });
  const leaving = B.leaveRoom({ announce: true });
  devs.B.__off();                         // الشبكة تسقط لحظة الضغط، قبل أن يعتمد الخادم الانسحاب
  await wait(400); devs.B.__on();
  const res = await leaving;
  await wait(1500);
  const s = seat('uB');
  r.ok(s.active === false && s.outReason === 'left', `المقعد: "انسحب" (${JSON.stringify({ active: s.active ?? null, why: s.outReason ?? null })})`);
  r.ok(s.disconnectedAt == null, 'وختم الانقطاع الذي كتبه الخادم عند سقوط الشبكة مُسح مع الانسحاب');
  r.ok(res && res.withdraw && res.withdraw.ok === true, 'حُسم خلال انتظار الزر (عادت الشبكة بسرعة)');
  r.ok(W.armedFor('uB') === 0, `لا أوامر انقطاع باقية لمقعده (${W.armedFor('uB')})`);
  W.S.close();
}

// ── 3) الخروج العادي (بشبكة): يُعتمد فوراً مع القائمة، وتُلغى أوامر الانقطاع ──
async function onlineExit() {
  const r = suite('الانسحاب بشبكة سليمة → يُعتمد من أول محاولة مع قائمة الخادم');
  const W = await liveMatch3();
  const { B, seat } = W;
  const res = await B.leaveRoom({ announce: true });
  await wait(200);   // إلغاءات أوامر الانقطاع تُرسل بلا انتظار ردودها — نمهل الخادم لحظة لينفّذها بترتيبها
  const s = seat('uB');
  r.ok(res && res.withdraw && res.withdraw.ok === true && res.withdraw.players?.uB?.active === false, 'leaveRoom ترجع القائمة المعتمدة وفيها خروجه');
  r.ok(s.active === false && s.outReason === 'left' && typeof s.outAt === 'number', `المقعد: "انسحب" بلحظة خادم (${s.outReason ?? null})`);
  r.ok(W.armedFor('uB') === 0, `لا أوامر انقطاع باقية لمقعده (${W.armedFor('uB')})`);
  const a = seat('uA'), c = seat('uC');
  r.ok(a.active !== false && c.active !== false, 'أحمد وكريم ما زالا في المباراة');
  W.S.close();
}

// ── 4) المنشئ (المقعد 1): ختم انقطاعه مسلّح بعد البدء، وانقطاعه يكتبه عند الخادم ──
// (كان يسلّح الختم ثم يلغي أوامر الغرفة كلها — والإلغاء يشمل ما تحت المسار — فلا يُخرَج أبداً)
async function creatorStamp() {
  const r = suite('المنشئ: ختم الانقطاع يبقى مسلّحاً بعد البدء، وانقطاعه يُكتب عند الخادم');
  const W = await liveMatch3();
  const { devs, seat } = W;
  await wait(300);
  r.ok(W.armedFor('uA') >= 1, `أمر ختم انقطاع المنشئ مسلّح عند الخادم (${W.armedFor('uA')})`);
  r.ok(W.armedFor('uB') >= 1 && W.armedFor('uC') >= 1, 'وللآخرين كذلك');
  devs.A.__off(); await wait(500);
  r.ok(typeof seat('uA').disconnectedAt === 'number', 'انقطاع المنشئ كتب ختمه عند الخادم (فيُخرجه الباقون بعد المهلة)');
  W.S.close();
}

// ── 5) نفد وقتي أثناء انقطاع لحظي: خروجي "نفد وقته" يُعاد ويُعتمد ──
async function timeoutDuringBlip() {
  const r = suite('نفاد وقتي مع انقطاع لحظي → خروج "نفد وقته" يُعاد ويُعتمد');
  const W = await liveMatch3();
  const { B, devs, seat } = W;
  const p = B.markSelfInactive();
  devs.B.__off(); await wait(400); devs.B.__on();
  const players = await Promise.race([p, wait(6000).then(() => 'hung')]);
  await wait(500);
  r.ok(players !== 'hung' && players && players.uB && players.uB.active === false, 'markSelfInactive ترجع القائمة وفيها خروجي');
  const s = seat('uB');
  r.ok(s.active === false && s.outReason === 'time', `المقعد: "نفد وقته" (${JSON.stringify({ active: s.active ?? null, why: s.outReason ?? null })})`);
  W.S.close();
}


// ── 6) نقرة خروج ثانية أثناء انتظار الانسحاب (رفع بطيء) ثم إغلاق الصفحة: لا مقعد عالق ──
// (مراجعة v35.7 الثالثة: النقرة الثانية كانت تسلك المسار الهادئ فتلغي كل أوامر الانقطاع — ومعها ختمي)
async function secondExitClick() {
  const r = suite('نقرة خروج ثانية أثناء انتظار الانسحاب ثم إغلاق الصفحة → ختم الانقطاع باقٍ (لا مقعد عالق)');
  const W = await liveMatch3();
  const { S, B, devs, seat } = W;
  // رفع بطيء لمعاملة الانسحاب وحدها: لا يصل الخادمَ قبل 6 ثوانٍ
  S.delayFor = m => (m.t === 'd' && m.d.a === 'p' && /"outReason":"left"/.test(JSON.stringify(m.d.b.d || ''))) ? 6000 : null;
  r.ok(W.armedFor('uB') >= 1, 'قبل الخروج: ختم انقطاعه مسلّح');
  B.leaveRoom({ announce: true });            // النقرة الأولى (انسحاب مؤكَّد)
  await wait(1000);
  B.leaveRoom({ announce: false });           // النقرة الثانية أثناء الانتظار (المسار الهادئ)
  await wait(1000);
  r.ok(W.armedFor('uB') >= 1, `بعد النقرة الثانية: الختم ما زال مسلّحاً (${W.armedFor('uB')})`);
  devs.B.__off();                              // أُغلقت الصفحة والانسحاب لم يصل بعد
  await wait(1000);
  const s = seat('uB');
  r.ok(s.active === false || typeof s.disconnectedAt === 'number',
    `المقعد ليس عالقاً: خارج أو عليه ختم انقطاع يُخرجه به الباقون (${JSON.stringify({ active: s.active ?? null, disc: typeof s.disconnectedAt })})`);
  W.S.close();
}

// ── 7) انقطاع بعد البدء مباشرة قبل وصول تأكيدات الخادم: الختم مسلّح رغم ذلك ──
// (مراجعة v35.7 الثالثة: كان الختم يُسلَّح بعد تأكيد الإلغاءات — والانقطاع قبل التأكيد يُسقط التأكيد
//  نهائياً فلا يُسلَّح أبداً؛ ومعالج العودة في الواجهة يُسجَّل بعد البدء بلحظات فيفوته رجوع سريع)
async function dropBeforeStartAcks() {
  const r = suite('انقطاع بعد البدء مباشرة قبل وصول التأكيدات → ختم الانقطاع مسلّح قبل الانقطاع وبعد العودة');
  const W = await liveMatch3({ start: false });
  const { S, A, B, devs, seat } = W;
  // الخادم ينفّذ طلبات باسل بترتيبها فوراً، لكن ردوده عليها تتأخر (فيسبقها الانقطاع)
  S.replyDelayFor = m => (m.t === 'd' && (m.d.a === 'oc' || m.d.a === 'o') && String(m.d.b.p).includes('/players/uB')) ? 1500 : null;
  let started = false; B.onMultiStart(() => { started = true; });
  await A.startMultiGame();
  for (let i = 0; i < 400 && !started; i++) await wait(5);
  await wait(50); devs.B.__off();              // انقطع بعد بدء المباراة عنده بـ50ms
  await wait(400);
  const s = seat('uB');
  r.ok(s.num === 2 && s.active !== false, 'مقعده باقٍ في المباراة (أمر إزالة اللوبي أُلغي قبل الانقطاع)');
  r.ok(typeof s.disconnectedAt === 'number', 'الخادم كتب ختم انقطاعه (طلب التسليح وصل بترتيبه ولو لم يصل تأكيده)');
  S.replyDelayFor = null;
  devs.B.__on(); await wait(1500);
  r.ok(W.armedFor('uB') >= 1, `بعد عودته السريعة: الختم مسلّح على الاتصال الجديد (${W.armedFor('uB')})`);
  W.S.close();
}


// ── 8) مغادرة هادئة (بعد نهاية المباراة أو الخروج منها) وانقطاع أثناء انتظار ردود الخادم: لا تعليق ──
// (مراجعة v35.7 الرابعة: كانت تنتظر ردّ كل إلغاء؛ والانقطاع يُسقط الرد نهائياً فلا تنتهي أبداً — وحارس
//  زر الخروج يبقى مغلقاً حتى إعادة تحميل الصفحة)
async function quietLeaveDuringDrop() {
  const r = suite('مغادرة هادئة مع انقطاع أثناء انتظار ردود الخادم → تنتهي فوراً (زر الخروج لا يعلق)');
  const W = await liveMatch3();
  const { S, B, devs, code } = W;
  S.replyDelayFor = m => (m.t === 'd' && m.d.a === 'oc' && String(m.d.b.p).includes(code)) ? 1500 : null;
  let settled = false; const t0 = Date.now(); let took = null;
  B.leaveRoom({ announce: false }).then(() => { settled = true; took = Date.now() - t0; });
  await wait(50); devs.B.__off();
  await wait(500); devs.B.__on();
  await wait(1500);
  r.ok(settled, `المغادرة انتهت (${settled ? took + 'ms' : 'ما زالت معلّقة'})`);
  r.ok(B.roomCode == null, 'وحالة الغرفة صُفّرت (لا غرفة قديمة عالقة للبحث التالي)');
  W.S.close();
}

// ── 9) المشاهد يغادر مع انقطاع أثناء انتظار الرد: لا تعليق ──
async function spectatorLeaveDuringDrop() {
  const r = suite('مشاهد يغادر مع انقطاع أثناء انتظار الرد → تنتهي فوراً');
  const W = await liveMatch3();
  const { S, code } = W;
  const D = await import(pathToFileURL(gen('D', W.port)).href);
  await D.onlineManager.joinAsSpectator(code); await wait(400);
  S.replyDelayFor = m => (m.t === 'd' && m.d.a === 'oc' && String(m.d.b.p).includes('/spectators/')) ? 1500 : null;
  let settled = false;
  D.onlineManager.leaveSpectator().then(() => { settled = true; });
  await wait(50); D.__off(); await wait(500); D.__on(); await wait(1500);
  r.ok(settled && D.onlineManager.roomCode == null, `مغادرة المشاهدة انتهت (${settled ? 'نعم' : 'معلّقة'})`);
  W.S.close();
}

// ═════════ الثنائي: الانضمام والإلغاء الذرّيان (v35.8 — الخطوة 1.3) ═════════
// المعاملات تبدأ بذاكرة محلية باردة (لا مستمع على الغرفة عند المنضمّ، والمضيف يفصل مستمعيه قبل الإلغاء):
// هنا نتحقق بالحزمة الحقيقية أن "null أولاً" يُعاد بقيمة الخادم ولا يُسقط الانضمام/الإلغاء أو يحذف غرفة حيّة.
async function duoWorld(devList = ['A', 'B', 'C']) {
  const S = new FakeRTDB(); const port = await S.listen();
  const devs = {};
  for (const d of devList) devs[d] = await import(pathToFileURL(gen(d, port)).href);
  const M = Object.fromEntries(devList.map(d => [d, devs[d].onlineManager]));
  const room = code => S.getAt(`rooms/${code}`);
  const rooms = () => S.getAt('rooms') || {};
  const until = async (pred, ms = 3000) => { for (let i = 0; i < ms; i++) { if (pred()) return true; await wait(1); } return false; };
  return { S, port, devs, M, room, rooms, until };
}
const CFG = { rows: 4, cols: 4 };

// ── 10) منضمّان بنفس اللحظة لنفس المنتظر: واحد يدخل، والآخر ينشئ غرفته ──
async function duoTwoJoiners() {
  const r = suite('الثنائي: منضمّان بنفس اللحظة لنفس المنتظر → واحد فقط يدخل (معاملة بذاكرة باردة)');
  const W = await duoWorld();
  const { M, room, rooms } = W;
  const host = await M.A.findRandomMatch(CFG, 'أحمد');
  const code = host.code;
  const [rb, rc] = await Promise.all([M.B.findRandomMatch(CFG, 'باسل'), M.C.findRandomMatch(CFG, 'كريم')]);
  await wait(200);
  const guests = [rb, rc].filter(x => x.role === 'guest');
  const hosts = [rb, rc].filter(x => x.role === 'host');
  r.ok(host.role === 'host' && guests.length === 1 && hosts.length === 1, `واحد منضمّ وواحد منتظر (${rb.role}/${rc.role})`);
  const rm = room(code) || {};
  const gUid = rb.role === 'guest' ? 'uB' : 'uC';
  r.ok(rm.status === 'playing' && rm.p2uid === gUid && guests[0]?.code === code, `غرفة أحمد: خصم واحد متّسق (${rm.status}/${rm.p2uid})`);
  const other = hosts[0] ? room(hosts[0].code) : null;
  r.ok(other && other.status === 'waiting' && other.public === true && !other.p2uid, 'والآخر ينتظر في غرفته العامة');
  r.ok(!Object.values(rooms()).some(x => x && x.p2uid && !x.p1name), 'لا غرفة شبحية');
  W.S.close();
}

// ── 11) المنتظر يلغي وحده: المعاملة (بذاكرة باردة بعد فصل المستمعين) تحذف الغرفة ──
async function duoHostCancelAlone() {
  const r = suite('الثنائي: إلغاء المنتظر وحده → الغرفة تُحذف رغم أن ذاكرته صارت باردة');
  const W = await duoWorld(['A']);
  const { M, room } = W;
  const { code } = await M.A.findRandomMatch(CFG, 'أحمد');
  await wait(100);
  const t0 = Date.now();
  await M.A.cancelRandomMatch();
  r.ok(Date.now() - t0 < 50, 'الإلغاء لا ينتظر الشبكة (الزر لا يعلق)');
  await wait(300);
  r.ok(room(code) == null, 'الغرفة حُذفت');
  r.ok(M.A.roomCode == null, 'وحالة الغرفة صُفّرت');
  W.S.close();
}

// ── 12) الانضمام يسبق الإلغاء بلحظة: المُلغي لا يُسحب لمباراة، والمباراة تُلغى قبل بدئها ──
async function duoCancelAfterJoin() {
  const r = suite('الثنائي: انضمام يسبق الإلغاء بلحظة → المُلغي لا يبدأ مباراة، والغرفة "أُلغيت قبل البدء"');
  const W = await duoWorld(['A', 'B']);
  const { S, M, room, until } = W;
  let joinedCalled = false;
  M.A.onOpponentJoined(() => { joinedCalled = true; });
  const { code } = await M.A.findRandomMatch(CFG, 'أحمد');
  await wait(100);
  S.delay = 40;                                   // نافذة سباق أوسع: اللقطة تصل أحمد بعد 40ms
  const joining = M.B.findRandomMatch(CFG, 'باسل');
  const hit = await until(() => (room(code) || {}).status === 'playing');
  await M.A.cancelRandomMatch();                  // داخل النافذة: قبل أن تصله لقطة الانضمام
  const rb = await joining;
  await wait(600);
  const rm = room(code) || {};
  r.ok(hit && rb.role === 'guest', 'الانضمام اعتُمد أولاً');
  r.ok(!joinedCalled && M.A._gameStarted === false, 'المُلغي لم تبدأ له مباراة (لا "انضمّ خصم" بعد الإلغاء)');
  r.ok(rm.status === 'finished' && rm.abortedBy === 1, `الغرفة: أُلغيت قبل البدء بيد المنشئ (${rm.status}/${rm.abortedBy})`);
  r.ok(M.B.lastRoom() && M.B.lastRoom().abortedBy === 1, 'والمنضمّ يعرف ذلك من لقطته (تُبلغه الواجهة: لم تُحسب)');
  W.S.close();
}

// ── 13) إلغاء وانضمام متزامنان بلا ترتيب مفروض: أي النتيجتين لكن بلا غرفة شبحية أبداً ──
async function duoCancelJoinSimultaneous() {
  const r = suite('الثنائي: إلغاء وانضمام متزامنان → نتيجة متّسقة دائماً، بلا غرفة شبحية');
  let ok = 0, n = 6;
  for (let i = 0; i < n; i++) {
    const W = await duoWorld(['A', 'B']);
    const { M, room, rooms } = W;
    const { code } = await M.A.findRandomMatch(CFG, 'أحمد');
    await wait(50);
    const [rb] = await Promise.all([M.B.findRandomMatch(CFG, 'باسل'), M.A.cancelRandomMatch()]);
    await wait(500);
    const rm = room(code);
    const noGhost = !Object.values(rooms()).some(x => x && x.p2uid && !x.p1name);
    const consistent = rb.role === 'guest' ? (rm && rm.abortedBy === 1) : (rm == null && rb.role === 'host');
    if (noGhost && consistent && M.A._gameStarted === false) ok++;
    else r.notes.push(`جولة ${i}: ${rb.role} ${JSON.stringify(rm)}`);
    W.S.close();
  }
  r.ok(ok === n, `${ok}/${n} جولات متّسقة`);
}

// ── 14) الإلغاء بلا شبكة: لا يعلق، ويكمل عند العودة ──
async function duoCancelOffline() {
  const r = suite('الثنائي: إلغاء البحث بلا شبكة → يرجع فوراً (لا يعلق الزر)');
  const W = await duoWorld(['A']);
  const { M, devs } = W;
  await M.A.findRandomMatch(CFG, 'أحمد');
  await wait(100);
  devs.A.__off(); await wait(100);
  const res = await Promise.race([M.A.cancelRandomMatch().then(() => 'done'), wait(1500).then(() => 'hung')]);
  r.ok(res === 'done', `الإلغاء رجع (${res})`);
  devs.A.__on(); await wait(800);
  r.ok(!Object.values(W.rooms()).some(x => x && x.p1uid === 'uA'), 'لا غرفة منتظرة باقية باسمه بعد العودة');
  W.S.close();
}

// ── 15) الغرفة بالكود: منضمّان بنفس اللحظة → واحد يدخل والآخر "ممتلئة أو انتهت" ──
async function duoCodeTwoJoiners() {
  const r = suite('الثنائي بالكود: منضمّان بنفس اللحظة → واحد يدخل، والآخر يُرفض');
  const W = await duoWorld();
  const { M, room } = W;
  const code = await M.A.createRoom(CFG, 'أحمد');
  await wait(100);
  const res = await Promise.allSettled([M.B.joinRoom(code, 'باسل'), M.C.joinRoom(code, 'كريم')]);
  const ok = res.filter(x => x.status === 'fulfilled').length;
  const rej = res.filter(x => x.status === 'rejected');
  r.ok(ok === 1 && rej.length === 1, `دخل واحد (${ok})`);
  r.ok(rej[0] && /الغرفة ممتلئة أو انتهت/.test(String(rej[0].reason && rej[0].reason.message)), `والآخر: ${rej[0] && rej[0].reason && rej[0].reason.message}`);
  const rm = room(code) || {};
  const winner = res[0].status === 'fulfilled' ? 'uB' : 'uC';
  r.ok(rm.status === 'playing' && rm.p2uid === winner, `الغرفة بخصم واحد متّسق (${rm.p2uid})`);
  W.S.close();
}

// ── 16) صفحة المنتظر تُغلق بلحظة الانضمام: الخادم يمسح الغرفة، والمنضمّ يُبلَّغ "اختفت" ──
async function duoHostGoneAtJoin() {
  const r = suite('الثنائي: صفحة المنتظر أُغلقت بلحظة الانضمام → المنضمّ يُبلَّغ (لا انتظار للأبد)');
  const W = await duoWorld(['A', 'B']);
  const { S, M, devs, room, until } = W;
  const { code } = await M.A.findRandomMatch(CFG, 'أحمد');
  await wait(100);
  S.delay = 40;
  let left = null;
  const joining = M.B.findRandomMatch(CFG, 'باسل');
  const hit = await until(() => (room(code) || {}).status === 'playing');
  devs.A.__off();                                  // قبل أن تصله لقطة الانضمام: أمر انقطاعه "امسح الغرفة"
  await joining;
  M.B.onOpponentLeft(rm => { left = rm; });
  await wait(800);
  r.ok(hit && room(code) == null, 'الخادم مسح الغرفة بأمر انقطاع المنشئ');
  r.ok(left && left.vanished === true && left.status === 'finished', `المنضمّ تلقّى "انتهت: اختفت الغرفة" (${JSON.stringify(left)})`);
  W.S.close();
}

// ═════════ مراجعة v35.8 المستقلة: أوامر المسح وردود المعاملات التي يُضيّعها الانقطاع ═════════
// (سيناريوهات المراجع نفسها: ghost / phantom / createdrop — تفشل كلها على v35.8 قبل الإصلاح)

// ── 17) الإلغاء ثم إغلاق الصفحة قبل وصول الحذف: أمر المسح يبقى حتى يُحسم الإلغاء ──
// (كان يُلغى أولاً، والمعاملة تبدأ بذاكرة باردة فتحتاج رحلتين: إغلاق بينهما ترك غرفة "تنتظر" عامة بلا صاحب
//  يدخلها الباحث التالي ويعلق بلا خصم ولا ساعة — تراجع عن v35.7 التي كانت تحذفها)
async function duoCancelThenClose() {
  const r = suite('الثنائي: إلغاء ثم إغلاق الصفحة قبل وصول الحذف → الخادم يمسح الغرفة (لا غرفة تنتظر بلا صاحب)');
  const W = await duoWorld(['A', 'B']);
  const { S, M, devs, room } = W;
  const { code } = await M.A.findRandomMatch(CFG, 'أحمد');
  await wait(300);
  const aConn = [...S.conns].at(-1);                       // اتصال أحمد (باسل لم يتصل بعد)
  // كتابة معاملة الإلغاء (put ببصمة) لا تصل الخادم قبل إغلاق الصفحة
  S.delayFor = (m, conn) => (conn === aConn && m.t === 'd' && m.d.a === 'p' && m.d.b.h !== undefined) ? 2000 : null;
  M.A.cancelRandomMatch();
  await wait(150); devs.A.__off();                          // أُغلقت الصفحة
  await wait(600);
  const rm = room(code);
  r.ok(rm == null, `الخادم مسح الغرفة بأمر المسح الباقي (${rm ? rm.status + '/عامة=' + rm.public : 'محذوفة'})`);
  const rb = await M.B.findRandomMatch(CFG, 'باسل');
  r.ok(rb.role === 'host' && rb.code !== code, `الباحث التالي لا يدخلها — ينشئ غرفته (${rb.role}${rb.code === code ? ' في غرفة أحمد!' : ''})`);
  W.S.close();
}

// ── 18) الخادم اعتمد الانضمام وضاع ردّه بانقطاع: لا مباراة وهمية للمنتظر ──
// (Firebase يرفض معاملة أُرسلت إن انقطع الاتصال قبل ردّها — "لم أنضم" كانت خطأً: المنتظر يبدأ مباراة أمام خصم
//  يظن أنه لم ينضم، فينتظر بنك وقته كاملاً أو يخسر إن خرج. الآن: النتيجة غير معروفة → تُلغى قبل بدئها)
async function duoJoinAckLost() {
  const r = suite('الثنائي: الخادم اعتمد الانضمام وضاع ردّه بانقطاع → تُلغى المباراة قبل بدئها (لا خصم وهمي)');
  const W = await duoWorld(['A', 'B']);
  const { S, M, devs, room } = W;
  const { code } = await M.A.findRandomMatch(CFG, 'أحمد');
  let aLeft = null; M.A.onOpponentLeft(rm => { aLeft = rm; });
  await wait(300);
  let bConn = null;
  S.replyDelayFor = (m, conn) => (conn === bConn && m.t === 'd' && m.d.a === 'p' && m.d.b.h !== undefined
    && /"status":"playing"/.test(JSON.stringify(m.d.b.d || ''))) ? 1500 : null;
  const joining = M.B.findRandomMatch(CFG, 'باسل');
  await wait(20); bConn = [...S.conns].at(-1);
  await wait(280); devs.B.__off();                          // الانضمام اعتُمد، وردّه لم يصل بعد
  await wait(600); devs.B.__on();
  const rb = await Promise.race([joining, wait(8000).then(() => ({ role: 'hung' }))]);
  await wait(1200);
  const rm = room(code) || {};
  r.ok(rm.status === 'finished' && rm.abortedBy === 2, `غرفة أحمد: أُلغيت قبل البدء (${rm.status}/${rm.abortedBy ?? '-'})`);
  r.ok(rb.role !== 'hung' && !(rb.role === 'guest' && rb.code === code), `باسل لا يُعدّ داخلها ولا يعلق بحثه (${rb.role})`);
  r.ok(aLeft && aLeft.abortedBy === 2, 'وأحمد يُبلَّغ: "ألغى الخصم قبل أن تبدأ المباراة" (لا ينتظر بنك وقت خصم غائب)');
  W.S.close();
}

// ── 18ب) نفسه بالغرفة بالكود: رسالة اتصال لا "ممتلئة"، والمنشئ لا يبقى أمام خصم غائب ──
async function duoCodeJoinAckLost() {
  const r = suite('الثنائي بالكود: ضاع رد الانضمام بانقطاع → "تعذّر الانضمام بسبب انقطاع الاتصال"، والمباراة تُلغى قبل بدئها');
  const W = await duoWorld(['A', 'B']);
  const { S, M, devs, room } = W;
  const code = await M.A.createRoom(CFG, 'أحمد');
  let aLeft = null; M.A.onOpponentLeft(rm => { aLeft = rm; });
  await wait(300);
  await M.B.getRoomType(code);                              // يفتح اتصال باسل أولاً
  const bConn = [...S.conns].at(-1);
  S.replyDelayFor = (m, conn) => (conn === bConn && m.t === 'd' && m.d.a === 'p' && m.d.b.h !== undefined
    && /"status":"playing"/.test(JSON.stringify(m.d.b.d || ''))) ? 1500 : null;
  const joining = M.B.joinRoom(code, 'باسل').then(() => 'joined', e => String(e && e.message));
  await wait(150); devs.B.__off();
  await wait(600); devs.B.__on();
  const res = await Promise.race([joining, wait(8000).then(() => 'hung')]);
  await wait(1200);
  const rm = room(code) || {};
  r.ok(/تعذّر الانضمام بسبب انقطاع الاتصال/.test(res), `باسل: ${res}`);
  r.ok(rm.status === 'finished' && rm.abortedBy === 2, `الغرفة أُلغيت قبل البدء (${rm.status}/${rm.abortedBy ?? '-'})`);
  r.ok(aLeft && aLeft.abortedBy === 2, 'والمنشئ يُبلَّغ بالإلغاء (لا ينتظر خصماً غائباً)');
  W.S.close();
}

// ── 19) انقطاع لحظي والإنشاء في الطريق: أمر المسح يُسلَّح ثانيةً بعد الإنشاء ──
// (الانقطاع يستهلك عند الخادم أمر المسح المسجّل قبل الإنشاء — على غرفة لم تُنشأ بعد — ثم يُعاد إرسال الإنشاء
//  بعد العودة فتبقى غرفة بلا أمر مسح؛ إغلاق الصفحة لاحقاً كان يتركها "تنتظر" بلا صاحب)
async function duoCreateBlip() {
  const r = suite('الثنائي: انقطاع لحظي أثناء إنشاء الغرفة → أمر المسح مسلّح بعد العودة (إغلاق الصفحة لاحقاً يمسحها)');
  for (const kind of ['random', 'code']) {
    const W = await duoWorld(['A']);
    const { S, M, devs, room } = W;
    await M.A.getRoomType('000000').catch(() => {});        // يفتح اتصال أحمد أولاً
    const aConn = [...S.conns].at(-1);
    let armed = true;
    S.delayFor = (m, conn) => (armed && conn === aConn && m.t === 'd' && m.d.a === 'p'
      && /"status":"waiting"/.test(JSON.stringify(m.d.b.d || ''))) ? 400 : null;
    const p = kind === 'random' ? M.A.findRandomMatch(CFG, 'أحمد') : M.A.createRoom(CFG, 'أحمد').then(code => ({ role: 'host', code }));
    await wait(100); devs.A.__off(); armed = false;         // الإنشاء في الطريق
    await wait(500); devs.A.__on();
    const res = await Promise.race([p, wait(8000).then(() => ({ role: 'hung' }))]);
    await wait(500);
    const ops = [...S.conns].reduce((n, c) => n + c.ondisc.filter(o => String(o.p).includes(res.code)).length, 0);
    const tag = kind === 'random' ? '(عشوائية) ' : '(بالكود) ';
    r.ok(res.role === 'host' && (room(res.code) || {}).status === 'waiting', tag + `الغرفة أُنشئت بعد العودة وتنتظر (${res.role})`);
    r.ok(ops >= 1, tag + `أمر مسحها مسلّح عند الخادم (${ops})`);
    devs.A.__off(); await wait(500);
    r.ok(room(res.code) == null, tag + 'وإغلاق الصفحة لاحقاً يمسحها (لا غرفة تنتظر بلا صاحب)');
    W.S.close();
  }
}

// ── 19ب) معاملة إلغاء المباراة قبل بدئها أُرسلت ثم انقطع الاتصال قبل ردّها: تُعاد بعد العودة ──
// (كانت محاولة واحدة: رفضُها بالانقطاع ترك المنتظر يلعب أمام خصم ألغى — ينتظر بنك وقته كاملاً)
async function duoAbortRetried() {
  const r = suite('الثنائي: إلغاء المباراة قبل بدئها ضاع بانقطاع قبل وصوله → يُعاد بعد العودة (المنتظر لا يبقى أمام غائب)');
  const W = await duoWorld(['A', 'B']);
  const { S, M, devs, room } = W;
  const { code } = await M.A.findRandomMatch(CFG, 'أحمد');
  let aLeft = null; M.A.onOpponentLeft(rm => { aLeft = rm; });
  await wait(200);
  const rb = await M.B.findRandomMatch(CFG, 'باسل');
  await wait(300);
  M.B.disarmDuoDisconnect(); await wait(100);             // (نعزل الإعادة عن أمر "انقطع الخصم" في الثنائي)
  const bConn = [...S.conns].at(-1);
  S.delayFor = (m, conn) => (conn === bConn && m.t === 'd' && m.d.a === 'p' && m.d.b.h !== undefined) ? 2000 : null;
  M.B._abortDuoMatch(code, 2, 'uB');                       // كما يفعل المنضمّ الذي ألغى بحثه بلحظة انضمامه
  await wait(100); devs.B.__off();                          // الكتابة لم تصل الخادم، وردّها لن يصل
  await wait(500); S.delayFor = null; devs.B.__on();
  await wait(1500);
  const rm = room(code) || {};
  r.ok(rb.role === 'guest' && rm.status === 'finished' && rm.abortedBy === 2, `الإلغاء اعتُمد بعد العودة (${rm.status}/${rm.abortedBy ?? '-'})`);
  r.ok(aLeft && aLeft.abortedBy === 2, 'والمنتظر يُبلَّغ: ألغى الخصم قبل أن تبدأ المباراة');
  W.S.close();
}

// ── 19ج) منضمّ ألغى بحثه (abortedBy: 2) والمنتظر يعيد فتح غرفته — ثم يلغي هو بلحظتها: لا تعود "تنتظر" بعد مغادرته ──
// (معاملة الإلغاء الأولى تقرأ ذاكرته "منتهية" — بدون حذفها أيضاً كانت تنتهي محلياً بلا كتابة، ثم تصل إعادة الفتح
//  فتبقى غرفة عامة تنتظر بلا صاحب)
async function duoCancelDuringReopen() {
  const r = suite('الثنائي: المنتظر يلغي أثناء إعادة فتح غرفته → تُحذف (لا تعود "تنتظر" بعد مغادرته)');
  const W = await duoWorld(['A']);
  const { S, M, room } = W;
  const { code } = await M.A.findRandomMatch(CFG, 'أحمد');
  await wait(300);
  const aConn = [...S.conns].at(-1);
  S.delayFor = (m, conn) => (conn === aConn && m.t === 'd' && m.d.a === 'p') ? 300 : null;   // بترتيبها، ببطء
  const rm0 = room(code);
  S.setAt('rooms/' + code, { ...rm0, status: 'finished', abortedBy: 2, p2uid: 'uX', p2name: 'زائر', public: false });
  S.broadcast('rooms/' + code);                             // منضمّ ألغى بحثه بلحظة انضمامه
  await wait(50);                                           // أُرسلت إعادة الفتح، والخادم لم يعالجها بعد
  M.A.cancelRandomMatch();                                  // يلغي وإعادة الفتح في الطريق
  await wait(1500);
  const rm = room(code);
  r.ok(rm == null, `الغرفة حُذفت (${rm ? rm.status + '/عامة=' + rm.public : 'محذوفة'})`);
  r.ok(!Object.values(W.rooms()).some(x => x && x.p1uid === 'uA' && x.status === 'waiting'), 'لا غرفة تنتظر باسمه بعد مغادرته');
  W.S.close();
}

// ── 20) انقطاع لحظي للمنتظر (قديم، كُشف أثناء إصلاحات المراجعة): الخادم ينفّذ أمر المسح فتختفي غرفته وهو ينتظر ──
// (كان ينتظر للأبد في غرفة لا يراها أحد: الباحث التالي ينشئ غرفته، وصديق الكود يرى "الغرفة غير موجودة!")
async function duoHostBlipRestores() {
  const r = suite('الثنائي: انقطاع لحظي للمنتظر → تعود غرفته كما كانت (عشوائية وبالكود) ويدخلها الخصم');
  for (const kind of ['random', 'code']) {
    const W = await duoWorld(['A', 'B']);
    const { S, M, devs, room } = W;
    const code = kind === 'random' ? (await M.A.findRandomMatch(CFG, 'أحمد')).code : await M.A.createRoom(CFG, 'أحمد');
    let started = false; M.A.onOpponentJoined(() => { started = true; });
    await wait(300);
    devs.A.__off(); await wait(300);
    const goneAtServer = room(code) == null;              // الخادم نفّذ أمر المسح عند السقوط
    devs.A.__on(); await wait(1500);
    const rm = room(code) || {};
    const ops = [...S.conns].reduce((n, c) => n + c.ondisc.filter(o => String(o.p).includes(code)).length, 0);
    const tag = kind === 'random' ? '(عشوائية) ' : '(بالكود) ';
    r.ok(goneAtServer && rm.status === 'waiting' && rm.p1uid === 'uA' && !rm.p2uid
      && (kind === 'code' || rm.public === true), tag + `اختفت عند السقوط ثم عادت تنتظر كما كانت (${rm.status || 'غير موجودة'})`);
    r.ok(ops >= 1, tag + `وأمر مسحها مسلّح على الاتصال الجديد (${ops})`);
    if (kind === 'random') {
      const rb = await M.B.findRandomMatch(CFG, 'باسل');
      r.ok(rb.role === 'guest' && rb.code === code, tag + `الباحث التالي يدخلها (${rb.role})`);
    } else {
      const res = await M.B.joinRoom(code, 'باسل').then(() => 'joined', e => String(e && e.message));
      r.ok(res === 'joined', tag + `صديق الكود يدخلها (${res})`);
    }
    await wait(400);
    r.ok(started && M.A._gameStarted === true, tag + 'وتبدأ مباراتهما عند المنتظر');
    W.S.close();
  }
}

// ── 21) (مراجعة v35.8 الثانية) المنتظر سقط اتصاله والخادم لم يلاحظ بعد، فدخل صديقه؛ ثم نفّذ الخادم أمر المسح (والصديق
// فيها)، وعاد المنتظر فأعاد غرفته "تنتظر" بلا خصم — الصديق يُبلَّغ ولا تمحو اللقطةُ اللاحقة ذلك ──
// (كانت لقطة الغرفة المُعادة تكتب "تنتظر" فوق "اختفت": يبني لوحة في غرفة ليس فيها، بلا ساعة ولا خصم، وخروجه
//  يُسجّل خسارة ويكتب "انسحب" في غرفة المنتظر فيعلق هو الآخر)
async function duoRestoreKeepsGuestOut() {
  const r = suite('الثنائي: غرفة أعادها منتظر بعد سقوطه بلحظة انضمام صديقه → الصديق يُبلَّغ "غادر الخصم قبل أن تبدأ" ولا يُمحى ذلك');
  for (const kind of ['code', 'random']) {
    const W = await duoWorld(['A', 'B']);
    const { S, M, devs, room } = W;
    const code = kind === 'code' ? await M.A.createRoom(CFG, 'أحمد') : (await M.A.findRandomMatch(CFG, 'أحمد')).code;
    await wait(300);
    await M.B.getRoomType(code);                           // اتصال الصديق جاهز
    S.detectDelay = 500;                                   // الخادم يلاحظ سقوط المنتظر بعد نصف ثانية
    devs.A.__off(); await wait(100);
    const joined = kind === 'code'
      ? await M.B.joinRoom(code, 'باسل').then(() => 'joined', e => 'ERR ' + e.message)
      : ((await M.B.findRandomMatch(CFG, 'باسل')).code === code ? 'joined' : 'other');
    let left = null; M.B.onOpponentLeft(rm => { left = rm; });
    const seen = [];
    for (let t = 0; t < 30; t++) {                          // الواجهة تسأل lastRoom كل 100ms (كتحضير اللوحة)
      if (t === 8) devs.A.__on();                           // يعود المنتظر بعد أن نفّذ الخادم أمر المسح
      const lr = M.B.lastRoom(); seen.push(lr ? (lr.vanished ? 'V' : lr.status[0]) : '-');
      await wait(100);
    }
    const rm = room(code) || {};
    const lr = M.B.lastRoom() || {};
    const tag = kind === 'code' ? '(بالكود) ' : '(عشوائية) ';
    r.ok(joined === 'joined', tag + `الصديق دخل قبل أن يلاحظ الخادم سقوط المنتظر (${joined})`);
    r.ok(rm.status === 'waiting' && !rm.p2uid && M.A._stillHostingDuo(code), tag + `المنتظر أعاد غرفته تنتظر بلا خصم (${rm.status || '-'})`);
    r.ok(lr.status === 'finished' && lr.vanished === true, tag + `الصديق: "اختفت" باقية بعد عودة الغرفة (${seen.join('')})`);
    r.ok(left && left.vanished === true, tag + 'وبُلِّغ بها (لا يبني لوحة في غرفة ليس فيها)');
    W.S.close();
  }
  // ورد الانضمام تأخر حتى بعد أن أُعيدت الغرفة: أول لقطة يراها الصديق هي الغرفة المُعادة "تنتظر" بلا مقعده
  {
    const W = await duoWorld(['A', 'B']);
    const { S, M, devs, room } = W;
    const code = await M.A.createRoom(CFG, 'أحمد');
    await wait(300);
    await M.B.getRoomType(code);
    const bConn = [...S.conns].at(-1);
    S.detectDelay = 300;
    S.replyDelayFor = (m, conn) => (conn === bConn && m.t === 'd' && m.d.a === 'p' && m.d.b.h !== undefined
      && /"status":"playing"/.test(JSON.stringify(m.d.b.d || ''))) ? 700 : null;
    devs.A.__off(); await wait(50);
    const joining = M.B.joinRoom(code, 'باسل').then(() => 'joined', e => 'ERR ' + e.message);
    await wait(350); devs.A.__on();                          // عاد المنتظر وأعاد غرفته قبل أن يصل رد الانضمام
    const joined = await joining;
    let left = null; M.B.onOpponentLeft(rm => { left = rm; });
    await wait(1500);
    const rm = room(code) || {};
    const lr = M.B.lastRoom() || {};
    r.ok(joined === 'joined' && rm.status === 'waiting' && !rm.p2uid, `(رد متأخر) الغرفة مُعادة تنتظر، والصديق ظن أنه دخل (${joined}/${rm.status || '-'})`);
    r.ok(lr.vanished === true && left && left.vanished === true, `(رد متأخر) أول لقطة بلا مقعده = "اختفت"، وبُلِّغ (${lr.status || '-'}/${lr.vanished ? 'V' : '-'})`);
    W.S.close();
  }
}

// ── 22) (مراجعة v35.8 الثالثة) الصديق المطرود أغلق صفحته قبل أن تُظهر الواجهة الرسالة: أمر "انتهت + انقطع" المسلّح
// على الغرفة كان يُكتب فوق غرفة المنتظر المُعادة — فتصير "منتهية" وهو ينتظر، ولا يدخلها أحد ──
async function duoEvictedGuestOp() {
  const r = suite('الثنائي: الصديق المطرود يغلق صفحته فوراً → غرفة المنتظر تبقى تنتظر (لا "منتهية" شاردة) ويدخلها غيره');
  const W = await duoWorld(['A', 'B', 'C']);
  const { S, M, devs, room } = W;
  const code = await M.A.createRoom(CFG, 'أحمد');
  await wait(300);
  const aConn = [...S.conns].at(-1);
  S.detectDelay = c => (c === aConn ? 1500 : 0);          // الخادم يلاحظ سقوط المنتظر متأخراً، والصديق فوراً
  await M.B.getRoomType(code);
  devs.A.__off(); await wait(100);
  const joined = await M.B.joinRoom(code, 'باسل').then(() => 'joined', e => 'ERR ' + e.message);
  await wait(1500);                                       // الخادم مسح الغرفة (والصديق فيها)
  devs.A.__on(); await wait(600);                         // المنتظر عاد وأعادها
  const lr = M.B.lastRoom() || {};
  devs.B.__off(); await wait(900);                        // أُغلقت صفحة الصديق قبل رسالة الواجهة
  const rm = room(code) || {};
  r.ok(joined === 'joined' && lr.vanished === true, `الصديق دخل ثم طُرد ("اختفت") (${joined})`);
  r.ok(rm.status === 'waiting' && !rm.p2uid && rm.dropped2 == null && M.A._stillHostingDuo(code),
    `غرفة المنتظر ما زالت تنتظر بلا علامات شاردة (${rm.status || '-'}${rm.dropped2 ? '/dropped2' : ''})`);
  const res = await M.C.joinRoom(code, 'كريم').then(() => 'joined', e => 'ERR ' + e.message);
  await wait(300);
  r.ok(res === 'joined' && M.A._gameStarted === true, `ويدخلها غيره وتبدأ مباراتهما (${res})`);
  W.S.close();
}

// ── 23) (مراجعة v35.8 الرابعة) صديقٌ انضمّ ثم سقط اتصاله بصمت (لا يصله مسح الغرفة فلا يُلغي أمره): الخادم مسح غرفة
// المنتظر عند سقوطه، ثم نفّذ أمر الصديق "انتهت + انقطع" فأنشأ عقدة بقايا بلا صاحب — كان المنتظر يعود فيجدها
// "موجودة" فلا يعيد غرفته، وينتظر للأبد في غرفة لا يدخلها أحد (الباحث التالي ينشئ غرفته بدل أن يدخلها) ──
async function duoOrphanNodeRestores() {
  const r = suite('الثنائي: أمر انقطاع صديقٍ سقط بصمت أنشأ بقايا بعد مسح غرفة المنتظر → المنتظر يعيد غرفته فوقها ويدخلها غيره');
  const W = await duoWorld(['A', 'B', 'C']);
  const { S, M, devs, room } = W;
  const { code } = await M.A.findRandomMatch(CFG, 'أحمد');
  await wait(300);
  const aConn = [...S.conns].at(-1);
  await M.B.getRoomType(code);                              // اتصال الصديق جاهز
  const bConn = [...S.conns].at(-1);
  S.detectDelay = c => (c === aConn ? 1500 : c === bConn ? 2600 : 0);   // الخادم يلاحظ السقوطين متأخراً
  devs.A.__off(); await wait(100);
  const rb = await M.B.findRandomMatch(CFG, 'باسل');       // دخل قبل أن يلاحظ الخادم سقوط المنتظر
  await wait(60);                                           // وصل الخادمَ أمرُ انقطاعه
  devs.B.__off();                                           // ثم سقط اتصاله بصمت: لا يرى المسح فلا يُلغي أمره
  await wait(3400);                                         // مسح الغرفة (~1.5ث) ثم أمر الصديق (~2.6ث بعد سقوطه)
  const junk = room(code) || null;
  devs.A.__on(); await wait(2000);
  const rm = room(code) || {};
  r.ok(rb.role === 'guest' && rb.code === code, `الصديق دخل غرفة المنتظر (${rb.role})`);
  r.ok(junk && !junk.p1uid && junk.status === 'finished', `قبل عودة المنتظر: بقايا بلا صاحب مكان غرفته (${JSON.stringify(junk)})`);
  r.ok(rm.status === 'waiting' && rm.p1uid === 'uA' && !rm.p2uid && rm.dropped2 == null && rm.public === true
    && M.A._stillHostingDuo(code), `عاد فأعاد غرفته فوقها تنتظر كما كانت (${rm.status || '-'}${rm.dropped2 ? '/dropped2' : ''})`);
  const rc = await M.C.findRandomMatch(CFG, 'كريم');
  await wait(400);
  r.ok(rc.role === 'guest' && rc.code === code && M.A._gameStarted === true, `والباحث التالي يدخلها وتبدأ مباراتهما (${rc.role})`);
  W.S.close();
}

// ── 24) (مراجعة v35.8 الرابعة) المنتظر يلغي وغرفته "منتهية" بلا خصم (كتابة شاردة) أو حلّت مكانها بقايا بلا صاحب →
// تُحذف مع إلغائه (كانت تبقى غرفة منتهية حتى يمسحها منظّف الغرف) ──
async function duoCancelStrayFinished() {
  const r = suite('الثنائي: المنتظر يلغي وغرفته "منتهية" بكتابة شاردة أو بقايا بلا صاحب → تُحذف (لا بقايا بعده)');
  for (const kind of ['stray', 'orphan']) {
    const W = await duoWorld(['A']);
    const { S, M, room } = W;
    const { code } = await M.A.findRandomMatch(CFG, 'أحمد');
    await wait(300);
    const aConn = [...S.conns].at(-1);
    S.delayFor = (m, conn) => (conn === aConn && m.t === 'd' && m.d.a === 'p') ? 300 : null;   // إعادة الفتح/الإعادة بطيئة
    const rm0 = room(code);
    S.setAt('rooms/' + code, kind === 'stray' ? { ...rm0, status: 'finished', dropped2: true }
                                              : { status: 'finished', dropped2: true });
    S.broadcast('rooms/' + code);
    await wait(50);                                         // إعادة الفتح (أو الإعادة) أُرسلت ولم تُعالَج بعد
    M.A.cancelRandomMatch();
    await wait(1500);
    const rm = room(code);
    const tag = kind === 'stray' ? '("منتهية" بلا خصم) ' : '(بقايا بلا صاحب) ';
    r.ok(rm == null, tag + `حُذفت مع الإلغاء (${rm ? JSON.stringify(rm).slice(0, 80) : 'محذوفة'})`);
    W.S.close();
  }
}

// ── 25) دعوات الأصدقاء (v35.9 — الخطوة 1.8): الحذف المشروط بمعاملة في invite.js ──
// سحب الدعوة من خانة الصديق (لا مستمع عليها = ذاكرة باردة)، ومسح الدعوة/الرد عند صاحبه: يعمل بذاكرة باردة
// (المعاملة تسأل الخادم بدل أن تنتهي على null محلي)، ولا يمسّ دعوة أو ردّاً غير المقصود (أحدث، أو لغيره)
async function inviteConditionalRemovals() {
  const r = suite('الدعوات: سحب الدعوة ومسحها ومسح الرد — بذاكرة باردة، ولا تمسّ غير المقصود');
  const S = new FakeRTDB(); const port = await S.listen();
  const I = {};
  for (const d of ['A', 'B', 'C']) I[d] = await import(pathToFileURL(genInvite(d, port)).href);
  const cfg = { rows: 4, cols: 4 };
  // (أ) أحمد يسحب دعوته من خانة باسل ولا يستمع لها
  await I.A.sendGameInvite('uB', '111111', cfg);
  await I.A.withdrawInvite('uB', '111111');
  await wait(150);
  r.ok(S.getAt('invites/uB') == null, `(أ) السحب بذاكرة باردة نجح (${JSON.stringify(S.getAt('invites/uB'))})`);
  // (ب) لا يسحب دعوة غيره حلّت مكان دعوته
  await I.A.sendGameInvite('uB', '222222', cfg);
  await wait(5);
  await I.C.sendGameInvite('uB', '333333', cfg);
  await I.A.withdrawInvite('uB', '222222');
  await wait(150);
  r.ok(S.getAt('invites/uB')?.fromUid === 'uC', '(ب) سحب أحمد لم يمسّ دعوة كريم التي حلّت مكان دعوته');
  // (ج) المستلم يمسح الدعوة نفسها فقط (لا نسخة أحدث أعاد صاحبها إرسالها)
  let seen = null; const un = I.B.listenForInvites(v => { seen = v; });
  await wait(150);
  const inv1 = seen;
  await wait(5);
  await I.C.sendGameInvite('uB', '333333', cfg);
  await wait(150);
  await I.B.clearInviteIf(inv1);
  await wait(150);
  const now = S.getAt('invites/uB');
  r.ok(inv1 && now && now.roomCode === '333333' && now.sentAt !== inv1.sentAt, '(ج) مسح نسخة قديمة لم يمسح الأحدث');
  await I.B.clearInviteIf(seen);
  await wait(150);
  r.ok(S.getAt('invites/uB') == null, '(ج) ومسح الدعوة نفسها نجح');
  un();
  // (د) الرد: صاحب الدعوة يمسحه بذاكرة باردة، ولا يمسح ردّاً أحدث
  I.B.replyToInvite({ fromUid: 'uA', roomCode: '444444', sentAt: 1 }, 'rejected');
  await wait(150);
  const rep1 = S.getAt('inviteRejections/uA');
  await I.A.removeInviteReply(rep1);
  await wait(150);
  r.ok(rep1 && rep1.roomCode === '444444' && rep1.reason === 'rejected' && S.getAt('inviteRejections/uA') == null,
    '(د) الرد يحمل رمز الغرفة وسببه، ومسحه بذاكرة باردة نجح');
  I.B.replyToInvite({ fromUid: 'uA', roomCode: '555555', sentAt: 1 }, 'rejected');
  await wait(150);
  const rep2 = S.getAt('inviteRejections/uA');
  await wait(5);
  I.C.replyToInvite({ fromUid: 'uA', roomCode: '666666', sentAt: 1 }, 'playing');
  await wait(150);
  await I.A.removeInviteReply(rep2);
  await wait(150);
  r.ok(S.getAt('inviteRejections/uA')?.roomCode === '666666', '(د) مسح ردّ قديم لم يمسح الأحدث');
  S.close();
}

// وسيط TCP يضيف تأخيراً ثابتاً في الاتجاهين (زمن الرحلة)، ومدة تجهيز قبل أول بايت (DNS + TCP + TLS) — لنمذجة الجوال
function latencyProxy(targetPort, oneWayMs, setupMs = 0) {
  const srv = net.createServer(c => {
    const s = net.connect(targetPort, 'localhost');
    const t0 = Date.now();
    const pipe = (from, to) => from.on('data', d => setTimeout(() => { if (!to.destroyed) to.write(d); }, Math.max(oneWayMs, setupMs - (Date.now() - t0) + oneWayMs)));
    pipe(c, s); pipe(s, c);
    c.on('error', () => {}); s.on('error', () => {});
    c.on('close', () => s.destroy()); s.on('close', () => c.destroy());
  });
  return new Promise(r => srv.listen(0, () => r({ port: srv.address().port, close: () => srv.close() })));
}

// v36.0 (الخطوة 1.11، مراجعة 1.11 الثالثة): التسجيل بإيميل بـ auth.js الحقيقي والحزمة الحقيقية على شبكات بأزمنة مختلفة.
// أول دخول = اتصال بارد (لا طلبات قبله)؛ والحزمة ترسل الكتابات المعلّقة قبل القراءات المعلّقة عند الاتصال، فكتابة
// الاسم وحده بعد updateProfile كانت تسبق قراءة "هل الملف موجود؟" فيبقى الملف ناقصاً بلا uid (لا يصله طلب صداقة).
// المطلوب في كل الأزمنة: ملف كامل (uid/joinedAt/stats) واسمه ما كتبه — لا "لاعب".
async function registrationProfile() {
  const r = suite('التسجيل بإيميل (auth.js الحقيقي): ملف كامل باسمه على كل شبكة — بارد/دافئ، جوال/مكتب');
  const profiles = [
    ['آلية: الاسم يصل فور القراءات', { warm: false, oneWayMs: 5, setupMs: 0, upd: 0 }],
    ['4G: رحلة 80، تجهيز 220، الاسم 230', { warm: false, oneWayMs: 40, setupMs: 220, upd: 230 }],
    ['3G: رحلة 200، تجهيز 550، الاسم 400', { warm: false, oneWayMs: 100, setupMs: 550, upd: 400 }],
    ['مكتب: رحلة 30، تجهيز 80، الاسم 180', { warm: false, oneWayMs: 15, setupMs: 80, upd: 180 }],
    ['اتصال دافئ، 4G', { warm: true, oneWayMs: 40, setupMs: 220, upd: 230 }],
    ['اتصال دافئ، قراءات سريعة، الاسم بطيء 600', { warm: true, oneWayMs: 5, setupMs: 0, upd: 600 }],
  ];
  let i = 0;
  for (const [label, p] of profiles) {
    const S = new FakeRTDB(); const port = await S.listen();
    const P = await latencyProxy(port, p.oneWayMs, p.setupMs);
    const A = await import(pathToFileURL(genAuth('R' + (++i), P.port)).href);
    A.onUserChange(() => {}); A.onUserChange(() => {});          // كالتطبيق: main.js وpresence.js
    await wait(20);
    if (p.warm) await A.getUserProfile('warmup');               // شيء فتح الاتصال قبل التسجيل
    globalThis.__UPDATE_PROFILE_MS = p.upd;
    const email = `sara${i}@x.com`, uid = 'uid_' + email.replace(/\W/g, '_');
    await A.registerWithEmail('سارة', email, 'Aa1!aaaa');
    await wait(Math.max(600, 4 * (2 * p.oneWayMs) + p.setupMs + 200));
    const prof = S.getAt(`users/${uid}`) || {};
    r.ok(prof.uid === uid && prof.joinedAt > 0 && !!prof.stats, `${label}: الملف ناقص [${Object.keys(prof).sort().join(', ')}]`);
    r.ok(prof.name === 'سارة', `${label}: الاسم ${JSON.stringify(prof.name)} (المطلوب سارة)`);
    P.close(); S.close();
  }
  globalThis.__UPDATE_PROFILE_MS = 0;
}

const all = [offlineExitThenReconnect, blipDuringWithdraw, onlineExit, creatorStamp, timeoutDuringBlip,
  secondExitClick, dropBeforeStartAcks, quietLeaveDuringDrop, spectatorLeaveDuringDrop,
  duoTwoJoiners, duoHostCancelAlone, duoCancelAfterJoin, duoCancelJoinSimultaneous, duoCancelOffline,
  duoCodeTwoJoiners, duoHostGoneAtJoin,
  duoCancelThenClose, duoJoinAckLost, duoCodeJoinAckLost, duoCreateBlip, duoAbortRetried, duoCancelDuringReopen,
  duoHostBlipRestores, duoRestoreKeepsGuestOut, duoEvictedGuestOp, duoOrphanNodeRestores, duoCancelStrayFinished,
  inviteConditionalRemovals, registrationProfile];
// ONLY=اسم1,اسم2 npm test — تشغيل فحوص بعينها (للتطوير وفحص الطفرات)
const pick = process.env.ONLY ? all.filter(f => process.env.ONLY.split(',').includes(f.name)) : all;
console.log('\n🔬 firebase.js بحزمة Firebase الحقيقية');
for (const f of pick) {
  try { await f(); }
  catch (e) { const r = suite(f.name); r.ok(false, 'استثناء: ' + (e && (e.stack || e))); }
  const r = results[results.length - 1];
  console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.pass}/${r.pass + r.fail}`);
  r.notes.forEach(n => console.log('     ❌ ' + n));
}
const failed = results.filter(r => r.fail).length;
console.log(failed ? `❌ فشل ${failed} فحص` : '✅ كل فحوص الحزمة الحقيقية نجحت');
process.exit(failed ? 1 : 0);
