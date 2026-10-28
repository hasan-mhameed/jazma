// 📄 ui/guideUI.js
// دليل الأدوات — نافذة تعرض كل العناصر والقدرات ووظائفها

import { GUIDE_ITEMS } from "./guideData.js?v=1793226494";
import { getPowerIcon } from "./powerIcons.js?v=1793226494";
import { esc } from "./safeText.js?v=1793226494";

let _built = false;

export function initGuide() {
  const btn = document.getElementById('guide-btn');
  if (btn) btn.addEventListener('click', openGuide);
}

export function openGuide() {
  buildOverlay();
  const overlay = document.getElementById('guide-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('show'));
}

function closeGuide() {
  const overlay = document.getElementById('guide-overlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(() => overlay.classList.add('hidden'), 280);
}

function buildOverlay() {
  if (_built) return;
  _built = true;

  const overlay = document.createElement('div');
  overlay.id = 'guide-overlay';
  overlay.className = 'guide-overlay hidden';

  const panel = document.createElement('div');
  panel.className = 'guide-panel';

  // رأس
  const head = document.createElement('div');
  head.className = 'guide-head';
  head.innerHTML = `
    <span class="guide-title">📖 دليل الأدوات</span>
    <button class="guide-close" aria-label="إغلاق">✕</button>
  `;
  panel.appendChild(head);

  // الجسم — بطاقات
  const body = document.createElement('div');
  body.className = 'guide-body';

  GUIDE_ITEMS.forEach(item => {
    const card = document.createElement('div');
    card.className = 'guide-card';
    // v36.0 (1.10): الأيقونة من getPowerIcon (نفس SVG الجدول) وكل نص يمرّ بـ esc — لا HTML بلا تهريب إلا أيقوناتنا
    card.innerHTML = `
      <div class="gc-icon">${getPowerIcon(item.key)}</div>
      <div class="gc-info">
        <div class="gc-top">
          <span class="gc-name">${esc(item.name)}</span>
          <span class="gc-kind" style="background:${esc(item.kindColor)}22;color:${esc(item.kindColor)};border:1px solid ${esc(item.kindColor)}55;">${esc(item.kind)}</span>
        </div>
        <div class="gc-desc">${esc(item.desc)}</div>
        <div class="gc-how">🎯 ${esc(item.how)}</div>
      </div>
    `;
    body.appendChild(card);
  });

  panel.appendChild(body);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  head.querySelector('.guide-close').addEventListener('click', closeGuide);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeGuide(); });
}
