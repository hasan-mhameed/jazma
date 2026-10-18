// Firebase وهمي في الذاكرة لتشغيل اللعبة كاملة داخل jsdom (v36.0 — الخطوتان 1.10 و1.11)
// يعطي بدائل وحدات Firebase الثلاث التي يستوردها الكود من gstatic (app/auth/database) بأسمائها الصريحة،
// فوق "خادم" واحد في الذاكرة لكل نافذة (جهاز واحد). القراءة الأولى لأي مستمع غير متزامنة (كرحلة للخادم)،
// والكتابة تُبلّغ المستمعين بعدها مباشرة (في مهمة لاحقة قصيرة) — بلا تغيير = بلا حدث، كالحقيقي.
// الحساب: onAuthStateChanged ينطلق أول مرة لكل مسجّل، ثم فقط حين يتغيّر المعرّف (سلوك Firebase الحقيقي —
// تأكّدنا من كود الحزمة 1.7.3: lastNotifiedUid) — فالربط (ترقية الضيف) لا يطلقه.

const BASE = 'https://www.gstatic.com/firebasejs/10.12.0/';
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isSV = v => v && typeof v === 'object' && !Array.isArray(v) && v['.sv'] === 'timestamp';
const parts = p => String(p || '').split('/').filter(Boolean);
const keyCmp = (a, b) => {
  const ia = /^(0|-?[1-9]\d*)$/.test(a), ib = /^(0|-?[1-9]\d*)$/.test(b);
  if (ia && ib) return Number(a) - Number(b);
  if (ia) return -1; if (ib) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};
function normalize(v, now) {
  if (isSV(v)) return now;
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) v = Object.fromEntries(v.map((x, i) => [i, x]));
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) { const n = normalize(v[k], now); if (n !== null) o[k] = n; }
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
function snap(key, value, ref) {
  const v = value === undefined ? null : toRead(value);
  return {
    key, ref,
    exists: () => v !== null,
    val: () => clone(v),
    exportVal: () => clone(v),
    hasChildren: () => !!v && typeof v === 'object' && Object.keys(v).length > 0,
    numChildren: () => (v && typeof v === 'object' ? Object.keys(v).length : 0),
    get size() { return v && typeof v === 'object' ? Object.keys(v).length : 0; },
    forEach(cb) {
      if (!v || typeof v !== 'object') return false;
      for (const k of Object.keys(v).sort(keyCmp)) if (cb(snap(k, v[k])) === true) return true;
      return false;
    },
    child(p) {
      let c = v; for (const k of parts(p)) c = (c && typeof c === 'object') ? c[k] : null;
      return snap(parts(p).pop() ?? null, c ?? null);
    },
    toJSON: () => clone(v),
  };
}

// cold: اتصال بارد (أول دخول — لا طلبات للخادم قبله): كل العمليات تنتظر fb.connect()، وعند الاتصال بترتيب restoreState_
// في الحزمة الحقيقية: المستمعون، ثم الكتابات المعلّقة، ثم القراءات المعلّقة (مراجعة v36.0 الثالثة: كتابة تسبق قراءة
// "هل الملف موجود؟" تجعل الملف موجوداً ناقصاً). تبسيط معروف: الحزمة الحقيقية تُظهر الكتابة المعلّقة محلياً فوراً
// للمستمعين على الجهاز نفسه؛ هنا لا تظهر إلا عند الاتصال — يكفي لفحص ما يصل الخادم، لا لفحص حالة الشاشة قبل الاتصال.
export function createFirebase({ win, users = {}, cold = false } = {}) {
  const later = (fn) => win.setTimeout(() => { try { fn(); } catch (e) { fb.errors.push(String(e && e.stack || e)); } }, 0);
  const fb = {
    root: null, listeners: new Set(), childListeners: new Set(), disconnectOps: [], keySeq: 0, writes: [], errors: [],
    connected: !cold,
    pending: [],                       // عمليات تنتظر الاتصال (cold): { kind: 'write'|'get'|'listen', run }
    failNextGet: null,                 // مسار: أول get عليه يُرفض (كرفض الصلاحيات أو انقطاع)
    batches: [],                       // كل set/update/remove كما وصل الخادم بترتيبه: { op, path, keys }
    // ── أدوات الفحص ──
    get(path) { return clone(this.getAt(path)); },
    set(path, value) { this.write(path, value); },
    activeListeners(path) { return [...this.listeners].filter(L => !L.dead && L.path === parts(path).join('/')).length; },
    /** يصل الاتصال البارد: الكتابات المعلّقة أولاً بترتيبها، ثم المستمعون، ثم القراءات المعلّقة */
    connect() {
      if (this.connected) return;
      this.connected = true;
      const q = this.pending.splice(0);
      q.filter(x => x.kind === 'listen').forEach(x => x.run());
      q.filter(x => x.kind === 'write').forEach(x => x.run());
      q.filter(x => x.kind === 'get').forEach(x => x.run());
      notifyAll();
    },
    /** يقطع الاتصال: تنفيذ أوامر onDisconnect المسجّلة (كما يفعل الخادم عند انقطاع الجهاز أو إعادة تحميل الصفحة) */
    dropConnection() {
      const ops = this.disconnectOps.splice(0);
      ops.forEach(op => op.run());
    },
  };
  const now = () => win.Date.now();
  fb.getAt = (p) => {
    let cur = fb.root;
    for (const k of parts(p)) { if (cur == null || typeof cur !== 'object') return null; cur = cur[k]; if (cur === undefined) return null; }
    return cur ?? null;
  };
  fb.write = (p, value) => {
    const keys = parts(p); const v = normalize(clone(value), now());
    fb.writes.push({ path: keys.join('/'), value: v });
    if (!keys.length) { fb.root = v; notifyAll(); return; }
    if (fb.root == null || typeof fb.root !== 'object') { if (v === null) return notifyAll(); fb.root = {}; }
    let cur = fb.root; const stack = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (cur[k] == null || typeof cur[k] !== 'object') { if (v === null) return notifyAll(); cur[k] = {}; }
      stack.push([cur, k]); cur = cur[k];
    }
    const last = keys[keys.length - 1];
    if (v === null) delete cur[last]; else cur[last] = v;
    for (let i = stack.length - 1; i >= 0; i--) {
      const [par, k] = stack[i];
      if (par[k] && typeof par[k] === 'object' && !Object.keys(par[k]).length) delete par[k];
    }
    if (fb.root && typeof fb.root === 'object' && !Object.keys(fb.root).length) fb.root = null;
    notifyAll();
  };

  // ── المراجع والاستعلامات ──
  const DB = { app: null, _fake: true };
  const mkRef = (path, constraints = []) => {
    const ps = parts(path);
    return { _path: ps.join('/'), key: ps.length ? ps[ps.length - 1] : null, _q: constraints, toString: () => 'fake:' + ps.join('/') };
  };
  const applyQuery = (value, q) => {
    if (!q || !q.length || !value || typeof value !== 'object') return value;
    let keys = Object.keys(value).sort(keyCmp);
    for (const c of q) {
      if (c.type === 'limitToLast') keys = keys.slice(-c.n);
      if (c.type === 'limitToFirst') keys = keys.slice(0, c.n);
    }
    const o = {}; keys.forEach(k => { o[k] = value[k]; });
    return Object.keys(o).length ? o : null;
  };
  const readAt = (r) => {
    if (r._path === '.info/connected') return fb.connected;
    if (r._path === '.info/serverTimeOffset') return 0;
    return applyQuery(fb.getAt(r._path), r._q);
  };

  // كتابة الآن إن كان الاتصال قائماً، وإلا تنتظر الاتصال (ووعدها يُحلّ حين تُطبَّق)
  function whenConnected(run) {
    if (fb.connected) return Promise.resolve().then(run);
    return new Promise((resolve, reject) => fb.pending.push({ kind: 'write', run: () => { try { resolve(run()); } catch (e) { reject(e); } } }));
  }

  function notifyAll() {
    for (const L of fb.listeners) {
      if (L.dead || !L.ready) continue;
      const v = readAt(L.ref); const ser = JSON.stringify(v);
      if (ser === L.lastSer) continue;
      L.lastSer = ser;
      later(() => { if (!L.dead) L.cb(snap(L.ref.key, clone(v), L.ref)); });
    }
    for (const C of fb.childListeners) {
      if (C.dead || !C.ready) continue;
      const v = readAt(C.ref) || {};
      for (const k of Object.keys(v).sort(keyCmp)) {
        if (C.seen.has(k)) continue;
        C.seen.add(k);
        const cv = clone(v[k]);
        later(() => { if (!C.dead) C.cb(snap(k, cv)); });
      }
    }
  }

  const database = {
    getDatabase: () => DB,
    ref: (_db, path = '') => mkRef(path),
    query: (r, ...constraints) => mkRef(r._path, [...(r._q || []), ...constraints]),
    orderByKey: () => ({ type: 'orderByKey' }),
    limitToLast: (n) => ({ type: 'limitToLast', n }),
    serverTimestamp: () => ({ '.sv': 'timestamp' }),
    onValue(r, cb, errCb) {
      const L = { ref: r, path: r._path, cb, dead: false, ready: false, lastSer: undefined };
      fb.listeners.add(L);
      const first = () => later(() => {
        if (L.dead) return;
        const v = readAt(r); L.lastSer = JSON.stringify(v); L.ready = true;
        L.cb(snap(r.key, clone(v), r));
      });
      if (fb.connected || r._path.startsWith('.info/')) first(); else fb.pending.push({ kind: 'listen', run: first });
      return () => { L.dead = true; fb.listeners.delete(L); };
    },
    onChildAdded(r, cb) {
      const C = { ref: r, path: r._path, cb, dead: false, ready: false, seen: new Set() };
      fb.childListeners.add(C);
      later(() => { if (C.dead) return; C.ready = true; notifyAll(); });
      return () => { C.dead = true; fb.childListeners.delete(C); };
    },
    off(r) {
      for (const L of [...fb.listeners]) if (L.path === r._path) { L.dead = true; fb.listeners.delete(L); }
      for (const C of [...fb.childListeners]) if (C.path === r._path) { C.dead = true; fb.childListeners.delete(C); }
    },
    get: (r) => new Promise((resolve, reject) => {
      const answer = () => later(() => {
        if (fb.failNextGet === r._path) { fb.failNextGet = null; reject(Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' })); return; }
        resolve(snap(r.key, clone(readAt(r)), r));
      });
      if (fb.connected) answer(); else fb.pending.push({ kind: 'get', run: answer });
    }),
    set: (r, value) => whenConnected(() => { fb.batches.push({ op: 'set', path: r._path, keys: value && typeof value === 'object' ? Object.keys(value) : [] }); fb.write(r._path, value); }),
    update: (r, values) => whenConnected(() => {
      fb.batches.push({ op: 'update', path: r._path, keys: Object.keys(values || {}) });
      for (const [k, v] of Object.entries(values || {})) fb.write(parts(r._path).concat(parts(k)).join('/'), v);
    }),
    remove: (r) => whenConnected(() => { fb.batches.push({ op: 'remove', path: r._path, keys: [] }); fb.write(r._path, null); }),
    push(r, value) {
      const key = '-Nfake' + String(++fb.keySeq).padStart(8, '0');
      const child = mkRef(r._path + '/' + key);
      const p = value === undefined ? Promise.resolve() : database.set(child, value);
      return Object.assign(child, { then: p.then.bind(p), catch: p.catch.bind(p) });
    },
    runTransaction(r, fn) {
      return whenConnected(() => {
        const cur = clone(fb.getAt(r._path));
        const res = fn(cur);
        if (res === undefined) return { committed: false, snapshot: snap(r.key, cur, r) };
        fb.write(r._path, res);
        return { committed: true, snapshot: snap(r.key, clone(fb.getAt(r._path)), r) };
      });
    },
    // أوامر الانقطاع لكل مسار؛ cancel() يلغي أوامر هذا المسار وما تحته فقط (كالحقيقي — مراجعة v36.0 الثانية)
    onDisconnect(r) {
      const add = (run) => { fb.disconnectOps.push({ path: r._path, run }); return Promise.resolve(); };
      return {
        set: (v) => add(() => fb.write(r._path, v)),
        update: (vals) => add(() => { for (const [k, v] of Object.entries(vals || {})) fb.write(parts(r._path).concat(parts(k)).join('/'), v); }),
        remove: () => add(() => fb.write(r._path, null)),
        cancel: () => {
          const under = p => p === r._path || p.startsWith(r._path + '/') || r._path === '';
          for (let i = fb.disconnectOps.length - 1; i >= 0; i--) if (under(fb.disconnectOps[i].path)) fb.disconnectOps.splice(i, 1);
          return Promise.resolve();
        },
      };
    },
  };

  // ── الحساب ──
  const AUTH = { currentUser: null, listeners: new Set(), lastNotifiedUid: undefined };
  fb.auth = AUTH;
  fb.accounts = { ...users };          // إيميل → { password, user }
  fb.nextPopupUser = null;             // من يدخل عبر نافذة Google المنبثقة
  const mkUser = (u) => ({ uid: u.uid, displayName: u.displayName ?? null, email: u.email ?? null, photoURL: u.photoURL ?? null,
    isAnonymous: !!u.isAnonymous, providerData: clone(u.providerData || []) });
  const notifyAuth = () => {
    const uid = AUTH.currentUser?.uid ?? null;
    if (AUTH.lastNotifiedUid === uid) return;
    AUTH.lastNotifiedUid = uid;
    for (const cb of [...AUTH.listeners]) later(() => cb(AUTH.currentUser));
  };
  fb.signInAs = (u) => { AUTH.currentUser = u ? mkUser(u) : null; notifyAuth(); return AUTH.currentUser; };
  fb.signOutNow = () => { AUTH.currentUser = null; notifyAuth(); };
  let anonSeq = 0;
  class GoogleAuthProvider { constructor() { this.providerId = 'google.com'; } }
  const auth = {
    getAuth: () => AUTH,
    GoogleAuthProvider,
    EmailAuthProvider: { credential: (email, password) => ({ providerId: 'password', email, password }) },
    onAuthStateChanged(_a, cb) {
      AUTH.listeners.add(cb);
      if (AUTH.lastNotifiedUid === undefined) AUTH.lastNotifiedUid = AUTH.currentUser?.uid ?? null;
      later(() => cb(AUTH.currentUser));
      return () => AUTH.listeners.delete(cb);
    },
    async signInWithPopup() {
      if (!fb.nextPopupUser) throw Object.assign(new Error('popup closed'), { code: 'auth/popup-closed-by-user' });
      return { user: fb.signInAs(fb.nextPopupUser) };
    },
    async signInWithEmailAndPassword(_a, email, password) {
      const acc = fb.accounts[email];
      if (!acc || acc.password !== password) throw Object.assign(new Error('bad'), { code: 'auth/invalid-credential' });
      return { user: fb.signInAs(acc.user) };
    },
    async createUserWithEmailAndPassword(_a, email, password) {
      const user = { uid: 'uid_' + email.replace(/\W/g, '_'), email, displayName: null };
      fb.accounts[email] = { password, user };
      return { user: fb.signInAs(user) };
    },
    async signInAnonymously() { return { user: fb.signInAs({ uid: 'anon_' + (++anonSeq), isAnonymous: true }) }; },
    async signOut() { fb.signOutNow(); },
    // رحلة للخادم (كالحقيقي): الاسم يصل الحساب بعد لحظات — فيظهر سباق "حفظ الملف قبل وصول الاسم" عند التسجيل
    async updateProfile(user, { displayName, photoURL } = {}) {
      for (let i = 0; i < 4; i++) await new Promise(res => later(res));
      if (displayName !== undefined) user.displayName = displayName;
      if (photoURL !== undefined) user.photoURL = photoURL;
    },
    // الربط يبقي المعرّف نفسه — لا ينطلق onAuthStateChanged (كالحقيقي). الاسم/الصورة في providerData فقط.
    async linkWithPopup(user) {
      const g = fb.nextPopupUser;
      if (!g) throw Object.assign(new Error('popup closed'), { code: 'auth/popup-closed-by-user' });
      user.isAnonymous = false;
      user.email = user.email || g.email || null;
      user.providerData = [...(user.providerData || []), { providerId: 'google.com', displayName: g.displayName ?? null, email: g.email ?? null, photoURL: g.photoURL ?? null }];
      return { user };
    },
    async linkWithCredential(user, cred) {
      user.isAnonymous = false; user.email = cred.email;
      user.providerData = [...(user.providerData || []), { providerId: 'password', email: cred.email, displayName: null, photoURL: null }];
      fb.accounts[cred.email] = { password: cred.password, user };
      return { user };
    },
  };

  let appCreated = false;
  const app = {
    initializeApp: () => { appCreated = true; return DB; },
    getApps: () => (appCreated ? [DB] : []),
  };

  fb.modules = {
    [BASE + 'firebase-app.js']: app,
    [BASE + 'firebase-auth.js']: auth,
    [BASE + 'firebase-database.js']: database,
  };
  return fb;
}
