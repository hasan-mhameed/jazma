// فحوص العرض الحقيقي لأمان النصوص (v36.0 — الخطوة 1.10)
// كل واجهة تعرض أسماء أو رسائل أو أرقاماً يكتبها غيرنا تُحمَّل بكودها الحقيقي في صفحة اللعبة الحقيقية
// (jsdom)، وتُغذّى بأسماء ورسائل "خبيثة". المطلوب في كل واحدة:
//   (أ) لا عنصر من الشيفرة المحقونة يُبنى في الصفحة (ولا يعمل أي سكربت منها)،
//   (ب) النص يظهر حرفياً كما كتبه صاحبه (لا يُحذف ولا يظهر مشوّهاً بـ &lt;)،
//   (ج) الأسماء العادية تظهر كما كانت تماماً.
import { boot } from './harness.mjs';

export const XSS_NAME = `<img src=x class="xss" onerror="window.__xss=1"><b class="xss">تجربة</b>`;
export const XSS_MSG  = `<script class="xss">window.__xss=2</script><svg class="xss" onload="window.__xss=3"></svg> مرحبا`;
export const QUOTES   = `أحمد "الصغير" & 'رفيق' <3`;
export const XSS_NUM  = `<img src=x class="xss" onerror="window.__xss=4">`;

const ME = { uid: 'me', displayName: 'أنا' };
const noop = () => {};
const anyFn = new Proxy({}, { get: () => noop });   // كائن: كل دالة فيه لا تفعل شيئاً (الصوت)

function checker(title) {
  const r = { title, pass: 0, fail: 0, known: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push('❌ ' + msg); } };
  return r;
}
function injected(H) {
  return H.doc.querySelectorAll('.xss').length + (H.win.__xss !== undefined ? 1 : 0);
}
const has = (el, s) => !!el && el.textContent.includes(s);

// ─── 1. قائمة الرسائل: اسم الصديق ومعاينة آخر رسالة ─────────────────
export async function messagesList() {
  const r = checker('قائمة الرسائل: الاسم ومعاينة آخر رسالة نص لا شيفرة');
  const cbs = {}; let friendsCb = null;
  const H = boot({ stubs: {
    'js/chat.js': { listenMessages: (uid, cb) => { cbs[uid] = cb; return noop; }, markAsRead: noop,
      getLastReadMap: async () => ({}), listenLastRead: (cb) => { cb({}); return noop; }, chatKey: (a, b) => [a, b].sort().join('_') },
    'js/friends.js': { listenFriends: (cb) => { friendsCb = cb; return noop; } },
    'js/auth.js': { getCurrentUser: () => ME },
  } });
  try {
    const M = await H.import('js/ui/messagesUI.js');
    M.initMessagesUI({ onOpenChat: noop });
    friendsCb([{ uid: 'f1', name: XSS_NAME }, { uid: 'f2', name: 'سامي' }, { uid: 'f3', name: QUOTES }]);
    cbs.f1([{ fromUid: 'f1', text: XSS_MSG, ts: 3 }]);
    cbs.f2([{ fromUid: 'f2', text: 'أهلاً يا صديقي', ts: 2 }]);
    cbs.f3([{ fromUid: 'me', text: 12345, ts: 1 }]);          // نص ليس نصاً (رقم) لا يكسر القائمة
    H.doc.getElementById('messages-btn').click();
    await H.settle();
    const list = H.doc.getElementById('messages-list');
    r.ok(injected(H) === 0, `حُقنت عناصر في الصفحة (${H.doc.querySelectorAll('.xss').length})`);
    r.ok(H.doc.querySelectorAll('#messages-list .msg-row').length === 3, 'القائمة لا تعرض الأصدقاء الثلاثة');
    r.ok(has(list, XSS_NAME), 'الاسم الخبيث لا يظهر حرفياً');
    const pv = XSS_MSG.slice(0, 30) + '...';
    r.ok(has(list, pv), `معاينة الرسالة الخبيثة لا تظهر حرفياً (${pv})`);
    r.ok(has(list, 'سامي') && has(list, 'أهلاً يا صديقي'), 'الاسم والرسالة العاديان لا يظهران كما هما');
    r.ok(has(list, QUOTES), 'الاسم بعلامات تنصيص و& لا يظهر كما هو');
    r.ok(has(list, '12345'), 'رسالة رقمية لا تظهر');
    r.ok(!list.innerHTML.includes('&amp;lt;'), 'تهريب مزدوج (&amp;lt;)');
    const av = [...H.doc.querySelectorAll('#messages-list .msg-avatar')].map(e => e.textContent);
    r.ok(av.includes('<') && av.includes('س'), `الحرف الأول في الصورة البديلة خطأ: ${av.join(',')}`);
  } catch (e) { r.ok(false, 'خطأ: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}

// ─── 2. لوحة متصدري تحدي اليوم: الاسم والنقاط والمدة ─────────────────
export async function dailyLeaderboard() {
  const r = checker('متصدرو تحدي اليوم: الاسم والنقاط (يكتبها كل لاعب بنفسه) نص لا شيفرة');
  const H = boot({ stubs: {
    'js/dailyChallenge.js': { getDailyConfig: () => ({ gridSize: 4, difficulty: 'medium' }), difficultyName: () => 'متوسط',
      hasPlayedToday: async () => false, saveDailyResult: async () => {}, todayStr: () => '2026-10-18',
      getDailyLeaderboard: async () => [
        { uid: 'x', name: XSS_NAME, myScore: XSS_NUM, duration: 75 },
        { uid: 'me', name: 'أنا', myScore: 9, duration: 61 },
        { uid: 'q', name: QUOTES, myScore: 7, duration: `<b class="xss">9</b>` },
      ] },
    'js/ai/aiPlayer.js': { AIPlayer: class {} },
    'js/xp.js': { addXP: async () => null, calcXP: () => 0 },
    'js/ui/xpUI.js': { showXPGain: noop },
    'js/auth.js': { getCurrentUser: () => ME },
  } });
  try {
    const M = await H.import('js/ui/dailyChallengeUI.js');
    M.initDailyChallengeUI({ onGameStart: noop, getAiPlayer: noop });
    H.doc.getElementById('daily-btn').click();
    await H.settle();
    const lb = H.doc.getElementById('daily-leaderboard');
    r.ok(injected(H) === 0, `حُقنت عناصر في الصفحة (${H.doc.querySelectorAll('.xss').length})`);
    r.ok(H.doc.querySelectorAll('#daily-leaderboard .daily-lb-row').length === 3, 'اللوحة لا تعرض الثلاثة');
    r.ok(has(lb, XSS_NAME) && has(lb, XSS_NUM), 'الاسم/النقاط الخبيثة لا تظهر حرفياً');
    r.ok(has(lb, '1:15') && has(lb, '1:01'), 'المدة (دقائق:ثوانٍ) تغيّرت');
    r.ok(has(lb, QUOTES) && has(lb, '🥇') && has(lb, '🥈') && has(lb, '🥉'), 'الميداليات أو الاسم العادي تغيّر');
    r.ok(H.doc.querySelector('#daily-leaderboard .daily-lb-me')?.textContent.includes('أنا'), 'سطري لم يعد مميّزاً');
    const info = H.doc.getElementById('daily-info');
    r.ok(has(info, '3×3 مربعات') && has(info, 'متوسط'), 'معلومات التحدي (الحجم والصعوبة) تغيّرت');
  } catch (e) { r.ok(false, 'خطأ: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}

// ─── 3. سجل المباريات: اسم الخصم وكل حقل محفوظ ─────────────────────
export async function historyCards() {
  const r = checker('سجل المباريات: اسم الخصم والحقول المحفوظة نص لا شيفرة');
  const now = Date.now();
  const H = boot({ stubs: {
    'js/history.js': { fetchHistory: async () => ({ hasMore: false, lastKey: null, matches: [
      { mode: 'online', result: 'win', myScore: 5, oppScore: 4, vs: XSS_NAME, grid: '4x4', duration: 95, ts: now - 120000 },
      { mode: 'online', result: 'loss', myScore: XSS_NUM, oppScore: 2, vs: QUOTES, grid: `<b class="xss">g</b>`, duration: 30, ts: now - 60000 },
      { mode: 'ai', result: 'draw', myScore: 3, oppScore: 3, vs: 'الكمبيوتر', grid: '3x3', duration: 0, ts: now - 30000 },
      { mode: 'online', result: 'win hidden xss', myScore: 1, oppScore: 0, vs: 'سامي', grid: '3x3', duration: 5, ts: now - 10000 },
    ] }) },
    'js/auth.js': { getCurrentUser: () => ME },
  } });
  try {
    const M = await H.import('js/ui/historyUI.js');
    M.initHistoryUI();
    H.doc.getElementById('history-btn').click();
    await H.settle();
    const list = H.doc.getElementById('history-list');
    r.ok(injected(H) === 0, `حُقنت عناصر في الصفحة (${H.doc.querySelectorAll('.xss').length})`);
    r.ok(H.doc.querySelectorAll('#history-list .history-card').length === 4, 'السجل لا يعرض المباريات الأربع');
    const cls = [...H.doc.querySelectorAll('#history-list .history-card')].map(c => c.className);
    r.ok(cls.includes('history-card result-win') && cls.includes('history-card result-loss') && cls.includes('history-card result-draw')
      && cls.every(c => /^history-card result-(win|loss|draw)$/.test(c)), `أصناف البطاقات: نتيجة من القاعدة أضافت أصنافاً (${cls.join(' | ')})`);
    r.ok(has(list, 'vs ' + XSS_NAME), 'اسم الخصم الخبيث لا يظهر حرفياً');
    r.ok(has(list, 'vs ' + QUOTES) && has(list, 'vs الكمبيوتر'), 'الأسماء العادية تغيّرت');
    r.ok(has(list, `${XSS_NUM} – 2`) && has(list, '<b class="xss">g</b>'), 'الحقول المحفوظة الخبيثة لا تظهر حرفياً');
    r.ok(has(list, '5 – 4') && has(list, '1د 35ث') && has(list, '🏆') && has(list, '💔') && has(list, '🤝'), 'النتيجة أو المدة أو الأيقونات تغيّرت');
  } catch (e) { r.ok(false, 'خطأ: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}

// ─── 4. بطاقات اللاعبين أثناء المباراة + نافذة معلومات اللاعب ─────────
export async function scoreboardCards() {
  const r = checker('بطاقات اللاعبين أثناء المباراة ونافذة معلومات اللاعب: الاسم وXP نص لا شيفرة');
  const H = boot({ stubs: {
    'js/xp.js': { getXP: async (uid) => (uid === 'opp' ? XSS_NUM : 120),
      getLevelFromXP: () => ({ current: { icon: '⭐', title: 'مبتدئ', level: 1 } }) },
    'js/auth.js': { getCurrentUser: () => ME },
  } });
  try {
    const M = await H.import('js/ui/scoreboard.js');
    const st = await H.import('js/core/state.js');
    st.state.scores = { 1: 2, 2: 3 };
    const cfg = { aiMode: 'online', onlinePlayerNum: 1, onlineOpponentUid: 'opp', players: 2, multiPlayers: null,
      onlinePlayerNames: { 1: 'أنا', 2: XSS_NAME }, colors: ['#f00', '#00f'] };
    M.renderScoreboard(cfg);
    await H.settle();
    const sb = H.doc.getElementById('scores');
    r.ok(injected(H) === 0, `حُقنت عناصر في البطاقات (${H.doc.querySelectorAll('.xss').length})`);
    r.ok(H.doc.querySelector('#pcard2 .npc-name')?.textContent === XSS_NAME, 'اسم الخصم الخبيث لا يظهر حرفياً على بطاقته');
    r.ok(H.doc.querySelector('#pcard1 .npc-name')?.textContent === 'أنا', 'الاسم العادي تغيّر');
    r.ok(H.doc.getElementById('p1')?.textContent === '2' && H.doc.getElementById('p2')?.textContent === '3', 'النقاط أو معرّفاتها (p1/p2) تغيّرت');
    r.ok(!!H.doc.getElementById('plevel2') && !!H.doc.getElementById('pbank2'), 'معرّفات المستوى/البنك تغيّرت');
    // اسم جماعي آخر (3 لاعبين) فيه علامات تنصيص
    M.renderScoreboard({ ...cfg, onlinePlayerNames: { 1: 'أنا', 2: QUOTES, 3: XSS_NAME },
      multiPlayers: { me: { num: 1, uid: 'me' }, a: { num: 2, uid: 'a' }, b: { num: 3, uid: 'b' } } });
    await H.settle();
    r.ok(has(sb, QUOTES) && has(sb, XSS_NAME) && injected(H) === 0, 'الجماعي: الأسماء لا تظهر حرفياً أو حُقنت');
    // نافذة معلومات الخصم (XP خبيث من الخادم)
    M.renderScoreboard(cfg);
    H.doc.getElementById('pcard2').click();
    await H.settle();
    const box = H.doc.getElementById('player-info-box');
    r.ok(!!box, 'نافذة معلومات اللاعب لم تظهر');
    r.ok(box?.querySelector('h3')?.textContent === XSS_NAME, 'الاسم في نافذة المعلومات لا يظهر حرفياً');
    r.ok(has(box, `${XSS_NUM} XP`), 'XP الخبيث لا يظهر حرفياً');
    r.ok(injected(H) === 0, 'حُقنت عناصر في نافذة المعلومات');
  } catch (e) { r.ok(false, 'خطأ: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}

// ─── 5. شاشة النتيجة: ترتيب اللاعبين + "أنت vs فلان" ─────────────────
function endStubs(stats, saved = []) {
  return {
    'js/audio/audioManager.js': { audioManager: anyFn },
    'js/auth.js': { updateAIStats: async () => {}, updateLocalStats: async () => {}, updateOnlineStats: async () => {},
      updateMultiStats: async () => {}, currentUser: ME, getAllStats: async () => stats },
    'js/history.js': { saveMatch: async (m) => { saved.push(m); } },
    'js/achievements.js': { checkAchievements: async () => [], updateStreak: async () => 1, getTotalMatches: async () => 1 },
    'js/ui/achievementsUI.js': { showNewAchievements: noop },
    'js/xp.js': { calcXP: () => 0, addXP: async () => null },
    'js/ui/xpUI.js': { showXPGain: noop },
    'js/ui/dailyChallengeUI.js': { isDailyActive: () => false, finishDailyChallenge: async () => {} },
    'js/core/wallet.js': { commitMatchCoins: async () => ({ earned: 0, total: null }), getMatchCoins: () => 0 },
  };
}
export async function resultScreen() {
  const r = checker('شاشة النتيجة: أسماء الترتيب و"أنت vs فلان" نص لا شيفرة');
  // (أ) ثنائي أونلاين، الخصم باسم خبيث وفاز
  let H = boot({ stubs: endStubs({ online: { opp: { name: XSS_NAME, history: { 1: { r: 'l' }, 2: { r: 'w' } } } } }) });
  try {
    const M = await H.import('js/ui/gameEnd.js');
    M.resetMatchTimer();
    const cfg = { aiMode: 'online', rows: 3, cols: 3, onlinePlayerNum: 1, onlineOpponentUid: 'opp', players: 2,
      multiPlayers: null, onlinePlayerNames: { 1: 'أنا', 2: XSS_NAME }, colors: ['#f00', '#00f', '#0f0', '#ff0'] };
    await M.endGame(cfg, { 1: 1, 2: 3 });
    await H.settle();
    const msg = H.doc.getElementById('winner-message'), det = H.doc.getElementById('winner-details'),
          h2h = H.doc.getElementById('head-to-head');
    r.ok(!H.doc.getElementById('winner-screen').classList.contains('hidden'), 'شاشة النتيجة لم تظهر');
    r.ok(injected(H) === 0, `حُقنت عناصر في شاشة النتيجة (${H.doc.querySelectorAll('.xss').length})`);
    r.ok(msg.textContent === `🎉 ${XSS_NAME} فاز!`, 'عنوان الفائز تغيّر أو لا يظهر حرفياً');
    r.ok(has(det, `1. ${XSS_NAME}: 3 نقطة`) && has(det, '2. أنا: 1 نقطة'), 'سطور الترتيب لا تظهر حرفياً أو تغيّر شكلها');
    r.ok(has(h2h, `أنت vs ${XSS_NAME}`) && has(h2h, '🏆 1') && has(h2h, '💔 1'), '"أنت vs فلان" أو الحصيلة لا تظهر حرفياً');
  } catch (e) { r.ok(false, 'ثنائي — خطأ: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
  H.close();
  // (ب) جماعي 3 لاعبين: أحدهم خرج (شارة الخروج) وأسماء خبيثة
  H = boot({ stubs: endStubs({ multi: { history: { 1: { rank: 2, score: 2 }, 2: { rank: 1, score: 4 } } } }) });
  try {
    const M = await H.import('js/ui/gameEnd.js');
    M.resetMatchTimer();
    const cfg = { aiMode: 'online', rows: 3, cols: 3, onlinePlayerNum: 1, players: 3,
      multiPlayers: { me: { num: 1, uid: 'me' }, a: { num: 2, uid: 'a' }, b: { num: 3, uid: 'b' } },
      onlinePlayerNames: { 1: 'أنا', 2: XSS_NAME, 3: QUOTES }, colors: ['#f00', '#00f', '#0f0', '#ff0'] };
    await M.endGame(cfg, { 1: 2, 2: 1, 3: 1 }, true, null, { 3: 'انسحب' });
    await H.settle();
    const det = H.doc.getElementById('winner-details'), h2h = H.doc.getElementById('head-to-head');
    r.ok(injected(H) === 0, 'جماعي: حُقنت عناصر');
    r.ok(has(det, `2. ${XSS_NAME}: 1 نقطة`) && has(det, `3. ${QUOTES}: 1 نقطة`), 'جماعي: سطور الترتيب لا تظهر حرفياً');
    r.ok(det.querySelector('span')?.textContent === 'انسحب', 'شارة الخروج تغيّرت أو لم تعد عنصراً');
    r.ok(has(h2h, 'إحصائياتك — 3 لاعبين') && has(h2h, '🥇') && has(h2h, '50%') && has(h2h, '3.0'), 'مربع إحصائيات الجماعي تغيّر');
  } catch (e) { r.ok(false, 'جماعي — خطأ: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
  H.close();
  // (ج) اسم خصم ليس نصاً (يكتبه في الغرفة): يُحفظ في السجل نصاً (كان يكسر حساب الإنجازات بعد كل مباراة)
  const saved = [];
  H = boot({ stubs: endStubs({}, saved) });
  try {
    const M = await H.import('js/ui/gameEnd.js');
    M.resetMatchTimer();
    await M.endGame({ aiMode: 'online', rows: 3, cols: 3, onlinePlayerNum: 1, onlineOpponentUid: 'opp', players: 2, multiPlayers: null,
      onlinePlayerNames: { 1: 'أنا', 2: [7, 8] }, colors: ['#f00', '#00f'] }, { 1: 1, 2: 3 });
    await H.settle();
    r.ok(saved.length === 1 && saved[0].vs === '7,8', `اسم الخصم في السجل ليس نصاً (${JSON.stringify(saved[0]?.vs)})`);
  } catch (e) { r.ok(false, 'اسم ليس نصاً — خطأ: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}

// ─── 6. نافذة الإحصائيات: أسماء الخصوم المحفوظة ──────────────────────
export async function statsModal() {
  const r = checker('نافذة الإحصائيات: أسماء الخصوم (محلي وأونلاين) نص لا شيفرة');
  const H = boot({ stubs: {
    'js/auth.js': { getAllStats: async () => ({
      ai: { history: { 1: { r: 'w' }, 2: { r: 'l' } } },
      local: { vs_x: { name: QUOTES, history: { 1: { r: 'w' } } } },
      online: { opp1: { name: XSS_NAME, history: { 1: { r: 'w' }, 2: { r: 'd' } } }, opp2: { history: { 1: { r: 'l' } } } },
      multi: { history: { 1: { rank: 1, score: 7 }, 2: { rank: 3, score: 1 } } },
    }) },
  } });
  try {
    const M = await H.import('js/ui/statsModal.js');
    await M.renderStatsModal('me');
    const c = H.doc.getElementById('stats-content');
    r.ok(injected(H) === 0, `حُقنت عناصر (${H.doc.querySelectorAll('.xss').length})`);
    r.ok(has(c, XSS_NAME) && has(c, QUOTES), 'أسماء الخصوم لا تظهر حرفياً');
    r.ok(has(c, 'opp2'.slice(0, 8)) && has(c, 'الكمبيوتر'), 'الخصم بلا اسم (بداية uid) أو الكمبيوتر تغيّر');
    r.ok(H.doc.querySelectorAll('#stats-content .sft-btn').length === 3
      && H.doc.querySelector('#stats-content .sft-btn.active')?.dataset.filter === 'all', 'أزرار الفلتر تغيّرت');
    r.ok(has(c, '⌀ 4.0') && has(c, '50%') && H.doc.querySelectorAll('#stats-content .smg-rank-chip').length === 3, 'ملخّص الجماعي تغيّر');
    // تبديل الفلتر يعيد الرسم ويبقى آمناً
    H.doc.querySelector('#stats-content .sft-btn[data-filter="last10"]').click();
    await H.settle();
    r.ok(H.doc.querySelector('#stats-content .sft-btn.active')?.dataset.filter === 'last10' && injected(H) === 0, 'تبديل الفلتر تعطّل أو حقن');
  } catch (e) { r.ok(false, 'خطأ: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}

// ─── 0. أدوات safeText.js نفسها ─────────────────────────────────────
export async function safeTextUnit() {
  const r = checker('أدوات التهريب (safeText.js): esc وasText والحرف الأول ورابط الصورة');
  const H = boot();
  try {
    const S = await H.import('js/ui/safeText.js');
    r.ok(S.esc(`<a href="x">'&'</a>`) === '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;', `esc للرموز الخمسة: ${S.esc(`<a href="x">'&'</a>`)}`);
    r.ok(S.esc('أحمد 123') === 'أحمد 123' && S.esc(7) === '7' && S.esc(0) === '0', 'النص العادي والأرقام كما هي');
    r.ok(S.esc(null) === '' && S.esc(undefined) === '' && S.esc(undefined, 'لاعب') === 'لاعب', 'null/undefined → الاحتياط');
    r.ok(S.esc('&lt;') === '&amp;lt;', 'نص فيه كيان HTML يُعرض حرفياً (لا يُفكّ)');
    r.ok(S.asText(12) === '12' && S.asText(null, 'x') === 'x', 'asText');
    r.ok(S.firstInitial('  ali') === 'A' && S.firstInitial('') === '?' && S.firstInitial(null) === '?' && S.firstInitial(5) === '5', 'firstInitial');
    const G = 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c';
    r.ok(S.safeImageSrc(G) === G && S.safeImageSrc('https://lh5.googleusercontent.com/x.png') === 'https://lh5.googleusercontent.com/x.png',
      'safeImageSrc: صورة حساب Google تمرّ كما هي');
    r.ok(S.safeImageSrc('https://evil.example/track.png') === '' && S.safeImageSrc('http://lh3.googleusercontent.com/a.png') === ''
      && S.safeImageSrc('https://googleusercontent.com.evil.example/a.png') === '' && S.safeImageSrc('https://evilgoogleusercontent.com/a.png') === ''
      && S.safeImageSrc('https://user:pw@lh3.googleusercontent.com/a.png') === ''
      && S.safeImageSrc('javascript:alert(1)') === '' && S.safeImageSrc('data:image/svg+xml,<svg onload=alert(1)>') === ''
      && S.safeImageSrc('/jazma/images/x.png') === '' && S.safeImageSrc(null) === '' && S.safeImageSrc({ toString() { return 'javascript:1'; } }) === '',
      'safeImageSrc: أي مضيف آخر أو http أو javascript:/data: أو رابط نسبي → ""');
    r.ok(S.firstInitial('😀 سامي') === '😀', 'firstInitial: الإيموجي حرف كامل');
    // getPowerIcon: SVG من جدولها فقط، وأي احتياط يُهرَّب (يُدرج كـHTML)
    const PI = await H.import('js/ui/powerIcons.js');
    r.ok(PI.getPowerIcon('water') === PI.FISH_SVG && PI.getPowerIcon('gem', '💎') === PI.GEM_SVG, 'getPowerIcon: SVG الجدول كما هو');
    r.ok(Object.isFrozen(PI.POWER_ICONS), 'جدول الأيقونات غير مجمّد (يُدرج كـHTML بلا esc — لا يجوز أن يتغيّر)');
    r.ok(PI.getPowerIcon('nope', '<img src=x class="xss">') === '&lt;img src=x class=&quot;xss&quot;&gt;'
      && PI.getPowerIcon('constructor', '🐟') === '🐟' && PI.getPowerIcon('__proto__') === '' && PI.getPowerIcon('x', '⏱️') === '⏱️',
      'getPowerIcon: الاحتياط مُهرَّب ولا مفاتيح من سلسلة النماذج');
    // عبر محلّل HTML حقيقي: ما يُهرَّب يظهر حرفياً ولا يُبنى منه عنصر
    const d = H.doc.createElement('div');
    d.innerHTML = `<span>${S.esc(XSS_NAME)}</span>`;
    r.ok(d.textContent === XSS_NAME && !d.querySelector('.xss'), 'بعد التحليل: النص حرفي ولا عناصر');
  } catch (e) { r.ok(false, 'خطأ: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
  H.close();
  return r;
}

export const ALL = [safeTextUnit, messagesList, dailyLeaderboard, historyCards, scoreboardCards, resultScreen, statsModal];
