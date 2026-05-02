// 📄 boardRenderer.js
// مسؤول عن رسم اللوحة وتحديث الـSVG
// Renders the game board and updates SVG

// boardRenderer.js — SVG drawing & interactions (trimmed functions moved to ui/*)

import { state } from "../core/state.js";
import { makeKey } from "../utils.js";
import { config } from "../config/config.js";
import { renderScoreboard, updateScoreboard } from "./scoreboard.js";
import { updateTurn, updateTurnUI } from "./turnManager.js";
import { endGame } from "./gameEnd.js";
import { audioManager } from "../audio/audioManager.js";

// import { makeKey } from "./utils.js";
import { checkSquaresAround } from "../core/logic.js";

export let lines = new Set();
export let currentPlayer = 1; // اللاعب الحالي (1 أو 2)

// 🤖 AI Player
let aiPlayer = null;
let isAIThinking = false; // منع اللاعب من اللعب أثناء دور AI

// 🟢 تهيئة النقاط لكل لاعب
function initScores(cfg) {
  state.scores = {};
  for (let i = 1; i <= cfg.players; i++) {
    state.scores[i] = 0;
  }
}

export // تهيئة اللوحة
function initBoard(cfg, ai = null) {
  // 🤖 حفظ AI player
  aiPlayer = ai;
  
  if (aiPlayer) {
    console.log('🤖 AI Player initialized with difficulty:', aiPlayer.difficulty);
  }
  
  // ✅ تأكد أن عدد الألوان يطابق عدد اللاعبين
  while (cfg.colors.length < cfg.players) {
    const hue = Math.floor(Math.random() * 360);
    cfg.colors.push(`hsl(${hue}, 70%, 50%)`);
  }

  const svg = document.getElementById("board");
  if (!svg) {
    return;
  }

  const width =
    cfg.margin * 2 + (cfg.cols - 1) * cfg.spacing + cfg.dotRadius * 2;
  const height =
    cfg.margin * 2 + (cfg.rows - 1) * cfg.spacing + cfg.dotRadius * 2;

  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // 🆕 إنشاء المجموعات (layers)
  const ns = "http://www.w3.org/2000/svg";
  const squaresGroup = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g"
  );
  squaresGroup.setAttribute("id", "squares");
  const edgesGroup = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g"
  );
  edgesGroup.setAttribute("id", "edges");
  const dotsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  dotsGroup.setAttribute("id", "dots");

  svg.appendChild(squaresGroup);
  svg.appendChild(edgesGroup);
  svg.appendChild(dotsGroup);

  // 🆕 رسم كل النقاط
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      const cx = cfg.margin + c * cfg.spacing;
      const cy = cfg.margin + r * cfg.spacing;

      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", cx);
      dot.setAttribute("cy", cy);
      dot.setAttribute("r", cfg.dotRadius);
      dot.setAttribute("class", "dot");
      dot.dataset.row = r;
      dot.dataset.col = c;

      document.getElementById("dots").appendChild(dot);
    }
  }

  initScores(cfg); // 🆕 تهيئة النقاط;
  renderScoreboard(cfg); // 🆕 بناء scoreboard;
  currentPlayer = 1; // 🆕 إعادة تعيين اللاعب الحالي;
  lines = new Set(); // 🆕 إعادة تعيين الخطوط المحلية;
  state.lines = lines; // 🆕 ربط state.lines مع lines المحلي;
  updateScoreboard(); // 🆕 تحديث scoreboard;
  updateTurnUI(cfg); // 🆕 تحديث UI الدور;

  // 🆕 رسم كل الخطوط (edges) الممكنة
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      if (c < cfg.cols - 1) {
        drawEdge(r, c, r, c + 1, cfg); // خط أفقي;
      }
      if (r < cfg.rows - 1) {
        drawEdge(r, c, r + 1, c, cfg); // خط عمودي;
      }
    }
  }

  updateTurn(cfg); // 🆕 أول مرة نعرض الدور;
}

// 🆕 رسم خط (edge) رمادي مع بياناته
function drawEdge(r1, c1, r2, c2, cfg) {
  const x1 = cfg.margin + c1 * cfg.spacing;
  const y1 = cfg.margin + r1 * cfg.spacing;
  const x2 = cfg.margin + c2 * cfg.spacing;
  const y2 = cfg.margin + r2 * cfg.spacing;

  const ns = "http://www.w3.org/2000/svg";
  const edge = document.createElementNS(ns, "line");
  edge.setAttribute("x1", x1);
  edge.setAttribute("y1", y1);
  edge.setAttribute("x2", x2);
  edge.setAttribute("y2", y2);
  edge.setAttribute("class", "edge");

  edge.dataset.r1 = r1;
  edge.dataset.c1 = c1;
  edge.dataset.r2 = r2;
  edge.dataset.c2 = c2;

  edge.addEventListener("click", () => handleEdgeClick(edge, cfg));

  document.getElementById("edges").appendChild(edge);
}

// 🆕 معالجة نقرات الخطوط (edges)
function handleEdgeClick(edge, cfg) {
  // 🤖 منع اللاعب من اللعب أثناء دور AI
  if (isAIThinking) {
    console.log('⏳ انتظر... الكمبيوتر يفكر');
    return;
  }
  
  const r1 = parseInt(edge.dataset.r1, 10);
  const c1 = parseInt(edge.dataset.c1, 10);
  const r2 = parseInt(edge.dataset.r2, 10);
  const c2 = parseInt(edge.dataset.c2, 10);

  const key = makeKey(r1, c1, r2, c2);
  if (state.lines.has(key)) return;

  // 🔊 تشغيل صوت رسم الخط
  audioManager.playLineDraw();

  // شيل الكلاسات القديمة لو كان عليها
  edge.classList.remove("edge-p1", "edge-p2");

  // ✅ ضيف الكلاس المناسب للاعب الحالي (داعم لأي عدد لاعبين)
  edge.classList.add(`edge-p${currentPlayer}`);

  // ✅ أعطِ اللون مباشرة من config.colors
  edge.style.stroke = cfg.colors[currentPlayer - 1];
  edge.style.strokeWidth = "3"; // 🆕 اجعل الخط أعرض عند النقر;

  state.lines.add(key);
  lines.add(key); // نحتفظ بنسخة محلية للتوافق

  let squareCompleted = false;
  checkSquaresAround(r1, c1, r2, c2, cfg).forEach(([r, c]) => {
    fillSquare(r, c, cfg, currentPlayer);
    if (!state.scores) state.scores = {};
    state.scores[currentPlayer] = (state.scores[currentPlayer] || 0) + 1;
    squareCompleted = true;
    
    // 🔊 تشغيل صوت إكمال المربع
    audioManager.playSquareComplete();
  });

  updateScoreboard();

  // 🆕 تحقق إذا اللعبة انتهت
  const totalSquares = (cfg.rows - 1) * (cfg.cols - 1);
  const filled = Object.values(state.scores || {}).reduce(
    (a, b) => (Number(a) || 0) + (Number(b) || 0),
    0
  );

  if (filled === totalSquares) {
    endGame(cfg, state.scores);
    return; // توقف;
  }

  if (!squareCompleted) {
    currentPlayer = (currentPlayer % cfg.players) + 1;
    updateTurn(cfg);
  }
  
  // 🤖 تحقق إذا دور AI وشغّله
  setTimeout(() => {
    triggerAIIfNeeded(cfg);
  }, 100);
}

// 🤖 تشغيل AI إذا كان دوره
function triggerAIIfNeeded(cfg) {
  // تحقق: هل في AI؟ هل دوره؟ هل مشغول؟
  if (!aiPlayer || currentPlayer !== 2 || isAIThinking) {
    return;
  }
  
  console.log('🤖 AI Turn - Player', currentPlayer);
  
  isAIThinking = true;
  
  setTimeout(() => {
    executeAIMove(cfg);
  }, 400);
}

// 🤖 تنفيذ حركة واحدة من AI
function executeAIMove(cfg) {
  console.log('🤖 AI is making a move...');
  
  // الحصول على الحركة
  const move = aiPlayer.makeMove(cfg);
  
  if (!move) {
    console.warn('⚠️ AI has no moves');
    isAIThinking = false;
    return;
  }
  
  // ✅ تحقق: هل الخط ملعوب فعلاً؟
  if (lines.has(move.key)) {
    console.error('❌ AI tried to play an already-played line!', move);
    isAIThinking = false;
    // حاول مرة ثانية
    setTimeout(() => {
      triggerAIIfNeeded(cfg);
    }, 100);
    return;
  }
  
  console.log('🤖 AI chose:', move);
  
  // إيجاد الخط في DOM
  const edge = findEdgeElement(move.r1, move.c1, move.r2, move.c2);
  
  if (!edge) {
    console.error('❌ Edge not found!');
    isAIThinking = false;
    return;
  }
  
  // تنفيذ الحركة
  isAIThinking = false; // نحرر الـ flag قبل التنفيذ
  handleEdgeClick(edge, cfg);
}

// 🔍 إيجاد عنصر الخط في DOM
function findEdgeElement(r1, c1, r2, c2) {
  const edges = document.querySelectorAll('#edges line');
  
  for (const edge of edges) {
    const er1 = parseInt(edge.dataset.r1);
    const ec1 = parseInt(edge.dataset.c1);
    const er2 = parseInt(edge.dataset.r2);
    const ec2 = parseInt(edge.dataset.c2);
    
    if ((er1 === r1 && ec1 === c1 && er2 === r2 && ec2 === c2) ||
        (er1 === r2 && ec1 === c2 && er2 === r1 && ec2 === c1)) {
      return edge;
    }
  }
  
  return null;
}

// تلوين مربع عند اكتماله
export function fillSquare(r, c, cfg, player) {
  const ns = "http://www.w3.org/2000/svg";

  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", c * cfg.spacing + cfg.margin);
  rect.setAttribute("y", r * cfg.spacing + cfg.margin);
  rect.setAttribute("width", cfg.spacing);
  rect.setAttribute("height", cfg.spacing);

  const color = cfg.colors[player - 1] || "rgba(0,0,0,0.3)"; // لون افتراضي إذا لم يوجد;

  rect.setAttribute("fill", color);
  rect.setAttribute("fill-opacity", "0.4");

  // أضف المربع إلى مجموعة المربعات داخل SVG
  const squaresGroup = document.getElementById("squares");
  if (squaresGroup) {
    squaresGroup.appendChild(rect);
  }

  // 🆕 نضيف الكلاس بعد "tick" قصير لتشغيل transition
  requestAnimationFrame(() => {
    rect.classList.add("filled");
  });
}

// 🟢 تحديث الدور
// (moved updateTurn to ui/turnManager.js)

// 🟢 UI الدور
// (moved updateTurnUI to ui/turnManager.js)

// 🟢 إعلان نهاية اللعبة (عن طريق المربعات)
// (moved endGame to ui/gameEnd.js)

export function resetState() {
  currentPlayer = 1;
  if (state.scores) {
    for (const k in state.scores) state.scores[k] = 0;
  }
  lines = new Set();
}

// 🟢 UI النقاط
// (moved updateScoreboard to ui/scoreboard.js)

// 🟢 بناء scoreboard ديناميكي
// (moved renderScoreboard to ui/scoreboard.js)
