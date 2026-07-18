// 📄 ui/powerTutorial.js
// بطاقة تعريف القدرة — تظهر أول مرة يحصل عليها اللاعب فقط
// تُحفظ "تعلّمها" في Firebase: users/{uid}/learnedPowers/{type}

import { getDatabase, ref, get, update }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { currentUser } from "../auth.js?v=1784362401";
import { POWERS } from "../core/powers.js?v=1784362401";
import { getPowerIcon } from "./powerIcons.js?v=1784362401";

const db = getDatabase();

// ذاكرة محلية للجلسة (نتجنّب استعلامات متكررة)
let _learnedCache = null;

// نحمّل قائمة القدرات المتعلَّمة من Firebase
export async function loadLearnedPowers() {
  const uid = currentUser?.uid;
  if (!uid) { _learnedCache = {}; return; }
  try {
    const snap = await get(ref(db, `users/${uid}/learnedPowers`));
    _learnedCache = snap.exists() ? snap.val() : {};
  } catch { _learnedCache = {}; }
}

// هل تعلّم اللاعب هذه القدرة من قبل؟
function hasLearned(type) {
  return !!(_learnedCache && _learnedCache[type]);
}

// نحفظ أنه تعلّمها (Firebase + الذاكرة المحلية)
async function markLearned(type) {
  if (!_learnedCache) _learnedCache = {};
  _learnedCache[type] = true;
  const uid = currentUser?.uid;
  if (!uid) return;
  try { await update(ref(db, `users/${uid}/learnedPowers`), { [type]: true }); } catch {}
}

// نقطة الدخول: نستدعيها عند الحصول على قدرة
// تعرض البطاقة فقط أول مرة
export function maybeShowTutorial(type) {
  if (_learnedCache === null) return;       // لم تُحمّل بعد — تخطٍّ آمن
  if (hasLearned(type)) return;             // تعلّمها — لا نزعجه
  const power = POWERS[type];
  if (!power) return;
  markLearned(type);
  showCard(power, type);
}

// ── عرض البطاقة ──
function showCard(power, type) {
  // طبقة معتمة
  const overlay = document.createElement('div');
  overlay.className = 'power-tut-overlay';

  const card = document.createElement('div');
  card.className = 'power-tut-card';
  card.innerHTML = `
    <div class="ptc-badge">قدرة جديدة!</div>
    <div class="ptc-icon">${getPowerIcon(type, power.icon)}</div>
    <div class="ptc-name">${power.name}</div>
    <div class="ptc-desc">${power.desc}</div>
    <button class="ptc-btn">فهمت 👍</button>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  const close = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 280);
  };
  card.querySelector('.ptc-btn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}
