// 📄 ui/turnTimer.js
// مؤقّت الدور — نمطان:
//   perTurn: عدّاد ثابت لكل خطوة (15 ثانية)
//   bank:    بنك وقت لكل لاعب (Chess Clock) — ينزل بدوره فقط، نفاده = خسارة
import { audioManager } from "../audio/audioManager.js?v=1784674068";
import { state } from "../core/state.js?v=1784674068";
import { getEffect, clearEffect } from "../core/powers.js?v=1784674068";

// ألوان اللاعبين (تطابق ألوان اللوحة والبطاقات)
const PLAYER_COLORS = ['#2dd4bf', '#fb923c', '#a78bfa', '#fcd34d'];

const TURN_SECONDS = 15;      // نمط perTurn: الوقت لكل دور
const WARN_AT = 5;            // متى يبدأ التنبيه

// 🏦 بنوك الوقت حسب حجم اللوحة (أولية — قابلة للضبط، مكان واحد تمهيداً للوحة التحكم)
export const TIME_BANKS = { 3: 120, 4: 180, 5: 240, 6: 300 };

let _enabled = false;
let _mode = 'perTurn';        // 'perTurn' | 'bank'
let _banks = {};              // بنك كل لاعب (نمط bank)
let _remaining = TURN_SECONDS;
let _intervalId = null;
let _onTimeout = null;        // perTurn: انتهى وقت الدور
let _onBankEmpty = null;      // bank: نفد بنك لاعب (يخسر)
let _lastTick = -1;

// تهيئة المؤقّت
export function initTurnTimer({ enabled, mode = 'perTurn', players = 2, bankSeconds = 180, onTimeout, onBankEmpty }) {
  _enabled = !!enabled;
  _mode = mode;
  _onTimeout = onTimeout;
  _onBankEmpty = onBankEmpty;
  _banks = {};
  if (mode === 'bank') {
    for (let i = 1; i <= players; i++) _banks[i] = bankSeconds;
  }
}

export function isTimerEnabled() { return _enabled; }
export function getTimerMode()   { return _mode; }
export function getBank(player)  { return _banks[player] ?? 0; }

// بدء العدّ لدور (perTurn: تصفير لـ15 / bank: متابعة بنك صاحب الدور بلا تصفير)
export function startTurnTimer() {
  if (!_enabled) return;
  stopTurnTimer();

  if (_mode === 'perTurn') {
    _remaining = TURN_SECONDS;
    // أداة "قصّ الوقت" (perTurn): تُطبَّق على الدور مرة واحدة
    const cut = getEffect(state.currentPlayer, 'time_cut');
    if (cut) {
      _remaining = Math.max(5, TURN_SECONDS - cut);
      clearEffect(state.currentPlayer, 'time_cut');
    }
  }
  // bank: لا تصفير — البنك مستمر من حيث توقف

  _lastTick = -1;
  renderTimer();
  _intervalId = setInterval(tick, 1000);
}

// إيقاف العدّ (تجميد — بالبنك لا يفقد شيئاً)
export function stopTurnTimer() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
  hideTimer();
}

function tick() {
  if (_mode === 'bank') {
    const cp = state.currentPlayer;
    _banks[cp] = (_banks[cp] ?? 0) - 1;
    renderTimer();
    const left = _banks[cp];
    if (left <= WARN_AT && left > 0) { try { audioManager.playTick?.(); } catch {} }
    if (left <= 0) {
      stopTurnTimer();
      try { audioManager.playTimeout?.(); } catch {}
      _onBankEmpty?.(cp); // نفد بنك اللاعب — يخسر
    }
    return;
  }
  // perTurn
  _remaining--;
  renderTimer();
  if (_remaining <= WARN_AT && _remaining > 0) { try { audioManager.playTick?.(); } catch {} }
  if (_remaining <= 0) {
    stopTurnTimer();
    try { audioManager.playTimeout?.(); } catch {}
    _onTimeout?.();
  }
}

// إضافة ثوانٍ (أداة تمديد الوقت) — بالبنك: تُضاف لبنك اللاعب (دائمة)
export function extendTime(seconds = 5, player = null) {
  if (!_enabled) return false;
  if (_mode === 'bank') {
    const p = player ?? state.currentPlayer;
    _banks[p] = (_banks[p] ?? 0) + seconds;
    renderTimer();
    return true;
  }
  if (!_intervalId) return false;
  _remaining += seconds;
  renderTimer();
  return true;
}

// قصّ ثوانٍ من بنك لاعب (أداة تقليص الوقت — نمط bank، فورية)
export function cutBank(player, seconds = 5) {
  if (!_enabled || _mode !== 'bank') return false;
  _banks[player] = Math.max(1, (_banks[player] ?? 0) - seconds);
  renderTimer();
  return true;
}

// تنسيق العرض: بنك = د:ثث / دور = رقم
function fmt(sec) {
  if (_mode !== 'bank') return `${sec}`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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

  const val = _mode === 'bank' ? (_banks[state.currentPlayer] ?? 0) : _remaining;
  const warn = val <= WARN_AT;
  el.classList.toggle('warn', warn);
  el.textContent = `⏱️ ${fmt(val)}`;

  if (warn) {
    el.style.color = ''; el.style.borderColor = ''; el.style.background = '';
  } else {
    const col = PLAYER_COLORS[(state.currentPlayer - 1) % PLAYER_COLORS.length] || '#2dd4bf';
    el.style.color = col;
    el.style.borderColor = col + '66';
    el.style.background = col + '1a';
  }

  if (warn && val !== _lastTick) {
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
    _lastTick = val;
  }

  // 🏦 نمط البنك: عرض بنك كل لاعب في بطاقته (الحيّ لصاحب الدور، مجمّد للباقين)
  if (_mode === 'bank') {
    for (const p in _banks) {
      const b = document.getElementById('pbank' + p);
      if (!b) continue;
      const sec = _banks[p] ?? 0;
      const m = Math.floor(sec / 60), s = sec % 60;
      b.textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`;
      b.classList.toggle('low', sec <= 30);
      b.classList.toggle('ticking', Number(p) === state.currentPlayer);
    }
  }
}

function hideTimer() {
  const el = document.getElementById('turn-timer');
  if (el) el.classList.add('hidden');
}
