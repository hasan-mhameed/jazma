// 📄 turnManager.js — v15.8
import { state }  from "../core/state.js?v=1782829249";
import { config } from "../config/config.js?v=1782829249";
import { isTimerEnabled, startTurnTimer, stopTurnTimer } from "./turnTimer.js?v=1782829249";

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

  // مؤقّت الدور — يبدأ لدور اللاعب البشري فقط
  if (isTimerEnabled()) {
    const humanTurn =
      cfg.aiMode === "ai"     ? state.currentPlayer === 1 :
      cfg.aiMode === "online" ? state.currentPlayer === cfg.onlinePlayerNum :
      true; // محلي: كل الأدوار بشرية
    if (humanTurn) startTurnTimer();
    else stopTurnTimer();
  }
}
