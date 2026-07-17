// 📄 ui/gameSetup.js
// شاشة إعداد اللعبة + بدء اللعبة المحلية
// تصميم مرن: الأحجام/اللاعبين/الأوضاع تُبنى من مصفوفات (سهلة التعديل)
import { config } from "../config/config.js?v=1784291737";
import { AIPlayer } from "../ai/aiPlayer.js?v=1784291737";
import { getCurrentUser } from "../auth.js?v=1784291737";
import { state } from "../core/state.js?v=1784291737";

export let aiPlayer = null;

// ── إعدادات مرنة (عدّلها لإضافة/إزالة خيارات) ──
const BOARD_SIZES = [
  { value: 3, label: '3×3' },
  { value: 4, label: '4×4' },
  { value: 5, label: '5×5' },
  { value: 6, label: '6×6' },
];
const PLAYER_COUNTS = [
  { value: 2, label: 'لاعبان' },
  { value: 3, label: '3 لاعبين' },
  { value: 4, label: '4 لاعبين' },
];
const GAME_MODES = [
  { value: 'ai',     icon: '🤖', name: 'ضد الكمبيوتر',   desc: 'تحدّى الذكاء الاصطناعي' },
  { value: 'human',  icon: '👥', name: 'لاعبون محليون',   desc: 'على نفس الجهاز' },
  { value: 'online', icon: '🌐', name: 'أونلاين',         desc: 'العب مع أصدقائك عن بُعد' },
];
const DIFFICULTIES = [
  { value: 'easy',      label: '😊 سهل' },
  { value: 'medium',    label: '🧠 متوسط' },
  { value: 'nightmare', label: '🔥 صعب' },
];

let _size = 4, _players = 2, _mode = 'ai', _difficulty = 'medium', _timerOn = false;

export function initGameSetup({ onGameStart, onOnlineRequested }) {
  const gridPreview  = document.querySelector(".preview-grid");
  const startGameBtn = document.getElementById("start-game");

  const gridSizeSelect     = document.getElementById("grid-size");
  const playerCountSelect  = document.getElementById("player-count");
  const aiModeSelect       = document.getElementById("ai-mode");
  const aiDifficultySelect = document.getElementById("ai-difficulty");

  const aiDifficultySection = document.getElementById("ai-difficulty-section");
  const localP2Section      = document.getElementById("local-p2-section");
  const localP2Input        = document.getElementById("local-p2-name");

  function updateGridPreview(size) {
    if (!gridPreview) return;
    gridPreview.setAttribute("data-size", size);
    gridPreview.innerHTML = "";
    for (let i = 0; i < size * size; i++) gridPreview.appendChild(document.createElement("span"));
  }

  const sizeRow = document.getElementById("size-chips");
  // نملأ الـ select المخفي بالخيارات (للتوافق مع منطق الأونلاين)
  if (gridSizeSelect && !gridSizeSelect.options.length) {
    BOARD_SIZES.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.value; opt.textContent = s.label;
      if (s.value === _size) opt.selected = true;
      gridSizeSelect.appendChild(opt);
    });
  }
  function buildSizeChips() {
    sizeRow.innerHTML = "";
    BOARD_SIZES.forEach(s => {
      const chip = document.createElement("button");
      chip.className = "chip" + (s.value === _size ? " active" : "");
      chip.textContent = s.label;
      chip.addEventListener("click", (e) => {
        e.currentTarget.blur();
        _size = s.value;
        if (gridSizeSelect) gridSizeSelect.value = s.value;
        buildSizeChips();
        updateGridPreview(s.value);
      });
      sizeRow.appendChild(chip);
    });
  }

  const playerRow = document.getElementById("player-chips");
  if (playerCountSelect && !playerCountSelect.options.length) {
    PLAYER_COUNTS.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.value; opt.textContent = p.label;
      if (p.value === _players) opt.selected = true;
      playerCountSelect.appendChild(opt);
    });
  }
  function buildPlayerChips() {
    playerRow.innerHTML = "";
    PLAYER_COUNTS.forEach(p => {
      const chip = document.createElement("button");
      chip.className = "chip" + (p.value === _players ? " active" : "");
      chip.textContent = p.label;
      if (_mode === 'ai' && p.value !== 2) chip.classList.add("disabled");
      chip.addEventListener("click", (e) => {
        e.currentTarget.blur();
        if (_mode === 'ai' && p.value !== 2) return;
        _players = p.value;
        if (playerCountSelect) playerCountSelect.value = p.value;
        buildPlayerChips();
      });
      playerRow.appendChild(chip);
    });
  }

  const modeBox = document.getElementById("mode-cards");
  function buildModeCards() {
    modeBox.innerHTML = "";
    GAME_MODES.forEach(m => {
      const card = document.createElement("button");
      card.className = "mode-card" + (m.value === _mode ? " active" : "");
      card.innerHTML =
        '<span class="mc-icon">' + m.icon + '</span>' +
        '<span class="mc-text">' +
          '<span class="mc-name">' + m.name + '</span>' +
          '<span class="mc-desc">' + m.desc + '</span>' +
        '</span>' +
        '<span class="mc-check">✓</span>';
      card.addEventListener("click", (e) => {
        e.currentTarget.blur();
        _mode = m.value;
        if (aiModeSelect) aiModeSelect.value = m.value;
        applyMode();
        buildModeCards();
        if (m.value === 'online') onOnlineRequested?.();
      });
      modeBox.appendChild(card);
    });
  }

  const diffRow = document.getElementById("difficulty-chips");
  function buildDifficultyChips() {
    diffRow.innerHTML = "";
    DIFFICULTIES.forEach(d => {
      const chip = document.createElement("button");
      chip.className = "chip" + (d.value === _difficulty ? " active" : "");
      chip.textContent = d.label;
      chip.addEventListener("click", (e) => {
        e.currentTarget.blur();
        _difficulty = d.value;
        if (aiDifficultySelect) aiDifficultySelect.value = d.value;
        buildDifficultyChips();
      });
      diffRow.appendChild(chip);
    });
  }

  function applyMode() {
    aiDifficultySection?.classList.toggle("hidden", _mode !== 'ai');
    localP2Section?.classList.toggle("hidden", _mode !== 'human');
    // عدد اللاعبين يظهر فقط لما اللعب مش ضد الكمبيوتر
    document.getElementById("players-section")?.classList.toggle("hidden", _mode === 'ai');
    if (_mode === 'ai') { _players = 2; if (playerCountSelect) playerCountSelect.value = "2"; }
    buildPlayerChips();
  }

  const timerRow = document.getElementById("timer-toggle-row");
  const ttSwitch = document.getElementById("tt-switch");
  const ttCheckbox = document.getElementById("turn-timer-toggle");
  function syncTimerSwitch() {
    ttSwitch?.classList.toggle("on", _timerOn);
    if (ttCheckbox) ttCheckbox.checked = _timerOn;
  }
  timerRow?.addEventListener("click", (e) => {
    e.preventDefault();
    _timerOn = !_timerOn;
    syncTimerSwitch();
  });

  buildSizeChips();
  buildPlayerChips();
  buildModeCards();
  buildDifficultyChips();
  applyMode();
  updateGridPreview(_size);
  syncTimerSwitch();

  startGameBtn?.addEventListener("click", () => {
    if (_mode === "online") { onOnlineRequested?.(); return; }

    config.rows    = _size;
    config.cols    = _size;
    config.players = _players;
    config.aiMode  = _mode;
    config.aiDifficulty = _difficulty;
    config.online  = false;
    config.turnTimer = _timerOn;

    const p2Name = localP2Input?.value?.trim() || "";
    config.localPlayerNames = {
      1: getCurrentUser()?.displayName || "لاعب 1",
      2: p2Name || "لاعب 2",
    };

    aiPlayer = _mode === "ai" ? new AIPlayer(_difficulty) : null;
    if (_mode === "ai") config.players = 2;

    onGameStart?.();
  });

  return {
    resetUI() {
      _mode = 'human';
      if (aiModeSelect) aiModeSelect.value = "human";
      applyMode();
      buildModeCards();
      aiPlayer = null;
    },
    getAiPlayer() { return aiPlayer; },
  };
}
