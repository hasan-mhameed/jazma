// 📄 ui/turnTimer.js
// مؤقّت الدور — عدّاد لكل لاعب مع تنبيه بصري وصوتي قرب النهاية

import { audioManager } from "../audio/audioManager.js?v=1782498247";

const TURN_SECONDS = 20;      // الوقت الافتراضي لكل دور
const WARN_AT = 5;            // متى يبدأ التنبيه (آخر 5 ثوان)

let _enabled = false;
let _remaining = TURN_SECONDS;
let _intervalId = null;
let _onTimeout = null;
let _lastTick = -1;

// تهيئة المؤقّت
export function initTurnTimer({ enabled, onTimeout }) {
  _enabled = !!enabled;
  _onTimeout = onTimeout;
}

export function isTimerEnabled() { return _enabled; }

// بدء العدّ لدور جديد
export function startTurnTimer() {
  if (!_enabled) return;
  stopTurnTimer();
  _remaining = TURN_SECONDS;
  _lastTick = -1;
  renderTimer();
  _intervalId = setInterval(tick, 1000);
}

// إيقاف العدّ
export function stopTurnTimer() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
  hideTimer();
}

function tick() {
  _remaining--;
  renderTimer();

  // تنبيه صوتي في آخر WARN_AT ثوان
  if (_remaining <= WARN_AT && _remaining > 0) {
    try { audioManager.playTick?.(); } catch {}
  }

  if (_remaining <= 0) {
    stopTurnTimer();
    try { audioManager.playTimeout?.(); } catch {}
    _onTimeout?.();
  }
}

// رسم العدّاد في الواجهة
function renderTimer() {
  let el = document.getElementById('turn-timer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'turn-timer';
    const ind = document.getElementById('nat-turn-indicator');
    (ind || document.body).appendChild(el);
  }
  el.classList.remove('hidden');

  const warn = _remaining <= WARN_AT;
  el.classList.toggle('warn', warn);
  el.textContent = `⏱️ ${_remaining}`;

  // نبضة عند كل ثانية في وضع التحذير
  if (warn && _remaining !== _lastTick) {
    el.classList.remove('pulse');
    void el.offsetWidth; // إعادة تشغيل الأنميشن
    el.classList.add('pulse');
    _lastTick = _remaining;
  }
}

function hideTimer() {
  const el = document.getElementById('turn-timer');
  if (el) el.classList.add('hidden');
}
