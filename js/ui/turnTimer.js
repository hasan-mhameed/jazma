// 📄 ui/turnTimer.js
// مؤقّت الدور — نمطان:
//   perTurn: عدّاد ثابت لكل خطوة (15 ثانية)
//   bank:    بنك وقت لكل لاعب (Chess Clock) — ينزل بدوره فقط، نفاده = خسارة
import { audioManager } from "../audio/audioManager.js?v=1788644342";
import { state } from "../core/state.js?v=1788644342";
import { getEffect, clearEffect } from "../core/powers.js?v=1788644342";

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
let _lastWarnSec = -1;  // آخر ثانية شُغّل فيها صوت التنبيه (منع التكرار مع الفحص السريع)

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

// ضبط بنك لاعب من مصدر خارجي (تزامن أونلاين — القيمة المستلمة من صاحب الدور عبر Firebase)
// نصحّح فقط إذا اختلفت القيمة لتفادي وميض العرض
export function setBank(player, seconds) {
  if (_mode !== 'bank' || typeof seconds !== 'number') return;
  _banks[player] = Math.max(0, Math.round(seconds));
  renderTimer();
}

// ══ الساعة المركزية (أونلاين) — المرجع الموحّد من Firebase ══
let _clockMode = false;        // هل نستخدم الساعة المركزية؟
let _clockState = null;        // { banks, currentPlayer, turnStartAt }
let _serverNowFn = null;       // دالة توقيت السيرفر
let _onClockTimeout = null;    // نفاد بنك (أونلاين)

// معدّل الفحص: الساعة المركزية تحسب من المرجع (آمن نسرّعه للنعومة)،
// أما العدّ المحلي فينقص عدّاداً كل نبضة فيجب أن يبقى ثانية كاملة
const TICK_MS_CLOCK = 250;   // أونلاين (مركزية): 4 مرات/ثانية — يمنع القفزات البصرية
const TICK_MS_LOCAL = 1000;  // محلي: نبضة كل ثانية

function tickInterval() { return _clockMode ? TICK_MS_CLOCK : TICK_MS_LOCAL; }

export function enableCentralClock(serverNowFn, onTimeout) {
  _clockMode = true;
  _serverNowFn = serverNowFn;
  _onClockTimeout = onTimeout;
  // نبدأ العدّاد فوراً (يعمل عند الجميع — يحسب من المرجع المركزي)
  if (_enabled && !_intervalId) _intervalId = setInterval(tick, tickInterval());
}

// استقبال حالة الساعة من Firebase (المرجع)
export function applyClockState(clock) {
  if (!clock || !_clockMode) return;
  _clockState = clock;
  if (clock.banks) {
    for (const p in clock.banks) _banks[p] = clock.banks[p];
  }
  renderTimer();
  // نضمن أن العدّاد يعمل (الكل يشاهد وقت صاحب الدور ينزل حياً من المرجع)
  if (_enabled && !_intervalId && !state.gameFinished) {
    _intervalId = setInterval(tick, tickInterval());
  }
}

// حساب المتبقي لصاحب الدور من المرجع المركزي (بنكه ناقص المنقضي منذ بدء دوره)
function clockRemaining(player) {
  if (!_clockState || !_clockState.banks) return _banks[player] ?? 0;
  const base = Number(_clockState.banks[player] ?? 0);
  const clockCP = _clockState.currentPlayer;
  if (player !== clockCP) return base; // ليس دوره: بنكه ثابت
  const started = _clockState.turnStartAt;
  if (typeof started !== 'number' || !_serverNowFn) return base;
  const elapsed = Math.max(0, (_serverNowFn() - started) / 1000);
  return Math.max(0, base - elapsed);
}

// صاحب الدور المرجعي (من الساعة أونلاين، أو المحلي)
function activePlayerForClock() {
  return (_clockMode && _clockState && _clockState.currentPlayer)
    ? _clockState.currentPlayer : state.currentPlayer;
}

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
  _intervalId = setInterval(tick, tickInterval());
}

// إيقاف العدّ (تجميد — بالبنك لا يفقد شيئاً)
export function stopTurnTimer() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
  hideTimer();
}

function tick() {
  if (_mode === 'bank') {
    // أونلاين (ساعة مركزية): نحسب المتبقي من مرجع Firebase بدل العدّ المحلي
    if (_clockMode) {
      const cp = activePlayerForClock();
      const left = clockRemaining(cp);
      _banks[cp] = left; // للعرض
      renderTimer();
      // التنبيه الصوتي مرة واحدة لكل ثانية (الفحص أسرع للنعومة البصرية فقط)
      const sec = Math.ceil(left);
      if (sec <= WARN_AT && sec > 0 && sec !== _lastWarnSec) {
        _lastWarnSec = sec;
        try { audioManager.playTick?.(); } catch {}
      }
      if (left <= 0) {
        stopTurnTimer();
        try { audioManager.playTimeout?.(); } catch {}
        _onClockTimeout?.(cp); // نفاد — يُعلَن عبر منطق الأونلاين
      }
      return;
    }
    // محلي: عدّ تنازلي عادي
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
    // الساعة المركزية: القيمة الجديدة = المتبقي الحيّ + الإضافة (تُكتب للمرجع عبر updateClockBank)
    if (_clockMode) {
      const newVal = Math.ceil(clockRemaining(p)) + seconds;
      _banks[p] = newVal; // مؤقت للعرض حتى يصل المرجع
      renderTimer();
      return newVal; // نُرجع القيمة ليكتبها المستدعي في المرجع
    }
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
  if (_clockMode) {
    const newVal = Math.max(1, Math.ceil(clockRemaining(player)) - seconds);
    _banks[player] = newVal; // مؤقت للعرض
    renderTimer();
    return newVal; // نُرجع القيمة ليكتبها المستدعي في المرجع
  }
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

  // القيمة المعروضة: أونلاين ساعة مركزية = حساب حيّ من المرجع (مقرّب) / غير ذلك = البنك المحلي
  let val;
  if (_mode === 'bank' && _clockMode) {
    val = Math.ceil(clockRemaining(activePlayerForClock()));
  } else if (_mode === 'bank') {
    val = _banks[state.currentPlayer] ?? 0;
  } else {
    val = _remaining;
  }
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
    const activeCP = activePlayerForClock();
    for (const p in _banks) {
      const b = document.getElementById('pbank' + p);
      if (!b) continue;
      // أونلاين: صاحب الدور يُحسب حياً من المرجع، الباقون من بنكهم المخزّن
      let sec;
      if (_clockMode && Number(p) === activeCP) {
        sec = Math.ceil(clockRemaining(Number(p)));
      } else if (_clockMode && _clockState && _clockState.banks) {
        sec = Math.round(Number(_clockState.banks[p] ?? 0));
      } else {
        sec = Math.round(_banks[p] ?? 0);
      }
      const m = Math.floor(sec / 60), s = sec % 60;
      b.textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`;
      b.classList.toggle('low', sec <= 30);
      b.classList.toggle('ticking', Number(p) === activeCP);
    }
  }
}

function hideTimer() {
  const el = document.getElementById('turn-timer');
  if (el) el.classList.add('hidden');
}
