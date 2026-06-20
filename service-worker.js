// 📄 service-worker.js — v14.2
const CACHE_NAME = "jazma-v1781999156";

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
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
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

// fetch — JS و Firebase دايماً من الشبكة، باقي الـ assets من الـ cache
self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // JS files و Firebase → دايماً من الشبكة
  if (url.includes(".js") || url.includes("firebase") || url.includes("googleapis")) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // باقي الـ assets → cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
