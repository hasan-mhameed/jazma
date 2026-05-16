// 📄 notif.js — صوت إشعار
import { audioManager } from "./audioManager.js";

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
  const ctx = audioManager?.audioContext;
  if (!ctx) return;
  // نعمل resume لو suspended
  const play = () => {
    try {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch(e) {}
  };
  if (ctx.state === "suspended") {
    ctx.resume().then(play);
  } else {
    play();
  }
}
