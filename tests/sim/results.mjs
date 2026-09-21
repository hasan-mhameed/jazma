// فحوص نافذة نهاية المباراة (v35.5) — المحاكي لا يصلها (يشغّل البحث واللوبي فقط)
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
}
const STUBS = {
  'audioManager.js': `export const audioManager = new Proxy({}, { get: () => () => {} });`,
  'auth.js': `const C = globalThis.__calls;
    export let currentUser = globalThis.__user;
    export async function updateAIStats(r) { C.push(['ai', r]); }
    export async function updateLocalStats(r, p2) { C.push(['local', r, p2]); }
    export async function updateOnlineStats(r, uid, name) { C.push(['online', r, uid ?? null, name]); }
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
  'wallet.js': `export async function commitMatchCoins() { return { earned: 0, total: 0 }; }`,
};
const REAL = { 'gameEnd.js': '/js/ui/gameEnd.js', 'matchResult.js': '/js/core/matchResult.js' };

export async function runEndGame(cfg, scores, { user = { uid: 'uid_me' }, forced = false, loser = null } = {}) {
  const calls = [], els = new Map();
  const document = { getElementById: id => { if (!els.has(id)) els.set(id, new El(id)); return els.get(id); }, createElement: () => new El() };
  const g = { document, console, setTimeout: () => 0, clearTimeout: () => {}, __calls: calls, __user: user };
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
  await root.namespace.endGame(cfg, scores, forced, loser);
  await new Promise(res => setImmediate(res));
  const strip = s => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const h2h = document.getElementById('head-to-head');
  return {
    calls,
    rows: document.getElementById('winner-details').children.map(c => strip(c.innerHTML)),
    message: document.getElementById('winner-message').textContent,
    h2hHidden: h2h.classList.contains('hidden'), h2h: strip(h2h.innerHTML),
  };
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
  r.ok(o.calls.length === 0, `المشاهد: صفر تسجيلات (${o.calls.map(c => c[0]).join(',') || 'لا شيء'})`);
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
  r.ok(o.calls.length === 0 && o.rows.length === 3, 'بلا تسجيل دخول: عرض فقط');
  return r;
}
