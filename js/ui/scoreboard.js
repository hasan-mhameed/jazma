// 📄 scoreboard.js
// يعرض ويحدّث لوحة النقاط
// Displays and updates the scoreboard

// scoreboard.js — handles score display & updates
// reads scores from central state
import { state } from "../core/state.js?v=1781558676";

export function updateScoreboard() {
  const scores = state.scores || {};
  for (const id in scores) {
    const span = document.getElementById(`p${id}`);
    if (span) span.textContent = `Player ${id}: ${scores[id]}`;
  }
}

export function renderScoreboard(cfg) {
  const scoreboard = document.getElementById("scores");
  if (!scoreboard) return;
  scoreboard.innerHTML = "";
  const scores = state.scores || {};
  for (let i = 1; i <= cfg.players; i++) {
    const span = document.createElement("span");
    span.id = `p${i}`;
    span.textContent = `Player ${i}: ${scores[i] || 0}`;
    scoreboard.appendChild(span);
  }
}
