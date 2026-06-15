// 📄 ui/gameSetup.js
// شاشة إعداد اللعبة + بدء اللعبة المحلية
import { config } from "../config/config.js?v=1781555738";
import { AIPlayer } from "../ai/aiPlayer.js?v=1781555738";
import { getCurrentUser } from "../auth.js?v=1781555738";
import { state } from "../core/state.js?v=1781555738";

export let aiPlayer = null;

export function initGameSetup({ onGameStart, onOnlineRequested }) {
  const gridSizeSelect      = document.getElementById("grid-size");
  const playerCountSelect   = document.getElementById("player-count");
  const aiModeSelect        = document.getElementById("ai-mode");
  const aiDifficultySelect  = document.getElementById("ai-difficulty");
  const aiDifficultySection = document.getElementById("ai-difficulty-section");
  const localP2Input        = document.getElementById("local-p2-name");
  const localP2Section      = document.getElementById("local-p2-section");
  const gridPreview         = document.querySelector(".preview-grid");
  const startGameBtn        = document.getElementById("start-game");

  // ── معاينة اللوحة ────────────────────────────────────────────
  function updateGridPreview(size) {
    if (!gridPreview) return;
    gridPreview.setAttribute("data-size", size);
    gridPreview.innerHTML = "";
    for (let i = 0; i < size * size; i++) gridPreview.appendChild(document.createElement("span"));
  }
  gridSizeSelect?.addEventListener("change", e => updateGridPreview(+e.target.value));

  // ── تبديل وضع اللعب ─────────────────────────────────────────
  function syncLocalP2() {
    if (!localP2Section || !aiModeSelect) return;
    localP2Section.classList.toggle("hidden", aiModeSelect.value !== "human");
  }
  syncLocalP2();

  aiModeSelect?.addEventListener("change", e => {
    const isAI = e.target.value === "ai";
    aiDifficultySection.classList.toggle("hidden", !isAI);
    if (isAI) { playerCountSelect.value = "2"; playerCountSelect.disabled = true; }
    else       { playerCountSelect.disabled = false; }
    syncLocalP2();
    if (e.target.value === "online") onOnlineRequested?.();
  });

  // ── بدء اللعبة ───────────────────────────────────────────────
  startGameBtn?.addEventListener("click", () => {
    const gridSize    = +gridSizeSelect.value;
    const playerCount = +playerCountSelect.value;
    const aiMode      = aiModeSelect?.value || "human";
    const aiDifficulty= aiDifficultySelect?.value || "medium";

    if (aiMode === "online") { onOnlineRequested?.(); return; }

    config.rows    = gridSize;
    config.cols    = gridSize;
    config.players = playerCount;
    config.aiMode  = aiMode;
    config.aiDifficulty = aiDifficulty;
    config.online  = false;

    const p2Name = localP2Input?.value?.trim() || "";
    config.localPlayerNames = {
      1: getCurrentUser()?.displayName || "لاعب 1",
      2: p2Name || "لاعب 2",
    };

    aiPlayer = aiMode === "ai" ? new AIPlayer(aiDifficulty) : null;
    if (aiMode === "ai") config.players = 2;

    onGameStart?.();
  });

  // ── إعادة الضبط بعد اللعبة ──────────────────────────────────
  return {
    resetUI() {
      if (aiModeSelect)        aiModeSelect.value = "human";
      if (aiDifficultySection) aiDifficultySection.classList.add("hidden");
      if (playerCountSelect)   playerCountSelect.disabled = false;
      aiPlayer = null;
      syncLocalP2();
    },
    getAiPlayer() { return aiPlayer; },
  };
}
