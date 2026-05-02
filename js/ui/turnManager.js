// 📄 turnManager.js
// يدير دور اللاعبين وتحديث الواجهة
// Manages current player turn and updates UI

// turnManager.js — manages current turn and UI
// moved from boardRenderer.js

import { state } from "../core/state.js";
import { config } from "../config/config.js";
import { currentPlayer } from "./boardRenderer.js";

export function updateTurn(cfg) {
  updateTurnUI(cfg);
}

export function updateTurnUI(cfg) {
  for (let i = 1; i <= cfg.players; i++) {
    const span = document.getElementById(`p${i}`);
    if (!span) continue;

    const color = cfg.colors[i - 1];

    // 🔹 إعادة الحالة الافتراضية للجميع
    span.classList.remove("active-turn");
    span.style.backgroundColor = "transparent";
    span.style.color = "#333";
    span.style.boxShadow = "none";

    // 🔹 تفعيل اللاعب الحالي
    if (i === currentPlayer) {
      span.classList.add("active-turn");
      span.style.backgroundColor = color;
      span.style.color = "#fff";
      span.style.boxShadow = `0 0 10px ${color}`;
    }
  }
}
