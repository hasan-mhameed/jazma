// 📄 core/textLimits.js — 3.3ج-5أ
// حدود القواعد للاسم (128) والصورة (1024) — مصدر واحد لكل من يكتب اسماً أو صورة (ملف اللاعب الخاص والعام، طلب الصداقة،
// مدخل الصديق). الاسم يُقصّ بالحروف الكاملة (لا يُشطر رمز من خانتين)، ورابط صورة أطول من الحدّ لا يُقصّ (رابط مقصوص لا
// يعمل) — يُترك فارغاً. وحدة نقية بلا استيرادات.
export const NAME_MAX = 128, PHOTO_MAX = 1024;
export function clipName(s) {
  let out = "";
  for (const ch of String(s ?? "")) { if (out.length + ch.length > NAME_MAX) break; out += ch; }
  return out;
}
export const clipPhoto = (u) => { const s = String(u ?? ""); return s.length <= PHOTO_MAX ? s : ""; };
