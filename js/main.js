// 📄 main.js
// نقطة الدخول للتطبيق وتشغيل اللعبة
// App entry point and initializes the game

import { config } from "./config/config.js";
import { startBoard, updateScoreboard, resetState } from "./board.js";
import { updateTurn, updateTurnUI } from "./ui/turnManager.js";
import { audioManager } from "./audio/audioManager.js";
import { AIPlayer } from "./ai/aiPlayer.js";

// 🤖 AI Player instance
let aiPlayer = null;

// 🎮 شاشة الإعدادات
document.addEventListener("DOMContentLoaded", () => {
  const setupScreen = document.getElementById("setup-screen");
  const startGameBtn = document.getElementById("start-game");
  const gridSizeSelect = document.getElementById("grid-size");
  const playerCountSelect = document.getElementById("player-count");
  const aiModeSelect = document.getElementById("ai-mode");
  const aiDifficultySelect = document.getElementById("ai-difficulty");
  const aiDifficultySection = document.getElementById("ai-difficulty-section");
  const infoDiv = document.getElementById("info");
  const boardSvg = document.getElementById("board");
  const gridPreview = document.querySelector(".preview-grid");
  
  // 🤖 إظهار/إخفاء خيارات صعوبة AI
  if (aiModeSelect && aiDifficultySection) {
    aiModeSelect.addEventListener("change", (e) => {
      if (e.target.value === "ai") {
        aiDifficultySection.classList.remove("hidden");
        // في وضع AI، نخلي اللاعبين 2 فقط
        playerCountSelect.value = "2";
        playerCountSelect.disabled = true;
      } else {
        aiDifficultySection.classList.add("hidden");
        playerCountSelect.disabled = false;
      }
    });
  }
  
  // 🔍 تحديث معاينة اللوحة عند تغيير الحجم
  if (gridSizeSelect && gridPreview) {
    gridSizeSelect.addEventListener("change", (e) => {
      const size = parseInt(e.target.value);
      updateGridPreview(size);
    });
  }
  
  function updateGridPreview(size) {
    if (!gridPreview) return;
    
    // تحديث الـ attribute
    gridPreview.setAttribute("data-size", size);
    
    // إنشاء النقاط الجديدة
    gridPreview.innerHTML = "";
    const totalDots = size * size;
    
    for (let i = 0; i < totalDots; i++) {
      const dot = document.createElement("span");
      gridPreview.appendChild(dot);
    }
  }
  
  // زر بدء اللعبة
  if (startGameBtn) {
    startGameBtn.addEventListener("click", () => {
      // 🔊 صوت الزر
      audioManager.playButtonClick();
      
      // الحصول على الإعدادات المختارة
      const gridSize = parseInt(gridSizeSelect.value);
      const playerCount = parseInt(playerCountSelect.value);
      const aiMode = aiModeSelect ? aiModeSelect.value : 'human';
      const aiDifficulty = aiDifficultySelect ? aiDifficultySelect.value : 'medium';
      
      // تحديث الـ config
      config.rows = gridSize;
      config.cols = gridSize;
      config.players = playerCount;
      config.aiMode = aiMode;
      
      // 🤖 تهيئة AI إذا كان الوضع AI
      if (aiMode === 'ai') {
        aiPlayer = new AIPlayer(aiDifficulty);
        config.players = 2; // دائماً لاعبين في وضع AI
      } else {
        aiPlayer = null;
      }
      
      // إخفاء شاشة الإعدادات وإظهار اللعبة
      if (setupScreen) setupScreen.classList.add("hidden");
      if (infoDiv) infoDiv.classList.remove("hidden");
      if (boardSvg) boardSvg.classList.remove("hidden");
      
      // بدء اللعبة
      startGame();
    });
  }
  
  // دالة بدء اللعبة
  function startGame() {
    startBoard(config, aiPlayer);
    updateScoreboard();
    updateTurnUI(config);
    
    // 🎵 بدء الموسيقى الخلفية
    audioManager.startBackgroundMusic();
  }

  // Cache controls
  const restartBtn = document.getElementById("restart");
  const playAgainBtn = document.getElementById("play-again");
  const winnerScreen = document.getElementById("winner-screen");

  // 🆕 زر Restart - يرجع لشاشة الإعدادات
  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      // 🔊 صوت الزر
      audioManager.playButtonClick();
      
      // 🎵 إيقاف الموسيقى
      audioManager.stopBackgroundMusic();
      
      // 🤖 إعادة تعيين AI
      aiPlayer = null;
      
      // إخفاء اللعبة
      if (infoDiv) infoDiv.classList.add("hidden");
      if (boardSvg) boardSvg.classList.add("hidden");
      
      // إظهار شاشة الإعدادات
      if (setupScreen) setupScreen.classList.remove("hidden");
      
      // إعادة تعيين الحالة
      resetState();
    });
  }

  if (playAgainBtn) {
    playAgainBtn.addEventListener("click", () => {
      if (winnerScreen) winnerScreen.classList.add("hidden");
      if (restartBtn) restartBtn.click();
    });
  }
  
  // 🔊 زر تفعيل/تعطيل الصوت
  const soundToggleBtn = document.getElementById("sound-toggle");
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener("click", () => {
      const isEnabled = audioManager.toggle();
      soundToggleBtn.textContent = isEnabled ? "🔊" : "🔇";
      soundToggleBtn.classList.toggle("muted", !isEnabled);
      
      // تشغيل صوت test
      if (isEnabled) {
        audioManager.playButtonClick();
      }
    });
  }
  
  // 🎵 زر تفعيل/تعطيل الموسيقى
  const musicToggleBtn = document.getElementById("music-toggle");
  if (musicToggleBtn) {
    musicToggleBtn.addEventListener("click", () => {
      const isEnabled = audioManager.toggleMusic();
      musicToggleBtn.textContent = isEnabled ? "🎵" : "🎶";
      musicToggleBtn.classList.toggle("muted", !isEnabled);
      
      // تشغيل صوت test
      audioManager.playButtonClick();
    });
  }
});
