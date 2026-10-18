// اللعبة كاملة في jsdom (v36.0 — الخطوتان 1.10 و1.11): index.html الحقيقي + main.js وكل وحداته الحقيقية،
// فوق Firebase وهمي في الذاكرة (fakeFirebase.mjs). لا بدائل لوحدات اللعبة نفسها — فقط وحدات gstatic الثلاث.
// يفحص ما لا يراه المحاكي ولا فحوص الوحدات: تهيئة ما بعد الدخول كاملةً، والخروج، وتغيّر الحساب، وترقية الضيف،
// وبطاقات الأصدقاء الحيّة، وكل واجهة تبني أسماء الآخرين بالـDOM (الأصدقاء، البحث، الطلبات، المتصدرون، المحادثة).
import { boot } from './harness.mjs';
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
export async function bootApp({ user = ME, data = {}, cold = false } = {}) {
  const H = boot({ firebase: true, polyfills: true, cold });
  for (const [p, v] of Object.entries(data)) H.fb.set(p, v);
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
    'users/me': { uid: 'me', name: 'أنا', friends: { b: { uid: 'b', name: 'باسل' } } },
    'users/b': { uid: 'b', name: 'باسل', presence: { state: 'online', lastSeen: 1 } },
    'users/c': { uid: 'c', name: 'كريم', presence: { state: 'online', lastSeen: 1 } },
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
    'users/me': { uid: 'me', name: 'أنا', friends: { b: { uid: 'b', name: 'باسل' } } },
    'users/b': { uid: 'b', name: 'باسل', presence: { state: 'online', lastSeen: 1 } },
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
    // فشل البحث نفسه (صلاحيات/شبكة): الزر يرجع ورسالة واضحة
    H.fb.failNextGet = 'users';
    $(H, 'friends-search-input').value = 'غادة'; $(H, 'friends-search-btn').click(); await H.settle(0, 10);
    r.ok($(H, 'friends-search-btn').textContent === '🔍' && $(H, 'search-results').textContent.includes('تعذّر البحث'),
      `فشل البحث: الزر "${$(H, 'friends-search-btn').textContent}" والنتيجة "${$(H, 'search-results').textContent.trim().slice(0, 40)}"`);
    // طلبات الصداقة وقائمة الأصدقاء: المعرّف من مفتاح المدخل لا من حقل uid داخله (يكتبه الطرف الآخر — مراجعة v36.0 الرابعة)
    H.fb.set('users/x2', { uid: 'x2', name: 'إكس' });
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
    H.fb.set('users/k1', { uid: 'victim', name: 'خداع' });
    $(H, 'friends-search-input').value = 'خداع'; $(H, 'friends-search-btn').click(); await H.settle(0, 10);
    $(H, 'search-results').querySelector('.btn-add')?.click(); await H.settle(0, 20);
    r.ok(!!H.fb.get('users/k1/friendRequests/me') && H.fb.get('users/victim') == null,
      `طلب الصداقة ذهب لحقل uid المكتوب لا لصاحب الملف (k1: ${!!H.fb.get('users/k1/friendRequests/me')}, victim: ${JSON.stringify(H.fb.get('users/victim'))})`);
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

export const APP_ALL = [friendPresenceAcrossRerender, logoutFreshPage, accountChangesSamePage, guestUpgrade, registrationName,
  repeatedSameAccountEvent, namesAndPhotosInDomUIs];
