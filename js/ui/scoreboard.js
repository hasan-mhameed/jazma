// 📄 scoreboard.js — v15.8 (Nature player cards)
import { state }  from "../core/state.js?v=1781562231";
import { config } from "../config/config.js?v=1781562231";

// أيقونات افتراضية للاعبين
const AVATARS = ['🦊', '🤖', '🦅', '🐺'];
const COLORS  = ['p1', 'p2', 'p3', 'p4'];

function playerName(cfg, i) {
  if (cfg.aiMode === 'ai' && i === 2) return 'الكمبيوتر';
  if (cfg.aiMode === 'online' && cfg.onlinePlayerNames) return cfg.onlinePlayerNames[i] || `لاعب ${i}`;
  if (cfg.localPlayerNames) return cfg.localPlayerNames[i] || `لاعب ${i}`;
  return `لاعب ${i}`;
}

export function renderScoreboard(cfg) {
  const scoreboard = document.getElementById("scores");
  if (!scoreboard) return;
  scoreboard.innerHTML = "";
  scoreboard.className = `players-count-${cfg.players}`;
  const scores = state.scores || {};

  for (let i = 1; i <= cfg.players; i++) {
    const card = document.createElement("div");
    card.id = `pcard${i}`;
    card.className = `nat-player-card ${COLORS[i-1] || 'p1'}`;

    card.innerHTML = `
      <div class="npc-avatar">${AVATARS[i-1] || '🎮'}</div>
      <div class="npc-info">
        <div class="npc-name">${playerName(cfg, i)}</div>
        <div class="npc-turn-tag">دوره الآن</div>
      </div>
      <div class="npc-score" id="p${i}">${scores[i] || 0}</div>`;
    scoreboard.appendChild(card);
  }
}

export function updateScoreboard() {
  const scores = state.scores || {};
  for (const id in scores) {
    const span = document.getElementById(`p${id}`);
    if (span) span.textContent = scores[id];
  }
}
