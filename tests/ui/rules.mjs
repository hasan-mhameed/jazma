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
  // باقي القواعد كما كانت تماماً (لا تغيير خارج الأصدقاء حتى 3.3)
  const same = (rules, uid, writes) => W(rules, uid, writes) === W(OLD, uid, writes);
  const probes = [
    ['A', [['rooms/123', { status: 'waiting' }]]], ['A', [['invites/B/A', { at: 1 }]]], ['A', [['inviteRejections/A', { r: 1 }]]],
    ['A', [['chats/A_B/m1', { text: 'x' }]]], ['A', [['chatStatus/A', { t: 1 }]]], ['A', [['dailyChallenges/d1/results/A', { s: 1 }]]],
    ['A', [['dailyChallenges/d1/results/B', { s: 1 }]]], ['A', [['users/A/presence', { state: 'online' }]]], ['A', [['other/x', 1]]],
    [null, [['chats/A_B/m1', { text: 'x' }]]],
  ];
  r.ok(probes.every(([uid, w]) => same(NEW, uid, w)), 'تغيّر شيء خارج الأصدقاء عن القواعد السابقة');
  // بنيوياً: بلا أقسام الأصدقاء الثلاثة، الملف هو قواعد الإنتاج حرفاً بحرف
  const bare = JSON.parse(JSON.stringify(NEW));
  for (const k of ['friendRequests', 'friends', 'sentRequests']) delete bare.rules.users.$uid[k];
  r.ok(JSON.stringify(bare) === JSON.stringify(OLD), 'خارج أقسام الأصدقاء الثلاثة يختلف الملف عن قواعد الإنتاج');
  r.ok(['users', 'rooms', 'invites', 'inviteRejections', 'chats', 'chatStatus', 'dailyChallenges/d1/results'].every(p =>
    canRead(NEW, p, { uid: 'A' }) === canRead(OLD, p, { uid: 'A' })), 'تغيّرت صلاحيات القراءة');
  // ولماذا كان لا بدّ منها: القواعد السابقة ترفض الطلب والحذف والقبول
  r.ok(!W(OLD, 'A', [['users/B/friendRequests/A', { name: 'أ' }]]) && !W(OLD, 'A', [['users/B/friends/A', null]])
    && !W(OLD, 'A', [['users/B/friends/A', { name: 'أ' }]], withToken), 'القواعد السابقة كانت تسمح بالأصدقاء (التشخيص خاطئ؟)');
  return r;
}

export const RULES_ALL = [rulesMatrix];
