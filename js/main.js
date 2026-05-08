// 📄 main.js — v11.7
// نقطة الدخول للتطبيق

import { config }                          from "./config/config.js";
import { startBoard, updateScoreboard, resetState } from "./board.js";
import { updateTurn, updateTurnUI }        from "./ui/turnManager.js";
import { audioManager }                    from "./audio/audioManager.js";
import { AIPlayer }                        from "./ai/aiPlayer.js";
import { onlineManager }                   from "./firebase.js";
import { applyOnlineMove }                 from "./ui/boardRenderer.js";
import { state }                           from "./core/state.js";
import { onUserChange, signInWithGoogle, logout, getUserProfile,
         registerWithEmail, signInWithEmail } from "./auth.js";

let aiPlayer = null;

document.addEventListener("DOMContentLoaded", () => {

  /* ── عناصر الـ DOM ── */
  const authScreen        = document.getElementById("auth-screen");
  const userBar           = document.getElementById("user-bar");
  const userPhoto         = document.getElementById("user-photo");
  const userNameEl        = document.getElementById("user-name");
  const userWinsEl        = document.getElementById("user-wins");
  const userLossesEl      = document.getElementById("user-losses");
  const logoutBtn         = document.getElementById("logout-btn");
  const googleSigninBtn   = document.getElementById("google-signin-btn");
  const setupScreen       = document.getElementById("setup-screen");
  const onlineScreen      = document.getElementById("online-screen");
  const infoDiv           = document.getElementById("info");
  const boardSvg          = document.getElementById("board");
  const winnerScreen      = document.getElementById("winner-screen");

  const gridSizeSelect    = document.getElementById("grid-size");
  const playerCountSelect = document.getElementById("player-count");
  const aiModeSelect      = document.getElementById("ai-mode");
  const aiDifficultySelect= document.getElementById("ai-difficulty");
  const aiDifficultySection = document.getElementById("ai-difficulty-section");
  const gridPreview       = document.querySelector(".preview-grid");
  const startGameBtn      = document.getElementById("start-game");

  // أونلاين
  const stepName          = document.getElementById("online-step-name");
  const stepLobby         = document.getElementById("online-step-lobby");
  const stepPlaying       = document.getElementById("online-step-playing");
  const playerNameInput   = document.getElementById("player-name-input");
  const roomCodeInput     = document.getElementById("room-code-input");
  const createRoomBtn     = document.getElementById("create-room-btn");
  const joinRoomBtn       = document.getElementById("join-room-btn");
  const onlineBackBtn     = document.getElementById("online-back-btn");
  const cancelRoomBtn     = document.getElementById("cancel-room-btn");
  const roomCodeDisplay   = document.getElementById("room-code-display");
  const copyCodeBtn       = document.getElementById("copy-code-btn");
  const lobbyStatusText   = document.getElementById("lobby-status-text");
  const onlineError       = document.getElementById("online-error");
  const onlineMyName      = document.getElementById("online-my-name");
  const onlineOppName     = document.getElementById("online-opp-name");
  const onlineTurnInd     = document.getElementById("online-turn-indicator");

  const authError         = document.getElementById("auth-error");
  const emailLoginBtn     = document.getElementById("email-login-btn");
  const emailRegisterBtn  = document.getElementById("email-register-btn");
  const authTabs          = document.querySelectorAll(".auth-tab");

  // ── تبديل التبويبات ──
  authTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      authTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".auth-tab-content").forEach(c => c.classList.add("hidden"));
      document.getElementById(`tab-${tab.dataset.tab}`).classList.remove("hidden");
      authError.classList.add("hidden");
    });
  });

  function showAuthError(msg) {
    authError.textContent = msg;
    authError.classList.remove("hidden");
  }

  // ── دخول بإيميل ──
  emailLoginBtn?.addEventListener("click", async () => {
    const email    = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    if (!email || !password) return showAuthError("❗ أدخل الإيميل وكلمة السر");
    emailLoginBtn.disabled = true;
    try {
      await signInWithEmail(email, password);
    } catch (e) {
      showAuthError(getAuthError(e.code));
      emailLoginBtn.disabled = false;
    }
  });

  // ── تسجيل حساب جديد ──
  emailRegisterBtn?.addEventListener("click", async () => {
    const name     = document.getElementById("register-name").value.trim();
    const email    = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;
    if (!name)               return showAuthError("❗ أدخل اسمك");
    if (!email)              return showAuthError("❗ أدخل الإيميل");
    if (password.length < 8) return showAuthError("❗ كلمة السر 8 أحرف على الأقل");
    if (!/[A-Z]/.test(password)) return showAuthError("❗ يجب أن تحتوي على حرف كبير");
    if (!/[0-9]/.test(password)) return showAuthError("❗ يجب أن تحتوي على رقم");
    if (!/[^A-Za-z0-9]/.test(password)) return showAuthError("❗ يجب أن تحتوي على رمز (!@#$...)");
    emailRegisterBtn.disabled = true;
    try {
      await registerWithEmail(name, email, password);
    } catch (e) {
      showAuthError(getAuthError(e.code));
      emailRegisterBtn.disabled = false;
    }
  });

  // ── مؤشر قوة كلمة السر ──
  document.getElementById("register-password")?.addEventListener("input", (e) => {
    const password = e.target.value;
    let strength = 0;
    if (password.length >= 8)          strength++;
    if (/[A-Z]/.test(password))        strength++;
    if (/[0-9]/.test(password))        strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    const indicator = document.getElementById("password-strength");
    if (!indicator) return;
    const labels = ["", "ضعيفة 🔴", "متوسطة 🟡", "جيدة 🟠", "قوية 🟢"];
    const colors  = ["", "#f87171",  "#fbbf24",   "#fb923c",  "#4ade80"];
    indicator.textContent  = password ? labels[strength] : "";
    indicator.style.color  = colors[strength];
  });

  function getAuthError(code) {
    const errors = {
      "auth/email-already-in-use":   "هذا الإيميل مسجّل مسبقاً",
      "auth/invalid-email":          "إيميل غير صحيح",
      "auth/wrong-password":         "كلمة السر غير صحيحة",
      "auth/user-not-found":         "لا يوجد حساب بهذا الإيميل",
      "auth/weak-password":          "كلمة السر ضعيفة جداً",
      "auth/too-many-requests":      "محاولات كثيرة، حاول لاحقاً",
      "auth/invalid-credential":     "الإيميل أو كلمة السر غير صحيحة",
    };
    return errors[code] || "حدث خطأ، حاول مرة ثانية";
  }

  /* ── تسجيل الدخول ── */
  onUserChange(async (user) => {
    if (user) {
      // مسجّل دخول
      authScreen.classList.add("hidden");
      userBar.classList.remove("hidden");
      setupScreen.classList.remove("hidden");

      userPhoto.src = user.photoURL || "";
      userPhoto.style.display = user.photoURL ? "block" : "none";
      userNameEl.textContent  = user.displayName || "لاعب";

      // جلب الإحصائيات
      const profile = await getUserProfile(user.uid);
      if (profile) {
        userWinsEl.textContent   = `🏆 ${profile.wins   || 0}`;
        userLossesEl.textContent = `❌ ${profile.losses || 0}`;
      }
    } else {
      // غير مسجّل
      authScreen.classList.remove("hidden");
      userBar.classList.add("hidden");
      setupScreen.classList.add("hidden");
    }
  });

  googleSigninBtn?.addEventListener("click", async () => {
    try {
      googleSigninBtn.disabled = true;
      googleSigninBtn.textContent = "جاري الدخول...";
      await signInWithGoogle();
    } catch (e) {
      googleSigninBtn.disabled = false;
      googleSigninBtn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="20"/> تسجيل الدخول بـ Google`;
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    await logout();
  });

  /* ── معاينة اللوحة ── */
  function updateGridPreview(size) {
    if (!gridPreview) return;
    gridPreview.setAttribute("data-size", size);
    gridPreview.innerHTML = "";
    for (let i = 0; i < size * size; i++) {
      gridPreview.appendChild(document.createElement("span"));
    }
  }
  if (gridSizeSelect) {
    gridSizeSelect.addEventListener("change", e => updateGridPreview(+e.target.value));
  }

  /* ── AI mode toggle ── */
  if (aiModeSelect) {
    aiModeSelect.addEventListener("change", e => {
      const isAI = e.target.value === "ai";
      aiDifficultySection.classList.toggle("hidden", !isAI);
      if (isAI) { playerCountSelect.value = "2"; playerCountSelect.disabled = true; }
      else       { playerCountSelect.disabled = false; }

      // وضع أونلاين → فتح شاشة الأونلاين
      if (e.target.value === "online") {
        setupScreen.classList.add("hidden");
        showOnlineStep("name");
        onlineScreen.classList.remove("hidden");
      }
    });
  }

  /* ── بدء اللعبة (offline) ── */
  if (startGameBtn) {
    startGameBtn.addEventListener("click", () => {
      audioManager.playButtonClick();
      const gridSize    = +gridSizeSelect.value;
      const playerCount = +playerCountSelect.value;
      const aiMode      = aiModeSelect ? aiModeSelect.value : "human";
      const aiDifficulty= aiDifficultySelect ? aiDifficultySelect.value : "medium";

      if (aiMode === "online") {
        // فتح شاشة الأونلاين
        setupScreen.classList.add("hidden");
        showOnlineStep("name");
        onlineScreen.classList.remove("hidden");
        return;
      }

      config.rows    = gridSize;
      config.cols    = gridSize;
      config.players = playerCount;
      config.aiMode  = aiMode;
      config.online  = false;

      aiPlayer = aiMode === "ai" ? new AIPlayer(aiDifficulty) : null;
      if (aiMode === "ai") config.players = 2;

      launchGame();
    });
  }

  function launchGame() {
    setupScreen.classList.add("hidden");
    onlineScreen.classList.add("hidden");
    infoDiv.classList.remove("hidden");
    boardSvg.classList.remove("hidden");
    startBoard(config, aiPlayer);
    updateScoreboard();
    updateTurnUI(config);
    audioManager.startBackgroundMusic();
  }

  /* ══════════════════════════════════════
     🌐 منطق الأونلاين
  ══════════════════════════════════════ */
  function showOnlineStep(step) {
    stepName.classList.add("hidden");
    stepLobby.classList.add("hidden");
    stepPlaying.classList.add("hidden");
    onlineError.classList.add("hidden");
    if (step === "name")    stepName.classList.remove("hidden");
    if (step === "lobby")   stepLobby.classList.remove("hidden");
    if (step === "playing") stepPlaying.classList.remove("hidden");
  }

  function showOnlineError(msg) {
    onlineError.textContent = msg;
    onlineError.classList.remove("hidden");
  }

  function getPlayerName() {
    const name = playerNameInput.value.trim();
    if (!name) { showOnlineError("❗ أدخل اسمك أولاً!"); return null; }
    return name;
  }

  /* إنشاء غرفة */
  if (createRoomBtn) {
    createRoomBtn.addEventListener("click", async () => {
      const name = getPlayerName(); if (!name) return;
      createRoomBtn.disabled = true;
      try {
        const gridSize = +gridSizeSelect.value;
        config.rows = config.cols = gridSize;
        config.players = 2;
        config.online  = true;
        config.onlinePlayerNum = 1;

        // ✅ سجّل الـ callback أولاً قبل createRoom
        onlineManager.onOpponentJoined((oppName) => {
          const myName = name;
          config.onlinePlayerNames = { 1: myName, 2: oppName };
          onlineMyName.textContent  = myName;
          onlineOppName.textContent = oppName;
          showOnlineStep("playing");
          launchOnlineGame(1);
        });

        const code = await onlineManager.createRoom(config, name);
        roomCodeDisplay.textContent = code;
        showOnlineStep("lobby");
        lobbyStatusText.textContent = "بانتظار الخصم...";

      } catch (e) {
        showOnlineError(e.message);
      } finally {
        createRoomBtn.disabled = false;
      }
    });
  }

  /* نسخ الكود */
  if (copyCodeBtn) {
    copyCodeBtn.addEventListener("click", () => {
      navigator.clipboard?.writeText(roomCodeDisplay.textContent);
      copyCodeBtn.textContent = "✅ تم النسخ!";
      setTimeout(() => { copyCodeBtn.textContent = "📋 نسخ الكود"; }, 2000);
    });
  }

  /* الانضمام لغرفة */
  if (joinRoomBtn) {
    joinRoomBtn.addEventListener("click", async () => {
      const name = getPlayerName(); if (!name) return;
      const code = roomCodeInput.value.trim();
      if (code.length !== 6) { showOnlineError("❗ الكود يجب أن يكون 6 أرقام"); return; }

      joinRoomBtn.disabled = true;
      try {
        const roomData = await onlineManager.joinRoom(code, name);
        config.rows = roomData.cfg.rows;
        config.cols = roomData.cfg.cols;
        config.players = 2;
        config.online  = true;
        config.onlinePlayerNum = 2;

        const oppName = roomData.p1name || "اللاعب 1";
        config.onlinePlayerNames = { 1: oppName, 2: name };
        onlineMyName.textContent  = name;
        onlineOppName.textContent = oppName;
        showOnlineStep("playing");
        launchOnlineGame(2);

      } catch (e) {
        showOnlineError(e.message);
      } finally {
        joinRoomBtn.disabled = false;
      }
    });
  }

  /* إلغاء الغرفة */
  if (cancelRoomBtn) {
    cancelRoomBtn.addEventListener("click", async () => {
      await onlineManager.leaveRoom();
      showOnlineStep("name");
    });
  }

  /* رجوع من شاشة الأونلاين */
  if (onlineBackBtn) {
    onlineBackBtn.addEventListener("click", () => {
      onlineScreen.classList.add("hidden");
      setupScreen.classList.remove("hidden");
      aiModeSelect.value = "human";
      aiDifficultySection.classList.add("hidden");
      playerCountSelect.disabled = false;
    });
  }

  /* ── إطلاق لعبة أونلاين ── */
  let _moveSeq = 0; // رقم تسلسلي للحركات

  function launchOnlineGame(myPlayerNum) {
    config.aiMode = "online";
    _moveSeq = 0;
    aiPlayer = null;
    launchGame();
    updateOnlineTurnIndicator();

    // ✅ سجّل onMove بعد ما اللوحة تتبنى (requestAnimationFrame يضمن إن الـ DOM جاهز)
    requestAnimationFrame(() => {
      onlineManager.onMove((lineKey) => {
        applyOpponentMove(lineKey);
      });
    });

    onlineManager.onOpponentLeft(() => {
      showDisconnectAlert();
    });

    // إشعار restart من الخصم
    onlineManager.onRestart(() => {
      showRestartAlert();
    });
  }

  function updateOnlineTurnIndicator() {
    if (!onlineTurnInd) return;
    const isMyTurn = state.currentPlayer === config.onlinePlayerNum;
    onlineTurnInd.textContent = isMyTurn ? "🟢 دورك!" : "⏳ دور خصمك...";
    onlineTurnInd.style.color = isMyTurn ? "#4ade80" : "#f87171";
  }

  /* تطبيق حركة الخصم على اللوحة */
  function applyOpponentMove(lineKey) {
    applyOnlineMove(lineKey, config);
    updateOnlineTurnIndicator();
  }

  /* تنبيه restart من الخصم */
  function showRestartAlert() {
    const box = document.createElement("div");
    box.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      background:#1e1e2e;border:2px solid #7c6af7;border-radius:16px;
      padding:28px 36px;text-align:center;z-index:9999;box-shadow:0 8px 40px #0008;
    `;
    box.innerHTML = `
      <p style="font-size:1.2rem;margin-bottom:16px;">🔄 الخصم أنهى اللعبة!</p>
      <button onclick="location.reload()" style="background:#7c6af7;color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:1rem;">🏠 العودة للقائمة</button>
    `;
    document.body.appendChild(box);
  }

  /* تنبيه انقطاع الاتصال */
  function showDisconnectAlert() {
    const box = document.createElement("div");
    box.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      background:#1e1e2e;border:2px solid #f87171;border-radius:16px;
      padding:28px 36px;text-align:center;z-index:9999;box-shadow:0 8px 40px #0008;
    `;
    box.innerHTML = `
      <p style="font-size:1.2rem;margin-bottom:16px;">❌ انقطع اتصال الخصم!</p>
      <button onclick="location.reload()" style="background:#7c6af7;color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:1rem;">🔄 العودة للقائمة</button>
    `;
    document.body.appendChild(box);
  }

  /* ══════════════════════════════════════
     🔄 Restart / Play Again
  ══════════════════════════════════════ */
  const restartBtn  = document.getElementById("restart");
  const playAgainBtn= document.getElementById("play-again");

  if (restartBtn) {
    restartBtn.addEventListener("click", async () => {
      audioManager.playButtonClick();
      audioManager.stopBackgroundMusic();
      if (config.online) {
        await onlineManager.sendRestart();
        // ننتظر 500ms عشان الإشعار يوصل للخصم قبل ما نمسح الـ listeners
        await new Promise(r => setTimeout(r, 500));
        await onlineManager.leaveRoom();
      }
      aiPlayer = null;
      config.online = false;
      infoDiv.classList.add("hidden");
      boardSvg.classList.add("hidden");
      onlineScreen.classList.add("hidden");
      setupScreen.classList.remove("hidden");
      aiModeSelect.value = "human";
      aiDifficultySection.classList.add("hidden");
      playerCountSelect.disabled = false;
      resetState();
    });
  }

  if (playAgainBtn) {
    playAgainBtn.addEventListener("click", () => {
      if (winnerScreen) winnerScreen.classList.add("hidden");
      restartBtn?.click();
    });
  }

  /* ══════════════════════════════════════
     🔊 صوت وموسيقى
  ══════════════════════════════════════ */
  const soundToggleBtn = document.getElementById("sound-toggle");
  const musicToggleBtn = document.getElementById("music-toggle");

  soundToggleBtn?.addEventListener("click", () => {
    const on = audioManager.toggle();
    soundToggleBtn.textContent = on ? "🔊" : "🔇";
    soundToggleBtn.classList.toggle("muted", !on);
    if (on) audioManager.playButtonClick();
  });

  musicToggleBtn?.addEventListener("click", () => {
    const on = audioManager.toggleMusic();
    musicToggleBtn.textContent = on ? "🎵" : "🎶";
    musicToggleBtn.classList.toggle("muted", !on);
    audioManager.playButtonClick();
  });

});

