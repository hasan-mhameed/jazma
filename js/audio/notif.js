// 📄 notif.js — صوت إشعار
import { audioManager } from "./audioManager.js?v=1781555738";

let _unlocked = false;
let _pending = false;

function unlock() {
  if (_unlocked) return;
  _unlocked = true;
  const ctx = audioManager?.initAudioContext?.();
  if (ctx?.state === "suspended") {
    ctx.resume().then(() => {
      if (_pending) {
        _pending = false;
        playNotifSound();
      }
    }).catch(() => {});
  } else if (_pending) {
    _pending = false;
    playNotifSound();
  }
}

document.addEventListener("click",      unlock);
document.addEventListener("keydown",    unlock);
document.addEventListener("touchstart", unlock);

export function playNotifSound() {
  if (!_unlocked) {
    _pending = true;
    return;
  }
  const ctx = audioManager?.audioContext || audioManager?.initAudioContext?.();
  if (!ctx) {
    _pending = true;
    return;
  }
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
