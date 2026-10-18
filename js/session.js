// 📄 session.js — v36.0 (الخطوة 1.11): حساب واحد لكل تحميل صفحة
// كل ما يُبنى بعد الدخول (الأصدقاء، الرسائل، الإشعارات، الدعوات، الحضور، مستمعو قاعدة البيانات...) يُبنى مرة
// واحدة لصاحب الجلسة. أي تغيّر في الحساب بعدها — تسجيل خروج (من الزر، أو من تبويب آخر، أو انتهاء الجلسة)، أو
// حساب آخر، أو ترقية الضيف لحساب — يعني صفحة جديدة نظيفة، كالتطبيقات العالمية.
// كان: تهيئة ثانية فوق الأولى بنفس الصفحة → زر الرسائل ينفتح وينسكّر بنفس الضغطة، وحالة الأصدقاء تتجمّد،
// ومستمعو الحساب السابق يبقون شغّالين؛ والضيف بعد الترقية يبقى بواجهة الضيف حتى يحدّث الصفحة بنفسه.

let _sessionUid = null;
let _reloading  = false;

/**
 * يُستدعى أول شيء مع كل حدث لحالة الدخول (onUserChange). يرجع ما يجب فعله:
 *   "reload" — الحساب تغيّر بعد بدء جلسة على هذه الصفحة (خروج أو حساب آخر): لا تُكمل — الصفحة ستُعاد
 *   "same"   — الحساب نفسه مرة ثانية (Firebase لا يكرّره اليوم — حماية لو تغيّر ذلك): لا تهيئة ثانية
 *   "start"  — أول دخول على هذه الصفحة: التهيئة
 *   "none"   — بلا دخول ولا جلسة سابقة: شاشة الدخول
 */
export function sessionStep(user) {
  const uid = user?.uid || null;
  if (_reloading) return "reload";
  if (_sessionUid && uid !== _sessionUid) return "reload";
  if (_sessionUid) return "same";
  if (uid) { _sessionUid = uid; return "start"; }
  return "none";
}

/** صفحة جديدة نظيفة، بعد إنهاء ما يجب إنهاؤه (before) — ثانية ونصف بحدّ أقصى. مرة واحدة فقط. */
export async function freshPage(before = null, maxWait = 1500) {
  if (_reloading) return;
  _reloading = true;
  try {
    await Promise.race([
      Promise.resolve().then(() => before?.()),
      new Promise(r => setTimeout(r, maxWait)),
    ]);
  } catch {}
  location.reload();
}
