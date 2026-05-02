// 📄 board.js
// مسؤول عن منطق اللعبة والتحكم بالمربعات
// Handles game logic and player-square interactions

// board.js - controller linking logic/state with renderer
import { initState } from "./core/state.js";
import { initBoard } from "./ui/boardRenderer.js";
import { renderScoreboard } from "./ui/scoreboard.js";
import { updateTurn, updateTurnUI } from "./ui/turnManager.js";
import { config } from "./config/config.js";

export function startBoard(cfg, aiPlayer = null) {
  initState(cfg);
  initBoard(cfg, aiPlayer);
  renderScoreboard(cfg);
  updateTurnUI(cfg);
}

export function updateScoreboard() {
  renderScoreboard(config);
}

export function resetState() {
  initState(config);
}
