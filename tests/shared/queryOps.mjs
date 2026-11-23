// استعلامات القراءة في الخوادم الوهمية (3.3ج-5ب): ترتيب Firebase وحدوده، وتحويل الاستعلام لأسماء القواعد (query.*)
// القيود بالشكل { type, ... }: orderByChild(child) / orderByValue / orderByKey / limitToFirst(n) / limitToLast(n) / startAt(v) / endAt(v) / equalTo(v)
const keyCmp = (a, b) => {
  const na = /^-?(0|[1-9]\d*)$/.test(a), nb = /^-?(0|[1-9]\d*)$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na) return -1; if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};
// رتبة Firebase: الغائب/null، ثم false ثم true، ثم الأرقام تصاعدياً، ثم النصوص، ثم الكائنات
const rank = v => v == null ? [0] : v === false ? [1] : v === true ? [2] : typeof v === 'number' ? [3, v] : typeof v === 'string' ? [4, v] : [5];
const cmpRank = (ra, rb) => (ra[0] !== rb[0] ? ra[0] - rb[0] : ra.length > 1 && ra[1] !== rb[1] ? (ra[1] < rb[1] ? -1 : 1) : 0);

/** الاستعلام بأسماء قواعد Firebase (query.*) — قراءة بلا قيود = كلها null/false */
export function queryForRules(q = []) {
  const out = {};
  for (const c of q || []) {
    if (c.type === 'orderByChild') out.orderByChild = c.child;
    else if (c.type === 'orderByValue') out.orderByValue = true;
    else if (c.type === 'orderByKey') out.orderByKey = true;
    else if (c.type === 'limitToFirst') out.limitToFirst = c.n;
    else if (c.type === 'limitToLast') out.limitToLast = c.n;
    else if (c.type === 'startAt') out.startAt = c.v;
    else if (c.type === 'endAt') out.endAt = c.v;
    else if (c.type === 'equalTo') out.equalTo = c.v;
  }
  return out;
}

/** تطبيق الاستعلام على قيمة عقدة (كائن أبنائها) كما يفعل الخادم */
export function applyQuery(value, q = []) {
  if (!q || !q.length || !value || typeof value !== 'object') return value;
  const ob = q.find(c => c.type === 'orderByChild'), ov = q.find(c => c.type === 'orderByValue');
  const ordVal = k => ob ? (value[k] && typeof value[k] === 'object' ? value[k][ob.child] : null) : ov ? value[k] : null;
  const byOrder = !!(ob || ov);
  let keys = Object.keys(value).sort((a, b) => (byOrder ? cmpRank(rank(ordVal(a)), rank(ordVal(b))) : 0) || keyCmp(a, b));
  for (const c of q) {
    // startAt(قيمة، مفتاح): عند تساوي القيمة يبدأ من المفتاح (مؤشر الصفحات — 3.3ج-5ب)
    if (c.type === 'startAt') keys = keys.filter(k => { const d = cmpRank(rank(byOrder ? ordVal(k) : k), rank(c.v)); return d > 0 || (d === 0 && (c.k == null || keyCmp(k, c.k) >= 0)); });
    if (c.type === 'endAt') keys = keys.filter(k => cmpRank(rank(byOrder ? ordVal(k) : k), rank(c.v)) <= 0);
    if (c.type === 'equalTo') keys = keys.filter(k => cmpRank(rank(byOrder ? ordVal(k) : k), rank(c.v)) === 0);
  }
  const lf = q.find(c => c.type === 'limitToFirst'), ll = q.find(c => c.type === 'limitToLast');
  if (lf) keys = keys.slice(0, lf.n);
  if (ll) keys = keys.slice(-ll.n);
  const o = {}; keys.forEach(k => { o[k] = value[k]; });
  return Object.keys(o).length ? o : null;
}

export const Q = {
  query: (r, ...c) => ({ ...r, q: [...(r.q || []), ...c] }),
  orderByChild: (child) => ({ type: 'orderByChild', child }),
  orderByValue: () => ({ type: 'orderByValue' }),
  orderByKey: () => ({ type: 'orderByKey' }),
  limitToFirst: (n) => ({ type: 'limitToFirst', n }),
  limitToLast: (n) => ({ type: 'limitToLast', n }),
  startAt: (v, k) => ({ type: 'startAt', v, ...(k != null ? { k } : {}) }),
  endAt: (v) => ({ type: 'endAt', v }),
  equalTo: (v) => ({ type: 'equalTo', v }),
};
