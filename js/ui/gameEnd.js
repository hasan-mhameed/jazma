// 📄 gameEnd.js — v13.0
import { audioManager } from "../audio/audioManager.js";
import { updateAIStats, updateLocalStats, updateOnlineStats,
         currentUser, getAllStats } from "../auth.js";

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

  function playerName(num) {
    if (cfg.aiMode === "online" && cfg.onlinePlayerNames)
      return cfg.onlinePlayerNames[num] || `لاعب ${num}`;
    if (cfg.aiMode === "ai") return num === 1 ? "أنت" : "الكمبيوتر";
    if (cfg.localPlayerNames?.[num]) return cfg.localPlayerNames[num];
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

  // ── تحديث الإحصائيات ─────────────────────────────────────────
  let headToHead = null;  // { myW, myL, myD, label }

  if (currentUser) {
    const getResult = (myNum) => {
      if (isDraw) return 'draw';
      return winnerNum === myNum ? 'win' : 'loss';
    };

    // مساعد يحسب من history (كل الوقت)
    function fromHistory(h) {
      if (!h || typeof h !== 'object') return { w: 0, l: 0, d: 0 };
      const vals = Object.values(h);
      return {
        w: vals.filter(v => v.r === 'w').length,
        l: vals.filter(v => v.r === 'l').length,
        d: vals.filter(v => v.r === 'd').length,
      };
    }

    if (cfg.aiMode === "ai") {
      await updateAIStats(getResult(1));
      const stats   = await getAllStats(currentUser.uid);
      const { w, l, d } = fromHistory(stats.ai?.history);
      headToHead = { myW: w, myL: l, myD: d, label: "أنت vs الكمبيوتر" };

    } else if (cfg.aiMode === "online") {
      const myNum       = cfg.onlinePlayerNum;
      const opponentUid = cfg.onlineOpponentUid;
      const oppName     = cfg.onlinePlayerNames?.[myNum === 1 ? 2 : 1] || "الخصم";
      await updateOnlineStats(getResult(myNum), opponentUid, oppName);
      const stats = await getAllStats(currentUser.uid);
      const { w, l, d } = fromHistory(stats.online?.[opponentUid]?.history);
      headToHead = { myW: w, myL: l, myD: d, label: `أنت vs ${oppName}` };

    } else {
      const p2 = cfg.localPlayerNames?.[2] || '';
      await updateLocalStats(getResult(1), p2);
      const stats = await getAllStats(currentUser.uid);
      const key   = p2
        ? `vs_${p2.trim().toLowerCase().replace(/\s+/g, '_')}`
        : '__general__';
      const { w, l, d } = fromHistory(stats.local?.[key]?.history);
      headToHead = { myW: w, myL: l, myD: d, label: p2 ? `أنت vs ${p2}` : "محلي" };
    }

    window._refreshStats?.();
  }

  // ── عرض شاشة النتيجة ─────────────────────────────────────────
  const winnerScreen  = document.getElementById("winner-screen");
  const winnerMessage = document.getElementById("winner-message");
  const winnerDetails = document.getElementById("winner-details");
  const headToHeadEl  = document.getElementById("head-to-head");

  if (!winnerScreen || !winnerMessage) return;

  winnerMessage.textContent = message;

  // ترتيب اللاعبين
  if (winnerDetails) {
    winnerDetails.textContent = "";
    ranking.forEach((p, i) => {
      const color = cfg.colors[p.player - 1] || "#999";
      const row   = document.createElement("div");
      row.style.color        = color;
      row.style.padding      = "6px 0";
      row.style.fontSize     = "1.05rem";
      row.style.borderBottom = "1px solid rgba(255,255,255,0.08)";
      row.textContent = `${i + 1}. ${playerName(p.player)}: ${p.score} نقطة`;
      winnerDetails.appendChild(row);
    });
  }

  // سجل أنت vs الخصم
  if (headToHeadEl) {
    if (headToHead && currentUser) {
      const { myW, myL, myD, label } = headToHead;
      const draws = myD > 0 ? ` · 🤝 ${myD}` : '';
      headToHeadEl.innerHTML = `
        <div class="h2h-label">${label}</div>
        <div class="h2h-score">
          <span class="h2h-win">🏆 ${myW}</span>
          <span class="h2h-sep">–</span>
          <span class="h2h-loss">💔 ${myL}</span>
          ${myD > 0 ? `<span class="h2h-sep">·</span><span class="h2h-draw">🤝 ${myD}</span>` : ''}
        </div>`;
      headToHeadEl.classList.remove("hidden");
    } else {
      headToHeadEl.classList.add("hidden");
    }
  }

  winnerScreen.classList.remove("hidden");
  setTimeout(() => audioManager.playWin(), 300);
}
