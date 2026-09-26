// 🔬 فحوص firebase.js بحزمة Firebase الحقيقية (10.12.0، نفس نسخة الموقع) فوق خادم وهمي محلي.
// المحاكي (tests/sim) يختبر منطق اللعبة كله لكن بقاعدة بيانات مبسّطة؛ هنا نختبر ما لا يراه:
// سلوك الحزمة الداخلي — المعاملة تُلغى بكتابة محلية على مسارها أو بتطبيق أوامر الانقطاع محلياً لحظة
// الانقطاع، والإلغاء على مسار يشمل ما تحته، والكتابات تنتظر عودة الشبكة. (أُضيفت في مراجعة v35.7 الثانية)
// التشغيل: cd tests/realsdk && npm install && npm test
// فحص الطفرات: JAZAM_FIREBASE_JS=<نسخة قديمة من firebase.js> npm test  (يجب أن تفشل)
import { pathToFileURL } from 'node:url';
import { FakeRTDB } from './fakertdb.mjs';
import { gen } from './gen.mjs';

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

const all = [offlineExitThenReconnect, blipDuringWithdraw, onlineExit, creatorStamp, timeoutDuringBlip,
  secondExitClick, dropBeforeStartAcks, quietLeaveDuringDrop, spectatorLeaveDuringDrop];
console.log('\n🔬 firebase.js بحزمة Firebase الحقيقية');
for (const f of all) {
  try { await f(); }
  catch (e) { const r = suite(f.name); r.ok(false, 'استثناء: ' + (e && (e.stack || e))); }
  const r = results[results.length - 1];
  console.log(`${r.fail ? '❌' : '✅'} ${r.name} — ${r.pass}/${r.pass + r.fail}`);
  r.notes.forEach(n => console.log('     ❌ ' + n));
}
const failed = results.filter(r => r.fail).length;
console.log(failed ? `❌ فشل ${failed} فحص` : '✅ كل فحوص الحزمة الحقيقية نجحت');
process.exit(failed ? 1 : 0);
