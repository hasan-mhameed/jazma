// محاكي متعدد اللاعبين: يشغّل firebase.js + onlineGame.js الحقيقيين لكل لاعب
// في سياق vm منفصل (DOM مستقل)، فوق Firebase وهمي في الذاكرة وساعة افتراضية مشتركة.
// التشغيل: node --experimental-vm-modules <scenario>.mjs
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import FakeTimers from '@sinonjs/fake-timers';

// جذر المشروع: مجلّدان فوق هذا الملف (tests/sim → الجذر)، أو JAZAM_DIR لفحص نسخة أخرى
export const PROJECT = process.env.JAZAM_DIR || fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
export const clock = FakeTimers.createClock(Date.UTC(2026, 8, 19, 12, 0, 0), 1e7);
const T0 = clock.now;
const rel = () => ((clock.now - T0) / 1000).toFixed(2).padStart(7);

// ═════════ أدوات بيانات Firebase ═════════
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isSV = v => v && typeof v === 'object' && !Array.isArray(v) && v['.sv'] === 'timestamp';
function resolveSV(v, now) {
  if (isSV(v)) return now;
  if (v && typeof v === 'object') {
    const o = Array.isArray(v) ? [] : {};
    for (const k of Object.keys(v)) o[k] = resolveSV(v[k], now);
    return o;
  }
  return v;
}
// التخزين: null يحذف، الكائنات الفارغة تختفي، المصفوفات تُخزَّن كمفاتيح أرقام
function normalize(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    const o = {}; v.forEach((x, i) => { const n = normalize(x); if (n !== null) o[i] = n; });
    return Object.keys(o).length ? o : null;
  }
  if (typeof v === 'object') {
    const o = {}; for (const k of Object.keys(v)) { const n = normalize(v[k]); if (n !== null) o[k] = n; }
    return Object.keys(o).length ? o : null;
  }
  return v;
}
// القراءة: مفاتيح أرقام كثيفة → مصفوفة بفجوات null (سلوك Firebase الحقيقي)
function toRead(v) {
  if (v === null || v === undefined || typeof v !== 'object') return v ?? null;
  const keys = Object.keys(v); const out = {};
  for (const k of keys) out[k] = toRead(v[k]);
  if (keys.length && keys.every(k => /^(0|[1-9]\d*)$/.test(k))) {
    const max = Math.max(...keys.map(Number));
    if (keys.length * 2 > max) {
      const arr = []; for (let i = 0; i <= max; i++) arr.push(out[i] === undefined ? null : out[i]);
      return arr;
    }
  }
  return out;
}
function makeSnap(key, val) {
  const v = val === undefined ? null : val;
  return {
    key,
    exists: () => v !== null,
    val: () => clone(v),
    forEach(cb) {
      if (v && typeof v === 'object') for (const k of Object.keys(v)) {
        if (v[k] == null) continue;
        if (cb(makeSnap(k, clone(v[k]))) === true) return true;
      }
      return false;
    },
    child(p) {
      let c = v; for (const k of p.split('/')) c = (c && typeof c === 'object') ? c[k] : null;
      return makeSnap(p.split('/').pop(), c ?? null);
    },
  };
}

// ═════════ خادم Firebase وهمي ═════════
class Server {
  constructor(world) { this.world = world; this.root = null; this.valueL = new Set(); this.childL = new Set(); this.keySeq = 0; this.writes = 0; }
  parts(p) { return String(p || '').split('/').filter(Boolean); }
  getAt(p) {
    let cur = this.root;
    for (const k of this.parts(p)) { if (cur == null || typeof cur !== 'object') return null; cur = cur[k]; if (cur === undefined) return null; }
    return cur === undefined ? null : cur;
  }
  setAt(p, value) {
    const keys = this.parts(p); const v = normalize(value); this.writes++;
    if (!keys.length) { this.root = v; return; }
    if (this.root == null || typeof this.root !== 'object') { if (v === null) return; this.root = {}; }
    let cur = this.root; const stack = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (cur[k] == null || typeof cur[k] !== 'object') { if (v === null) return; cur[k] = {}; }
      stack.push([cur, k]); cur = cur[k];
    }
    const last = keys[keys.length - 1];
    if (v === null) delete cur[last]; else cur[last] = clone(v);
    for (let i = stack.length - 1; i >= 0; i--) {
      const [par, k] = stack[i];
      if (par[k] && typeof par[k] === 'object' && !Object.keys(par[k]).length) delete par[k];
    }
    if (this.root && typeof this.root === 'object' && !Object.keys(this.root).length) this.root = null;
  }
  genKey() { return '-K' + String(++this.keySeq).padStart(6, '0'); }
  notify() {
    for (const L of this.valueL) {
      if (L.dead) continue;
      const v = toRead(clone(this.getAt(L.path)));
      const ser = JSON.stringify(v);
      if (ser === L.lastSer) continue;       // لا حدث بلا تغيير (سلوك Firebase)
      L.lastSer = ser;
      const c = L.client;
      clock.setTimeout(() => { if (!L.dead && c.connected) c.safe(() => L.cb(makeSnap(L.key, v))); }, c.down);
    }
    for (const C of this.childL) {
      if (C.dead) continue;
      const cur = this.getAt(C.path);
      if (!cur || typeof cur !== 'object') continue;
      for (const k of Object.keys(cur).sort()) if (!C.seen.has(k)) {
        C.seen.add(k); const v = clone(cur[k]); const c = C.client;
        clock.setTimeout(() => { if (!C.dead && c.connected) c.safe(() => C.cb(makeSnap(k, v))); }, c.down);
      }
    }
  }
  write(client, apply) {
    client.writes = (client.writes || 0) + 1;
    return new Promise(res => {
      clock.setTimeout(() => { apply(); this.notify(); clock.setTimeout(res, client.down); }, client.up);
    });
  }
  transaction(client, path, fn) {
    client.writes = (client.writes || 0) + 1;
    return new Promise((res, rej) => {
      clock.setTimeout(() => {
        const cur = toRead(clone(this.getAt(path)));
        let out;
        try { out = fn(cur); } catch (e) { rej(e); return; }
        if (out === undefined) { clock.setTimeout(() => res({ committed: false, snapshot: makeSnap(path, cur) }), client.down); return; }
        this.setAt(path, resolveSV(clone(out), clock.now)); this.notify();
        const now = toRead(clone(this.getAt(path)));
        clock.setTimeout(() => res({ committed: true, snapshot: makeSnap(path, now) }), client.down);
      }, client.up);
    });
  }
  addValue(client, path, cb) {
    const L = { client, path, cb, key: this.parts(path).pop() || null, dead: false, lastSer: undefined };
    if (path === '.info/connected') {
      client.connL.push(L);
      clock.setTimeout(() => { if (!L.dead) client.safe(() => cb(makeSnap('connected', client.connected))); }, 1);
      return () => { L.dead = true; };
    }
    if (path === '.info/serverTimeOffset') {
      clock.setTimeout(() => { if (!L.dead) client.safe(() => cb(makeSnap('serverTimeOffset', 0))); }, 1);
      return () => { L.dead = true; };
    }
    const v = toRead(clone(this.getAt(path)));
    L.lastSer = JSON.stringify(v);
    this.valueL.add(L);
    clock.setTimeout(() => { if (!L.dead) client.safe(() => cb(makeSnap(L.key, v))); }, client.up + client.down);
    return () => { L.dead = true; this.valueL.delete(L); };
  }
  addChild(client, path, cb) {
    const C = { client, path, cb, seen: new Set(), dead: false };
    const cur = this.getAt(path);
    const initial = cur && typeof cur === 'object' ? Object.keys(cur).sort() : [];
    initial.forEach(k => C.seen.add(k));
    const snapVals = initial.map(k => [k, clone(cur[k])]);
    clock.setTimeout(() => { if (!C.dead) for (const [k, v] of snapVals) client.safe(() => cb(makeSnap(k, v))); }, client.up + client.down);
    this.childL.add(C);
    return () => { C.dead = true; this.childL.delete(C); };
  }
}

function makeFdb(server, client) {
  const cleanPath = p => String(p || '').replace(/^\/+|\/+$/g, '');
  return {
    getDatabase: () => ({}),
    ref: (db, p = '') => { const path = cleanPath(p); return { path, key: path.split('/').pop() || null }; },
    serverTimestamp: () => ({ '.sv': 'timestamp' }),
    get: (r) => new Promise(res => {
      clock.setTimeout(() => { const v = toRead(clone(server.getAt(r.path))); clock.setTimeout(() => res(makeSnap(r.key, v)), client.down); }, client.up);
    }),
    set: (r, v) => server.write(client, () => server.setAt(r.path, resolveSV(clone(v), clock.now))),
    update: (r, obj) => server.write(client, () => {
      for (const [k, v] of Object.entries(obj)) server.setAt(r.path + '/' + k, resolveSV(clone(v), clock.now));
    }),
    remove: (r) => server.write(client, () => server.setAt(r.path, null)),
    push: (r) => { const key = server.genKey(); return { path: r.path + '/' + key, key }; },
    runTransaction: (r, fn) => server.transaction(client, r.path, fn),
    onValue: (r, cb) => server.addValue(client, r.path, cb),
    onChildAdded: (r, cb) => server.addChild(client, r.path, cb),
    off: () => {},
    onDisconnect: (r) => ({
      remove: () => { client.onDisc.push({ path: r.path, op: 'remove' }); return Promise.resolve(); },
      set: (v) => { client.onDisc.push({ path: r.path, op: 'set', v }); return Promise.resolve(); },
      update: (v) => { client.onDisc.push({ path: r.path, op: 'update', v }); return Promise.resolve(); },
      cancel: () => { client.onDisc = client.onDisc.filter(o => !(o.path === r.path || o.path.startsWith(r.path + '/'))); return Promise.resolve(); },
    }),
  };
}

// ═════════ DOM وهمي ═════════
class FakeClassList {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach(x => this.s.add(x)); }
  remove(...c) { c.forEach(x => this.s.delete(x)); }
  toggle(c, force) { const want = force === undefined ? !this.s.has(c) : !!force; if (want) this.s.add(c); else this.s.delete(c); return want; }
  contains(c) { return this.s.has(c); }
}
class FakeElement {
  constructor(doc, tag, id) {
    this.doc = doc; this.tagName = String(tag || 'div').toUpperCase(); this.id = id || '';
    this.classList = new FakeClassList(); this.style = {}; this.dataset = {}; this.children = [];
    this._h = {}; this._html = ''; this.value = ''; this.disabled = false;
    this.offsetWidth = 0; this.parentNode = null; this.attributes = {};
  }
  get textContent() { return String(this.innerHTML).replace(/<[^>]+>/g, ''); }
  set textContent(v) { this._html = String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); this.children = []; }
  get innerHTML() { return this._html + this.children.map(c => c.outerHTML).join(''); }
  set innerHTML(v) { this._html = String(v ?? ''); this.children = []; }
  get outerHTML() { const t = this.tagName.toLowerCase(); return `<${t} class="${this.className}">${this.innerHTML}</${t}>`; }
  set className(v) { this.classList = new FakeClassList(); String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); }
  get className() { return [...this.classList.s].join(' '); }
  get parentElement() { return this.parentNode; }
  addEventListener(t, fn) { (this._h[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this._h[t] = (this._h[t] || []).filter(f => f !== fn); }
  dispatch(t) {
    const ev = { type: t, currentTarget: this, target: this, preventDefault() {}, stopPropagation() {} };
    const outs = [];
    for (const fn of (this._h[t] || [])) outs.push(this.doc.client.safe(() => fn.call(this, ev)));
    return Promise.all(outs);
  }
  click() { return this.dispatch('click'); }
  appendChild(c) { this.children.push(c); c.parentNode = this; this.doc.onAppend(this, c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  prepend(c) { return this.appendChild(c); }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; }
  remove() { this.parentNode?.removeChild(this); }
  insertBefore(c) { return this.appendChild(c); }
  replaceWith() {}
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {} blur() {} scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
  closest() { return null; }
  contains() { return false; }
  cloneNode() { return new FakeElement(this.doc, this.tagName, this.id); }
}
const INITIALLY_HIDDEN = ['search-countdown', 'ai-suggest-box', 'approval-modal', 'start-countdown',
  'online-step-searching', 'online-step-multi-count', 'online-step-multi-lobby', 'online-step-random-count',
  'online-step-lobby', 'online-step-playing', 'online-error', 'multi-start-btn'];
class FakeDocument {
  constructor(client) {
    this.client = client; this.els = new Map();
    this.body = new FakeElement(this, 'body'); this.documentElement = new FakeElement(this, 'html');
    for (const id of INITIALLY_HIDDEN) this.getElementById(id).classList.add('hidden');
  }
  onAppend(parent, child) { if (parent === this.body && child.textContent) this.client.event('toast', child.textContent); }
  getElementById(id) {
    if (!this.els.has(id)) { const el = new FakeElement(this, 'div', id); if (id === 'grid-size') el.value = '4'; this.els.set(id, el); }
    return this.els.get(id);
  }
  createElement(tag) { return new FakeElement(this, tag); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {} removeEventListener() {}
}

// ═════════ العالم واللاعبون ═════════
const STUBS = {
  'audioManager.js': `export const audioManager = new Proxy({}, { get: () => () => {} });`,
  'presence.js': `export function setMyPresence() {}`,
  'scoreboard.js': `export function updateScoreboard() {}`,
  'config.js': `export const config = {};`,
  'boardRenderer.js': `export function applyOnlineMove() {} export function skipInactiveTurn() {} export function waitForRender() { return Promise.resolve(); }`,
  'turnTimer.js': `export function setBank() {} export function applyClockState() {} export function stopTurnTimer() {}`,
  'state.js': `export const state = {};`,
  'auth.js': `export function getCurrentUser() { return globalThis.__user; }`,
  'firebase-app.js': `export function initializeApp() { return {}; } export function getApps() { return []; }`,
  'firebase-database.js': `const F = globalThis.__fdb; export const { getDatabase, ref, set, get, onValue, update, onDisconnect, remove, off, runTransaction, onChildAdded, push, serverTimestamp } = F;`,
};
const REAL = { 'firebase.js': '/js/firebase.js', 'onlineGame.js': '/js/ui/onlineGame.js' };

export class World {
  constructor() { this.server = new Server(this); this.clients = []; this.timeline = []; this.errors = []; this.quiet = false; }
  log(who, kind, msg) { const line = `${rel()}s  ${who.padEnd(6)} ${kind.padEnd(7)} ${msg}`; this.timeline.push(line); if (!this.quiet) console.log(line); }
  async client(name, opts = {}) {
    const c = new Client(this, name, opts); await c.boot(); this.clients.push(c); return c;
  }
  startSampler(ms = 100) {
    this._sampler = clock.setInterval(() => this.clients.forEach(c => c.sample()), ms);
  }
  async run(ms) { await clock.tickAsync(ms); }
  // إنهاء العالم: كل اللاعبين "موتى" + مسح كل المؤقّتات وإعادة الساعة (لتشغيلات متتالية)
  dispose() { this.clients.forEach(c => { c.dead = true; }); clock.reset(); }
  rooms() { return clone(this.server.getAt('rooms')) || {}; }
}

class Client {
  constructor(world, name, { up = 30, down = 30, uid } = {}) {
    this.world = world; this.name = name; this.uid = uid || ('uid_' + name);
    this.up = up; this.down = down; this.connected = true; this.connL = []; this.onDisc = [];
    this.last = ''; this.matches = [];
  }
  event(kind, msg) { this.world.log(this.name, kind, msg); }
  safe(fn) {
    if (this.dead) return;
    try {
      const r = fn();
      if (r && typeof r.then === 'function') return r.then(undefined, e => this.error(e));
      return r;
    } catch (e) { this.error(e); }
  }
  error(e) { const m = (e && (e.stack || e.message)) || String(e); this.world.errors.push(`${this.name}: ${m}`); this.event('ERROR', String(m).split('\n').slice(0, 3).join(' | ')); }
  async boot() {
    const doc = new FakeDocument(this);
    const self = this;
    const g = {
      document: doc,
      navigator: { clipboard: { writeText() { return Promise.resolve(); } }, onLine: true },
      setTimeout: (f, ms, ...a) => clock.setTimeout(() => self.safe(() => f(...a)), ms),
      clearTimeout: id => clock.clearTimeout(id),
      setInterval: (f, ms, ...a) => clock.setInterval(() => self.safe(() => f(...a)), ms),
      clearInterval: id => clock.clearInterval(id),
      requestAnimationFrame: f => clock.setTimeout(() => self.safe(() => f(clock.now)), 16),
      cancelAnimationFrame: id => clock.clearTimeout(id),
      Date: clock.Date,
      performance: { now: () => clock.now - T0 },
      localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
      console: { log() {}, warn() {}, info() {}, debug() {}, error: (...a) => self.event('cerr', a.map(String).join(' ').slice(0, 200)) },
      __fdb: makeFdb(this.world.server, this),
      __user: { uid: this.uid, displayName: this.name },
    };
    g.window = g; g.globalThis = g;
    this.doc = doc;
    this.ctx = vm.createContext(g);
    const cache = new Map();
    const getMod = (key) => {
      if (cache.has(key)) return cache.get(key);
      let src;
      if (REAL[key]) src = fs.readFileSync(PROJECT + REAL[key], 'utf8');
      else if (STUBS[key] !== undefined) src = STUBS[key];
      else throw new Error('no module: ' + key);
      const m = new vm.SourceTextModule(src, { context: this.ctx, identifier: `${this.name}:${key}` });
      cache.set(key, m); return m;
    };
    const keyOf = spec => spec.split('?')[0].split('/').pop();
    const root = getMod('onlineGame.js');
    await root.link(async (spec) => getMod(keyOf(spec)));
    await root.evaluate();
    this.mods = { og: root.namespace, fb: getMod('firebase.js').namespace, config: getMod('config.js').namespace.config, state: getMod('state.js').namespace.state };
    this.om = this.mods.fb.onlineManager;
    const client = this;
    this.mods.og.initOnlineGame({
      onGameStart: () => {
        const cfg = client.mods.config;
        const nums = client.om._isMulti
          ? Object.values(cfg.multiPlayers || {}).map(p => p.num).sort()
          : [1, 2];
        client.matches.push({ at: clock.now, num: cfg.onlinePlayerNum, nums, turn: client.mods.state.currentPlayer, room: client.om.roomCode });
        client.event('MATCH', `بدأت مباراة غرفة=${client.om.roomCode} أنا=${cfg.onlinePlayerNum} اللاعبون=[${nums}] الدور الأول=${client.mods.state.currentPlayer}`);
      },
      gameSetupApi: { startAIGame: (size, diff) => client.event('AI', `لعب ضد الكمبيوتر (${diff})`) },
    });
  }
  el(id) { return this.doc.getElementById(id); }
  hidden(id) { return this.el(id).classList.contains('hidden'); }
  visibleStep() {
    const steps = ['name', 'lobby', 'playing', 'searching', 'multi-count', 'multi-lobby', 'random-count'];
    return steps.filter(s => !this.hidden('online-step-' + s)).join('+') || '-';
  }
  sample() {
    const strip = s => String(s).replace(/<br>/g, ' ⏎ ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const cd = this.hidden('search-countdown') ? '' : `عدّاد[${this.el('search-countdown').textContent}]`;
    const ai = this.hidden('ai-suggest-box') ? '' : 'صندوق-الكمبيوتر';
    const ap = this.hidden('approval-modal') ? '' : `تصويت[${this.el('approval-timer').textContent} ${strip(this.el('approval-players').innerHTML)}]`;
    const txt = this.visibleStep().includes('searching') ? strip(this.el('searching-text').innerHTML) : '';
    const lob = this.visibleStep().includes('multi-lobby')
      ? `لوبي[${this.lobbyList().map(p => p.num + ':' + p.name + (p.host ? '👑' : '')).join(' ')}]${this.hidden('multi-start-btn') ? '' : ' +زر-البدء'}` : '';
    const err = this.hidden('online-error') ? '' : `خطأ[${this.el('online-error').textContent}]`;
    const s = [this.visibleStep(), txt, lob, err, cd, ai, ap].filter(Boolean).join(' | ');
    // نسجّل تغيّر الحالة، مع ضغط تغيّر رقم العدّاد وحده (نسجّل أول وآخر قيمة)
    const key = s.replace(/عدّاد\[[^\]]*\]/, 'عدّاد[#]').replace(/تصويت\[⏳ \d+/, 'تصويت[⏳ #');
    if (key !== this.lastKey) { this.lastKey = key; this.event('ui', s); this.cdSeen = []; }
    const m = cd.match(/⏳ (\d+)/);
    if (m && this.world.traceCountdown && m[1] !== this.lastCd) this.event('cd', m[1]);
    this.lastCd = m ? m[1] : null;
    this.last = s;
  }
  // ── أفعال المستخدم ──
  async startSearch(wanted) {
    this.el('player-name-input').value = this.name;
    this.event('act', `بحث عشوائي (${wanted} لاعبين)`);
    await this.el('random-match-btn').click();
    const label = wanted === 2 ? 'لاعبان' : `${wanted} لاعبين`;
    const chip = this.el('random-count-chips').children.slice().reverse().find(c => c.textContent === label);
    if (!chip) throw new Error('chip not found ' + label);
    await chip.click();
    this.el('random-search-start').click();   // لا ننتظر — البحث يعمل في الخلفية
  }
  // الأفعال لا تُنتظر: معالجاتها تحتاج تقدّم الساعة (w.run) لتكتمل
  // طبقة العدّ 3-2-1 تغطي الشاشة كلها (position:fixed; inset:0) → تمنع أي نقرة تحتها
  blocked(what) { if (this.hidden('start-countdown')) return false; this.event('act', `(${what}: محجوبة بطبقة 3-2-1)`); return true; }
  accept() { if (this.blocked('موافقة')) return; this.event('act', 'موافقة'); this.el('approval-accept').click(); }
  reject() { if (this.blocked('رفض')) return; this.event('act', 'رفض/خروج من التصويت'); this.el('approval-reject').click(); }
  dismissAI() { if (this.blocked('أكمل الانتظار')) return; this.event('act', 'أكمل الانتظار'); this.el('ai-suggest-dismiss').click(); }
  cancelSearch() { if (this.blocked('إلغاء')) return; this.event('act', 'إلغاء البحث'); this.el('cancel-search-btn').click(); }
  countdownVisible() { return !this.hidden('search-countdown'); }
  // ── الغرفة بالكود ──
  createCodeRoom(max) {
    this.el('player-name-input').value = this.name;
    this.event('act', `إنشاء غرفة بالكود (${max})`);
    this.el('create-multi-btn').click();
    const chip = this.el('multi-count-chips').children.find(c => c.textContent === `${max} لاعبين`);
    if (!chip) throw new Error('chip not found ' + max);
    chip.click();
    this.el('multi-create-confirm').click();
  }
  codeShown() { return this.el('multi-code-display').textContent; }
  joinCode(code) {
    this.el('player-name-input').value = this.name;
    this.el('room-code-input').value = code;
    this.event('act', `انضمام بالكود ${code}`);
    this.el('join-room-btn').click();
  }
  startCode() { if (this.blocked('ابدأ')) return; this.event('act', 'ابدأ المباراة (زر المضيف)'); this.el('multi-start-btn').click(); }
  leaveCode() { this.event('act', 'مغادرة اللوبي'); this.el('multi-lobby-leave').click(); }
  lobbyList() {
    return this.el('multi-players-list').children.map(ch => {
      const h = ch.innerHTML;
      return { num: Number((h.match(/mp-num">(\d+)</) || [])[1]), name: (h.match(/mp-name">([^<]*)</) || [])[1], host: h.includes('👑') };
    });
  }
  startBtnVisible() { return !this.hidden('multi-start-btn') && !this.hidden('online-step-multi-lobby'); }
  errorText() { return this.hidden('online-error') ? '' : this.el('online-error').textContent; }
  // إغلاق التبويب: الخادم ينفّذ أوامر onDisconnect، والعميل يتوقّف كلياً
  closeTab(serverDetectMs = 150) {
    this.event('act', 'إغلاق التبويب');
    this.dead = true; this.connected = false;
    const ops = this.onDisc.slice(); this.onDisc = [];
    const srv = this.world.server;
    clock.setTimeout(() => {
      for (const o of ops) {
        if (o.op === 'remove') srv.setAt(o.path, null);
        else if (o.op === 'set') srv.setAt(o.path, resolveSV(clone(o.v), clock.now));
        else if (o.op === 'update') for (const [k, v] of Object.entries(o.v)) srv.setAt(o.path + '/' + k, resolveSV(clone(v), clock.now));
      }
      srv.notify();
    }, serverDetectMs);
  }
  approvalVisible() { return !this.hidden('approval-modal'); }
}

process.on('unhandledRejection', e => { console.log('UNHANDLED', e && (e.stack || e)); });
