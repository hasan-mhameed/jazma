// 📄 notif.js — صوت إشعار
let _unlocked = false;
let _audio = null; // نعيد استخدام نفس الـ object

function unlock() {
  if (_unlocked) return;
  _unlocked = true;
  // نهيّئ الـ audio object مرة وحدة
  _audio = new Audio("/jazma/sounds/notif.wav");
  _audio.volume = 0.5;
  // نشغله صامت عشان يُفتح
  _audio.volume = 0;
  _audio.play().catch(() => {});
  _audio.volume = 0.5;
}

document.addEventListener("click",      unlock, { once: true });
document.addEventListener("keydown",    unlock, { once: true });
document.addEventListener("touchstart", unlock, { once: true });

export function playNotifSound() {
  if (!_unlocked || !_audio) return;
  try {
    _audio.currentTime = 0; // نرجعه للبداية
    _audio.play().catch(() => {});
  } catch(e) {}
}
