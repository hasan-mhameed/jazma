// 📄 board.js
// مسؤول عن منطق اللعبة والتحكم بالمربعات
// Handles game logic and player-square interactions

// board.js - controller linking logic/state with renderer
import { initState } from "./core/state.js?v=1781646243";
import { initBoard } from "./ui/boardRenderer.js?v=1781646243";
import { renderScoreboard } from "./ui/scoreboard.js?v=1781646243";
import { updateTurn, updateTurnUI } from "./ui/turnManager.js?v=1781646243";
import { config } from "./config/config.js?v=1781646243";

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
