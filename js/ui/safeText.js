// 📄 ui/safeText.js — v36.0 (الخطوة 1.10: أمان النصوص)
// كل ما يأتي من مستخدم أو من قاعدة البيانات (اسم، رسالة، رقم قد يكتبه غيرنا) يُعرض كنص — لا كشيفرة HTML.
//
// القاعدة في المشروع (يفرضها الفحص الآلي tests/ui/guard.mjs):
//   • textContent حيث أمكن.
//   • في القوالب المُسندة إلى innerHTML: كل قيمة متغيّرة تمرّ بـ esc() عند موضع إدراجها — حتى نصوص الجداول الثابتة.
//   • HTML الثابت الوحيد المسموح بلا esc: أيقونات SVG من getPowerIcon (ui/powerIcons.js).
//   • روابط الصور: safeImageSrc() فقط.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** نص آمن داخل قالب HTML (محتوى عنصر، أو قيمة سمة بين علامتي تنصيص). null/undefined → fallback */
export function esc(v, fallback = "") {
  return String(v ?? fallback).replace(/[&<>"']/g, ch => ESC[ch]);
}

/** نص عادي (لـ textContent) من أي قيمة — قيمة كتبها غيرنا قد لا تكون نصاً أصلاً */
export function asText(v, fallback = "") { return String(v ?? fallback); }

/** الحرف الأول من اسم (للصورة البديلة) — حرفاً كاملاً ولو كان إيموجي */
export function firstInitial(name) {
  const first = Array.from(asText(name, "?").trim())[0];
  return first ? first.toUpperCase() : "?";
}

// صور الحسابات تأتي من Google (lh3.googleusercontent.com وأخواتها). رابط لمضيف آخر يختاره مستخدم يعني طلباً
// لخادمه من جهاز كل من يرى صورته (يكشف عنوانه ويتتبّعه) — فيُستبدل بالحرف الأول. (مراجعة 1.10)
const PHOTO_HOST = /(^|\.)googleusercontent\.com$/i;

/** رابط صورة حساب مقبول (https من صور Google) بصيغته الموحّدة، أو "" — يُسند إلى src مباشرة */
export function safeImageSrc(url) {
  try {
    const p = new URL(asText(url));
    return (p.protocol === "https:" && PHOTO_HOST.test(p.hostname) && !p.username && !p.password) ? p.href : "";
  } catch { return ""; }
}
