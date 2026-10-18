// فحص الحارس نفسه (v36.0 — مراجعة 1.10 الأولى): أنماط خطرة يجب أن يكشفها كلها، وأنماط آمنة لا يعترض عليها.
// منها ثغرات أثبتها المراجع المستقل على النسخة الأولى من الحارس (esc بالاسم فقط، "الموثوق" بالنص، معامل
// showAISuggestNow، ومصارف لم يكن يعرفها) — كلها صارت تُكشف هنا، فلا ترجع بتعديل لاحق للحارس.
import { scanSource } from './guard.mjs';

const H = `import { esc } from "./safeText.js?v=1"; import { getName } from "../x.js"; const el = document.body; const name = getName();\n`;

export const UNSAFE = {
  'el["innerHTML"] = قيمة':                  `el["innerHTML"] = name;`,
  'Object.assign(el, {innerHTML})':          `Object.assign(el, { innerHTML: name });`,
  'esc محلية تحجب المستورَدة':               `function esc(s) { return s; } el.innerHTML = \`<b>\${esc(name)}</b>\`;`,
  'معامل اسمه esc':                          `[name].forEach(esc => { el.innerHTML = \`<b>\${esc(name)}</b>\`; });`,
  'esc من ملف آخر':                          `import { esc as e2 } from "./other.js"; el.innerHTML = \`<b>\${e2(name)}</b>\`;`,
  'setAttribute("onclick", قيمة)':           `el.setAttribute("onclick", name);`,
  'setAttribute("href", قيمة)':              `el.setAttribute("href", name);`,
  'setAttribute("src", esc(قيمة))':          `el.setAttribute("src", esc(name));`,
  'setAttribute("srcdoc", قيمة)':            `el.setAttribute("srcdoc", name);`,
  'setAttribute("style", قيمة)':             `el.setAttribute("style", name);`,
  'setAttribute(اسم متغيّر, قيمة)':          `el.setAttribute(name, name);`,
  'a.href = قيمة':                           `const a = document.createElement("a"); a.href = name;`,
  'img.src = قيمة':                          `const i = document.createElement("img"); i.src = name;`,
  'img.src = "javascript:..."':             `const i = document.createElement("img"); i.src = "javascript:alert(1)";`,
  'iframe.srcdoc = قيمة':                    `const f = document.createElement("iframe"); f.srcdoc = name;`,
  'style.cssText بقالب فيه قيمة':            `el.style.cssText = \`background:url(\${name})\`;`,
  'style.cssText بقيمة مُهرَّبة (esc لا تكفي في CSS)': `el.style.cssText = \`color:\${esc(name)}\`;`,
  'document.write كاسم مستعار':              `const w = document.write.bind(document); w(name);`,
  'document.write(قيمة)':                    `document.write(name);`,
  'innerHTML += قيمة':                       `el.innerHTML += name;`,
  'push ثم join':                            `const parts = []; parts.push(name); el.innerHTML = parts.join("");`,
  'innerHTML ||= قيمة':                      `el.innerHTML ||= name;`,
  'insertAdjacentHTML(قيمة)':                `el.insertAdjacentHTML("beforeend", name);`,
  'setHTMLUnsafe(قيمة)':                     `el.setHTMLUnsafe(name);`,
  'createContextualFragment(قيمة)':          `el.appendChild(document.createRange().createContextualFragment(name));`,
  'DOMParser.parseFromString(قيمة)':         `new DOMParser().parseFromString(name, "text/html");`,
  'دالة تُدرج معاملها تُستدعى بقيمة':        `function show(msg) { el.innerHTML = msg; } show(name);`,
  'دالة تُدرج معاملها تُصدَّر':              `export function show(msg) { el.innerHTML = msg; } show("x");`,
  'دالة تُدرج معاملها تُمرَّر كقيمة':        `function show(msg) { el.innerHTML = msg; } [name].forEach(show);`,
  'دالة بلا اسم تُدرج معاملها':              `[name].forEach(msg => { el.innerHTML = msg; });`,
  'استدعاء بنشر لدالة تُدرج معاملها':         `function show(msg) { el.innerHTML = msg; } show(...[name]);`,
  'معامل يُعاد إسناده ثم يُدرج':              `function show(msg) { msg = msg + name; el.innerHTML = msg; } show("x");`,
  'قالب HTML في متغيّر يُدرج لاحقاً':          `let h = ""; h += \`<b>\${name}</b>\`; el.innerHTML = h;`,
  'map بلا join (فواصل وعناصر)':             `el.innerHTML = [name].map(n => \`<i>\${esc(n)}</i>\`);`,
  'join بفاصل من مستخدم':                    `el.innerHTML = [1].map(n => \`<i>\${esc(n)}</i>\`).join(name);`,
  'eval':                                    `eval(name);`,
  'new Function':                            `new Function(name);`,
  'setTimeout بنص':                          `setTimeout("go()", 10);`,
  'showAISuggestNow(قيمة خام) — مراجعة':      `function showAISuggestNow(msg) { const t = document.body; t.innerHTML = msg; } showAISuggestNow(\`<b>\${esc(1)}</b>\` + name);`,
  'اسم "label" من بيانات (كان موثوقاً بالنص)': `const label = name; el.innerHTML = \`<span>\${label}</span>\`;`,
  'location = قيمة':                         `location = name;`,
  'window.location = قيمة':                  `window.location = name;`,
  'location.href = قيمة':                    `location.href = name;`,
  'location.assign(قيمة)':                   `location.assign(name);`,
  'window.location.replace(قيمة)':           `window.location.replace(name);`,
  'window.open(قيمة)':                       `window.open(name);`,
  'open(قيمة)':                              `open(name, "_blank");`,
  'Reflect.set(el, "innerHTML", قيمة)':      `Reflect.set(el, "innerHTML", name);`,
  'Reflect.set(img, "src", قيمة)':           `Reflect.set(el, "src", name);`,
  'Object.defineProperty(el, "innerHTML")':  `Object.defineProperty(el, "innerHTML", { value: name });`,
  'Object.assign(img, {src: قيمة})':         `Object.assign(document.createElement("img"), { src: name });`,
  'Object.assign(a, {href: قيمة})':          `Object.assign(document.createElement("a"), { href: name });`,
  'top.location = قيمة':                     `top.location = name;`,
  'parent.location.assign(قيمة)':            `parent.location.assign(name);`,
  'opener.location = قيمة':                  `opener.location = name;`,
  'Reflect.defineProperty(el, "innerHTML")': `Reflect.defineProperty(el, "innerHTML", { value: name });`,
  'defineProperty بوصف get':                `Object.defineProperty(el, "innerHTML", { get() { return name; } });`,
  'window.frames[0].location = قيمة':        `window.frames[0].location = name;`,
  'Object.defineProperties(img, {src})':     `Object.defineProperties(el, { src: { value: name } });`,
  'Object.defineProperties بوصف get':        `Object.defineProperties(el, { innerHTML: { get: () => name } });`,
};

export const SAFE = {
  'esc المستورَدة':                          `el.innerHTML = \`<b>\${esc(name)}</b>\`;`,
  'esc بإعادة تسمية من safeText':           `import { esc as e } from "../ui/safeText.js"; el.innerHTML = \`<b>\${e(name)}</b>\`;`,
  'getPowerIcon المستورَدة':                 `import { getPowerIcon } from "./powerIcons.js"; el.innerHTML = \`<i>\${getPowerIcon(name, name)}</i>\`;`,
  'safeImageSrc إلى src':                    `import { safeImageSrc } from "./safeText.js"; const i = document.createElement("img"); i.src = safeImageSrc(name);`,
  'متغيّر من safeImageSrc إلى src':          `import { safeImageSrc } from "./safeText.js"; const p = safeImageSrc(name); const i = document.createElement("img"); if (p) i.src = p;`,
  'أرقام وحساب':                             `el.innerHTML = \`<b>\${Math.round(3.2)} \${1 + 2 * 3} \${-4}</b>\`;`,
  'map/join بقيم مُهرَّبة':                  `el.innerHTML = [name].map(n => \`<i>\${esc(n)}</i>\`).join("<br>");`,
  'دالة محلية تُرجع HTML آمناً':             `function row(n) { return \`<i>\${esc(n)}</i>\`; } el.innerHTML = row(name);`,
  'دالة تُدرج معاملها، كل مستدعيها آمن':     `function show(msg) { el.innerHTML = msg; } show(\`<b>\${esc(name)}</b>\`); show("ثابت");`,
  'cssText بمعامل لونه ثابت عند كل مستدعٍ':  `const btn = (bg) => { const b = document.createElement("b"); b.style.cssText = \`background:\${bg};\`; return b; }; btn("#334155"); btn("#7c6af7");`,
  'textContent بأي قيمة':                    `el.textContent = name; el.title = name; el.setAttribute("aria-label", name);`,
  'setAttribute لسمة عادية':                 `el.setAttribute("data-size", name);`,
  'html += مُهرَّب':                          `let h = ""; h += \`<b>\${esc(name)}</b>\`; el.innerHTML = h;`,
  'location.reload() وreplace لنص عادي':     `location.reload(); const t = String(name).replace(/a/g, "b"); el.textContent = t;`,
  'location.href ثابت':                       `location.href = "/jazma/";`,
};

export function guardProbes() {
  const r = { title: `الحارس نفسه: يكشف ${Object.keys(UNSAFE).length} نمطاً خطراً، ولا يعترض على ${Object.keys(SAFE).length} نمطاً آمناً`, pass: 0, fail: 0, known: 0, notes: [] };
  for (const [k, body] of Object.entries(UNSAFE)) {
    const { findings } = scanSource('js/ui/probe.js', H + body);
    if (findings.length) r.pass++; else { r.fail++; r.notes.push('❌ لم يكشف: ' + k); }
  }
  for (const [k, body] of Object.entries(SAFE)) {
    const { findings } = scanSource('js/ui/probe.js', H + body);
    if (!findings.length) r.pass++; else { r.fail++; r.notes.push('❌ اعترض على الآمن: ' + k + ' — ' + findings[0]); }
  }
  return r;
}
