// 📄 boardRenderer.js — v11.8
// مسؤول عن رسم اللوحة — currentPlayer موحّد في state دائماً

import { state }                           from "../core/state.js?v=1780436760";
import { makeKey }                         from "../utils.js?v=1780436760";
import { config }                          from "../config/config.js?v=1780436760";
import { renderScoreboard, updateScoreboard } from "./scoreboard.js?v=1780436760";
import { updateTurn, updateTurnUI }        from "./turnManager.js?v=1780436760";
import { endGame }                         from "./gameEnd.js?v=1780436760";
import { audioManager }                    from "../audio/audioManager.js?v=1780436760";
import { checkSquaresAround }              from "../core/logic.js?v=1780436760";
import { onlineManager }                   from "../firebase.js?v=1780436760";

// ─── AI ──────────────────────────────────────────────────────────
let aiPlayer    = null;
let isAIThinking = false;

// ─── تهيئة النقاط ────────────────────────────────────────────────
function initScores(cfg) {
  state.scores = {};
  for (let i = 1; i <= cfg.players; i++) state.scores[i] = 0;
}

// ─── تهيئة اللوحة ────────────────────────────────────────────────
export function initBoard(cfg, ai = null) {
  aiPlayer = ai;

  while (cfg.colors.length < cfg.players) {
    cfg.colors.push(`hsl(${Math.floor(Math.random()*360)},70%,50%)`);
  }

  const svg = document.getElementById("board");
  if (!svg) return;

  const width  = cfg.margin*2 + (cfg.cols-1)*cfg.spacing + cfg.dotRadius*2;
  const height = cfg.margin*2 + (cfg.rows-1)*cfg.spacing + cfg.dotRadius*2;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const ns = "http://www.w3.org/2000/svg";
  const squaresGroup = document.createElementNS(ns,"g"); squaresGroup.id="squares";
  const edgesGroup   = document.createElementNS(ns,"g"); edgesGroup.id="edges";
  const dotsGroup    = document.createElementNS(ns,"g"); dotsGroup.id="dots";
  svg.append(squaresGroup, edgesGroup, dotsGroup);

  for (let r=0;r<cfg.rows;r++) {
    for (let c=0;c<cfg.cols;c++) {
      const dot = document.createElementNS(ns,"circle");
      dot.setAttribute("cx", cfg.margin + c*cfg.spacing);
      dot.setAttribute("cy", cfg.margin + r*cfg.spacing);
      dot.setAttribute("r",  cfg.dotRadius);
      dot.setAttribute("class","dot");
      dotsGroup.appendChild(dot);
    }
  }

  // ✅ state.currentPlayer هو المصدر الوحيد للحقيقة
  state.currentPlayer = 1;
  state.lines = new Set();
  initScores(cfg);
  renderScoreboard(cfg);
  updateScoreboard();
  updateTurnUI(cfg);

  for (let r=0;r<cfg.rows;r++) {
    for (let c=0;c<cfg.cols;c++) {
      if (c<cfg.cols-1) drawEdge(r,c,r,c+1,cfg);
      if (r<cfg.rows-1) drawEdge(r,c,r+1,c,cfg);
    }
  }
  updateTurn(cfg);
}

// ─── رسم خط ──────────────────────────────────────────────────────
function drawEdge(r1,c1,r2,c2,cfg) {
  const ns="http://www.w3.org/2000/svg";
  const edge=document.createElementNS(ns,"line");
  edge.setAttribute("x1", cfg.margin+c1*cfg.spacing);
  edge.setAttribute("y1", cfg.margin+r1*cfg.spacing);
  edge.setAttribute("x2", cfg.margin+c2*cfg.spacing);
  edge.setAttribute("y2", cfg.margin+r2*cfg.spacing);
  edge.setAttribute("class","edge");
  edge.dataset.r1=r1; edge.dataset.c1=c1;
  edge.dataset.r2=r2; edge.dataset.c2=c2;
  edge.addEventListener("click", ()=>handleEdgeClick(edge,cfg));
  document.getElementById("edges").appendChild(edge);
}

// ─── معالجة نقر الخط ─────────────────────────────────────────────
export function handleEdgeClick(edge, cfg, isOpponentMove = false) {
  if (isAIThinking) return;

  // 🌐 أونلاين: امنع اللعب في دور الخصم (إلا إذا كانت حركة الخصم نفسه)
  if (cfg.aiMode === "online" && !isOpponentMove && !onlineManager.isMyTurn(state.currentPlayer)) return;

  const r1=parseInt(edge.dataset.r1,10), c1=parseInt(edge.dataset.c1,10);
  const r2=parseInt(edge.dataset.r2,10), c2=parseInt(edge.dataset.c2,10);
  const key = makeKey(r1,c1,r2,c2);
  if (state.lines.has(key)) return;

  audioManager.playLineDraw();

  // لوّن الخط بلون اللاعب الحالي
  edge.classList.remove("edge-p1","edge-p2","edge-p3","edge-p4");
  edge.classList.add(`edge-p${state.currentPlayer}`);
  edge.style.stroke = cfg.colors[state.currentPlayer-1];
  edge.style.strokeWidth = "3";

  state.lines.add(key);

  // تحقق من المربعات المكتملة
  let squareCompleted = false;
  checkSquaresAround(r1,c1,r2,c2,cfg).forEach(([r,c]) => {
    fillSquare(r,c,cfg,state.currentPlayer);
    if (!state.scores) state.scores={};
    state.scores[state.currentPlayer] = (state.scores[state.currentPlayer]||0)+1;
    squareCompleted = true;
    audioManager.playSquareComplete();
  });

  updateScoreboard();

  // تحقق نهاية اللعبة
  const totalSquares = (cfg.rows-1)*(cfg.cols-1);
  const filled = Object.values(state.scores||{}).reduce((a,b)=>(+a||0)+(+b||0),0);
  if (filled===totalSquares) {
    if (cfg.aiMode==="online" && !isOpponentMove) {
      onlineManager.pushMove(key, Date.now());
    }
    endGame(cfg,state.scores);
    return;
  }

  // انتقل للاعب التالي إذا ما كمّل مربع
  if (!squareCompleted) {
    state.currentPlayer = (state.currentPlayer % cfg.players) + 1;
    updateTurn(cfg);
  }

  // 🌐 إرسال الحركة للخصم (فقط إذا كانت حركتي أنا، مش حركة الخصم)
  if (cfg.aiMode === "online" && !isOpponentMove) {
    onlineManager.pushMove(key, Date.now());
  }

  setTimeout(()=>triggerAIIfNeeded(cfg), 100);
}

// ─── AI ──────────────────────────────────────────────────────────
function triggerAIIfNeeded(cfg) {
  if (!aiPlayer || state.currentPlayer!==2 || isAIThinking) return;
  isAIThinking=true;
  setTimeout(()=>executeAIMove(cfg), 400);
}

function executeAIMove(cfg) {
  const move = aiPlayer.makeMove(cfg);
  if (!move) { isAIThinking=false; return; }
  if (state.lines.has(move.key)) { isAIThinking=false; setTimeout(()=>triggerAIIfNeeded(cfg),100); return; }
  const edge = findEdgeElement(move.r1,move.c1,move.r2,move.c2);
  if (!edge) { isAIThinking=false; return; }
  isAIThinking=false;
  handleEdgeClick(edge,cfg);
}

function findEdgeElement(r1,c1,r2,c2) {
  for (const edge of document.querySelectorAll('#edges line')) {
    const er1=+edge.dataset.r1, ec1=+edge.dataset.c1;
    const er2=+edge.dataset.r2, ec2=+edge.dataset.c2;
    if ((er1===r1&&ec1===c1&&er2===r2&&ec2===c2)||(er1===r2&&ec1===c2&&er2===r1&&ec2===c1)) return edge;
  }
  return null;
}

// ─── تلوين مربع ──────────────────────────────────────────────────
export function fillSquare(r,c,cfg,player) {
  const ns="http://www.w3.org/2000/svg";
  const rect=document.createElementNS(ns,"rect");
  rect.setAttribute("x", c*cfg.spacing+cfg.margin);
  rect.setAttribute("y", r*cfg.spacing+cfg.margin);
  rect.setAttribute("width",  cfg.spacing);
  rect.setAttribute("height", cfg.spacing);
  rect.setAttribute("fill", cfg.colors[player-1]||"rgba(0,0,0,0.3)");
  rect.setAttribute("fill-opacity","0.4");
  document.getElementById("squares")?.appendChild(rect);
  requestAnimationFrame(()=>rect.classList.add("filled"));
}

// ─── تطبيق حركة الخصم الأونلاين ─────────────────────────────────
export function applyOnlineMove(lineKey, cfg) {
  if (state.lines.has(lineKey)) return; // خلاص طُبّقت
  for (const edge of document.querySelectorAll('#edges line')) {
    const key = makeKey(+edge.dataset.r1,+edge.dataset.c1,+edge.dataset.r2,+edge.dataset.c2);
    if (key === lineKey) {
      handleEdgeClick(edge, cfg, true);
      return;
    }
  }
}

// ─── reset ───────────────────────────────────────────────────────
export function resetState() {
  state.currentPlayer = 1;
  state.lines = new Set();
  if (state.scores) for (const k in state.scores) state.scores[k]=0;
}
