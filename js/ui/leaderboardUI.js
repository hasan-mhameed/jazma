// 📄 ui/leaderboardUI.js
// لوحة المتصدرين
import { getLeaderboard } from "../leaderboard.js?v=1783204799";

function asText(v, fallback = "") { return String(v ?? fallback); }
function firstInitial(name) { return asText(name, "?").trim().charAt(0).toUpperCase() || "?"; }
function safeImageUrl(url) {
  try { const p = new URL(asText(url), location.href); return p.protocol === "https:" || p.protocol === "http:"; }
  catch { return false; }
}

export function initLeaderboardUI() {
  const leaderboardBtn      = document.getElementById("leaderboard-btn");
  const leaderboardPanel    = document.getElementById("leaderboard-panel");
  const leaderboardList     = document.getElementById("leaderboard-list");
  const closeLeaderboardBtn = document.getElementById("close-leaderboard-btn");

  function close() { leaderboardPanel.classList.add("hidden"); }

  leaderboardBtn?.addEventListener("click", async () => {
    leaderboardPanel.classList.remove("hidden");
    leaderboardList.innerHTML = `<p class="friends-empty">⏳ جاري التحميل...</p>`;
    const players = await getLeaderboard();
    leaderboardList.innerHTML = "";
    if (players.length === 0) {
      leaderboardList.innerHTML = `<p class="friends-empty">لا يوجد لاعبون بعد</p>`;
      return;
    }
    const medals = ["🥇", "🥈", "🥉"];
    players.forEach((p, i) => {
      const row  = document.createElement("div"); row.className = "leaderboard-row";
      const rank = document.createElement("div");
      rank.className = `leaderboard-rank ${i < 3 ? `rank-${i + 1}` : ""}`;
      rank.textContent = medals[i] || String(i + 1);

      let avatar;
      if (p.photo && safeImageUrl(p.photo)) {
        avatar = document.createElement("img");
        avatar.className = "leaderboard-avatar";
        avatar.src = p.photo; avatar.alt = asText(p.name, "لاعب");
      } else {
        avatar = document.createElement("div");
        avatar.className = "leaderboard-avatar-placeholder";
        avatar.textContent = firstInitial(p.name);
      }

      const info  = document.createElement("div"); info.className = "leaderboard-info";
      const name  = document.createElement("div"); name.className = "leaderboard-name";
      name.textContent = asText(p.name, "لاعب");
      const stats = document.createElement("div"); stats.className = "leaderboard-stats";
      stats.textContent = `⚡ ${Number(p.xp) || 0} XP`;
      const wins  = document.createElement("div"); wins.className = "leaderboard-wins";
      wins.textContent = `⚡ ${(p.xp || 0).toLocaleString()}`;

      info.append(name, stats);
      row.append(rank, avatar, info, wins);
      leaderboardList.appendChild(row);
    });
  });

  closeLeaderboardBtn?.addEventListener("click", close);
  leaderboardPanel?.addEventListener("click", e => { if (e.target === leaderboardPanel) close(); });
}
