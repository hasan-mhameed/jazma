// خادم Firebase RTDB وهمي صغير (بروتوكول الاتصال v5) لحزمة Firebase الحقيقية في Node.
// البصمات (hash) من nodeFromJSON الخاص بالحزمة نفسها، فتُفحص المعاملات كما عند الخادم الحقيقي.
// (بناه المراجع المستقل في مراجعة v35.7 الثانية، وضُمّ للمشروع كطبقة فحص ثانية)
import http from 'node:http';
import Websocket from 'faye-websocket';
import { __nodeFromJSON } from './.gen/sdk-hash.mjs';   // يولّده prepare.mjs

const parts = p => String(p || '').split('/').filter(Boolean);
const clone = v => (v == null ? null : JSON.parse(JSON.stringify(v)));
function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) { const n = norm(v[k]); if (n !== null) o[k] = n; } return Object.keys(o).length ? o : null; }
  return v;
}
function resolveSV(v, now) {
  if (v && typeof v === 'object') { if (v['.sv'] === 'timestamp') return now; const o = {}; for (const k of Object.keys(v)) o[k] = resolveSV(v[k], now); return o; }
  return v;
}
export class FakeRTDB {
  constructor() { this.root = null; this.conns = new Set(); this.log = []; this.delay = 5; this.delayFor = null; this.replyDelayFor = null; }
  close() { for (const c of this.conns) { try { c.ws.close(); } catch {} } try { this.srv.close(); } catch {} }
  getAt(p) { let c = this.root; for (const k of parts(p)) { if (c == null || typeof c !== 'object') return null; c = c[k]; if (c === undefined) return null; } return c ?? null; }
  setAt(p, v) {
    const ks = parts(p); v = norm(v);
    if (!ks.length) { this.root = v; return; }
    if (this.root == null || typeof this.root !== 'object') { if (v === null) return; this.root = {}; }
    let c = this.root; const st = [];
    for (let i = 0; i < ks.length - 1; i++) { const k = ks[i]; if (c[k] == null || typeof c[k] !== 'object') { if (v === null) return; c[k] = {}; } st.push([c, k]); c = c[k]; }
    const last = ks[ks.length - 1]; if (v === null) delete c[last]; else c[last] = clone(v);
    for (let i = st.length - 1; i >= 0; i--) { const [par, k] = st[i]; if (par[k] && typeof par[k] === 'object' && !Object.keys(par[k]).length) delete par[k]; }
    if (this.root && typeof this.root === 'object' && !Object.keys(this.root).length) this.root = null;
  }
  hash(p) { return __nodeFromJSON(clone(this.getAt(p))).hash(); }
  listen(port = 0) {
    this.srv = http.createServer();
    this.srv.on('upgrade', (req, sock, body) => { if (Websocket.isWebSocket(req)) this.accept(new Websocket(req, sock, body)); });
    return new Promise(r => this.srv.listen(port, () => { this.port = this.srv.address().port; r(this.port); }));
  }
  send(conn, msg, ms = null) { if (!conn.closed) setTimeout(() => { if (!conn.closed) conn.ws.send(JSON.stringify(msg)); }, typeof ms === 'number' ? ms : this.delay); }
  accept(ws) {
    const conn = { ws, listens: new Set(), ondisc: [], closed: false, id: Math.random().toString(36).slice(2, 7), paused: false, queue: [] };
    this.conns.add(conn);
    ws.send(JSON.stringify({ t: 'c', d: { t: 'h', d: { ts: Date.now(), v: '5', h: `localhost:${this.port}`, s: 'sess_' + conn.id } } }));
    // delayFor(msg, conn): تأخير رسالة بعينها (رفع بطيء، تأكيد يتأخر حتى يسبقه انقطاع) — وإلا this.delay
    ws.on('message', ev => {
      const s = String(ev.data); if (s.length <= 6) return;
      const m = JSON.parse(s);
      const d = this.delayFor ? this.delayFor(m, conn) : null;
      setTimeout(() => this.onMsg(conn, m), typeof d === 'number' ? d : this.delay);
    });
    ws.on('close', () => { conn.closed = true; this.conns.delete(conn); this.runOnDisconnect(conn); });
  }
  runOnDisconnect(conn) {
    const now = Date.now(); const changed = [];
    for (const o of conn.ondisc) {
      if (o.a === 'o') { this.setAt(o.p, resolveSV(o.d, now)); changed.push(o.p); }
      else for (const [k, v] of Object.entries(o.d || {})) { const cp = parts(o.p).concat(parts(k)).join('/'); this.setAt(cp, resolveSV(v, now)); changed.push(cp); }
    }
    this.log.push(`ondisconnect(${conn.id}) ran ${conn.ondisc.length} ops`);
    conn.ondisc = [];
    changed.forEach(p => this.broadcast(p));
  }
  broadcast(changed) {
    for (const c of this.conns) {
      const pushes = new Set();
      for (const L of c.listens) {
        const lp = parts(L), cp = parts(changed);
        const n = Math.min(lp.length, cp.length);
        if (lp.slice(0, n).join('/') !== cp.slice(0, n).join('/')) continue;
        pushes.add(cp.length >= lp.length ? cp.join('/') : lp.join('/'));
      }
      const arr = [...pushes].filter(p => ![...pushes].some(q => q !== p && (p + '/').startsWith(q + '/') && q.length < p.length));
      for (const p of arr) this.send(c, { t: 'd', d: { a: 'd', b: { p: '/' + p, d: clone(this.getAt(p)) } } });
    }
  }
  // replyDelayFor(msg): تأخير **الرد** وحده (الطلب نُفّذ بترتيبه لكن تأكيده لم يصل قبل الانقطاع)
  reply(conn, r, s = 'ok', d = {}, ms = null) { this.send(conn, { t: 'd', d: { r, b: { s, d } } }, ms); }
  onMsg(conn, m) {
    if (conn.closed || m.t !== 'd') return;
    const { r, a, b } = m.d;
    const now = Date.now();
    const rd = this.replyDelayFor ? this.replyDelayFor(m, conn) : null;
    if (a === 'q') { const p = parts(b.p).join('/'); conn.listens.add(p); this.send(conn, { t: 'd', d: { a: 'd', b: { p: '/' + p, d: clone(this.getAt(p)) } } }); return this.reply(conn, r, 'ok', {}, rd); }
    if (a === 'n') { conn.listens.delete(parts(b.p).join('/')); return this.reply(conn, r, 'ok', {}, rd); }
    if (a === 'p') {
      const p = parts(b.p).join('/');
      if (b.h !== undefined && b.h !== this.hash(p)) { this.log.push(`put ${p} datastale`); return this.reply(conn, r, 'datastale', 'hash mismatch', rd); }
      this.setAt(p, resolveSV(b.d, now)); this.log.push(`put ${p}${b.h !== undefined ? ' (txn)' : ''} ok`); this.broadcast(p); return this.reply(conn, r, 'ok', {}, rd);
    }
    if (a === 'm') {
      const p = parts(b.p).join('/');
      for (const [k, v] of Object.entries(b.d || {})) { const cp = parts(p).concat(parts(k)).join('/'); this.setAt(cp, resolveSV(v, now)); this.broadcast(cp); }
      this.log.push(`merge ${p} ${JSON.stringify(b.d)}`); return this.reply(conn, r, 'ok', {}, rd);
    }
    if (a === 'o' || a === 'om') { conn.ondisc.push({ a, p: b.p, d: b.d }); return this.reply(conn, r, 'ok', {}, rd); }
    if (a === 'oc') { const p = parts(b.p).join('/'); conn.ondisc = conn.ondisc.filter(o => { const op = parts(o.p).join('/'); return !(op === p || op.startsWith(p + '/')); }); this.log.push(`oncancel ${p}`); return this.reply(conn, r, 'ok', {}, rd); }
    if (a === 'g') return this.reply(conn, r, 'ok', clone(this.getAt(b.p)), rd);
    return this.reply(conn, r, 'ok', {}, rd);   // s (stats), auth, unauth, appcheck ...
  }
}
