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
    A: { name: 'أ', friends: { B: { name: 'ب' } } },
    B: { name: 'ب', friends: { A: { name: 'أ' } } },
    V: { name: 'ضحية' },
  } };
  const W = (rules, uid, writes, root = base) => checkWrite(rules, writes, { uid, root }).ok;
  const withToken = JSON.parse(JSON.stringify(base)); withToken.users.B.sentRequests = { A: 1 };
  // ملفي
  r.ok(W(NEW, 'A', [['users/A/xp', 5]]), 'لا أكتب في ملفي');
  r.ok(!W(NEW, 'A', [['users/B/xp', 5]]), 'أكتب في ملف غيري');
  r.ok(!W(NEW, 'A', [['users/B', { name: 'x' }]]), 'أستبدل ملف غيري كاملاً');
  // طلب الصداقة
  r.ok(W(NEW, 'A', [['users/B/friendRequests/A', { name: 'أ' }], ['users/A/sentRequests/B', 1]]), 'طلب صداقة (الصندوق + دليلي) مرفوض');
  r.ok(!W(NEW, 'A', [['users/B/friendRequests/C', { name: 'ج' }]]), 'أكتب طلباً باسم غيري');
  r.ok(!W(NEW, 'A', [['users/B/sentRequests/A', 1]]), 'أكتب دليل طلب في ملف غيري');
  r.ok(W(NEW, 'A', [['users/B/friendRequests/A', null]]), 'أسحب طلبي من صندوقه');
  // الطلب لا يُقبل إلا ومعه دليله في ملف مرسله بالكتابة نفسها (نسخة أقدم مفتوحة بعد نشر القواعد كانت تُنشئ طلباً بلا
  // دليل، فيصنع قبولُها بنسختها صداقةً من طرف واحد — مراجعة v36.1)، ولمستخدم موجود فقط (لا عُقد بأي مفتاح)
  r.ok(!W(NEW, 'A', [['users/B/friendRequests/A', { name: 'أ' }]]), 'طلب بلا دليل (كما تكتبه نسخة أقدم) قُبل');
  r.ok(!W(NEW, 'A', [['users/Z9/friendRequests/A', { name: 'أ' }], ['users/A/sentRequests/Z9', 1]]), 'طلب لمفتاح لا مستخدم له أنشأ عقدة جديدة');
  r.ok(W(NEW, 'A', [['users/B/friendRequests/A/name', 'أ'], ['users/A/sentRequests/B', 1]]), 'تعديل حقل في طلبي (مع دليله) مرفوض');
  // كتابة على مستوى الأب أو حقل داخل مدخل غيري
  r.ok(!W(NEW, 'A', [['users/B/friends', { A: { name: 'أ' } }]], withToken) && !W(NEW, 'A', [['users/B/friendRequests', { A: { name: 'أ' } }], ['users/A/sentRequests/B', 1]]),
    'كتابة قائمة أصدقاء غيري أو صندوقه كاملاً');
  r.ok(W(NEW, 'A', [['users/B/friends/A/name', 'أ2']], withToken) && !W(NEW, 'A', [['users/B/friends/A/name', 'أ2']]),
    'تعديل حقل مدخلي في قائمة غيري: يتبع الدليل نفسه');
  r.ok(!W(NEW, 'A', [['users/B/friends/V/name', 'x']], withToken), 'تعديل مدخل غيري في قائمة أحد');
  // القبول: إضافة نفسي لقائمة من أرسل لي — بدليله في ملفه فقط
  r.ok(W(NEW, 'A', [['users/A/friends/B', { name: 'ب' }], ['users/B/friends/A', { name: 'أ' }], ['users/A/friendRequests/B', null]], withToken),
    'قبول طلب له دليل في ملف مرسله مرفوض');
  r.ok(!W(NEW, 'A', [['users/B/friends/A', { name: 'أ' }]]), 'أضيف نفسي لقائمة من لم يرسل لي');
  const forged = JSON.parse(JSON.stringify(base)); forged.users.A.friendRequests = { V: { name: 'ضحية' } };
  r.ok(!W(NEW, 'A', [['users/V/friends/A', { name: 'أ' }]], forged), 'طلب مزوَّر في صندوقي يدخلني قائمة غيري');
  r.ok(!W(NEW, 'A', [['users/B/friends/C', { name: 'ج' }]], withToken), 'أضيف غيري لقائمة أحد');
  // الدليل لمرة واحدة: المستقبل يحذفه (يستهلكه بالقبول أو الرفض) ولا يكتبه، ولا يمسّه غيره
  r.ok(W(NEW, 'A', [['users/B/sentRequests/A', null]], withToken), 'المستقبل لا يستطيع حذف دليل الطلب إليه (استهلاكه)');
  r.ok(!W(NEW, 'A', [['users/B/sentRequests/A', 2]], withToken) && !W(NEW, 'A', [['users/B/sentRequests/C', null]], withToken),
    'المستقبل يعدّل دليلاً أو يحذف دليلاً ليس له');
  const accept = checkWrite(NEW, [['users/A/friends/B', { name: 'ب' }], ['users/B/friends/A', { name: 'أ' }],
    ['users/A/friendRequests/B', null], ['users/B/sentRequests/A', null]], { uid: 'A', root: withToken });
  r.ok(accept.ok && accept.newRoot.users.B.sentRequests == null, 'القبول مع استهلاك الدليل بكتابة واحدة مرفوض');
  const removed = accept.ok ? checkWrite(NEW, [['users/A/friends/B', null], ['users/B/friends/A', null]], { uid: 'A', root: accept.newRoot }) : { ok: false };
  r.ok(removed.ok && !W(NEW, 'A', [['users/B/friends/A', { name: 'أ' }]], removed.newRoot),
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
  r.ok(W(NEW, 'A', [['profiles/A', { name: 'أ', xp: 9 }]]) && !W(NEW, 'A', [['profiles/B', { name: 'x' }]]), 'الملف العام: لا يكتبه إلا صاحبه');
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
  // القراءة: مفتوحة لكل مسجّل (البحث العشوائي يقرأ الغرف كلها، والمشاهدة بالكود والدعوات) — لا للزائر
  r.ok(canRead(NEW, 'rooms', { uid: 'V', root: rooms0 }) && canRead(NEW, 'rooms/222222', { uid: 'V', root: rooms0 }), 'الغرف لم تعد مقروءة لكل مسجّل (البحث العشوائي يحتاجها)');
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
  r.ok(W(NEW, 'A', [['users/B/friendRequests/A', { name: 'أ' }], ['users/A/sentRequests/B', 1]]) && !W(NEW, 'A', [['users/B/friendRequests/A', { name: 'ن'.repeat(129) }], ['users/A/sentRequests/B', 1]]),
    'حدّ اسم الطلب (128) لم يُطبَّق');
  // تحدي اليوم كما كان
  r.ok(canRead(NEW, 'dailyChallenges/d1/results', { uid: 'A' }) && W(NEW, 'A', [['dailyChallenges/d1/results/A', { s: 1 }]]) && !W(NEW, 'A', [['dailyChallenges/d1/results/B', { s: 1 }]]),
    'تحدي اليوم تغيّر');
  // ولماذا كان لا بدّ منها: القواعد السابقة ترفض الطلب والحذف والقبول
  r.ok(!W(OLD, 'A', [['users/B/friendRequests/A', { name: 'أ' }]]) && !W(OLD, 'A', [['users/B/friends/A', null]])
    && !W(OLD, 'A', [['users/B/friends/A', { name: 'أ' }]], withToken), 'القواعد السابقة كانت تسمح بالأصدقاء (التشخيص خاطئ؟)');
  return r;
}

export const RULES_ALL = [rulesMatrix];
