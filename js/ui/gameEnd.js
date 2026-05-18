// 📄 gameEnd.js — v12.3
import { audioManager } from "../audio/audioManager.js";
import { updateStats, currentUser } from "../auth.js";

export async function endGame(cfg, scores) {
  const totalSquares = (cfg.rows - 1) * (cfg.cols - 1);
  const filled = Object.values(scores).reduce((a, b) => (+a||0) + (+b||0), 0);
  if (filled < totalSquares) return;

  const ranking = Object.entries(scores)
    .map(([player, score]) => ({ player: Number(player), score }))
    .sort((a, b) => b.score - a.score);

  const maxScore   = ranking[0].score;
  const topPlayers = ranking.filter(p => p.score === maxScore);
  const isDraw     = topPlayers.length > 1;
  const winnerNum  = isDraw ? null : ranking[0].player;

  // ── اسم اللاعب ──────────────────────────────────────────────
  function playerName(num) {
    if (cfg.aiMode === "online" && cfg.onlinePlayerNames) {
      return cfg.onlinePlayerNames[num] || `لاعب ${num}`;
    }
    if (cfg.aiMode === "ai") return num === 1 ? "أنت" : "الكمبيوتر";
    return `لاعب ${num}`;
  }

  // ── رسالة الفائز ─────────────────────────────────────────────
  let message;
  if (isDraw) {
    message = "🤝 تعادل!";
  } else {
    message = cfg.aiMode === "ai" && winnerNum === 1
      ? "🎉 أنت الفائز!"
      : cfg.aiMode === "ai" && winnerNum === 2
      ? "🤖 الكمبيوتر فاز!"
      : `🎉 ${playerName(winnerNum)} فاز!`;
  }

  // ── تحديث الإحصائيات للوضع الأونلاين ────────────────────────
  if (cfg.aiMode === "online" && currentUser) {
    const myNum = cfg.onlinePlayerNum;
    const won   = !isDraw && winnerNum === myNum;
    await updateStats(won);
  }

  // ── عرض شاشة النتيجة ─────────────────────────────────────────
  const winnerScreen  = document.getElementById("winner-screen");
  const winnerMessage = document.getElementById("winner-message");
  const winnerDetails = document.getElementById("winner-details");

  if (!winnerScreen || !winnerMessage) return;

  winnerMessage.textContent = message;

  if (winnerDetails) {
    winnerDetails.textContent = "";
    ranking.forEach((p, i) => {
      const color = cfg.colors[p.player - 1] || "#999";
      const row = document.createElement("div");
      row.style.color = color;
      row.style.padding = "6px 0";
      row.style.fontSize = "1.05rem";
      row.style.borderBottom = "1px solid rgba(255,255,255,0.08)";
      row.textContent = `${i + 1}. ${playerName(p.player)}: ${p.score} نقطة`;
      winnerDetails.appendChild(row);
    });
  }

  winnerScreen.classList.remove("hidden");
  setTimeout(() => audioManager.playWin(), 300);
}
