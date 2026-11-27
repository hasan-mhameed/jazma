// 3.3ج-5ج: service-worker.js — معالج fetch لا يعيد "لا شيء" أبداً ولا يلمس ما ليس له
// (فحص الـconsole في ج-5ب: "Uncaught (in promise) TypeError: Failed to convert value to 'Response'" — حين تفشل الشبكة ولا نسخة
// محفوظة كان المعالج يعطي respondWith قيمة undefined، وكان يعترض طلبات Firebase وGoogle وغير GET)
// يُحمَّل الملف الحقيقي في سياق معزول بـself وcaches وfetch وهمية، وتُرسل له أحداث fetch.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { PROJECT } from './guard.mjs';
const SW_FILE = PROJECT + '/service-worker.js';   // JAZAM_DIR لفحص نسخة أخرى (الطفرات)
const ORIGIN = 'https://jazam.example';

function checker(title) {
  const r = { title, pass: 0, fail: 0, notes: [] };
  r.ok = (cond, msg) => { if (cond) r.pass++; else { r.fail++; r.notes.push('❌ ' + msg); } };
  return r;
}

// بيئة service worker وهمية: net = 'ok' | 'fail'، cache = خريطة url → استجابة، cacheThrows = caches.match يرفض
export function loadSW(source, { net = 'ok', cache = {}, cacheThrows = false } = {}) {
  const listeners = {};
  const ERR = { kind: 'network-error' };
  class Response { static error() { return ERR; } }
  class Request { constructor(url, init = {}) { this.url = url; this.cache = init.cache; } }
  const added = [];
  const caches = {
    match: (req) => cacheThrows ? Promise.reject(new Error('cache')) : Promise.resolve(cache[req.url]),
    open: () => Promise.resolve({ addAll: (list) => { added.push(...list); return Promise.resolve(); } }), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true),
  };
  const fetched = [];
  const fetch = (req) => { fetched.push(req.url); return net === 'ok' ? Promise.resolve({ kind: 'net', url: req.url }) : Promise.reject(new TypeError('Failed to fetch')); };
  const self = { location: { origin: ORIGIN }, addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting() {}, clients: { claim() {} } };
  vm.runInNewContext(source, { self, caches, fetch, Response, Request, URL, Promise, console });
  // حدث fetch: { responded, value | rejected } — respondWith بوعد يرفض أو يعطي undefined هو الخلل نفسه
  const dispatch = async (url, method = 'GET') => {
    let p = null;
    listeners.fetch({ request: { url, method }, respondWith: (x) => { p = Promise.resolve(x); } });
    if (!p) return { responded: false, fetched };
    try { return { responded: true, value: await p, fetched }; } catch (e) { return { responded: true, rejected: e, fetched }; }
  };
  // التثبيت: ما يُحفظ وكيف يُطلب
  const install = async () => { if (!listeners.install) return added; let p = null; listeners.install({ waitUntil: (x) => { p = x; } }); await p; return added; };
  return { dispatch, install, ERR, fetched };
}

export async function swFetchHandler(source = readFileSync(SW_FILE, 'utf8')) {
  const r = checker('3.3ج-5ج: service worker — لا "Failed to convert value to Response": فشل الشبكة بلا نسخة = خطأ شبكة عادي، وطلبات Firebase وGoogle وغير GET لا تُلمس');
  const valid = (res) => res.responded && !res.rejected && res.value !== undefined && res.value !== null;
  {
    const sw = loadSW(source, { net: 'fail' });
    const js = await sw.dispatch(ORIGIN + '/jazma/js/firebase.js?v=1');
    r.ok(valid(js) && js.value === sw.ERR, 'ملف JS والشبكة مقطوعة ولا نسخة محفوظة → خطأ شبكة (لا undefined ولا رفض)');
    const css = await sw.dispatch(ORIGIN + '/jazma/css/new.css');
    r.ok(valid(css) && css.value === sw.ERR, 'ملف غير محفوظ والشبكة مقطوعة → خطأ شبكة (لا رفض)');
  }
  {
    const sw = loadSW(source, { net: 'fail', cache: { [ORIGIN + '/jazma/js/a.js']: { kind: 'cached' }, [ORIGIN + '/jazma/index.html']: { kind: 'cached' } } });
    r.ok((await sw.dispatch(ORIGIN + '/jazma/js/a.js')).value?.kind === 'cached', 'JS والشبكة مقطوعة → النسخة المحفوظة');
    r.ok((await sw.dispatch(ORIGIN + '/jazma/index.html')).value?.kind === 'cached', 'الصفحة → من المحفوظ أولاً');
  }
  {
    const sw = loadSW(source, { net: 'ok', cache: { [ORIGIN + '/jazma/js/a.js']: { kind: 'cached' } } });
    r.ok((await sw.dispatch(ORIGIN + '/jazma/js/a.js')).value?.kind === 'net', 'JS والشبكة سليمة → من الشبكة (لا نسخة قديمة)');
    r.ok((await sw.dispatch(ORIGIN + '/jazma/manifest.json')).value?.kind === 'net', 'manifest.json → من الشبكة (كما كان)');
    r.ok((await sw.dispatch(ORIGIN + '/jazma/css/new.css')).value?.kind === 'net', 'غير محفوظ والشبكة سليمة → من الشبكة');
  }
  {
    const sw = loadSW(source, { net: 'ok', cacheThrows: true });
    const res = await sw.dispatch(ORIGIN + '/jazma/css/style.css');
    r.ok(valid(res) && res.value.kind === 'net', 'الذاكرة نفسها تفشل → من الشبكة (لا رفض)');
    const js = await loadSW(source, { net: 'fail', cacheThrows: true }).dispatch(ORIGIN + '/jazma/js/a.js');
    r.ok(valid(js), 'JS والشبكة والذاكرة كلها تفشل → خطأ شبكة (لا رفض)');
  }
  {
    const sw = loadSW(source, { net: 'fail' });
    const outside = ['https://jazma-e17c5-default-rtdb.firebaseio.com/.lp?start=t', 'https://www.googleapis.com/identitytoolkit/v3/x',
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js', 'https://cdn.jsdelivr.net/npm/x@1/x.js', 'https://fonts.googleapis.com/css2?family=x'];
    const res = await Promise.all(outside.map(u => sw.dispatch(u)));
    r.ok(res.every(x => !x.responded), 'طلبات Firebase وGoogle والخطوط والمكتبات (موقع آخر) لا تُعترض — يتولاها المتصفح مباشرة');
    const post = await sw.dispatch(ORIGIN + '/jazma/js/a.js', 'POST');
    r.ok(!post.responded, 'طلب غير GET لا يُعترض');
    r.ok(sw.fetched.length === 0, 'ولم يُرسل المعالج أياً منها بنفسه');
  }
  {
    // (مراجعة ج-5ج) التثبيت يحفظ الملفات الثابتة من الشبكة لا من ذاكرة المتصفح (index.html قديمة كانت تبقى حتى الإصدار التالي)
    const added = await loadSW(source).install();
    r.ok(added.length >= 5 && added.some(x => String(x.url || x).endsWith('/index.html')) && added.every(x => x && x.cache === 'reload'),
      'التثبيت يطلب الملفات الثابتة من الشبكة (cache: reload) — لا نسخة index.html قديمة');
  }
  return r;
}

// الفحص نفسه يكشف الخلل في المعالج القديم (v37.3) — دليل أنه يقيس الشيء الصحيح
export async function swOldHandlerFails() {
  const r = checker('3.3ج-5ج: الفحص نفسه على معالج v37.3 القديم يكشف الخلل');
  const OLD = `self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if (url.includes(".js") || url.includes("firebase") || url.includes("googleapis")) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});`;
  const res = await swFetchHandler(OLD);
  r.ok(res.fail >= 3, `المعالج القديم يجب أن يفشل (فشل ${res.fail})`);
  return r;
}

export const SW_ALL = [swFetchHandler, swOldHandlerFails];
