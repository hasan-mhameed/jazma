// 📄 service-worker.js — v14.2
const CACHE_NAME = "jazma-v1795741688";

// نكاش الـ static assets فقط — JS بيتحمل من الشبكة دايماً عشان الـ ?v= يشتغل
const STATIC_ASSETS = [
  "/jazma/",
  "/jazma/index.html",
  "/jazma/css/style.css",
  "/jazma/css/animations.css",
  "/jazma/sounds/notif.wav",
  "/jazma/images/icon-192.png",
  "/jazma/images/icon-512.png",
  "/jazma/images/google.svg",
];

// تثبيت
self.addEventListener("install", (e) => {
  e.waitUntil(
    // من الشبكة لا من ذاكرة المتصفح (مراجعة ج-5ج): كانت index.html تُحفظ أحياناً بنسخة عمرها حتى 10 دقائق (مهلة GitHub Pages)
    // فتبقى تُقدَّم من المحفوظ حتى الإصدار التالي
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS.map(u => new Request(u, { cache: "reload" }))))
  );
  self.skipWaiting();
});

// تفعيل — نحذف الـ cache القديم
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// fetch — 3.3ج-5ج (من فحص الـconsole في ج-5ب): كان المعالج يعترض كل الطلبات، ويعيد "لا شيء" حين تفشل الشبكة ولا نسخة
// محفوظة (طلب يُقطع عند التحديث أو الإغلاق، أو انقطاع لحظي) فيرمي المتصفح "Failed to convert value to 'Response'".
// الآن: لا نلمس إلا طلبات GET من موقع اللعبة نفسه (Firebase وGoogle والخطوط يتولاها المتصفح مباشرة كما بلا service worker)،
// وأي فشل بلا نسخة محفوظة يُعاد خطأَ شبكة عادياً — كأنه انقطاع، بلا استثناء.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  // ملفات JS (وmanifest.json) → من الشبكة دايماً عشان الـ ?v= يشتغل، والمحفوظ إن انقطعت
  if (url.pathname.includes(".js")) {
    e.respondWith(
      fetch(req).catch(() => caches.match(req)).then(res => res || Response.error(), () => Response.error())
    );
    return;
  }

  // باقي الـ assets → cache first
  e.respondWith(
    caches.match(req).catch(() => undefined).then(cached => cached || fetch(req)).catch(() => Response.error())
  );
});
