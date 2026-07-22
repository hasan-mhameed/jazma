// 📄 ui/powersUI.js
// شريط المخزون — يعرض قدرات اللاعب الحالي + التفعيل

import { POWERS, getInventory } from "../core/powers.js?v=1784759531";
import { state } from "../core/state.js?v=1784759531";
import { getPowerIcon } from "./powerIcons.js?v=1784759531";

let _onActivate = null;
let _onBuy = null;
let _lastCfg = null;

export function initPowersUI({ onActivate, onBuy }) {
  _onActivate = onActivate;
  _onBuy = onBuy;
}

// تحديث الشريط حسب قدرات اللاعب الحالي
export function refreshInventory(cfg) {
  _lastCfg = cfg;
  const bar = document.getElementById('inventory-bar');
  if (!bar) return;

  // في وضع AI أو أونلاين: نعرض قدرات اللاعب 1 (المستخدم) فقط
  // في المحلي: قدرات اللاعب صاحب الدور
  let viewPlayer = state.currentPlayer;
  if (cfg.aiMode === 'ai') viewPlayer = 1;
  if (cfg.aiMode === 'online') viewPlayer = cfg.onlinePlayerNum || 1;

  const inv = getInventory(viewPlayer);
  const types = Object.keys(inv).filter(t => inv[t] > 0);

  // نبني الشريط
  bar.innerHTML = '<span class="inv-label">قدراتك</span>';

  if (types.length === 0) {
    // خانات فارغة
    for (let i = 0; i < 4; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot empty';
      slot.textContent = '＋';
      bar.appendChild(slot);
    }
    addGuideButton(bar);
    return;
  }

  types.forEach(type => {
    const power = POWERS[type];
    const count = inv[type];
    const slot = document.createElement('div');
    slot.className = 'inv-slot filled';
    slot.innerHTML = `<span class="inv-icon">${getPowerIcon(type, power.icon)}</span><span class="inv-count">${count}</span>`;
    slot.title = `${power.name} — ${power.desc}`;

    // هل يمكن التفعيل الآن؟ (دور اللاعب الحالي)
    const canUse = canActivate(cfg, viewPlayer);
    if (canUse) {
      slot.addEventListener('click', () => {
        // نقرأ اللاعب صاحب الدور وقت النقر (مش وقت البناء)
        _onActivate?.(type, state.currentPlayer);
      });
    } else {
      slot.classList.add('disabled');
    }
    bar.appendChild(slot);
  });

  // نكمل خانات فارغة للتناسق (حتى 4)
  for (let i = types.length; i < 4; i++) {
    const slot = document.createElement('div');
    slot.className = 'inv-slot empty';
    slot.textContent = '＋';
    bar.appendChild(slot);
  }
  addGuideButton(bar);
}

// زر دليل الأدوات (؟) — يُضاف لنهاية الشريط دائماً
function addGuideButton(bar) {
  addShopButtons(bar, _lastCfg);
  const btn = document.createElement('button');
  btn.id = 'guide-btn';
  btn.className = 'guide-btn';
  btn.textContent = '؟';
  btn.title = 'دليل الأدوات';
  btn.addEventListener('click', () => {
    import('./guideUI.js?v=1784759531').then(m => m.openGuide());
  });
  bar.appendChild(btn);
}

// أزرار شراء الأدوات (shop) — تظهر حسب الشروط
function addShopButtons(bar, cfg) {
  if (!cfg) return;
  const timerOn = cfg.aiMode === 'online' ? true : !!cfg.turnTimer;

  Object.keys(POWERS).forEach(key => {
    const p = POWERS[key];
    if (p.source !== 'shop') return;
    if (p.requiresTimer && !timerOn) return; // تظهر فقط مع المؤقّت

    // متاحة فقط في دور اللاعب
    const myTurn = canActivate(cfg, state.currentPlayer);

    const btn = document.createElement('button');
    btn.className = 'shop-btn';
    btn.innerHTML = `<span class="shop-icon">${getPowerIcon(key, p.icon)}</span><span class="shop-cost">${p.cost}💎</span>`;
    btn.title = `${p.name} — ${p.desc} (${p.cost} جوهرة)`;
    if (!myTurn) btn.classList.add('disabled');
    else btn.addEventListener('click', () => _onBuy?.(key));
    bar.appendChild(btn);
  });
}

function canActivate(cfg, viewPlayer) {
  if (cfg.aiMode === 'ai') return state.currentPlayer === 1;
  if (cfg.aiMode === 'online') return state.currentPlayer === (cfg.onlinePlayerNum || 1);
  return state.currentPlayer === viewPlayer; // محلي
}
