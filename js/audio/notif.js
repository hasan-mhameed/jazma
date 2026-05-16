// 📄 notif.js — صوت إشعار
let _unlocked = false;

function unlock() {
  if (_unlocked) return;
  _unlocked = true;
}

document.addEventListener("click",      unlock);
document.addEventListener("keydown",    unlock);
document.addEventListener("touchstart", unlock);

export function playNotifSound() {
  if (!_unlocked) return;
  try {
    const audio = new Audio("/jazma/sounds/notif.wav");
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch(e) {}
}
