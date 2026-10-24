// اللعبة كاملة في jsdom (v36.0 — الخطوتان 1.10 و1.11): index.html الحقيقي + main.js وكل وحداته الحقيقية،
// فوق Firebase وهمي في الذاكرة (fakeFirebase.mjs). لا بدائل لوحدات اللعبة نفسها — فقط وحدات gstatic الثلاث.
// يفحص ما لا يراه المحاكي ولا فحوص الوحدات: تهيئة ما بعد الدخول كاملةً، والخروج، وتغيّر الحساب، وترقية الضيف،
// وبطاقات الأصدقاء الحيّة، وكل واجهة تبني أسماء الآخرين بالـDOM (الأصدقاء، البحث، الطلبات، المتصدرون، المحادثة).
import fs from 'node:fs';
import path from 'node:path';
import { boot, PROJECT } from './harness.mjs';
import { XSS_NAME, XSS_MSG, QUOTES } from './render.mjs';

const GPHOTO = 'https://lh3.googleusercontent.com/a/ACg8ocJfake=s96-c';
const ME = { uid: 'me', displayName: 'أنا', email: 'me@x.com', photoURL: GPHOTO, isAnonymous: false, providerData: [] };

function checker(title) {
  const r = { title, pass: 0, fail: 0, known: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push('❌ ' + msg); } };
  return r;
}
const injected = H => H.doc.querySelectorAll('.xss').length + (H.win.__xss !== undefined ? 1 : 0);

/** يشغّل اللعبة كاملة: بيانات أولية في القاعدة، وحساب داخل مسبقاً (أو لا أحد) */
// قواعد الأمان (v36.1 — 1.13): اللعبة كلها تعمل فوق القواعد المنشورة نفسها (database.rules.json في المشروع المفحوص)،
// والقواعد القديمة (الإنتاج حتى 2026-10-19) لفحص التصرّف حين تُرفض الكتابة
export const RULES = JSON.parse(fs.readFileSync(path.join(PROJECT, 'database.rules.json'), 'utf8'));
export const OLD_RULES = JSON.parse(fs.readFileSync(new URL('../shared/rules_prod_2026-10-19.json', import.meta.url), 'utf8'));
export async function bootApp({ user = ME, data = {}, cold = false, rules = RULES, autoProfiles = true } = {}) {
  const H = boot({ firebase: true, polyfills: true, cold, rules });
  for (const [p, v] of Object.entries(data)) H.fb.set(p, v);
  // 3.3أ: في الواقع كل لاعب له ملف عام profiles/<uid> (يكتبه saveUserProfile عند دخوله) — منه البحث والمتصدرون
  // وخبرة الخصم. نشتقّه تلقائياً من كل لاعب مزروع في users حتى تعمل هذه القراءات (أطفئه بـautoProfiles:false
  // لفحص التعايش: لاعب قديم بلا ملف عام بعدُ). ملف عام مزروع صراحةً (profiles/<uid>) لا يُلمَس.
  if (autoProfiles) {
    const usersRoot = H.fb.get('users') || {};
    for (const [uid, u] of Object.entries(usersRoot)) {
      if (u && typeof u === 'object' && H.fb.get(`profiles/${uid}`) == null) {
        H.fb.set(`profiles/${uid}`, { name: u.name ?? 'لاعب', photo: u.photo ?? '', xp: typeof u.xp === 'number' ? u.xp : 0 });
      }
    }
  }
  if (user) H.fb.auth.currentUser = JSON.parse(JSON.stringify(user));
  await H.loaded();
  // المؤقّتات الدورية القائمة (لكشف التسرّب)
  H.timers = new Set();
  const si = H.win.setInterval.bind(H.win), ci = H.win.clearInterval.bind(H.win);
  H.win.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); H.timers.add(id); return id; };
  H.win.clearInterval = (id) => { H.timers.delete(id); return ci(id); };
  H.logs = [];
  for (const k of ['log', 'info', 'warn', 'error']) H.win.console[k] = (...a) => H.logs.push(k + ': ' + a.map(String).join(' '));
  await H.import('js/main.js');
  H.doc.dispatchEvent(new H.win.Event('DOMContentLoaded'));      // كالمتصفح: الوحدة تُنفَّذ ثم يأتي الحدث
  await H.settle(0, 30);
  return H;
}
const $ = (H, id) => H.doc.getElementById(id);
const friendCards = H => [...H.doc.querySelectorAll('#friends-list .friend-card')];
const cardOf = (H, name) => friendCards(H).find(c => c.querySelector('.friend-name')?.firstChild?.textContent === name);
const stateOf = (H, name) => cardOf(H, name)?.dataset.presence;
const errText = H => H.errors.length ? ': ' + H.errors[0].slice(0, 160) : '';

// ─── 1. حالة الأصدقاء حيّة بعد إعادة رسم القائمة، بلا تسرّب ────────────
export async function friendPresenceAcrossRerender() {
  const r = checker('حالة الأصدقاء تبقى حيّة بعد إضافة صديق أو حذفه، بلا مستمعين أو مؤقّتات تتراكم (1.11-أ)');
  const H = await bootApp({ data: {
    // 3.3أ: حالة الحضور يقرؤها أصدقاء صاحبها فقط — فالصداقة من الطرفين (ب وكريم يحملانني في قائمتيهما)
    'users/me': { uid: 'me', name: 'أنا', friends: { b: { uid: 'b', name: 'باسل' } } },
    'users/b': { uid: 'b', name: 'باسل', friends: { me: { uid: 'me', name: 'أنا' } }, presence: { state: 'online', lastSeen: 1 } },
    'users/c': { uid: 'c', name: 'كريم', friends: { me: { uid: 'me', name: 'أنا' } }, presence: { state: 'online', lastSeen: 1 } },
  } });
  try {
    r.ok(stateOf(H, 'باسل') === 'online', `البداية: باسل ليس "متصل" (${stateOf(H, 'باسل')})${errText(H)}`);
    H.fb.set('users/b/presence', { state: 'playing', lastSeen: 2 }); await H.settle();
    r.ok(stateOf(H, 'باسل') === 'playing', `باسل لم يصر "في مباراة" (${stateOf(H, 'باسل')})`);
    const timers0 = H.timers.size;
    H.fb.set('users/me/friends/c', { uid: 'c', name: 'كريم' }); await H.settle();          // صديق جديد → إعادة رسم
    r.ok(friendCards(H).length === 2, `القائمة لم تُرسم من جديد (${friendCards(H).length})`);
    H.fb.set('users/b/presence', { state: 'online', lastSeen: 3 }); await H.settle();
    r.ok(stateOf(H, 'باسل') === 'online', `بعد إضافة صديق: حالة باسل تجمّدت (${stateOf(H, 'باسل')}، المطلوب online)`);
    r.ok(stateOf(H, 'كريم') === 'online', `الصديق الجديد بلا حالة (${stateOf(H, 'كريم')})`);
    H.fb.set('users/me/friends/c', null); await H.settle();                                 // حذف صديق → إعادة رسم
    H.fb.set('users/b/presence', { state: 'playing', lastSeen: 4 }); await H.settle();
    r.ok(friendCards(H).length === 1 && stateOf(H, 'باسل') === 'playing', `بعد حذف صديق: حالة باسل تجمّدت (${stateOf(H, 'باسل')})`);
    for (let i = 0; i < 5; i++) {                                                           // إعادات رسم متتالية
      H.fb.set('users/me/friends/c', i % 2 ? null : { uid: 'c', name: 'كريم' }); await H.settle();
    }
    r.ok(H.fb.activeListeners('users/b/presence') === 1, `مستمعو حضور باسل تراكموا أو اختفوا (${H.fb.activeListeners('users/b/presence')}، المطلوب 1)`);
    r.ok(H.fb.activeListeners('users/c/presence') === 1, `مستمع حضور كريم (${H.fb.activeListeners('users/c/presence')}، المطلوب 1 — هو ظاهر الآن)`);
    r.ok(H.timers.size === timers0 + 1, `المؤقّتات الدورية تتراكم مع إعادة الرسم (${timers0} → ${H.timers.size}، المطلوب ${timers0 + 1})`);
    r.ok(H.errors.length === 0, 'أخطاء' + errText(H));
  } catch (e) { r.ok(false, 'خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}

// ─── 2. الخروج = صفحة جديدة نظيفة، بعد إلغاء دعوة تنتظر ────────────────
export async function logoutFreshPage() {
  const r = checker('تسجيل الخروج: الدعوة القائمة تُلغى ثم صفحة جديدة نظيفة (1.11-ب)');
  const H = await bootApp({ data: {
    'users/me': { uid: 'me', name: 'أنا', friends: { b: { uid: 'b', name: 'باسل' } } },
    'users/b': { uid: 'b', name: 'باسل', presence: { state: 'online', lastSeen: 1 } },
  } });
  try {
    $(H, 'friends-btn').click();
    cardOf(H, 'باسل')?.querySelector('.btn-invite')?.click();
    await H.settle(0, 40);
    const inv = H.fb.get('invites/b');
    r.ok(inv?.fromUid === 'me' && !!inv?.roomCode, `الدعوة لم تُرسل${errText(H)}`);
    const room = inv?.roomCode;
    r.ok(!!(room && H.fb.get(`rooms/${room}`)), 'غرفة الدعوة لم تُنشأ');
    r.ok(H.reloads === 0, 'إعادة تحميل قبل الخروج');
    $(H, 'logout-btn').click();
    await H.settle(0, 60);
    r.ok(H.fb.auth.currentUser === null, 'لم يُسجَّل الخروج');
    r.ok(H.fb.get('invites/b') === null, 'الدعوة بقيت عند الصديق بعد الخروج');
    r.ok(!H.fb.get(`rooms/${room}`)?.status || H.fb.get(`rooms/${room}`) === null, 'غرفة الدعوة بقيت تنتظر');
    r.ok(H.reloads === 1, `الصفحة لم تُعد بعد الخروج (عدد الإعادات ${H.reloads}، المطلوب 1)`);
    r.ok(H.errors.length === 0, 'أخطاء' + errText(H));
  } catch (e) { r.ok(false, 'خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}

// ─── 3. خروج من مكان آخر، ودخول بنفس الصفحة، وحساب آخر: لا تهيئة ثانية أبداً ───
export async function accountChangesSamePage() {
  const r = checker('خروج من تبويب آخر، أو دخول ثانٍ بنفس الصفحة، أو حساب آخر: صفحة جديدة — لا تهيئة فوق تهيئة (1.11-ب)');
  const data = {
    // 3.3أ: الصداقة من الطرفين حتى يُقرأ حضور باسل (يقرؤه أصدقاؤه فقط)
    'users/me': { uid: 'me', name: 'أنا', friends: { b: { uid: 'b', name: 'باسل' } } },
    'users/b': { uid: 'b', name: 'باسل', friends: { me: { uid: 'me', name: 'أنا' } }, presence: { state: 'online', lastSeen: 1 } },
  };
  // (أ) خروج لم يأتِ من الزر (تبويب آخر / انتهاء الجلسة) ثم دخول من جديد بنفس الصفحة
  let H = await bootApp({ data });
  try {
    const friendsL = H.fb.activeListeners('users/me/friends');
    $(H, 'messages-btn').click();
    r.ok(!$(H, 'messages-panel').classList.contains('hidden'), 'زر الرسائل لا يفتح أصلاً');
    $(H, 'close-messages-btn').click();
    H.fb.signOutNow(); await H.settle(0, 40);
    r.ok(H.reloads === 1, `خروج من مكان آخر: الصفحة لم تُعد (${H.reloads})`);
    H.fb.signInAs(ME); await H.settle(0, 40);          // لو بقيت الصفحة (الإعادة لم تكتمل بعد) ودخل من جديد
    r.ok(H.fb.activeListeners('users/me/friends') === friendsL,
      `دخول ثانٍ بنفس الصفحة بنى التهيئة من جديد فوق القديمة (مستمعو قائمة الأصدقاء ${friendsL} → ${H.fb.activeListeners('users/me/friends')})`);
    $(H, 'messages-btn').click();
    r.ok(!$(H, 'messages-panel').classList.contains('hidden'), 'بعد الخروج والدخول بنفس الصفحة: زر الرسائل ينفتح وينسكّر بنفس الضغطة');
    r.ok(H.errors.length === 0, 'أخطاء' + errText(H));
  } catch (e) { r.ok(false, '(أ) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  H.close();
  // (ب) حساب آخر يدخل دون خروج بينهما
  H = await bootApp({ data });
  try {
    H.fb.signInAs({ uid: 'other', displayName: 'غيري', email: 'o@x.com' }); await H.settle(0, 40);
    r.ok(H.reloads === 1, `حساب آخر بنفس الصفحة: الصفحة لم تُعد (${H.reloads})`);
    r.ok($(H, 'user-name').textContent === 'أنا', `واجهة الحساب الأول تبدّلت قبل الإعادة (${$(H, 'user-name').textContent})`);
  } catch (e) { r.ok(false, '(ب) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  H.close();
  // (ج) أول تحميل بلا دخول، ثم دخول: تهيئة عادية بلا إعادة
  H = await bootApp({ user: null, data });
  try {
    r.ok(!$(H, 'auth-screen').classList.contains('hidden') && H.reloads === 0, 'بلا دخول: شاشة الدخول لم تظهر أو أُعيدت الصفحة');
    H.fb.accounts['me@x.com'] = { password: 'Aa1!aaaa', user: ME };
    $(H, 'login-email').value = 'me@x.com'; $(H, 'login-password').value = 'Aa1!aaaa';
    $(H, 'email-login-btn').click(); await H.settle(0, 40);
    r.ok($(H, 'auth-screen').classList.contains('hidden') && H.reloads === 0, `الدخول الأول لم يفتح اللعبة أو أعاد الصفحة (إعادات ${H.reloads})${errText(H)}`);
    r.ok(friendCards(H).length === 1 && stateOf(H, 'باسل') === 'online', 'بعد الدخول الأول: الأصدقاء لم يظهروا أو بلا حالة');
  } catch (e) { r.ok(false, '(ج) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}

// ─── 4. ترقية الضيف: الاسم والصورة يُحفظان، وصفحة جديدة تفتح كل الميزات ───
export async function guestUpgrade() {
  const r = checker('ترقية الضيف (Google وإيميل): ملفه يُحدَّث باسمه الجديد ثم صفحة جديدة (1.11-ج)');
  const GUEST = { uid: 'anon_1', isAnonymous: true };
  for (const via of ['google', 'email']) {
    const H = await bootApp({ user: GUEST });
    try {
      r.ok(H.fb.get('users/anon_1/name') === 'لاعب', `${via}: ملف الضيف لم يُنشأ باسم "لاعب"`);
      r.ok($(H, 'friends-btn').classList.contains('hidden'), `${via}: زر الأصدقاء ظاهر للضيف`);
      $(H, 'upgrade-btn').click(); await H.settle();
      if (via === 'google') {
        H.fb.nextPopupUser = { displayName: 'هيا', email: 'haya@x.com', photoURL: GPHOTO };
        $(H, 'upgrade-google-btn').click();
      } else {
        $(H, 'upgrade-name').value = 'سمر'; $(H, 'upgrade-email').value = 'samar@x.com'; $(H, 'upgrade-password').value = 'Aa1!aaaa';
        $(H, 'upgrade-email-btn').click();
      }
      await H.settle(0, 40);
      const want = via === 'google' ? 'هيا' : 'سمر';
      r.ok(H.fb.get('users/anon_1/name') === want, `${via}: الاسم في الملف بقي "${H.fb.get('users/anon_1/name')}" (المطلوب ${want})`);
      r.ok(H.fb.auth.currentUser?.displayName === want, `${via}: اسم الحساب نفسه لم يُضبط (${H.fb.auth.currentUser?.displayName})`);
      if (via === 'google') r.ok(H.fb.get('users/anon_1/photo') === GPHOTO, 'google: الصورة لم تُحفظ');
      r.ok(H.fb.get('users/anon_1/email') == null, `${via}: الإيميل كُتب في الملف العام (يقرؤه كل من يبحث عن صديق)`);
      r.ok(H.reloads === 1, `${via}: الصفحة لم تُعد بعد الترقية (${H.reloads}) — كانت تبقى واجهة الضيف`);
      r.ok(H.errors.length === 0, `${via}: أخطاء` + errText(H));
    } catch (e) { r.ok(false, `${via} خطأ: ` + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  return r;
}

// ─── 4ب. التسجيل بإيميل: الملف يُحفظ قبل وصول الاسم — يجب أن ينتهي باسمه لا "لاعب" ───
export async function registrationName() {
  const r = checker('التسجيل بإيميل: اسمه في ملفه العام هو ما كتبه — لا "لاعب" (سباق حفظ الملف — مراجعة 1.11)');
  const H = await bootApp({ user: null });
  try {
    $(H, 'register-name').value = 'سارة'; $(H, 'register-email').value = 'sara@x.com'; $(H, 'register-password').value = 'Aa1!aaaa';
    $(H, 'email-register-btn').click();
    await H.settle(0, 60);
    const uid = H.fb.auth.currentUser?.uid;
    r.ok(!!uid && $(H, 'auth-screen').classList.contains('hidden'), `التسجيل لم يدخل اللعبة${errText(H)}`);
    r.ok(H.fb.get(`users/${uid}/name`) === 'سارة', `الاسم في الملف "${H.fb.get(`users/${uid}/name`)}" (المطلوب سارة) — يجده أصدقاؤه في البحث`);
    r.ok($(H, 'user-name').textContent === 'سارة', `الاسم في الشريط "${$(H, 'user-name').textContent}" (المطلوب سارة)`);
    r.ok(H.fb.get(`users/${uid}/uid`) === uid && H.fb.get(`users/${uid}/joinedAt`) > 0, 'الملف ناقص (uid/joinedAt) — الكتابة سبقت إنشاءه');
    r.ok(H.reloads === 0, 'التسجيل أعاد الصفحة');
    // ملف بقي "لاعب" (فشلت كتابة سابقة) يُصحَّح في الدخول التالي
    H.fb.set(`users/${uid}/name`, 'لاعب');
    const H2 = await bootApp({ user: { uid, displayName: 'سارة', email: 'sara@x.com' }, data: { [`users/${uid}`]: H.fb.get(`users/${uid}`) } });
    r.ok(H2.fb.get(`users/${uid}/name`) === 'سارة', `الدخول التالي لم يصحّح "لاعب" (${H2.fb.get(`users/${uid}/name`)})`);
    H2.close();
    r.ok(H.errors.length === 0, 'أخطاء' + errText(H));
  } catch (e) { r.ok(false, 'خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  H.close();
  // (ب) اتصال بارد (أول دخول على شبكة بطيئة): الاسم يصل الحساب قبل أن يتصل التطبيق بالخادم — الكتابات المعلّقة تسبق
  // القراءات المعلّقة؛ المطلوب ملف كامل (uid/joinedAt/stats) لا "موجود ناقص" (مراجعة v36.0 الثالثة)
  const C = await bootApp({ user: null, cold: true });
  try {
    $(C, 'register-name').value = 'سارة'; $(C, 'register-email').value = 'sara2@x.com'; $(C, 'register-password').value = 'Aa1!aaaa';
    $(C, 'email-register-btn').click();
    await C.settle(0, 30);                                  // وصل الاسم للحساب والاتصال لم يقم بعد
    C.fb.connect(); await C.settle(0, 60);
    const uid = C.fb.auth.currentUser?.uid, prof = C.fb.get(`users/${uid}`) || {};
    r.ok(prof.uid === uid && prof.joinedAt > 0 && !!prof.stats, `اتصال بارد: الملف ناقص (${Object.keys(prof).join(',')}) — بلا uid لا يصله أي طلب صداقة`);
    // أول ما يصل الخادم تحت ملفه هو الملف الكامل — لا كتابة جزئية تسبق "هل الملف موجود؟" (حماية لإصلاح التسجيل وحده،
    // فطبقة الإكمال في الدخول تُخفي الكتابة الجزئية لو عادت — مراجعة v36.0 الرابعة)
    const first = C.fb.batches.find(b => b.path === `users/${uid}` || b.path.startsWith(`users/${uid}/`));
    r.ok(first && first.path === `users/${uid}` && first.keys.includes('uid') && first.keys.includes('joinedAt'),
      `اتصال بارد: أول كتابة تحت الملف ليست الملف الكامل (${JSON.stringify(first)})`);
    r.ok(prof.name === 'سارة', `اتصال بارد: الاسم "${prof.name}" (المطلوب سارة)`);
    r.ok(C.errors.length === 0, 'اتصال بارد: أخطاء' + errText(C));
  } catch (e) { r.ok(false, 'اتصال بارد خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  C.close();
  // (ج) ملف ناقص قائم (من نسخة سابقة) يُكمَل في الدخول التالي دون مسّ الموجود
  const P = await bootApp({ user: { uid: 'half', displayName: 'نصف', email: 'h@x.com' },
    data: { 'users/half': { name: 'نصف', lastSeen: 1, friends: { b: { uid: 'b', name: 'باسل' } } } } });
  try {
    const prof = P.fb.get('users/half') || {};
    r.ok(prof.uid === 'half' && prof.joinedAt > 0 && !!prof.stats && prof.friends?.b?.name === 'باسل', `الملف الناقص لم يُكمَل أو مُسّ الموجود (${JSON.stringify(prof).slice(0, 120)})`);
  } catch (e) { r.ok(false, 'ملف ناقص خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  P.close();
  return r;
}

// ─── 4ج. Firebase يكرّر حدث الحساب نفسه: لا تهيئة ثانية ولا إعادة ─────────
export async function repeatedSameAccountEvent() {
  const r = checker('حدث دخول مكرّر للحساب نفسه (حماية): لا تهيئة ثانية ولا إعادة تحميل (مراجعة 1.11)');
  const H = await bootApp({ data: {
    'users/me': { uid: 'me', name: 'أنا', friends: { b: { uid: 'b', name: 'باسل' } } },
    'users/b': { uid: 'b', name: 'باسل', presence: { state: 'online', lastSeen: 1 } },
  } });
  try {
    const friendsL = H.fb.activeListeners('users/me/friends');
    for (const cb of [...H.fb.auth.listeners]) cb(H.fb.auth.currentUser);     // كأن Firebase كرّر الحدث
    await H.settle(0, 40);
    r.ok(H.reloads === 0, `أُعيدت الصفحة لحدث مكرّر (${H.reloads})`);
    r.ok(H.fb.activeListeners('users/me/friends') === friendsL, `تهيئة ثانية: مستمعو قائمة الأصدقاء ${friendsL} → ${H.fb.activeListeners('users/me/friends')}`);
    $(H, 'messages-btn').click();
    r.ok(!$(H, 'messages-panel').classList.contains('hidden'), 'زر الرسائل ينفتح وينسكّر بنفس الضغطة بعد الحدث المكرّر');
    r.ok(H.errors.length === 0, 'أخطاء' + errText(H));
  } catch (e) { r.ok(false, 'خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}

// ─── 5. أسماء الآخرين وصورهم في الواجهات المبنية بالـDOM ───────────────
export async function namesAndPhotosInDomUIs() {
  const r = checker('أسماء خبيثة وصور من مضيفين آخرين: الأصدقاء، البحث، الطلبات، المتصدرون، المحادثة (مراجعة 1.10)');
  const H = await bootApp({ data: {
    'users/me': { uid: 'me', name: 'أنا',
      friends: { x: { uid: 'x', name: XSS_NAME, photo: 'javascript:window.__xss=9' }, g: { uid: 'g', name: 'غادة', photo: GPHOTO },
                 t: { uid: 't', name: QUOTES, photo: 'https://tracker.example/p.png' }, a: { uid: 'a', name: [1, 2] } },
      friendRequests: { q: { uid: 'q', name: XSS_NAME } } },
    'users/x': { uid: 'x', name: XSS_NAME, photo: 'data:image/svg+xml,<svg onload=alert(1)>', xp: 50 },
    'users/g': { uid: 'g', name: 'غادة', photo: GPHOTO, xp: 40 },
    'users/t': { uid: 't', name: QUOTES, photo: 'https://tracker.example/p.png', xp: 30 },
    'users/n1': { uid: 'n1', name: [1, 2] }, 'users/n2': { uid: 'n2', name: 77 }, 'users/n3': { uid: 'n3', name: { a: 1 } }, 'users/n4': 'نص',
    'users/me/matchHistory': { m1: { vs: [1, 2], mode: 'online' }, m2: { vs: 5, mode: 'online' }, m3: { vs: { a: 1 }, mode: 'online' }, m4: { vs: 'سامي', mode: 'online' } },
    [`chats/a_me/-Nm1`]: { fromUid: 'a', text: XSS_MSG, ts: 1 },
  } });
  try {
    $(H, 'friends-btn').click(); await H.settle();
    const fl = $(H, 'friends-list');
    r.ok(injected(H) === 0, `حُقنت عناصر (${H.doc.querySelectorAll('.xss').length})`);
    r.ok(friendCards(H).length === 4, `الأصدقاء الأربعة لم يظهروا (${friendCards(H).length})${errText(H)}`);
    r.ok(!!cardOf(H, XSS_NAME) && !!cardOf(H, QUOTES), 'الأسماء الخبيثة/بعلامات تنصيص لا تظهر حرفياً');
    const imgs = [...fl.querySelectorAll('img')];
    r.ok(imgs.length === 1 && imgs[0].getAttribute('src') === GPHOTO && imgs[0].referrerPolicy === 'no-referrer',
      `الصور: المطلوب صورة Google وحدها وبلا referrer (${imgs.map(i => i.getAttribute('src')).join(' , ')})`);
    r.ok(cardOf(H, XSS_NAME)?.querySelector('.friend-avatar-placeholder')?.textContent === '<', 'صورة javascript: لم تُستبدل بالحرف الأول');
    r.ok(cardOf(H, QUOTES)?.querySelector('.friend-avatar-placeholder')?.textContent === 'أ', 'صورة مضيف آخر لم تُستبدل بالحرف الأول');
    // الطلبات
    r.ok($(H, 'friend-requests-list').textContent.includes(XSS_NAME), 'اسم صاحب الطلب لا يظهر حرفياً');
    // البحث — ومعه ملفات أسماؤها ليست نصاً (كانت تكسر البحث لكل المستخدمين — مراجعة 1.11)
    $(H, 'friends-search-input').value = 'img'; $(H, 'friends-search-btn').click(); await H.settle(0, 10);
    r.ok($(H, 'search-results').textContent.includes(XSS_NAME) && injected(H) === 0, `نتيجة البحث لا تُظهر الاسم حرفياً أو حُقنت${errText(H)}`);
    r.ok($(H, 'friends-search-btn').textContent === '🔍', `زر البحث بقي "${$(H, 'friends-search-btn').textContent}" (البحث تعطّل)`);
    $(H, 'friends-search-input').value = '77'; $(H, 'friends-search-btn').click(); await H.settle(0, 10);
    r.ok($(H, 'search-results').textContent.includes('77'), 'ملف اسمه رقم لا يظهر في البحث');
    // فشل البحث نفسه (صلاحيات/شبكة): الزر يرجع ورسالة واضحة — 3.3أ: البحث يقرأ profiles
    H.fb.failNextGet = 'profiles';
    $(H, 'friends-search-input').value = 'غادة'; $(H, 'friends-search-btn').click(); await H.settle(0, 10);
    r.ok($(H, 'friends-search-btn').textContent === '🔍' && $(H, 'search-results').textContent.includes('تعذّر البحث'),
      `فشل البحث: الزر "${$(H, 'friends-search-btn').textContent}" والنتيجة "${$(H, 'search-results').textContent.trim().slice(0, 40)}"`);
    // طلبات الصداقة وقائمة الأصدقاء: المعرّف من مفتاح المدخل لا من حقل uid داخله (يكتبه الطرف الآخر — مراجعة v36.0 الرابعة)
    // (v36.1 — 1.13: طلب حقيقي يحمل دليل مرسله في ملفه sentRequests/<أنا> — بدونه لا يُقبل)
    H.fb.set('users/x2', { uid: 'x2', name: 'إكس', sentRequests: { me: 1 } });
    H.fb.set('users/me/friendRequests/x2', { uid: 'w', name: 'إكس' });
    H.fb.set('users/me/friendRequests/nouid', { name: 'بلا معرّف' });
    H.fb.set('users/me/friendRequests/ghost', { uid: 'ghost', name: 'شبح' });
    await H.settle(0, 10);
    const reqCard = name => [...$(H, 'friend-requests-list').querySelectorAll('.friend-card')].find(c => c.querySelector('.friend-name')?.textContent === name);
    reqCard('إكس')?.querySelector('.btn-accept')?.click(); await H.settle(0, 20);
    r.ok(!!H.fb.get('users/me/friends/x2') && H.fb.get('users/me/friends/w') == null && H.fb.get('users/w/friends/me') == null
      && H.fb.get('users/me/friendRequests/x2') == null,
      `قبول طلب يدّعي uid غيره: صادق شخصاً ثالثاً أو بقي الطلب (x2: ${!!H.fb.get('users/me/friends/x2')}, w: ${JSON.stringify(H.fb.get('users/me/friends/w'))}, طلب: ${JSON.stringify(H.fb.get('users/me/friendRequests/x2'))})`);
    reqCard('بلا معرّف')?.querySelector('.btn-reject')?.click(); await H.settle(0, 20);
    r.ok(H.fb.get('users/me/friendRequests/nouid') == null, 'طلب بلا uid لا يُرفض (يبقى للأبد)');
    // طلب بمفتاح لا ملف له (وهمي/حساب حُذف): "قبول" يحذفه ولا يكتب صداقة ولا عقدة باسمه
    reqCard('شبح')?.querySelector('.btn-accept')?.click(); await H.settle(0, 20);
    r.ok(H.fb.get('users/me/friendRequests/ghost') == null && H.fb.get('users/me/friends/ghost') == null && H.fb.get('users/ghost') == null,
      `قبول طلب بلا ملف كتب صداقة أو عقدة (صديق: ${JSON.stringify(H.fb.get('users/me/friends/ghost'))}, عقدة: ${JSON.stringify(H.fb.get('users/ghost'))})`);
    H.fb.set('users/me/friends/fd', { uid: 'victim', name: 'فادي' }); await H.settle(0, 10);
    r.ok(cardOf(H, 'فادي')?.querySelector('.btn-invite')?.dataset.uid === 'fd', `بطاقة صديق تدّعي uid غيره: أزرارها لـ ${cardOf(H, 'فادي')?.querySelector('.btn-invite')?.dataset.uid} (المطلوب fd)`);
    // وإشعار رسالته يصل (المتابعة على محادثته هو لا على uid المكتوب)، والرسالة الخبيثة فيه نص
    H.fb.set('chats/fd_me/-Nnew1', { fromUid: 'fd', text: XSS_MSG, ts: Date.now() + 1000 }); await H.settle(0, 10);
    const notif = H.doc.getElementById('chat-notification');
    r.ok(!!notif && notif.style.display === 'flex' && notif.textContent.includes('فادي') && notif.textContent.includes(XSS_MSG.slice(0, 30)) && injected(H) === 0,
      `إشعار رسالة الصديق لم يصل أو حُقن (${notif ? notif.textContent.slice(0, 50) : 'لا إشعار'})`);
    // المعرّف من مفتاح الملف لا من حقل uid داخله (يكتبه صاحبه): طلب الصداقة يذهب لصاحب الملف نفسه
    // 3.3أ: البحث من profiles — نزرع ملفه العام (المعرّف من المفتاح k1، لا من حقل uid المزوّر "victim")
    H.fb.set('users/k1', { uid: 'victim', name: 'خداع' });
    H.fb.set('profiles/k1', { name: 'خداع', photo: '', xp: 0 });
    $(H, 'friends-search-input').value = 'خداع'; $(H, 'friends-search-btn').click(); await H.settle(0, 10);
    $(H, 'search-results').querySelector('.btn-add')?.click(); await H.settle(0, 20);
    r.ok(!!H.fb.get('users/k1/friendRequests/me') && !!H.fb.get('users/me/sentRequests/k1') && H.fb.get('users/victim') == null,
      `طلب الصداقة ذهب لحقل uid المكتوب لا لصاحب الملف، أو بلا دليل في ملفي (k1: ${!!H.fb.get('users/k1/friendRequests/me')}, دليل: ${!!H.fb.get('users/me/sentRequests/k1')}, victim: ${JSON.stringify(H.fb.get('users/victim'))})`);
    // الإنجازات بعد مباراة: سجل فيه أسماء خصوم ليست نصاً (يكتبها الخصوم) لا يكسر حسابها
    const A = await H.import('js/achievements.js');
    let got = null;
    try { got = await A.checkAchievements({ mode: 'online', result: 'loss', myScore: 0, oppScore: 0, currentStreak: 0 }, {}, 4); } catch (e) { got = e; }
    r.ok(Array.isArray(got) && got.includes('social_3'), `الإنجازات تعطّلت بسجل فيه أسماء ليست نصاً (${got instanceof Error ? got.message : got})`);
    // المتصدرون
    $(H, 'leaderboard-btn').click(); await H.settle(0, 10);
    const lb = $(H, 'leaderboard-list');
    r.ok(lb.textContent.includes(XSS_NAME) && lb.textContent.includes(QUOTES) && injected(H) === 0, `المتصدرون: الأسماء لا تظهر حرفياً أو حُقنت${errText(H)}`);
    const lbImgs = [...lb.querySelectorAll('img')];
    r.ok(lbImgs.length >= 1 && lbImgs.every(i => i.getAttribute('src').startsWith('https://lh3.googleusercontent.com/') && i.referrerPolicy === 'no-referrer'),
      `المتصدرون: صور من مضيفين آخرين (${lbImgs.map(i => i.getAttribute('src')).join(' , ')})`);
    // المحادثة: اسم ليس نصاً، ورسالة خبيثة
    cardOf(H, '1,2')?.querySelector('.btn-chat')?.click(); await H.settle(0, 10);
    r.ok($(H, 'chat-with-name').textContent === '1,2' && $(H, 'chat-with-avatar').textContent === '1', `فتح محادثة صديق اسمه ليس نصاً تعطّل (${$(H, 'chat-with-name').textContent})${errText(H)}`);
    r.ok($(H, 'chat-messages').textContent.includes(XSS_MSG) && injected(H) === 0, 'رسالة المحادثة لا تظهر حرفياً أو حُقنت');
    r.ok(H.errors.length === 0, 'أخطاء' + errText(H));
  } catch (e) { r.ok(false, 'خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}


// ─── 6. الأصدقاء فوق قواعد الأمان الحقيقية (v36.1 — الخطوة 1.13) ─────────
// القواعد القديمة (الإنتاج حتى 2026-10-19) كانت ترفض كل كتابة في ملف الآخر: لا طلب يصل، والحذف من طرف واحد،
// والواجهة تقول "✅ أُرسل" قبل الكتابة. الآن: الطلب = صندوقه + دليلي في ملفي، والقبول والحذف من الطرفين بكتابة واحدة.
// الطرف الآخر يُحاكى بـ fb.writeAs (جهازه يكتب بالقواعد نفسها).
const searchFor = async (H, q) => { $(H, 'friends-search-input').value = q; $(H, 'friends-search-btn').click(); await H.settle(0, 10); };
const flashText = H => ($(H, 'friends-flash') && !$(H, 'friends-flash').classList.contains('hidden')) ? $(H, 'friends-flash').textContent : '';
// قبول من جهاز الطرف الآخر كما يفعل friends.js (يستهلك الدليل)؛ consume=false: كما تفعل نسخة أقدم (يبقى الدليل لتنظيف المرسل)
// زر بطاقة شخص في نتائج البحث كما هو الآن (يُعاد رسمه مع كل تغيّر — v36.2)
const searchBtn = (H, uid) => $(H, 'search-results').querySelector(`button[data-uid="${uid}"]`);
const acceptAs = (H, accepter, sender, names = {}, { consume = true } = {}) => H.fb.writeAs(accepter, [
  [`users/${accepter}/friends/${sender}`, { uid: sender, name: names[sender] || sender, since: 1 }],
  [`users/${sender}/friends/${accepter}`, { uid: accepter, name: names[accepter] || accepter, since: 1 }],
  [`users/${accepter}/friendRequests/${sender}`, null],
  ...(consume ? [[`users/${sender}/sentRequests/${accepter}`, null]] : [])]);
export async function friendsUnderRules() {
  const r = checker('الأصدقاء فوق قواعد الأمان الحقيقية: طلب يصل، قبول وحذف من الطرفين، ولا فشل صامت (1.13)');
  // (أ) القواعد الجديدة: إرسال ← قبول من جهازه ← حالة حيّة ← حذف من الطرفين ← لا عودة بلا طلب جديد
  {
    const H = await bootApp({ data: {
      'users/me': { uid: 'me', name: 'أنا' },
      'users/b': { uid: 'b', name: 'باسل', presence: { state: 'online', lastSeen: 1 } },
    } });
    H.win.confirm = () => true;
    try {
      $(H, 'friends-btn').click(); await H.settle();
      await searchFor(H, 'باسل');
      const add = $(H, 'search-results').querySelector('.btn-add');
      r.ok(add?.textContent === '➕ إضافة', `(أ) زر الإضافة غير ظاهر (${add?.textContent})`);
      add?.click(); await H.settle(0, 20);
      r.ok(!!H.fb.get('users/b/friendRequests/me') && !!H.fb.get('users/me/sentRequests/b'),
        `(أ) الطلب لم يصل صندوقه أو بلا دليل في ملفي (طلب: ${!!H.fb.get('users/b/friendRequests/me')}, دليل: ${!!H.fb.get('users/me/sentRequests/b')})`);
      r.ok(searchBtn(H, 'b')?.textContent === '✅ أُرسل', `(أ) الزر بعد الإرسال "${searchBtn(H, 'b')?.textContent}"`);
      const ok = acceptAs(H, 'b', 'me', { b: 'باسل', me: 'أنا' }); await H.settle(0, 20);
      r.ok(ok.ok, `(أ) قبول باسل من جهازه رفضته القواعد (${ok.path})`);
      r.ok(stateOf(H, 'باسل') === 'online', `(أ) باسل لم يظهر في قائمتي بحالته بعد قبوله (${stateOf(H, 'باسل')})${errText(H)}`);
      r.ok(H.fb.get('users/me/sentRequests/b') == null, '(أ) دليل طلبي بقي بعد القبول (إذن مفتوح ليعيد نفسه لقائمتي)');
      H.fb.set('users/b/presence', { state: 'playing', lastSeen: 2 }); await H.settle();
      r.ok(stateOf(H, 'باسل') === 'playing', `(أ) حالة باسل بعد إضافته ليست حيّة (${stateOf(H, 'باسل')}) — باقي فحص 4`);
      await searchFor(H, 'باسل');
      r.ok($(H, 'search-results').querySelector('.btn-add-done')?.textContent === '✓ صديقك' && !$(H, 'search-results').querySelector('.btn-add'),
        '(أ) البحث عن صديق حالي يعرض "➕ إضافة" بدل "✓ صديقك"');
      cardOf(H, 'باسل')?.querySelector('.btn-remove')?.click(); await H.settle(0, 20);
      r.ok(H.fb.get('users/me/friends/b') == null && H.fb.get('users/b/friends/me') == null,
        `(أ) الحذف لم يكن من الطرفين (عندي: ${!!H.fb.get('users/me/friends/b')}, عنده: ${!!H.fb.get('users/b/friends/me')})`);
      const back = H.fb.writeAs('b', [['users/me/friends/b', { uid: 'b', name: 'باسل' }]]);
      r.ok(!back.ok && H.fb.get('users/me/friends/b') == null, '(أ) باسل أعاد نفسه لقائمتي بلا طلب جديد مني');
      const forced = H.fb.writeAs('x', [['users/me/friends/x', { uid: 'x', name: 'متطفّل' }]]);
      r.ok(!forced.ok, '(أ) غريب أضاف نفسه لقائمتي بلا طلب');
      r.ok(H.errors.length === 0, '(أ) أخطاء' + errText(H));
    } catch (e) { r.ok(false, '(أ) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  // (ب) صداقة من طرف واحد (حالة أ وب بعد فحص 4): عنده أنا، وعندي لا هو → أضيفه، يقبل، تكتمل من الطرفين
  {
    const H = await bootApp({ data: {
      'users/me': { uid: 'me', name: 'أنا' },
      'users/b': { uid: 'b', name: 'باسل', friends: { me: { uid: 'me', name: 'أنا' } } },
    } });
    try {
      $(H, 'friends-btn').click(); await H.settle();
      await searchFor(H, 'باسل');
      $(H, 'search-results').querySelector('.btn-add')?.click(); await H.settle(0, 20);
      r.ok(!!H.fb.get('users/b/friendRequests/me'), '(ب) الطلب لم يصل من هو أصلاً يعدّني صديقاً');
      const ok = acceptAs(H, 'b', 'me', { b: 'باسل', me: 'أنا' }, { consume: false }); await H.settle(0, 20);   // قبِل من نسخة أقدم
      r.ok(ok.ok && !!H.fb.get('users/me/friends/b') && !!H.fb.get('users/b/friends/me'), `(ب) الصداقة لم تكتمل من الطرفين (${ok.path || ''})`);
      r.ok(H.fb.get('users/me/sentRequests/b') == null, '(ب) قبول من نسخة أقدم ترك دليل طلبي ولم تنظّفه صفحتي');
      r.ok(H.errors.length === 0, '(ب) أخطاء' + errText(H));
    } catch (e) { r.ok(false, '(ب) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  // (ب2) صداقة من طرف واحد من جهتي: هو في قائمتي وأنا لست في قائمته → البحث يعرض "➕ إضافة" (لا "✓ صديقك")، ودليل
  // طلبي يبقى حتى يقبل (تنظيف الأدلة لا يمحوه لأنه في قائمتي)، وقبوله يكملها
  {
    const H = await bootApp({ data: {
      'users/me': { uid: 'me', name: 'أنا', friends: { b: { uid: 'b', name: 'باسل' } } },
      'users/b': { uid: 'b', name: 'باسل' },
    } });
    try {
      $(H, 'friends-btn').click(); await H.settle();
      await searchFor(H, 'باسل');
      const add = $(H, 'search-results').querySelector('.btn-add');
      r.ok(!!add && !$(H, 'search-results').querySelector('.btn-add-done'), '(ب2) صداقة من طرف واحد يعرضها البحث "✓ صديقك" فلا يصلحها شيء');
      add?.click(); await H.settle(0, 30);
      r.ok(!!H.fb.get('users/b/friendRequests/me') && !!H.fb.get('users/me/sentRequests/b'),
        `(ب2) الطلب أو دليله لم يبقيا حتى القبول (طلب: ${!!H.fb.get('users/b/friendRequests/me')}, دليل: ${!!H.fb.get('users/me/sentRequests/b')})`);
      const ok = acceptAs(H, 'b', 'me', { b: 'باسل', me: 'أنا' }); await H.settle(0, 20);
      r.ok(ok.ok && !!H.fb.get('users/b/friends/me'), `(ب2) قبوله لم يكمل الصداقة (${ok.path || ''})`);
      await searchFor(H, 'باسل');
      r.ok(!!$(H, 'search-results').querySelector('.btn-add-done'), '(ب2) بعد اكتمالها لا يعرض البحث "✓ صديقك"');
      r.ok(H.errors.length === 0, '(ب2) أخطاء' + errText(H));
    } catch (e) { r.ok(false, '(ب2) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  // (ب3) مدخلي في قائمته ليس مدخل صداقة (قيمة true لا كائن): ليست صداقة من الطرفين — البحث "➕ إضافة" والتنظيف لا يمحو
  // دليل طلبي (تعريف واحد للمدخل: كائن، كالقائمة نفسها — مراجعة v36.1 الثانية)؛ ثم حذفه وطلبي قائم: يُسحب الطلب معه
  {
    const H = await bootApp({ data: {
      'users/me': { uid: 'me', name: 'أنا', friends: { b: { uid: 'b', name: 'باسل' } } },
      'users/b': { uid: 'b', name: 'باسل', friends: { me: true } },
    } });
    H.win.confirm = () => true;
    try {
      $(H, 'friends-btn').click(); await H.settle();
      await searchFor(H, 'باسل');
      const add = $(H, 'search-results').querySelector('.btn-add');
      r.ok(!!add, '(ب3) مدخل ليس كائناً عُدّ صداقة من الطرفين ("✓ صديقك")');
      add?.click(); await H.settle(0, 30);
      r.ok(!!H.fb.get('users/b/friendRequests/me') && !!H.fb.get('users/me/sentRequests/b'), '(ب3) التنظيف محا دليل طلبي لمدخل ليس كائناً');
      cardOf(H, 'باسل')?.querySelector('.btn-remove')?.click(); await H.settle(0, 20);
      r.ok(H.fb.get('users/me/friends/b') == null && H.fb.get('users/b/friends/me') == null
        && H.fb.get('users/b/friendRequests/me') == null && H.fb.get('users/me/sentRequests/b') == null,
        `(ب3) الحذف وطلبي قائم: بقي الطلب في صندوقه أو دليله (طلب: ${!!H.fb.get('users/b/friendRequests/me')}, دليل: ${!!H.fb.get('users/me/sentRequests/b')})`);
      r.ok(H.errors.length === 0, '(ب3) أخطاء' + errText(H));
    } catch (e) { r.ok(false, '(ب3) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  // (ج) طلب قديم بلا دليل في ملف مرسله (من نسخة قبل v36.1): القبول يحذفه ويقول ذلك — لا صداقة من طرف واحد
  {
    const H = await bootApp({ data: {
      'users/me': { uid: 'me', name: 'أنا', friendRequests: { o: { uid: 'o', name: 'عمر' } } },
      'users/o': { uid: 'o', name: 'عمر' },
    } });
    try {
      $(H, 'friends-btn').click(); await H.settle();
      const card = [...$(H, 'friend-requests-list').querySelectorAll('.friend-card')].find(c => c.querySelector('.friend-name')?.textContent === 'عمر');
      card?.querySelector('.btn-accept')?.click(); await H.settle(0, 20);
      r.ok(H.fb.get('users/me/friendRequests/o') == null && H.fb.get('users/me/friends/o') == null && H.fb.get('users/o/friends/me') == null,
        `(ج) طلب بلا دليل: بقي أو كتب صداقة (طلب: ${!!H.fb.get('users/me/friendRequests/o')}, عندي: ${!!H.fb.get('users/me/friends/o')})`);
      r.ok(/نسخة قديمة/.test(flashText(H)), `(ج) لا رسالة تشرح (${flashText(H)})`);
      r.ok(H.errors.length === 0, '(ج) أخطاء' + errText(H));
    } catch (e) { r.ok(false, '(ج) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  // (ج2) الرفض يستهلك الدليل في ملف مرسله؛ وقبولٌ ثانٍ لطلب قُبل للتو من صفحة أخرى لي لا يقول "نسخة قديمة"
  {
    const H = await bootApp({ data: {
      'users/me': { uid: 'me', name: 'أنا', friendRequests: { r: { uid: 'r', name: 'رامي' }, k: { uid: 'k', name: 'كمال' } },
        friends: { k: { uid: 'k', name: 'كمال' } } },
      'users/r': { uid: 'r', name: 'رامي', sentRequests: { me: 1 } },
      'users/k': { uid: 'k', name: 'كمال', friends: { me: { uid: 'me', name: 'أنا' } } },
    } });
    try {
      $(H, 'friends-btn').click(); await H.settle();
      const reqCard = n => [...$(H, 'friend-requests-list').querySelectorAll('.friend-card')].find(c => c.querySelector('.friend-name')?.textContent === n);
      reqCard('رامي')?.querySelector('.btn-reject')?.click(); await H.settle(0, 20);
      r.ok(H.fb.get('users/me/friendRequests/r') == null && H.fb.get('users/r/sentRequests/me') == null,
        `(ج2) الرفض: بقي الطلب أو دليله (طلب: ${!!H.fb.get('users/me/friendRequests/r')}, دليل: ${!!H.fb.get('users/r/sentRequests/me')})`);
      r.ok(!H.fb.writeAs('me', [['users/r/friends/me', { uid: 'me', name: 'أنا' }]]).ok, '(ج2) بعد الرفض: أستطيع إضافة نفسي لقائمة رامي بدليله');
      reqCard('كمال')?.querySelector('.btn-accept')?.click(); await H.settle(0, 20);
      r.ok(H.fb.get('users/me/friendRequests/k') == null && !!H.fb.get('users/me/friends/k') && !/نسخة قديمة|تعذّر/.test(flashText(H)),
        `(ج2) قبول ثانٍ لصداقة قائمة من الطرفين: "${flashText(H)}"`);
      r.ok(H.errors.length === 0, '(ج2) أخطاء' + errText(H));
    } catch (e) { r.ok(false, '(ج2) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  // (د) قواعد بلا profiles (لو رُفعت الشيفرة قبل نشر قواعد المرحلة 1): البحث يتعطّل بلطف، وفشل الكتابة في ملف
  // الآخر (قواعد ما قبل v36.1) يُقال، ولا شيء يُكتب نصفه، ولا رفض بلا معالج (خطأ صامت)
  {
    const H = await bootApp({ rules: OLD_RULES, data: {
      'users/me': { uid: 'me', name: 'أنا', friends: { f: { uid: 'f', name: 'فرح' } }, friendRequests: { q: { uid: 'q', name: 'قيس' } } },
      'users/f': { uid: 'f', name: 'فرح', friends: { me: { uid: 'me', name: 'أنا' } } },
      'users/q': { uid: 'q', name: 'قيس', sentRequests: { me: 1 } },
      'users/b': { uid: 'b', name: 'باسل' },
    } });
    H.win.confirm = () => true;
    try {
      $(H, 'friends-btn').click(); await H.settle();
      // 3.3أ: الكود الجديد يقرأ profiles — تحت قواعد بلا profiles، البحث يتعطّل بلطف (رسالة واضحة، الزر يرجع،
      // بلا انهيار ولا رفض بلا معالج) لا أن ينهار
      await searchFor(H, 'باسل');
      r.ok($(H, 'friends-search-btn').textContent === '🔍' && /تعذّر البحث/.test($(H, 'search-results').textContent),
        `(د) تحت قواعد بلا profiles: البحث لم يتعطّل بلطف (الزر "${$(H, 'friends-search-btn').textContent}"، "${$(H, 'search-results').textContent.trim().slice(0, 40)}")`);
      cardOf(H, 'فرح')?.querySelector('.btn-remove')?.click(); await H.settle(0, 20);
      r.ok(!!H.fb.get('users/me/friends/f') && !!H.fb.get('users/f/friends/me') && /تعذّر حذف/.test(flashText(H)),
        `(د) حذف مرفوض: صار من طرف واحد أو بلا رسالة (عندي: ${!!H.fb.get('users/me/friends/f')}, عندها: ${!!H.fb.get('users/f/friends/me')}, "${flashText(H)}")`);
      const qc = [...$(H, 'friend-requests-list').querySelectorAll('.friend-card')].find(c => c.querySelector('.friend-name')?.textContent === 'قيس');
      qc?.querySelector('.btn-accept')?.click(); await H.settle(0, 20);
      r.ok(H.fb.get('users/me/friends/q') == null && H.fb.get('users/q/friends/me') == null && !!H.fb.get('users/me/friendRequests/q') && /تعذّر قبول/.test(flashText(H)),
        `(د) قبول مرفوض: كُتب نصفه أو اختفى الطلب أو بلا رسالة ("${flashText(H)}")`);
      r.ok(H.errors.length === 0, '(د) أخطاء (رفض بلا معالج = فشل صامت)' + errText(H));
    } catch (e) { r.ok(false, '(د) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  return r;
}


// ─── 7. اسم اللاعب 2 مفتاحاً في الإحصائيات (v36.1 — الخطوة 1.12) ──────────
// فحص 1 لـv36.0: "/" في اسم يقسم المسار فتختفي المباراة من الإحصائيات، و". # $ [ ]" يرفضها Firebase فلا تُسجَّل
// المباراة أصلاً (لا سجل ولا خبرة). الوهمي يتحقق من المفاتيح كالحزمة الحقيقية، واللعبة تعمل فوق القواعد.
export async function localStatsKeys() {
  const r = checker('اسم اللاعب 2 بأي رموز: المباراة تُحسب في الإحصائيات والسجل والخبرة، والأسماء القديمة على مفاتيحها (1.12)');
  const H = await bootApp({ data: {
    'users/me': { uid: 'me', name: 'أنا', xp: 0, stats: { local: { 'vs_سيمو': { name: 'سيمو', history: { 1: { r: 'w' }, 2: { r: 'l' } } } } } },
  } });
  try {
    const G = await H.import('js/ui/gameEnd.js');
    const cases = [
      ['<b>تجربة</b>', 'vs_<b>تجربة<%CPb>'], ['أبو.علي', 'vs_أبو%COعلي'], ['Player#1', 'vs_player%CD1'],
      ['Player%231', 'vs_player%231'],   // مكتوبٌ يشبه ترميزاً معتاداً لـ"#" — مفتاحه غير مفتاح Player#1 (لا تصادم)
      ['AC/DC', 'vs_ac%CPdc'], ['x[1]$', 'vs_x%FL1%FN%CE'], ['سيمو', 'vs_سيمو'],
    ];
    for (const [name, key] of cases) {
      const xp0 = Number(H.fb.get('users/me/xp')) || 0;
      const hist0 = Object.keys(H.fb.get('users/me/matchHistory') || {}).length;
      G.resetMatchTimer();
      await G.endGame({ aiMode: 'human', online: false, rows: 3, cols: 3, players: 2, multiPlayers: null,
        localPlayerNames: { 1: 'أنا', 2: name }, colors: ['#f00', '#00f'] }, { 1: 3, 2: 1 });
      await H.settle(0, 20);
      const st = H.fb.get(`users/me/stats/local/${key}`);
      const n = Object.keys(st?.history || {}).length;
      r.ok(st?.name === name && n === (name === 'سيمو' ? 3 : 1), `${name}: الإحصائيات تحت ${key} (${JSON.stringify(st)?.slice(0, 80)})`);
      const hist = Object.values(H.fb.get('users/me/matchHistory') || {});
      r.ok(hist.length === hist0 + 1 && hist.some(m => m.vs === name), `${name}: المباراة لم تُحفظ في السجل (${hist.length - hist0})`);
      r.ok((Number(H.fb.get('users/me/xp')) || 0) > xp0, `${name}: بلا خبرة لهذه المباراة`);
      const h2h = $(H, 'head-to-head');
      r.ok(!h2h.classList.contains('hidden') && h2h.textContent.includes(`أنت vs ${name}`) && h2h.textContent.includes(`🏆 ${name === 'سيمو' ? 2 : 1}`),
        `${name}: مربع "أنت vs" (${h2h.classList.contains('hidden') ? 'مخفي' : h2h.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)})`);
    }
    // نافذة الإحصائيات: كل اسم بصفّه
    const SM = await H.import('js/ui/statsModal.js');
    await SM.renderStatsModal('me'); await H.settle(0, 10);
    const rows = [...H.doc.querySelectorAll('#stats-content .vs-name')].map(e => e.textContent);
    r.ok(cases.every(([name]) => rows.includes(name)), `نافذة الإحصائيات لا تُظهر كل الأسماء (${rows.join(' | ')})`);
    // أونلاين: معرّف خصم لا يصلح مفتاحاً (من بيانات الغرفة يكتبها الخصم) — لا يُكتب في مكان خاطئ ولا يُسقط حفظ المباراة
    const histLen = () => Object.keys(H.fb.get('users/me/matchHistory') || {}).length;
    for (const bad of ['a/b', 'x.y']) {
      const h0 = histLen();
      G.resetMatchTimer();
      await G.endGame({ aiMode: 'online', online: true, rows: 3, cols: 3, players: 2, onlinePlayerNum: 1, onlineOpponentUid: bad,
        multiPlayers: null, onlinePlayerNames: { 1: 'أنا', 2: 'خصم' }, colors: ['#f00', '#00f'] }, { 1: 3, 2: 1 });
      await H.settle(0, 20);
      r.ok(histLen() === h0 + 1, `معرّف خصم غير سليم (${bad}) أسقط حفظ المباراة`);
      r.ok(H.fb.get('users/me/stats/online') == null, `معرّف خصم غير سليم (${bad}) كُتب في الإحصائيات: ${JSON.stringify(H.fb.get('users/me/stats/online'))}`);
      r.ok($(H, 'head-to-head').classList.contains('hidden'), `معرّف خصم غير سليم (${bad}): مربع "أنت vs" ظاهر بأرقام لا شيء وراءها`);
    }
    // تعذّر قراءة السجل للإنجازات: الخبرة تُحسب رغم ذلك
    { const xp0 = Number(H.fb.get('users/me/xp')) || 0;
      H.fb.failNextGet = 'users/me/matchHistory';
      G.resetMatchTimer();
      await G.endGame({ aiMode: 'human', online: false, rows: 3, cols: 3, players: 2, multiPlayers: null,
        localPlayerNames: { 1: 'أنا', 2: 'سيمو' }, colors: ['#f00', '#00f'] }, { 1: 3, 2: 1 });
      await H.settle(0, 20);
      r.ok(H.fb.failNextGet === null && (Number(H.fb.get('users/me/xp')) || 0) > xp0, 'تعذّر قراءة السجل للإنجازات أسقط خبرة المباراة'); }
    // تعذّر قراءة الإحصائيات (شبكة/صلاحيات): المباراة تبقى في السجل وبخبرتها، ومربع "أنت vs" يُخفى وحده
    { const h0 = histLen(), xp0 = Number(H.fb.get('users/me/xp')) || 0;
      H.fb.failNextGet = 'users/me/stats';
      G.resetMatchTimer();
      await G.endGame({ aiMode: 'human', online: false, rows: 3, cols: 3, players: 2, multiPlayers: null,
        localPlayerNames: { 1: 'أنا', 2: 'سيمو' }, colors: ['#f00', '#00f'] }, { 1: 3, 2: 1 });
      await H.settle(0, 20);
      r.ok(H.fb.failNextGet === null, 'قراءة الإحصائيات لم تُجرَّب (الفحص لا يختبر شيئاً)');
      r.ok(histLen() === h0 + 1 && (Number(H.fb.get('users/me/xp')) || 0) > xp0, 'تعذّر قراءة الإحصائيات أسقط حفظ المباراة أو خبرتها');
      r.ok($(H, 'head-to-head').classList.contains('hidden'), 'مربع "أنت vs" ظاهر بلا أرقام بعد تعذّر الإحصائيات'); }
    r.ok(H.errors.length === 0, 'أخطاء' + errText(H));
  } catch (e) { r.ok(false, 'خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}


// بديل PIXI لا يرسم شيئاً: كل خاصية/استدعاء/إنشاء يرجع بديلاً مثله (وليس "thenable" فلا يعلّق await)
function pixiStub() {
  const handler = {
    get(t, k) {
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      if (!(k in t)) t[k] = pixiStub();
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; },
    apply() { return pixiStub(); },
    construct() { return pixiStub(); },
  };
  return new Proxy(function () {}, handler);
}

// ─── 8. الحضور يصحّح نفسه (v36.1 — الخطوة 1.14) ─────────────────────
// فحص 5 لـv36.0: "أ" ظهر "متصل" وهو في مباراة ضد الكمبيوتر، وتحديث الصفحة أصلحه. هنا اللعبة كاملة: مباراة ضد
// الكمبيوتر من شاشة الإعداد الحقيقية، ثم ما يجعل القاعدة تخالف الصفحة دون علمها (أمر انقطاع ينفّذه الخادم متأخراً
// والصفحة متصلة، وكتابة ترفضها القواعد)، والصفحة تصحّحها وحدها؛ وتقرير JAZAM_PRESENCE() بلا بيانات الحساب.
export async function presenceSelfHeal() {
  const r = checker('الحضور في اللعبة كاملة: "في مباراة" في كل مباراة بالصفحة نفسها (ضد الكمبيوتر ومحلي)، ويصحّح نفسه بعد أمر انقطاع متأخر أو كتابة مرفوضة، وJAZAM_PRESENCE() بلا بيانات الحساب (1.14)');
  const U = { uid: 'u7f3aQ', displayName: 'سرّي', email: 'secret@example.com', photoURL: GPHOTO, isAnonymous: false, providerData: [] };
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const data = { 'users/u7f3aQ': { uid: 'u7f3aQ', name: 'سرّي', email: 'secret@example.com' } };
  const startAI = async H => {
    H.win.PIXI = pixiStub();      // اللوحة ترسم بـPIXI (WebGL) — لا يوجد في jsdom: بديل يقبل كل شيء ولا يرسم
    const ai = [...H.doc.querySelectorAll('#mode-cards .mode-card')].find(c => c.textContent.includes('الكمبيوتر'));
    ai?.click(); $(H, 'start-game').click(); await H.settle(0, 20);
  };
  // (أ) أمر انقطاع ينفّذه الخادم والصفحة متصلة (اتصال قديم لاحظ الخادم سقوطه متأخراً)
  {
    const H = await bootApp({ user: U, data });
    const pres = () => H.fb.get('users/u7f3aQ/presence') || {};
    try {
      r.ok(pres().state === 'online' && typeof pres().by === 'string' && pres().by.length >= 6, `البداية: "متصل" بمعرّف الصفحة (${JSON.stringify(pres())})${errText(H)}`);
      r.ok(typeof H.win.JAZAM_PRESENCE === 'function', 'JAZAM_PRESENCE() غير موجود في الصفحة');
      await startAI(H);
      r.ok(!$(H, 'board').classList.contains('hidden') && pres().state === 'playing', `ضد الكمبيوتر: "في مباراة" (${pres().state})`);
      H.fb.dropConnection(); await H.settle(0, 5);
      r.ok(pres().state === 'offline', `الخادم كتب "غير متصل" — الحالة التي يصلحها الفحص (${pres().state})`);
      await sleep(1800); await H.settle(0, 10);
      r.ok(pres().state === 'playing', `صحّحت الصفحة حالتها وحدها: "في مباراة" (${pres().state})`);
      $(H, 'restart').click(); await H.settle(0, 20);
      r.ok(pres().state === 'online', `خرج من المباراة: "متصل" (${pres().state})`);
      H.logs.length = 0;
      const ret = H.win.JAZAM_PRESENCE();
      const text = H.logs.join('\n');
      r.ok(/heal/.test(text) && /activity\s+playing \[board=1 fin=0 online=0 spec=0 out=0\]/.test(text) && /set\s+playing → online \(خروج\)/.test(text),
        `التقرير يحكي ما جرى (تصحيح، نشاط، خروج):\n${text.slice(0, 900)}`);
      r.ok(String(ret).includes('انسخ'), 'الأمر لا يدلّ على نسخ التقرير');
      r.ok(!['u7f3aQ', 'secret@example.com', 'سرّي'].some(x => text.includes(x)), 'التقرير فيه معرّف الحساب أو الإيميل أو الاسم');
      r.ok(H.errors.length === 0 && !H.logs.some(l => l.startsWith('error:')), 'أخطاء' + errText(H) + ' ' + H.logs.filter(l => l.startsWith('error:')).join(' | ').slice(0, 200));
    } catch (e) { r.ok(false, 'خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  // (ج) مباريات متتالية في الصفحة نفسها (فحص 5 لـv36.1 — السبب الحقيقي لـ1.14): اللوحة تُبنى من جديد مع كل مباراة،
  // والمرجع المحفوظ لها كان يجعل الحضور يرى لحظة البدء لوحةً مخفية فيتوقف — "متصل" في كل مباراة بعد الأولى
  {
    const H = await bootApp({ user: U, data });
    const pres = () => H.fb.get('users/u7f3aQ/presence') || {};
    const startMode = async (txt) => {
      H.win.PIXI = pixiStub();
      const card = [...H.doc.querySelectorAll('#mode-cards .mode-card')].find(c => c.textContent.includes(txt));
      card?.click(); $(H, 'start-game').click(); await H.settle(0, 20); await sleep(1100); await H.settle(0, 10);
    };
    const exit = async () => { $(H, 'restart').click(); await H.settle(0, 20); await sleep(1100); await H.settle(0, 10); };
    try {
      const seen = [];
      for (const [i, mode] of [[1, 'الكمبيوتر'], [2, 'الكمبيوتر'], [3, 'محليون'], [4, 'الكمبيوتر']]) {
        await startMode(mode);
        seen.push(`${i}:${pres().state}`);
        r.ok(pres().state === 'playing' && !$(H, 'board').classList.contains('hidden'),
          `(ج) المباراة ${i} (${mode}) في الصفحة نفسها: "في مباراة" (${pres().state})`);
        await exit();
        r.ok(pres().state === 'online', `(ج) بعد الخروج من المباراة ${i}: "متصل" (${pres().state})`);
      }
      const rep = (await H.import('js/presence.js')).presenceReport();
      r.ok(rep.events.filter(e => e.ev === 'activity' && /^playing \[board=1/.test(e.detail)).length === 4,
        `(ج) السجل: نشاط "playing" ولوحة ظاهرة عند بدء كل مباراة (${rep.events.filter(e => e.ev === 'activity').map(e => e.detail.split(' ')[0]).join('،')})`);
      r.ok(H.errors.length === 0 && !H.logs.some(l => l.startsWith('error:')), '(ج) أخطاء' + errText(H));
    } catch (e) { r.ok(false, '(ج) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  // (ب2) تراجع مرفوض: انتهت المباراة و"متصل" رُفضت (القاعدة ما زالت على "في مباراة" التي كتبتها هذه الصفحة) — يُصحَّح
  // وإن كان "متصل" أدنى رتبةً (الرتبة للتنازع بين صفحتين، لا مع كتابة الصفحة نفسها القديمة)
  {
    const H = await bootApp({ user: U, data });
    const pres = () => H.fb.get('users/u7f3aQ/presence') || {};
    try {
      await startAI(H);
      r.ok(pres().state === 'playing', `(ب2) في المباراة: "في مباراة" (${pres().state})`);
      const FROZEN = JSON.parse(JSON.stringify(RULES));
      FROZEN.rules.users.$uid['.write'] = "$uid === auth.uid && newData.child('presence/state').val() === data.child('presence/state').val()";
      H.fb.rules = FROZEN;
      $(H, 'restart').click(); await H.settle(0, 20);
      r.ok(pres().state === 'playing', `(ب2) "متصل" رُفضت والقاعدة على القديم (${pres().state})`);
      H.fb.rules = RULES;
      await sleep(1800); await H.settle(0, 10);
      r.ok(pres().state === 'online', `(ب2) صُحّحت إلى "متصل" (${pres().state})`);
      r.ok(H.errors.length === 0 && !H.logs.some(l => l.startsWith('error:')), '(ب2) أخطاء' + errText(H));
    } catch (e) { r.ok(false, '(ب2) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  // (ب) كتابة ترفضها القواعد (الحالة مجمّدة مؤقتاً): لا خطأ ظاهر ولا رفض بلا معالج، يُسجَّل الفشل، وتُعاد بعد مهلة
  {
    const H = await bootApp({ user: U, data });
    const pres = () => H.fb.get('users/u7f3aQ/presence') || {};
    try {
      const FROZEN = JSON.parse(JSON.stringify(RULES));
      FROZEN.rules.users.$uid['.write'] = "$uid === auth.uid && newData.child('presence/state').val() === data.child('presence/state').val()";
      H.fb.rules = FROZEN;
      await startAI(H);
      r.ok(pres().state === 'online' && H.fb.denied.some(d => d.path.includes('/presence')), `(ب) الكتابة رُفضت والقاعدة على القديم (${pres().state})`);
      H.fb.rules = RULES;
      await sleep(1800); await H.settle(0, 10);
      r.ok(pres().state === 'playing', `(ب) أُعيدت المحاولة بعد مهلة ونجحت: "في مباراة" (${pres().state})`);
      const rep = (await H.import('js/presence.js')).presenceReport();
      r.ok(rep.events.some(e => e.ev === 'fail' && /PERMISSION_DENIED/.test(e.detail)) && rep.heals === 1 && rep.pending === 0,
        `(ب) الفشل مسجّل ثم تصحيح واحد (${rep.events.filter(e => e.ev === 'fail').map(e => e.detail).join(' | ')} — تصحيحات ${rep.heals}، معلّقة ${rep.pending})`);
      r.ok(H.errors.length === 0 && !H.logs.some(l => l.startsWith('error:')), '(ب) أخطاء' + errText(H) + ' ' + H.logs.filter(l => l.startsWith('error:')).join(' | ').slice(0, 200));
    } catch (e) { r.ok(false, 'خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  return r;
}


// ─── 9. ملاحظات الواجهة من فحوص v36.1 (v36.2 — الخطوة 1.15) ─────────
// (أ) زر بطاقة البحث يتبع الواقع بلا إعادة فتح القائمة؛ (ب) إشعار عابر لطلب صداقة يصل والصفحة مفتوحة؛ (ج) نافذة
// الإحصائيات بقراءة واحدة من الخادم مهما تبدّلت التبويبات
export async function uiNotes115() {
  const r = checker('واجهة الأصدقاء والإحصائيات (1.15): زر البحث يتبع القبول والرفض والحذف، إشعار طلب الصداقة، والإحصائيات بقراءة واحدة');
  const notif = H => $(H, 'chat-notification');
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const notifShown = H => !!notif(H) && notif(H).style.display === 'flex';
  // (أ) زر بطاقة البحث
  {
    const H = await bootApp({ data: {
      'users/me': { uid: 'me', name: 'أنا', friends: { c: { uid: 'c', name: 'كريم' } } },
      'users/b': { uid: 'b', name: 'باسل' },
      'users/c': { uid: 'c', name: 'كريم' },   // في قائمتي وحدي (صداقة من طرف واحد)
      'users/q': { uid: 'q', name: 'قيس', sentRequests: { me: 1 } },
      'users/l': { uid: 'l', name: 'ليث' },     // دليل طلبٍ قديم بقي بلا طلب في صندوقه (رفضته نسخة أقدم)
      'users/n': { uid: 'n', name: 'نادر' },
    } });
    H.fb.set('users/me/friendRequests/q', { uid: 'q', name: 'قيس' });
    H.fb.set('users/me/sentRequests/l', 1);
    H.win.confirm = () => true;
    try {
      $(H, 'friends-btn').click(); await H.settle();
      await searchFor(H, 'باسل');
      const label = () => searchBtn(H, 'b')?.textContent;
      r.ok(label() === '➕ إضافة', `(أ) البداية "${label()}"`);
      searchBtn(H, 'b').click(); await H.settle(0, 30);
      r.ok(label() === '✅ أُرسل' && !!H.fb.get('users/me/sentRequests/b'), `(أ) بعد الإرسال "${label()}"`);
      acceptAs(H, 'b', 'me', { b: 'باسل', me: 'أنا' }); await H.settle(0, 30);
      r.ok(label() === '✓ صديقك', `(أ) قَبِل وأنا أنظر — بلا إعادة فتح: "${label()}" (كانت تبقى "✅ أُرسل")`);
      cardOf(H, 'باسل')?.querySelector('.btn-remove')?.click(); await H.settle(0, 30);
      r.ok(label() === '➕ إضافة' && H.fb.get('users/me/friends/b') == null, `(أ) حذفته: "${label()}"`);
      searchBtn(H, 'b').click(); await H.settle(0, 30);
      r.ok(label() === '✅ أُرسل', `(أ) طلب جديد: "${label()}"`);
      const rej = H.fb.writeAs('b', [['users/b/friendRequests/me', null], ['users/me/sentRequests/b', null]]); await H.settle(0, 10);
      r.ok(rej.ok && label() === '⏳', `(أ) رفضه: لحظة حسم "⏳" لا "➕ إضافة" عابرة (${label()})`);
      await sleep(1000); await H.settle(0, 10);
      r.ok(label() === '➕ إضافة', `(أ) رفضه: "${label()}"`);
      searchBtn(H, 'b').click(); await H.settle(0, 30);
      $(H, 'close-friends-btn').click(); await H.settle();
      $(H, 'friends-btn').click(); await H.settle();
      await searchFor(H, 'باسل');
      r.ok(label() === '✅ أُرسل', `(أ) إعادة فتح القائمة والبحث وطلبي قائم: "${label()}" (من القاعدة)`);
      // صداقة من طرف واحد من جهتي: طلب إصلاح ثم قبوله → "✓ صديقك" (كان في قائمتي قبلها)
      await searchFor(H, 'كريم');
      const cl = () => searchBtn(H, 'c')?.textContent;
      r.ok(cl() === '➕ إضافة', `(أ) طرف واحد: "${cl()}"`);
      searchBtn(H, 'c').click(); await H.settle(0, 30);
      r.ok(cl() === '✅ أُرسل', `(أ) طرف واحد — طلب الإصلاح: "${cl()}"`);
      H.fb.getDelay = p => (p === 'users/c/friends/me' ? 1300 : 0);    // قراءة التأكيد بطيئة (جوال/إعادة اتصال)
      acceptAs(H, 'c', 'me', { c: 'كريم', me: 'أنا' }); await H.settle(0, 40);
      await sleep(1600); await H.settle(0, 10);
      H.fb.getDelay = null;
      r.ok(cl() === '✓ صديقك', `(أ) طرف واحد — قَبِل (والتأكيد أبطأ من مهلة الحسم): "${cl()}"`);
      // هو أرسل لي وأنا أنظر إلى بطاقته في البحث: أقبل من قائمة الطلبات → "✓ صديقك" (لا طلب لي يتغيّر)
      await searchFor(H, 'قيس');
      const ql = () => searchBtn(H, 'q')?.textContent;
      r.ok(ql() === '➕ إضافة', `(أ) أرسل لي: "${ql()}"`);
      const qc = [...$(H, 'friend-requests-list').querySelectorAll('.friend-card')].find(c => c.querySelector('.friend-name')?.textContent === 'قيس');
      qc?.querySelector('.btn-accept')?.click(); await H.settle(0, 40);
      r.ok(!!H.fb.get('users/q/friends/me') && ql() === '✓ صديقك', `(أ) قبلتُ طلبه وبطاقته ظاهرة: "${ql()}"`);
      // دليل بقي بلا طلب: "➕ إضافة" لا "✅ أُرسل" إلى الأبد — وإرساله من جديد يعمل
      await searchFor(H, 'ليث');
      const ll = () => searchBtn(H, 'l')?.textContent;
      r.ok(ll() === '➕ إضافة', `(أ) دليل قديم بلا طلب في صندوقه: "${ll()}" (كان "✅ أُرسل" دائماً)`);
      searchBtn(H, 'l').click(); await H.settle(0, 30);
      r.ok(ll() === '✅ أُرسل' && !!H.fb.get('users/l/friendRequests/me'), `(أ) أرسلتُ من جديد: "${ll()}"`);
      // ورفضته نسخته الأقدم (تحذف الطلب من صندوقه وتترك دليلي) — بحث جديد يُظهر "➕ إضافة"
      H.fb.writeAs('l', [['users/l/friendRequests/me', null]]); await H.settle(0, 10);
      await searchFor(H, 'ليث');
      r.ok(ll() === '➕ إضافة', `(أ) رُفض من نسخة أقدم ثم بحث جديد: "${ll()}"`);
      // دخل قائمتي من طرفي وحده (كما تكتب نسخة أقدم): لا "✓ صديقك" قبل أن تؤكّده القاعدة
      await searchFor(H, 'نادر');
      H.fb.set('users/me/friends/n', { uid: 'n', name: 'نادر' }); await H.settle(0, 30); await sleep(1000); await H.settle(0, 10);
      r.ok(searchBtn(H, 'n')?.textContent === '➕ إضافة', `(أ) دخل قائمتي من طرف واحد: "${searchBtn(H, 'n')?.textContent}"`);
      r.ok(H.errors.length === 0, '(أ) أخطاء' + errText(H));
    } catch (e) { r.ok(false, '(أ) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  // (ب) إشعار طلب الصداقة
  {
    const H = await bootApp({ data: {
      'users/me': { uid: 'me', name: 'أنا', friendRequests: { o: { uid: 'o', name: 'عمر' } } },
      'users/o': { uid: 'o', name: 'عمر', sentRequests: { me: 1 } },
      'users/k': { uid: 'k', name: 'كمال' },
      'users/x': { uid: 'x', name: XSS_NAME },
      'users/z': { uid: 'z', name: 'زياد' },
    } });
    try {
      r.ok(!notifShown(H) && $(H, 'friend-requests-badge').textContent === '1', '(ب) طلب قائم عند الدخول: إشعار (تكفيه الشارة)');
      const sent = H.fb.writeAs('k', [['users/me/friendRequests/k', { uid: 'k', name: 'كمال' }], ['users/k/sentRequests/me', 1]]);
      await H.settle(0, 20);
      r.ok(sent.ok && notifShown(H) && notif(H).textContent.includes('كمال') && notif(H).textContent.includes('طلب صداقة'),
        `(ب) طلب جديد: لا إشعار أو نصه خاطئ ("${notif(H)?.textContent || ''}")`);
      r.ok($(H, 'friend-requests-badge').textContent === '2', '(ب) الشارة لم تصر 2');
      notif(H).click(); await H.settle();
      r.ok(!$(H, 'friends-panel').classList.contains('hidden') && !notifShown(H), '(ب) النقر لا يفتح قائمة الأصدقاء');
      H.fb.writeAs('z', [['users/me/friendRequests/z', { uid: 'z', name: 'زياد' }], ['users/z/sentRequests/me', 1]]); await H.settle(0, 20);
      r.ok(!notifShown(H), '(ب) إشعار والقائمة مفتوحة (الطلب ظاهر فيها)');
      $(H, 'close-friends-btn').click(); await H.settle();
      // سحب طلبه وإعادته (إزعاج): لا إشعار ثانٍ للمرسل نفسه خلال 10 دقائق
      H.fb.writeAs('k', [['users/me/friendRequests/k', null]]); await H.settle(0, 10);
      H.fb.writeAs('k', [['users/me/friendRequests/k', { uid: 'k', name: 'كمال' }], ['users/k/sentRequests/me', 1]]); await H.settle(0, 20);
      r.ok(!notifShown(H), '(ب) سحب طلبه وإعادته: إشعار ثانٍ (إزعاج)');
      H.fb.writeAs('x', [['users/me/friendRequests/x', { uid: 'x', name: XSS_NAME }], ['users/x/sentRequests/me', 1]]); await H.settle(0, 20);
      r.ok(notifShown(H) && injected(H) === 0, `(ب) اسم خبيث في الإشعار: نص لا شيفرة (${injected(H)})`);
      r.ok(H.errors.length === 0, '(ب) أخطاء' + errText(H));
    } catch (e) { r.ok(false, '(ب) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  // (ج) نافذة الإحصائيات: قراءة واحدة عند الفتح، والتبويبات من الذاكرة
  {
    const now = Date.now();
    const H = await bootApp({ data: {
      'users/me': { uid: 'me', name: 'أنا', stats: { ai: { history: { [now - 40 * 86400000]: { r: 'w' }, [now - 1000]: { r: 'l' } } } } },
    } });
    try {
      const statsReads = () => H.fb.gets.filter(p => p === 'users/me/stats').length;
      const r0 = statsReads();
      $(H, 'stats-btn').click(); await H.settle(0, 20);
      const aiRow = () => $(H, 'stats-content').querySelector('.stats-vs-row')?.textContent.replace(/\s+/g, ' ').trim() || $(H, 'stats-content').querySelector('.stats-empty')?.textContent || '';
      r.ok(statsReads() - r0 === 1 && /🏆 1/.test(aiRow()) && /💔 1/.test(aiRow()), `(ج) الفتح: قراءة واحدة (${statsReads() - r0}) و"كل الوقت" (${aiRow()})`);
      const tab = id => $(H, 'stats-content').querySelector(`.sft-btn[data-filter="${id}"]`);
      for (let i = 0; i < 3; i++) for (const id of ['month', 'last10', 'all']) { tab(id).click(); await H.settle(0, 2); }
      tab('month').click(); await H.settle(0, 5);
      r.ok(statsReads() - r0 === 1, `(ج) عشر نقرات تبويب بلا قراءة من الخادم (${statsReads() - r0 - 1} قراءة زائدة)`);
      r.ok(tab('month').classList.contains('active') && /🏆 0/.test(aiRow()) && /💔 1/.test(aiRow()), `(ج) "هذا الشهر" يُرسم من الذاكرة (${aiRow()})`);
      await H.win._refreshStats(); await H.settle(0, 10);
      r.ok(statsReads() - r0 === 2 && tab('month').classList.contains('active'), `(ج) تحديث بعد مباراة: قراءة واحدة جديدة والتبويب نفسه (${statsReads() - r0})`);
      r.ok(H.errors.length === 0 && !H.logs.some(l => l.startsWith('error:')), '(ج) أخطاء' + errText(H));
    } catch (e) { r.ok(false, '(ج) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    H.close();
  }
  return r;
}

// ─── 12. الخصوصية (3.3أ): الإيميل خارج القاعدة، الملف العام profiles يُكتب ويُطابق، والخبرة في المكانين ───
export async function privacyProfileSplit() {
  const r = checker('الخصوصية (3.3أ): الإيميل خارج القاعدة، الملف العام profiles يُكتب ويطابق، والخبرة في users وprofiles معاً');
  // ملف قديم فيه إيميل مخزَّن من نسخة سابقة، وخبرة قائمة
  const H = await bootApp({ autoProfiles: false, data: { 'users/me': { uid: 'me', name: 'أنا', email: 'me@x.com', photo: GPHOTO, xp: 5, stats: { ai: {} } } } });
  try {
    // الإيميل القديم يُمسح عند الدخول، ولا يُكتب جديد (اللعبة لا تستعمله — يبقى في حساب Firebase)
    r.ok(H.fb.get('users/me/email') == null, `الإيميل بقي في القاعدة (${JSON.stringify(H.fb.get('users/me/email'))})`);
    // الملف العام يُكتب عند الدخول (الاسم/الصورة/الخبرة) — منه البحث والمتصدرون وخبرة الخصم
    const prof = H.fb.get('profiles/me') || {};
    r.ok(prof.name === 'أنا' && prof.photo === GPHOTO && prof.xp === 5, `الملف العام ناقص أو لا يطابق (${JSON.stringify(prof)})`);
    // addXP يكتب الخبرة في الملف الخاص (الموثوق) والعام معاً
    const X = await H.import('js/xp.js');
    await X.addXP(10); await H.settle(0, 10);
    r.ok(H.fb.get('users/me/xp') === 15 && H.fb.get('profiles/me/xp') === 15,
      `الخبرة لم تتطابق في المكانين (users ${H.fb.get('users/me/xp')}، profiles ${H.fb.get('profiles/me/xp')})`);
    // getXP يقرأ من الملف العام (يصلح لي ولغيري)
    r.ok((await X.getXP('me')) === 15, `getXP لا يقرأ من الملف العام (${await X.getXP('me')})`);
    r.ok(H.errors.length === 0, 'أخطاء' + errText(H));
  } catch (e) { r.ok(false, 'خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  H.close();
  // حساب جديد (ملف لم يُنشأ بعد): الإيميل لا يُكتب أصلاً، والملف العام يُنشأ باسمه
  const H2 = await bootApp({ autoProfiles: false, user: ME });
  try {
    r.ok(H2.fb.get('users/me/email') == null, `حساب جديد: الإيميل كُتب (${JSON.stringify(H2.fb.get('users/me/email'))})`);
    r.ok((H2.fb.get('users/me') || {}).name === ME.displayName, 'حساب جديد: الملف لم يُنشأ باسمه');
    r.ok((H2.fb.get('profiles/me') || {}).name === ME.displayName, 'حساب جديد: الملف العام لم يُنشأ');
    r.ok(H2.errors.length === 0, '(جديد) أخطاء' + errText(H2));
  } catch (e) { r.ok(false, '(جديد) خطأ: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  H2.close();
  return r;
}

export const APP_ALL = [friendPresenceAcrossRerender, logoutFreshPage, accountChangesSamePage, guestUpgrade, registrationName,
  repeatedSameAccountEvent, namesAndPhotosInDomUIs, friendsUnderRules, localStatsKeys, presenceSelfHeal, uiNotes115, privacyProfileSplit];
