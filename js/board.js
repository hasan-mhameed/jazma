// 📄 board.js
// مسؤول عن منطق اللعبة والتحكم بالمربعات
// Handles game logic and player-square interactions

// board.js - controller linking logic/state with renderer
import { initState, state } from "./core/state.js?v=1790420518";
import { initBoard } from "./ui/boardRenderer.js?v=1790420518";
import { renderScoreboard } from "./ui/scoreboard.js?v=1790420518";
import { updateTurn, updateTurnUI } from "./ui/turnManager.js?v=1790420518";
import { config } from "./config/config.js?v=1790420518";

export function startBoard(cfg, aiPlayer = null) {
  // لوحة جديدة = مباراة جديدة: مسار التحدي اليومي لا يمرّ بـ launchGame (التي تصفّرها)،
  // واللوحة تُقفل بعد النهاية (v35.6) — فالتصفير هنا يضمن ألّا تبدأ مقفلة.
  // (هنا لا في initState: تلك تُستدعى أيضاً عند الخروج، فتعيد معالجات مباراة منتهية للعمل)
  state.gameFinished = false;
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
