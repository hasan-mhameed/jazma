// 📄 ui/onlineGame.js
// منطق الأونلاين — إنشاء غرفة، انضمام، حركات
import { config } from "../config/config.js?v=1780438051";
import { onlineManager } from "../firebase.js?v=1780438051";
import { applyOnlineMove } from "./boardRenderer.js?v=1780438051";
import { state } from "../core/state.js?v=1780438051";
import { getCurrentUser } from "../auth.js?v=1780438051";

export function initOnlineGame({ onGameStart }) {
  const stepName        = document.getElementById("online-step-name");
  const stepLobby       = document.getElementById("online-step-lobby");
  const stepPlaying     = document.getElementById("online-step-playing");
  const playerNameInput = document.getElementById("player-name-input");
  const roomCodeInput   = document.getElementById("room-code-input");
  const createRoomBtn   = document.getElementById("create-room-btn");
  const joinRoomBtn     = document.getElementById("join-room-btn");
  const cancelRoomBtn   = document.getElementById("cancel-room-btn");
  const onlineBackBtn   = document.getElementById("online-back-btn");
  const copyCodeBtn     = document.getElementById("copy-code-btn");
  const roomCodeDisplay = document.getElementById("room-code-display");
  const lobbyStatusText = document.getElementById("lobby-status-text");
  const onlineError     = document.getElementById("online-error");
  const onlineMyName    = document.getElementById("online-my-name");
  const onlineOppName   = document.getElementById("online-opp-name");
  const onlineTurnInd   = document.getElementById("online-turn-indicator");
  const onlineScreen    = document.getElementById("online-screen");
  const setupScreen     = document.getElementById("setup-screen");

  function showStep(step) {
    stepName.classList.add("hidden");
    stepLobby.classList.add("hidden");
    stepPlaying.classList.add("hidden");
    onlineError.classList.add("hidden");
    if (step === "name" || step === "lobby") {
      if (getCurrentUser()?.displayName) playerNameInput.value = getCurrentUser().displayName;
    }
    if (step === "name")    stepName.classList.remove("hidden");
    if (step === "lobby")   stepLobby.classList.remove("hidden");
    if (step === "playing") stepPlaying.classList.remove("hidden");
  }

  function showError(msg) { onlineError.textContent = msg; onlineError.classList.remove("hidden"); }

  function getPlayerName() {
    const name = playerNameInput.value.trim();
    if (!name) { showError("❗ أدخل اسمك أولاً!"); return null; }
    return name;
  }

  // ── إنشاء غرفة ──────────────────────────────────────────────
  createRoomBtn?.addEventListener("click", async () => {
    const name = getPlayerName(); if (!name) return;
    createRoomBtn.disabled = true;
    try {
      const gridSize = +document.getElementById("grid-size").value;
      config.rows = config.cols = gridSize;
      config.players = 2; config.online = true; config.onlinePlayerNum = 1;

      onlineManager.onOpponentJoined(oppName => {
        config.onlinePlayerNames = { 1: name, 2: oppName };
        onlineMyName.textContent  = name;
        onlineOppName.textContent = oppName;
        showStep("playing");
        launchOnlineGame(1, onlineTurnInd, onGameStart);
      });

      const code = await onlineManager.createRoom(config, name);
      roomCodeDisplay.textContent = code;
      roomCodeDisplay.classList.remove("hidden");
      copyCodeBtn.classList.remove("hidden");
      document.getElementById("lobby-share-hint").classList.remove("hidden");
      showStep("lobby");
      lobbyStatusText.textContent = "بانتظار الخصم...";
    } catch (e) { showError(e.message); }
    finally { createRoomBtn.disabled = false; }
  });

  // ── نسخ الكود ────────────────────────────────────────────────
  copyCodeBtn?.addEventListener("click", () => {
    navigator.clipboard?.writeText(roomCodeDisplay.textContent);
    copyCodeBtn.textContent = "✅ تم النسخ!";
    setTimeout(() => { copyCodeBtn.textContent = "📋 نسخ الكود"; }, 2000);
  });

  // ── الانضمام لغرفة ───────────────────────────────────────────
  joinRoomBtn?.addEventListener("click", async () => {
    const name = getPlayerName(); if (!name) return;
    const code = roomCodeInput.value.trim();
    if (code.length !== 6) { showError("❗ الكود يجب أن يكون 6 أرقام"); return; }
    joinRoomBtn.disabled = true;
    try {
      const roomData = await onlineManager.joinRoom(code, name);
      config.rows = roomData.cfg.rows; config.cols = roomData.cfg.cols;
      config.players = 2; config.online = true; config.onlinePlayerNum = 2;
      const oppName = roomData.p1name || "اللاعب 1";
      config.onlinePlayerNames = { 1: oppName, 2: name };
      onlineMyName.textContent  = name;
      onlineOppName.textContent = oppName;
      showStep("playing");
      launchOnlineGame(2, onlineTurnInd, onGameStart);
    } catch (e) { showError(e.message); }
    finally { joinRoomBtn.disabled = false; }
  });

  // ── إلغاء الغرفة ─────────────────────────────────────────────
  cancelRoomBtn?.addEventListener("click", async () => {
    await onlineManager.leaveRoom();
    showStep("name");
  });

  // ── رجوع ────────────────────────────────────────────────────
  onlineBackBtn?.addEventListener("click", () => {
    onlineScreen.classList.add("hidden");
    setupScreen.classList.remove("hidden");
    const aiModeSelect = document.getElementById("ai-mode");
    if (aiModeSelect) aiModeSelect.value = "human";
    document.getElementById("ai-difficulty-section")?.classList.add("hidden");
    document.getElementById("player-count").disabled = false;
  });

  return { showStep };
}

export function launchOnlineGame(myPlayerNum, onlineTurnInd, onGameStart) {
  config.aiMode = "online";
  onlineManager.getOpponentUid().then(uid => { config.onlineOpponentUid = uid; });

  if (onlineTurnInd) {
    onlineTurnInd.textContent = "⏳ جاري تحميل اللعبة...";
    onlineTurnInd.style.color = "#888";
  }

  setTimeout(() => {
    onGameStart?.();
    updateOnlineTurnIndicator(onlineTurnInd);

    requestAnimationFrame(() => {
      onlineManager.onMove(lineKey => {
        applyOnlineMove(lineKey, config);
        updateOnlineTurnIndicator(onlineTurnInd);
      });
    });

    onlineManager.onOpponentLeft(() => showDisconnectAlert());
    onlineManager.onRestart(() => showRestartAlert());

    // ── مراقبة الاتصال ──────────────────────────────────────
    let reconnectBanner = null;
    onlineManager.onConnectionChange(connected => {
      if (connected) {
        reconnectBanner?.remove();
        reconnectBanner = null;
        if (onlineTurnInd) updateOnlineTurnIndicator(onlineTurnInd);
      } else {
        if (reconnectBanner) return;
        reconnectBanner = document.createElement("div");
        reconnectBanner.id = "reconnect-banner";
        reconnectBanner.innerHTML = `
          <span class="rc-spinner">⏳</span>
          <span>انقطع الاتصال — جاري إعادة الاتصال...</span>`;
        document.body.appendChild(reconnectBanner);
        if (onlineTurnInd) {
          onlineTurnInd.textContent = "⚡ جاري إعادة الاتصال...";
          onlineTurnInd.style.color = "#fbbf24";
        }
      }
    });
  }, 800);
}

export function updateOnlineTurnIndicator(el) {
  if (!el) return;
  const isMyTurn = state.currentPlayer === config.onlinePlayerNum;
  el.textContent = isMyTurn ? "🟢 دورك!" : "⏳ دور خصمك...";
  el.style.color = isMyTurn ? "#4ade80" : "#f87171";
}

function showAlert(borderColor, message, btnText) {
  const box = document.createElement("div");
  box.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:#1e1e2e;border:2px solid ${borderColor};border-radius:16px;
    padding:28px 36px;text-align:center;z-index:9999;box-shadow:0 8px 40px #0008;`;
  const p = document.createElement("p"); p.style.cssText = "font-size:1.2rem;margin-bottom:16px;"; p.textContent = message;
  const btn = document.createElement("button");
  btn.style.cssText = "background:#7c6af7;color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:1rem;";
  btn.textContent = btnText;
  btn.addEventListener("click", () => location.reload());
  box.append(p, btn); document.body.appendChild(box);
}
function showDisconnectAlert() { showAlert("#f87171", "❌ انقطع اتصال الخصم!", "🔄 العودة للقائمة"); }
function showRestartAlert()    { showAlert("#7c6af7", "🔄 الخصم أنهى اللعبة!",  "🏠 العودة للقائمة"); }
