// 📄 turnManager.js
// يدير دور اللاعبين وتحديث الواجهة
// Manages current player turn and updates UI

// turnManager.js — manages current turn and UI
// moved from boardRenderer.js

import { state } from "../core/state.js?v=1781555179";
import { config } from "../config/config.js?v=1781555179";

export function updateTurn(cfg) {
  updateTurnUI(cfg);
}

export function updateTurnUI(cfg) {
  const board = document.getElementById("board");

  // 🚫 أضف/شيل class الـ hover حسب الدور
  if (board) {
    const isMyTurn =
      cfg.aiMode === "online"  ? state.currentPlayer === cfg.onlinePlayerNum :
      cfg.aiMode === "ai"      ? state.currentPlayer === 1 :
      true;
    board.classList.toggle("not-my-turn", !isMyTurn);
  }
  for (let i = 1; i <= cfg.players; i++) {
    const span = document.getElementById(`p${i}`);
    if (!span) continue;

    const color = cfg.colors[i - 1];
    span.classList.remove("active-turn");
    span.style.backgroundColor = "transparent";
    span.style.color = "#333";
    span.style.boxShadow = "none";

    if (i === state.currentPlayer) {
      span.classList.add("active-turn");
      span.style.backgroundColor = color;
      span.style.color = "#fff";
      span.style.boxShadow = `0 0 10px ${color}`;
    }
  }
}
