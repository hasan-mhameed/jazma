// محرّك صغير لقواعد أمان Firebase Realtime Database (v36.1 — الخطوة 1.13)
// يطبّق ملف القواعد نفسه الذي يُنشر (database.rules.json) داخل الخوادم الوهمية للفحوص: Firebase الوهمي في tests/ui
// والخادم الوهمي للحزمة الحقيقية في tests/realsdk — فما ترفضه القواعد في الإنتاج يُرفض في الفحص (permission_denied).
//
// ما يغطيه (كما في توثيق Firebase):
//  • .read/.write تتتالى من الجذر نزولاً: يكفي أن يسمح أي مستوى من الجذر حتى المسار المقصود؛ القواعد الأعمق لا تمنح
//    صلاحية على مسار أعلى منها (كتابة users/ب كاملة لا تسمح بها قاعدة users/ب/friendRequests/$x).
//  • متغيرات $ (مفتاح واحد بديل لكل مستوى، والمفتاح الصريح يسبقه)، و auth و now و root و data و newData.
//  • الكتابة متعددة المسارات تُقيَّم كل مسار فيها على البيانات الجديدة كلها، وتُرفض كلها إن رُفض واحد (ذرّية).
//  • .validate: على المسار المكتوب وما تحته وعلى آبائه، حيث توجد بيانات جديدة (لا على الحذف) — 3.3أ-3: الآباء أُضيفوا.
//  • خطأ أثناء التقييم (مثل auth.uid وauth فارغ) = رفض، والنتيجة يجب أن تكون true بالضبط.
//  • دوال النصوص التي تستعملها قواعدنا (3.3أ-3 — مفتاح المحادثة): beginsWith وendsWith وcontains وreplace (كل التكرارات،
//    كما في توثيق Firebase) وtoLowerCase/toUpperCase وlength والجمع بـ+ — تُترجم لما يقابلها في JS.
// غير مغطّى (لا تستعمله قواعدنا): الاستعلامات المشروطة (query.*)، الأولويات، matches (التعابير النمطية).

const parts = p => String(p ?? '').split('/').filter(Boolean);
const clone = v => (v == null ? null : JSON.parse(JSON.stringify(v)));
const isSV = v => v && typeof v === 'object' && !Array.isArray(v) && v['.sv'] === 'timestamp';

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
function getAt(root, ps) {
  let c = root;
  for (const k of ps) { if (c == null || typeof c !== 'object') return null; c = c[k]; if (c === undefined) return null; }
  return c ?? null;
}
/** نسخة جديدة من الجذر بعد كتابة value عند ps (مع حذف العقد الفارغة كما يفعل Firebase) */
export function applyWrite(root, path, value, now = Date.now()) {
  const ps = parts(path);
  const v = normalize(clone(value), now);
  if (!ps.length) return v;
  const out = clone(root) ?? {};
  let cur = out; const stack = [];
  for (let i = 0; i < ps.length - 1; i++) {
    const k = ps[i];
    if (cur[k] == null || typeof cur[k] !== 'object') { if (v === null) return normalize(out, now); cur[k] = {}; }
    stack.push([cur, k]); cur = cur[k];
  }
  const last = ps[ps.length - 1];
  if (v === null) delete cur[last]; else cur[last] = v;
  for (let i = stack.length - 1; i >= 0; i--) {
    const [par, k] = stack[i];
    if (par[k] && typeof par[k] === 'object' && !Object.keys(par[k]).length) delete par[k];
  }
  return Object.keys(out).length ? out : null;
}

class RuleSnap {
  constructor(root, ps) { this._root = root; this._ps = ps; }
  child(p) { return new RuleSnap(this._root, this._ps.concat(parts(String(p)))); }
  parent() { return new RuleSnap(this._root, this._ps.slice(0, -1)); }
  exists() { return getAt(this._root, this._ps) !== null; }
  val() { return clone(getAt(this._root, this._ps)); }
  hasChild(p) { return this.child(p).exists(); }
  hasChildren(keys) {
    const v = getAt(this._root, this._ps);
    if (!v || typeof v !== 'object') return false;
    return Array.isArray(keys) ? keys.every(k => this.child(k).exists()) : Object.keys(v).length > 0;
  }
  isString() { return typeof getAt(this._root, this._ps) === 'string'; }
  isNumber() { return typeof getAt(this._root, this._ps) === 'number'; }
  isBoolean() { return typeof getAt(this._root, this._ps) === 'boolean'; }
  getPriority() { return null; }
}

// دوال النصوص في لغة القواعد ← ما يقابلها في JS (replace في Firebase يبدّل كل التكرارات = replaceAll)
const STRING_FNS = { beginsWith: 'startsWith', endsWith: 'endsWith', contains: 'includes', replace: 'replaceAll' };
// أسماء JS ليست في لغة قواعد Firebase: لو كُتبت في القواعد لنجحت الفحوص هنا ورفض Firebase النشر — نرفضها هنا أولاً
const JS_ONLY = /\.(startsWith|includes|replaceAll|slice|substring|substr|indexOf|lastIndexOf|split|trim|padStart|padEnd|charAt|at|map|filter|some|every|keys)\(/;
function toJS(expr) {
  if (/\.matches\(/.test(expr)) throw new Error('rulesEngine: matches() غير مدعوم في المحرّك — أضِفه قبل استعماله في القواعد');
  if (JS_ONLY.test(expr)) throw new Error('rulesEngine: دالة JS ليست في لغة قواعد Firebase: ' + expr.match(JS_ONLY)[0]);
  return String(expr).replace(/\.(beginsWith|endsWith|contains|replace)\(/g, (_, f) => '.' + STRING_FNS[f] + '(');
}

const compiled = new Map();
function evalRule(expr, ctx, vars) {
  if (expr === true || expr === 'true') return true;
  if (expr === false || expr === 'false') return false;
  const names = Object.keys(vars);
  const key = names.join(',') + '|' + expr;
  let fn = compiled.get(key);
  if (!fn) {
    fn = new Function('auth', 'now', 'root', 'data', 'newData', ...names, `"use strict"; return (${toJS(expr)});`);
    compiled.set(key, fn);
  }
  try { return fn(ctx.auth, ctx.now, ctx.root, ctx.data, ctx.newData, ...names.map(n => vars[n])) === true; }
  catch { return false; }
}

/** مستويات القواعد من الجذر حتى المسار: [{ node, vars, ps }] — node=null حين لا توجد قواعد في هذا الفرع */
function walk(rules, ps) {
  const out = [];
  let node = rules && rules.rules !== undefined ? rules.rules : rules;
  const vars = {};
  out.push({ node, vars: {}, ps: [] });
  for (let i = 0; i < ps.length; i++) {
    let next = null;
    if (node && typeof node === 'object') {
      if (Object.prototype.hasOwnProperty.call(node, ps[i])) next = node[ps[i]];
      else {
        const w = Object.keys(node).find(k => k.startsWith('$'));
        if (w) { next = node[w]; vars[w] = ps[i]; }
      }
    }
    node = next;
    out.push({ node, vars: { ...vars }, ps: ps.slice(0, i + 1) });
  }
  return out;
}

const authOf = uid => (uid ? { uid, provider: 'custom', token: { sub: uid } } : null);

/** هل يقرأ هذا المستخدم هذا المسار؟ */
export function canRead(rules, path, { uid = null, root = null, now = Date.now() } = {}) {
  const ps = parts(path);
  if (ps[0] === '.info') return true;
  const ctxBase = { auth: authOf(uid), now, root: new RuleSnap(root, []) };
  for (const lvl of walk(rules, ps)) {
    const r = lvl.node && typeof lvl.node === 'object' ? lvl.node['.read'] : undefined;
    if (r !== undefined && evalRule(r, { ...ctxBase, data: new RuleSnap(root, lvl.ps), newData: null }, lvl.vars)) return true;
  }
  return false;
}

function validateUnder(rules, ps, newRoot, ctxBase, root) {
  // .validate على المسار المكتوب وما تحته (حيث توجد بيانات جديدة فقط)
  const check = (rnode, vars, curPs) => {
    if (!rnode || typeof rnode !== 'object') return true;
    const nd = new RuleSnap(newRoot, curPs);
    if (!nd.exists()) return true;
    if (rnode['.validate'] !== undefined &&
        !evalRule(rnode['.validate'], { ...ctxBase, data: new RuleSnap(root, curPs), newData: nd }, vars)) return false;
    const v = getAt(newRoot, curPs);
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        let child = null; const cv = { ...vars };
        if (Object.prototype.hasOwnProperty.call(rnode, k)) child = rnode[k];
        else { const w = Object.keys(rnode).find(x => x.startsWith('$')); if (w) { child = rnode[w]; cv[w] = k; } }
        if (child && !check(child, cv, curPs.concat(k))) return false;
      }
    }
    return true;
  };
  const levels = walk(rules, ps);
  const last = levels[levels.length - 1];
  return check(last.node, last.vars, ps);
}

/**
 * هل تُقبل هذه الكتابة؟ writes: [[path, value], ...] — كتابة واحدة (set/remove) أو كتابة متعددة المسارات (update).
 * ترجع { ok: true, newRoot } أو { ok: false, path } — الذرّية: رفض أي مسار يرفض الكل.
 */
export function checkWrite(rules, writes, { uid = null, root = null, now = Date.now() } = {}) {
  let newRoot = clone(root);
  for (const [p, v] of writes) newRoot = applyWrite(newRoot, p, v, now);
  const ctxBase = { auth: authOf(uid), now, root: new RuleSnap(root, []) };
  for (const [p] of writes) {
    const ps = parts(p);
    let granted = false;
    for (const lvl of walk(rules, ps)) {
      const w = lvl.node && typeof lvl.node === 'object' ? lvl.node['.write'] : undefined;
      if (w !== undefined && evalRule(w, { ...ctxBase, data: new RuleSnap(root, lvl.ps), newData: new RuleSnap(newRoot, lvl.ps) }, lvl.vars)) {
        granted = true; break;
      }
    }
    if (!granted) return { ok: false, path: ps.join('/') };
    if (!validateUnder(rules, ps, newRoot, ctxBase, root)) return { ok: false, path: ps.join('/'), validate: true };
    // .validate الآباء أيضاً (كـFirebase: "كل قواعد validate يجب أن تتحقق على كل مستويات الشجرة") — تُقيَّم على البيانات
    // الجديدة المدمجة لكل أب ما زالت له بيانات: تحديث status وحده يمرّ بـ.validate الرسالة نفسها
    const lv = walk(rules, ps);
    for (let i = 0; i < lv.length - 1; i++) {
      const node = lv[i].node;
      if (!node || typeof node !== 'object' || node['.validate'] === undefined) continue;
      const nd = new RuleSnap(newRoot, lv[i].ps);
      if (!nd.exists()) continue;
      if (!evalRule(node['.validate'], { ...ctxBase, data: new RuleSnap(root, lv[i].ps), newData: nd }, lv[i].vars)) {
        return { ok: false, path: lv[i].ps.join('/'), validate: true };
      }
    }
  }
  return { ok: true, newRoot };
}

export const PERMISSION_DENIED = () => Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' });
