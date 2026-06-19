// 📄 boardRenderer.js — v18.0 (Living Board — clean architecture)
// طبقات منظمة + ticker مركزي + نظام جاهز للعناصر الخاصة

import { state }                              from "../core/state.js?v=1781893389";
import { makeKey }                            from "../utils.js?v=1781893389";
import { renderScoreboard, updateScoreboard } from "./scoreboard.js?v=1781893389";
import { updateTurn, updateTurnUI }           from "./turnManager.js?v=1781893389";
import { endGame }                            from "./gameEnd.js?v=1781893389";
import { audioManager }                       from "../audio/audioManager.js?v=1781893389";
import { checkSquaresAround }                 from "../core/logic.js?v=1781893389";
import { onlineManager }                      from "../firebase.js?v=1781893389";
import { generateSpecialSquares, getElementAt, ELEMENTS } from "../core/specialSquares.js?v=1781893389";
import { resetPowers, addPower, getEffect, clearEffect, consumePower, setEffect, hasPower } from "../core/powers.js?v=1781893389";
import { refreshInventory } from "./powersUI.js?v=1781893389";
import { resetMatchCoins, addMatchCoins } from "../core/wallet.js?v=1781893389";

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
      const el = ELEMENTS[type];
      const cx = padding + c*spacing + spacing/2;
      const cy = padding + r*spacing + spacing/2;

      // أيقونة خافتة نابضة
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
    endGame(cfg, state.scores);
    return;
  }

  if (!completed) {
    // تأثير السمكة: خط إضافي — ما نبدّل الدور
    if (getEffect(player, 'free_line')) {
      clearEffect(player, 'free_line');
      // نفس اللاعب يكمل
    } else {
      state.currentPlayer = (player % cfg.players) + 1;
      updateTurn(cfg);
    }
    refreshInventory(cfg);
  }

  if (cfg.aiMode==='online' && !isOpponentMove) onlineManager.pushMove(obj.key, Date.now());
  setTimeout(() => triggerAI(cfg), 100);
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
  } else {
    spawnBurst(cx, cy, color);
  }
}

// ═══════════════════════════════════════════════════════
//  تفعيل العنصر عند إكمال مربعه — يحيا!
// ═══════════════════════════════════════════════════════
function activateElement(r, c, type, cx, cy, spacing) {
  const el = ELEMENTS[type];
  // نلاقي أيقونة العنصر الخافتة ونفعّلها
  const item = animItems.find(it => it.type==='element' && Math.abs(it.g.x-cx)<2 && Math.abs(it.baseY-cy)<2);
  if (item) {
    item.consumed = true;
    const icon = item.g;
    // animation: تكبر وتلمع وتثبت واضحة
    let s = 1;
    const grow = () => {
      s += 0.06;
      icon.scale.set(Math.min(s, 1.35));
      icon.alpha = Math.min(icon.alpha + 0.05, 1);
      if (s < 1.35) requestAnimationFrame(grow);
      else {
        // ترتد لحجمها الطبيعي وتبقى واضحة
        let s2 = 1.35;
        const settle = () => { s2 -= 0.03; icon.scale.set(Math.max(s2,1)); if (s2>1) requestAnimationFrame(settle); };
        requestAnimationFrame(settle);
      }
    };
    requestAnimationFrame(grow);

    // نبقيها واضحة (ما تنبض بعد التفعيل)
    icon.alpha = 1;
  }
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
function triggerAI(cfg) {
  if (!aiPlayer || state.currentPlayer !== 2 || isAIThinking) return;
  isAIThinking = true;
  setTimeout(() => {
    const move = aiPlayer.makeMove(cfg);
    isAIThinking = false;
    if (!move) return;
    const obj = edgeObjects.find(e => e.key === move.key);
    if (obj && !obj.drawn) handleEdgeClick(obj, cfg);
  }, 500);
}

// ═══════════════════════════════════════════════════════
//  تفعيل قدرة من المخزون
// ═══════════════════════════════════════════════════════
export function activatePower(elementType, player, cfg) {
  if (!hasPower(player, elementType)) return;
  if (state.currentPlayer !== player) return;

  if (elementType === 'water') {
    // السمكة: دور إضافي (خط مجاني)
    consumePower(player, 'water');
    setEffect(player, 'free_line', true);
    flashMessage('🐟 لك خط إضافي!');
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
