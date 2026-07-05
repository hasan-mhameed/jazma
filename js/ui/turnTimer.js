// 📄 ui/turnTimer.js
// مؤقّت الدور — عدّاد لكل لاعب مع تنبيه بصري وصوتي قرب النهاية

import { audioManager } from "../audio/audioManager.js?v=1783204799";
import { state } from "../core/state.js?v=1783204799";
import { getEffect, clearEffect } from "../core/powers.js?v=1783204799";

// ألوان اللاعبين (تطابق ألوان اللوحة والبطاقات)
const PLAYER_COLORS = ['#2dd4bf', '#fb923c', '#a78bfa', '#fcd34d'];

const TURN_SECONDS = 15;      // الوقت الافتراضي لكل دور
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

  // لو على اللاعب الحالي علامة "قصّ وقت" (من أداة الخصم) — نطبّقها مرة وحدة
  const cut = getEffect(state.currentPlayer, 'time_cut');
  if (cut) {
    _remaining = Math.max(5, TURN_SECONDS - cut); // لا يقل عن 5 ثوان
    clearEffect(state.currentPlayer, 'time_cut');
  }

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

// إضافة ثوانٍ للوقت الحالي (أداة تمديد الوقت)
export function extendTime(seconds = 5) {
  if (!_enabled || !_intervalId) return false;
  _remaining += seconds;
  renderTimer();
  return true;
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

  // لون المؤقّت حسب دور اللاعب (إلا في وضع التحذير = أحمر موحّد)
  if (warn) {
    el.style.color = '';
    el.style.borderColor = '';
    el.style.background = '';
  } else {
    const col = PLAYER_COLORS[(state.currentPlayer - 1) % PLAYER_COLORS.length] || '#2dd4bf';
    el.style.color = col;
    el.style.borderColor = col + '66';
    el.style.background = col + '1a';
  }

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
