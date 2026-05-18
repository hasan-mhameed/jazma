// 📄 service-worker.js — v12.5
const CACHE_NAME = "jazma-v12.6.2";
const ASSETS = [
  "/jazma/",
  "/jazma/index.html",
  "/jazma/css/style.css",
  "/jazma/css/animations.css",
  "/jazma/js/main.js",
  "/jazma/js/firebase.js",
  "/jazma/js/auth.js",
  "/jazma/js/friends.js",
  "/jazma/js/invite.js",
  "/jazma/js/chat.js",
  "/jazma/js/leaderboard.js",
  "/jazma/js/board.js",
  "/jazma/js/utils.js",
  "/jazma/js/config/config.js",
  "/jazma/js/core/state.js",
  "/jazma/js/core/logic.js",
  "/jazma/js/ai/aiPlayer.js",
  "/jazma/js/audio/audioManager.js",
  "/jazma/js/audio/notif.js",
  "/jazma/js/ui/boardRenderer.js",
  "/jazma/js/ui/turnManager.js",
  "/jazma/js/ui/scoreboard.js",
  "/jazma/js/ui/gameEnd.js",
  "/jazma/sounds/notif.wav",
  "/jazma/images/icon-192.png",
  "/jazma/images/icon-512.png",
  "/jazma/images/google.svg",
];

// تثبيت — نحفظ الملفات في الـ cache
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
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

// fetch — نرجع من الـ cache أولاً
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// إشعارات Push
self.addEventListener("push", (e) => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || "💬 رسالة جديدة", {
      body:  data.body  || "",
      icon:  "/jazma/images/icon-192.png",
      badge: "/jazma/images/icon-192.png",
      vibrate: [200, 100, 200],
    })
  );
});

// نقرة على الإشعار → فتح التطبيق
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.openWindow("/jazma/")
  );
});
