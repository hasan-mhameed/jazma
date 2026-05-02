// 📄 state.js
// حفظ وإدارة حالة اللعبة
// Stores and manages game state

// state.js - central game state
export const state = {
  lines: new Set(),
  currentPlayer: 1,
  scores: {},
  rows: null,
  cols: null,
};

export function initState(cfg) {
  state.lines = new Set();
  state.currentPlayer = 1;
  state.scores = {};
  for (let i = 1; i <= (cfg.players || 2); i++) state.scores[i] = 0;
  state.rows = cfg.rows;
  state.cols = cfg.cols;
}
