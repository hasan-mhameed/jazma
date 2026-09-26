// فحوص نافذة نهاية المباراة (v35.5، ونهايات الخروج v35.6) — المحاكي لا يصل منطقها الداخلي
// 1) الدالة النقية core/matchResult.js: من لعب فعلاً، من "أنا"، المراكز، نوع المباراة
// 2) تكامل gameEnd.js الحقيقي: الأسطر المعروضة + ما يُسجَّل فعلاً (إحصائيات/سجل/سلسلة/خبرة)
//    — يُحمَّل في سياق vm مع بدائل لـFirebase والواجهة، ونلتقط كل استدعاء تسجيل.
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT = process.env.JAZAM_DIR || fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

function suite(title) {
  const r = { title, pass: 0, fail: 0, known: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push('❌ ' + msg); } if (r.verbose) console.log((cond ? '  ✅ ' : '  ❌ ') + msg); };
  return r;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── لاعبو مباراة جماعية بمفتاح uid (كما في Firebase) ──
const mp = (...specs) => Object.fromEntries(specs.map(([uid, num, name, active = true]) => [uid, { name, num, active }]));
const COLORS = ['#f87171', '#60a5fa', '#4ade80', '#fbbf24'];
const online = (me, players, multiPlayers, extra = {}) => ({
  aiMode: 'online', online: true, rows: 4, cols: 4, colors: COLORS, players, onlinePlayerNum: me, multiPlayers,
  onlinePlayerNames: Object.fromEntries(Object.values(multiPlayers || {}).map(p => [p.num, p.name])), ...extra,
});
// اللوحة 4×4 = 9 مربعات؛ النقاط أدناه مجموعها 9 (نهاية طبيعية)

// ═════════ 1) الدالة النقية ═════════
export async function resultsPure(verbose = false) {
  const r = suite('نتيجة المباراة: الدالة النقية (من لعب، من أنا، المراكز)'); r.verbose = verbose;
  const file = PROJECT + '/js/core/matchResult.js';
  if (!fs.existsSync(file)) { r.ok(false, 'core/matchResult.js غير موجود'); return r; }
  const M = await import(pathToFileURL(file).href);

  // أ) حالة فحصك 3 و4: المنشئ (مقعد 1) غادر قبل البدء، لعب المقعدان 2 و3
  const gap = mp(['uB', 2, 'باسل'], ['uC', 3, 'كريم']);
  let R = M.computeMatchResult(online(2, 3, gap), { 1: 0, 2: 5, 3: 4 });
  r.ok(same(R.participants, [2, 3]), `المقعد الفارغ ليس لاعباً (اللاعبون [${R.participants}])`);
  r.ok(!R.ranking.some(x => x.player === 1), 'لا سطر للمقعد 1 في الترتيب');
  r.ok(R.me === 2 && R.myResult === 'win' && R.myRank === 1, `الفائز (مقعد 2) نتيجته فوز ومركزه 1 (${R.myResult}/${R.myRank})`);
  r.ok(R.category === 'online' && R.opponent?.uid === 'uC', `مباراة اثنين من غرفة جماعية = واحد ضد واحد ضد الخصم الحقيقي (${R.category}/${R.opponent?.uid})`);
  R = M.computeMatchResult(online(3, 3, gap, { onlineOpponentUid: 'stale_from_old_duo' }), { 1: 0, 2: 5, 3: 4 });
  r.ok(R.myResult === 'loss' && R.myRank === 2 && R.opponent?.uid === 'uB', `الخاسر (مقعد 3): خسارة مركز 2 ضد باسل لا ضد خصم قديم (${R.myResult}/${R.myRank}/${R.opponent?.uid})`);

  // ب) مباراة 3 كاملة: كل مقعد يأخذ نتيجته هو (كانت كل الأجهزة تأخذ نتيجة المقعد 1)
  const full3 = mp(['u1', 1, 'أحمد'], ['u2', 2, 'باسل'], ['u3', 3, 'كريم']);
  const sc3 = { 1: 2, 2: 5, 3: 2 };
  const res = [1, 2, 3].map(n => M.computeMatchResult(online(n, 3, full3), sc3));
  r.ok(same(res.map(x => x.myResult), ['loss', 'win', 'loss']), `كل جهاز يأخذ نتيجة مقعده (${res.map(x => x.myResult)})`);
  r.ok(same(res.map(x => x.myRank), [2, 1, 2]) && res.every(x => x.category === 'multi' && x.count === 3), `المتعادلان على المركز 2 يتشاركانه (${res.map(x => x.myRank)})`);

  // ج) الخارج أثناء المباراة: بالأسفل وخارج الفوز حتى لو نقاطه أعلى
  const withOut = mp(['u1', 1, 'أحمد'], ['u2', 2, 'باسل'], ['u3', 3, 'كريم', false]);
  R = M.computeMatchResult(online(3, 3, withOut), { 1: 1, 2: 3, 3: 5 });
  r.ok(same(R.ranking.map(x => x.player), [2, 1, 3]) && R.winnerNum === 2, `الخارج بالأسفل والفائز من المتنافسين (${R.ranking.map(x => x.player)} / فاز ${R.winnerNum})`);
  r.ok(R.exited[3] === 'انسحب' && R.myResult === 'loss' && R.myRank === 3, `الخارج نفسه: خسارة مركز 3 (${R.myResult}/${R.myRank})`);

  // د) تعادل على القمة في الجماعي
  const tie = [1, 2, 3].map(n => M.computeMatchResult(online(n, 3, full3), { 1: 4, 2: 4, 3: 1 }));
  r.ok(tie[0].isDraw && same(tie.map(x => x.myResult), ['draw', 'draw', 'loss']), `تعادل القمة (${tie.map(x => x.myResult)})`);
  r.ok(same(tie.map(x => x.myRank), [1, 1, 3]), `المراكز 1، 1، 3 (${tie.map(x => x.myRank)})`);
  r.ok(same(tie.map(M.multiHistoryResult), ['draw', 'draw', 'loss']), 'نتيجة سجل المباريات للجماعي متّسقة');
  const four = mp(['u1', 1, 'أ'], ['u2', 2, 'ب'], ['u3', 3, 'ج'], ['u4', 4, 'د']);
  const q = [1, 2, 3, 4].map(n => M.multiHistoryResult(M.computeMatchResult(online(n, 4, four), { 1: 4, 2: 3, 3: 2, 4: 0 })));
  r.ok(same(q, ['win', 'draw', 'draw', 'loss']), `سجل الأربعة: الأول فوز، الوسط تعادل، الأخير خسارة (${q})`);

  // هـ) المشاهد: لا "أنا" ولا نتيجة شخصية، والترتيب كامل
  R = M.computeMatchResult(online(null, 3, full3, { spectator: true }), sc3);
  r.ok(R.me === null && R.myResult === null && R.ranking.length === 3, 'المشاهد بلا نتيجة شخصية والترتيب كامل');
  const duoSpec = { aiMode: 'online', spectator: true, onlinePlayerNum: null, players: 2, multiPlayers: null, onlineOpponentUid: 'stale' };
  r.ok(M.getPlayerUid(duoSpec, 1) === null && M.getPlayerUid(duoSpec, 2) === null, 'المشاهد في الثنائي لا يأخذ uid خصم قديم');

  // و) الثنائي أونلاين (المنضم = مقعد 2) + نفاد بنك الوقت
  const duo = { aiMode: 'online', players: 2, onlinePlayerNum: 2, onlineOpponentUid: 'uHost', multiPlayers: null };
  R = M.computeMatchResult(duo, { 1: 3, 2: 6 });
  r.ok(R.me === 2 && R.myResult === 'win' && R.category === 'online' && R.opponent?.uid === 'uHost', `الثنائي: المنضم يأخذ نتيجته ضد المضيف (${R.myResult}/${R.opponent?.uid})`);
  R = M.computeMatchResult({ ...duo, onlinePlayerNum: 1 }, { 1: 6, 2: 2 }, { loserPlayer: 1 });
  r.ok(R.myResult === 'loss' && R.winnerNum === 2 && R.exited[1] === 'نفد وقته', 'نفاد بنك الوقت: النافد خاسر رغم نقاطه');

  // ز) ضد الكمبيوتر والمحلي: "أنا" = 1 كما كان
  R = M.computeMatchResult({ aiMode: 'ai', players: 2 }, { 1: 5, 2: 4 });
  r.ok(R.me === 1 && R.myResult === 'win' && R.category === 'ai', 'ضد الكمبيوتر كما كان');
  R = M.computeMatchResult({ aiMode: 'human', players: 3 }, { 1: 2, 2: 3, 3: 4 });
  r.ok(same(R.participants, [1, 2, 3]) && R.category === 'multi' && R.myRank === 3, 'المحلي بـ3 لاعبين كما كان');

  // ح) أمان: مدخلات ناقصة
  r.ok(same(M.getParticipants({ multiPlayers: { a: null, b: { num: '2' }, c: { num: 3 }, d: { num: 3 } }, players: 3 }), [3]), 'تجاهل المدخلات التالفة والتكرار');
  r.ok(M.getMyNum({ aiMode: 'online' }) === null, 'أونلاين بلا رقم مقعد → لا "أنا" (لا افتراض المقعد 1)');
  return r;
}

// ═════════ 2) تكامل gameEnd.js الحقيقي ═════════
class El {
  constructor(id = '') { this.id = id; this.children = []; this.style = {}; this._t = ''; this._h = '';
    const s = new Set(); this.classList = { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, f) => (f ?? !s.has(c)) ? s.add(c) : s.delete(c) }; }
  get textContent() { return this._t; } set textContent(v) { this._t = String(v); this.children = []; }
  get innerHTML() { return this._h; } set innerHTML(v) { this._h = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  remove() { this.removed = true; }   // كالـDOM الحقيقي (v35.7: إزالة بطاقة الخروج قبل النافذة)
}
const STUBS = {
  'audioManager.js': `export const audioManager = new Proxy({}, { get: () => () => {} });`,
  'auth.js': `const C = globalThis.__calls;
    export let currentUser = globalThis.__user;
    export async function updateAIStats(r) { C.push(['ai', r]); }
    export async function updateLocalStats(r, p2) { C.push(['local', r, p2]); }
    export async function updateOnlineStats(r, uid, name) { C.push(['online', r, uid ?? null, name]); if (globalThis.__gate) await globalThis.__gate; }
    export async function updateMultiStats(rank, players, score) { C.push(['multi', rank, players, score]); }
    export async function getAllStats() { return {}; }`,
  'history.js': `export async function saveMatch(d) { globalThis.__calls.push(['history', d.mode, d.result, d.myScore, d.oppScore, d.vs]); }`,
  'achievements.js': `export async function checkAchievements(m) { globalThis.__calls.push(['ach', m.mode, m.result, m.myScore, m.oppScore]); return []; }
    export async function updateStreak(r) { globalThis.__calls.push(['streak', r]); return 0; }
    export async function getTotalMatches() { return 0; }`,
  'achievementsUI.js': `export function showNewAchievements() {}`,
  'xp.js': `export function calcXP(d) { globalThis.__calls.push(['xp', d.mode, d.result, d.rank, d.players]); return 0; }
    export async function addXP() { return null; }`,
  'xpUI.js': `export function showXPGain() {}`,
  'dailyChallengeUI.js': `export function isDailyActive() { return false; } export async function finishDailyChallenge() {}`,
  'wallet.js': `export async function commitMatchCoins() { globalThis.__calls.push(['coins']); return { earned: 0, total: 0 }; }
    export function getMatchCoins() { return globalThis.__matchCoins || 0; }`,
};
const REAL = { 'gameEnd.js': '/js/ui/gameEnd.js', 'matchResult.js': '/js/core/matchResult.js' };

// بيئة معزولة واحدة (يمكن استدعاء أكثر من دالة فيها بالتتابع — لفحص "مرة واحدة لكل مباراة")
export async function loadGameEnd({ user = { uid: 'uid_me' } } = {}) {
  const calls = [], els = new Map();
  const document = { getElementById: id => { if (!els.has(id)) els.set(id, new El(id)); return els.get(id); }, createElement: () => new El() };
  // المؤقّتات المؤجّلة (إشعارات الواجهة بعد ثوانٍ) لا تُشغَّل؛ أما "بعد لحظة" (0ms) فتُشغَّل كما في المتصفح
  // — v35.7: النهاية الطبيعية في الجماعي أونلاين تُحسب بعد لحظة
  const g = { document, console, setTimeout: (f, ms) => { if (!ms) setImmediate(f); return 0; }, clearTimeout: () => {}, __calls: calls, __user: user };
  g.window = g;
  const ctx = vm.createContext(g);
  const cache = new Map();
  const getMod = key => {
    if (cache.has(key)) return cache.get(key);
    const src = REAL[key] ? fs.readFileSync(PROJECT + REAL[key], 'utf8') : STUBS[key];
    if (src === undefined) throw new Error('no module: ' + key);
    const m = new vm.SourceTextModule(src, { context: ctx, identifier: key });
    cache.set(key, m); return m;
  };
  const root = getMod('gameEnd.js');
  await root.link(async spec => getMod(spec.split('?')[0].split('/').pop()));
  await root.evaluate();
  const strip = s => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const view = () => {
    const h2h = document.getElementById('head-to-head');
    return {
      calls: calls.slice(),
      rows: document.getElementById('winner-details').children.filter(c => !c._t).map(c => strip(c.innerHTML)),
      message: document.getElementById('winner-message').textContent,
      h2hHidden: h2h.classList.contains('hidden'), h2h: strip(h2h.innerHTML),
    };
  };
  // بوابة تحبس التسجيل في منتصفه (كرحلة شبكة بطيئة) حتى نفتحها
  const hold = () => { let open; g.__gate = new Promise(res => { open = res; }); return () => { g.__gate = null; open(); }; };
  const setMatchCoins = n => { g.__matchCoins = n; };   // عملات جواهر المباراة الحالية (ما يضيع عند الانسحاب)
  return { ns: root.namespace, calls, view, hold, setMatchCoins };
}

export async function runEndGame(cfg, scores, { user = { uid: 'uid_me' }, forced = false, loser = null, exitInfo = null, opts = {} } = {}) {
  const env = await loadGameEnd({ user });
  await env.ns.endGame(cfg, scores, forced, loser, exitInfo, opts);
  await new Promise(res => setImmediate(res));
  return env.view();
}
const pick = (calls, kind) => calls.find(c => c[0] === kind);

export async function resultsEndGame(verbose = false) {
  const r = suite('نافذة النهاية الحقيقية (gameEnd.js): المعروض وما يُسجَّل'); r.verbose = verbose;
  const gap = mp(['uB', 2, 'باسل'], ['uC', 3, 'كريم']);
  const full3 = mp(['u1', 1, 'أحمد'], ['u2', 2, 'باسل'], ['u3', 3, 'كريم']);

  // أ) حالة فحصك 3 و4: لا سطر للغائب — والفائز يُسجَّل له فوز واحد ضد واحد ضد خصمه الحقيقي
  let o = await runEndGame(online(2, 3, gap, { onlineOpponentUid: 'stale' }), { 1: 0, 2: 5, 3: 4 });
  r.ok(o.rows.length === 2 && !o.rows.some(t => t.includes('لاعب 1')), `النتيجة بلا "لاعب 1" (${o.rows.join(' | ')})`);
  r.ok(same(pick(o.calls, 'online'), ['online', 'win', 'uC', 'كريم']), `الفائز: فوز ضد كريم نفسه (${JSON.stringify(pick(o.calls, 'online'))})`);
  r.ok(same(pick(o.calls, 'streak'), ['streak', 'win']) && same(pick(o.calls, 'history')?.slice(0, 3), ['history', 'online', 'win']), 'سلسلة الفوز وسجل المباريات: فوز');
  o = await runEndGame(online(3, 3, gap), { 1: 0, 2: 5, 3: 4 });
  r.ok(same(pick(o.calls, 'online'), ['online', 'loss', 'uB', 'باسل']) && same(pick(o.calls, 'streak'), ['streak', 'loss']), 'الخاسر: خسارة ضد باسل');

  // ب) مباراة 3 كاملة: الفائز على المقعد 2 (كانت تُسجَّل له خسارة لأن المقعد 1 لم يفز)
  o = await runEndGame(online(2, 3, full3), { 1: 2, 2: 5, 3: 2 });
  r.ok(same(pick(o.calls, 'multi'), ['multi', 1, 3, 5]), `إحصائيات الجماعي لمقعدي أنا: مركز 1 من 3 بـ5 نقاط (${JSON.stringify(pick(o.calls, 'multi'))})`);
  r.ok(same(pick(o.calls, 'streak'), ['streak', 'win']) && same(pick(o.calls, 'xp'), ['xp', 'online', 'win', 1, 3]), 'السلسلة والخبرة: فوز');
  r.ok(same(pick(o.calls, 'history')?.slice(0, 4), ['history', 'multi', 'win', 5]), 'سجل المباريات: فوز بـ5 نقاط');
  r.ok(!o.h2hHidden && o.h2h.includes('🥇') && o.h2h.includes('3 لاعبين'), `مربع إحصائياتك: 🥇 (${o.h2h.slice(0, 60)})`);
  o = await runEndGame(online(1, 3, full3), { 1: 2, 2: 5, 3: 2 });
  r.ok(same(pick(o.calls, 'multi'), ['multi', 2, 3, 2]) && same(pick(o.calls, 'streak'), ['streak', 'loss']), 'المقعد 1 الخاسر: مركز 2 وخسارة');
  r.ok(same(o.rows.map(t => t.split('.')[0]), ['1', '2', '2']), `المتعادلان يتشاركان المركز في العرض (${o.rows.join(' | ')})`);

  // ج) المشاهد يتابع حتى النهاية: يرى الترتيب ولا يُسجَّل له شيء
  o = await runEndGame(online(null, 3, full3, { spectator: true, onlineOpponentUid: 'stale' }), { 1: 2, 2: 5, 3: 2 });
  const recs = o.calls.filter(c => c[0] !== 'coins');   // إضافة العملات بلا عملات (0) ليست تسجيلاً
  r.ok(recs.length === 0, `المشاهد: صفر تسجيلات (${recs.map(c => c[0]).join(',') || 'لا شيء'})`);
  r.ok(o.rows.length === 3 && o.h2hHidden && o.message.includes('باسل'), 'المشاهد يرى الترتيب والفائز بلا مربع "إحصائياتك"');

  // د) الثنائي (المنضم) + ضد الكمبيوتر + المحلي: كما كانت
  o = await runEndGame({ aiMode: 'online', rows: 4, cols: 4, colors: COLORS, players: 2, onlinePlayerNum: 2, onlineOpponentUid: 'uHost', multiPlayers: null, onlinePlayerNames: { 1: 'المضيف', 2: 'أنا' } }, { 1: 3, 2: 6 });
  r.ok(same(pick(o.calls, 'online'), ['online', 'win', 'uHost', 'المضيف']) && same(pick(o.calls, 'history')?.slice(0, 5), ['history', 'online', 'win', 6, 3]), 'الثنائي: المنضم يفوز ضد المضيف');
  o = await runEndGame({ aiMode: 'ai', rows: 4, cols: 4, colors: COLORS, players: 2 }, { 1: 5, 2: 4 });
  r.ok(same(pick(o.calls, 'ai'), ['ai', 'win']) && o.message.includes('أنت الفائز'), 'ضد الكمبيوتر كما كان');
  o = await runEndGame({ aiMode: 'human', rows: 4, cols: 4, colors: COLORS, players: 2, localPlayerNames: { 1: 'أ', 2: 'ب' } }, { 1: 4, 2: 5 });
  r.ok(same(pick(o.calls, 'local'), ['local', 'loss', 'ب']), 'المحلي كما كان');
  // الضيف (بلا حساب): تُعرض النتيجة ولا يُسجَّل شيء
  o = await runEndGame(online(2, 3, full3), { 1: 2, 2: 5, 3: 2 }, { user: null });
  r.ok(o.calls.filter(c => c[0] !== 'coins').length === 0 && o.rows.length === 3, 'بلا تسجيل دخول: عرض فقط');
  return r;
}

// ═════════ 3) نهايات الخروج والانسحاب (v35.6) ═════════
export async function resultsExitEndings(verbose = false) {
  const r = suite('نهايات الخروج: فوز بانسحاب الخصم، خسارة المنسحب، ومرة واحدة لكل مباراة'); r.verbose = verbose;
  const duo = (me, extra = {}) => ({ aiMode: 'online', online: true, rows: 4, cols: 4, colors: COLORS, players: 2,
    onlinePlayerNum: me, onlineOpponentUid: me === 1 ? 'uJoin' : 'uHost', multiPlayers: null,
    onlinePlayerNames: { 1: 'المضيف', 2: 'المنضم' }, ...extra });
  const count = (calls, kind) => calls.filter(c => c[0] === kind).length;

  // أ) الفوز بانسحاب الخصم في الثنائي — منتصف المباراة (النقاط لم تكتمل) وأنا متأخر بالنقاط
  let env = await loadGameEnd();
  await env.ns.endGame(duo(1), { 1: 1, 2: 3 }, true, null, { 2: 'انسحب' }, { title: '🏆 فزت! انسحب المنضم' });
  let o = env.view();
  r.ok(o.message === '🏆 فزت! انسحب المنضم', `عنوان النافذة: "${o.message}"`);
  r.ok(same(pick(o.calls, 'online'), ['online', 'win', 'uJoin', 'المنضم']), `فوز مسجّل ضد المنسحب رغم تأخري بالنقاط (${JSON.stringify(pick(o.calls, 'online'))})`);
  r.ok(same(pick(o.calls, 'streak'), ['streak', 'win']) && same(pick(o.calls, 'xp')?.slice(0, 3), ['xp', 'online', 'win']), 'السلسلة والخبرة: فوز');
  r.ok(count(o.calls, 'coins') === 1, 'عملات الجواهر تُضاف (كانت تضيع مع الرسالة وإعادة التحميل)');
  r.ok(o.rows.length === 2 && /انسحب/.test(o.rows[1]) && /^1\. المضيف/.test(o.rows[0]), `الترتيب: ${o.rows.join(' | ')}`);

  // ب) نهاية ثانية في نفس المباراة (إشارتان متزامنتان): لا تسجيل ثانٍ ولا عملات مرتين، والمربع يبقى
  await env.ns.endGame(duo(1), { 1: 1, 2: 3 }, true, null, { 2: 'انسحب' }, { title: '🏆 فزت! انسحب المنضم' });
  o = env.view();
  r.ok(count(o.calls, 'online') === 1 && count(o.calls, 'history') === 1 && count(o.calls, 'streak') === 1, 'النهاية الثانية لا تسجّل مرة أخرى');
  r.ok(count(o.calls, 'coins') === 1, 'ولا تضيف العملات مرة أخرى');
  r.ok(!o.h2hHidden && /المنضم/.test(o.h2h), 'ومربع "إحصائياتك" يبقى ظاهراً');

  // ج) المنسحب بالزر (الثنائي): خسارة مسجّلة بلا نافذة وبلا عملات
  env = await loadGameEnd();
  await env.ns.recordForfeit(duo(2), { 1: 2, 2: 4 });
  o = env.view();
  r.ok(same(pick(o.calls, 'online'), ['online', 'loss', 'uHost', 'المضيف']) && same(pick(o.calls, 'streak'), ['streak', 'loss']),
    `المنسحب: خسارة ضد خصمه رغم تقدّمه بالنقاط (${JSON.stringify(pick(o.calls, 'online'))})`);
  r.ok(same(pick(o.calls, 'history')?.slice(0, 3), ['history', 'online', 'loss']), 'سجل المباريات: خسارة');
  r.ok(count(o.calls, 'coins') === 0 && o.message === '', 'بلا عملات وبلا نافذة نتيجة');
  // نهاية لاحقة شاردة على نفس الجهاز لا تسجّل فوقها ولا تضيف العملات
  await env.ns.endGame(duo(2), { 1: 2, 2: 7 }, false, null, null);
  o = env.view();
  r.ok(count(o.calls, 'online') === 1 && count(o.calls, 'coins') === 0, 'نهاية شاردة بعد الانسحاب لا تغيّر شيئاً مسجّلاً');

  // د) المنسحب بالزر (الجماعي): آخر مركز وخسارة
  const three = mp(['u1', 1, 'أحمد'], ['u2', 2, 'باسل'], ['u3', 3, 'كريم']);
  env = await loadGameEnd();
  await env.ns.recordForfeit(online(1, 3, three), { 1: 4, 2: 1, 3: 0 });
  o = env.view();
  r.ok(same(pick(o.calls, 'multi'), ['multi', 3, 3, 4]) && same(pick(o.calls, 'history')?.slice(0, 3), ['history', 'multi', 'loss']),
    `الجماعي: المنسحب آخر المراكز حتى لو كان متقدّماً (${JSON.stringify(pick(o.calls, 'multi'))})`);

  // هـ) آخر الباقين بالجماعي: الخارجون من القائمة (active:false) بشارة "انسحب" والفوز له
  const outs = mp(['u1', 1, 'أحمد'], ['u2', 2, 'باسل', false], ['u3', 3, 'كريم', false]);
  o = await runEndGame(online(1, 3, outs), { 1: 2, 2: 3, 3: 1 }, { forced: true, opts: { title: '🏆 فزت بالمباراة! انسحب جميع خصومك' } });
  r.ok(same(pick(o.calls, 'multi'), ['multi', 1, 3, 2]) && same(pick(o.calls, 'streak'), ['streak', 'win']), `آخر الباقين: مركز 1 وفوز (${JSON.stringify(pick(o.calls, 'multi'))})`);
  r.ok(o.rows.filter(t => /انسحب/.test(t)).length === 2 && o.message.includes('جميع خصومك'), `الترتيب: ${o.rows.join(' | ')}`);

  // ز) غادر اللاعب قبل ظهور النافذة (displayIf=false): تسجيل وعملات بلا عرض فوق القائمة
  env = await loadGameEnd();
  await env.ns.endGame(duo(1), { 1: 1, 2: 3 }, true, null, { 2: 'انسحب' }, { title: '🏆 فزت!', displayIf: () => false });
  o = env.view();
  r.ok(count(o.calls, 'online') === 1 && count(o.calls, 'coins') === 1 && o.message === '', 'غادر قبل ظهور النافذة: فوزه وعملاته مسجّلة، بلا نافذة فوق القائمة');

  // ح) نهايتان متزامنتان فعلاً (لا تنتظر إحداهما الأخرى): تسجيل واحد، عملات مرة، والمربع ظاهر
  env = await loadGameEnd();
  await Promise.all([
    env.ns.endGame(duo(1), { 1: 6, 2: 3 }, false, null, null),
    env.ns.endGame(duo(1), { 1: 6, 2: 3 }, true, null, { 2: 'انسحب' }, { title: '🏆 فزت! انسحب المنضم' }),
  ]);
  o = env.view();
  r.ok(count(o.calls, 'online') === 1 && count(o.calls, 'coins') === 1, 'نهايتان متزامنتان: تسجيل واحد وعملات مرة واحدة');
  r.ok(!o.h2hHidden && /المنضم/.test(o.h2h), 'والنافذة الثانية تنتظر نتيجة الأولى فيبقى مربع "إحصائياتك" ظاهراً');

  // ط) بدأت مباراة جديدة أثناء تسجيل نتيجة السابقة (رحلات شبكة بطيئة) — مراجعة v35.6:
  //    عملات السابقة تُثبَّت قبل الانتظار، ونافذتها لا تُعرض فوق الجديدة، وحارس الجديدة سليم
  env = await loadGameEnd();
  const open = env.hold();
  const pending = env.ns.endGame(duo(1), { 1: 1, 2: 3 }, true, null, { 2: 'انسحب' }, { title: '🏆 فزت! انسحب المنضم' });
  await new Promise(res => setImmediate(res));
  r.ok(count(env.calls, 'coins') === 1, 'عملات المباراة المنتهية ثُبّتت قبل انتظار التسجيل');
  env.ns.resetMatchTimer();   // "العب مجدداً" → مباراة جديدة قبل أن يكتمل التسجيل
  open(); await pending; await new Promise(res => setImmediate(res));
  o = env.view();
  r.ok(o.message === '' && o.rows.length === 0, 'نافذة المباراة السابقة لا تُعرض فوق الجديدة');
  await env.ns.endGame(duo(1), { 1: 6, 2: 3 }, false, null, null);
  o = env.view();
  r.ok(count(o.calls, 'online') === 2 && count(o.calls, 'coins') === 2 && /فاز/.test(o.message),
    'المباراة الجديدة تُسجَّل وتُثبَّت عملاتها وتُعرض نافذتها كالمعتاد');

  // و) الضيف بلا حساب والمشاهد: الانسحاب لا يسجّل شيئاً
  env = await loadGameEnd({ user: null });
  await env.ns.recordForfeit(duo(1), { 1: 1, 2: 1 });
  r.ok(env.calls.length === 0, 'بلا تسجيل دخول: لا شيء يُسجَّل');
  env = await loadGameEnd();
  await env.ns.recordForfeit({ ...duo(null), spectator: true }, { 1: 1, 2: 1 });
  r.ok(env.calls.length === 0, 'المشاهد: لا شيء يُسجَّل');
  return r;
}

// ═════════ 4) الخروج من مباراة جماعية جارية (v35.7) ═════════
// السبب (نفد وقته/انقطع/انسحب) والمركز بترتيب الخروج في الدالة النقية، ثم gameEnd.js الحقيقي:
// التسجيل لحظة الخروج، العملات حسب السبب، والنهاية اللاحقة عرض فقط.
export async function resultsElimination(verbose = false) {
  const r = suite('الخروج من مباراة جماعية جارية: سببه، مركزه بترتيب الخروج، وعملاته'); r.verbose = verbose;
  const M = await import(pathToFileURL(PROJECT + '/js/core/matchResult.js').href);
  const count = (calls, kind) => calls.filter(c => c[0] === kind).length;
  const out = (uid, num, name, outReason, outAt) =>
    [uid, { name, num, active: false, ...(outReason ? { outReason } : {}), ...(outAt != null ? { outAt } : {}) }];
  const inn = (uid, num, name) => [uid, { name, num, active: true }];
  const pl = (...e) => Object.fromEntries(e);
  const ranks = R => R.ranking.map(x => [x.player, x.rank]);

  // أ) شارة الخروج حسب السبب (والغرف القديمة بلا سبب = انسحب)
  const lab = M.getExited({ multiPlayers: pl(out('a', 1, 'أ', 'time', 1), out('b', 2, 'ب', 'dropped', 2), out('c', 3, 'ج', 'left', 3), out('d', 4, 'د')) });
  r.ok(same(lab, { 1: 'نفد وقته', 2: 'انقطع', 3: 'انسحب', 4: 'انسحب' }), `الشارات حسب السبب: ${JSON.stringify(lab)}`);

  // ب) فحصك 6: كريم (3) انسحب أولاً متقدّماً بالنقاط، ثم باسل (2) انقطع — أحمد آخر الباقين.
  //    بترتيب الخروج: باسل 2 وكريم 3 (كان بالنقاط: كريم 2 وباسل 3، ومسجَّل لكريم 3 عند انسحابه = تكرار)
  let R = M.computeMatchResult(online(1, 3, pl(inn('u1', 1, 'أحمد'), out('u2', 2, 'باسل', 'dropped', 2000), out('u3', 3, 'كريم', 'left', 1000))),
    { 1: 3, 2: 1, 3: 5 });
  r.ok(same(ranks(R), [[1, 1], [2, 2], [3, 3]]), `الترتيب بالخروج لا بالنقاط: ${JSON.stringify(ranks(R))}`);
  r.ok(R.winnerNum === 1 && R.myResult === 'win', 'الفوز لآخر الباقين');

  // ج) المنسحب الآن (قبل كتابة ختمه) = الأحدث خروجاً → فوق من خرج قبله
  R = M.computeMatchResult(online(2, 4, pl(inn('u1', 1, 'أحمد'), inn('u2', 2, 'باسل'), inn('u4', 4, 'دانة'), out('u3', 3, 'كريم', 'left', 1000))),
    { 1: 1, 2: 0, 3: 8, 4: 0 }, { exitInfo: { 2: 'انسحب' } });
  r.ok(R.myRank === 3 && R.ranking.find(x => x.player === 3).rank === 4, `المنسحب الآن مركزه 3 ومن خرج قبله 4 (${R.myRank})`);

  // د) بلا أختام (غرف قديمة): الخارجون بالنقاط كما كانوا
  R = M.computeMatchResult(online(1, 3, pl(inn('u1', 1, 'أ'), out('u2', 2, 'ب'), out('u3', 3, 'ج'))), { 1: 1, 2: 2, 3: 6 });
  r.ok(same(ranks(R), [[1, 1], [3, 2], [2, 3]]), `بلا أختام: الخارجون بالنقاط (${JSON.stringify(ranks(R))})`);

  // هـ) احتياط "خرج الجميع": الفوز لأعلى نقاط لا لأحدث خارج
  R = M.computeMatchResult(online(1, 3, pl(out('u1', 1, 'أ', 'time', 3000), out('u2', 2, 'ب', 'dropped', 1000), out('u3', 3, 'ج', 'left', 2000))),
    { 1: 1, 2: 7, 3: 1 });
  r.ok(R.winnerNum === 2, `خرج الجميع: الفائز أعلى نقاط (${R.winnerNum})`);

  // و) gameEnd.js الحقيقي — نفد وقته: خسارة تُسجَّل لحظة خروجه، وعملاته محفوظة
  let env = await loadGameEnd();
  if (typeof env.ns.recordElimination !== 'function') { r.ok(false, 'recordElimination غير موجودة في gameEnd.js'); return r; }
  const t3 = pl(inn('u1', 1, 'أحمد'), inn('u2', 2, 'باسل'), out('u3', 3, 'كريم', 'time', 1000));
  env.setMatchCoins(6);
  let rec = env.ns.recordElimination(online(3, 3, t3), { 1: 2, 2: 1, 3: 4 }, 'time');
  r.ok(rec.lost === 0, `نفاد الوقت: لا شيء يضيع (${rec.lost})`);
  await rec.recorded; await new Promise(res => setImmediate(res));
  let o = env.view();
  r.ok(same(pick(o.calls, 'multi'), ['multi', 3, 3, 4]) && same(pick(o.calls, 'history')?.slice(0, 3), ['history', 'multi', 'loss']),
    `نفد وقته: خسارة بمركزه 3 لحظة خروجه (${JSON.stringify(pick(o.calls, 'multi'))})`);
  r.ok(count(o.calls, 'coins') === 1, 'نفاد الوقت: عملات المباراة محفوظة (تُثبَّت الآن)');
  r.ok(rec.R.myRank === 3 && rec.R.count === 3 && o.message === '', 'للبطاقة: المركز 3 من 3 — وبلا نافذة نتيجة (المباراة مستمرة)');
  // النهاية اللاحقة (آخر الباقين) على نفس الجهاز: عرض فقط
  const t3end = pl(inn('u1', 1, 'أحمد'), out('u2', 2, 'باسل', 'left', 2000), out('u3', 3, 'كريم', 'time', 1000));
  await env.ns.endGame(online(3, 3, t3end), { 1: 2, 2: 1, 3: 4 }, true, null, null, { title: '🏁 انتهت المباراة — كنت خارجها' });
  o = env.view();
  r.ok(count(o.calls, 'multi') === 1 && count(o.calls, 'coins') === 1, 'النهاية اللاحقة: لا تسجيل ثانٍ ولا عملات مرتين');
  r.ok(o.message.includes('كنت خارجها') && o.rows.length === 3 && /انسحب/.test(o.rows[1]) && /نفد وقته/.test(o.rows[2]),
    `النافذة النهائية بالشارات الدقيقة وترتيب الخروج: ${o.rows.join(' | ')}`);

  // ز) انقطع ولم يعد خلال المهلة = كالانسحاب: خسارة بلا عملات المباراة (ولا في النافذة لاحقاً)
  const d3 = pl(inn('u1', 1, 'أحمد'), inn('u2', 2, 'باسل'), out('u3', 3, 'كريم', 'dropped', 1000));
  env = await loadGameEnd();
  env.setMatchCoins(9);
  rec = env.ns.recordElimination(online(3, 3, d3), { 1: 2, 2: 1, 3: 4 }, 'dropped');
  r.ok(rec.lost === 9, `انقطع ولم يعد: البطاقة تذكر ما ضاع بالرقم (${rec.lost} من 9)`);
  await rec.recorded; await new Promise(res => setImmediate(res));
  await env.ns.endGame(online(3, 3, d3), { 1: 4, 2: 1, 3: 4 }, false, null, null);   // اكتملت اللوحة لاحقاً
  o = env.view();
  r.ok(same(pick(o.calls, 'multi'), ['multi', 3, 3, 4]) && count(o.calls, 'multi') === 1, 'انقطع ولم يعد: خسارة واحدة بمركزه 3');
  r.ok(count(o.calls, 'coins') === 0, 'بلا عملات المباراة — لا عند الخروج ولا في النافذة النهائية');

  // ط) مراجعة v35.7: اكتملت اللوحة وخروجي وصلا في دفعة واحدة (عودة من انقطاع — الحركات أولاً):
  //    النهاية الطبيعية بالجماعي تُحسب بعد لحظة، فيُسجَّل خروجي أولاً ولا يُسجَّل لي فوز وأنا خارجها
  env = await loadGameEnd();
  const liveCfg = online(3, 3, pl(inn('u1', 1, 'أحمد'), inn('u2', 2, 'باسل'), inn('u3', 3, 'كريم')));
  const pend = env.ns.endGame(liveCfg, { 1: 2, 2: 1, 3: 6 });          // اكتملت اللوحة وأنا متقدّم "بقائمتي القديمة"
  liveCfg.multiPlayers = pl(inn('u1', 1, 'أحمد'), inn('u2', 2, 'باسل'), out('u3', 3, 'كريم', 'dropped', 1000));   // القائمة تصل بعدها مباشرة
  env.ns.recordElimination(liveCfg, { 1: 2, 2: 1, 3: 6 }, 'dropped');   // كما يفعل onlineGame عند وصولها
  await pend; await new Promise(res => setImmediate(res));
  o = env.view();
  r.ok(same(pick(o.calls, 'multi'), ['multi', 3, 3, 6]) && count(o.calls, 'multi') === 1, `لا فوز لمن خرج: خسارة واحدة بمركزه 3 (${JSON.stringify(pick(o.calls, 'multi'))})`);
  r.ok(count(o.calls, 'coins') === 0 && /انقطع/.test(o.rows[2] || ''), `بلا عملات، والنافذة تُظهره خارجاً (${o.rows.join(' | ')})`);

  // ي) نسخ مختلطة (مراجعة v35.7): خروج كتبه جهاز بنسخة أقدم (بلا ختم) = الأقدم، لا "الأحدث للأبد"
  R = M.computeMatchResult(online(1, 4, pl(inn('u1', 1, 'أ'), out('u2', 2, 'ب', 'time', 5000), out('u3', 3, 'ج'), inn('u4', 4, 'د'))),
    { 1: 1, 2: 0, 3: 9, 4: 2 });
  r.ok(R.ranking.find(x => x.player === 2).rank === 3 && R.ranking.find(x => x.player === 3).rank === 4,
    `الخروج القديم بلا ختم تحت المختوم بعده (${JSON.stringify(ranks(R))})`);

  // ح) المشاهد والضيف: لا شيء يُسجَّل
  env = await loadGameEnd();
  r.ok(env.ns.recordElimination({ ...online(null, 3, d3), spectator: true }, {}, 'dropped') === null && env.calls.length === 0, 'المشاهد: لا تسجيل');
  env = await loadGameEnd({ user: null });
  rec = env.ns.recordElimination(online(3, 3, d3), {}, 'dropped');
  await rec?.recorded;
  r.ok(env.calls.length === 0, 'بلا حساب: لا تسجيل');
  return r;
}
