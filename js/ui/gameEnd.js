// 📄 gameEnd.js — v14.3
import { audioManager } from "../audio/audioManager.js?v=1783724197";
import { updateAIStats, updateLocalStats, updateOnlineStats,
         updateMultiStats, currentUser, getAllStats } from "../auth.js?v=1783724197";
import { saveMatch } from "../history.js?v=1783724197";
import { checkAchievements, updateStreak, getTotalMatches } from "../achievements.js?v=1783724197";
import { showNewAchievements } from "./achievementsUI.js?v=1783724197";
import { calcXP, addXP } from "../xp.js?v=1783724197";
import { showXPGain } from "./xpUI.js?v=1783724197";
import { isDailyActive, finishDailyChallenge } from "./dailyChallengeUI.js?v=1783724197";
import { commitMatchCoins } from "../core/wallet.js?v=1783724197";

export let _matchStartTime = Date.now();
export function resetMatchTimer() { _matchStartTime = Date.now(); }

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
  let headToHead = null;  // { myW, myL, myD, label } أو { isMulti, rank, ... }

  if (currentUser) {
    const getResult = (myNum) => {
      if (isDraw) return 'draw';
      return winnerNum === myNum ? 'win' : 'loss';
    };

    // مساعد يحسب من history 1v1
    function fromHistory(h) {
      if (!h || typeof h !== 'object') return { w: 0, l: 0, d: 0 };
      const vals = Object.values(h);
      return {
        w: vals.filter(v => v.r === 'w').length,
        l: vals.filter(v => v.r === 'l').length,
        d: vals.filter(v => v.r === 'd').length,
      };
    }

    const isMulti = cfg.players >= 3;

    if (isMulti) {
      // ── متعدد اللاعبين: نسجل مركز اللاعب 1 ونقاطه ──────────
      const myRank  = ranking.findIndex(p => p.player === 1) + 1;
      const myScore = scores[1] || 0;
      await updateMultiStats(myRank, cfg.players, myScore);

      // نجلب الإحصائيات الفردية لعرضها
      const stats   = await getAllStats(currentUser.uid);
      const history = stats.multi?.history || {};
      const records = Object.values(history);
      const total   = records.length;
      const wins    = records.filter(r => r.rank === 1).length;
      const avgScore = total > 0
        ? (records.reduce((s, r) => s + (r.score || 0), 0) / total).toFixed(1)
        : 0;
      headToHead = {
        isMulti: true,
        total, wins, avgScore,
        myRank,
        players: cfg.players,
        label: `${cfg.players} لاعبين`,
      };

    } else if (cfg.aiMode === "ai") {
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

    // ── حفظ المباراة في التاريخ ─────────────────────────────────
    const duration = Math.floor((Date.now() - _matchStartTime) / 1000);
    const grid     = `${cfg.rows}x${cfg.cols}`;

    if (isMulti) {
      const myRank  = ranking.findIndex(p => p.player === 1) + 1;
      await saveMatch({
        mode:    'multi',
        result:  myRank === 1 ? 'win' : myRank === ranking.length ? 'loss' : 'draw',
        myScore: scores[1] || 0,
        oppScore: 0,
        vs:      '',
        grid, duration,
      });
    } else if (cfg.aiMode === 'ai') {
      await saveMatch({
        mode: 'ai', result: getResult(1),
        myScore: scores[1] || 0, oppScore: scores[2] || 0,
        vs: 'الكمبيوتر', grid, duration,
      });
    } else if (cfg.aiMode === 'online') {
      const myNum  = cfg.onlinePlayerNum;
      const oppName = cfg.onlinePlayerNames?.[myNum === 1 ? 2 : 1] || 'الخصم';
      await saveMatch({
        mode: 'online', result: getResult(myNum),
        myScore: scores[myNum] || 0, oppScore: scores[myNum === 1 ? 2 : 1] || 0,
        vs: oppName, grid, duration,
      });
    } else {
      const p2 = cfg.localPlayerNames?.[2] || '';
      await saveMatch({
        mode: 'local', result: getResult(1),
        myScore: scores[1] || 0, oppScore: scores[2] || 0,
        vs: p2, grid, duration,
      });
    }

    // ── التحقق من الإنجازات ──────────────────────────────────
    const mainResult = isMulti
      ? (ranking[0].player === 1 ? 'win' : 'loss')
      : getResult(cfg.aiMode === 'online' ? cfg.onlinePlayerNum : 1);

    const [streak, totalMatches, allStats] = await Promise.all([
      updateStreak(mainResult),       // يحدث السلسلة ويرجع القيمة الجديدة
      getTotalMatches(currentUser.uid),
      getAllStats(currentUser.uid),
    ]);

    const matchData = {
      mode:          cfg.aiMode === 'online' ? 'online'
                   : cfg.players >= 3        ? 'multi'
                   : cfg.aiMode === 'ai'     ? 'ai' : 'local',
      result:        mainResult,
      myScore:       scores[cfg.aiMode === 'online' ? cfg.onlinePlayerNum : 1] || 0,
      oppScore:      scores[cfg.aiMode === 'online' ? (cfg.onlinePlayerNum === 1 ? 2 : 1) : 2] || 0,
      aiDifficulty:  cfg.aiDifficulty || 'easy',
      currentStreak: streak,
    };

    const newAchievements = await checkAchievements(matchData, allStats, totalMatches);
    if (newAchievements.length > 0) {
      setTimeout(() => showNewAchievements(newAchievements), 1500);
    }

    // ── XP ────────────────────────────────────────────────────
    if (isDailyActive()) {
      // التحدي اليومي يتولى الـ XP بنفسه
      await finishDailyChallenge(
        mainResult,
        scores[1] || 0,
        scores[2] || 0
      );
    } else {
      const xpData = {
        mode:         matchData.mode,
        result:       mainResult,
        aiDifficulty: cfg.aiDifficulty || 'easy',
        gridSize:     cfg.rows,
        rank:         isMulti ? (ranking.findIndex(p => p.player === 1) + 1) : 1,
        players:      cfg.players,
      };
      const xpResult = await addXP(calcXP(xpData));
      if (xpResult) {
        const delay = newAchievements.length > 0 ? 2500 : 800;
        setTimeout(() => showXPGain(xpResult), delay);
      }
    }
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

    // 💎 العملات المكتسبة
    commitMatchCoins().then(({ earned, total }) => {
      if (earned > 0) {
        const coinRow = document.createElement("div");
        coinRow.style.cssText = "margin-top:12px;padding:10px;border-radius:10px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.3);color:#fcd34d;font-weight:700;font-size:1.05rem;text-align:center;";
        coinRow.textContent = `💎 ربحت ${earned} عملة!`;
        winnerDetails.appendChild(coinRow);
      }
      // تحديث الشارة في navbar
      const el = document.getElementById('coins-count');
      if (el) el.textContent = total;
    });
  }

  // سجل أنت vs الخصم / إحصائياتك الفردية
  if (headToHeadEl) {
    if (headToHead && currentUser) {
      if (headToHead.isMulti) {
        const { total, wins, avgScore, myRank, players } = headToHead;
        const winPct   = total > 0 ? Math.round((wins / total) * 100) : 0;
        const medals    = ['🥇','🥈','🥉'];
        const rankEmoji = medals[myRank - 1] ?? `#${myRank}`;
        headToHeadEl.innerHTML = `
          <div class="h2h-label">إحصائياتك — ${players} لاعبين</div>
          <div class="h2h-multi-row">
            <span class="hm-stat"><span class="hm-val">${rankEmoji}</span><span class="hm-lbl">هذه الجولة</span></span>
            <span class="hm-stat"><span class="hm-val hm-gold">${winPct}%</span><span class="hm-lbl">نسبة الأول</span></span>
            <span class="hm-stat"><span class="hm-val">${avgScore}</span><span class="hm-lbl">متوسط النقاط</span></span>
            <span class="hm-stat"><span class="hm-val">${total}</span><span class="hm-lbl">مباراة</span></span>
          </div>`;
      } else {
        const { myW, myL, myD, label } = headToHead;
        headToHeadEl.innerHTML = `
          <div class="h2h-label">${label}</div>
          <div class="h2h-score">
            <span class="h2h-win">🏆 ${myW}</span>
            <span class="h2h-sep">–</span>
            <span class="h2h-loss">💔 ${myL}</span>
            ${myD > 0 ? `<span class="h2h-sep">·</span><span class="h2h-draw">🤝 ${myD}</span>` : ''}
          </div>`;
      }
      headToHeadEl.classList.remove("hidden");
    } else {
      headToHeadEl.classList.add("hidden");
    }
  }

  winnerScreen.classList.remove("hidden");
  setTimeout(() => audioManager.playWin(), 300);
}
