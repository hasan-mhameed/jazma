// بيئة عرض حقيقية لفحوص أمان النصوص (v36.0 — الخطوة 1.10)
// تحمّل index.html الحقيقي في jsdom (محلّل HTML حقيقي كالمتصفح — بلا تشغيل سكربتات الصفحة)،
// ثم تحمّل وحدات الواجهة الحقيقية من js/ داخل سياق النافذة نفسها (vm.SourceTextModule).
// الوحدات التي تكلّم Firebase أو تحتاج شبكة تُستبدل بـ"بدائل" يمرّرها الفحص (أسماء الصادرات صريحة:
// أي اسم يستورده الكود ولم يعطه البديل = خطأ واضح، لا دالة فارغة صامتة).
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as acorn from 'acorn';
import { createFirebase } from './fakeFirebase.mjs';

export const PROJECT = process.env.JAZAM_DIR || fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

// أسماء ما يستورده كل ملف من كل مصدر: { spec: Set(names) }
function importsOf(src) {
  const out = {};
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  for (const n of ast.body) {
    if (n.type !== 'ImportDeclaration' && !(n.type === 'ExportNamedDeclaration' && n.source) && n.type !== 'ExportAllDeclaration') continue;
    const spec = n.source.value;
    const set = out[spec] || (out[spec] = new Set());
    if (n.type === 'ImportDeclaration') {
      n.specifiers.forEach(s => set.add(s.type === 'ImportSpecifier' ? (s.imported.name ?? s.imported.value) : s.type === 'ImportDefaultSpecifier' ? 'default' : '*'));
    } else if (n.type === 'ExportNamedDeclaration') {
      n.specifiers.forEach(s => set.add(s.local.name ?? s.local.value));
    } else set.add('*');
  }
  return out;
}

/**
 * يجهّز نافذة بصفحة اللعبة الحقيقية ويرجع أداة تحميل وحدات.
 * stubs: { 'js/auth.js': { getCurrentUser: () => ... }, ... } — مسارات من جذر المشروع
 */
export function boot({ stubs = {}, firebase = false, polyfills = false, users = {}, cold = false, rules = null } = {}) {
  const html = fs.readFileSync(path.join(PROJECT, 'index.html'), 'utf8');
  const errors = [];
  const state = { reloads: 0 };
  const vcon = new VirtualConsole();
  vcon.on('jsdomError', e => {
    const m = String((e && e.message) || e);
    if (/Not implemented: navigation/.test(m)) { state.reloads++; return; }   // location.reload() — نعدّها (v36.0 — 1.11)
    errors.push(m);
  });
  vcon.on('error', (...a) => errors.push(a.map(String).join(' ')));
  // أخطاء المستمعين غير المتزامنة (async click…) لا تمرّ بـ jsdom: رفض بلا معالج → خطأ في هذا الفحص (مراجعة v36.0 الثانية)
  const onRejection = (reason) => errors.push('unhandled rejection: ' + String((reason && reason.stack) || reason).split('\n').slice(0, 2).join(' | '));
  const onException = (err) => errors.push('uncaught: ' + String((err && err.stack) || err).split('\n').slice(0, 2).join(' | '));
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  const dom = new JSDOM(html, { url: 'https://hasan-mhameed.github.io/jazma/', runScripts: 'outside-only',
    pretendToBeVisual: true, virtualConsole: vcon });
  const win = dom.window;
  // لا تنبيهات حقيقية (alert/confirm) — تُسجَّل فقط
  win.alert = (m) => errors.push('alert: ' + m);
  win.confirm = () => false;
  if (polyfills) addPolyfills(win);
  // Firebase وهمي (app/auth/database) بدل وحدات gstatic — لتشغيل الكود الحقيقي كله فوقه
  const fb = firebase ? createFirebase({ win, users, cold, rules }) : null;
  const urlStubs = fb ? fb.modules : {};
  const ctx = dom.getInternalVMContext();
  const cache = new Map();          // مسار أو رابط → وحدة
  const meta = new Map();           // وحدة → { rel, imports }

  function stubModule(key, obj, wanted) {
    const missing = [...wanted].filter(n => n !== '*' && !(n in obj));
    if (missing.length) throw new Error(`البديل ${key} لا يعطي: ${missing.join(', ')}`);
    const names = Object.keys(obj);
    const m = new vm.SyntheticModule(names, function () { for (const k of names) this.setExport(k, obj[k]); },
      { context: ctx, identifier: 'stub:' + key });
    return m;
  }
  function realModule(rel) {
    const abs = path.join(PROJECT, rel);
    const src = fs.readFileSync(abs, 'utf8');
    const m = new vm.SourceTextModule(src, { context: ctx, identifier: rel,
      initializeImportMeta(metaObj) { metaObj.url = 'https://hasan-mhameed.github.io/jazma/' + rel + (rel === 'js/main.js' ? '?v=test' : ''); } });
    meta.set(m, { rel, imports: importsOf(src) });
    return m;
  }
  function get(key, wanted, obj) {
    if (cache.has(key)) {
      const m = cache.get(key);
      if (obj && wanted) {   // كل مستورد يجب أن يجد أسماءه في البديل
        const missing = [...wanted].filter(n => n !== '*' && !(n in obj));
        if (missing.length) throw new Error(`البديل ${key} لا يعطي: ${missing.join(', ')}`);
      }
      return m;
    }
    const m = obj ? stubModule(key, obj, wanted || new Set()) : realModule(key);
    cache.set(key, m);
    return m;
  }
  async function linker(spec, referencing) {
    const info = meta.get(referencing);
    const wanted = info?.imports?.[spec] || new Set();
    if (/^https?:/.test(spec)) {
      if (urlStubs[spec]) return get(spec, wanted, urlStubs[spec]);
      throw new Error(`${info?.rel} يستورد ${spec.split('/').pop()} مباشرة — أعطِ بديلاً لـ ${info?.rel} نفسه أو لمن يستورده`);
    }
    const from = path.posix.dirname(info.rel);
    const rel = path.posix.normalize(path.posix.join(from, spec.split('?')[0]));
    return get(rel, wanted, stubs[rel]);
  }
  async function importReal(rel) {
    const m = get(rel, null, stubs[rel]);
    if (m.status === 'unlinked') await m.link(linker);
    if (m.status === 'linked') await m.evaluate();
    return m.namespace;
  }
  const settle = async (ms = 0, n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => win.setTimeout(r, ms)); };
  const loaded = () => new Promise(r => (win.document.readyState === 'complete' ? r() : win.addEventListener('load', () => r(), { once: true })));
  const close = () => {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
    win.close();
  };
  return { dom, win, doc: win.document, import: importReal, errors, settle, loaded, fb, state,
    get reloads() { return state.reloads; }, close };
}

// ما ينقص jsdom لتشغيل اللعبة كاملة (رسم، صوت، استعلامات وسائط) — بدائل لا تفعل شيئاً
function addPolyfills(win) {
  const noop = () => {};
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'measureText' ? () => ({ width: 0 }) : noop)), set: (t, k, v) => { t[k] = v; return true; } });
  win.HTMLCanvasElement.prototype.getContext = function () { return ctx2d; };
  win.HTMLCanvasElement.prototype.toDataURL = () => '';
  win.matchMedia = win.matchMedia || (() => ({ matches: false, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop }));
  class FakeAudioContext { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createOscillator() { return new Proxy({ frequency: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop, linearRampToValueAtTime: noop } }, { get: (t, k) => (k in t ? t[k] : noop) }); }
    createGain() { return { gain: { value: 1, setValueAtTime: noop, exponentialRampToValueAtTime: noop, linearRampToValueAtTime: noop }, connect: noop, disconnect: noop }; }
    resume() { return Promise.resolve(); } close() { return Promise.resolve(); } }
  win.AudioContext = win.AudioContext || FakeAudioContext;
  win.webkitAudioContext = win.webkitAudioContext || FakeAudioContext;
  win.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  win.HTMLMediaElement.prototype.pause = noop;
  win.HTMLMediaElement.prototype.load = noop;
  win.ResizeObserver = win.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
  win.scrollTo = noop;
  win.Element.prototype.scrollIntoView = win.Element.prototype.scrollIntoView || noop;
  win.Element.prototype.scrollTo = win.Element.prototype.scrollTo || noop;
  if (!win.navigator.vibrate) win.navigator.vibrate = () => false;
}
