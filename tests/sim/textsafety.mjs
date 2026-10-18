// أمان النصوص في الأونلاين (v36.0 — الخطوة 1.10): onlineGame.js الحقيقي، والاسم الخبيث يكتبه لاعب في
// خانة الاسم (13 حرفاً — ضمن حدّ الخانة 16) أو مباشرة في الغرفة. نص البحث، قائمة التصويت، ولوبي الغرفة
// بالكود تُبنى بـ innerHTML — المطلوب: كل اسم/عدد من الغرفة يصل مُهرَّباً (يظهر حرفياً، لا يصير وسماً).
import { World, clock } from './harness.mjs';

const waitFor = async (w, cond, ms = 40000) => { for (let t = 0; t < ms && !cond(); t += 100) await w.run(100); return cond(); };
function suite(title) {
  const r = { title, pass: 0, fail: 0, known: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push('❌ ' + msg); } if (r.verbose) console.log((cond ? '  ✅ ' : '  ❌ ') + msg); };
  return r;
}

export const BAD = '<b class="xss">تجربة</b>';                                 // كما يُكتب في خانة الاسم
export const BAD_ESC = '&lt;b class=&quot;xss&quot;&gt;تجربة&lt;/b&gt;';          // كما يجب أن يصل لـ innerHTML
const MAX_BAD = '<img src=x class="xss" onerror=alert(1)>';
const MAX_ESC = '&lt;img src=x class=&quot;xss&quot; onerror=alert(1)&gt;';
const raw = s => /<b class="xss">|<img[^>]*class="xss"/.test(s);               // وسم حقيقي = حقن
const short = s => String(s).replace(/\s+/g, ' ').slice(0, 140);

// ── 1) البحث الجماعي العشوائي: نص التجميع + قائمة التصويت ──
export async function namesInSearchAndVote(verbose = false) {
  const r = suite('البحث الجماعي: الاسم الخبيث نص في قائمة المنضمّين وفي التصويت'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client(BAD, { uid: 'uid_bad' }), B = await w.client('باسل'), C = await w.client('كريم');
  await A.startSearch(4); await w.run(2000);
  await B.startSearch(4); await w.run(1500);
  const tb = B.el('searching-text').innerHTML, ta = A.el('searching-text').innerHTML;
  r.ok(tb.includes(`✓ ${BAD_ESC}`) && !raw(tb), `قائمة المنضمّين عند ب: ${short(tb)}`);
  r.ok(ta.includes(`✓ ${BAD_ESC}`) && !raw(ta), `قائمة المنضمّين عند صاحب الاسم نفسه: ${short(ta)}`);
  r.ok(tb.includes('✓ باسل') && /انضم 2 من 4/.test(tb), `الاسم العادي والعدد كما هما: ${short(tb)}`);
  await C.startSearch(4);
  r.ok(await waitFor(w, () => A.approvalVisible() && B.approvalVisible() && C.approvalVisible(), 30000), 'التصويت ظهر للثلاثة');
  const ap = C.el('approval-players').innerHTML;
  r.ok(ap.includes(`<span>${BAD_ESC}</span>`) && !raw(ap), `قائمة التصويت عند ج: ${short(ap)}`);
  r.ok(ap.includes('<span>باسل</span>') && ap.includes('<span>كريم</span>'), 'الأسماء العادية في التصويت كما هي');
  // المباراة تبدأ عادياً بالاسم الخبيث (لا شيء انكسر)
  A.accept(); await w.run(300); B.accept(); await w.run(300); C.accept();
  r.ok(await waitFor(w, () => A.matches.length && B.matches.length && C.matches.length, 15000), 'المباراة بدأت للثلاثة');
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 2) الغرفة بالكود (جماعي): قائمة اللوبي ──
export async function namesInCodeLobby(verbose = false) {
  const r = suite('الغرفة بالكود: الاسم الخبيث نص في قائمة اللوبي عند الجميع'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client(BAD, { uid: 'uid_bad' });
  A.createCodeRoom(3);
  r.ok(await waitFor(w, () => /^[A-Z0-9]{4,}$/.test(A.codeShown()), 5000), `ظهر رمز الغرفة: ${A.codeShown()}`);
  B.joinCode(A.codeShown());
  r.ok(await waitFor(w, () => A.lobbyList().length === 2 && B.lobbyList().length === 2, 8000), 'اللوبي فيه اثنان عند الاثنين');
  const la = A.el('multi-players-list').children.map(c => c.innerHTML).join(' '), lb = B.el('multi-players-list').children.map(c => c.innerHTML).join(' ');
  r.ok(la.includes(`<span class="mp-name">${BAD_ESC}</span>`) && !raw(la), `لوبي المضيف: ${short(la)}`);
  r.ok(lb.includes(`<span class="mp-name">${BAD_ESC}</span>`) && !raw(lb), `لوبي صاحب الاسم: ${short(lb)}`);
  r.ok(A.lobbyList().some(p => p.num === 1 && p.name === 'أحمد' && p.host), 'المضيف ورقمه وتاجه كما هم');
  r.ok(A.startBtnVisible(), 'زر البدء ظاهر للمضيف (لا شيء انكسر)');
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}

// ── 3) "من N" يأتي من الغرفة (maxPlayers يكتبه منشئها): مُهرَّب في نص التجميع ورسالة المغادرة ──
export async function roomMaxIsText(verbose = false) {
  const r = suite('عدد اللاعبين من الغرفة (يكتبه منشئها) نص في التجميع ورسالة "غادر بقية اللاعبين"'); r.verbose = verbose;
  const w = new World(); w.quiet = true; w.startSampler(100);
  const A = await w.client('أحمد'), B = await w.client('باسل'), C = await w.client('كريم');
  await A.startSearch(4); await w.run(2000);
  await B.startSearch(4); await w.run(1500);
  const code = A.om.roomCode;
  r.ok(!!code && B.om.roomCode === code, 'الاثنان في غرفة البحث نفسها');
  // (أ) منشئ خبيث يكتب maxPlayers نصاً: يصل مع أي تحديث للغرفة
  w.server.setAt(`rooms/${code}/maxPlayers`, MAX_BAD); w.server.notify(); await w.run(800);
  const t = A.el('searching-text').innerHTML;
  r.ok(t.includes(`من ${MAX_ESC}`) && !raw(t), `نص التجميع: ${short(t)}`);
  // (ب) تصويت ثم يغادر الباقون → "غادر بقية اللاعبين — 👥 1 من N" عند الباقي
  w.server.setAt(`rooms/${code}/maxPlayers`, 4); w.server.notify(); await w.run(300);
  await C.startSearch(4);
  r.ok(await waitFor(w, () => A.approvalVisible() && B.approvalVisible() && C.approvalVisible(), 30000), 'التصويت ظهر للثلاثة');
  w.server.setAt(`rooms/${code}/maxPlayers`, MAX_BAD); w.server.notify(); await w.run(300);
  B.closeTab(); C.closeTab();          // يغادر الاثنان معاً والتصويت مفتوح عند أ
  r.ok(await waitFor(w, () => /غادر بقية اللاعبين/.test(A.el('searching-text').innerHTML), 8000), 'رسالة "غادر بقية اللاعبين" ظهرت');
  const m = A.el('searching-text').innerHTML;
  r.ok(m.includes(`1 من ${MAX_ESC}`) && !raw(m), `رسالة المغادرة: ${short(m)}`);
  r.ok(w.errors.length === 0, 'بلا أخطاء JS' + (w.errors[0] ? ': ' + w.errors[0].slice(0, 150) : ''));
  w.dispose(); return r;
}
