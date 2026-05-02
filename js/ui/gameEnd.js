// 📄 gameEnd.js
// يعالج شاشة نهاية اللعبة والنتائج
// Handles end-game screen and results

// gameEnd.js — handles end-game UI and messages
// moved from boardRenderer.js

import { audioManager } from "../audio/audioManager.js";

export function endGame(cfg, scores) {
  const totalSquares = (cfg.rows - 1) * (cfg.cols - 1);
  const filled = Object.values(scores).reduce((a, b) => a + b, 0);

  if (filled === totalSquares) {
    // 🔹 إنشاء مصفوفة مرتبة من اللاعبين حسب النقاط
    const ranking = Object.entries(scores)
      .map(([player, score]) => ({ player: Number(player), score }))
      .sort((a, b) => b.score - a.score);

    // 🔹 تحديد أعلى نتيجة
    const maxScore = ranking[0].score;
    const topPlayers = ranking.filter((p) => p.score === maxScore);

    // 🔹 صياغة الرسالة
    let message;
    if (topPlayers.length > 1) {
      message = `🤝 It's a Draw between: ${topPlayers
        .map((p) => `Player ${p.player}`)
        .join(", ")}`;
    } else {
      message = `🎉 Player ${ranking[0].player} Wins!`;
    }

    // 🔹 عرض النتائج على الشاشة
    const winnerScreen = document.getElementById("winner-screen");
    const winnerMessage = document.getElementById("winner-message");
    const winnerDetails = document.getElementById("winner-details");

    if (winnerScreen && winnerMessage) {
      winnerMessage.textContent = message;

      // 🆕 إنشاء عناصر <div> لكل لاعب (بدل <br>)
      if (winnerDetails) {
        winnerDetails.innerHTML = ranking
          .map((p, i) => {
            const color = cfg.colors[p.player - 1] || "#999";
            return `
              <div style="
                color:${color};
                padding: 6px 0;
                font-weight: 500;
                font-size: 1.1rem;
                border-bottom: 1px solid rgba(255,255,255,0.1);
              ">
                ${i + 1}. Player ${p.player}: ${p.score} point${
              p.score !== 1 ? "s" : ""
            }
              </div>`;
          })
          .join("");
      }

      winnerScreen.classList.remove("hidden");
      
      // 🔊 تشغيل صوت الفوز
      setTimeout(() => {
        audioManager.playWin();
      }, 300);
    }
  }
}
