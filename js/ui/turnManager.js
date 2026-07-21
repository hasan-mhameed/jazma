// 📄 turnManager.js — v15.8
import { state }  from "../core/state.js?v=1784589600";
import { config } from "../config/config.js?v=1784589600";
import { isTimerEnabled, startTurnTimer, stopTurnTimer } from "./turnTimer.js?v=1784589600";

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

  // مؤقّت الدور — أونلاين: يظهر ويعدّ عند الجميع (الكل يشاهد وقت صاحب الدور)
  // ضد الكمبيوتر: لدور اللاعب البشري فقط
  if (isTimerEnabled()) {
    const humanTurn =
      cfg.aiMode === "ai"     ? state.currentPlayer === 1 :
      cfg.aiMode === "online" ? true :
      true; // محلي: كل الأدوار بشرية
    if (humanTurn) startTurnTimer();
    else stopTurnTimer();
  }

  // نصّ الدور — يتغيّر حسب صاحب الدور (كان ثابتاً "دورك" دائماً)
  const turnText = document.getElementById("nat-turn-text");
  if (turnText) {
    const cp = state.currentPlayer;
    if (cfg.aiMode === "online") {
      if (cp === cfg.onlinePlayerNum) turnText.textContent = "🟢 دورك — ارسم خطاً";
      else {
        const oppName = cfg.onlinePlayerNames?.[cp] || `اللاعب ${cp}`;
        turnText.textContent = `⏳ دور ${oppName}...`;
      }
    } else if (cfg.aiMode === "ai") {
      turnText.textContent = cp === 1 ? "🟢 دورك — ارسم خطاً" : "🤖 دور الكمبيوتر...";
    } else {
      const pName = cfg.localPlayerNames?.[cp] || `اللاعب ${cp}`;
      turnText.textContent = `🎯 دور ${pName} — ارسم خطاً`;
    }
  }
}
