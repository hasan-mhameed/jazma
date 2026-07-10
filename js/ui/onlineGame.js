// 📄 ui/onlineGame.js
// منطق الأونلاين — إنشاء غرفة، انضمام، حركات
import { config } from "../config/config.js?v=1783724197";
import { onlineManager } from "../firebase.js?v=1783724197";
import { applyOnlineMove } from "./boardRenderer.js?v=1783724197";
import { state } from "../core/state.js?v=1783724197";
import { getCurrentUser } from "../auth.js?v=1783724197";

export function initOnlineGame({ onGameStart }) {
  const stepName        = document.getElementById("online-step-name");
  const stepLobby       = document.getElementById("online-step-lobby");
  const stepPlaying     = document.getElementById("online-step-playing");
  const playerNameInput = document.getElementById("player-name-input");
  const roomCodeInput   = document.getElementById("room-code-input");
  const createRoomBtn   = document.getElementById("create-room-btn");
  const joinRoomBtn     = document.getElementById("join-room-btn");
  const randomMatchBtn  = document.getElementById("random-match-btn");
  const cancelSearchBtn = document.getElementById("cancel-search-btn");
  const stepSearching   = document.getElementById("online-step-searching");
  const searchingText   = document.getElementById("searching-text");
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

  const stepMultiCount  = document.getElementById("online-step-multi-count");
  const stepMultiLobby  = document.getElementById("online-step-multi-lobby");

  function showStep(step) {
    stepName.classList.add("hidden");
    stepLobby.classList.add("hidden");
    stepPlaying.classList.add("hidden");
    stepSearching?.classList.add("hidden");
    stepMultiCount?.classList.add("hidden");
    stepMultiLobby?.classList.add("hidden");
    onlineError.classList.add("hidden");
    if (step === "name" || step === "lobby") {
      if (getCurrentUser()?.displayName) playerNameInput.value = getCurrentUser().displayName;
    }
    if (step === "name")       stepName.classList.remove("hidden");
    if (step === "lobby")      stepLobby.classList.remove("hidden");
    if (step === "playing")    stepPlaying.classList.remove("hidden");
    if (step === "searching")  stepSearching?.classList.remove("hidden");
    if (step === "multiCount") stepMultiCount?.classList.remove("hidden");
    if (step === "multiLobby") stepMultiLobby?.classList.remove("hidden");
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
      // نكشف نوع الغرفة أولاً (ثنائية أو جماعية)
      const roomType = await onlineManager.getRoomType(code);
      if (roomType === "multi") {
        // انضمام لغرفة جماعية
        const res = await onlineManager.joinMultiRoom(code, name);
        _isMultiHost = false;
        multiCodeDisplay.textContent = code;
        setupMultiLobby();
        showStep("multiLobby");
      } else {
        // انضمام لغرفة ثنائية (المسار القديم)
        const roomData = await onlineManager.joinRoom(code, name);
        config.rows = roomData.cfg.rows; config.cols = roomData.cfg.cols;
        config.players = 2; config.online = true; config.onlinePlayerNum = 2;
        const oppName = roomData.p1name || "اللاعب 1";
        config.onlinePlayerNames = { 1: oppName, 2: name };
        onlineMyName.textContent  = name;
        onlineOppName.textContent = oppName;
        showStep("playing");
        launchOnlineGame(2, onlineTurnInd, onGameStart);
      }
    } catch (e) { showError(e.message); }
    finally { joinRoomBtn.disabled = false; }
  });

  // ── مطابقة عشوائية (زي السنوكر) ─────────────────────────────
  randomMatchBtn?.addEventListener("click", async () => {
    const name = getPlayerName(); if (!name) return;
    randomMatchBtn.disabled = true;
    try {
      const gridSize = +document.getElementById("grid-size").value;
      config.rows = config.cols = gridSize;
      config.players = 2; config.online = true;

      // لو انضممنا كخصم لغرفة موجودة، نبدأ فوراً كلاعب 2
      onlineManager.onOpponentJoined(oppName => {
        // هذا يُستدعى لو كنا مضيفين وانضم إلينا خصم
        config.onlinePlayerNames = { 1: name, 2: oppName };
        config.onlinePlayerNum = 1;
        onlineMyName.textContent  = name;
        onlineOppName.textContent = oppName;
        showStep("playing");
        launchOnlineGame(1, onlineTurnInd, onGameStart);
      });

      showStep("searching");
      searchingText.textContent = `جارٍ البحث عن خصم بلوحة ${gridSize}×${gridSize}...`;

      const result = await onlineManager.findRandomMatch(config, name);

      if (result.role === "guest") {
        // انضممنا لخصم موجود — نبدأ كلاعب 2 فوراً
        config.rows = result.cfg.rows; config.cols = result.cfg.cols;
        config.players = 2; config.online = true; config.onlinePlayerNum = 2;
        const oppName = result.p1name || "الخصم";
        config.onlinePlayerNames = { 1: oppName, 2: name };
        onlineMyName.textContent  = name;
        onlineOppName.textContent = oppName;
        showStep("playing");
        launchOnlineGame(2, onlineTurnInd, onGameStart);
      } else {
        // أنشأنا غرفة عامة — ننتظر خصماً (onOpponentJoined سيتكفّل بالبدء)
        searchingText.textContent = `بانتظار خصم بلوحة ${gridSize}×${gridSize}...`;
      }
    } catch (e) {
      showError(e.message || "تعذّر البحث عن خصم");
      showStep("name");
    } finally { randomMatchBtn.disabled = false; }
  });

  // ── إلغاء البحث العشوائي ────────────────────────────────────
  cancelSearchBtn?.addEventListener("click", async () => {
    await onlineManager.cancelRandomMatch();
    showStep("name");
  });

  // ── إلغاء الغرفة ─────────────────────────────────────────────
  cancelRoomBtn?.addEventListener("click", async () => {
    await onlineManager.leaveRoom();
    showStep("name");
  });

  // ── رجوع ────────────────────────────────────────────────────
  // ═══ الغرفة الجماعية (3-4 لاعبين) ═══════════════════════════
  const createMultiBtn    = document.getElementById("create-multi-btn");
  const multiCountChips   = document.getElementById("multi-count-chips");
  const multiCreateConfirm= document.getElementById("multi-create-confirm");
  const multiCountBack    = document.getElementById("multi-count-back");
  const multiCodeDisplay  = document.getElementById("multi-code-display");
  const multiCopyCode     = document.getElementById("multi-copy-code");
  const multiPlayersList  = document.getElementById("multi-players-list");
  const multiStartBtn     = document.getElementById("multi-start-btn");
  const multiWaitHint     = document.getElementById("multi-wait-hint");
  const multiLobbyLeave   = document.getElementById("multi-lobby-leave");

  let _multiMaxPlayers = 3;
  let _isMultiHost = false;

  // بناء أزرار اختيار العدد
  function buildMultiCountChips() {
    if (!multiCountChips) return;
    multiCountChips.innerHTML = "";
    [2, 3, 4].forEach(n => {
      const chip = document.createElement("button");
      chip.className = "chip" + (n === _multiMaxPlayers ? " active" : "");
      chip.textContent = `${n} لاعبين`;
      chip.addEventListener("click", (e) => {
        e.currentTarget.blur();
        _multiMaxPlayers = n;
        buildMultiCountChips();
      });
      multiCountChips.appendChild(chip);
    });
  }

  // فتح شاشة اختيار العدد
  createMultiBtn?.addEventListener("click", () => {
    const name = getPlayerName(); if (!name) return;
    buildMultiCountChips();
    showStep("multiCount");
  });
  multiCountBack?.addEventListener("click", () => showStep("name"));

  // إنشاء الغرفة الجماعية
  multiCreateConfirm?.addEventListener("click", async () => {
    const name = getPlayerName(); if (!name) return;
    try {
      const gridSize = +document.getElementById("grid-size").value || 4;
      config.rows = config.cols = gridSize;
      const { code } = await onlineManager.createMultiRoom(config, name, _multiMaxPlayers);
      _isMultiHost = true;
      multiCodeDisplay.textContent = code;
      setupMultiLobby();
      showStep("multiLobby");
    } catch (e) { showError(e.message || "تعذّر إنشاء الغرفة"); }
  });

  // إعداد اللوبي (استماع لتحديثات اللاعبين + البدء)
  function setupMultiLobby() {
    onlineManager.onLobbyUpdate((players, room) => {
      renderMultiPlayers(players, room);
    });
    onlineManager.onMultiStart((room) => {
      startMultiMatch(room);
    });
  }

  // عرض اللاعبين المنضمّين
  function renderMultiPlayers(players, room) {
    if (!multiPlayersList) return;
    const list = Object.values(players || {}).sort((a, b) => a.num - b.num);
    multiPlayersList.innerHTML = "";
    list.forEach(p => {
      const item = document.createElement("div");
      item.className = "multi-player-item" + (p.active === false ? " inactive" : "");
      item.innerHTML = `<span class="mp-num">${p.num}</span><span class="mp-name">${p.name}</span>${p.num === 1 ? '<span class="mp-host">👑</span>' : ''}`;
      multiPlayersList.appendChild(item);
    });
    const count = list.length;
    const max = room?.maxPlayers || _multiMaxPlayers;
    // المضيف يرى زر البدء (لو ≥2 لاعبين)
    if (_isMultiHost) {
      multiStartBtn?.classList.toggle("hidden", count < 2);
      if (multiWaitHint) multiWaitHint.textContent = count < 2
        ? "بانتظار انضمام لاعب آخر على الأقل..."
        : `${count} من ${max} لاعبين — يمكنك البدء أو انتظار المزيد`;
    } else {
      if (multiWaitHint) multiWaitHint.textContent = `${count} من ${max} لاعبين — بانتظار أن يبدأ المضيف...`;
    }
  }

  // المضيف يبدأ المباراة
  multiStartBtn?.addEventListener("click", async () => {
    await onlineManager.startMultiGame();
  });

  // بدء المباراة الجماعية (للجميع)
  function startMultiMatch(room) {
    const players = room.players || {};
    const myNum = onlineManager.playerNum;
    const names = {};
    Object.values(players).forEach(p => { names[p.num] = p.name; });
    config.rows = room.cfg.rows; config.cols = room.cfg.cols;
    config.players = room.playerCount || Object.keys(players).length;
    config.online = true;
    config.aiMode = "online";
    config.onlinePlayerNum = myNum;
    config.onlinePlayerNames = names;
    config.multiPlayers = players;
    showStep("playing");
    // نستخدم مسار اللعب الأونلاين المتعدد
    launchOnlineMultiGame(myNum, onlineTurnInd, onGameStart);
  }

  // نسخ كود الغرفة الجماعية
  multiCopyCode?.addEventListener("click", () => {
    const code = multiCodeDisplay.textContent;
    navigator.clipboard?.writeText(code);
    multiCopyCode.textContent = "✓ تم النسخ";
    setTimeout(() => { multiCopyCode.textContent = "📋 نسخ الكود"; }, 1500);
  });

  // مغادرة اللوبي الجماعي
  multiLobbyLeave?.addEventListener("click", async () => {
    await onlineManager.leaveRoom();
    _isMultiHost = false;
    showStep("name");
  });

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
  config.onlinePlayerNum = myPlayerNum;
  onlineManager.getOpponentUid().then(uid => { config.onlineOpponentUid = uid; });

  if (onlineTurnInd) {
    onlineTurnInd.textContent = "⏳ جاري تحميل اللعبة...";
    onlineTurnInd.style.color = "#888";
  }

  // الضيف ينتظر خريطة العناصر من المضيف (تزامن التوزيع)
  const prepare = async () => {
    config._sharedElementMap = null;
    if (myPlayerNum === 2) {
      // نحاول جلب الخريطة (مع إعادة محاولة قصيرة لو المضيف لسا ما بثّها)
      for (let i = 0; i < 10; i++) {
        const map = await onlineManager.fetchElementMap();
        if (map && Object.keys(map).length) { config._sharedElementMap = map; break; }
        await new Promise(r => setTimeout(r, 300));
      }
    }
  };

  setTimeout(async () => {
    await prepare();
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

// ═══ إطلاق اللعب الجماعي (3-4 لاعبين) ═══════════════════════
export function launchOnlineMultiGame(myPlayerNum, onlineTurnInd, onGameStart) {
  config.aiMode = "online";
  config.onlinePlayerNum = myPlayerNum;

  if (onlineTurnInd) {
    onlineTurnInd.textContent = "⏳ جاري تحميل اللعبة...";
    onlineTurnInd.style.color = "#888";
  }

  // الضيوف (غير المضيف) ينتظرون خريطة العناصر من المضيف
  const prepare = async () => {
    config._sharedElementMap = null;
    if (myPlayerNum !== 1) {
      for (let i = 0; i < 12; i++) {
        const map = await onlineManager.fetchElementMap();
        if (map && Object.keys(map).length) { config._sharedElementMap = map; break; }
        await new Promise(r => setTimeout(r, 300));
      }
    }
  };

  setTimeout(async () => {
    await prepare();
    onGameStart?.();
    updateOnlineTurnIndicator(onlineTurnInd);

    requestAnimationFrame(() => {
      // تطبيق حركات أي خصم (متعدد) مع رقم الدور التالي
      onlineManager.onMove((lineKey, nextTurn) => {
        applyOnlineMove(lineKey, config, nextTurn);
        updateOnlineTurnIndicator(onlineTurnInd);
      });
    });

    // خروج لاعب أثناء اللعب — المباراة تكمّل بالباقين
    onlineManager.onPlayerLeft((playersOrReason) => {
      if (playersOrReason === "host_left") { showDisconnectAlert(); return; }
      handleMultiPlayerLeft(playersOrReason, onlineTurnInd);
    });
    onlineManager.onRestart(() => showRestartAlert());

    onlineManager.onConnectionChange(connected => {
      if (onlineTurnInd && connected) updateOnlineTurnIndicator(onlineTurnInd);
    });
  }, 800);
}

// معالجة خروج لاعب في المباراة الجماعية
function handleMultiPlayerLeft(players, onlineTurnInd) {
  // نحدّث حالة اللاعبين النشطين (المنسحب active:false)
  const active = Object.values(players || {}).filter(p => p.active !== false);
  config.multiPlayers = players;
  // لو بقي لاعب واحد فقط نشط → انتهت المباراة
  if (active.length <= 1) {
    showAlert("#4ade80", "🏆 انتهت المباراة! بقيت وحيداً في الساحة", "🏠 العودة للقائمة");
  }
  // (تخطّي أدوار المنسحب يُدار في منطق الدور)
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
