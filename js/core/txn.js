// 📄 core/txn.js — 3.3ج-4
// معاملة تبدأ من قيمة الخادم الحقيقية. بلا مستمع على المسار تبدأ المعاملة بتخمين فارغ (null) فتقترح قيمة مبنية عليه
// (الخبرة = المكسب وحده، السلسلة = 1)؛ وقواعد ج-4 تقارن بالقيمة المخزّنة (الخبرة لا تنقص، السلسلة +1 فقط) — فإن قيّم
// الخادم القواعد قبل مقارنة البصمة (الترتيب غير موثّق في Firebase) رفضها: تضيع خبرة المباراة ويُطبع تحذير. هنا مستمع
// مؤقت يجلب القيمة أولاً (أو يجدها في الذاكرة)، ثم المعاملة على الحقيقية، ثم يُزال المستمع.
// وصفحة أخرى تكتب بين قراءتنا واقتراحنا (مباراتان تنتهيان معاً): اقتراحنا مبني على قيمة سبقتها فترفضه القواعد بالترتيب
// نفسه بدل أن يُعاد — المستمع القائم جلب الجديدة قبل وصول الرفض، فنعيد المعاملة عليها (دالة التحديث بلا آثار — الإعادة
// آمنة). محاولات قليلة: رفضٌ لسبب حقيقي يبقى رفضاً.
import { onValue, runTransaction }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const isDenied = (e) => /permission[_ ]denied/i.test(String((e && (e.code || e.message)) || e));

export async function warmTransaction(r, update, options, tries = 3) {
  let unsub = null;
  try {
    // تعذّر القراءة (صلاحية/انقطاع) لا يوقفها: المعاملة تُجرَّب كما كانت
    await new Promise(res => { unsub = onValue(r, () => res(), () => res()); });
    for (let i = 1; ; i++) {
      try {
        return await runTransaction(r, update, options);
      } catch (e) {
        if (i >= tries || !isDenied(e)) throw e;
      }
    }
  } finally {
    try { unsub && unsub(); } catch {}
  }
}
