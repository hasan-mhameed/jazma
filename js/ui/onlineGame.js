// 📄 ui/onlineGame.js
// منطق الأونلاين — إنشاء غرفة، انضمام، حركات
import { config } from "../config/config.js?v=1786217372";
import { onlineManager } from "../firebase.js?v=1786217372";
import { applyOnlineMove, skipInactiveTurn } from "./boardRenderer.js?v=1786217372";
import { setBank } from "./turnTimer.js?v=1786217372";
import { state } from "../core/state.js?v=1786217372";
import { getCurrentUser } from "../auth.js?v=1786217372";

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
  const stepRandCount   = document.getElementById("online-step-random-count");
  // عناصر عدّاد البحث ونافذة الموافقة والعدّ التنازلي
  const searchCountdownEl = document.getElementById("search-countdown");
  const approvalModal     = document.getElementById("approval-modal");
  const approvalTitle     = document.getElementById("approval-title");
  const approvalPlayers   = document.getElementById("approval-players");
  const approvalTimer     = document.getElementById("approval-timer");
  const approvalAccept    = document.getElementById("approval-accept");
  const approvalReject    = document.getElementById("approval-reject");
  const approvalNote      = document.getElementById("approval-note");
  const startCountdownEl  = document.getElementById("start-countdown");
  const startCountdownNum = document.getElementById("start-countdown-num");
  let _lastLobbyCount = 0, _lobbyNames = {}, _waitStartedAt = null;
  let _searchStartedAt = null; // ختم بدء البحث الحالي (لتجاهل جولات موافقة أقدم)

  function showStep(step) {
    stepName.classList.add("hidden");
    stepLobby.classList.add("hidden");
    stepPlaying.classList.add("hidden");
    stepSearching?.classList.add("hidden");
    stepMultiCount?.classList.add("hidden");
    stepMultiLobby?.classList.add("hidden");
    stepRandCount?.classList.add("hidden");
    onlineError.classList.add("hidden");
    if (step === "name" || step === "lobby") {
      if (getCurrentUser()?.displayName) playerNameInput.value = getCurrentUser().displayName;
    }
    if (step === "name")        stepName.classList.remove("hidden");
    if (step === "lobby")       stepLobby.classList.remove("hidden");
    if (step === "playing")     stepPlaying.classList.remove("hidden");
    if (step === "searching")   stepSearching?.classList.remove("hidden");
    if (step === "multiCount")  stepMultiCount?.classList.remove("hidden");
    if (step === "multiLobby")  stepMultiLobby?.classList.remove("hidden");
    if (step === "randomCount") stepRandCount?.classList.remove("hidden");
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
  // ═══ العشوائي: اختيار العدد أولاً (2 = ثنائي / 3-4 = جماعي) ═══
  const stepRandomCount  = document.getElementById("online-step-random-count");
  const randomCountChips = document.getElementById("random-count-chips");
  const randomSearchStart= document.getElementById("random-search-start");
  const randomCountBack  = document.getElementById("random-count-back");
  let _randomWanted = 2;      // العدد المختار
  let _isMultiSearch = false; // هل البحث الجاري جماعي؟

  function buildRandomCountChips() {
    if (!randomCountChips) return;
    randomCountChips.innerHTML = "";
    [2, 3, 4].forEach(n => {
      const chip = document.createElement("button");
      chip.className = "chip" + (n === _randomWanted ? " active" : "");
      chip.textContent = n === 2 ? "لاعبان" : `${n} لاعبين`;
      chip.addEventListener("click", (e) => {
        e.currentTarget.blur();
        _randomWanted = n;
        buildRandomCountChips();
      });
      randomCountChips.appendChild(chip);
    });
  }

  randomMatchBtn?.addEventListener("click", () => {
    const name = getPlayerName(); if (!name) return;
    buildRandomCountChips();
    showStep("randomCount");
  });
  randomCountBack?.addEventListener("click", () => showStep("name"));

  randomSearchStart?.addEventListener("click", async () => {
    if (_randomWanted === 2) await startDuoRandomSearch();
    else await startMultiRandomSearch(_randomWanted);
  });

  // ── البحث الثنائي (المنطق السابق كما هو) ─────────────────────
  async function startDuoRandomSearch() {
    const name = getPlayerName(); if (!name) return;
    _isMultiSearch = false;
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
    }
  }

  // ── البحث الجماعي العشوائي (3-4) ─────────────────────────────
  const SEARCH_WAIT_SEC = 20;   // مهلة الانتظار قبل عرض الموافقة بعدد ناقص (قابلة للضبط)
  const APPROVAL_SEC    = 15;   // مهلة الرد على نافذة الموافقة
  let _searchTimerId = null, _searchLeft = 0, _approvalTimerId = null, _approvalOpen = false;

  function stopSearchCountdown() {
    if (_searchTimerId) { clearInterval(_searchTimerId); _searchTimerId = null; }
    searchCountdownEl?.classList.add("hidden");
  }

  // عدّاد الانتظار: يُحسب من ختم زمني مشترك (waitStartedAt) فيكون موحّداً عند الجميع
  function startSearchCountdown(wanted, startedAt) {
    if (_searchTimerId) return;
    searchCountdownEl?.classList.remove("hidden");
    const tickFn = async () => {
      const started = _waitStartedAt;
      if (typeof started !== 'number') { if (searchCountdownEl) searchCountdownEl.textContent = `⏳ ${SEARCH_WAIT_SEC}`; return; }
      const elapsed = Math.max(0, (onlineManager.serverNow() - started) / 1000);
      const left = Math.max(0, Math.ceil(SEARCH_WAIT_SEC - elapsed));
      if (searchCountdownEl) searchCountdownEl.textContent = `⏳ ${left}`;
      if (left <= 0) {
        stopSearchCountdown();
        // المنشئ فقط يفتح جولة الموافقة (بعدد الحاضرين)
        if (onlineManager.playerNum === 1 && !_approvalOpen) {
          const cnt = _lastLobbyCount || 2;
          if (cnt >= 2 && cnt < wanted) {
            await onlineManager.startApprovalRound(cnt, wanted);
          }
        }
      }
    };
    tickFn();
    _searchTimerId = setInterval(tickFn, 500);
  }

  // ── نافذة الموافقة المتزامنة ───────────────────────────────
  function renderApproval(a) {
    if (!a || !approvalModal) return;
    if (!_isMultiSearch) return; // لسنا في بحث — نتجاهل أي حالة قديمة
    // نتجاهل جولة موافقة بدأت قبل بحثنا الحالي (بقايا جولة سابقة → وميض نافذة قديمة)
    if (typeof a.startedAt === 'number' && _searchStartedAt && a.startedAt < _searchStartedAt) return;
    if (a.state === "asking") {
      _approvalOpen = true;
      stopSearchCountdown();
      approvalModal.classList.remove("hidden");
      if (approvalTitle) approvalTitle.textContent = `👥 توفّر ${a.available} من ${a.wanted} — تلعب؟`;
      // قائمة اللاعبين بحالاتهم الحيّة
      const names = config.onlinePlayerNames || {};
      const decisions = a.decisions || {};
      if (approvalPlayers) {
        approvalPlayers.innerHTML = Object.keys(decisions).sort().map(num => {
          const d = decisions[num];
          const icon = d === "accepted" ? "✅" : d === "rejected" ? "❌" : "⏳";
          const cls  = d === "accepted" ? "accepted" : d === "rejected" ? "rejected" : "";
          const nm   = _lobbyNames[num] || names[num] || `لاعب ${num}`;
          return `<div class="approval-player ${cls}"><span>${nm}</span><span class="ap-state">${icon}</span></div>`;
        }).join("");
      }
      startApprovalTimer();
      // المنشئ يقيّم النتيجة
      if (onlineManager.playerNum === 1) evaluateApproval(a);
    } else if (a.state === "confirmed") {
      closeApproval();
      // المنشئ يبدأ المباراة فعلياً
      if (onlineManager.playerNum === 1) onlineManager.startMultiGame();
    } else if (a.state === "cancelled") {
      closeApproval();
      showLeaveToast("↩️ لم يكتمل التوافق — عدنا للبحث");
      // ختم انتظار جديد (عدّاد نظيف موحّد للباقين)
      _waitStartedAt = null;
      if (onlineManager.playerNum === 1) {
        onlineManager.clearApprovalState().then(() => onlineManager.markWaitStart());
      }
      startSearchCountdown(_randomWanted);
    }
  }

  function startApprovalTimer() {
    if (_approvalTimerId) return;
    let left = APPROVAL_SEC;
    if (approvalTimer) { approvalTimer.textContent = `⏳ ${left}`; approvalTimer.classList.remove("low"); }
    _approvalTimerId = setInterval(() => {
      left--;
      if (approvalTimer) {
        approvalTimer.textContent = `⏳ ${left}`;
        approvalTimer.classList.toggle("low", left <= 5);
      }
      if (left <= 0) {
        clearInterval(_approvalTimerId); _approvalTimerId = null;
        // لم نرد في الوقت = رفض
        onlineManager.setApprovalDecision("rejected");
      }
    }, 1000);
  }

  function closeApproval() {
    _approvalOpen = false;
    if (_approvalTimerId) { clearInterval(_approvalTimerId); _approvalTimerId = null; }
    approvalModal?.classList.add("hidden");
  }

  // المنشئ: هل وافق الجميع؟ أو رفض أحدهم؟
  async function evaluateApproval(a) {
    const d = Object.values(a.decisions || {});
    if (!d.length) return;
    if (d.some(x => x === "rejected")) {
      await onlineManager.closeApprovalRound("cancelled");
    } else if (d.every(x => x === "accepted")) {
      await onlineManager.closeApprovalRound("confirmed");
    }
  }

  // عدّ تنازلي قصير قبل بدء المباراة (تشويق)
  function runStartCountdown(cb) {
    if (!startCountdownEl || !startCountdownNum) { cb(); return; }
    let n = 3;
    startCountdownEl.classList.remove("hidden");
    startCountdownNum.textContent = n;
    const id = setInterval(() => {
      n--;
      if (n > 0) {
        startCountdownNum.textContent = n;
        startCountdownNum.style.animation = 'none'; void startCountdownNum.offsetWidth;
        startCountdownNum.style.animation = '';
      } else {
        clearInterval(id);
        startCountdownEl.classList.add("hidden");
        cb();
      }
    }, 900);
  }

  approvalAccept?.addEventListener("click", (e) => {
    e.currentTarget.blur();
    onlineManager.setApprovalDecision("accepted");
    if (approvalNote) approvalNote.textContent = "بانتظار قرار البقية...";
  });
  approvalReject?.addEventListener("click", async (e) => {
    e.currentTarget.blur();
    await onlineManager.setApprovalDecision("rejected");
    closeApproval();
    _isMultiSearch = false;
    await onlineManager.leaveRoom();
    showStep("randomCount");
  });

  async function startMultiRandomSearch(wanted) {
    const name = getPlayerName(); if (!name) return;
    _isMultiSearch = true;
    // تصفير حالة الموافقة/الانتظار المحلية (بحث جديد نظيف)
    _approvalOpen = false; _waitStartedAt = null; _lastLobbyCount = 0; _lobbyNames = {};
    _searchStartedAt = onlineManager.serverNow ? onlineManager.serverNow() : Date.now();
    stopSearchCountdown(); closeApproval();
    try {
      const gridSize = +document.getElementById("grid-size").value || 4;
      config.rows = config.cols = gridSize;

      showStep("searching");
      searchingText.textContent = `جارٍ البحث عن لاعبين (${wanted} لاعبين، لوحة ${gridSize}×${gridSize})...`;

      // تحديث حي: الأسماء المنضمّة + العدد + بدء تلقائي عند الاكتمال (المنشئ يقرر)
      onlineManager.onLobbyUpdate((players, room) => {
        const list = Object.values(players || {}).sort((a, b) => a.num - b.num);
        const count = list.length;
        const max = room?.maxPlayers || wanted;
        _lastLobbyCount = count;
        _waitStartedAt = (typeof room?.waitStartedAt === 'number') ? room.waitStartedAt : null;
        _lobbyNames = {};
        list.forEach(p => { _lobbyNames[p.num] = p.name; });
        if (!_approvalOpen) {
          const names = list.map(p => `✓ ${p.name}`).join("<br>");
          searchingText.innerHTML =
            `👥 انضم ${count} من ${max}<br><span class="search-names">${names}</span><br>بانتظار البقية...`;
        }
        // اكتمل العدد → بدء مباشر (حتى لو كانت نافذة الموافقة مفتوحة نلغيها)
        if (count >= max && room?.status === "lobby") {
          stopSearchCountdown();
          if (_approvalOpen) closeApproval();
          if (onlineManager.playerNum === 1) {
            onlineManager.clearApprovalState();
            onlineManager.startMultiGame();
          }
        } else if (count >= 2 && !_approvalOpen) {
          // المنشئ يثبّت ختم بدء الانتظار (مرّة واحدة) ليكون العدّ موحّداً
          if (onlineManager.playerNum === 1) onlineManager.markWaitStart();
          startSearchCountdown(max);
        }
      });
      // استقبال حالة جولة الموافقة (الجميع)
      onlineManager.onApproval((a) => renderApproval(a));
      // بدء المباراة (للجميع) — مع عدّ تنازلي قصير
      onlineManager.onMultiStart((room) => {
        _isMultiSearch = false;
        stopSearchCountdown(); closeApproval();
        _waitStartedAt = null;
        // تنظيف حالة الموافقة حتى لا تظهر نافذة قديمة في بحث لاحق
        if (onlineManager.playerNum === 1) onlineManager.clearApprovalState();
        runStartCountdown(() => startMultiMatch(room));
      });
      // المنشئ غادر قبل البدء
      onlineManager.onPlayerLeft((reason) => {
        if (reason === "host_left" && _isMultiSearch) {
          _isMultiSearch = false;
          stopSearchCountdown(); closeApproval();
          showLeaveToast("🚪 غادر منشئ الغرفة — ابحث من جديد");
          showStep("randomCount");
        }
      });

      await onlineManager.findRandomMultiMatch(config, name, wanted);
      // الانتظار يُدار عبر onLobbyUpdate أعلاه
    } catch (e) {
      showError(e.message || "تعذّر البحث");
      showStep("name");
    }
  }

  // ── إلغاء البحث العشوائي ────────────────────────────────────
  cancelSearchBtn?.addEventListener("click", async () => {
    stopSearchCountdown();
    closeApproval();
    if (_isMultiSearch) {
      _isMultiSearch = false;
      await onlineManager.leaveRoom(); // لوبي جماعي: منشئ يمسح / منضم يزيل نفسه
    } else {
      await onlineManager.cancelRandomMatch();
    }
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
      onlineManager.onMove((lineKey, nextTurn, byPlayer, bankLeft) => {
        // الثنائي: صاحب الحركة هو الخصم (byPlayer قد يكون undefined) — نستنتجه
        const mover = (typeof byPlayer === 'number') ? byPlayer
                    : (config.onlinePlayerNum === 1 ? 2 : 1);
        applyOnlineMove(lineKey, config, nextTurn, mover, bankLeft);
        updateOnlineTurnIndicator(onlineTurnInd);
      });
      // تحديث بنك فوري (شراء أداة بين الحركات)
      onlineManager.onBankUpdate((player, bank) => setBank(player, bank));
    });

    onlineManager.onOpponentLeft(() => { if (!state.gameFinished) showDisconnectAlert(); });
    onlineManager.onRestart(() => { if (!state.gameFinished) showRestartAlert(); });

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
      // تطبيق حركات أي خصم (متعدد) مع رقم الدور التالي وصاحب الحركة
      onlineManager.onMove((lineKey, nextTurn, byPlayer, bankLeft) => {
        applyOnlineMove(lineKey, config, nextTurn, byPlayer, bankLeft);
        updateOnlineTurnIndicator(onlineTurnInd);
      });
      // تحديث بنك فوري (شراء أداة بين الحركات)
      onlineManager.onBankUpdate((player, bank) => setBank(player, bank));
    });

    // خروج لاعب أثناء اللعب — المباراة تكمّل بالباقين
    onlineManager.onPlayerLeft((playersOrReason) => {
      if (playersOrReason === "host_left") { if (!state.gameFinished) showDisconnectAlert(); return; }
      handleMultiPlayerLeft(playersOrReason, onlineTurnInd);
    });
    onlineManager.onRestart(() => { if (!state.gameFinished) showRestartAlert(); });

    onlineManager.onConnectionChange(connected => {
      if (onlineTurnInd && connected) updateOnlineTurnIndicator(onlineTurnInd);
      // عدنا للاتصال ضمن مهلة السماح → نمسح ختم الانقطاع لنبقى في المباراة
      if (connected) onlineManager.clearMyDisconnectMark();
    });
  }, 800);
}

// معالجة خروج لاعب في المباراة الجماعية
// إشعار عابر (توست) لأحداث المباراة الجماعية
function showLeaveToast(text) {
  const t = document.createElement("div");
  t.textContent = text;
  t.style.cssText = "position:fixed;top:70px;left:50%;transform:translateX(-50%);background:#1e293bee;color:#fff;padding:10px 18px;border-radius:12px;z-index:9999;font-weight:700;font-size:0.95rem;box-shadow:0 4px 20px rgba(0,0,0,.4);direction:rtl";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

const _graceNotified = {}; // منع تكرار إشعار الانقطاع لكل لاعب
function handleMultiPlayerLeft(players, onlineTurnInd) {
  // المباراة انتهت طبيعياً؟ مغادرة الآخرين بعدها ليست انسحاباً — نتجاهل بصمت
  if (state.gameFinished) { config.multiPlayers = players; return; }

  // ══ مهلة السماح: من عنده disconnectedAt ولم يخرج بعد = منقطع مؤقتاً ══
  const GRACE_MS = 10000; // 10 ثوانٍ للعودة قبل الخروج النهائي
  const nowSrv = onlineManager.serverNow ? onlineManager.serverNow() : Date.now();
  Object.values(players || {}).forEach(p => {
    if (p.active !== false && typeof p.disconnectedAt === 'number') {
      const gone = nowSrv - p.disconnectedAt;
      if (gone >= GRACE_MS) {
        // تجاوز المهلة → خروج نهائي (أي جهاز متصل ينفّذها؛ الحساب حتمي)
        onlineManager.expirePlayerByNum(p.num);
      } else if (!_graceNotified[p.num]) {
        _graceNotified[p.num] = true;
        if (p.num !== config.onlinePlayerNum) {
          showLeaveToast(`⏳ ${p.name} يعاني انقطاعاً — بانتظار عودته...`);
        }
        // فحص متأخر: لو لم يعد خلال المهلة نُخرجه
        setTimeout(() => {
          const cur = (config.multiPlayers || {});
          const still = Object.values(cur).find(q => q.num === p.num);
          if (still && still.active !== false && typeof still.disconnectedAt === 'number' && !state.gameFinished) {
            onlineManager.expirePlayerByNum(p.num);
          }
        }, GRACE_MS + 500);
      }
    }
    // عاد قبل انتهاء المهلة → نظّف علامة الإشعار
    if (typeof p.disconnectedAt !== 'number' && _graceNotified[p.num]) {
      _graceNotified[p.num] = false;
      if (p.num !== config.onlinePlayerNum) showLeaveToast(`✅ ${p.name} عاد للمباراة`);
    }
  });
  // إشعار "اللاعب X انسحب" — نكتشف من تحوّل لغير نشط (مقارنة بالحالة السابقة)
  const prev = config.multiPlayers || {};
  const me = config.onlinePlayerNum;
  Object.values(players || {}).forEach(p => {
    const was = Object.values(prev).find(q => q.num === p.num);
    if (was && was.active !== false && p.active === false) {
      if (p.num === me) {
        // أنا الذي خرجت (غالباً بانقطاع الشبكة) — نوضّح وضعي بدل الغموض
        showLeaveToast("😔 انقطع اتصالك — خرجت من المباراة (يمكنك المشاهدة فقط)");
      } else {
        showLeaveToast(`🚪 ${p.name} انسحب من المباراة`);
      }
    }
  });
  // نحدّث حالة اللاعبين النشطين (المنسحب active:false)
  const active = Object.values(players || {}).filter(p => p.active !== false);
  config.multiPlayers = players;
  // لو الدور الحالي عند لاعب منسحب → ننقله لأول نشط (حساب متطابق عند الجميع)
  try { skipInactiveTurn(config); } catch {}
  updateOnlineTurnIndicator(onlineTurnInd);
  // لو بقي لاعب واحد فقط نشط → فوز بانسحاب الخصوم
  // فوز بانسحاب الخصوم: فقط إذا كنتُ أنا اللاعب النشط المتبقّي
  // (الخارج/المنقطع لا يفوز لو خرج خصومه بعده — هو خارج المنافسة أصلاً)
  if (active.length <= 1) {
    const me = config.onlinePlayerNum;
    const iAmActive = Object.values(players || {}).some(p => p.num === me && p.active !== false);
    if (iAmActive) {
      showAlert("#4ade80", "🏆 فزت بالمباراة! انسحب جميع خصومك", "🏠 العودة للقائمة");
    } else {
      // أنا خارج: المباراة انتهت ولا فوز لي
      showAlert("#f87171", "انتهت المباراة — كنت خارجها بعد انقطاعك", "🏠 العودة للقائمة");
    }
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
