// 📄 boardRenderer.js — v18.0 (Living Board — clean architecture)
// طبقات منظمة + ticker مركزي + نظام جاهز للعناصر الخاصة

import { state }                              from "../core/state.js?v=1782770973";
import { makeKey }                            from "../utils.js?v=1782770973";
import { renderScoreboard, updateScoreboard } from "./scoreboard.js?v=1782770973";
import { updateTurn, updateTurnUI }           from "./turnManager.js?v=1782770973";
import { endGame }                            from "./gameEnd.js?v=1782770973";
import { audioManager }                       from "../audio/audioManager.js?v=1782770973";
import { checkSquaresAround }                 from "../core/logic.js?v=1782770973";
import { onlineManager }                      from "../firebase.js?v=1782770973";
import { generateSpecialSquares, getElementAt, ELEMENTS } from "../core/specialSquares.js?v=1782770973";
import { resetPowers, addPower, getEffect, clearEffect, consumePower, setEffect, hasPower } from "../core/powers.js?v=1782770973";
import { refreshInventory } from "./powersUI.js?v=1782770973";
import { maybeShowTutorial } from "./powerTutorial.js?v=1782770973";
import { isTimerEnabled, startTurnTimer, stopTurnTimer } from "./turnTimer.js?v=1782770973";
import { resetMatchCoins, addMatchCoins } from "../core/wallet.js?v=1782770973";

// ═══════════════════════════════════════════════════════
//  الحالة العامة
// ═══════════════════════════════════════════════════════
let app = null;
let layers = {};            // الطبقات
let edgeObjects = [];       // الخطوط التفاعلية
let aiPlayer = null;
let isAIThinking = false;
let animItems = [];         // عناصر حية تتحرك كل إطار
let ambientParticles = [];  // جسيمات الخلفية
let _cfg = null;

// ═══════════════════════════════════════════════════════
//  الثيم
// ═══════════════════════════════════════════════════════
const THEME = {
  bg:          0x081310,
  dot:         0xc8b8ff,
  dotGlow:     0x9d8df7,
  dotCorner:   0xfbbf24,
  edgeIdle:    0x1e4035,
  edgeHover:   0x2dd4bf,
  squareAlpha: 0.26,
  // ألوان اللاعبين (الخطوط والمربعات تتبعها)
  playerColors: [0x2dd4bf, 0xfb923c, 0xa78bfa, 0xfcd34d],
  playerGlows:  [0x06d6a0, 0xf97316, 0x8b5cf6, 0xfbbf24],
  ambient:     [0x2dd4bf, 0x10b981, 0xa3e635],
};

function pColor(p) { return THEME.playerColors[(p-1) % 4] || 0x888888; }
function pGlow(p)  { return THEME.playerGlows[(p-1) % 4]  || 0x888888; }

// هل هذا اللاعب هو المستخدم الحقيقي (يكسب عملات)؟
function isCoinEarner(cfg, player) {
  if (cfg.aiMode === 'ai')     return player === 1;        // ضد AI: اللاعب 1
  if (cfg.aiMode === 'online') return player === (cfg.onlinePlayerNum || 1);
  return true; // محلي: الكل (نفس الجهاز/الحساب)
}

// ═══════════════════════════════════════════════════════
//  init
// ═══════════════════════════════════════════════════════
export async function initBoard(cfg, ai = null) {
  _cfg = cfg;
  aiPlayer = ai;
  isAIThinking = false;
  edgeObjects = [];
  animItems = [];
  ambientParticles = [];

  while (cfg.colors.length < cfg.players)
    cfg.colors.push(`hsl(${Math.floor(Math.random()*360)},70%,50%)`);

  // أبعاد
  const SIZE    = Math.min(window.innerWidth * 0.9, window.innerHeight * 0.5, 480);
  const padding = SIZE * 0.12;
  const spacing = (SIZE - padding*2) / (Math.max(cfg.cols, cfg.rows) - 1);
  const W = padding*2 + (cfg.cols-1)*spacing;
  const H = padding*2 + (cfg.rows-1)*spacing;
  cfg._pixi = { spacing, padding, W, H };

  // تدمير آمن + canvas نظيف
  if (app) { try { app.destroy({ removeView: false }, { children: true, texture: true }); } catch(e){} app = null; }
  let canvasEl = document.getElementById('board');
  if (canvasEl) {
    const fresh = canvasEl.cloneNode(false);
    fresh.className = canvasEl.className;
    fresh.classList.remove('hidden');
    canvasEl.parentNode.replaceChild(fresh, canvasEl);
    canvasEl = fresh;
  }

  app = new PIXI.Application();
  await app.init({
    canvas: canvasEl,
    width: W, height: H,
    backgroundColor: THEME.bg,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });

  // ── الطبقات (الترتيب مهم) ──
  layers = {};
  ['ambient','glow','squares','elements','edges','dots','fx'].forEach(name => {
    layers[name] = new PIXI.Container();
    app.stage.addChild(layers[name]);
  });

  // ── الحالة ──
  state.lines = new Set();
  state.currentPlayer = 1;
  state.scores = {};
  state.squaresFilled = 0;
  for (let i = 1; i <= cfg.players; i++) state.scores[i] = 0;

  buildAmbient(W, H);
  buildDots(cfg);
  buildSpecialElements(cfg);
  buildEdges(cfg);
  resetPowers(cfg.players);
  resetMatchCoins();

  // ── ticker مركزي ──
  app.ticker.add(ticker);

  renderScoreboard(cfg);
  updateScoreboard();
  updateTurnUI(cfg);
  updateTurn(cfg);
  refreshInventory(cfg);
}

// ═══════════════════════════════════════════════════════
//  الخلفية الحية — جسيمات تطفو
// ═══════════════════════════════════════════════════════
function buildAmbient(W, H) {
  for (let i = 0; i < 14; i++) {
    const g = new PIXI.Graphics();
    const color = THEME.ambient[i % THEME.ambient.length];
    const size = 1 + Math.random() * 2;
    g.circle(0, 0, size).fill({ color, alpha: 0.4 });
    g.x = Math.random() * W;
    g.y = Math.random() * H;
    layers.ambient.addChild(g);
    ambientParticles.push({ g, speed: 0.15 + Math.random()*0.3, drift: Math.random()*0.5-0.25, phase: Math.random()*Math.PI*2 });
  }
}

// ═══════════════════════════════════════════════════════
//  النقاط
// ═══════════════════════════════════════════════════════
function buildDots(cfg) {
  const { spacing, padding } = cfg._pixi;
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      const x = padding + c*spacing;
      const y = padding + r*spacing;
      const isCorner = (r===0||r===cfg.rows-1) && (c===0||c===cfg.cols-1);
      const radius = isCorner ? 6 : 4.5;
      const color  = isCorner ? THEME.dotCorner : THEME.dot;
      const glow   = isCorner ? 0xfcd34d : THEME.dotGlow;

      const glowG = new PIXI.Graphics();
      glowG.circle(0,0,radius+5).fill({ color: glow, alpha: 0.15 });
      glowG.x = x; glowG.y = y;
      layers.glow.addChild(glowG);

      const g = new PIXI.Graphics();
      g.circle(0,0,radius).fill({ color });
      g.circle(0,0,radius*0.4).fill({ color: 0xffffff, alpha: 0.5 });
      g.x = x; g.y = y;
      layers.dots.addChild(g);

      animItems.push({ type:'dot', g, glowG, baseR: radius, phase: Math.random()*Math.PI*2 });
    }
  }
}

// ═══════════════════════════════════════════════════════
//  العناصر الخاصة (خافتة + نابضة قبل الإكمال)
// ═══════════════════════════════════════════════════════
function buildSpecialElements(cfg) {
  generateSpecialSquares(cfg);
  const { spacing, padding } = cfg._pixi;

  for (let r = 0; r < cfg.rows-1; r++) {
    for (let c = 0; c < cfg.cols-1; c++) {
      const type = getElementAt(r, c);
      if (!type) continue;
      const cx = padding + c*spacing + spacing/2;
      const cy = padding + r*spacing + spacing/2;
      const size = spacing * 0.32;

      if (type === 'water') {
        buildFish(cx, cy, size);
      } else if (type === 'gem') {
        buildGem(cx, cy, size);
      } else {
        const el = ELEMENTS[type];
        const icon = new PIXI.Text({ text: el.icon, style:{
          fontSize: Math.floor(spacing*0.34), fontFamily:'sans-serif'
        }});
        icon.anchor.set(0.5);
        icon.x = cx; icon.y = cy;
        icon.alpha = 0.4;
        layers.elements.addChild(icon);
        animItems.push({ type:'element', g:icon, phase: Math.random()*Math.PI*2, baseY: cy });
      }
    }
  }
}

// ── رسم السمكة (SVG-style بـ PixiJS) ──
function buildFish(cx, cy, size) {
  const container = new PIXI.Container();
  container.x = cx; container.y = cy;
  const s = size * 1.15; // تكبير بسيط للوضوح

  // ── الذيل (مفصّل، بتدرّج ذهبي) ──
  const tail = new PIXI.Graphics();
  tail.moveTo(-s*0.45, 0)
      .bezierCurveTo(-s*0.85, -s*0.5, -s*1.0, -s*0.35, -s*0.95, -s*0.12)
      .bezierCurveTo(-s*0.78, 0, -s*0.78, 0, -s*0.95, s*0.12)
      .bezierCurveTo(-s*1.0, s*0.35, -s*0.85, s*0.5, -s*0.45, 0)
      .fill({ color: 0xef4444 });
  // خطوط الذيل
  tail.moveTo(-s*0.5, 0).lineTo(-s*0.88, -s*0.28).stroke({ color: 0xb91c1c, width: 1, alpha: 0.5 });
  tail.moveTo(-s*0.5, 0).lineTo(-s*0.88, s*0.28).stroke({ color: 0xb91c1c, width: 1, alpha: 0.5 });

  // ── الزعنفة العلوية ──
  const finTop = new PIXI.Graphics();
  finTop.moveTo(s*0.1, -s*0.32)
        .bezierCurveTo(s*0.3, -s*0.62, s*0.5, -s*0.5, s*0.55, -s*0.32)
        .lineTo(s*0.1, -s*0.32)
        .fill({ color: 0xf87171, alpha: 0.92 });

  // ── الزعنفة السفلية ──
  const finBot = new PIXI.Graphics();
  finBot.moveTo(s*0.2, s*0.3)
        .bezierCurveTo(s*0.3, s*0.55, s*0.45, s*0.5, s*0.5, s*0.34)
        .lineTo(s*0.2, s*0.3)
        .fill({ color: 0xf87171, alpha: 0.88 });

  // ── الجسم (منحني طبيعي بتدرّج ذهبي) ──
  const body = new PIXI.Graphics();
  const grad = new PIXI.FillGradient(-s*0.45, -s*0.5, s*0.6, s*0.5);
  grad.addColorStop(0, 0xfecaca);
  grad.addColorStop(0.35, 0xf87171);
  grad.addColorStop(0.75, 0xef4444);
  grad.addColorStop(1, 0xb91c1c);
  body.moveTo(-s*0.45, 0)
      .bezierCurveTo(-s*0.45, -s*0.5, s*0.2, -s*0.55, s*0.62, -s*0.32)
      .bezierCurveTo(s*0.95, -s*0.12, s*0.95, s*0.12, s*0.62, s*0.32)
      .bezierCurveTo(s*0.2, s*0.55, -s*0.45, s*0.5, -s*0.45, 0)
      .fill(grad);

  // بطن فاتح
  const belly = new PIXI.Graphics();
  belly.ellipse(s*0.15, s*0.28, s*0.4, s*0.13).fill({ color: 0xfffbeb, alpha: 0.4 });

  // انعكاسات ضوء (حراشف)
  const shine = new PIXI.Graphics();
  shine.ellipse(-s*0.1, -s*0.12, s*0.06, s*0.18).fill({ color: 0xffffff, alpha: 0.3 });
  shine.ellipse(s*0.08, -s*0.16, s*0.05, s*0.2).fill({ color: 0xffffff, alpha: 0.22 });

  // ── العين ──
  const eye = new PIXI.Graphics();
  eye.circle(s*0.58, -s*0.1, s*0.13).fill({ color: 0xffffff });
  eye.circle(s*0.61, -s*0.1, s*0.075).fill({ color: 0x1a1505 });
  eye.circle(s*0.63, -s*0.13, s*0.025).fill({ color: 0xffffff });

  // ابتسامة
  const mouth = new PIXI.Graphics();
  mouth.moveTo(s*0.78, s*0.02).bezierCurveTo(s*0.85, s*0.0, s*0.83, s*0.08, s*0.76, s*0.07)
       .stroke({ color: 0x7f1d1d, width: 1.5, alpha: 0.7 });

  container.addChild(tail, finTop, finBot, body, belly, shine, eye, mouth);
  container.alpha = 0.5;
  container.scale.set(0.85);
  layers.elements.addChild(container);

  animItems.push({
    type:'fish', g:container, tail,
    phase: Math.random()*Math.PI*2, baseX: cx, baseY: cy, consumed:false
  });
}

// ── رسم الجوهرة (ماسة ذهبية بأوجه لامعة) ──
function buildGem(cx, cy, size) {
  const container = new PIXI.Container();
  container.x = cx; container.y = cy;
  const s = size * 1.3; // مقياس الماسة

  const gem = new PIXI.Graphics();
  // الطاولة العلوية (أوجه متعددة) — أوسع
  gem.poly([ -s*0.4, -s*0.12,  -s*0.18, -s*0.24,  s*0.18, -s*0.24,  s*0.4, -s*0.12 ]).fill({ color: 0xfde68a });
  // مثلثات علوية
  gem.poly([ -s*0.18, -s*0.24,  s*0, -s*0.12,  s*0, -s*0.24 ]).fill({ color: 0xfef3c7 });
  gem.poly([ s*0.18, -s*0.24,  s*0, -s*0.12,  s*0, -s*0.24 ]).fill({ color: 0xfcd34d });
  gem.poly([ -s*0.4, -s*0.12,  s*0, -s*0.12,  -s*0.18, -s*0.24 ]).fill({ color: 0xfbbf24 });
  gem.poly([ s*0.4, -s*0.12,  s*0, -s*0.12,  s*0.18, -s*0.24 ]).fill({ color: 0xf59e0b });
  // الأوجه السفلية (قاعدة أقصر — تنتهي عند 0.44)
  gem.poly([ -s*0.4, -s*0.12,  s*0, -s*0.12,  s*0, s*0.44 ]).fill({ color: 0xf59e0b });
  gem.poly([ s*0.4, -s*0.12,  s*0, -s*0.12,  s*0, s*0.44 ]).fill({ color: 0xd97706 });
  // حدود
  gem.poly([ -s*0.4, -s*0.12,  s*0.4, -s*0.12,  s*0, s*0.44 ]).stroke({ color: 0xfffbeb, width: 1, alpha: 0.4 });
  gem.moveTo(0, -s*0.12).lineTo(0, s*0.44).stroke({ color: 0xfffbeb, width: 0.8, alpha: 0.3 });

  // بريق
  const shine = new PIXI.Graphics();
  shine.poly([ -s*0.26, -s*0.17,  -s*0.13, -s*0.17,  -s*0.18, -s*0.12,  -s*0.24, -s*0.12 ])
       .fill({ color: 0xffffff, alpha: 0.6 });

  // نجوم بريق متلألئة (sparkles)
  const sparkles = [];
  const spkPos = [ [s*0.5, -s*0.32, 2], [-s*0.54, s*0.24, 1.5], [s*0.48, s*0.26, 1.2] ];
  for (const [sx, sy, sr] of spkPos) {
    const sp = new PIXI.Graphics();
    sp.star(sx, sy, 4, sr*2, sr*0.7).fill({ color: 0xffffff });
    container.addChild(sp);
    sparkles.push(sp);
  }

  container.addChildAt(gem, 0);
  container.addChild(shine);
  container.alpha = 0.5;
  container.scale.set(0.85);
  layers.elements.addChild(container);

  animItems.push({
    type:'gem', g:container, sparkles,
    phase: Math.random()*Math.PI*2, baseX: cx, baseY: cy, consumed:false
  });
}

// ═══════════════════════════════════════════════════════
//  الخطوط التفاعلية
// ═══════════════════════════════════════════════════════
function buildEdges(cfg) {
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      if (c < cfg.cols-1) addEdge(r,c,r,c+1,cfg);
      if (r < cfg.rows-1) addEdge(r,c,r+1,c,cfg);
    }
  }
}

function addEdge(r1,c1,r2,c2,cfg) {
  const { spacing, padding } = cfg._pixi;
  const x1 = padding + c1*spacing, y1 = padding + r1*spacing;
  const x2 = padding + c2*spacing, y2 = padding + r2*spacing;
  const key = makeKey(r1,c1,r2,c2);

  const line = new PIXI.Graphics();
  drawLine(line, x1,y1,x2,y2, THEME.edgeIdle, 2.5);
  layers.edges.addChild(line);

  const glow = new PIXI.Graphics();
  glow.alpha = 0;
  layers.glow.addChild(glow);

  const hit = new PIXI.Graphics();
  const isH = r1 === r2;
  if (isH) hit.rect(Math.min(x1,x2)-6, y1-13, Math.abs(x2-x1)+12, 26).fill({ color:0xffffff, alpha:0 });
  else     hit.rect(x1-13, Math.min(y1,y2)-6, 26, Math.abs(y2-y1)+12).fill({ color:0xffffff, alpha:0 });
  hit.eventMode = 'static';
  hit.cursor = 'pointer';
  layers.edges.addChild(hit);

  const obj = { key, line, glow, x1,y1,x2,y2, r1,c1,r2,c2, drawn:false };

  hit.on('pointerover', () => {
    if (obj.drawn) return;
    drawLine(line, x1,y1,x2,y2, THEME.edgeHover, 3.5, 0.8);
    drawLine(glow, x1,y1,x2,y2, THEME.edgeHover, 9, 0.25); glow.alpha = 1;
  });
  hit.on('pointerout', () => {
    if (obj.drawn) return;
    drawLine(line, x1,y1,x2,y2, THEME.edgeIdle, 2.5);
    glow.clear(); glow.alpha = 0;
  });
  hit.on('pointertap', () => handleEdgeClick(obj, cfg));

  edgeObjects.push(obj);
}

function drawLine(g, x1,y1,x2,y2, color, width, alpha=1) {
  g.clear();
  g.moveTo(x1,y1).lineTo(x2,y2).stroke({ color, width, cap:'round', alpha });
}

// ═══════════════════════════════════════════════════════
//  النقر على خط
// ═══════════════════════════════════════════════════════
export function handleEdgeClick(obj, cfg, isOpponentMove=false) {
  if (isAIThinking && !isOpponentMove) return;
  if (cfg.aiMode === 'online' && !isOpponentMove && !onlineManager.isMyTurn(state.currentPlayer)) return;
  if (obj.drawn || state.lines.has(obj.key)) return;

  const player = state.currentPlayer;
  audioManager.playLineDraw();

  obj.drawn = true;
  state.lines.add(obj.key);
  animateLineDraw(obj, player);

  // فحص المربعات
  let completed = false;
  checkSquaresAround(obj.r1, obj.c1, obj.r2, obj.c2, cfg).forEach(([r,c]) => {
    fillSquare(r, c, cfg, player);
    state.scores[player] = (state.scores[player]||0) + 1;
    state.squaresFilled = (state.squaresFilled || 0) + 1;

    // العنصر الخاص
    const elType = getElementAt(r, c);
    if (elType === 'gem') {
      // الجوهرة → عملات للاعب الحالي (فقط لو هو المستخدم في AI/أونلاين)
      if (isCoinEarner(cfg, player)) {
        addMatchCoins(3);
        flashMessage('💎 +3 عملات!');
      }
    } else if (elType) {
      // عناصر أخرى (سمكة) → قدرة في المخزون
      addPower(player, elType);
      // بطاقة تعريف أول مرة — فقط للمستخدم نفسه
      if (isCoinEarner(cfg, player)) maybeShowTutorial(elType);
    }

    completed = true;
    audioManager.playSquareComplete();
  });

  updateScoreboard();
  refreshInventory(cfg);

  // نهاية اللعبة؟ — نعدّ المربعات المكتملة (مش النقاط، عشان الجوهرة ما تخرّب الحساب)
  const total = (cfg.rows-1)*(cfg.cols-1);
  if ((state.squaresFilled || 0) >= total) {
    if (cfg.aiMode==='online' && !isOpponentMove) onlineManager.pushMove(obj.key, Date.now());
    if (isTimerEnabled()) stopTurnTimer();
    endGame(cfg, state.scores);
    return;
  }

  // تأثير السمكة (خط إضافي): إذا كان مفعّلاً، اللاعب يلعب ثانيةً بغض النظر عن النتيجة
  const hadFreeLine = getEffect(player, 'free_line');
  if (hadFreeLine) clearEffect(player, 'free_line');

  // إيقاف المؤقّت فور الحركة (نعيد تشغيله حسب الحالة)
  if (isTimerEnabled()) stopTurnTimer();

  if (!completed) {
    if (hadFreeLine) {
      // الخط الإضافي: نفس اللاعب يكمل (لا نبدّل الدور)
      restartTimerIfHuman(cfg);
    } else {
      state.currentPlayer = (player % cfg.players) + 1;
      updateTurn(cfg);
    }
    refreshInventory(cfg);
  } else {
    // أكمل مربعاً — يلعب ثانيةً أصلاً، نعيد المؤقّت لنفس اللاعب
    restartTimerIfHuman(cfg);
    refreshInventory(cfg);
  }

  if (cfg.aiMode==='online' && !isOpponentMove) onlineManager.pushMove(obj.key, Date.now());
  setTimeout(() => triggerAI(cfg), 100);
}

// يعيد تشغيل المؤقّت لو الدور الحالي بشري
function restartTimerIfHuman(cfg) {
  if (!isTimerEnabled()) return;
  const humanTurn =
    cfg.aiMode === "ai"     ? state.currentPlayer === 1 :
    cfg.aiMode === "online" ? state.currentPlayer === cfg.onlinePlayerNum :
    true;
  if (humanTurn) startTurnTimer();
}

// ═══════════════════════════════════════════════════════
//  أنميشن رسم الخط (بلون اللاعب)
// ═══════════════════════════════════════════════════════
function animateLineDraw(obj, player) {
  const { line, glow, x1,y1,x2,y2 } = obj;
  const color = pColor(player), glowC = pGlow(player);
  let t = 0;
  const step = () => {
    t = Math.min(t + 0.14, 1);
    const mx = x1+(x2-x1)*t, my = y1+(y2-y1)*t;
    drawLine(line, x1,y1,mx,my, color, 4.5);
    drawLine(glow, x1,y1,mx,my, glowC, 10, 0.3); glow.alpha = 1;
    if (t < 1) requestAnimationFrame(step);
    else fadeGlow(glow);
  };
  requestAnimationFrame(step);
}

function fadeGlow(glow) {
  let a = 0.3;
  const step = () => {
    a -= 0.015;
    glow.alpha = Math.max(a, 0);
    if (a > 0) requestAnimationFrame(step);
    else { glow.clear(); glow.alpha = 0; }
  };
  setTimeout(() => requestAnimationFrame(step), 250);
}

// ═══════════════════════════════════════════════════════
//  تعبئة مربع (بلون اللاعب) + جسيمات
// ═══════════════════════════════════════════════════════
export function fillSquare(r, c, cfg, player) {
  const { spacing, padding } = cfg._pixi;
  const x = padding + c*spacing + 3;
  const y = padding + r*spacing + 3;
  const w = spacing - 6, h = spacing - 6;
  const color = pColor(player), glowC = pGlow(player);
  const cx = x + w/2, cy = y + h/2;

  // هل فيه عنصر خاص؟
  const elType = getElementAt(r, c);

  const sq = new PIXI.Graphics();
  layers.squares.addChild(sq);

  // الرقم يظهر فقط لو ما فيه عنصر (العنصر ياخذ مكانه)
  let label = null;
  if (!elType) {
    label = new PIXI.Text({ text:String(player), style:{
      fill: color, fontSize: Math.floor(spacing*0.3), fontWeight:'bold', fontFamily:'sans-serif'
    }});
    label.anchor.set(0.5); label.x = cx; label.y = cy; label.alpha = 0;
    layers.squares.addChild(label);
  }

  let t = 0;
  const step = () => {
    t = Math.min(t + 0.06, 1);
    sq.clear();
    sq.roundRect(x,y,w,h,6).fill({ color, alpha: t*THEME.squareAlpha });
    if (label) label.alpha = t*0.4;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);

  if (elType) {
    activateElement(r, c, elType, cx, cy, spacing);
    const el = ELEMENTS[elType];
    spawnBurst(cx, cy, el.color);
    // امتلاء الماء لمربع السمكة
    if (elType === 'water') fillWaterSquare(x, y, w, h);
  } else {
    spawnBurst(cx, cy, color);
  }
}

// ── امتلاء الماء (أنيق + سريع) لمربع السمكة ──
function fillWaterSquare(x, y, w, h) {
  // قناع لحصر الماء داخل المربع
  const mask = new PIXI.Graphics();
  mask.roundRect(x, y, w, h, 6).fill(0xffffff);
  layers.squares.addChild(mask);

  const water = new PIXI.Graphics();
  water.mask = mask;
  layers.squares.addChild(water);

  // موجة السطح
  const wave = new PIXI.Graphics();
  wave.mask = mask;
  layers.squares.addChild(wave);

  let level = 0;            // 0 → 1 (نسبة الامتلاء)
  const item = {
    type:'water_fill', water, wave, mask, x, y, w, h,
    level: 0, filling: true, phase: 0
  };
  animItems.push(item);

  // أنميشن الامتلاء السريع
  const fillStep = () => {
    level = Math.min(level + 0.05, 1); // ~0.4 ثانية
    item.level = level;
    if (level < 1) requestAnimationFrame(fillStep);
    else item.filling = false;
  };
  requestAnimationFrame(fillStep);
}

// ═══════════════════════════════════════════════════════
//  تفعيل العنصر عند إكمال مربعه — يحيا!
// ═══════════════════════════════════════════════════════
function activateElement(r, c, type, cx, cy, spacing) {
  // نلاقي العنصر (سمكة أو أيقونة) ونفعّله
  const item = animItems.find(it =>
    (it.type==='element' || it.type==='fish' || it.type==='gem') &&
    Math.abs((it.baseX ?? it.g.x)-cx)<2 && Math.abs(it.baseY-cy)<2
  );
  if (!item) return;
  item.consumed = true;
  const g = item.g;

  // animation: تكبر وتلمع وتثبت واضحة (قفزة)
  let s = item.type==='fish' ? 0.9 : 1;
  const target = item.type==='fish' ? 1.25 : 1.35;
  const grow = () => {
    s += 0.06;
    g.scale.set(Math.min(s, target));
    g.alpha = Math.min(g.alpha + 0.06, 1);
    if (s < target) requestAnimationFrame(grow);
    else {
      let s2 = target;
      const settle = () => { s2 -= 0.025; g.scale.set(Math.max(s2, item.type==='fish'?1:1)); if (s2>1) requestAnimationFrame(settle); };
      requestAnimationFrame(settle);
    }
  };
  requestAnimationFrame(grow);
  g.alpha = 1;
}


// ═══════════════════════════════════════════════════════
//  جسيمات الإكمال
// ═══════════════════════════════════════════════════════
function spawnBurst(cx, cy, color) {
  for (let i = 0; i < 14; i++) {
    const p = new PIXI.Graphics();
    p.circle(0,0, 2+Math.random()*2.5).fill({ color });
    p.x = cx; p.y = cy;
    layers.fx.addChild(p);
    const ang = (i/14)*Math.PI*2 + Math.random()*0.3;
    const spd = 2.5 + Math.random()*2.5;
    animItems.push({
      type:'particle', g:p,
      vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd, life:1
    });
  }
  // حلقة
  const ring = new PIXI.Graphics();
  layers.fx.addChild(ring);
  animItems.push({ type:'ring', g:ring, cx, cy, color, size:0, life:1 });
}

// ═══════════════════════════════════════════════════════
//  ticker مركزي — يدير كل الحركة
// ═══════════════════════════════════════════════════════
let _t = 0;
function ticker() {
  _t += 0.02;

  // جسيمات الخلفية
  for (const p of ambientParticles) {
    p.g.y -= p.speed;
    p.g.x += Math.sin(_t + p.phase) * p.drift;
    p.g.alpha = 0.25 + Math.sin(_t*2 + p.phase)*0.2;
    if (p.g.y < -5) { p.g.y = (_cfg._pixi.H||400) + 5; p.g.x = Math.random()*(_cfg._pixi.W||400); }
  }

  // عناصر حية + جسيمات + حلقات
  for (let i = animItems.length - 1; i >= 0; i--) {
    const it = animItems[i];
    if (it.type === 'dot') {
      const s = 1 + Math.sin(_t + it.phase)*0.12;
      it.g.scale.set(s);
    } else if (it.type === 'element') {
      // نبض + طفو خفيف
      if (!it.consumed) {
        it.g.alpha = 0.35 + Math.sin(_t*1.5 + it.phase)*0.15;
        it.g.y = it.baseY + Math.sin(_t*1.2 + it.phase)*2;
      }
    } else if (it.type === 'fish') {
      // السمكة تسبح: تطفو + تتمايل + ذيلها يتحرك
      if (!it.consumed) {
        it.g.alpha = 0.45 + Math.sin(_t*1.5 + it.phase)*0.18;
        it.g.y = it.baseY + Math.sin(_t*1.3 + it.phase)*2.5;
        it.g.x = it.baseX + Math.sin(_t*0.8 + it.phase)*1.5;
        it.g.rotation = Math.sin(_t*1.1 + it.phase)*0.08;
      } else {
        it.g.alpha = 1;
        it.g.y = it.baseY + Math.sin(_t*2 + it.phase)*1.5;
        it.g.rotation = Math.sin(_t*1.6 + it.phase)*0.06;
      }
      // الذيل يتحرك دائماً
      if (it.tail) it.tail.skew.y = Math.sin(_t*6 + it.phase)*0.3;
    } else if (it.type === 'gem') {
      // الجوهرة: تطفو + تتمايل + بريق نابض
      if (!it.consumed) {
        it.g.alpha = 0.45 + Math.sin(_t*1.6 + it.phase)*0.18;
        it.g.y = it.baseY + Math.sin(_t*1.2 + it.phase)*2.2;
        it.g.rotation = Math.sin(_t*0.9 + it.phase)*0.12;
      } else {
        it.g.alpha = 1;
        it.g.y = it.baseY + Math.sin(_t*2 + it.phase)*1.5;
        it.g.rotation = Math.sin(_t*1.4 + it.phase)*0.1;
      }
      // تلألؤ النجوم
      if (it.sparkles) {
        it.sparkles.forEach((sp, k) => {
          sp.alpha = 0.3 + Math.abs(Math.sin(_t*2.5 + k*1.7 + it.phase))*0.7;
          const sc = 0.7 + Math.abs(Math.sin(_t*2.5 + k*1.7 + it.phase))*0.5;
          sp.scale.set(sc);
        });
      }
    } else if (it.type === 'water_fill') {
      // ارتفاع الماء حسب level + موجة سطح
      const wh = it.h * it.level;
      const wy = it.y + it.h - wh;
      it.water.clear();
      if (wh > 1) {
        it.water.rect(it.x, wy, it.w, wh)
          .fill({ color: 0x1d4ed8, alpha: 0.55 });
        it.water.rect(it.x, it.y + it.h - wh*0.5, it.w, wh*0.5)
          .fill({ color: 0x1e3a8a, alpha: 0.3 });
      }
      // موجة السطح (خفيفة، مستمرة بعد الاستقرار)
      it.phase += 0.06;
      it.wave.clear();
      if (it.level > 0.05) {
        const amp = it.filling ? 3 : 1.5;
        it.wave.moveTo(it.x, wy);
        for (let xx = 0; xx <= it.w; xx += 4) {
          const yy = wy + Math.sin(xx*0.25 + it.phase)*amp;
          it.wave.lineTo(it.x + xx, yy);
        }
        it.wave.lineTo(it.x + it.w, wy + 4);
        it.wave.lineTo(it.x, wy + 4);
        it.wave.fill({ color: 0x60a5fa, alpha: 0.35 });
      }
    } else if (it.type === 'particle') {
      it.life -= 0.04;
      it.g.x += it.vx; it.g.y += it.vy*0.9; it.vy += 0.05;
      it.g.alpha = Math.max(it.life,0);
      it.g.scale.set(Math.max(it.life,0));
      if (it.life <= 0) { layers.fx.removeChild(it.g); animItems.splice(i,1); }
    } else if (it.type === 'ring') {
      it.life -= 0.05; it.size += 4;
      it.g.clear();
      it.g.circle(it.cx, it.cy, it.size).stroke({ color: it.color, width:2, alpha: it.life*0.6 });
      if (it.life <= 0) { layers.fx.removeChild(it.g); animItems.splice(i,1); }
    }
  }
}

// ═══════════════════════════════════════════════════════
//  AI
// ═══════════════════════════════════════════════════════
export function triggerAI(cfg) {
  if (!aiPlayer || state.currentPlayer !== 2 || isAIThinking) return;
  isAIThinking = true;
  // حساب في الخلفية (Web Worker) — الأنميشن يكمّل بسلاسة أثناء التفكير
  setTimeout(() => {
    const movePromise = aiPlayer.makeMoveAsync
      ? aiPlayer.makeMoveAsync(cfg)
      : Promise.resolve(aiPlayer.makeMove(cfg));
    movePromise.then((move) => {
      isAIThinking = false;
      if (!move) return;
      const obj = edgeObjects.find(e => e.key === move.key);
      if (obj && !obj.drawn) handleEdgeClick(obj, cfg);
    });
  }, 300);
}

// ═══════════════════════════════════════════════════════
//  تفعيل قدرة من المخزون
// ═══════════════════════════════════════════════════════
export function activatePower(elementType, player, cfg) {
  // لا يُفعّل إلا في دور اللاعب نفسه
  if (state.currentPlayer !== player) {
    flashMessage('⏳ ليس دورك الآن');
    return;
  }
  if (!hasPower(player, elementType)) return;

  if (elementType === 'water') {
    // لو عنده free_line مفعّل أصلاً، لا داعي لتفعيل ثانية
    if (getEffect(player, 'free_line')) {
      flashMessage('🐟 لديك خط إضافي بالفعل!');
      return;
    }
    consumePower(player, 'water');
    setEffect(player, 'free_line', true);
    flashMessage('🐟 لك خط إضافي!');
  } else if (elementType === 'time_reduce') {
    consumePower(player, 'time_reduce');
    // نحدّد الخصم ونضع علامة قصّ على دوره القادم
    const opponent = (player % cfg.players) + 1;
    setEffect(opponent, 'time_cut', 5);
    flashMessage('⏬ قصّيت وقت خصمك!');
  }
  refreshInventory(cfg);
}

// رسالة عابرة وسط اللوحة
function flashMessage(text) {
  if (!app) return;
  const msg = new PIXI.Text({ text, style:{
    fill: 0xffffff, fontSize: 18, fontWeight:'bold', fontFamily:'sans-serif',
    stroke: { color: 0x0a1815, width: 4 },
  }});
  msg.anchor.set(0.5);
  msg.x = app.screen.width/2;
  msg.y = app.screen.height/2;
  layers.fx.addChild(msg);
  let life = 1;
  const step = () => {
    life -= 0.012;
    msg.alpha = Math.min(life*1.5, 1);
    msg.y -= 0.5;
    if (life > 0) requestAnimationFrame(step);
    else layers.fx.removeChild(msg);
  };
  requestAnimationFrame(step);
}

// ═══════════════════════════════════════════════════════
//  أونلاين
// ═══════════════════════════════════════════════════════
export function applyOnlineMove(lineKey, cfg) {
  if (state.lines.has(lineKey)) return;
  const obj = edgeObjects.find(e => e.key === lineKey);
  if (obj && !obj.drawn) handleEdgeClick(obj, cfg, true);
}

// ═══════════════════════════════════════════════════════
//  reset
// ═══════════════════════════════════════════════════════
export function resetState() {
  state.currentPlayer = 1;
  state.lines = new Set();
  if (state.scores) for (const k in state.scores) state.scores[k] = 0;
  animItems = [];
  ambientParticles = [];
  if (app) { try { app.destroy({ removeView: false }, { children: true, texture: true }); } catch(e){} app = null; }
}
