// 📄 turnManager.js — v15.8
import { state }  from "../core/state.js?v=1790420518";
import { config } from "../config/config.js?v=1790420518";
import { isTimerEnabled, startTurnTimer, stopTurnTimer } from "./turnTimer.js?v=1790420518";

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

  renderTurnText(cfg);
}

// من يشاهد ولا يلعب؟ المشاهد، أو لاعب خرج من مباراة جماعية ما زالت جارية (نفد وقته / انقطع ولم يعد)
// — يرى فوق اللوحة أنه يشاهد، لا "دور فلان" وكأنه ما زال في اللعب (فحص v35.7: لم يكن يظهر شيء)
function watchingPrefix(cfg) {
  if (cfg.spectator) return "👁️ تشاهد";
  const mp = cfg.multiPlayers;
  if (cfg.aiMode === "online" && mp && typeof mp === "object" && Number.isInteger(cfg.onlinePlayerNum)) {
    const me = Object.values(mp).find(p => p && p.num === cfg.onlinePlayerNum);
    if (me && me.active === false) return "👁️ خرجت من المباراة — تشاهد";
  }
  return null;
}

// نصّ الدور فوق اللوحة — يتغيّر حسب صاحب الدور (كان ثابتاً "دورك" دائماً)
// (مستقل عن updateTurnUI: يُحدَّث وحده لحظة خروجي بلا لمس المؤقّت)
export function renderTurnText(cfg) {
  const turnText = document.getElementById("nat-turn-text");
  if (!turnText) return;
  const cp = state.currentPlayer;
  if (cfg.aiMode === "online") {
    const name = cfg.onlinePlayerNames?.[cp] || `اللاعب ${cp}`;
    const watching = watchingPrefix(cfg);
    if (watching) turnText.textContent = `${watching} · دور ${name}`;
    else if (cp === cfg.onlinePlayerNum) turnText.textContent = "🟢 دورك — ارسم خطاً";
    else turnText.textContent = `⏳ دور ${name}...`;
  } else if (cfg.aiMode === "ai") {
    turnText.textContent = cp === 1 ? "🟢 دورك — ارسم خطاً" : "🤖 دور الكمبيوتر...";
  } else {
    const pName = cfg.localPlayerNames?.[cp] || `اللاعب ${cp}`;
    turnText.textContent = `🎯 دور ${pName} — ارسم خطاً`;
  }
}
