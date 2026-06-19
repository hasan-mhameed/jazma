// 📄 main.js — v13.9
// Bootstrap فقط — يربط كل الـ modules

import { config }                              from "./config/config.js?v=1781871038";
import { startBoard, updateScoreboard, resetState } from "./board.js?v=1781871038";
import { updateTurnUI }                        from "./ui/turnManager.js?v=1781871038";
import { audioManager }                        from "./audio/audioManager.js?v=1781871038";
import { onlineManager, cleanupOldRooms } from "./firebase.js?v=1781871038";
import { onUserChange, getCurrentUser, getAllStats, isGuest } from "./auth.js?v=1781871038";

import { initAuthUI, initGuestUI }  from "./ui/authUI.js?v=1781871038";
import { initGameSetup }       from "./ui/gameSetup.js?v=1781871038";
import { initOnlineGame, launchOnlineGame, updateOnlineTurnIndicator } from "./ui/onlineGame.js?v=1781871038";
import { initFriendsUI }       from "./ui/friendsUI.js?v=1781871038";
import { initLeaderboardUI }   from "./ui/leaderboardUI.js?v=1781871038";
import { initInviteListener, sendInviteGame, showRejectionAlert } from "./ui/inviteUI.js?v=1781871038";
import { initChatUI, openChat, initChatNotifications } from "./ui/chatUI.js?v=1781871038";
import { initMessagesUI, clearUnreadFor }              from "./ui/messagesUI.js?v=1781871038";
import { renderStatsModal }    from "./ui/statsModal.js?v=1781871038";
import { initHistoryUI }       from "./ui/historyUI.js?v=1781871038";
import { resetMatchTimer }     from "./ui/gameEnd.js?v=1781871038";
import { initAchievementsUI }  from "./ui/achievementsUI.js?v=1781871038";
import { initXPUI, refreshXPBar } from "./ui/xpUI.js?v=1781871038";
import { initPowersUI, refreshInventory } from "./ui/powersUI.js?v=1781871038";
import { activatePower } from "./ui/boardRenderer.js?v=1781871038";
import { initNavMenu }            from "./ui/navMenu.js?v=1781871038";
import { initDailyChallengeUI }  from "./ui/dailyChallengeUI.js?v=1781871038";

// ── PWA ─────────────────────────────────────────────────────────
let _deferredInstallPrompt = null;
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/jazma/service-worker.js").catch(() => {});

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  document.getElementById("install-btn")?.classList.remove("hidden");
});

// ── DOMContentLoaded ────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

  const authScreen   = document.getElementById("auth-screen");
  const userBar      = document.getElementById("user-bar");
  const userPhoto    = document.getElementById("user-photo");
  const userNameEl   = document.getElementById("user-name");
  const setupScreen  = document.getElementById("setup-screen");
  const onlineScreen = document.getElementById("online-screen");
  const infoDiv      = document.getElementById("info");
  const boardSvg     = document.getElementById("board");
  const winnerScreen = document.getElementById("winner-screen");
  const statsBtn     = document.getElementById("stats-btn");
  const statsModal   = document.getElementById("stats-modal");
  const statsContent = document.getElementById("stats-content");
  const closeStatsBtn= document.getElementById("close-stats-btn");
  const onlineTurnInd= document.getElementById("online-turn-indicator");

  // ── Auth UI ──────────────────────────────────────────────────
  initAuthUI();
  initGuestUI();

  // ── إطلاق اللعبة ────────────────────────────────────────────
  function showGameUI() {
    userBar.classList.add("hidden");
    infoDiv.classList.remove("hidden");
    boardSvg.classList.remove("hidden");
    document.getElementById("nat-turn-indicator")?.classList.remove("hidden");
    document.getElementById("inventory-bar")?.classList.remove("hidden");
    refreshInventory(config);
  }
  // زر رسائل اللعب ينقر زر الرسائل الأصلي
  document.getElementById("game-messages-btn")?.addEventListener("click", () => {
    document.getElementById("messages-btn")?.click();
  });
  function launchGame() {
    setupScreen.classList.add("hidden");
    onlineScreen.classList.add("hidden");
    showGameUI();
    resetMatchTimer();
    const aiPlayer = gameSetup.getAiPlayer();
    startBoard(config, aiPlayer);
    updateScoreboard();
    updateTurnUI(config);
    audioManager.startBackgroundMusic();
  }

  // ── Game Setup ───────────────────────────────────────────────
  const gameSetup = initGameSetup({
    onGameStart:      () => launchGame(),
    onOnlineRequested: () => {
      setupScreen.classList.add("hidden");
      onlineScreen.classList.remove("hidden");
      onlineUI.showStep("name");
    },
  });

  // ── Online Game ──────────────────────────────────────────────
  const onlineUI = initOnlineGame({ onGameStart: () => launchGame() });

  // ── Chat UI (مرة واحدة — الأزرار موجودة بالـ DOM دايماً) ────
  initChatUI({});

  // ── Leaderboard ──────────────────────────────────────────────
  initLeaderboardUI();

  // ── History ──────────────────────────────────────────────────
  initHistoryUI();

  // ── Achievements ─────────────────────────────────────────────
  initAchievementsUI();

  // ── XP ────────────────────────────────────────────────────────
  initXPUI();

  // ── القدرات ──
  initPowersUI({
    onActivate: (type, player) => {
      activatePower(type, player, config);
    },
  });

  // ── التحدي اليومي ────────────────────────────────────────────
  initDailyChallengeUI({
    onGameStart: (aiPlayer) => {
      setupScreen.classList.add("hidden");
      showGameUI();
      resetMatchTimer();
      startBoard(config, aiPlayer);
      updateScoreboard();
      updateTurnUI(config);
      audioManager.startBackgroundMusic();
    },
  });

  // ── إحصائيات (مرة واحدة) ────────────────────────────────────
  statsBtn?.addEventListener("click", async () => {
    const uid = getCurrentUser()?.uid; if (!uid) return;
    statsModal?.classList.remove("hidden");
    if (statsContent) {
      statsContent.innerHTML = '<p class="stats-loading">⏳ جاري التحميل...</p>';
      await renderStatsModal(uid);
    }
  });
  closeStatsBtn?.addEventListener("click", () => statsModal?.classList.add("hidden"));
  statsModal?.addEventListener("click", e => { if (e.target === statsModal) statsModal.classList.add("hidden"); });

  // ── onUserChange ─────────────────────────────────────────────
  onUserChange(async user => {
    if (user) {
      authScreen.classList.add("hidden");
      userBar.classList.remove("hidden");
      setupScreen.classList.remove("hidden");
      userPhoto.src = user.photoURL || "";
      userPhoto.style.display = user.photoURL ? "block" : "none";
      userNameEl.textContent  = user.isAnonymous ? "👤 ضيف" : (user.displayName || "لاعب");

      // ── إخفاء ميزات غير متاحة للضيف ───────────────────────
      const guestHide = ["friends-btn", "leaderboard-btn", "stats-btn", "history-btn", "achievements-btn", "daily-btn", "messages-btn"];
      const aiModeSelect = document.getElementById("ai-mode");
      if (user.isAnonymous) {
        guestHide.forEach(id => document.getElementById(id)?.classList.add("hidden"));
        // نشيل خيار الأونلاين فقط — عدد اللاعبين يبقى حر
        if (aiModeSelect) {
          Array.from(aiModeSelect.options).forEach(o => {
            if (o.value === "online") o.disabled = true;
          });
          // لو كان محدداً على online نرجعه لـ human
          if (aiModeSelect.value === "online") aiModeSelect.value = "human";
        }
        // نتأكد إن عدد اللاعبين مفعّل دايماً للضيف
        document.getElementById("player-count").disabled = false;
        document.getElementById("player-count").closest(".setup-section")?.classList.remove("hidden");
        document.dispatchEvent(new CustomEvent("user:guest"));
      } else {
        guestHide.forEach(id => document.getElementById(id)?.classList.remove("hidden"));
        if (aiModeSelect) {
          Array.from(aiModeSelect.options).forEach(o => { o.disabled = false; });
        }
        document.getElementById("guest-upgrade-banner")?.classList.add("hidden");
      }

      // ── Friends (بعد التحقق من الهوية) ──────────────────────
      initFriendsUI({
        onInviteFriend: async (friend, resetBtn) => {
          const myName = userNameEl.textContent || "لاعب";
          const gridSize = +document.getElementById("grid-size").value || 4;
          config.rows = config.cols = gridSize;
          config.players = 2;

          await sendInviteGame(friend, config, myName, {
            onOpponentJoined: oppName => {
              config.onlinePlayerNames = { 1: myName, 2: oppName };
              document.getElementById("online-my-name").textContent  = myName;
              document.getElementById("online-opp-name").textContent = oppName;
              document.getElementById("friends-panel").classList.add("hidden");
              onlineUI.showStep("playing");
              launchOnlineGame(1, onlineTurnInd, () => launchGame());
            },
            onRoomReady: (code, friendName) => {
              setupScreen.classList.add("hidden");
              onlineScreen.classList.remove("hidden");
              document.getElementById("room-code-display").classList.add("hidden");
              document.getElementById("copy-code-btn").classList.add("hidden");
              document.getElementById("lobby-share-hint").classList.add("hidden");
              onlineUI.showStep("lobby");
              document.getElementById("lobby-status-text").textContent = `بانتظار ${friendName}...`;
              document.getElementById("friends-panel").classList.add("hidden");
            },
            onRejection: name => {
              onlineScreen.classList.add("hidden");
              setupScreen.classList.remove(  "hidden");
              resetBtn?.();          // ← يرجع زر الدعوة لحالته
              showRejectionAlert(name);
            },
          });
        },
        onOpenChat: friend => openChat(friend),
      });

      // ── Invite Listener ────────────────────────────────────
      initInviteListener({
        onInviteAccepted: async invite => {
          config.online = true;
          config.onlinePlayerNum = 2;
          setupScreen.classList.add("hidden");
          onlineScreen.classList.remove("hidden");
          onlineUI.showStep("playing");
          try {
            const roomData = await onlineManager.joinRoom(invite.roomCode, userNameEl.textContent || "لاعب");
            config.rows = roomData.cfg.rows; config.cols = roomData.cfg.cols;
            config.players = 2;
            config.onlinePlayerNames = { 1: invite.fromName, 2: userNameEl.textContent };
            document.getElementById("online-my-name").textContent  = userNameEl.textContent;
            document.getElementById("online-opp-name").textContent = invite.fromName;
            launchOnlineGame(2, onlineTurnInd, () => launchGame());
          } catch {
            onlineScreen.classList.add("hidden");
            setupScreen.classList.remove("hidden");
          }
        },
      });

      initChatNotifications();
      cleanupOldRooms();
      initMessagesUI({ onOpenChat: friend => openChat(friend) });
      refreshXPBar();
      initNavMenu();
      window._refreshStats = async () => {
        if (!statsContent || statsModal?.classList.contains("hidden")) return;
        await renderStatsModal(user.uid);
      };


      // تثبيت PWA
      const installBtn = document.getElementById("install-btn");
      installBtn?.addEventListener("click", async () => {
        if (!_deferredInstallPrompt) return;
        _deferredInstallPrompt.prompt();
        const { outcome } = await _deferredInstallPrompt.userChoice;
        if (outcome === "accepted") installBtn.classList.add("hidden");
        _deferredInstallPrompt = null;
      });
    } else {
      authScreen.classList.remove("hidden");
      userBar.classList.add("hidden");
      setupScreen.classList.add("hidden");
    }
  });

  // ── Restart / Play Again ─────────────────────────────────────
  const restartBtn   = document.getElementById("restart");
  const playAgainBtn = document.getElementById("play-again");

  restartBtn?.addEventListener("click", async () => {
    audioManager.playButtonClick();
    audioManager.stopBackgroundMusic();
    if (config.online) {
      await onlineManager.sendRestart();
      await new Promise(r => setTimeout(r, 500));
      await onlineManager.leaveRoom();
    }
    config.online = false;
    userBar.classList.remove("hidden");
    infoDiv.classList.add("hidden");
    document.getElementById("board")?.classList.add("hidden");
    document.getElementById("nat-turn-indicator")?.classList.add("hidden");
    document.getElementById("inventory-bar")?.classList.add("hidden");
    onlineScreen.classList.add("hidden");
    setupScreen.classList.remove("hidden");
    gameSetup.resetUI();
    resetState();
  });

  playAgainBtn?.addEventListener("click", () => {
    winnerScreen?.classList.add("hidden");
    restartBtn?.click();
  });

  // ── صوت وموسيقى ─────────────────────────────────────────────
  document.getElementById("sound-toggle")?.addEventListener("click", function () {
    const on = audioManager.toggle();
    this.textContent = on ? "🔊" : "🔇";
    this.classList.toggle("muted", !on);
    if (on) audioManager.playButtonClick();
  });

  document.getElementById("music-toggle")?.addEventListener("click", function () {
    const on = audioManager.toggleMusic();
    this.textContent = on ? "🎵" : "🎶";
    this.classList.toggle("muted", !on);
    audioManager.playButtonClick();
  });

});
