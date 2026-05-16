// 📄 notif.js — صوت إشعار
let _unlocked = false;

// نفتح الصوت بعد أول تفاعل
function unlock() {
  if (_unlocked) return;
  _unlocked = true;
  // نشغل صوت صامت لفتح audio context في المتصفح
  const silent = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==");
  silent.volume = 0;
  silent.play().catch(() => {});
}

document.addEventListener("click",      unlock, { once: true });
document.addEventListener("keydown",    unlock, { once: true });
document.addEventListener("touchstart", unlock, { once: true });

export function playNotifSound() {
  if (!_unlocked) return;
  try {
    const audio = new Audio("/jazma/sounds/notif.wav");
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch(e) {}
}
