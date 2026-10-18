// فحص ثابت لأمان النصوص (v36.0 — الخطوة 1.10، مع سدّ ثغرات مراجعتها الأولى)
// يقرأ كل ملفات js/ (محلّل JavaScript حقيقي: acorn) ويمنع أي قيمة غير آمنة تصل إلى:
//   HTML  : قالب نصّي فيه وسوم · جمع نصوص (+) فيه وسوم · innerHTML/outerHTML/srcdoc بأي صيغة (el.x، el["x"]،
//           كائن حرفي كـ Object.assign) · insertAdjacentHTML · document.write(ln) · setHTMLUnsafe ·
//           createContextualFragment · parseFromString · setAttribute("srcdoc")
//   رابط  : .src/.href/.action/.formAction/.srcset/.poster · setAttribute لسمات الروابط · التنقّل (location = …،
//           location.assign/replace، window.open) · Reflect.set/Object.defineProperty لهذه الخصائص
//   CSS   : style.cssText · setAttribute("style")
//   شيفرة : setAttribute("on…") بقيمة متغيّرة · eval · new Function · setTimeout/setInterval بنص · document.write كقيمة
//
// "آمن" في HTML: esc(...) المستورَدة من safeText.js | getPowerIcon(...) المستورَدة من powerIcons.js (SVG ثابت من
//   جدولها أو احتياط مُهرَّب) | نص ثابت | قالب كل ${} فيه آمن | (?:) و||/&&/?? و+ أطرافها آمنة | أرقام (حساب، مقارنة،
//   Math.*/Number/parseInt) | X.map(fn).join(sep) وArray.from(x, fn).join(sep) وما يُرجعه fn وsep آمنان
//   | متغيّر محلي كل ما يُسند إليه (= و+=) آمن | دالة محلية كل ما تُرجعه آمن
//   | معامل دالة محلية مسمّاة: يُفحص ما يُمرَّر له في **كل** استدعاء لها في الملف — والدالة لا تُصدَّر ولا تُمرَّر كقيمة.
// "آمن" في رابط: نص ثابت ليس javascript:/data:/vbscript: | safeImageSrc(...) المستورَدة من safeText.js | متغيّر أو معامل كذلك.
// "آمن" في CSS : نص ثابت | قالب كل ${} فيه آمن لـCSS | أرقام | متغيّر أو معامل كذلك  (esc لا تكفي داخل CSS).
// الأسماء تُحلّ بنطاقاتها: esc محلية أو معامل اسمه esc لا يُقبل — فقط المستورَدة من safeText.js.
// لا قائمة "موثوق" بالنص: كل نص يمرّ بـ esc عند موضع إدراجه، وHTML الثابت الوحيد (أيقونات SVG) يأتي من getPowerIcon.
// التحليل محافظ: الاسم الواحد في نطاقه متغيّر واحد (كل ما يُسند إليه في أي مكان يجب أن يكون آمناً).
// خارج قدرته (موثّق): خاصية محسوبة باسم متغيّر (el[x] = …)، خصائص CSS تقبل روابط مباشرة (style.backgroundImage = …)،
// وsetTimeout بمتغيّر نصّي، والأسماء المستعارة للكائنات العامة (const w = window; w.open(…)) — لا يستعملها الكود
// بقيم متغيّرة اليوم (مراجعات v36.0 الثانية والثالثة والرابعة).
//
// التشغيل وحده: node guard.mjs   (ويُشغَّل أيضاً من run.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

export const PROJECT = process.env.JAZAM_DIR || fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

// دوال مستورَدة تُنتج قيمة آمنة لسياق معيّن — بالاسم المستورَد ومصدره معاً (لا بالاسم المحلي وحده)
const SAFE_IMPORTS = {
  esc:          { from: /(^|\/)safeText\.js(\?|$)/,   kind: 'html' },   // تهريب الرموز الخمسة
  getPowerIcon: { from: /(^|\/)powerIcons\.js(\?|$)/, kind: 'html' },   // SVG ثابت أو احتياط مُهرَّب
  safeImageSrc: { from: /(^|\/)safeText\.js(\?|$)/,   kind: 'url'  },   // رابط صورة مسموح أو ""
};
const NUMERIC_GLOBALS = new Set(['Number', 'parseInt', 'parseFloat']);
const BAD_SCHEME = /^\s*(javascript|data|vbscript)\s*:/i;
const HTML_PROPS = new Set(['innerHTML', 'outerHTML', 'srcdoc']);
const URL_PROPS  = new Set(['src', 'href', 'action', 'formAction', 'srcset', 'poster']);
const URL_ATTRS  = new Set(['src', 'href', 'action', 'formaction', 'xlink:href', 'poster', 'srcset', 'data', 'background', 'ping', 'codebase', 'cite']);
const KIND_AR = { html: 'HTML', url: 'رابط', css: 'CSS', code: 'شيفرة' };

const HTML_RE = /<\s*\/?\s*[a-zA-Z!]/;     // يشبه وسم HTML
const looksHtml = s => typeof s === 'string' && HTML_RE.test(s);
const tplHtml = t => t.type === 'TemplateLiteral' && t.quasis.some(q => looksHtml(q.value.cooked ?? q.value.raw));
const isFn = n => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration');

function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// أسماء يربطها نمط (معامل، تفكيك...)
function bindNames(p, out = []) {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier': out.push(p.name); break;
    case 'ObjectPattern': p.properties.forEach(q => bindNames(q.type === 'RestElement' ? q.argument : q.value, out)); break;
    case 'ArrayPattern': p.elements.forEach(e => bindNames(e, out)); break;
    case 'AssignmentPattern': bindNames(p.left, out); break;
    case 'RestElement': bindNames(p.argument, out); break;
  }
  return out;
}

// تعابير return في جسم دالة (دون الدوال المتداخلة فيه)
function returnsOf(fn) {
  if (fn.body.type !== 'BlockStatement') return [fn.body];
  const out = [];
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n !== fn.body && isFn(n)) return;
    if (n.type === 'ReturnStatement') { out.push(n.argument); return; }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(x => x && typeof x.type === 'string' && visit(x));
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  visit(fn.body);
  return out.filter(Boolean);
}

// اسم خاصية عضو: el.x أو el["x"] (اسم متغيّر محسوب = غير معروف → null)
const propName = (m) => !m.computed
  ? (m.property.type === 'Identifier' ? m.property.name : null)
  : (m.property.type === 'Literal' ? String(m.property.value) : (m.property.type === 'TemplateLiteral' && !m.property.expressions.length ? m.property.quasis[0].value.cooked : null));
const keyName = (p) => !p.computed
  ? (p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : null)
  : (p.key.type === 'Literal' ? String(p.key.value) : null);

export function scanSource(rel, src) {
  const findings = new Map();          // موضع العقدة → البلاغ (بلاغ واحد لكل عقدة)
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); }
  catch (e) { return { findings: [`${rel}: تعذّر التحليل — ${e.message}`] }; }
  const text = n => src.slice(n.start, n.end);
  const where = n => `${rel}:${n.loc.start.line}`;
  const report = (n, why) => { if (!findings.has(n.start)) findings.set(n.start, `${where(n)}  ${why}: ${text(n).replace(/\s+/g, ' ').slice(0, 160)}`); };

  // ── الآباء ومواضع الأسماء (إشارة "Identifier" = قراءة؛ "VariablePattern" = إعلان أو هدف إسناد) ──
  const parent = new WeakMap();
  const refIds = [];
  walk.fullAncestor(ast, (n, _s, anc, type) => {
    if (anc.length > 1) parent.set(n, anc[anc.length - 2]);
    if (n.type === 'Identifier' && type === 'Identifier') refIds.push(n);
  });

  // ── النطاقات: كل اسم يُربط بإعلانه الأقرب (const/let للكتلة، var والمعاملات للدالة) ──
  const isScope = n => n.type === 'Program' || n.type === 'BlockStatement' || isFn(n) || n.type === 'CatchClause'
    || n.type === 'ForStatement' || n.type === 'ForInStatement' || n.type === 'ForOfStatement' || n.type === 'SwitchStatement'
    || n.type === 'StaticBlock' || n.type === 'ClassBody';
  const decls = new Map();    // عقدة النطاق → Map(اسم → إعلان)
  const allDecls = [];
  const declare = (scope, name, info = {}) => {
    if (!decls.has(scope)) decls.set(scope, new Map());
    const m = decls.get(scope);
    if (!m.has(name)) { const d = { name, opaque: false, writes: [], fn: null, param: null, import: null, multi: 0 }; m.set(name, d); allDecls.push(d); }
    const d = m.get(name);
    d.multi++;
    if (info.opaque) d.opaque = true;
    if (info.write) d.writes.push(info.write);
    if (info.fn) d.fn = info.fn;
    if (info.param) d.param = info.param;
    if (info.import) d.import = info.import;
    return d;
  };
  const up = (n, pred) => { for (let p = parent.get(n); p; p = parent.get(p)) if (pred(p)) return p; return null; };
  const blockScope = n => up(n, isScope);
  const fnScope = n => up(n, p => isFn(p) || p.type === 'Program');
  const declParams = (fn) => fn.params.forEach((p, i) => {
    if (p.type === 'Identifier') declare(fn, p.name, { opaque: true, param: { fn, index: i } });
    else bindNames(p).forEach(x => declare(fn, x, { opaque: true }));
  });
  walk.fullAncestor(ast, (n, _s, anc) => {
    switch (n.type) {
      case 'VariableDeclarator': {
        const decl = anc[anc.length - 2], loop = anc[anc.length - 3];
        const scope = decl.kind === 'var' ? fnScope(decl) : blockScope(decl);
        const loopHead = loop && (loop.type === 'ForOfStatement' || loop.type === 'ForInStatement') && loop.left === decl;
        if (n.id.type === 'Identifier' && !loopHead) {
          declare(scope, n.id.name, n.init ? { write: n.init, fn: isFn(n.init) ? n.init : null } : {});
        } else bindNames(n.id).forEach(x => declare(scope, x, { opaque: true }));
        break;
      }
      case 'FunctionDeclaration':
        if (n.id) declare(blockScope(n), n.id.name, { write: n, fn: n });
        declParams(n);
        break;
      case 'FunctionExpression':
        if (n.id) declare(n, n.id.name, { opaque: true });      // اسم دالة التعبير داخلها
        declParams(n);
        break;
      case 'ArrowFunctionExpression': declParams(n); break;
      case 'CatchClause': if (n.param) bindNames(n.param).forEach(x => declare(n, x, { opaque: true })); break;
      case 'ImportDeclaration':
        n.specifiers.forEach(sp => declare(ast, sp.local.name, { opaque: true, import: {
          source: String(n.source.value),
          imported: sp.type === 'ImportSpecifier' ? (sp.imported.name ?? sp.imported.value) : sp.type === 'ImportDefaultSpecifier' ? 'default' : '*',
        } }));
        break;
      case 'ClassDeclaration': if (n.id) declare(blockScope(n), n.id.name, { opaque: true }); break;
    }
  });
  const resolve = (idNode) => {
    for (let p = parent.get(idNode); p; p = parent.get(p)) {
      const m = decls.get(p);
      if (m && m.has(idNode.name)) return m.get(idNode.name);
    }
    return null;
  };
  // الإسنادات: = و += تُضاف لما يُسند إلى الاسم، وغيرها (-= ...) وأنماط التفكيك = غير معروف
  walk.full(ast, (n) => {
    if (n.type === 'AssignmentExpression') {
      if (n.left.type === 'Identifier') {
        const d = resolve(n.left);
        if (!d) return;
        if (n.operator === '=' || n.operator === '+=') d.writes.push(n.right); else d.opaque = true;
      } else if (n.left.type !== 'MemberExpression') {
        walk.full(n.left, (x) => { if (x.type === 'Identifier') { const d = resolve(x); if (d) d.opaque = true; } });
      }
    }
    if (n.type === 'UpdateExpression' && n.argument.type === 'Identifier') { const d = resolve(n.argument); if (d) d.opaque = true; }
    if ((n.type === 'ForOfStatement' || n.type === 'ForInStatement') && n.left.type !== 'VariableDeclaration') {
      walk.full(n.left, (x) => { if (x.type === 'Identifier') { const d = resolve(x); if (d) d.opaque = true; } });
    }
  });

  // ── القراءات لكل إعلان، والمُصدَّر منها ──
  const refs = new Map();
  for (const id of refIds) { const d = resolve(id); if (d) { if (!refs.has(d)) refs.set(d, []); refs.get(d).push(id); } }
  const exported = new Set();
  const topDecl = name => decls.get(ast)?.get(name) || null;
  for (const st of ast.body) {
    if (st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration') {
      const dcl = st.declaration;
      if (dcl?.type === 'FunctionDeclaration' && dcl.id) exported.add(topDecl(dcl.id.name));
      if (dcl?.type === 'VariableDeclaration') dcl.declarations.forEach(v => bindNames(v.id).forEach(x => exported.add(topDecl(x))));
      if (dcl?.type === 'Identifier') exported.add(topDecl(dcl.name));
      (st.specifiers || []).forEach(sp => { if (!st.source) exported.add(topDecl(sp.local.name ?? sp.local.value)); });
    }
  }

  // ── هل التعبير آمن لسياقه؟ (يُرجع العقد غير الآمنة؛ معاملات الدوال تُؤجَّل لفحص من يستدعيها) ──
  const visiting = new Set();
  const paramNeeds = new Map();     // `${index}:${kind}` لكل دالة → موضع أول استعمال
  const queue = [];
  const needParam = (d, kind, at) => {
    const key = d.param.fn.start + ':' + d.param.index + ':' + kind;
    if (paramNeeds.has(key)) return;
    paramNeeds.set(key, true);
    queue.push({ d, kind, at });
  };
  const isGlobal = (id, name) => id.type === 'Identifier' && id.name === name && !resolve(id);
  const safeImport = (callee, kind) => {
    if (callee.type !== 'Identifier') return false;
    const d = resolve(callee);
    const si = d && d.import && !d.writes.length && SAFE_IMPORTS[d.import.imported];
    return !!(si && si.kind === kind && si.from.test(d.import.source));
  };
  const numericCall = (c) =>
    (c.type === 'Identifier' && NUMERIC_GLOBALS.has(c.name) && !resolve(c))
    || (c.type === 'MemberExpression' && !c.computed && isGlobal(c.object, 'Math'));

  function unsafe(n, kind, bad = []) {
    if (!n) return bad;
    switch (n.type) {
      case 'Literal':
        if (kind === 'url' && typeof n.value === 'string' && BAD_SCHEME.test(n.value)) bad.push(n);
        return bad;
      case 'TemplateLiteral':
        if (kind === 'url') {     // رابط من قالب: ثابت بالكامل فقط
          if (n.expressions.length || BAD_SCHEME.test(n.quasis[0].value.cooked ?? '')) bad.push(n);
          return bad;
        }
        n.expressions.forEach(e => unsafe(e, kind, bad)); return bad;
      case 'ConditionalExpression': unsafe(n.consequent, kind, bad); unsafe(n.alternate, kind, bad); return bad;
      case 'LogicalExpression': unsafe(n.left, kind, bad); unsafe(n.right, kind, bad); return bad;
      case 'SequenceExpression': unsafe(n.expressions[n.expressions.length - 1], kind, bad); return bad;
      case 'BinaryExpression':
        if (n.operator === '+') {
          if (kind === 'url') { bad.push(n); return bad; }
          unsafe(n.left, kind, bad); unsafe(n.right, kind, bad); return bad;
        }
        if (kind !== 'url') return bad;          // حساب أو مقارنة → رقم أو منطقي
        break;
      case 'UnaryExpression': case 'UpdateExpression':
        if (kind !== 'url') return bad;          // -x +x !x ~x typeof void x++ → رقم/منطقي/نوع
        break;
      case 'Identifier': {
        if (n.name === 'undefined' && !resolve(n)) return bad;
        const d = resolve(n);
        if (d && d.param && !d.writes.length && d.multi === 1) { needParam(d, kind, n); return bad; }
        if (!d || d.opaque || d.fn) break;
        if (visiting.has(d)) return bad;                          // إسناد ذاتي (html += ...): يُفحص الباقي
        visiting.add(d);
        const inner = [];
        d.writes.forEach(w => unsafe(w, kind, inner));
        visiting.delete(d);
        if (!inner.length) return bad;
        bad.push(n);                                              // نبلّغ عن موضع الاستعمال...
        inner.forEach(x => bad.push(x));                          // ...وعن مصدره غير الآمن
        return bad;
      }
      case 'CallExpression': {
        const c = n.callee;
        if (safeImport(c, kind)) return bad;
        if (kind !== 'url' && numericCall(c)) return bad;
        // X.map(fn).join(sep)  |  Array.from(x, fn).join(sep)
        if (kind !== 'url' && c.type === 'MemberExpression' && propName(c) === 'join' && c.object.type === 'CallExpression') {
          const inner = c.object, ic = inner.callee;
          let fn = null;
          if (ic.type === 'MemberExpression' && propName(ic) === 'map') fn = inner.arguments[0];
          if (ic.type === 'MemberExpression' && propName(ic) === 'from' && isGlobal(ic.object, 'Array')) fn = inner.arguments[1];
          if (isFn(fn)) {
            returnsOf(fn).forEach(r => unsafe(r, kind, bad));
            n.arguments.forEach(a => unsafe(a, kind, bad));      // الفاصل نفسه
            return bad;
          }
        }
        // دالة معرّفة في الملف نفسه (ولا يُسند إلى اسمها شيء آخر): كل ما تُرجعه آمن
        if (c.type === 'Identifier') {
          const d = resolve(c);
          if (d && d.fn && !d.opaque && d.writes.length === 1) {
            if (visiting.has(d)) return bad;
            visiting.add(d);
            const inner = [];
            returnsOf(d.fn).forEach(r => unsafe(r, kind, inner));
            visiting.delete(d);
            if (!inner.length) return bad;
            bad.push(n); inner.forEach(x => bad.push(x));
            return bad;
          }
        }
        break;
      }
    }
    bad.push(n);
    return bad;
  }
  const sink = (n, kind, why) => unsafe(n, kind).forEach(b => report(b, why || `قيمة غير آمنة تصل إلى ${KIND_AR[kind]}`));

  walk.full(ast, (n) => {
    // (1) قالب فيه وسوم HTML
    if (tplHtml(n)) n.expressions.forEach(e => sink(e, 'html', 'قيمة غير مُهرَّبة داخل قالب HTML'));
    // (2) جمع نصوص فيه وسوم HTML
    if (n.type === 'BinaryExpression' && n.operator === '+' && !(parent.get(n)?.type === 'BinaryExpression' && parent.get(n).operator === '+')) {
      const leaves = [];
      const flat = x => { if (x.type === 'BinaryExpression' && x.operator === '+') { flat(x.left); flat(x.right); } else leaves.push(x); };
      flat(n);
      if (leaves.some(l => (l.type === 'Literal' && looksHtml(l.value)) || tplHtml(l))) {
        leaves.forEach(l => sink(l, 'html', 'قيمة غير مُهرَّبة داخل HTML مجموع'));
      }
    }
    // (3) الإسناد إلى خصائص: innerHTML/outerHTML/srcdoc، الروابط، style.cssText
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression') {
      const p = propName(n.left);
      if (HTML_PROPS.has(p)) sink(n.right, 'html', `قيمة غير مُهرَّبة تُسند إلى ${p}`);
      else if (URL_PROPS.has(p)) sink(n.right, 'url', `رابط غير مضمون يُسند إلى ${p}`);
      else if (p === 'cssText') sink(n.right, 'css', 'قيمة غير مضمونة تُسند إلى style.cssText');
    }
    // (4) كائن حرفي فيه innerHTML/outerHTML/srcdoc (مثل Object.assign(el, {...}))
    if (n.type === 'ObjectExpression') {
      n.properties.forEach(pr => {
        if (pr.type !== 'Property') return;
        const k = keyName(pr);
        if (HTML_PROPS.has(k)) sink(pr.value, 'html', `قيمة غير مُهرَّبة في ${k} داخل كائن`);
      });
    }
    // (5) الاستدعاءات
    if (n.type === 'CallExpression' || n.type === 'NewExpression') {
      const c = n.callee, a = n.arguments;
      if (n.type === 'NewExpression' && isGlobal(c, 'Function')) report(n, 'new Function: شيفرة من نص');
      if (n.type === 'CallExpression' && isGlobal(c, 'Function')) report(n, 'Function(): شيفرة من نص');
      if (n.type === 'CallExpression' && isGlobal(c, 'eval')) report(n, 'eval: شيفرة من نص');
      const timerName = c.type === 'Identifier' && !resolve(c) ? c.name
        : (c.type === 'MemberExpression' && (isGlobal(c.object, 'window') || isGlobal(c.object, 'globalThis') || isGlobal(c.object, 'self')) ? propName(c) : null);
      if ((timerName === 'setTimeout' || timerName === 'setInterval') && a[0]
          && (a[0].type === 'Literal' || a[0].type === 'TemplateLiteral' || a[0].type === 'BinaryExpression')) report(a[0], `${timerName} بنص: شيفرة من نص`);
      if (c.type === 'MemberExpression') {
        const m = propName(c);
        if (m === 'insertAdjacentHTML' && a[1]) sink(a[1], 'html', 'قيمة غير مُهرَّبة تُمرَّر إلى insertAdjacentHTML');
        if ((m === 'write' || m === 'writeln') && isGlobal(c.object, 'document')) a.forEach(x => sink(x, 'html', 'قيمة غير مُهرَّبة تُمرَّر إلى document.write'));
        if ((m === 'setHTMLUnsafe' || m === 'createContextualFragment' || m === 'parseFromString') && a[0]) sink(a[0], 'html', `قيمة غير مُهرَّبة تُمرَّر إلى ${m}`);
        if (m === 'setAttribute' || m === 'setAttributeNS') {
          const nameArg = m === 'setAttribute' ? a[0] : a[1], val = m === 'setAttribute' ? a[1] : a[2];
          const nm = nameArg && nameArg.type === 'Literal' && typeof nameArg.value === 'string' ? nameArg.value.toLowerCase()
            : (nameArg && nameArg.type === 'TemplateLiteral' && !nameArg.expressions.length ? nameArg.quasis[0].value.cooked.toLowerCase() : null);
          if (nm === null) { if (val && val.type !== 'Literal') report(nameArg || n, 'setAttribute باسم سمة متغيّر وقيمة متغيّرة'); }
          else if (nm.startsWith('on')) { if (val && val.type !== 'Literal') report(val, `setAttribute("${nm}") بقيمة متغيّرة: شيفرة`); }
          else if (nm === 'style') sink(val, 'css', 'قيمة غير مضمونة في setAttribute("style")');
          else if (nm === 'srcdoc') sink(val, 'html', 'قيمة غير مُهرَّبة في setAttribute("srcdoc")');
          else if (URL_ATTRS.has(nm)) sink(val, 'url', `رابط غير مضمون في setAttribute("${nm}")`);
        }
      }
    }
    // (5ب) التنقّل إلى رابط: location = x · location.assign/replace(x) · window.open(x) — javascript: يشغّل شيفرة
    const WINS = ['window', 'document', 'self', 'globalThis', 'top', 'parent', 'opener', 'frames'];
    // جذر سلسلة أعضاء (window.frames[0].top → window)
    const rootOf = (x) => { while (x && x.type === 'MemberExpression') x = x.object; return x; };
    const isLoc = (x) => (x.type === 'Identifier' && x.name === 'location' && !resolve(x))
      || (x.type === 'MemberExpression' && propName(x) === 'location'
          && WINS.some(g => isGlobal(rootOf(x.object), g)));   // window.location، top.location، window.frames[0].location
    if (n.type === 'AssignmentExpression' && isLoc(n.left)) sink(n.right, 'url', 'رابط غير مضمون يُسند إلى location');
    if (n.type === 'CallExpression') {
      const c = n.callee, a = n.arguments;
      if (c.type === 'MemberExpression' && (propName(c) === 'assign' || propName(c) === 'replace') && isLoc(c.object) && a[0])
        sink(a[0], 'url', `رابط غير مضمون يُمرَّر إلى location.${propName(c)}`);
      if (a[0] && (isGlobal(c, 'open') || (c.type === 'MemberExpression' && propName(c) === 'open'
          && WINS.some(g => isGlobal(c.object, g))))) sink(a[0], 'url', 'رابط غير مضمون يُمرَّر إلى window.open');
      // Object.assign(el, { innerHTML | src | href | cssText … }) — كل كائن مصدر
      if (c.type === 'MemberExpression' && isGlobal(c.object, 'Object') && propName(c) === 'assign') {
        a.slice(1).forEach(src => src && src.type === 'ObjectExpression' && src.properties.forEach(pr => {
          if (pr.type !== 'Property') return;
          const k = keyName(pr);
          if (URL_PROPS.has(k)) sink(pr.value, 'url', `رابط غير مضمون في ${k} عبر Object.assign`);
          else if (k === 'cssText') sink(pr.value, 'css', 'قيمة غير مضمونة في cssText عبر Object.assign');
        }));
      }
      // Reflect.set(el, "innerHTML", v) · Object.defineProperty(el, "innerHTML", { value: v })
      const lit = x => x && x.type === 'Literal' && typeof x.value === 'string' ? x.value : null;
      if (c.type === 'MemberExpression' && isGlobal(c.object, 'Reflect') && propName(c) === 'set') {
        const k = lit(a[1]);
        if (HTML_PROPS.has(k)) sink(a[2], 'html', `قيمة غير مُهرَّبة تُسند إلى ${k} عبر Reflect.set`);
        else if (URL_PROPS.has(k)) sink(a[2], 'url', `رابط غير مضمون يُسند إلى ${k} عبر Reflect.set`);
        else if (k === 'cssText') sink(a[2], 'css', 'قيمة غير مضمونة تُسند إلى cssText عبر Reflect.set');
        else if (k === null && a[1]) report(a[1], 'Reflect.set باسم خاصية متغيّر');
      }
      // Object.defineProperties(el, { innerHTML: { value | get() }, src: … })
      if (c.type === 'MemberExpression' && isGlobal(c.object, 'Object') && propName(c) === 'defineProperties' && a[1]) {
        if (a[1].type !== 'ObjectExpression') report(a[1], 'defineProperties بأوصاف غير حرفية');
        else a[1].properties.forEach(pr => {
          if (pr.type !== 'Property') { report(pr, 'defineProperties بنشر'); return; }
          const k = keyName(pr);
          const kind = HTML_PROPS.has(k) ? 'html' : URL_PROPS.has(k) ? 'url' : k === 'cssText' ? 'css' : null;
          if (!kind) return;
          if (pr.value.type !== 'ObjectExpression') { report(pr.value, `defineProperties لـ ${k} بوصف غير حرفي`); return; }
          for (const d of pr.value.properties) {
            if (d.type !== 'Property') continue;
            if (keyName(d) === 'value') sink(d.value, kind, `قيمة غير آمنة تُسند إلى ${k} عبر defineProperties`);
            if (keyName(d) === 'get' && isFn(d.value)) returnsOf(d.value).forEach(rv => sink(rv, kind, `قيمة غير آمنة يُرجعها get لـ ${k} عبر defineProperties`));
          }
        });
      }
      // Object.defineProperty / Reflect.defineProperty(el, "innerHTML", { value | get() })
      if (c.type === 'MemberExpression' && (isGlobal(c.object, 'Object') || isGlobal(c.object, 'Reflect')) && propName(c) === 'defineProperty') {
        const k = lit(a[1]);
        const kind = HTML_PROPS.has(k) ? 'html' : URL_PROPS.has(k) ? 'url' : k === 'cssText' ? 'css' : null;
        if (kind && a[2] && a[2].type === 'ObjectExpression') {
          for (const pr of a[2].properties) {
            if (pr.type !== 'Property') continue;
            const pk = keyName(pr);
            if (pk === 'value') sink(pr.value, kind, `قيمة غير آمنة تُسند إلى ${k} عبر defineProperty`);
            if (pk === 'get' && isFn(pr.value)) returnsOf(pr.value).forEach(rv => sink(rv, kind, `قيمة غير آمنة يُرجعها get لـ ${k} عبر defineProperty`));
          }
        } else if (kind && a[2]) report(a[2], `defineProperty لـ ${k} بوصف غير حرفي`);
      }
    }
    // (6) document.write كقيمة (اسم مستعار يُستدعى لاحقاً)
    if (n.type === 'MemberExpression' && isGlobal(n.object, 'document') && (propName(n) === 'write' || propName(n) === 'writeln')) {
      const p = parent.get(n);
      if (!(p && p.type === 'CallExpression' && p.callee === n)) report(n, 'document.write تُستعمل كقيمة');
    }
  });

  // ── معاملات الدوال: ما يُمرَّر لها في كل استدعاء ──
  const bindingOf = (fn) => allDecls.find(d => d.fn === fn && !d.opaque && d.writes.length === 1) || null;
  while (queue.length) {
    const { d, kind, at } = queue.shift();
    const fn = d.param.fn, index = d.param.index;
    const b = bindingOf(fn);
    if (!b) { report(at, `معامل دالة بلا اسم يصل إلى ${KIND_AR[kind]} (لا يُعرف ما يُمرَّر له)`); continue; }
    if (exported.has(b)) { report(at, `الدالة المُصدَّرة ${b.name}() تُدرج معاملها في ${KIND_AR[kind]} (يستدعيها ملف آخر)`); continue; }
    for (const r of refs.get(b) || []) {
      const p = parent.get(r);
      if (p && p.type === 'CallExpression' && p.callee === r) {
        const arg = p.arguments[index];
        if (!arg) continue;                                       // غائب = undefined
        if (p.arguments.slice(0, index + 1).some(x => x.type === 'SpreadElement')) { report(p, `استدعاء ${b.name}(...) بنشر: لا يُعرف ما يصل إلى ${KIND_AR[kind]}`); continue; }
        sink(arg, kind, `قيمة غير آمنة تُمرَّر إلى ${b.name}() فتصل إلى ${KIND_AR[kind]}`);
      } else report(r, `${b.name}() تُدرج معاملها في ${KIND_AR[kind]} وتُستعمل كقيمة (لا يُعرف من يستدعيها)`);
    }
  }

  return { findings: [...findings.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]) };
}

export function runGuard() {
  const files = listJs(path.join(PROJECT, 'js')).sort();
  const findings = [];
  for (const f of files) {
    const rel = path.relative(PROJECT, f).split(path.sep).join('/');
    findings.push(...scanSource(rel, fs.readFileSync(f, 'utf8')).findings);
  }
  return { files: files.length, findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = runGuard();
  r.findings.forEach(f => console.log('❌ ' + f));
  console.log(r.findings.length ? `\n❌ ${r.findings.length} موضع غير آمن في ${r.files} ملفاً`
                                : `\n✅ لا قيمة غير آمنة تصل إلى HTML أو رابط أو CSS أو شيفرة (${r.files} ملفاً)`);
  process.exit(r.findings.length ? 1 : 0);
}
