// قواعد الأمان نفسها التي تُنشر (database.rules.json) — ما تسمح به وما ترفضه (v36.1 — الخطوة 1.13)
// كل سطر سلوكٌ مقصود: أي تعديل على القواعد يكسر سطراً هنا قبل أن يصل الإنتاج.
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT } from './harness.mjs';
import { checkWrite, canRead } from '../shared/rulesEngine.mjs';

const load = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export const RULES_FILE = path.join(PROJECT, 'database.rules.json');

function checker(title) {
  const r = { title, pass: 0, fail: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push('❌ ' + msg); } };
  return r;
}

export function rulesMatrix() {
  const r = checker('قواعد الأمان المنشورة: كل واحد يكتب في ملفه، وفي ملف غيره ما يخصّه فقط (1.13)');
  let NEW, OLD;
  try { NEW = load(RULES_FILE); } catch (e) { r.ok(false, 'database.rules.json غير موجود أو ليس JSON سليماً: ' + e.message); return r; }
  OLD = load(new URL('../shared/rules_prod_2026-10-19.json', import.meta.url));
  const base = { users: {
    A: { name: 'أ', friends: { B: { uid: 'B', name: 'ب' } } },
    B: { name: 'ب', friends: { A: { uid: 'A', name: 'أ' } } },
    V: { name: 'ضحية' },
  } };
  const W = (rules, uid, writes, root = base) => checkWrite(rules, writes, { uid, root }).ok;
  // 3.3ج-2: الطلب ودليله بوقت الخادم (SV = serverTimestamp كما يكتبه الكود)، والدليل يصلح 30 يوماً
  const SV = { '.sv': 'timestamp' };
  const REQ = (extra = {}) => ({ name: 'أ', sentAt: SV, ...extra });
  const withToken = JSON.parse(JSON.stringify(base)); withToken.users.B.sentRequests = { A: Date.now() - 60_000 };
  // ملفي
  r.ok(W(NEW, 'A', [['users/A/xp', 5]]), 'لا أكتب في ملفي');
  r.ok(!W(NEW, 'A', [['users/B/xp', 5]]), 'أكتب في ملف غيري');
  r.ok(!W(NEW, 'A', [['users/B', { name: 'x' }]]), 'أستبدل ملف غيري كاملاً');
  // طلب الصداقة
  r.ok(W(NEW, 'A', [['users/B/friendRequests/A', REQ()], ['users/A/sentRequests/B', SV]]), 'طلب صداقة (الصندوق + دليلي) مرفوض');
  r.ok(!W(NEW, 'A', [['users/B/friendRequests/C', REQ({ name: 'ج' })], ['users/C/sentRequests/B', SV]]), 'أكتب طلباً باسم غيري');
  r.ok(!W(NEW, 'A', [['users/B/sentRequests/A', SV]]), 'أكتب دليل طلب في ملف غيري');
  r.ok(W(NEW, 'A', [['users/B/friendRequests/A', null]]), 'سحب طلب غير موجود (كما يكتبه حذف صديق بلا طلب قائم) رُفض');
  // الطلب لا يُقبل إلا ومعه دليله في ملف مرسله بالكتابة نفسها (نسخة أقدم مفتوحة بعد نشر القواعد كانت تُنشئ طلباً بلا
  // دليل، فيصنع قبولُها بنسختها صداقةً من طرف واحد — مراجعة v36.1)، ولمستخدم موجود فقط (لا عُقد بأي مفتاح)
  r.ok(!W(NEW, 'A', [['users/B/friendRequests/A', REQ()]]), 'طلب بلا دليل (كما تكتبه نسخة أقدم) قُبل');
  r.ok(!W(NEW, 'A', [['users/Z9/friendRequests/A', REQ()], ['users/A/sentRequests/Z9', SV]]), 'طلب لمفتاح لا مستخدم له أنشأ عقدة جديدة');
  const withReqOld = JSON.parse(JSON.stringify(base)); withReqOld.users.B.friendRequests = { A: { name: 'أ', sentAt: 5 } };
  r.ok(!W(NEW, 'A', [['users/B/friendRequests/A/name', 'أ2'], ['users/A/sentRequests/B', SV]], withReqOld), 'تعديل حقل في طلب قائم قُبل (الطلب يُكتب كاملاً بوقته — 3.3ج-2)');
  // كتابة على مستوى الأب أو حقل داخل مدخل غيري
  r.ok(!W(NEW, 'A', [['users/B/friends', { A: { uid: 'A', name: 'أ' } }]], withToken) && !W(NEW, 'A', [['users/B/friendRequests', { A: REQ() }], ['users/A/sentRequests/B', SV]]),
    'كتابة قائمة أصدقاء غيري أو صندوقه كاملاً');
  r.ok(W(NEW, 'A', [['users/B/friends/A/name', 'أ2']], withToken) && !W(NEW, 'A', [['users/B/friends/A/name', 'أ2']]),
    'تعديل حقل مدخلي في قائمة غيري: يتبع الدليل نفسه');
  r.ok(!W(NEW, 'A', [['users/B/friends/V/name', 'x']], withToken), 'تعديل مدخل غيري في قائمة أحد');
  // القبول: إضافة نفسي لقائمة من أرسل لي — بدليله في ملفه فقط
  r.ok(W(NEW, 'A', [['users/A/friends/B', { uid: 'B', name: 'ب' }], ['users/B/friends/A', { uid: 'A', name: 'أ' }], ['users/A/friendRequests/B', null]], withToken),
    'قبول طلب له دليل في ملف مرسله مرفوض');
  r.ok(!W(NEW, 'A', [['users/B/friends/A', { uid: 'A', name: 'أ' }]]), 'أضيف نفسي لقائمة من لم يرسل لي');
  const forged = JSON.parse(JSON.stringify(base)); forged.users.A.friendRequests = { V: { name: 'ضحية' } };
  r.ok(!W(NEW, 'A', [['users/V/friends/A', { uid: 'A', name: 'أ' }]], forged), 'طلب مزوَّر في صندوقي يدخلني قائمة غيري');
  r.ok(!W(NEW, 'A', [['users/B/friends/C', { uid: 'C', name: 'ج' }]], withToken), 'أضيف غيري لقائمة أحد');
  // الدليل لمرة واحدة: المستقبل يحذفه (يستهلكه بالقبول أو الرفض) ولا يكتبه، ولا يمسّه غيره
  r.ok(W(NEW, 'A', [['users/B/sentRequests/A', null]], withToken), 'المستقبل لا يستطيع حذف دليل الطلب إليه (استهلاكه)');
  r.ok(!W(NEW, 'A', [['users/B/sentRequests/A', 2]], withToken) && !W(NEW, 'A', [['users/B/sentRequests/C', null]], withToken),
    'المستقبل يعدّل دليلاً أو يحذف دليلاً ليس له');
  const accept = checkWrite(NEW, [['users/A/friends/B', { uid: 'B', name: 'ب' }], ['users/B/friends/A', { uid: 'A', name: 'أ' }],
    ['users/A/friendRequests/B', null], ['users/B/sentRequests/A', null]], { uid: 'A', root: withToken });
  r.ok(accept.ok && accept.newRoot.users.B.sentRequests == null, 'القبول مع استهلاك الدليل بكتابة واحدة مرفوض');
  const removed = accept.ok ? checkWrite(NEW, [['users/A/friends/B', null], ['users/B/friends/A', null]], { uid: 'A', root: accept.newRoot }) : { ok: false };
  r.ok(removed.ok && !W(NEW, 'A', [['users/B/friends/A', { uid: 'A', name: 'أ' }]], removed.newRoot),
    'بعد القبول ثم الحذف: يعيد نفسه لقائمة المرسل بالدليل القديم (لم يُستهلك)');
  // الحذف: أزيل نفسي من قائمة صديقي، وكل شيء بكتابة واحدة
  r.ok(W(NEW, 'A', [['users/A/friends/B', null], ['users/B/friends/A', null], ['users/B/friendRequests/A', null], ['users/A/sentRequests/B', null]]),
    'الحذف من الطرفين (مع سحب طلبي إليه) مرفوض');
  r.ok(!W(NEW, 'A', [['users/B/friends/V', null]]), 'أحذف غيري من قائمة أحد');
  r.ok(!W(NEW, 'A', [['users/A/friends/B', null], ['users/B/xp', 0]]), 'كتابة متعددة فيها مسار مرفوض تمرّ (يجب أن تُرفض كلها)');
  // بلا دخول: لا شيء
  r.ok(!W(NEW, null, [['users/A/xp', 1]]) && !W(NEW, null, [['rooms/1', { a: 1 }]]) && !canRead(NEW, 'users', { uid: null }), 'زائر بلا دخول يقرأ أو يكتب');
  // ── 3.3أ (الخصوصية): من يقرأ ماذا ──────────────────────────────────
  const R = (rules, uid, p, root = base) => canRead(rules, p, { uid, root });
  // الملف العام profiles: يقرؤه كل مسجّل، ويكتبه صاحبه فقط
  r.ok(R(NEW, 'A', 'profiles') && R(NEW, 'A', 'profiles/B') && R(NEW, 'B', 'profiles/A'), 'الملف العام profiles لا يقرؤه كل مسجّل');
  r.ok(!R(NEW, null, 'profiles/A') && !R(NEW, null, 'profiles'), 'زائر بلا دخول يقرأ الملفات العامة');
  r.ok(W(NEW, 'A', [['profiles/A', { name: 'أ', xp: 0 }]]) && !W(NEW, 'A', [['profiles/B', { name: 'x' }]]), 'الملف العام: لا يكتبه إلا صاحبه');
  // الملف الكامل users لصاحبه وحده — لا الغير ولا الإيميل ولا الكل دفعة واحدة
  const withEmail = JSON.parse(JSON.stringify(base)); withEmail.users.B.email = 'b@x.com'; withEmail.users.A.email = 'a@x.com';
  r.ok(R(NEW, 'A', 'users/A', withEmail) && R(NEW, 'A', 'users/A/xp') && R(NEW, 'A', 'users/A/email', withEmail), 'لا أقرأ ملفي الكامل');
  r.ok(!R(NEW, 'A', 'users/B', withEmail) && !R(NEW, 'A', 'users/B/xp') && !R(NEW, 'A', 'users/B/email', withEmail), 'أقرأ ملف غيري أو إيميله');
  r.ok(!R(NEW, 'A', 'users'), 'أقرأ كل الملفات دفعة واحدة (users)');
  // الحضور: لأصدقاء صاحبه فقط (ب يحمل أ في قائمته، والضحية لا)، ولصاحبه
  const withPres = JSON.parse(JSON.stringify(base)); withPres.users.B.presence = { state: 'online' }; withPres.users.V.presence = { state: 'online' };
  r.ok(R(NEW, 'A', 'users/B/presence', withPres), 'الصديق لا يقرأ حضور صديقه');
  r.ok(R(NEW, 'B', 'users/B/presence', withPres), 'صاحبه لا يقرأ حضوره');
  r.ok(!R(NEW, 'A', 'users/V/presence', withPres), 'من ليس صديقاً يقرأ الحضور');
  r.ok(!R(NEW, null, 'users/B/presence', withPres), 'زائر بلا دخول يقرأ الحضور');
  // friends/<أنا> وsentRequests/<أنا>: يقرؤها الطرف المعني وحده (هل أنا صديقه؟ ودليل القبول) — لا القائمة/الصندوق كاملاً
  r.ok(R(NEW, 'A', 'users/B/friends/A', withToken), 'لا أقرأ مدخلي في قائمة من يُفترض صداقته');
  r.ok(!R(NEW, 'A', 'users/B/friends/V', withToken), 'أقرأ مدخل غيري في قائمة أحد');
  r.ok(R(NEW, 'A', 'users/B/sentRequests/A', withToken), 'لا أقرأ دليل الطلب الموجَّه إليّ');
  r.ok(!R(NEW, 'A', 'users/B/sentRequests/C', withToken), 'أقرأ دليلاً ليس إليّ');
  r.ok(!R(NEW, 'A', 'users/B/friends', withToken) && !R(NEW, 'A', 'users/B/sentRequests', withToken) && !R(NEW, 'A', 'users/B/friendRequests', withToken),
    'أقرأ قائمة أصدقاء غيري أو صندوق أدلته/طلباته كاملاً');
  // ── 3.3أ-2: الدعوة للأصدقاء + الحدود + إغلاق chatStatus ───────────────
  // ── 3.3ب-2: الغرف — لا يكتب فيها إلا لاعبوها؛ والمشاهد في خانته؛ والغريب: ينشئ، أو ينضم مضيفاً نفسه، أو ينظّف ──
  const T0 = 1_800_000_000_000;
  const duoWaiting = { cfg: { rows: 4, cols: 4 }, status: 'waiting', p1name: 'أ', p1uid: 'A', p2name: '', p2uid: '', createdAt: T0, move: { key: '', by: 0, seq: 0 } };
  const duoPlaying = { ...duoWaiting, status: 'playing', p2name: 'ب', p2uid: 'B', public: false };
  const lobby = { cfg: { rows: 4, cols: 4 }, status: 'lobby', multi: true, maxPlayers: 3, hostUid: 'A', players: { A: { name: 'أ', num: 1, active: true } },
    playerCount: 1, turn: 1, move: { key: '', by: 0, seq: 0 }, createdAt: T0 };
  const withRooms = (rooms) => { const b = JSON.parse(JSON.stringify(base)); b.rooms = JSON.parse(JSON.stringify(rooms)); return b; };
  const RW = (uid, writes, root, now = T0 + 60_000) => checkWrite(NEW, writes, { uid, root, now }).ok;
  const rooms0 = withRooms({ '111111': duoWaiting, '222222': duoPlaying, '333333': lobby });
  // القراءة (3.3ج-5ب): الغرفة برقمها لكل مسجّل (الانضمام والمشاهدة بالكود والدعوات) — وشجرة الغرف كلها لا أحد
  r.ok(!canRead(NEW, 'rooms', { uid: 'V', root: rooms0 }) && canRead(NEW, 'rooms/222222', { uid: 'V', root: rooms0 }),
    'شجرة الغرف كلها مقروءة (غرفة يملؤها أحدهم يُنزّلها الجميع)، أو الغرفة برقمها غير مقروءة لمسجّل');
  r.ok(!canRead(NEW, 'rooms', { uid: null, root: rooms0 }) && !RW(null, [['rooms/999999', duoWaiting]], rooms0), 'زائر بلا دخول يقرأ أو ينشئ غرفة');
  // الإنشاء: غرفتي أنا فقط (منشئها = أنا، تنتظر، بلا خصم) — لا فوق غرفة قائمة لغيري، ولا باسم غيري
  r.ok(RW('A', [['rooms/444444', duoWaiting]], rooms0) && RW('A', [['rooms/444444', { ...duoWaiting, public: true }]], rooms0), 'إنشاء غرفة ثنائية (بالكود/عامة) مرفوض');
  r.ok(RW('A', [['rooms/444444', lobby]], rooms0), 'إنشاء لوبي جماعي مرفوض');
  r.ok(!RW('V', [['rooms/222222', { ...duoWaiting, p1uid: 'V', p1name: 'ضحية' }]], rooms0) && !RW('V', [['rooms/333333', { ...lobby, hostUid: 'V', players: { V: { name: 'x', num: 1 } } }]], rooms0),
    'إنشاء فوق غرفة قائمة لغيري قُبل (رقم مكرّر يخرب مباراته)');
  r.ok(!RW('V', [['rooms/444444', duoWaiting]], rooms0) && !RW('V', [['rooms/444444', { ...duoWaiting, p1uid: 'V', p2uid: 'B', status: 'playing' }]], rooms0)
    && !RW('V', [['rooms/444444', { ...duoWaiting, p1uid: 'V', p2uid: 'B' }]], rooms0), 'إنشاء غرفة باسم غيري أو بخصم جاهز (ولو "تنتظر") قُبل');
  r.ok(RW('A', [['rooms/444444', null]], rooms0), 'أمر "امسح غرفتي عند الانقطاع" قبل إنشائها (حذف لا شيء) مرفوض — حماية v35.8 تضيع');
  // بقايا بلا صاحب (أمر انقطاع شارد بعد المسح): يُعاد إنشاء الغرفة فوقها، ويحذفها أي أحد
  const withOrphan = withRooms({ '555555': { status: 'finished', dropped2: true } });
  r.ok(RW('A', [['rooms/555555', duoWaiting]], withOrphan) && RW('V', [['rooms/555555', null]], withOrphan), 'عقدة بقايا: لا تُعاد الغرفة فوقها أو لا تُنظَّف');
  // الانضمام الثنائي: أضيف نفسي خصماً لغرفة تنتظر (كما تكتبه المعاملة: الغرفة كاملة)، لا غير
  const join = (uid) => ({ ...duoWaiting, p2name: 'ب', p2uid: uid, status: 'playing', public: false });
  r.ok(RW('B', [['rooms/111111', join('B')]], rooms0), 'انضمام ثنائي لغرفة تنتظر مرفوض');
  r.ok(!RW('V', [['rooms/222222', join('V')]], rooms0), 'انضمام لمباراة جارية (لها خصم) قُبل');
  r.ok(!RW('B', [['rooms/111111', join('C')]], rooms0), 'أضفتُ غيري خصماً قُبل');
  r.ok(!RW('B', [['rooms/111111', { ...join('B'), p1uid: 'B' }]], rooms0) && !RW('B', [['rooms/111111', { ...join('B'), cfg: { rows: 7, cols: 7 } }]], rooms0),
    'انضمام يغيّر المنشئ أو حجم اللوحة قُبل');
  r.ok(!RW('V', [['rooms/111111', null]], rooms0) && !RW('V', [['rooms/111111/status', 'finished']], rooms0) && !RW('V', [['rooms/222222/move', { key: 'x', by: 1, seq: 9 }]], rooms0),
    'غريب يحذف غرفة تنتظر أو ينهيها أو يحرّك في مباراة جارية');
  // الانضمام الجماعي: أضيف نفسي للوبي بمقعد ضمن الحد (كما تكتبه المعاملة)، دون تغيير مضيفه أو حدّه
  const ljoin = (uid, num = 2, extra = {}) => ({ ...lobby, players: { ...lobby.players, [uid]: { name: 'ب', num, active: true } }, playerCount: 2, ...extra });
  r.ok(RW('B', [['rooms/333333', ljoin('B')]], rooms0), 'انضمام للوبي جماعي مرفوض');
  r.ok(!RW('B', [['rooms/333333', ljoin('C')]], rooms0), 'أضفتُ غيري للوبي قُبل');
  r.ok(!RW('B', [['rooms/333333', ljoin('B', 2, { hostUid: 'B' })]], rooms0) && !RW('B', [['rooms/333333', ljoin('B', 2, { maxPlayers: 4 })]], rooms0)
    && !RW('B', [['rooms/333333', ljoin('B', 4)]], rooms0), 'انضمام يسرق المضيف أو يرفع الحد أو بمقعد خارجه قُبل');
  r.ok(!RW('B', [['rooms/333333', ljoin('B', 2, { status: 'playing' })]], rooms0), 'انضمام يبدأ المباراة قُبل');
  const lobbyStarted = withRooms({ '333333': { ...lobby, status: 'playing' } });
  r.ok(!RW('B', [['rooms/333333', ljoin('B', 2, { status: 'playing' })]], lobbyStarted) && !RW('B', [['rooms/333333', ljoin('B')]], lobbyStarted),
    'انضمام لمباراة جماعية بدأت (أو بإرجاعها "لوبي") قُبل');
  // ── 3.3ج-3: المنضمّ لا يمسّ غيره — ولا حقول مجهولة في الغرفة، وكل حقل بنوعه وحدّه ──
  // الثنائي: لا يغيّر اسم المنشئ، ولا يضيف مقاعد لوبي أو علامات نهاية (انسحاب/إلغاء/انقطاع) مع انضمامه
  r.ok(!RW('B', [['rooms/111111', { ...join('B'), p1name: 'مزوّر' }]], rooms0), 'انضمام ثنائي يغيّر اسم المنشئ قُبل');
  r.ok(!RW('B', [['rooms/111111', { ...join('B'), leftBy: 1 }]], rooms0) && !RW('B', [['rooms/111111', { ...join('B'), abortedBy: 1 }]], rooms0)
    && !RW('B', [['rooms/111111', { ...join('B'), dropped1: true }]], rooms0) && !RW('B', [['rooms/111111', { ...join('B'), players: { B: { name: 'ب', num: 1 } } }]], rooms0),
    'انضمام ثنائي ومعه علامة نهاية (انسحب/ألغى/انقطع المنشئ) أو مقاعد لوبي قُبل');
  r.ok(RW('B', [['rooms/111111', { ...join('B'), public: false }]], withRooms({ '111111': { ...duoWaiting, public: true } })), 'انضمام لغرفة عامة (تصير خاصة) رُفض');
  // الجماعي: مقعد المضيف يبقى باسمه ورقمه؛ ولا يغيّر المنضمّ مقعد غيره ولا يضيف مقعداً لغيره
  const lobby2 = { ...lobby, players: { ...lobby.players, C: { name: 'ج', num: 2, active: true } }, playerCount: 2 };
  const rooms2 = withRooms({ '333333': lobby2 });
  const ljoin2 = (players, extra = {}) => ({ ...lobby2, players: { ...lobby2.players, B: { name: 'ب', num: 3, active: true }, ...players }, playerCount: 3, ...extra });
  r.ok(RW('B', [['rooms/333333', ljoin2({})]], rooms2), 'انضمام للوبي فيه لاعبان مرفوض');
  r.ok(!RW('B', [['rooms/333333', ljoin2({ A: { name: 'مزوّر', num: 1, active: true } })]], rooms2) && !RW('B', [['rooms/333333', ljoin2({ A: { name: 'أ', num: 3, active: true } })]], rooms2),
    'المنضمّ غيّر اسم المضيف أو رقم مقعده');
  const noHost = ljoin2({}); delete noHost.players.A;
  r.ok(!RW('B', [['rooms/333333', noHost]], rooms2), 'المنضمّ أسقط المضيف من اللوبي');
  r.ok(!RW('B', [['rooms/333333', ljoin2({ C: { name: 'ج', num: 2, active: false } })]], rooms2) && !RW('B', [['rooms/333333', ljoin2({ C: { name: 'ج', num: 2, active: true, waiting: true } })]], rooms2)
    && !RW('B', [['rooms/333333', ljoin2({ C: { name: 'مزوّر', num: 2, active: true } })]], rooms2), 'المنضمّ غيّر مقعد لاعب آخر (أخرجه/علّقه/سمّاه)');
  r.ok(!RW('B', [['rooms/333333', ljoin2({ V: { name: 'وهمي', num: 4, active: true } }, { maxPlayers: 3 })]], rooms2), 'المنضمّ أضاف مقعداً لغيره');
  const hostGone = withRooms({ '333333': { ...lobby2, players: { C: { name: 'ج', num: 2, active: true } }, playerCount: 1, hostNum: 2 } });
  r.ok(RW('B', [['rooms/333333', { ...lobby2, players: { C: { name: 'ج', num: 2, active: true }, B: { name: 'ب', num: 1, active: true } }, playerCount: 2, hostNum: 2 }]], hostGone),
    'لوبي غادره مضيفه (المعرّف القديم باقٍ): الانضمام رُفض');
  // أعضاء الغرفة يكتبون مقاعد غيرهم كما يكتبها الكود: بدء المباراة يزيل "منتظر"، وإخراج من نفد وقته أو انقطع
  const playingMulti = withRooms({ '333333': { ...lobby2, status: 'playing', players: { A: { name: 'أ', num: 1, active: true }, C: { name: 'ج', num: 2, active: true, waiting: true } } } });
  r.ok(RW('A', [['rooms/333333/players/C', { name: 'ج', num: 2, active: true }]], playingMulti)
    && RW('A', [['rooms/333333/players/C', { name: 'ج', num: 2, active: false, outReason: 'timeout', outAt: T0 }]], playingMulti)
    && RW('C', [['rooms/333333/players/C/disconnectedAt', T0]], playingMulti), 'عضو لا يكتب مقعد غيره كما يكتبه الكود (بدء/إخراج) أو مقعده');
  // الحقول المعروفة فقط (حتى للأعضاء)، وكل حقل بنوعه وحدّه
  const m = (path, v, root = rooms0, uid = 'A') => RW(uid, [[`rooms/222222/${path}`, v]], root);
  r.ok(!m('junk', 'x'.repeat(5000)) && !m('players/A/junk', 1, playingMulti, 'A') && !RW('A', [['rooms/333333/players/A/junk', 1]], playingMulti), 'حقل مجهول في الغرفة أو في مقعد قُبل');
  r.ok(m('move', { key: 'h_0_0', by: 1, seq: 5, bank: 170.5, nextTurn: 2 }) && !m('move', { key: 'x'.repeat(65), by: 1, seq: 5 }) && !m('move', { key: 'h', by: 1, seq: 5, extra: 1 })
    && !m('move', { key: 'h', by: 9, seq: 5 }), 'الحركة: كما يكتبها الكود رُفضت، أو مفتاح طويل/حقل غريب/لاعب خارج الحد قُبل');
  r.ok(m('moves/-Nx1', { key: '__skip__', by: 2, seq: 6, nextTurn: 1 }) && !m('moves/-Nx1', { key: 'h', by: 2, seq: 6, junk: 'x' }), 'سجل الحركات: الصحيح رُفض أو حقل غريب قُبل');
  r.ok(m('clock', { banks: { 1: 180, 2: 180 }, currentPlayer: 1, turnStartAt: T0 }) && !m('clock', { banks: { 1: 180 }, currentPlayer: 1, turnStartAt: T0, x: 1 })
    && !m('clock/banks/1', -5) && !m('clock/banks/1', 'كثير'), 'الساعة: الصحيحة رُفضت أو حقل غريب/بنك سالب أو نص قُبل');
  r.ok(m('elementMap', { '0,0': 'water', '10,10': 'gem' }) && !m('elementMap', { '0,0': 'قنبلة' }) && !m('elementMap', { ['x'.repeat(40)]: 'gem' }),
    'العناصر: الصحيحة رُفضت أو نوع مجهول/مفتاح طويل قُبل');
  r.ok(m('approval', { state: 'asking', available: 3, wanted: 3, startedAt: T0, decisions: { 1: 'pending', 2: 'accepted' } }) && !m('approval/decisions/1', 'ربما')
    && !m('approval', { state: 'asking', junk: 1 }) && !m('approval/state', 'x'.repeat(17)), 'التصويت: الصحيح رُفض أو قرار مجهول/حقل غريب/حالة طويلة قُبل');
  r.ok(m('bankUpdate', { player: 2, bank: 150, seq: T0, by: 1 }) && !m('bankUpdate', { player: 2, bank: 150, seq: T0, by: 1, x: 1 }) && m('signals', { restart: 1, ts: T0 }) && !m('signals', { restart: 1, ts: T0, x: 1 }),
    'تحديث البنك/إشارة الإعادة: الصحيح رُفض أو حقل غريب قُبل');
  // مراجعة ج-3 (M1): بعد الانضمام يصير المنضمّ عضواً — فهويّة الغرفة لا تتغيّر لأيّ كاتب: منشئها ومضيفها، واسم المنشئ إلا
  // بيده، واسم المقعد ورقمه إلا بيد صاحبه (حذف مقعد غيره وإضافة مقعد وهمي: يبقيان لإعادة البناء مع 3.8)
  r.ok(!m('p1name', 'مزوّر', rooms0, 'B') && !m('p1uid', 'B', rooms0, 'B') && m('p1name', 'أ2', rooms0, 'A'), 'المنضمّ الثنائي غيّر اسم المنشئ أو المنشئ نفسه بعد انضمامه، أو المنشئ لم يغيّر اسمه');
  const inLobby = withRooms({ '333333': lobby2 });
  r.ok(!RW('C', [['rooms/333333/players/A/name', 'مزوّر']], inLobby) && !RW('C', [['rooms/333333/players/A/num', 3]], inLobby) && !RW('C', [['rooms/333333/hostUid', 'C']], inLobby)
    && RW('A', [['rooms/333333/players/A/name', 'أ2']], inLobby) && RW('C', [['rooms/333333/players/C/name', 'ج2']], inLobby),
    'عضو اللوبي غيّر اسم المضيف أو رقمه أو صار هو المضيف، أو صاحب المقعد لم يغيّر اسمه');
  // مراجعة ج-3 (الجولة 2): ".validate" لا يعمل على حقل يُحذف — فالهويّة لا تُمحى أيضاً: لا حذف لمنشئ الغرفة أو مضيفها أو اسم المنشئ،
  // ولا لاسم مقعد غيرك أو رقمه (داخل كتابة الانضمام وبعدها). حذف مقعد غيرك كله: يبقى لإعادة البناء مع 3.8
  const noP1name = join('B'); delete noP1name.p1name;
  r.ok(!RW('B', [['rooms/111111', noP1name]], rooms0), 'انضمام ثنائي يحذف اسم المنشئ قُبل');
  r.ok(!RW('B', [['rooms/333333', ljoin2({ A: { active: true } })]], rooms2) && !RW('B', [['rooms/333333', ljoin2({ C: { name: 'ج', active: true } })]], rooms2),
    'انضمام جماعي يمحو اسم المضيف ورقمه (يبقى مقعده فارغاً) أو رقم لاعب آخر قُبل');
  r.ok(!m('p1uid', null, rooms0, 'B') && !RW('C', [['rooms/333333/hostUid', null]], inLobby) && !RW('C', [['rooms/333333/players/A/num', null]], inLobby)
    && !RW('C', [['rooms/333333/players/A/name', null]], inLobby), 'عضو حذف منشئ الغرفة أو مضيفها أو اسم/رقم مقعد غيره');
  r.ok(RW('C', [['rooms/333333/players/C/waiting', null]], withRooms({ '333333': { ...lobby2, players: { ...lobby2.players, C: { name: 'ج', num: 2, active: true, waiting: true } } } })),
    'صاحب المقعد لم يحذف حقلاً من مقعده (منتظر)');
  // حدود مفاتيح سجل الحركات والبنوك والقرارات (مفاتيح push ‏20 حرفاً، والأرقام 0..4)
  r.ok(!m('moves/' + 'x'.repeat(33), { key: 'h', by: 1, seq: 1 }) && !m('clock/banks/12', 5) && !m('approval/decisions/10', 'pending') && m('approval/decisions/0', 'pending'),
    'مفتاح طويل في سجل الحركات/البنوك/القرارات قُبل، أو القرار 0 رُفض');
  // لوبي بلا مضيف مسجّل (مشوّه): لا انضمام — كما يفعل الخادم (child(null) خطأ تقييم يرفض)
  const noHostUid = { ...lobby2 }; delete noHostUid.hostUid;
  r.ok(!RW('B', [['rooms/333333', { ...noHostUid, players: { ...lobby2.players, B: { name: 'ب', num: 3, active: true } }, playerCount: 3 }]], withRooms({ '333333': noHostUid })),
    'انضمام للوبي بلا مضيف مسجّل قُبل');
  r.ok(m('turn', 2) && !m('turn', 9) && m('leftBy', 2) && m('dropped2', true) && !m('dropped2', 'نعم') && m('abortedBy', 1) && !m('public', 'نعم') && !m('hostNum', 7) && !m('playerCount', 99),
    'حقول الحالة: القيم الصحيحة رُفضت أو قيمة خارج نوعها/حدّها قُبلت');
  // اللاعبون: يكتبون كل شيء في غرفتهم (حركات، ساعة، خروج غيرهم بعد مهلته، إنهاء، حذف) — حدّ مقبول (3.8)
  const lobby3 = withRooms({ '333333': { ...lobby, players: { A: { name: 'أ', num: 1 }, B: { name: 'ب', num: 2 }, C: { name: 'ج', num: 3 } }, status: 'playing' } });
  r.ok(RW('B', [['rooms/222222/move', { key: 'h1', by: 2, seq: 3 }], ['rooms/222222/clock/currentPlayer', 1]], rooms0) && RW('A', [['rooms/222222', { ...duoPlaying, status: 'finished', leftBy: 1 }]], rooms0),
    'لاعب الثنائي لا يحرّك أو لا ينهي مباراته');
  r.ok(RW('B', [['rooms/333333/players/C', { name: 'ج', num: 3, active: false, outReason: 'dropped' }]], lobby3) && RW('C', [['rooms/333333/players/C', null], ['rooms/333333/playerCount', 2], ['rooms/333333/hostNum', 1]], lobby3),
    'لاعب جماعي لا يُخرج غيره بعد مهلته أو لا يغادر بكتابة واحدة');
  r.ok(RW('A', [['rooms/111111', null]], rooms0) && RW('B', [['rooms/222222', null]], rooms0), 'اللاعب لا يحذف غرفته (إلغاء الانتظار / معاملة بذاكرة باردة)');
  // المشاهد: خانته فقط، وفي غرفة موجودة — لا يحرّك ولا يغيّر الساعة
  r.ok(RW('V', [['rooms/222222/spectators/V', { name: 'مشاهد', at: T0 }]], rooms0) && RW('V', [['rooms/222222/spectators/V', null]], rooms0), 'المشاهد لا يكتب/يحذف خانته');
  r.ok(!RW('V', [['rooms/222222/spectators/B', { name: 'x' }]], rooms0), 'المشاهد يكتب خانة غيره');
  r.ok(!RW('V', [['rooms/222222/moves/k1', { key: '__skip__', by: 1, nextTurn: 2 }]], rooms0) && !RW('V', [['rooms/222222/clock/currentPlayer', 2]], rooms0),
    'المشاهد يحرّك أو يغيّر الساعة');
  r.ok(!RW('V', [['rooms/999999/spectators/V', { name: 'مشاهد' }]], rooms0), 'خانة مشاهد في غرفة غير موجودة (تُنشئ بقايا) قُبلت');
  // خانة المشاهد بشكلها فقط (مراجعة ب-2): الاسم إلزامي، والوقت رقم، ولا حقول أخرى — وإلا يعلّق أي مسجّل حمولة كبيرة
  // في أي مباراة جارية يعيد تنزيلها كل لاعب مع كل كتابة
  r.ok(RW('V', [['rooms/222222/spectators/V/name', 'مشاهد'], ['rooms/222222/spectators/V/at', T0]], rooms0), 'كتابة خانة المشاهد كما يكتبها الكود (update) مرفوضة');
  r.ok(!RW('V', [['rooms/222222/spectators/V', { name: 'م', junk: 'x'.repeat(1000) }]], rooms0) && !RW('V', [['rooms/222222/spectators/V', { at: T0 }]], rooms0)
    && !RW('V', [['rooms/222222/spectators/V', { name: 'م', at: 'أمس' }]], rooms0), 'خانة مشاهد بحقل غريب أو بلا اسم أو بوقت ليس رقماً قُبلت');
  // وقت الإنشاء لا يُبعَد للمستقبل (غرفة لا يحذفها التنظيف أبداً) — بسماحٍ لفرق ساعة الجهاز (10 دقائق)
  r.ok(RW('A', [['rooms/444444', { ...duoWaiting, createdAt: T0 + 60_000 + 300_000 }]], rooms0) && !RW('A', [['rooms/444444', { ...duoWaiting, createdAt: T0 + 86_400_000 }]], rooms0),
    'وقت إنشاء بعيد في المستقبل قُبل (أو فرق ساعة معقول رُفض)');
  // التنظيف (أي مسجّل): المنتهية، والأقدم من ساعة (بوقت الخادم)، واللوبي الفارغ، والبقايا — لا غيرها
  const fin = withRooms({ '666666': { ...duoPlaying, status: 'finished' }, '777777': { ...lobby, players: null } });
  r.ok(RW('V', [['rooms/666666', null]], fin) && RW('V', [['rooms/777777', null]], fin), 'تنظيف غرفة منتهية أو لوبي فارغ مرفوض');
  r.ok(RW('V', [['rooms/222222', null]], rooms0, T0 + 3_700_000) && !RW('V', [['rooms/222222', null]], rooms0, T0 + 3_500_000),
    'حدّ الساعة في التنظيف خاطئ (أقدم من ساعة يُحذف، والأحدث لا)');
  // حدود الشكل
  r.ok(!RW('A', [['rooms/444444', { ...duoWaiting, p1name: 'ن'.repeat(129) }]], rooms0) && !RW('A', [['rooms/444444', { ...duoWaiting, cfg: { rows: 99, cols: 4 } }]], rooms0)
    && !RW('A', [['rooms/444444', { ...lobby, maxPlayers: 9 }]], rooms0) && !RW('A', [['rooms/222222/status', 'مخترقة']], rooms0)
    && !RW('A', [['rooms/333333/players/A/name', 'ن'.repeat(129)]], rooms0) && !RW('V', [['rooms/222222/spectators/V', { name: 'ن'.repeat(129) }]], rooms0),
    'حدود الشكل (الاسم 128، اللوحة 2..12، الحد 2..4، الحالة، اسم المشاهد) لم تُطبَّق');
  // حذف دعوة/ردّ غير موجود: لا شيء (removeIf على خانة فرغت) — بلا رفض صامت
  r.ok(W(NEW, 'A', [['invites/B', null]]) && W(NEW, 'A', [['inviteRejections/B', null]]), 'حذف دعوة/ردّ غير موجود رُفض');
  // ── 3.3أ-3: المحادثة لطرفيها فقط — الطرفان من مفتاحها نفسه (معرّفا اللاعبين مرتّبين: A_B) ──
  // رسالة كما يكتبها الكود (chat.js → sendMessage)
  const MSG = (from, extra = {}) => ({ fromUid: from, fromName: 'اسم', text: 'مرحبا', ts: 1, status: 'sent', ...extra });
  const withChat = JSON.parse(JSON.stringify(base));
  withChat.chats = { A_B: { m0: { fromUid: 'B', fromName: 'ب', text: 'أهلاً', ts: 1, status: 'sent' } },
                     B_V: { v0: { fromUid: 'V', text: 'سرّ', ts: 1, status: 'sent' } } };
  // القراءة: طرفاها (أياً كان ترتيبهما في المفتاح) — لا غيرهما ولا كل المحادثات دفعة واحدة ولا زائر
  r.ok(R(NEW, 'A', 'chats/A_B', withChat) && R(NEW, 'B', 'chats/A_B', withChat) && R(NEW, 'A', 'chats/A_B/m0', withChat),
    'طرفا المحادثة لا يقرآنها');
  r.ok(!R(NEW, 'A', 'chats/B_V', withChat) && !R(NEW, 'A', 'chats/B_V/v0', withChat) && !R(NEW, 'V', 'chats/A_B', withChat),
    'أقرأ محادثة لست طرفاً فيها');
  r.ok(!R(NEW, 'A', 'chats', withChat), 'أقرأ كل المحادثات دفعة واحدة (chats)');
  r.ok(!R(NEW, null, 'chats/A_B', withChat), 'زائر بلا دخول يقرأ محادثة');
  // مفاتيح تشبه المعرّف ولا تطابقه: AA_B وB_AA ليستا لـA (المعرّف كاملاً قبل _ أو بعده)
  r.ok(!R(NEW, 'A', 'chats/AA_B') && !R(NEW, 'A', 'chats/B_AA') && !R(NEW, 'A', 'chats/XA') && !R(NEW, 'A', 'chats/A'),
    'مفتاح يحتوي معرّفي جزئياً اعتُبرت طرفاً فيه');
  // الإرسال: رسالة جديدة لصديق (يحملني في قائمته)، باسمي الحقيقي — من الطرفين
  r.ok(W(NEW, 'A', [['chats/A_B/m1', MSG('A')]], withChat) && W(NEW, 'B', [['chats/A_B/m2', MSG('B')]], withChat),
    'رسالة بين صديقين مرفوضة');
  r.ok(!W(NEW, 'A', [['chats/A_B/m1', MSG('B')]], withChat), 'رسالة بانتحال الطرف الآخر قُبلت');
  r.ok(!W(NEW, 'A', [['chats/A_V/m1', MSG('A')]], withChat), 'رسالة لمن ليس صديقي قُبلت');
  r.ok(!W(NEW, 'V', [['chats/A_B/m1', MSG('V')]], withChat) && !W(NEW, 'A', [['chats/B_V/m1', MSG('A')]], withChat),
    'كتبتُ في محادثة لست طرفاً فيها');
  // مفتاح بلا _ أو لنفسي: لا شهادة صداقة من "طرف آخر" (A_A تُرفض ما دام لا أحد يحمل نفسه في قائمته — ولو فعل
  // فلا يقرؤها غيره، فلا ضرر)؛ وشرط "طرفٌ فيها" مستقل عن الشهادة: ب يحمل الضحية، ومع ذلك لا تكتب في مفتاح "B"
  r.ok(!W(NEW, 'A', [['chats/A_A/m1', MSG('A')]], withChat), 'رسالة لنفسي (A_A) قُبلت بلا مدخل لنفسي في قائمتي');
  const bListsV = JSON.parse(JSON.stringify(withChat)); bListsV.users.B.friends.V = { name: 'ضحية' };
  r.ok(!W(NEW, 'V', [['chats/B/x', MSG('V')]], bListsV) && !W(NEW, 'V', [['chats/A_B/x', MSG('V')]], bListsV),
    'كتبتُ في مفتاح لست طرفاً فيه لأن صاحبه يحملني في قائمته');
  r.ok(!W(NEW, null, [['chats/A_B/m1', MSG('A')]], withChat), 'زائر بلا دخول يرسل');
  // صداقة من طرف واحد (قديمة): أحمله في قائمتي وهو لا يحملني — لا تكفي (الشهادة من قائمة المستلم)
  const oneSided = JSON.parse(JSON.stringify(withChat)); oneSided.users.A.friends.V = { name: 'ضحية' };
  r.ok(!W(NEW, 'A', [['chats/A_V/m1', MSG('A')]], oneSided), 'صداقة من طرفي وحدي سمحت بالإرسال');
  // بعد حذف الصداقة: التاريخ يبقى لطرفيه، ولا رسائل جديدة
  const unfriended = JSON.parse(JSON.stringify(withChat)); delete unfriended.users.A.friends; delete unfriended.users.B.friends;
  r.ok(R(NEW, 'A', 'chats/A_B', unfriended) && !W(NEW, 'A', [['chats/A_B/m1', MSG('A')]], unfriended),
    'بعد حذف الصداقة: التاريخ لم يعد مقروءاً أو ما زال الإرسال ممكناً');
  r.ok(W(NEW, 'A', [['chats/A_B/m0/status', 'read']], unfriended), 'بعد حذف الصداقة: المستلم لا يعلّم رسالة قديمة مقروءة');
  // الرسالة بعد إرسالها: لا تُعدَّل ولا تُحذف ولا تُستبدل المحادثة كاملة
  r.ok(!W(NEW, 'B', [['chats/A_B/m0/text', 'معدّلة']], withChat) && !W(NEW, 'A', [['chats/A_B/m0/text', 'معدّلة']], withChat),
    'تعديل نص رسالة بعد إرسالها قُبل');
  r.ok(!W(NEW, 'B', [['chats/A_B/m0', MSG('B', { text: 'بديلة' })]], withChat), 'استبدال رسالة موجودة قُبل');
  r.ok(!W(NEW, 'B', [['chats/A_B/m0', null]], withChat) && !W(NEW, 'A', [['chats/A_B/m0', null]], withChat), 'حذف رسالة قُبل');
  r.ok(!W(NEW, 'A', [['chats/A_B', null]], withChat) && !W(NEW, 'A', [['chats/A_B', { m9: MSG('A') }]], withChat),
    'حذف المحادثة كاملة أو استبدالها قُبل');
  // الحالة (وصلت/قُرئت): يغيّرها مستلم الرسالة فقط، وبقيم معروفة، وعلى رسالة موجودة
  r.ok(W(NEW, 'A', [['chats/A_B/m0/status', 'delivered']], withChat) && W(NEW, 'A', [['chats/A_B/m0/status', 'read']], withChat),
    'المستلم لا يعلّم الرسالة وصلت/قُرئت');
  r.ok(!W(NEW, 'B', [['chats/A_B/m0/status', 'read']], withChat), 'المرسل يعلّم رسالته قُرئت');
  r.ok(!W(NEW, 'V', [['chats/A_B/m0/status', 'read']], withChat), 'غريب يغيّر حالة رسالة');
  r.ok(!W(NEW, 'A', [['chats/A_B/m0/status', 'مخترقة']], withChat), 'حالة بقيمة غير معروفة قُبلت');
  r.ok(!W(NEW, 'A', [['chats/A_B/m0/status', null]], withChat), 'حذف حالة رسالة قُبل');
  r.ok(!W(NEW, 'A', [['chats/A_B/ghost/status', 'read']], withChat), 'حالة على رسالة غير موجودة أنشأت عقدة');
  // كما يكتبها markRead: عدّة حالات بكتابة واحدة متعددة المسارات
  r.ok(W(NEW, 'A', [['chats/A_B/m0/status', 'read'], ['users/A/lastRead/A_B', 5]], withChat), 'تعليم القراءة (كما يكتبه الكود) مرفوض');
  // الحدود والحقول
  r.ok(!W(NEW, 'A', [['chats/A_B/m2', MSG('A', { text: 'x'.repeat(2001) })]], withChat), 'رسالة أطول من الحدّ (2000) قُبلت');
  r.ok(!W(NEW, 'A', [['chats/A_B/m3', MSG('A', { fromName: 'ن'.repeat(129) })]], withChat), 'اسم مرسل أطول من الحدّ (128) قُبل');
  r.ok(!W(NEW, 'A', [['chats/A_B/m4', MSG('A', { ts: 'أمس' })]], withChat), 'وقت رسالة ليس رقماً قُبل');
  r.ok(!W(NEW, 'A', [['chats/A_B/m6', MSG('A', { status: 'x' })]], withChat), 'رسالة جديدة بحالة غير معروفة قُبلت');
  r.ok(!W(NEW, 'A', [['chats/A_B/m7', MSG('A', { extra: 'حقل غريب' })]], withChat), 'رسالة بحقل غير معروف قُبلت');
  // الحقول الأساسية إلزامية عند الإنشاء (fromUid وtext وts)، والحالة عند الإنشاء "sent" أو غائبة — لا "قُرئت" مسبقاً
  // (الشرط في .write لا في .validate على الرسالة: Firebase يقيّم .validate الآباء في تحديث status وحده، فتنكسر رسالة قديمة ناقصة)
  const noText = MSG('A'); delete noText.text; const noTs = MSG('A'); delete noTs.ts; const noStatus = MSG('A'); delete noStatus.status;
  r.ok(!W(NEW, 'A', [['chats/A_B/m8', noText]], withChat) && !W(NEW, 'A', [['chats/A_B/m9', noTs]], withChat)
    && !W(NEW, 'A', [['chats/A_B/m10', { fromUid: 'A' }]], withChat), 'رسالة بلا نص أو بلا وقت قُبلت');
  r.ok(W(NEW, 'A', [['chats/A_B/m11', noStatus]], withChat), 'رسالة بلا حالة (تُعدّ "sent") رُفضت');
  r.ok(!W(NEW, 'A', [['chats/A_B/m12', MSG('A', { status: 'read' })]], withChat) && !W(NEW, 'A', [['chats/A_B/m13', MSG('A', { status: 'delivered' })]], withChat),
    'المرسل أنشأ رسالته "مقروءة/وصلت" مسبقاً');
  // رسالة قديمة ناقصة الحقول (من قبل الحدود): المستلم ما زال يعلّمها مقروءة
  const legacy = JSON.parse(JSON.stringify(withChat)); legacy.chats.A_B.old = { fromUid: 'B', text: 'قديمة' };
  r.ok(W(NEW, 'A', [['chats/A_B/old/status', 'read']], legacy), 'رسالة قديمة بلا وقت/حالة: تعليمها مقروءة رُفض');
  // الدعوة: أدعو صديقاً باسمي فقط — لا غيرَ صديق ولا بانتحال مرسل؛ والمستلم يمسح خانته والمرسل يسحب دعوته
  r.ok(W(NEW, 'A', [['invites/B', { fromUid: 'A', fromName: 'أ', roomCode: '123456', sentAt: 1 }]]), 'دعوة صديق (باسمي) مرفوضة');
  r.ok(!W(NEW, 'A', [['invites/V', { fromUid: 'A', fromName: 'أ', roomCode: '1', sentAt: 1 }]]), 'دعوتُ مَن ليس صديقي (ليست في قائمته)');
  r.ok(!W(NEW, 'A', [['invites/B', { fromUid: 'C', fromName: 'ج', roomCode: '1', sentAt: 1 }]]), 'دعوة بانتحال مرسل آخر قُبلت');
  r.ok(W(NEW, 'B', [['invites/B', null]]), 'المستلم لا يمسح دعوته من خانته');
  const withInvite = JSON.parse(JSON.stringify(base)); withInvite.invites = { B: { fromUid: 'A', roomCode: '1' } };
  r.ok(W(NEW, 'A', [['invites/B', null]], withInvite), 'المرسل لا يسحب دعوته هو');
  r.ok(!W(NEW, 'C', [['invites/B', null]], withInvite), 'غريب يسحب دعوة غيره');
  // ردّ الدعوة بين صديقين فقط (كالدعوة)، باسم الرافض الحقيقي؛ وصاحب الدعوة يمسح ردّاً وصله
  r.ok(W(NEW, 'A', [['inviteRejections/B', { rejectedBy: 'A', name: 'أ', ts: 1, roomCode: '1' }]]), 'الرافض يردّ على دعوة صديقه مرفوض');
  r.ok(!W(NEW, 'A', [['inviteRejections/V', { rejectedBy: 'A', name: 'أ', ts: 1 }]]), 'ردٌّ على مَن ليس صديقي قُبل');
  r.ok(!W(NEW, 'A', [['inviteRejections/B', { rejectedBy: 'C', name: 'ج', ts: 1 }]]), 'ردّ بانتحال رافض آخر قُبل');
  r.ok(W(NEW, 'A', [['inviteRejections/A', null]]), 'صاحب الدعوة لا يمسح ردّاً في خانته');
  // chatStatus (غير مستعملة) مغلقة تماماً
  r.ok(!canRead(NEW, 'chatStatus', { uid: 'A' }) && !W(NEW, 'A', [['chatStatus/x', { t: 1 }]]), 'chatStatus لم تُغلق');
  // حدود الملف العام والطلب
  r.ok(!W(NEW, 'A', [['profiles/A', { name: 'ن'.repeat(129) }]]), 'اسم عام أطول من الحدّ (128) قُبل');
  r.ok(!W(NEW, 'A', [['profiles/A', { xp: 'كثير' }]]), 'خبرة ليست رقماً قُبلت');
  r.ok(W(NEW, 'A', [['users/B/friendRequests/A', REQ()], ['users/A/sentRequests/B', SV]]) && !W(NEW, 'A', [['users/B/friendRequests/A', REQ({ name: 'ن'.repeat(129) })], ['users/A/sentRequests/B', SV]]),
    'حدّ اسم الطلب (128) لم يُطبَّق');
  // ── 3.3ج-1: تحدي اليوم والدعوات والمحادثة — حدود الحقول، ومن يقرأ الدعوة، ووقت الرسالة ──
  const T1 = 1_800_000_000_000;
  const RW1 = (uid, writes, root = base) => checkWrite(NEW, writes, { uid, root, now: T1 }).ok;
  const RD1 = (uid, p, root) => canRead(NEW, p, { uid, root, now: T1 });
  // تحدي اليوم: نتيجتي بشكلها كما يكتبها الكود، والمتصدرون يقرؤها كل مسجّل — لا نتيجة غيري ولا حقول/أرقام خارج الحد
  const daily = { result: 'win', myScore: 9, oppScore: 7, duration: 95, name: 'أ', ts: T1 };
  r.ok(canRead(NEW, 'dailyChallenges/2026-11-12/results', { uid: 'A' }) && RW1('A', [['dailyChallenges/2026-11-12/results/A', daily]]) && !RW1('A', [['dailyChallenges/2026-11-12/results/B', daily]]),
    'تحدي اليوم: نتيجتي لا تُكتب أو نتيجة غيري تُكتب أو المتصدرون لا يُقرؤون');
  r.ok(!RW1('A', [['dailyChallenges/2026-11-12/results/A', { ...daily, result: 'بطل' }]]) && !RW1('A', [['dailyChallenges/2026-11-12/results/A', { ...daily, myScore: 9999 }]])
    && !RW1('A', [['dailyChallenges/2026-11-12/results/A', { ...daily, duration: -5 }]]) && !RW1('A', [['dailyChallenges/2026-11-12/results/A', { ...daily, extra: 'x'.repeat(500) }]])
    && !RW1('A', [['dailyChallenges/2026-11-12/results/A', { ...daily, oppScore: 9999 }]]) && !RW1('A', [['dailyChallenges/2026-11-12/results/A', { ...daily, duration: 90_000 }]])
    && !RW1('A', [['dailyChallenges/2026-11-12/results/A', { ...daily, ts: 'أمس' }]]) && !RW1('A', [['dailyChallenges/2026-11-12/results/A', { ...daily, name: 'ن'.repeat(129) }]]),
    'تحدي اليوم: نتيجة بقيمة غير معروفة أو نقاط/مدة خارج الحد أو حقل غريب أو وقت ليس رقماً أو اسم طويل قُبلت');
  // ساعة جهاز متقدّمة (مراجعة ج-1): الأوقات التي لا ترتّب شيئاً (الدعوة، الردّ) بلا سقف — لا يُفشل جهازٌ ساعته متقدّمة.
  // 3.3ج-4: ونتيجة التحدي بوقت الخادم بالضبط (الكود يكتبه serverTimestamp منذ ج-1 — فساعة الجهاز لا تدخل): وقت آخر مرفوض
  r.ok(RW1('A', [['dailyChallenges/2026-11-12/results/A', { ...daily, ts: SV }]]) && !RW1('A', [['dailyChallenges/2026-11-12/results/A', { ...daily, ts: T1 + 3_600_000 }]])
    && !RW1('A', [['dailyChallenges/2026-11-12/results/A', { ...daily, ts: T1 - 86_400_000 }]]), 'نتيجة التحدي بوقت الخادم رُفضت، أو بوقت آخر (ساعة الجهاز/أمس) قُبلت');
  // الدعوة: لا يقرؤها إلا صاحب الخانة ومرسلها (فيها رمز غرفة الدعوة) — ولا أحد يقرأ كل الدعوات
  const inv = { fromUid: 'A', fromName: 'أ', roomCode: '123456', cfg: { rows: 4, cols: 4 }, sentAt: T1 };
  const withInv = JSON.parse(JSON.stringify(base)); withInv.invites = { B: inv }; withInv.inviteRejections = { A: { rejectedBy: 'B', name: 'ب', ts: T1, roomCode: '123456', reason: 'rejected' } };
  r.ok(RD1('B', 'invites/B', withInv) && RD1('A', 'invites/B', withInv), 'الدعوة لا يقرؤها صاحب خانتها أو مرسلها');
  r.ok(!RD1('V', 'invites/B', withInv) && !RD1('V', 'invites', withInv) && !RD1('B', 'invites', withInv), 'غريب يقرأ دعوة غيره، أو أحد يقرأ كل الدعوات');
  r.ok(RD1('A', 'inviteRejections/A', withInv) && RD1('B', 'inviteRejections/A', withInv) && !RD1('V', 'inviteRejections/A', withInv) && !RD1('V', 'inviteRejections', withInv),
    'الردّ لا يقرؤه صاحبه أو رافضه، أو يقرؤه غريب');
  r.ok(RW1('A', [['invites/B', inv]]) && !RW1('A', [['invites/B', { ...inv, extra: 1 }]]) && !RW1('A', [['invites/B', { ...inv, cfg: { rows: 99, cols: 4 } }]])
    && !RW1('A', [['invites/B', { ...inv, cfg: { rows: 4, cols: 4, junk: 'x' } }]]) && !RW1('A', [['invites/B', { ...inv, cfg: { rows: 1, cols: 4 } }]])
    && !RW1('A', [['invites/B', { ...inv, cfg: 'x'.repeat(1000) }]]) && !RW1('A', [['invites/B', { ...inv, cfg: { rows: 4 } }]]) && !RW1('A', [['invites/B', { ...inv, sentAt: 'أمس' }]]),
    'شكل الدعوة: الصحيحة مرفوضة، أو حقل غريب/لوحة خارج الحد أو ناقصة أو نصّاً/وقت ليس رقماً قُبل');
  r.ok(RW1('A', [['invites/B', { ...inv, sentAt: T1 + 3_600_000 }]]) && RW1('A', [['inviteRejections/B', { rejectedBy: 'A', name: 'أ', ts: T1 + 3_600_000, roomCode: '1', reason: 'rejected' }]]),
    'دعوة/ردّ من جهاز ساعته متقدّمة ساعة رُفض');
  const rej = { rejectedBy: 'A', name: 'أ', ts: T1, roomCode: '1', reason: 'playing' };
  r.ok(RW1('A', [['inviteRejections/B', rej]]) && !RW1('A', [['inviteRejections/B', { ...rej, reason: 'شتيمة' }]]) && !RW1('A', [['inviteRejections/B', { ...rej, extra: 1 }]])
    && !RW1('A', [['inviteRejections/B', { ...rej, ts: 'أمس' }]]), 'شكل الردّ: الصحيح مرفوض، أو سبب غير معروف/حقل غريب/وقت ليس رقماً قُبل');
  // الرسالة: وقتها رقم لا يتجاوز وقت الخادم بأكثر من 10 دقائق (رسالة "من المستقبل" كانت تبقى الأخيرة للأبد)
  const chatRoot = JSON.parse(JSON.stringify(base));
  const msg1 = (ts) => ({ fromUid: 'A', fromName: 'أ', text: 'مرحبا', ts, status: 'sent' });
  r.ok(RW1('A', [['chats/A_B/x1', msg1(T1)]], chatRoot) && RW1('A', [['chats/A_B/x2', msg1(T1 + 600_000)]], chatRoot) && !RW1('A', [['chats/A_B/x3', msg1(T1 + 600_001)]], chatRoot)
    && !RW1('A', [['chats/A_B/x4', msg1(T1 + 86_400_000)]], chatRoot), 'وقت الرسالة: الآن أو حدّ الدقائق العشر مرفوض، أو ما بعده/"من المستقبل" (يوم) قُبل');
  r.ok(JSON.stringify(NEW.rules.chats.$key['.indexOn']) === '["ts"]', 'فهرس ts على المحادثة غير موجود (الاستعلام بالوقت ينزّل المحادثة كاملة)');
  // "قرأتُ حتى" لا يرجع للوراء (مراجعة ج-1، الجولة 3): جهاز فتح المحادثة بلا شبكة من نسخة أقدم لا يُرجع رسائل قرأها
  // جهاز آخر "غير مقروءة" — إلا إن كانت القيمة المخزّنة في المستقبل (ساعة نسخة قديمة متقدّمة كتبت Date.now()) فتُصحَّح
  const lr = v => { const t = JSON.parse(JSON.stringify(base)); if (v !== undefined) t.users.A.lastRead = { A_B: v }; return t; };
  r.ok(RW1('A', [['users/A/lastRead/A_B', T1 - 5]], lr()) && RW1('A', [['users/A/lastRead/A_B', T1 - 5]], lr(T1 - 9))
    && RW1('A', [['users/A/lastRead/A_B', T1 - 5]], lr(T1 - 5)), '"قرأتُ حتى": أول كتابة، أو تقدّم، أو القيمة نفسها مرفوضة');
  r.ok(!RW1('A', [['users/A/lastRead/A_B', T1 - 9]], lr(T1 - 5)), '"قرأتُ حتى" رجع للوراء (جهاز بلا شبكة من نسخة أقدم)');
  r.ok(RW1('A', [['users/A/lastRead/A_B', T1 - 9]], lr(T1 + 3_600_000)) && RW1('A', [['users/A/lastRead/A_B', T1 - 9]], lr('x')),
    '"قرأتُ حتى" مخزّنة في المستقبل (ساعة قديمة) أو ليست رقماً لا تُصحَّح');
  r.ok(!RW1('A', [['users/A/lastRead/A_B', 'أمس']], lr()) && !RW1('B', [['users/A/lastRead/A_B', T1]], lr()),
    '"قرأتُ حتى" ليست رقماً، أو يكتبها غير صاحبها، قُبلت');
  r.ok(RW1('A', [['users/A/lastRead', null]], lr(T1)), 'حذف "قرأتُ حتى" (ملفي) رُفض');
  // ── 3.3ج-2: طلبات الصداقة — بوقت الخادم، والدليل 30 يوماً، ومهلة 10 دقائق بعد الرفض/السحب/الحذف ──
  const T2 = 1_900_000_000_000, MIN = 60_000, DAY = 86_400_000;
  const RW2 = (uid, writes, root = base) => checkWrite(NEW, writes, { uid, root, now: T2 }).ok;
  const RD2 = (uid, p, root) => canRead(NEW, p, { uid, root, now: T2 });
  const tree = (fn) => { const t = JSON.parse(JSON.stringify(base)); fn(t.users); return t; };
  const send = (root, req = REQ(), tok = SV) => RW2('A', [['users/B/friendRequests/A', req], ['users/A/sentRequests/B', tok]], root);
  // الإرسال: الطلب ودليله بوقت الخادم معاً؛ ووقت الجهاز (نسخة أقدم) أو أحدهما وحده مرفوض
  r.ok(send(base) && !send(base, REQ({ sentAt: T2 - 5 }), T2 - 5) && !send(base, REQ({ sentAt: T2 - 5 })) && !send(base, REQ(), T2 - 5),
    'الطلب: بوقت الخادم مرفوض، أو بوقت الجهاز (كله أو بعضه) قُبل');
  // الدليل يُكتب مع الطلب نفسه: دليلٌ قديم باقٍ في ملفي لا يكفي لطلب جديد (فيبقى عمر الدليل عمر الطلب)
  r.ok(!RW2('A', [['users/B/friendRequests/A', REQ()]], tree(u => { u.A.sentRequests = { B: T2 - DAY }; })), 'طلب جديد بدليل قديم باقٍ (بلا دليل معه) قُبل');
  // الشكل: حقوله المعروفة فقط، والمعرّف هو المرسل، والاسم ووقت الإرسال إلزاميان
  r.ok(!send(base, REQ({ extra: 'x' })) && !send(base, REQ({ uid: 'V' })) && send(base, REQ({ uid: 'A', photo: 'p' })) && !send(base, { sentAt: SV })
    && !send(base, REQ({ photo: 'x'.repeat(1025) })), 'شكل الطلب: حقل غريب/معرّف غير المرسل/بلا اسم/صورة طويلة قُبل، أو الصحيح رُفض');
  // المهلة: بعد رفض/سحب/حذف بأقل من 10 دقائق لا طلب جديد للشخص نفسه، وبعدها يُقبل
  const cool = (at) => tree(u => { u.B.requestCooldown = { A: at }; });
  r.ok(!send(cool(T2 - 5 * MIN)) && !send(cool(T2 - 10 * MIN)) && send(cool(T2 - 10 * MIN - 1)), 'المهلة: طلب قبل مرور 10 دقائق قُبل، أو بعدها رُفض');
  r.ok(RW2('C', [['users/B/friendRequests/C', REQ({ name: 'ج' })], ['users/C/sentRequests/B', SV]], tree(u => { u.B.requestCooldown = { A: T2 }; u.C = { name: 'ج' }; })),
    'مهلة فلان منعت طلب شخص آخر');
  // لا طلب فوق طلب أحدث من 10 دقائق (إعادة الإرسال المتكررة كانت إشعاراً كل مرة)، وفوق الأقدم يُقبل (إعادة بعد انتهاء المدة)
  const pending = (at) => tree(u => { u.B.friendRequests = { A: { name: 'أ', sentAt: at } }; });
  r.ok(!send(pending(T2 - 5 * MIN)) && send(pending(T2 - 31 * DAY)) && send(tree(u => { u.B.friendRequests = { A: { name: 'أ' } }; })),
    'طلب فوق طلب قائم أحدث من 10 دقائق قُبل، أو فوق طلب قديم/بلا وقت رُفض');
  // سحب طلبي القائم من صندوقه: لا يمرّ إلا ومعه المهلة بوقت الخادم (وإلا: سحب وإعادة = إشعار كل مرة)
  const withReq = pending(T2 - DAY);
  r.ok(!RW2('A', [['users/B/friendRequests/A', null]], withReq) && RW2('A', [['users/B/friendRequests/A', null], ['users/B/requestCooldown/A', SV]], withReq)
    && !RW2('A', [['users/B/friendRequests/A', null], ['users/B/requestCooldown/A', T2 - 20 * MIN]], withReq),
    'سحب طلب قائم بلا مهلة (أو بمهلة بوقت قديم) قُبل، أو معها رُفض');
  // المهلة نفسها: يكتبها المرسل لنفسه بوقت الخادم فقط، ولا يمحوها، ولا يكتبها لغيره؛ وصاحب الملف يكتبها ويمحوها
  const cooled = cool(T2 - MIN);
  r.ok(RW2('A', [['users/B/requestCooldown/A', SV]]) && !RW2('A', [['users/B/requestCooldown/A', null]], cooled) && !RW2('A', [['users/B/requestCooldown/C', SV]])
    && !RW2('A', [['users/B/requestCooldown/A', T2 - 20 * MIN]]) && !RW2('A', [['users/B/requestCooldown', null]], cooled),
    'المهلة: المرسل محاها أو كتبها لغيره أو بوقت قديم، أو لم يستطع كتابتها لنفسه');
  // مراجعة ج-2 (L2): المهلة لا يكتبها إلا من له صلة بصاحب الملف (صديق عنده أو طلب في صندوقه) — لا عُقد في ملف غريب ولا لمستخدم لا وجود له
  r.ok(!RW2('A', [['users/V/requestCooldown/A', SV]]) && !RW2('A', [['users/Z9/requestCooldown/A', SV]]) && RW2('A', [['users/V/requestCooldown/A', SV]], tree(u => { u.V.friendRequests = { A: { name: 'أ', sentAt: T2 - DAY } }; })),
    'المهلة: كتبها غريب في ملف لا صلة له به أو لمستخدم لا وجود له، أو صاحب طلب قائم لم يستطع');
  const oneSidedRm = tree(u => { u.A.friends = { V: { name: 'ضحية' } }; });
  r.ok(!RW2('A', [['users/A/friends/V', null], ['users/V/friends/A', null], ['users/V/friendRequests/A', null], ['users/A/sentRequests/V', null], ['users/V/requestCooldown/A', SV]], oneSidedRm)
    && RW2('A', [['users/A/friends/V', null], ['users/V/friends/A', null], ['users/V/friendRequests/A', null], ['users/A/sentRequests/V', null]], oneSidedRm),
    'حذف صديق من طرف واحد: الكتابة مع المهلة قُبلت (ملف لا صلة له) أو بدونها رُفضت (الكود يعيدها بدونها)');
  r.ok(RW2('B', [['users/B/friendRequests/A', null], ['users/B/requestCooldown/A', SV]], withReq) && RW2('B', [['users/B/requestCooldown/A', null]], cooled),
    'الرفض (حذف الطلب + المهلة في ملفي) أو محو صاحب الملف لمهلته رُفض');
  r.ok(RD2('A', 'users/B/requestCooldown/A', cooled) && !RD2('A', 'users/B/requestCooldown', cooled) && !RD2('C', 'users/B/requestCooldown/A', cooled),
    'المهلة: لا يقرأ المرسل مهلته (كم بقي)، أو يقرأ غيرُه مهلته أو المهل كلها');
  // القبول: الدليل يصلح 30 يوماً بوقت الخادم، والدليل ليس رقماً لا يصلح
  const tok = (v) => tree(u => { u.B.sentRequests = { A: v }; u.A.friendRequests = { B: { name: 'ب', sentAt: 1 } }; });
  const accept2 = (root) => RW2('A', [['users/A/friends/B', { uid: 'B', name: 'ب', since: T2 }], ['users/B/friends/A', { uid: 'A', name: 'أ', since: T2 }],
    ['users/A/friendRequests/B', null], ['users/B/sentRequests/A', null]], root);
  r.ok(accept2(tok(T2 - 29 * DAY)) && !accept2(tok(T2 - 30 * DAY)) && !accept2(tok(T2 - 31 * DAY)) && !accept2(tok(true)),
    'القبول: دليل عمره 29 يوماً رُفض، أو 30 يوماً فأكثر أو ليس رقماً قُبل');
  // الدليل في ملفي: بوقت الخادم فقط (كان يُكتب بأي قيمة فيبقى صالحاً للأبد)
  r.ok(!RW2('A', [['users/A/sentRequests/B', T2 + 365 * DAY]]) && RW2('A', [['users/A/sentRequests/B', null]], tok(T2)), 'دليل بوقت غير وقت الخادم قُبل، أو حذف دليلي رُفض');
  // مدخل الصديق: حقوله المعروفة فقط، ومعرّفه صاحبه
  const okEntry = { uid: 'A', name: 'أ', photo: '', since: T2 };
  r.ok(accept2(tok(T2)) && !RW2('A', [['users/B/friends/A', { ...okEntry, extra: 1 }]], tok(T2)) && !RW2('A', [['users/B/friends/A', { ...okEntry, uid: 'V' }]], tok(T2))
    && !RW2('A', [['users/B/friends/A', { ...okEntry, since: 'أمس' }]], tok(T2)), 'مدخل الصديق: حقل غريب أو معرّف غيره أو وقت ليس رقماً قُبل');
  // 3.3ج-4 (مراجعة): "صديق خفي" — بعد طلب من ب، أ يكتب نصاً مكان مدخله في قائمة ب: الواجهة لا تعرضه (فلا زرّ حذف) وأ يقرأ
  // حضور ب ويراسله ويدعوه — المدخل كائن بمعرّفه
  r.ok(!RW2('A', [['users/B/friends/A', 'x'.repeat(5000)]], tok(T2)) && !RW2('A', [['users/B/friends/A', true]], tok(T2))
    && !RW2('A', [['users/B/friends/A', { name: 'أ', since: T2 }]], tok(T2)) && RW2('A', [['users/B/friends/A', null]], tok(T2)) && accept2(tok(T2)),
    'مدخل الصديق: قيمة مفردة أو مدخل بلا معرّف قُبل (صديق خفي)، أو القبول/الحذف رُفض');
  // حذف صديق كما يكتبه الكود: الطرفان + سحب طلبي إليه + المهلة في ملفه؛ وبلا المهلة (القواعد القديمة) ينجح ما لم يكن طلبي قائماً
  const friendsAB = tree(u => { u.A.friends = { B: { name: 'ب' } }; u.B.friends = { A: { name: 'أ' } }; });
  const rmWrites = [['users/A/friends/B', null], ['users/B/friends/A', null], ['users/B/friendRequests/A', null], ['users/A/sentRequests/B', null]];
  const friendsReq = tree(u => { u.A.friends = { B: { name: 'ب' } }; u.B.friends = { A: { name: 'أ' } }; u.B.friendRequests = { A: { name: 'أ', sentAt: T2 - DAY } }; });
  r.ok(RW2('A', [...rmWrites, ['users/B/requestCooldown/A', SV]], friendsAB) && RW2('A', rmWrites, friendsAB)
    && RW2('A', [...rmWrites, ['users/B/requestCooldown/A', SV]], friendsReq) && !RW2('A', rmWrites, friendsReq),
    'حذف صديق: مع المهلة رُفض، أو بلا مهلة وطلبي قائم قُبل (أو بلا طلب رُفض)');
  // ── 3.3ج-4: حدود الأرقام — تصعّب الغش ولا تمنعه (المنع الكامل بكود على الخادم — 3.8) ──
  const T4 = 1_950_000_000_000;
  const RW4 = (uid, writes, root = base) => checkWrite(NEW, writes, { uid, root, now: T4 }).ok;
  const withU = (fields) => tree(u => { Object.assign(u.A, fields); });
  // الخبرة: لا تنقص، ولا تزيد أكثر من 100 في الكتابة (أعلى مكسب حقيقي 70)، وأول كتابة كذلك
  r.ok(RW4('A', [['users/A/xp', 70]]) && !RW4('A', [['users/A/xp', 101]]) && RW4('A', [['users/A/xp', 570]], withU({ xp: 500 })) && RW4('A', [['users/A/xp', 600]], withU({ xp: 500 }))
    && !RW4('A', [['users/A/xp', 601]], withU({ xp: 500 })) && !RW4('A', [['users/A/xp', 400]], withU({ xp: 500 })) && !RW4('A', [['users/A/xp', 'كثير']]) && !RW4('A', [['users/A/xp', -1]])
    && RW4('A', [['users/A/xp', 10]], withU({ xp: 'خربان' })), 'الخبرة: مكسب حقيقي رُفض، أو قفزة فوق 100 أو نقصان أو قيمة ليست رقماً قُبلت');
  // الخبرة العامة (منها المتصدرون) = الخاصة دائماً — بكتابة واحدة معها أو مطابقة لها؛ وصفر لمن لا خبرة له؛ والملف العام بحقوله فقط
  r.ok(RW4('A', [['users/A/xp', 570], ['profiles/A/xp', 570]], withU({ xp: 500 })) && RW4('A', [['profiles/A', { name: 'أ', photo: '', xp: 500 }]], withU({ xp: 500 }))
    && !RW4('A', [['profiles/A/xp', 99999]], withU({ xp: 500 })) && !RW4('A', [['users/A/xp', 570], ['profiles/A/xp', 600]], withU({ xp: 500 }))
    && RW4('A', [['profiles/A/xp', 0]]) && !RW4('A', [['profiles/A/xp', 5]]) && !RW4('A', [['profiles/A', { name: 'أ', xp: 0, junk: 'x'.repeat(5000) }]]),
    'الخبرة العامة: المطابقة رُفضت، أو رقم مزوّر للمتصدرين أو حقل غريب في الملف العام قُبل');
  // الجواهر: لا سالبة، ولا تزيد أكثر من 100 في الكتابة، والصرف حرّ
  r.ok(RW4('A', [['users/A/coins', 9]]) && !RW4('A', [['users/A/coins', 101]]) && RW4('A', [['users/A/coins', 150]], withU({ coins: 50 })) && !RW4('A', [['users/A/coins', 151]], withU({ coins: 50 }))
    && RW4('A', [['users/A/coins', 2]], withU({ coins: 50 })) && !RW4('A', [['users/A/coins', -1]], withU({ coins: 50 })) && !RW4('A', [['users/A/coins', 'مليون']]),
    'الجواهر: مكسب أو صرف حقيقي رُفض، أو قفزة فوق 100 أو سالبة أو ليست رقماً قُبلت');
  // الإحصائيات والإنجازات: شكلها كما يكتبه الكود فقط، وسلسلة الانتصارات تزيد واحداً أو تعود صفراً
  r.ok(RW4('A', [['users/A/stats/ai/history/1950000000000', { r: 'w' }]]) && !RW4('A', [['users/A/stats/ai/history/1950000000000', { r: 'x' }]])
    && !RW4('A', [['users/A/stats/ai/history/1950000000000', { r: 'w', junk: 1 }]]) && !RW4('A', [['users/A/stats/ai/history/' + '9'.repeat(16), { r: 'w' }]])
    && RW4('A', [['users/A/stats/multi/history/1950000000000', { rank: 1, players: 3, score: 9 }]]) && !RW4('A', [['users/A/stats/multi/history/1950000000000', { rank: 9, players: 3, score: 9 }]])
    && RW4('A', [['users/A/stats/local/vs_سيمو', { name: 'سيمو' }], ['users/A/stats/local/vs_سيمو/history/1950000000000', { r: 'd' }]]) && !RW4('A', [['users/A/stats/local/vs_x', { name: 'ن'.repeat(129) }]])
    && RW4('A', [['users/A/stats/online/B', { name: 'ب' }]]) && !RW4('A', [['users/A/stats/hack', 1]])
    && RW4('A', [['users/A/stats', { ai: { wins: 0, losses: 0 }, local: { wins: 0, losses: 0 } }]])
    && !RW4('A', [['users/A/stats/ai/junk', 1]]) && !RW4('A', [['users/A/stats/local/vs_x/junk', 1]]) && !RW4('A', [['users/A/stats/online/B/junk', 1]])
    && !RW4('A', [['users/A/stats/multi/junk', 1]]) && !RW4('A', [['users/A/stats/online/B/history/1950000000000', { r: 'w', junk: 1 }]])
    && !RW4('A', [['users/A/stats/multi/history/1950000000000', { rank: 1, players: 3, score: 9, junk: 1 }]]) && !RW4('A', [['users/A/stats/local/' + 'k'.repeat(401), { name: 'x' }]]),
    'الإحصائيات: ما يكتبه الكود رُفض، أو نتيجة/مركز مجهول أو حقل غريب أو اسم/مفتاح طويل قُبل');
  r.ok(RW4('A', [['users/A/stats/currentStreak', 0]], withU({ stats: { currentStreak: 4 } })) && RW4('A', [['users/A/stats/currentStreak', 5]], withU({ stats: { currentStreak: 4 } }))
    && !RW4('A', [['users/A/stats/currentStreak', 9]], withU({ stats: { currentStreak: 4 } })) && !RW4('A', [['users/A/stats/currentStreak', 6]], withU({ stats: { currentStreak: 4 } }))
    && RW4('A', [['users/A/stats/currentStreak', 1]]) && !RW4('A', [['users/A/stats/currentStreak', 5]]),
    'سلسلة الانتصارات: زيادة واحدة أو العودة صفراً رُفضت، أو قفزة قُبلت');
  r.ok(RW4('A', [['users/A/achievements/win_streak_5', { unlockedAt: T4 }]]) && !RW4('A', [['users/A/achievements/win_streak_5', { unlockedAt: T4, x: 1 }]])
    && !RW4('A', [['users/A/achievements/' + 'x'.repeat(33), { unlockedAt: T4 }]]), 'الإنجازات: الصحيح رُفض أو حقل غريب/مفتاح طويل قُبل');
  // العقد الحاوية لا تقبل قيمة مفردة بدل أبنائها (نص طويل بدل الإحصائيات كلها يتخطّى قواعد الأبناء)، والملف العام كذلك
  // (يقرؤه المتصدرون كله لكل لاعب)؛ وعدّادات المحلي القديمة (يكتبها الملف الجديد) أرقام
  const leafAt = ['users/A/stats', 'users/A/stats/ai', 'users/A/stats/ai/history', 'users/A/stats/ai/history/1950000000000', 'users/A/stats/local',
    'users/A/stats/local/vs_x', 'users/A/stats/local/vs_x/history', 'users/A/stats/local/vs_x/history/1950000000000', 'users/A/stats/online', 'users/A/stats/online/B',
    'users/A/stats/online/B/history', 'users/A/stats/online/B/history/1950000000000', 'users/A/stats/multi', 'users/A/stats/multi/history',
    'users/A/stats/multi/history/1950000000000', 'users/A/achievements', 'users/A/achievements/first_win', 'users/A/matchHistory', 'users/A/matchHistory/-Nx1', 'profiles/A'];
  const leafOk = leafAt.filter(p => RW4('A', [[p, 'x'.repeat(5000)]]) || RW4('A', [[p, 7]]));
  r.ok(leafOk.length === 0 && RW4('A', [['users/A/stats/local', { wins: 0, losses: 0 }]]) && RW4('A', [['users/A/stats/local/wins', 3]]) && !RW4('A', [['users/A/stats/local/wins', -1]])
    && !RW4('A', [['users/A/stats/local/wins', { name: 'x' }]]) && !RW4('A', [['users/A/stats/multi/history/1950000000000', { rank: 1, players: 3 }]])
    && !RW4('A', [['users/A/achievements/first_win', { other: 1 }]]),
    `العقد الحاوية: قيمة مفردة قُبلت بدل الأبناء (${leafOk.join('، ')})، أو عدّادات المحلي/سجل ناقص الحقول بخلاف المتوقع`);
  // سجل المباريات: المدخل كما يكتبه saveMatch (كل الأنماط)، ولا نتيجة/نمط مجهول ولا نقاط فوق 200 ولا حقل غريب ولا نص طويل
  const MH = 'users/A/matchHistory/-Nx1';
  const mh = (x = {}) => ({ mode: 'online', result: 'win', myScore: 9, oppScore: 7, vs: 'باسل', grid: '4x4', duration: 95, ts: T4, ...x });
  r.ok(RW4('A', [[MH, mh()]]) && RW4('A', [[MH, mh({ mode: 'multi', result: 'draw', oppScore: 0, vs: '' })]]) && RW4('A', [[MH, mh({ mode: 'ai', vs: 'الكمبيوتر', grid: '6x6' })]])
    && RW4('A', [[MH, mh({ mode: 'local', result: 'loss', vs: 'ن'.repeat(128) })]]) && !RW4('A', [[MH, mh({ mode: 'هكر' })]]) && !RW4('A', [[MH, mh({ result: 'بطل' })]])
    && !RW4('A', [[MH, mh({ myScore: 201 })]]) && !RW4('A', [[MH, mh({ oppScore: -1 })]]) && !RW4('A', [[MH, mh({ vs: 'ن'.repeat(129) })]]) && !RW4('A', [[MH, mh({ grid: 'x'.repeat(9) })]])
    && !RW4('A', [[MH, mh({ duration: -5 })]]) && !RW4('A', [[MH, mh({ ts: 'أمس' })]]) && !RW4('A', [[MH, mh({ junk: 'x'.repeat(5000) })]])
    && !RW4('A', [['users/A/matchHistory/' + 'k'.repeat(33), mh()]]) && RW4('A', [['users/A/matchHistory', null]]) && !RW4('A', [[MH, { mode: 'ai', result: 'win' }]]),
    'سجل المباريات: مدخل حقيقي (أو مسح السجل) رُفض، أو نمط/نتيجة مجهولة أو نقاط/مدة خارج الحدود أو نص طويل أو حقل غريب أو مفتاح طويل قُبل');
  // تحدي اليوم: نتيجة واحدة لا تُعدَّل ولا تُحذف، بوقت الخادم، والفوز بنقاط أكثر ولوحة كاملة (9/16/25) ومدة ≥5 ثوانٍ، والتعادل متساوٍ
  const D = 'dailyChallenges/2026-11-12/results/A';
  const dres = (x = {}) => ({ result: 'win', myScore: 9, oppScore: 7, duration: 95, name: 'أ', ts: SV, ...x });
  const played = tree(() => {}); played.dailyChallenges = { '2026-11-12': { results: { A: { result: 'loss', myScore: 3, oppScore: 6, duration: 40, name: 'أ', ts: T4 - 1000 } } } };
  const { ts: _dropTs, ...dailyNoTs } = dres({ result: 'loss', myScore: 3, oppScore: 6 });
  r.ok(RW4('A', [[D, dres()]]) && !RW4('A', [[D, dres()]], played) && !RW4('A', [[D, null]], played) && !RW4('A', [[D + '/result', 'win']], played)
    && !RW4('A', [[D, dailyNoTs]]) && !RW4('A', [[D + '/result', 'loss']]),
    'تحدي اليوم: النتيجة الأولى رُفضت، أو كتابة فوقها (خسارة تصير فوزاً) أو حذفها أو نتيجة ناقصة (بلا وقت) قُبلت');
  r.ok(!RW4('A', [[D, dres({ myScore: 7, oppScore: 9 })]]) && !RW4('A', [[D, dres({ myScore: 10 })]]) && !RW4('A', [[D, dres({ duration: 3 })]])
    && !RW4('A', [[D, dres({ result: 'draw', myScore: 9 })]]) && RW4('A', [[D, dres({ result: 'draw', myScore: 8, oppScore: 8 })]])
    && RW4('A', [[D, dres({ result: 'loss', myScore: 3, oppScore: 2, duration: 2 })]]) && !RW4('A', [[D, dres({ result: 'loss', myScore: 20, oppScore: 6 })]])
    && RW4('A', [[D, dres({ myScore: 25, oppScore: 0, duration: 60 })]]) && !RW4('A', [['dailyChallenges/2026-11/results/A', dres()]]),
    'تحدي اليوم: فوز بنقاط أقل أو لوحة ناقصة/مدة قصيرة أو تعادل غير متساوٍ أو مجموع فوق 25 أو تاريخ مشوّه قُبل، أو نتيجة حقيقية (تعادل/خسارة بانسحاب) رُفضت');
  // ── 3.3ج-5أ: الشكل في كل مكان — ملف اللاعب بحقوله وحدودها، والحضور، والمفاتيح بحدّها (والحاويات والقوائم في الفحصين الدائمين) ──
  const N = (n) => 'ن'.repeat(n);
  r.ok(RW4('A', [['users/A/uid', 'A']]) && !RW4('A', [['users/A/uid', 'B']]) && RW4('A', [['users/A/name', N(128)]]) && !RW4('A', [['users/A/name', N(129)]])
    && RW4('A', [['users/A/photo', 'h'.repeat(1024)]]) && !RW4('A', [['users/A/photo', 'h'.repeat(1025)]]) && !RW4('A', [['users/A/joinedAt', 'أمس']]) && !RW4('A', [['users/A/lastSeen', 'الآن']])
    && RW4('A', [['users/A/lastSeen', T4]]) && !RW4('A', [['users/A/junk', 1]]) && !RW4('A', [['users/A/email', 'a@b.c']]) && RW4('A', [['users/A/email', null]], withU({ email: 'old@x.y' }))
    && RW4('N', [['users/N/uid', 'N'], ['users/N/name', 'جديد'], ['users/N/photo', ''], ['users/N/joinedAt', T4], ['users/N/stats', { ai: { wins: 0, losses: 0 }, local: { wins: 0, losses: 0 } }]]),
    'ملف اللاعب: ما يكتبه الكود (إنشاء الملف، مسح الإيميل القديم) رُفض، أو معرّف غيره/اسم أو صورة فوق الحدّ/وقت ليس رقماً/حقل غريب/إيميل قُبل');
  const pres = (x = {}) => ({ state: 'playing', lastSeen: T4, by: 'abc12345:playing', ...x });
  r.ok(RW4('A', [['users/A/presence', pres()]]) && RW4('A', [['users/A/presence', pres({ state: 'offline', by: 'b'.repeat(64) })]]) && RW4('A', [['users/A/presence', pres({ state: 'away' })]])
    && RW4('A', [['users/A/presence', pres({ state: 'online' })]]) && !RW4('A', [['users/A/presence', pres({ state: 'hacked' })]]) && !RW4('A', [['users/A/presence', pres({ by: 'b'.repeat(65) })]])
    && !RW4('A', [['users/A/presence', pres({ lastSeen: 'الآن' })]]) && !RW4('A', [['users/A/presence', pres({ junk: 1 })]]) && !RW4('B', [['users/A/presence', pres()]]),
    'الحضور: حالة حقيقية رُفضت، أو حالة مجهولة/وسم طويل/وقت ليس رقماً/حقل غريب قُبل، أو كتبه غير صاحبه');
  r.ok(RW4('A', [['users/A/learnedPowers/water', true]]) && RW4('A', [['users/A/learnedPowers/' + 'k'.repeat(32), true]]) && !RW4('A', [['users/A/learnedPowers/' + 'k'.repeat(33), true]])
    && !RW4('A', [['users/A/learnedPowers/water', false]]) && !RW4('A', [['users/A/learnedPowers/water', 'yes']]) && !RW4('A', [['users/A/learnedPowers/water', { a: 1 }]])
    && RW4('A', [['users/A/lastRead/' + 'k'.repeat(300), T4]]) && !RW4('A', [['users/A/lastRead/' + 'k'.repeat(301), T4]]),
    'الأدوات المتعلَّمة و"قرأتُ حتى": المكتوب الحقيقي رُفض، أو قيمة غير "نعم" أو مفتاح فوق الحدّ قُبل');
  // الغرف: رقم الغرفة ومعرّف المقعد والمشاهد بحدّها، والإعدادات بحقليها
  const U128 = 'u'.repeat(128), U129 = 'u'.repeat(129);
  const lj = (u) => ({ ...lobby, players: { ...lobby.players, [u]: { name: 'ب', num: 2, active: true } }, playerCount: 2 });
  r.ok(RW('A', [['rooms/' + '1'.repeat(16), duoWaiting]], rooms0) && !RW('A', [['rooms/' + '1'.repeat(17), duoWaiting]], rooms0)
    && !RW('A', [['rooms/999999', { ...duoWaiting, cfg: { rows: 4 } }]], rooms0) && !RW('A', [['rooms/999999', { ...duoWaiting, cfg: 'x'.repeat(5000) }]], rooms0)
    && RW(U128, [['rooms/333333', lj(U128)]], rooms0) && !RW(U129, [['rooms/333333', lj(U129)]], rooms0)
    && RW(U128, [['rooms/222222/spectators/' + U128, { name: 'م', at: T0 }]], rooms0) && !RW(U129, [['rooms/222222/spectators/' + U129, { name: 'م', at: T0 }]], rooms0),
    'الغرف: رقم غرفة/مقعد/مشاهد ضمن الحدّ رُفض، أو فوق الحدّ قُبل، أو إعدادات ناقصة/قيمة مفردة قُبلت');
  // (مراجعة ج-5أ) حدّ معرّف المنشئ عند إنشاء غرفة جديدة — المسح لا يكتب إلا غرفاً قائمة (حيث يرفض ثبات المعرّف أولاً)
  r.ok(RW('A', [['rooms/444444', { ...lobby, p1uid: 'A' }]], rooms0) && !RW('A', [['rooms/444444', { ...lobby, p1uid: 'A'.repeat(129) }]], rooms0),
    'إنشاء غرفة: معرّف منشئ عادي رُفض أو فوق 128 قُبل');
  // ── 3.3ج-5ب: فهرس الغرف المفتوحة وأعمار الغرف — قراءة باستعلام محدود فقط، وكتابة منشئ غرفته المفتوحة وحده ──
  {
    const NOWX = T0 + 60_000, HOUR = 3_600_000;
    const pubDuo = { ...duoWaiting, public: true };
    const pubLobby = { ...lobby, public: true };
    const lobbyAB = { ...pubLobby, players: { A: { name: 'أ', num: 1, active: true }, B: { name: 'ب', num: 2, active: true } }, playerCount: 2 };
    const ix = withRooms({ '111111': pubDuo, '222222': duoPlaying, '333333': pubLobby, '666666': duoWaiting,
      '121212': pubDuo, '131313': { ...duoPlaying, createdAt: T0 - HOUR - 120_000 }, '141414': lobbyAB, '151515': pubDuo, '161616': pubLobby,
      '474747': { ...pubLobby, maxPlayers: 4 }, '484848': { ...duoPlaying, createdAt: NOWX } });
    ix.openRooms = { d: { 4: { '111111': { t: T0, u: 'A' }, '222222': { t: T0, u: 'A' }, '999999': { t: T0, u: 'A' },
      '121212': { t: NOWX - HOUR - 1000, u: 'A' } }, 5: { '111111': { t: T0, u: 'A' } } },
      m3: { 4: { '333333': { t: T0, u: 'A' }, '141414': { t: T0, u: 'A' }, '474747': { t: T0, u: 'A' } } } };
    // 3.3ج-5ج: العمر { t، k: التذكرة } مع تذكرته في ageList وageCode
    const ages = { '111111': T0, '222222': T0, '333333': T0, '999999': T0, '131313': T0 - HOUR - 120_000, '484848': T0 - HOUR - 120_000 };
    ix.roomAge = {}; ix.ageList = {}; ix.ageCode = {};
    for (const [c, t] of Object.entries(ages)) { ix.roomAge[c] = { t, k: 'old' + c }; ix.ageList['old' + c] = t; ix.ageCode['old' + c] = c; }
    const X = (uid, writes) => checkWrite(NEW, writes, { uid, root: ix, now: NOWX }).ok;
    const QR = (uid, p, query) => canRead(NEW, p, { uid, root: ix, now: NOWX, query });
    const E = (u = 'A', extra = {}) => ({ t: SV, u, ...extra });
    const AG = (code, tok = 'tk' + code) => [['roomAge/' + code, { t: SV, k: tok }], ['ageList/' + tok, SV], ['ageCode/' + tok, code]];   // 3.3ج-5ج
    // القراءة: الفهرس باستعلام الأقدم أولاً وبحدّ 10 فقط (الأعمار: قسم 5ج أدناه)
    r.ok(QR('V', 'openRooms/d/4', { orderByChild: 't', limitToFirst: 10 }) && QR('V', 'openRooms/m3/4', { orderByChild: 't', limitToFirst: 5 }),
      '5ب: قراءة الفهرس باستعلامه المسموح رُفضت');
    r.ok(!QR('V', 'openRooms', null) && !QR('V', 'openRooms/d', null) && !QR('V', 'openRooms/d/4', null)
      && !QR('V', 'openRooms/d/4', { orderByChild: 't', limitToFirst: 11 }) && !QR('V', 'openRooms/d/4', { orderByChild: 'u', limitToFirst: 10 })
      && !QR('V', 'openRooms/d/4', { orderByChild: 't', limitToLast: 10 }) && !QR('V', 'openRooms/d/4', { orderByChild: 't' })
      && !QR(null, 'openRooms/d/4', { orderByChild: 't', limitToFirst: 10 }),
      '5ب: الفهرس يُقرأ كاملاً أو بلا حدّ أو بحدّ أكبر أو بترتيب آخر أو لزائر');
    // الكتابة: الغرفة وعمرها ومدخلها معاً من منشئها
    r.ok(X('A', [['rooms/444444', pubDuo], ...AG('444444'), ['openRooms/d/4/444444', E()]])
      && X('A', [['rooms/444444', duoWaiting], ...AG('444444')]) && X('A', [['rooms/444444', lobby], ...AG('444444')]),
      '5ب: إنشاء الغرفة مع عمرها (ومدخلها إن كانت عامة) رُفض');
    r.ok(X('A', [['rooms/333333/public', true], ['openRooms/m3/4/333333', E()]]) && X('A', [['openRooms/d/4/111111', E()]]),
      '5ب: مدخل غرفتي المفتوحة (أو تحديثه) رُفض');
    r.ok(!X('A', [['rooms/444444', pubDuo], ['openRooms/d/4/444444', E('V')]]) && !X('A', [['rooms/444444', pubDuo], ['openRooms/d/4/444444', E('A', { t: 5 })]])
      && !X('A', [['rooms/444444', pubDuo], ['openRooms/d/4/444444', E('A', { x: 1 })]]) && !X('A', [['rooms/444444', pubDuo], ['openRooms/d/4/444444', 'x']])
      && !X('A', [['rooms/444444', pubDuo], ['openRooms/x/4/444444', E()]]) && !X('A', [['rooms/444444', pubDuo], ['openRooms/d/100/444444', E()]])
      && !X('A', [['rooms/' + '4'.repeat(17), pubDuo], ['openRooms/d/4/' + '4'.repeat(17), E()]]),
      '5ب: مدخل باسم غيري، أو بوقت ليس وقت الخادم، أو بحقل غريب، أو قيمة مفردة، أو نوع/حجم/رمز خارج الحدّ — قُبل');
    r.ok(!X('A', [['openRooms/d/4/666666', E()]]) && !X('V', [['openRooms/d/4/111111', E('V')]]) && !X('A', [['openRooms/d/4/222222', E()]])
      && !X('A', [['openRooms/d/4/555555', E()]]) && !X('V', [['openRooms/m3/4/333333', E('V')]]) && !X('A', [['openRooms/m3/4/111111', E()]])
      && !X('A', [['openRooms/d/4/333333', E()]]) && !X('A', [['openRooms/zz/4/333333', E()]]),
      '5ب: مدخل لغرفة خاصة أو لغيري أو جارية أو غير موجودة أو لوبي لست فيه أو بنوع لا يطابقها أو خارج قائمة الأنواع — قُبل');
    // (طفرات) مدخل جديد لغرفة غيري المفتوحة بلا مدخل (ثنائية ولوبي)، وعضو لوبي يكتب فوق مدخل منشئه
    r.ok(!X('V', [['openRooms/d/4/151515', E('V')]]) && !X('V', [['openRooms/m3/4/161616', E('V')]]) && !X('B', [['openRooms/m3/4/141414', E('B')]])
      && X('A', [['openRooms/m3/4/161616', E()]]),
      '5ب: غريب يفهرس غرفة غيري المفتوحة باسمه، أو عضو لوبي يكتب فوق مدخل منشئه — قُبل');
    // المحو: صاحبه دائماً؛ وغيره حين لا تكون مفتوحة (اختفت/بدأت) أو المدخل أقدم من ساعة
    r.ok(X('A', [['openRooms/d/4/111111', null]]) && X('V', [['openRooms/d/4/222222', null]]) && X('V', [['openRooms/d/4/999999', null]])
      && X('V', [['openRooms/d/4/121212', null]]) && X('V', [['openRooms/d/4/777777', null]]),
      '5ب: محو المدخل من صاحبه، أو مدخل غرفته بدأت/اختفت، أو أقدم من ساعة — رُفض');
    r.ok(!X('V', [['openRooms/d/4/111111', null]]) && !X('V', [['openRooms/m3/4/333333', null]]),
      '5ب: غريب يمحو مدخل غرفة ما زالت مفتوحة (يخفيها عن الباحثين)');
    // (مراجعة ج-5ب H1) "مفتوحة" في القواعد = يدخلها الباحث فعلاً: الحجم يطابق المسار، والعدد يطابق النوع، وللثنائية اسم منشئ —
    // فلا مدخل لا يُدخل ولا يُمحى (يحجب الحجم كله)، ومدخلٌ لا يطابق (من قبل) يمحوه أي أحد
    const noName = { ...pubDuo }; delete noName.p1name;
    r.ok(!X('A', [['rooms/444444', pubDuo], ...AG('444444'), ['openRooms/d/5/444444', E()]])
      && !X('A', [['rooms/444444', noName], ...AG('444444'), ['openRooms/d/4/444444', E()]])
      && !X('A', [['rooms/444444', { ...pubLobby, maxPlayers: 4 }], ...AG('444444'), ['openRooms/m3/4/444444', E()]])
      && X('A', [['rooms/444444', { ...pubLobby, maxPlayers: 4 }], ...AG('444444'), ['openRooms/m4/4/444444', E()]]),
      '5ب: مدخل بحجم لا يطابق غرفته، أو لثنائية بلا اسم منشئ، أو لوبي 4 تحت نوع 3 — قُبل (أو المطابق رُفض)');
    // (مراجعة R1) غرفة "تنتظر" بعلامة نهاية أو مقاعد جماعية لا يدخلها أحد (قاعدة الانضمام) — فلا مدخل لها، ومدخلها القديم يمحوه أي أحد
    const marked = ['leftBy', 'abortedBy', 'dropped1', 'dropped2'].map(f => ({ ...pubDuo, [f]: f === 'leftBy' || f === 'abortedBy' ? 1 : true }))
      .concat([{ ...pubDuo, players: { A: { name: 'أ', num: 1, active: true } } }]);
    r.ok(marked.every(rm => !X('A', [['rooms/444444', rm], ...AG('444444'), ['openRooms/d/4/444444', E()]])),
      '5ب: مدخل لغرفة "تنتظر" بعلامة نهاية أو مقاعد جماعية (لا يدخلها أحد) قُبل');
    r.ok(marked.every(rm => { const b = JSON.parse(JSON.stringify(ix)); b.rooms['454545'] = rm; b.openRooms.d[4]['454545'] = { t: T0, u: 'A' };
      return checkWrite(NEW, [['openRooms/d/4/454545', null]], { uid: 'V', root: b, now: NOWX }).ok; }),
      '5ب: محو مدخل غرفة بعلامة نهاية رُفض لغير صاحبه');
    r.ok(X('V', [['openRooms/d/5/111111', null]]) && X('V', [['openRooms/m3/4/474747', null]]),
      '5ب: محو مدخل لا يطابق غرفته (حجماً أو عدداً) رُفض لغير صاحبه');
    // (مراجعة M1) غرفة دفع أحدٌ وقت إنشائها للأمام وعمرها أقدم من ساعة: تُمحى مع عمرها (لا يتعطّل التنظيف)
    r.ok(X('V', [['rooms/484848', null], ['roomAge/484848', null]]) && X('V', [['rooms/484848', null], ['roomAge/484848', null], ['ageList/old484848', null], ['ageCode/old484848', null]]),
      '5ب: غرفة عمرها أقدم من ساعة لا تُمحى لأن وقت إنشائها دُفع للأمام');
    // (مراجعة L3) المنضمّ للوبي عام لا يخفيه (لا يغيّر "عامة")
    const withV = (pub) => ({ ...pubLobby, ...(pub === undefined ? {} : { public: pub }), players: { ...pubLobby.players, V: { name: 'ض', num: 2, active: true } }, playerCount: 2 });
    r.ok(X('V', [['rooms/333333', withV()]]) && !X('V', [['rooms/333333', withV(false)]]),
      '5ب: الانضمام للوبي عام رُفض، أو قُبل مع إخفائه (public:false)');
    // الأعمار: يكتبها لاعب في الغرفة بوقت الخادم؛ وتُمحى فقط مع غرفتها أو بعدها
    r.ok(X('A', AG('111111')) && X('B', AG('222222')) && X('V', [['roomAge/999999', null]])
      && X('V', [['rooms/131313', null], ['roomAge/131313', null]]),
      '5ب: عمر يكتبه لاعب الغرفة، أو محو عمر بلا غرفة، أو غرفة قديمة مع عمرها — رُفض');
    r.ok(!X('V', AG('111111')) && !X('A', [['roomAge/111111', 5]]) && !X('A', AG('555555'))
      && !X('A', [['roomAge/111111', null]]) && !X('V', [['roomAge/222222', null]]) && !X('V', [['rooms/222222', null], ['roomAge/222222', null]])
      && !X('A', [['roomAge/111111', { t: SV }]]),
      '5ب: عمر من غريب، أو بوقت مصطنع، أو لغرفة غير موجودة، أو محو عمر غرفة باقية، أو غرفة حديثة مع عمرها، أو كائن — قُبل');
  }
  // ── 3.3ج-5ج: أعمار الغرف بتذاكر — القائمة بلا أرقام غرف، والرقم لا يُقرأ إلا بعد ساعة، والتذكرة مربوطة بغرفتها واحداً لواحد ──
  {
    const NOWX = T0 + 60_000, HOUR = 3_600_000, OLD = NOWX - HOUR - 120_000;
    const g = withRooms({ '111111': duoWaiting, '222222': duoPlaying, '333333': lobby, '444444': duoWaiting,
      '555555': { ...duoPlaying, createdAt: OLD }, '666666': { ...duoPlaying, createdAt: NOWX }, '121212': duoWaiting });
    // 111111 حديثة بتذكرتها tA؛ 555555 قديمة (tOld)؛ 444444 أُعيدت بتذكرة جديدة tNew وبقيت القديمة tStale؛ 666666 دُفع وقت
    // إنشائها للأمام وعمرها قديم (tPush)؛ 777777 مُسحت وبقي عمرها وتذكرتها (tGone)؛ tOrphan في القائمة بلا رقم؛ tEdge على حدّ الساعة
    g.roomAge = { '111111': { t: T0, k: 'tA' }, '555555': { t: OLD, k: 'tOld' }, '444444': { t: T0, k: 'tNew' },
      '666666': { t: OLD, k: 'tPush' }, '777777': { t: OLD, k: 'tGone' }, '121212': { t: OLD, k: 'tLost' } };   // tLost: حالة لا تُبلغ (دفاع)
    g.ageList = { tA: T0, tOld: OLD, tNew: T0, tStale: OLD, tPush: OLD, tGone: OLD, tOrphan: OLD, tEdge: NOWX - HOUR, tEdge1: NOWX - HOUR - 1 };
    g.ageCode = { tA: '111111', tOld: '555555', tNew: '444444', tStale: '444444', tPush: '666666', tGone: '777777', tEdge: '111111', tEdge1: '111111',
      tOrphC: '111111' };   // tOrphC: رقم بلا وقت (حالة لا تُبلغ — دفاع)
    const X = (uid, writes, root = g) => checkWrite(NEW, writes, { uid, root, now: NOWX }).ok;
    const QR = (uid, p, query = null) => canRead(NEW, p, { uid, root: g, now: NOWX, query });
    const AGE = (code, tok) => [['roomAge/' + code, { t: SV, k: tok }], ['ageList/' + tok, SV], ['ageCode/' + tok, code]];
    const PAIR = (tok) => [['ageList/' + tok, null], ['ageCode/' + tok, null]];
    const GONE = (code, tok) => [['rooms/' + code, null], ['roomAge/' + code, null], ...PAIR(tok)];
    // القراءة: القائمة باستعلام الأقدم أولاً وبحدّ 20 فقط (تذاكر وأوقات)؛ العمر نفسه لا يُقرأ؛ الرقم بعد ساعة فقط
    r.ok(QR('V', 'ageList', { orderByValue: true, limitToFirst: 20, endAt: NOWX - HOUR }) && QR('V', 'ageList', { orderByValue: true, limitToFirst: 5 }),
      '5ج: قراءة قائمة الأعمار باستعلامها رُفضت');
    r.ok(!QR('V', 'ageList') && !QR('V', 'ageList', { orderByValue: true, limitToFirst: 21 }) && !QR('V', 'ageList', { orderByValue: true })
      && !QR('V', 'ageList', { orderByKey: true, limitToFirst: 20 }) && !QR('V', 'ageList', { orderByChild: 't', limitToFirst: 20 })
      && !QR(null, 'ageList', { orderByValue: true, limitToFirst: 20 }) && !QR('V', 'ageList/tA'),
      '5ج: قائمة الأعمار تُقرأ كاملة أو بلا حدّ أو بحدّ أكبر أو بترتيب آخر أو لزائر');
    r.ok(!QR('V', 'roomAge') && !QR('V', 'roomAge', { orderByValue: true, limitToFirst: 20 }) && !QR('A', 'roomAge/111111')
      && !QR('V', 'roomAge/555555') && !QR('V', 'ageCode'),
      '5ج: العمر (بأرقام الغرف) أو شجرة الأرقام تُقرأ');
    r.ok(QR('V', 'ageCode/tOld') && QR('V', 'ageCode/tStale') && QR('V', 'ageCode/tEdge1') && QR('V', 'ageCode/tOrphan'),
      '5ج: رقم غرفة تذكرتها أقدم من ساعة لا يُقرأ (التنظيف يتعطّل)');
    r.ok(!QR('V', 'ageCode/tA') && !QR('A', 'ageCode/tA') && !QR('V', 'ageCode/tNew') && !QR('V', 'ageCode/tEdge')
      && !QR('V', 'ageCode/tMissing') && !QR(null, 'ageCode/tOld'),
      '5ج: رقم غرفة حديثة (أقل من ساعة) يُقرأ، أو بلا تذكرة، أو لزائر');
    // الإنشاء: الغرفة والعمر والتذكرة في كتابة واحدة من منشئها
    r.ok(X('A', [['rooms/888888', duoWaiting], ...AGE('888888', 'tN1')]) && X('A', [['rooms/888888', lobby], ...AGE('888888', 'tN1')])
      && X('A', [['rooms/888888', { ...duoWaiting, public: true }], ...AGE('888888', 'tN1'), ['openRooms/d/4/888888', { t: SV, u: 'A' }]])
      && X('A', [['rooms/888888', duoWaiting], ...AGE('888888', 'y'.repeat(32))]),
      '5ج: إنشاء الغرفة مع عمرها وتذكرتها رُفض');
    r.ok(!X('A', [['rooms/888888', duoWaiting], ['roomAge/888888', { t: SV, k: 'tN1' }]])
      && !X('A', [['rooms/888888', duoWaiting], ['roomAge/888888', { t: SV, k: 'tN1' }], ['ageList/tN1', SV]])
      && !X('A', [['rooms/888888', duoWaiting], ['roomAge/888888', { t: SV, k: 'tN1' }], ['ageCode/tN1', '888888']])
      && !X('A', [['rooms/888888', duoWaiting], ['roomAge/888888', SV]]),
      '5ج: عمر بلا تذكرة كاملة (أو بالشكل القديم) قُبل — غرفة لا يجدها التنظيف');
    r.ok(!X('A', [['rooms/888888', duoWaiting], ['roomAge/888888', { t: SV, k: 'tN1' }], ['ageList/tN1', SV], ['ageCode/tN1', '111111']])
      && !X('A', [['rooms/888888', duoWaiting], ['roomAge/888888', { t: SV, k: 'tN1' }], ['ageList/tN1', 5], ['ageCode/tN1', '888888']])
      && !X('A', [['rooms/888888', duoWaiting], ['roomAge/888888', { t: 5, k: 'tN1' }], ['ageList/tN1', SV], ['ageCode/tN1', '888888']])
      && !X('A', [['rooms/888888', duoWaiting], ['roomAge/888888', { t: SV, k: 'tN1' }], ['ageList/tN1', SV], ['ageCode/tN1', 888888]])
      && !X('A', [['rooms/888888', duoWaiting], ['roomAge/888888', { t: SV, k: 'tN1', x: 1 }], ['ageList/tN1', SV], ['ageCode/tN1', '888888']])
      && !X('A', [['rooms/888888', duoWaiting], ...AGE('888888', 'z'.repeat(33))]),
      '5ج: تذكرة لرقم آخر، أو بوقت مصطنع، أو رقم ليس نصاً، أو حقل غريب، أو تذكرة فوق 32 — قُبلت');
    r.ok(!X('A', [['rooms/888888', duoWaiting], ...AGE('888888', 'tOrphan')]) && !X('A', [['rooms/888888', duoWaiting], ...AGE('888888', 'tA')])
      && !X('A', [['rooms/888888', duoWaiting], ['roomAge/888888', { t: SV, k: 'tA' }], ['ageList/tN1', SV], ['ageCode/tN1', '888888']])
      && !X('A', [['rooms/888888', duoWaiting], ...AGE('888888', 'tN1'), ['ageList/tN2', SV], ['ageCode/tN2', '888888']]),
      '5ج: تذكرة قائمة تُستعمل لغرفة أخرى، أو عمر يشير لتذكرة غيره، أو تذكرتان لغرفة واحدة — قُبل');
    // (طفرات) تذكرة واحدة لغرفتين (الثانية لا يجدها التنظيف)، ورقم بلا وقت (بقايا لا تُمحى)، ودفاع عن حالتين لا تُبلغان
    r.ok(!X('A', [['roomAge/111111', { t: SV, k: 'tS' }], ['roomAge/444444', { t: SV, k: 'tS' }], ['ageList/tS', SV], ['ageCode/tS', '111111']]),
      '5ج: تذكرة واحدة لغرفتين قُبلت');
    r.ok(!X('V', [['ageCode/tJunk', '111111']]) && !X('A', [['ageCode/tJunk', '111111']]), '5ج: رقم بلا وقته (بقايا لا تُقرأ ولا تُمحى) يُكتب');
    r.ok(!X('A', [['ageList/tLost', SV], ['ageCode/tLost', '121212']]) && !X('A', [...AGE('444444', 'tOrphC')]),
      '5ج: تذكرة بلا عمر جديد، أو رقم قائم يُعاد ربطه — قُبل');
    r.ok(!X('V', AGE('111111', 'tN1')) && !X('A', AGE('999998', 'tN1')) && !X('A', [['ageList/tN1', SV], ['ageCode/tN1', '111111']])
      && !X('A', [['ageList/tN1', SV], ['ageCode/tN1', '999998']]),
      '5ج: تذكرة لغرفة لست فيها، أو لغرفة غير موجودة، أو بلا عمر جديد — قُبلت');
    // الإعادة (غرفة اختفت وأُعيدت): لاعب الغرفة يربطها بتذكرة جديدة، والقديمة تصير قابلة للمحو وحدها
    r.ok(X('A', AGE('111111', 'tR')) && X('B', AGE('222222', 'tR')), '5ج: لاعب الغرفة لا يستطيع ربطها بتذكرة جديدة (الإعادة تفشل)');
    {
      const after = checkWrite(NEW, AGE('111111', 'tR'), { uid: 'A', root: g, now: NOWX }).newRoot;
      r.ok(X('V', PAIR('tA'), after) && !X('V', PAIR('tR'), after), '5ج: بعد الإعادة، التذكرة القديمة لا تُمحى أو الجديدة تُمحى');
    }
    r.ok(!X('A', [['roomAge/111111', { t: SV, k: 'tOld' }]]) && !X('A', [['roomAge/111111/t', SV]]) && !X('A', [['ageCode/tA', '222222']])
      && !X('A', [['ageList/tA', SV]]) && !X('A', [['ageList/tOld', SV]]),
      '5ج: ربط غرفة بتذكرة قائمة، أو تجديد وقت العمر وحده، أو تغيير رقم تذكرة أو وقتها — قُبل');
    // المحو: التذكرة مع غرفتها وعمرها، أو وحدها حين لم تعد تذكرة غرفتها
    r.ok(X('V', GONE('555555', 'tOld')) && X('V', GONE('666666', 'tPush')) && X('V', GONE('777777', 'tGone'))
      && X('A', GONE('111111', 'tA')) && X('V', PAIR('tStale')) && X('V', PAIR('tOrphan')) && X('V', [['ageList/tOrphan', null]]),
      '5ج: تنظيف غرفة قديمة مع عمرها وتذكرتها، أو تذكرة لم تعد لغرفتها، أو بقايا — رُفض');
    r.ok(!X('V', PAIR('tA')) && !X('A', PAIR('tA')) && !X('V', GONE('111111', 'tA')) && !X('V', [['roomAge/111111', null], ...PAIR('tA')])
      && !X('V', PAIR('tGone')) && !X('V', PAIR('tNew')),
      '5ج: تذكرة غرفة حيّة (أو غرفة حديثة) تُمحى — غرفة لا يجدها التنظيف');
    r.ok(!X('V', [['ageList/tStale', null]]) && !X('V', [['ageCode/tStale', null]]) && !X('V', [['ageCode/tA', null]]),
      '5ج: نصف تذكرة يُمحى (رقم بلا وقت يبقى للأبد، أو وقت بلا رقم)');
  }
  // ولماذا كان لا بدّ منها: القواعد السابقة ترفض الطلب والحذف والقبول
  r.ok(!W(OLD, 'A', [['users/B/friendRequests/A', { name: 'أ' }]]) && !W(OLD, 'A', [['users/B/friends/A', null]])
    && !W(OLD, 'A', [['users/B/friends/A', { name: 'أ' }]], withToken), 'القواعد السابقة كانت تسمح بالأصدقاء (التشخيص خاطئ؟)');
  return r;
}

// ─── 3.3ج-5أ: الفحص الدائم لشكل القواعد — يمنع عودة صنف "قيمة مفردة مكان الحاوية / مفتاح غريب / نص بلا حدّ" ───
// (1) بنيوي: يقرأ ملف القواعد نفسه. لكل عقدة يستطيع أحدٌ كتابتها (فيها أو فوقها .write غير false):
//     ح1 — الحاوية (لها قواعد أبناء) كائن: ‎.validate‏ فيه newData.hasChildren(
//     ح2 — كل مستوى بقائمة مفاتيحه: له ابن $ (‎$other: false‏ أو متغيّر بقواعده) — فلا مفتاح بلا قاعدة
//     ح3 — الورقة بنوعها وحدّها: رقم/منطقي/قيمة من قائمة (===)، أو نص معه حدّ طول؛ أو مرفوضة (false)
//     قاعدة جديدة تخالف واحدة من الثلاث تكسر هذا الفحص قبل أن تُنشر.
export function lintRules(rulesObj) {
  const out = { containers: [], levels: [], leaves: [] };
  const isOff = v => v === false || v === 'false';
  (function walk(n, ps, writable) {
    if (!n || typeof n !== 'object') return;
    const w = writable || (n['.write'] !== undefined && !isOff(n['.write']));
    const kids = Object.keys(n).filter(k => !k.startsWith('.'));
    const v = n['.validate'];
    const at = '/' + ps.join('/');
    if (w && ps.length) {
      if (kids.length) {
        if (typeof v !== 'string' || !v.includes('newData.hasChildren(')) out.containers.push(at);
        if (!kids.some(k => k.startsWith('$'))) out.levels.push(at);
      } else if (!isOff(v)) {
        const t = typeof v === 'string' ? v : '';
        const typed = /newData\.isNumber\(\)|newData\.isBoolean\(\)|newData\.val\(\) === /.test(t)
          || (/newData\.isString\(\)/.test(t) && /newData\.val\(\)\.length (<=|===) \d/.test(t));
        if (!typed) out.leaves.push(at);
      }
    }
    for (const k of kids) walk(n[k], ps.concat(k), w);
  })(rulesObj && rulesObj.rules !== undefined ? rulesObj.rules : rulesObj, [], false);
  return out;
}
export function rulesLint() {
  const r = checker('شكل القواعد (فحص بنيوي دائم — 3.3ج-5أ): كل حاوية كائن، وكل مستوى بقائمة مفاتيحه، وكل ورقة بنوعها وحدّها');
  let NEW;
  try { NEW = load(RULES_FILE); } catch (e) { r.ok(false, 'database.rules.json: ' + e.message); return r; }
  const L = lintRules(NEW);
  r.ok(L.containers.length === 0, `حاوية قابلة للكتابة بلا فحص نوع (hasChildren): ${L.containers.join('، ')}`);
  r.ok(L.levels.length === 0, `مستوى قابل للكتابة بلا قائمة مفاتيح ($other أو متغيّر): ${L.levels.join('، ')}`);
  r.ok(L.leaves.length === 0, `ورقة قابلة للكتابة بلا نوع أو بلا حدّ طول: ${L.leaves.join('، ')}`);
  // والفحص نفسه يلتقط المخالفات (قواعد صغيرة فيها الأصناف الثلاثة — وما لا يُكتب أو يُرفض لا يُعدّ)
  const bad = lintRules({ rules: {
    closed: { '.write': false, box: { a: {} } },
    open: { '$id': { '.write': 'auth !== null', box: { a: { '.validate': 'newData.isNumber()' } },
      list: { '.validate': 'newData.hasChildren()', '$k': { '.validate': 'newData.isString()' } },
      ok: { '.validate': "newData.isString() && newData.val().length <= 8" }, no: { '.validate': false }, raw: {},
      '$other': { '.validate': false } } },
  } });
  r.ok(bad.containers.join() === '/open/$id,/open/$id/box' && bad.levels.join() === '/open/$id/box'
    && bad.leaves.join() === '/open/$id/list/$k,/open/$id/raw',
    `الفحص البنيوي لا يلتقط المخالفات كما ينبغي: ${JSON.stringify(bad)}`);
  return r;
}

// (2) مسح حيّ بمحرّك القواعد: على شجرة بيانات غنية (كل مسار فيها قائم وصاحبه/عضوه معروف)، لكل مسار في ملف القواعد:
//     قيمة مفردة (نص طويل/رقم/منطقي) مكان كل حاوية، ومفتاح غريب تحت كل مستوى، ونص 5000 حرف في كل ورقة — من صاحب
//     الحق (أ) ومن الطرف الآخر (ب) ومن ثالث (ج). لا شيء منها يُقبل.
const SWEEP_T = 1_950_000_000_000, SWEEP_DAY = '2026-11-12';
const sweepBase = () => {
  const T = SWEEP_T;
  return {
    users: {
      A: { uid: 'A', name: 'أ', photo: '', xp: 100, coins: 50, joinedAt: T - 1e9, lastSeen: T - 1000,
        friends: { B: { uid: 'B', name: 'ب', photo: '', since: T - 1e6 } },
        friendRequests: { C: { uid: 'C', name: 'ج', photo: '', sentAt: T - 1000 } },
        sentRequests: { D: T - 1000 }, requestCooldown: { B: T - 1e9 }, lastRead: { A_B: T - 1000 }, learnedPowers: { water: true },
        stats: { ai: { wins: 1, losses: 0, history: { [T - 5000]: { r: 'w' } } },
          local: { wins: 0, losses: 0, vs_x: { name: 'x', history: { [T - 5000]: { r: 'l' } } } },
          online: { B: { name: 'ب', history: { [T - 5000]: { r: 'd' } } } },
          multi: { history: { [T - 5000]: { rank: 1, players: 3, score: 5 } } }, currentStreak: 1 },
        achievements: { first_win: { unlockedAt: T - 1000 } },
        matchHistory: { m1: { mode: 'ai', result: 'win', myScore: 5, oppScore: 4, vs: 'الكمبيوتر', grid: '4x4', duration: 60, ts: T - 1000 } },
        presence: { state: 'online', lastSeen: T - 1000, by: 'abc:online' } },
      B: { uid: 'B', name: 'ب', friends: { A: { uid: 'A', name: 'أ', photo: '', since: T - 1e6 } }, sentRequests: { A: T - 1e9 } },
      C: { uid: 'C', name: 'ج', sentRequests: { A: T - 1000 } },
    },
    profiles: { A: { name: 'أ', photo: '', xp: 100 }, B: { name: 'ب', photo: '', xp: 0 } },
    chats: { A_B: { m1: { fromUid: 'A', fromName: 'أ', text: 'هلا', ts: T - 1000, status: 'sent' } } },
    rooms: {
      R1: { status: 'playing', cfg: { rows: 4, cols: 4 }, p1uid: 'A', p1name: 'أ', p2uid: 'B', p2name: 'ب', createdAt: T - 1e5, public: false,
        turn: 1, move: { key: 'h_0_0', by: 1, seq: 1 }, moves: { m1: { key: 'h_0_0', by: 1, seq: 1 } }, elementMap: { '0,0': 'gem' },
        clock: { banks: { 1: 100, 2: 100 }, currentPlayer: 1, turnStartAt: T - 1000 }, signals: { restart: 1, ts: T - 1000 },
        bankUpdate: { player: 1, bank: 90, seq: 1, by: 1 }, spectators: { C: { name: 'ج', at: T - 1000 } } },
      M1: { status: 'lobby', multi: true, hostUid: 'A', hostNum: 1, maxPlayers: 4, playerCount: 2, createdAt: T - 1e5, cfg: { rows: 4, cols: 4 },
        players: { A: { name: 'أ', num: 1, active: true }, B: { name: 'ب', num: 2, active: true } },
        approval: { state: 'asking', available: 2, wanted: 2, startedAt: T - 1000, decisions: { 1: 'accepted' } } },
      // 3.3ج-5ب: غرفة ثنائية عامة تنتظر (لها مدخل في الفهرس)
      R2: { status: 'waiting', public: true, cfg: { rows: 4, cols: 4 }, p1uid: 'A', p1name: 'أ', p2uid: '', p2name: '', createdAt: T - 1e5,
        move: { key: '', by: 0, seq: 0 } },
    },
    openRooms: { d: { 4: { R2: { t: T - 1e5, u: 'A' } } } },
    roomAge: { R1: { t: T - 1e5, k: 'tokR1' }, R2: { t: T - 1e5, k: 'tokR2' }, M1: { t: T - 1e5, k: 'tokM1' } },   // 3.3ج-5ج
    ageList: { tokR1: T - 1e5, tokR2: T - 1e5, tokM1: T - 1e5 },
    ageCode: { tokR1: 'R1', tokR2: 'R2', tokM1: 'M1' },
    invites: { B: { fromUid: 'A', fromName: 'أ', roomCode: 'R1', cfg: { rows: 4, cols: 4 }, sentAt: T - 1000 } },
    inviteRejections: { A: { rejectedBy: 'B', name: 'ب', roomCode: 'R1', ts: T - 1000, reason: 'rejected' } },
    dailyChallenges: { [SWEEP_DAY]: { results: { B: { result: 'win', myScore: 9, oppScore: 0, duration: 50, name: 'ب', ts: T - 1000 } } } },
  };
};
export function rulesShapeSweep() {
  const r = checker('شكل القواعد (مسح حيّ دائم — 3.3ج-5أ): لا قيمة مفردة مكان حاوية، ولا مفتاح غريب، ولا نص طويل — في أي مسار');
  let NEW;
  try { NEW = load(RULES_FILE); } catch (e) { r.ok(false, 'database.rules.json: ' + e.message); return r; }
  const base = sweepBase();
  // متغيّرات المسارات ← قيم قائمة في الشجرة (متغيّر جديد بلا قيمة هنا يأخذ X — يُمسح أيضاً)
  const sub = { $uid: 'A', $fromUid: 'C', $friendUid: 'B', $toUid: 'B', $ts: String(SWEEP_T - 5000), $key: 'vs_x', $opp: 'B', $ach: 'first_win',
    $mid: 'm1', $code: 'R1', $msgid: 'm1', $date: SWEEP_DAY, $type: 'water', $cell: '0,0', $n: '1', $kind: 'd', $rows: '4', $tok: 'tokR1' };
  const conc = ps => ps.map(k => (k.startsWith('$') ? (sub[k] ?? 'X') : k)).join('/');
  const containers = new Set(), leaves = new Set();
  (function walk(n, ps) {
    if (!n || typeof n !== 'object') return;
    const kids = Object.keys(n).filter(k => !k.startsWith('.'));
    if (!ps.length) { kids.forEach(k => walk(n[k], [k])); return; }
    if (kids.length) containers.add(conc(ps)); else leaves.add(conc(ps));
    for (const k of kids) walk(n[k], ps.concat(k));
  })(NEW.rules, []);
  // مسارات قائمة لا يولّدها الاستبدال الواحد (الغرفة الجماعية، مفتاح المحادثة، مدخلي في قائمة غيري…)
  ['rooms/M1', 'rooms/M1/players', 'rooms/M1/players/A', 'rooms/M1/players/B', 'rooms/M1/approval', 'rooms/M1/approval/decisions', 'rooms/R1/spectators/C',
    'users/B/friends/A', 'users/A/friendRequests/C', 'users/B', 'users/A/lastRead', 'chats/A_B/m1', 'invites/B', 'inviteRejections/A',
    'dailyChallenges/' + SWEEP_DAY + '/results/A', 'profiles/A', 'users/A/stats/online/B',
    'openRooms/d/4/R2', 'openRooms/d/4', 'openRooms/d', 'roomAge/R2', 'roomAge/M1'].forEach(p => containers.add(p));   // 3.3ج-5ب: مدخل قائم لغرفة مفتوحة
  ['users/A/email', 'users/A/lastRead/A_B', 'users/B/requestCooldown/A', 'users/A/sentRequests/D', 'rooms/R1/status', 'rooms/R1/p2name',
    'rooms/M1/players/A/name', 'chats/A_B/m1/text', 'chats/A_B/m1/status', 'invites/B/fromName', 'inviteRejections/A/name',
    'inviteRejections/A/roomCode', 'inviteRejections/A/rejectedBy',
    'openRooms/d/4/R2/u', 'openRooms/d/4/R2/t', 'roomAge/R2/k', 'roomAge/M1/t', 'ageList/tokR2', 'ageCode/tokM1'].forEach(p => leaves.add(p));   // مراجعة ج-5أ: ردّ قائم (المتغيّر وحده يعطي C بلا ردّ)
  const who = ['A', 'B', 'C'];
  const ok = (uid, p, v) => checkWrite(NEW, [[p, v]], { uid, root: base, now: SWEEP_T }).ok;
  const LONG = 'x'.repeat(5000);
  const single = [], unknown = [], long = [];
  for (const p of [...containers].sort()) {
    for (const uid of who) {
      if ([LONG, 7, true].some(v => ok(uid, p, v))) { single.push(`${p} ← ${uid}`); break; }
    }
    for (const uid of who) {
      if (ok(uid, p + '/zz_junk', LONG) || ok(uid, p + '/zz_junk', { a: LONG })) { unknown.push(`${p}/zz_junk ← ${uid}`); break; }
    }
  }
  for (const p of [...leaves].sort()) {
    if (/\$other/.test(p)) continue;
    for (const uid of who) { if (ok(uid, p, LONG)) { long.push(`${p} ← ${uid}`); break; } }
  }
  r.ok(containers.size >= 60 && leaves.size >= 80, `المسح لم يغطِّ ما يكفي (حاويات ${containers.size}، أوراق ${leaves.size})`);
  r.ok(single.length === 0, `قيمة مفردة قُبلت مكان حاوية: ${single.join('، ')}`);
  r.ok(unknown.length === 0, `مفتاح غريب قُبل: ${unknown.join('، ')}`);
  r.ok(long.length === 0, `نص طويل (5000 حرف) قُبل: ${long.join('، ')}`);
  // والشجرة نفسها صالحة: ما يكتبه الكود فيها يُقبل (وإلا "لا شيء يُقبل" بلا معنى) — عيّنات من كل منطقة
  const T = SWEEP_T;
  const legit = [
    ['A', 'users/A/presence', { state: 'playing', lastSeen: T, by: 'abc:playing' }], ['A', 'users/A/learnedPowers/time_extend', true],
    ['A', 'users/A/name', 'اسم جديد'], ['A', 'users/A/lastSeen', T], ['A', 'users/A/lastRead/A_B', T],
    ['A', 'rooms/R1/moves/m2', { key: 'v_1_1', by: 1, seq: 2, bank: 90, nextTurn: 2 }], ['B', 'rooms/R1/clock', { banks: { 1: 90, 2: 100 }, currentPlayer: 2, turnStartAt: T }],
    ['A', 'rooms/R1/elementMap', { '0,0': 'water', '1,2': 'gem' }], ['B', 'rooms/R1/signals', { restart: 2, ts: T }],
    ['C', 'rooms/R1/spectators/C', { name: 'ج', at: T }], ['B', 'rooms/M1/players/B/disconnectedAt', T],
    ['A', 'rooms/M1/approval/decisions/1', 'rejected'], ['B', 'chats/A_B/m1/status', 'read'],
    ['A', 'openRooms/d/4/R2', { t: T, u: 'A' }],   // 3.3ج-5ب
  ];
  const refused = legit.filter(([uid, p, v]) => !ok(uid, p, v)).map(([uid, p]) => `${p} ← ${uid}`);
  // 3.3ج-5ج: العمر بتذكرته كتابةٌ واحدة متعددة المسارات
  const SVX = { '.sv': 'timestamp' };
  for (const [uid, code, tok] of [['B', 'R1', 'tokNew1'], ['A', 'M1', 'tokNew2']]) {
    const w = [['roomAge/' + code, { t: SVX, k: tok }], ['ageList/' + tok, SVX], ['ageCode/' + tok, code]];
    if (!checkWrite(NEW, w, { uid, root: base, now: T }).ok) refused.push(`roomAge/${code} + ${tok} ← ${uid}`);
  }
  r.ok(refused.length === 0, `كتابة مشروعة رُفضت على شجرة المسح: ${refused.join('، ')}`);
  return r;
}

export const RULES_ALL = [rulesMatrix, rulesLint, rulesShapeSweep];
