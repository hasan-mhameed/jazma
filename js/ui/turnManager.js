// 📄 turnManager.js — v15.8
import { state }  from "../core/state.js?v=1782257515";
import { config } from "../config/config.js?v=1782257515";

export function updateTurn(cfg) { updateTurnUI(cfg); }

export function updateTurnUI(cfg) {
  const board = document.getElementById("board");
  if (board) {
    const isMyTurn =
      cfg.aiMode === "online" ? state.currentPlayer === cfg.onlinePlayerNum :
      cfg.aiMode === "ai"      ? state.currentPlayer === 1 :
      true;
    board.classList.toggle("not-my-turn", !isMyTurn);
  }

  // تفعيل بطاقة اللاعب صاحب الدور
  for (let i = 1; i <= cfg.players; i++) {
    const card = document.getElementById(`pcard${i}`);
    if (card) card.classList.toggle("active", i === state.currentPlayer);
  }

  // مؤشر الدور النصي
  const turnInd = document.getElementById("nat-turn-text");
  if (turnInd) {
    const isMyTurn =
      cfg.aiMode === "online" ? state.currentPlayer === cfg.onlinePlayerNum :
      cfg.aiMode === "ai"      ? state.currentPlayer === 1 :
      true;
    if (cfg.aiMode === 'ai' && state.currentPlayer === 2) {
      turnInd.textContent = "🤖 دور الكمبيوتر...";
    } else if (cfg.aiMode === 'online') {
      turnInd.textContent = isMyTurn ? "دورك — ارسم خطاً" : "دور خصمك...";
    } else {
      const names = cfg.localPlayerNames || {};
      turnInd.textContent = `دور ${names[state.currentPlayer] || 'لاعب ' + state.currentPlayer}`;
    }
  }
}
