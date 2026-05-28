// 📄 main.js — v13.9
// Bootstrap فقط — يربط كل الـ modules

import { config }                              from "./config/config.js";
import { startBoard, updateScoreboard, resetState } from "./board.js";
import { updateTurnUI }                        from "./ui/turnManager.js";
import { audioManager }                        from "./audio/audioManager.js";
import { onlineManager }                       from "./firebase.js";
import { onUserChange, getCurrentUser, getAllStats } from "./auth.js";
import { playNotifSound }                      from "./audio/notif.js";

import { initAuthUI }          from "./ui/authUI.js";
import { initGameSetup }       from "./ui/gameSetup.js";
import { initOnlineGame, launchOnlineGame, updateOnlineTurnIndicator } from "./ui/onlineGame.js";
import { initFriendsUI }       from "./ui/friendsUI.js";
import { initLeaderboardUI }   from "./ui/leaderboardUI.js";
import { initInviteListener, sendInviteGame, showRejectionAlert } from "./ui/inviteUI.js";
import { initChatUI, openChat, initChatNotifications } from "./ui/chatUI.js";
import { renderStatsModal }    from "./ui/statsModal.js";

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

  // ── إطلاق اللعبة ────────────────────────────────────────────
  function launchGame() {
    setupScreen.classList.add("hidden");
    onlineScreen.classList.add("hidden");
    infoDiv.classList.remove("hidden");
    boardSvg.classList.remove("hidden");
    const { aiPlayer } = gameSetup;
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

  // ── onUserChange ─────────────────────────────────────────────
  onUserChange(async user => {
    if (user) {
      authScreen.classList.add("hidden");
      userBar.classList.remove("hidden");
      setupScreen.classList.remove("hidden");
      userPhoto.src = user.photoURL || "";
      userPhoto.style.display = user.photoURL ? "block" : "none";
      userNameEl.textContent  = user.displayName || "لاعب";

      // ── Friends (بعد التحقق من الهوية) ──────────────────────
      initFriendsUI({
        onInviteFriend: async friend => {
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
              setupScreen.classList.remove("hidden");
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
      window._refreshStats = async () => {
        if (!statsContent || statsModal?.classList.contains("hidden")) return;
        await renderStatsModal(user.uid);
      };

      // إشعارات
      const notifBtn = document.getElementById("notif-btn");
      if (notifBtn && "Notification" in window) {
        if (Notification.permission === "granted") { notifBtn.classList.add("hidden"); }
        else {
          notifBtn.classList.remove("hidden");
          notifBtn.addEventListener("click", async () => {
            if (await Notification.requestPermission() === "granted") {
              notifBtn.classList.add("hidden"); playNotifSound();
            }
          });
        }
      }

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
    infoDiv.classList.add("hidden");
    boardSvg.classList.add("hidden");
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
