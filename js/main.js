// 📄 main.js — v13.9
// Bootstrap فقط — يربط كل الـ modules

import { config }                              from "./config/config.js?v=1792834692";
import { state }                               from "./core/state.js?v=1792834692";
import { startBoard, updateScoreboard, resetState } from "./board.js?v=1792834692";
import { updateTurnUI }                        from "./ui/turnManager.js?v=1792834692";
import { audioManager }                        from "./audio/audioManager.js?v=1792834692";
import { onlineManager, cleanupOldRooms } from "./firebase.js?v=1792834692";
import { onUserChange, getCurrentUser, getAllStats, isGuest } from "./auth.js?v=1792834692";

import { initAuthUI, initGuestUI }  from "./ui/authUI.js?v=1792834692";
import { initPresence, setMyPresence } from "./presence.js?v=1792834692";
import { initGameSetup }       from "./ui/gameSetup.js?v=1792834692";
import { initTurnTimer, stopTurnTimer, startTurnTimer, TIME_BANKS, enableCentralClock, applyClockState } from "./ui/turnTimer.js?v=1792834692";
import { initOnlineGame, launchOnlineGame, updateOnlineTurnIndicator, leaveOnlineMatch, isOutOfMatch, noteMyExitPending } from "./ui/onlineGame.js?v=1792834692";
import { initFriendsUI }       from "./ui/friendsUI.js?v=1792834692";
import { initLeaderboardUI }   from "./ui/leaderboardUI.js?v=1792834692";
import { initInvites, resetInvites, startInvite, showInviteAlert, inviteEndText } from "./ui/inviteUI.js?v=1792834692";
import { initChatUI, openChat, initChatNotifications } from "./ui/chatUI.js?v=1792834692";
import { initMessagesUI, clearUnreadFor }              from "./ui/messagesUI.js?v=1792834692";
import { renderStatsModal }    from "./ui/statsModal.js?v=1792834692";
import { initHistoryUI }       from "./ui/historyUI.js?v=1792834692";
import { resetMatchTimer, endGame } from "./ui/gameEnd.js?v=1792834692";
import { initAchievementsUI }  from "./ui/achievementsUI.js?v=1792834692";
import { initXPUI, refreshXPBar } from "./ui/xpUI.js?v=1792834692";
import { refreshCoinsBadge, getMatchCoins } from "./core/wallet.js?v=1792834692";
import { loadLearnedPowers } from "./ui/powerTutorial.js?v=1792834692";
import { initPowersUI, refreshInventory } from "./ui/powersUI.js?v=1792834692";
import { POWERS, addPower } from "./core/powers.js?v=1792834692";
import { spendCoins } from "./core/wallet.js?v=1792834692";
import { extendTime, cutBank, getTimerMode, getBank } from "./ui/turnTimer.js?v=1792834692";
import { activatePower, triggerAI, nextActivePlayer } from "./ui/boardRenderer.js?v=1792834692";
import { initNavMenu }            from "./ui/navMenu.js?v=1792834692";
import { initDailyChallengeUI }  from "./ui/dailyChallengeUI.js?v=1792834692";
import { safeImageSrc }          from "./ui/safeText.js?v=1792834692";
import { sessionStep, freshPage } from "./session.js?v=1792834692";

// ── رقم النسخة (للتأكد أي نسخة تعمل أثناء الاختبار) ──────────────
// يُقرأ من رابط الملف نفسه (main.js?v=...) فيتحدّث تلقائياً مع كل إصدار
export const APP_VERSION = (() => {
  try { return new URL(import.meta.url).searchParams.get("v") || "dev"; }
  catch { return "dev"; }
})();
window.JAZAM_VERSION = APP_VERSION;
console.log(`%c🎮 جزم — النسخة ${APP_VERSION}`,
  "background:#0f766e;color:#fff;padding:3px 10px;border-radius:6px;font-weight:700");

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
  const winnerScreen = document.getElementById("winner-screen");
  const statsBtn     = document.getElementById("stats-btn");
  const statsModal   = document.getElementById("stats-modal");
  const statsContent = document.getElementById("stats-content");
  const closeStatsBtn= document.getElementById("close-stats-btn");
  const onlineTurnInd= document.getElementById("online-turn-indicator");

  // ── Auth UI ──────────────────────────────────────────────────
  initAuthUI({ beforeLogout: () => resetInvites() });   // دعوة تنتظر تُلغى قبل الخروج (v35.9)
  initPresence();               // 🟢 تسجيل حضورنا ومتابعة الاتصال
  initGuestUI();

  // ── إطلاق اللعبة ────────────────────────────────────────────
  function showGameUI() {
    userBar.classList.add("hidden");
    infoDiv.classList.remove("hidden");
    // v36.1 (1.14 — السبب الحقيقي، فحص 5): اللوحة تُبنى من جديد مع كل مباراة (boardRenderer يستبدل عنصر #board
    // بنسخة جديدة)، فالمرجع المحفوظ عند تحميل الصفحة صار بعد أول مباراة عنصراً خارج الصفحة: إظهاره لا يُظهر شيئاً،
    // فيرى الحضور لحظة البدء لوحةً مخفية → "لا مباراة" → يتوقف عن متابعتها كلها، وتبقى الحالة "متصل" في كل مباراة
    // بعد الأولى حتى تحديث الصفحة. الآن: العنصر الحالي دائماً
    document.getElementById("board")?.classList.remove("hidden");
    document.getElementById("nat-turn-indicator")?.classList.remove("hidden");
    document.getElementById("inventory-bar")?.classList.remove("hidden");
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
    state.gameFinished = false; // تصفير حالة النهاية (لعبة جديدة بدون refresh)
    // حماية: إزالة أي بقايا من وضع المشاهدة (كلاس التجهيز يخفي عناصر اللعب)
    document.body.classList.remove("spectator-preparing");
    document.getElementById("spectator-loading")?.classList.add("hidden");
    const aiPlayer = gameSetup.getAiPlayer();

    // مؤقّت الدور: إجباري أونلاين (نمط بنك الوقت)، اختياري محلي/AI
    const timerOn = config.aiMode === 'online' ? true : !!config.turnTimer;
    // النمط: أونلاين = بنك إجباري / محلي = حسب اختيار اللاعبين / AI = لكل دور
    const timerMode =
      config.aiMode === 'online' ? 'bank' :
      config.aiMode === 'human'  ? (config.timerMode || 'perTurn') :
      'perTurn';
    initTurnTimer({
      enabled: timerOn,
      mode: timerMode,
      players: config.players,
      bankSeconds: TIME_BANKS[config.rows] || 180,
      onTimeout: () => handleTurnTimeout(),
      onBankEmpty: (p) => handleBankEmpty(p),
    });

    // 🕐 أونلاين نمط بنك: نفعّل الساعة المركزية (مرجع Firebase موحّد)
    if (config.aiMode === 'online' && timerMode === 'bank') {
      enableCentralClock(
        () => onlineManager.serverNow(),
        (p) => handleBankEmpty(p)
      );
      // تهيئة الساعة: يقوم بها أصغر رقم لاعب حاضر (وليس "1" ثابتاً — قد يكون غادر)
      // والبنوك تُبنى لأرقام اللاعبين الفعليين، والدور الأول لأصغر رقم
      {
        const nums = config.multiPlayers
          ? Object.values(config.multiPlayers).map(p => p.num).filter(n => typeof n === 'number')
          : [1, 2];
        const sorted = nums.length ? nums.slice().sort((a, b) => a - b) : [1, 2];
        const firstPlayer = sorted[0];
        if (config.onlinePlayerNum === firstPlayer) {
          const bankSec = TIME_BANKS[config.rows] || 180;
          const banks = {};
          sorted.forEach(n => { banks[n] = bankSec; });
          onlineManager.initClock(banks, firstPlayer);
        }
        // نضمن أن الدور يبدأ عند لاعب موجود فعلاً
        if (!sorted.includes(state.currentPlayer)) state.currentPlayer = firstPlayer;
      }
      // استقبال حالة الساعة من Firebase (المرجع)
      onlineManager.onClock((clk) => applyClockState(clk));
    }

    startBoard(config, aiPlayer);
    // الحضور يتبع المباراة (v35.9): "في مباراة" ما دامت جارية، و"متصل" لحظة انتهائها — ولو بقيت النتيجة ظاهرة.
    // v36.2 (1.15 — تحصين من مراجعة 1.14): بعد بناء اللوحة (كتحدي اليوم): أول نبضة ترى لوحة المباراة الجديدة الظاهرة،
    // فخطأ إظهار في المستقبل لا يوقف المتابعة بصمت
    onlineUI.startPresenceSync();
    updateScoreboard();
    updateTurnUI(config);
    refreshInventory(config);
    audioManager.startBackgroundMusic();

    // ضمان بدء المؤقّت لأول دور (بعد تهيئة اللوحة)
    // أونلاين: يظهر عند الجميع (الكل يشاهد وقت صاحب الدور)
    if (timerOn) {
      const humanFirst =
        config.aiMode === 'ai'     ? state.currentPlayer === 1 :
        config.aiMode === 'online' ? true :
        true;
      if (humanFirst) startTurnTimer();
    }
  }

  // 🏦 نفد بنك وقت لاعب — يخسر المباراة (نمط bank)
  // الجميع يعدّون بنك صاحب الدور محلياً بنفس البدايات والأحداث → النفاد يُكتشف عند الكل
  function handleBankEmpty(p) {
    if (state.gameFinished) return;
    const myName = (config.aiMode === 'online' ? config.onlinePlayerNames : config.localPlayerNames)?.[p] || `اللاعب ${p}`;

    if (config.online && config.multiPlayers) {
      // جماعي: النافد خارج المباراة (تكمل للباقين). أنا النافد: بطاقة "خرجت من المباراة"
      // تشرح وضعي وتعرض مركزي (v35.7) — فلا توست قبلها
      if (p !== config.onlinePlayerNum) flashToast(`⏳ نفد وقت ${myName} — خسر!`);
      // ننقل الدور للاعب التالي النشط ونحدّث الساعة المركزية فوراً
      // (وإلا تبقى الساعة على النافد فيتجمّد العدّاد عند الجميع حتى الحركة التالية)
      const advanceAfterEmpty = () => {
        if (state.gameFinished) return;
        // نستثني النافد من النشطين عند الحساب
        const players = config.multiPlayers || {};
        const cfgForCalc = { ...config, multiPlayers: Object.fromEntries(
          Object.entries(players).map(([k, v]) => [k, v.num === p ? { ...v, active: false } : v])
        )};
        const next = nextActivePlayer(p, cfgForCalc);
        if (next && next !== p) {
          state.currentPlayer = next;
          updateTurnUI(config);
          refreshInventory(config);
          onlineManager.pushTurnSkip(next);           // إبلاغ الجميع بنقل الدور
          onlineManager.pushClock(p, 0, next);        // تحديث الساعة: بنك النافد صفر + بدء دور التالي
        }
      };
      if (p === config.onlinePlayerNum) {
        // أنا النافد: أعلّم نفسي خارجاً ثم أنقل الدور وأحدّث الساعة
        // (خروجي مؤكّد محلياً فوراً: زر الخروج هادئ حتى قبل أن يؤكّده الخادم — v35.7)
        noteMyExitPending("time", onlineManager.markSelfInactive());
        advanceAfterEmpty();
      } else {
        // إنقاذ: لو النافد منقطع ولم يعلّم نفسه خلال 4 ثوانٍ — نعلّمه وننقل نحن
        setTimeout(() => {
          const still = Object.values(config.multiPlayers || {}).find(q => q.num === p && q.active !== false);
          if (still && !state.gameFinished) {
            onlineManager.markPlayerInactiveByNum(p);
            advanceAfterEmpty();
          }
        }, 4000);
      }
      return;
    }

    // ثنائي أونلاين أو محلي: نفاد البنك = نهاية المباراة (الخاسر يُعرض بشارة "نفد وقته" مع نقاطه الحقيقية)
    state.gameFinished = true;
    stopTurnTimer();
    flashToast(config.aiMode === 'online' && p === config.onlinePlayerNum
      ? "⏳ نفد وقتك — خسرت المباراة!"
      : `⏳ نفد وقت ${myName} — خسر المباراة!`);
    setTimeout(() => endGame(config, state.scores, true, p), 800);
  }

  // عند انتهاء وقت الدور — ينتقل الدور للاعب التالي
  function handleTurnTimeout() {
    // المباراة انتهت؟ لا نقل أدوار ولا مؤقّت (شاشة النتيجة ظاهرة)
    if (state.gameFinished) { stopTurnTimer(); return; }
    // ═══ غرفة جماعية: نقل متزامن عبر Firebase (مصدر قرار واحد) ═══
    if (config.online && config.multiPlayers) {
      const cur = state.currentPlayer;
      const doSkip = () => {
        const next = nextActivePlayer(cur, config); // يتخطّى المنسحبين
        state.currentPlayer = next;
        updateTurnUI(config);
        refreshInventory(config);
        onlineManager.pushTurnSkip(next); // يُبلّغ الجميع عبر سجل الحركات
      };
      if (cur === config.onlinePlayerNum) {
        // صاحب الدور: ينقل ويبعث فوراً
        doSkip();
      } else {
        // مشاهد: ننتظر نقل صاحب الدور؛ لو لم يصل خلال 4 ثوانٍ (تبويب خامل/انقطاع) نُنقذ
        // (الحساب حتمي ومتطابق عند الجميع، فالتكرار المحتمل غير ضار)
        setTimeout(() => {
          if (state.currentPlayer === cur) doSkip();
        }, 4000);
      }
      return;
    }
    // ═══ محلي/ثنائي: المنطق السابق ═══
    state.currentPlayer = (state.currentPlayer % config.players) + 1;
    updateTurnUI(config);
    refreshInventory(config);
    // لو صار دور AI، نشغّله عبر المسار المعتاد
    if (config.aiMode === 'ai' && state.currentPlayer === 2) {
      setTimeout(() => triggerAI(config), 300);
    }
  }

  // شراء أداة من المتجر بالجواهر
  async function buyShopTool(type) {
    const p = POWERS[type];
    if (!p || p.source !== 'shop') return;

    const ok = await spendCoins(p.cost);
    if (!ok) {
      audioManager.playError?.();
      flashToast(`💎 رصيدك غير كافٍ (تحتاج ${p.cost})`);
      return;
    }

    if (p.instant) {
      // أدوات فورية (تمديد الوقت) — تُطبّق مباشرة
      if (type === 'time_extend') {
        const myNum = config.aiMode === 'online' ? config.onlinePlayerNum : null;
        const done = extendTime(5, myNum);
        if (done) {
          audioManager.playSquareComplete?.(); flashToast('⏱️ +5 ثوانٍ!');
          // الساعة المركزية: نكتب القيمة الجديدة في المرجع (يراها الجميع فوراً)
          if (config.aiMode === 'online' && getTimerMode() === 'bank') {
            const newVal = (typeof done === 'number') ? done : getBank(myNum);
            onlineManager.updateClockBank(myNum, newVal);
          }
        }
      }
    } else {
      // أدوات تُخزّن في المخزون وتُفعّل لاحقاً (تقصير وقت الخصم)
      const buyer = config.aiMode === 'ai' ? 1
                  : config.aiMode === 'online' ? (config.onlinePlayerNum || 1)
                  : state.currentPlayer;
      addPower(buyer, type);
      audioManager.playSquareComplete?.();
      flashToast(`${p.icon} اشتريت: ${p.name}`);
    }
    refreshInventory(config);
  }

  // رسالة عابرة قصيرة
  function flashToast(text) {
    let el = document.getElementById('shop-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'shop-toast';
      el.className = 'shop-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1800);
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
  const onlineUI = initOnlineGame({ onGameStart: () => launchGame(), gameSetupApi: gameSetup });

  // ── 🎮 دعوات الأصدقاء (v35.9 — الخطوة 1.8): المنطق في inviteUI.js، والشاشات هنا ──
  const inviteHooks = {
    activity: () => onlineUI.activity(),
    // قبل إرسال دعوة أو قبولها: ننهي ما فيه اللاعب بهدوء — بحث أو غرفة تنتظر تُلغى،
    // ونتيجة مباراة انتهت (أو مشاهدة) يُخرج منها كزر الخروج بعد النهاية (بلا تأكيد ولا خسارة)
    goIdle: async (kind) => {
      if (kind === "waiting") return await onlineUI.cancelWaiting();
      if (kind === "done") {
        winnerScreen?.classList.add("hidden");
        await exitOnce();
        return onlineUI.activity() === "idle";
      }
      return kind === "idle";
    },
    myName: () => userNameEl.textContent || "لاعب",
    prepareInviterConfig: () => {
      const gridSize = +document.getElementById("grid-size").value || 4;
      config.rows = config.cols = gridSize;
      config.players = 2; config.online = true; config.onlinePlayerNum = 1;
      return config;
    },
    // صاحب الدعوة: شاشة الانتظار بعدّ تنازلي لمهلة الرد
    onWaiting: (code, friendName, secs) => {
      document.getElementById("friends-panel")?.classList.add("hidden");
      document.getElementById("chat-panel")?.classList.add("hidden");
      setupScreen.classList.add("hidden");
      onlineScreen.classList.remove("hidden");
      document.getElementById("room-code-display")?.classList.add("hidden");
      document.getElementById("copy-code-btn")?.classList.add("hidden");
      document.getElementById("lobby-share-hint")?.classList.add("hidden");
      onlineUI.showStep("lobby");
      document.getElementById("lobby-status-text").textContent = `بانتظار ${friendName}... ⏳ ${secs}`;
    },
    onWaitTick: (left, friendName) => {
      document.getElementById("lobby-status-text").textContent = `بانتظار ${friendName}... ⏳ ${left}`;
    },
    onOpponentJoined: (oppName, friendName, cfg) => {
      const myName = userNameEl.textContent || "لاعب";
      // إعدادات المباراة من الدعوة نفسها (لوحة الصديق نفس لوحتها مهما تغيّر بعدها — مراجعة v35.9)
      if (cfg) { config.rows = cfg.rows; config.cols = cfg.cols; }
      config.players = 2; config.online = true; config.onlinePlayerNum = 1;
      config.onlinePlayerNames = { 1: myName, 2: oppName };
      document.getElementById("online-my-name").textContent  = myName;
      document.getElementById("online-opp-name").textContent = oppName;
      document.getElementById("friends-panel")?.classList.add("hidden");
      onlineUI.showStep("playing");
      launchOnlineGame(1, onlineTurnInd, () => launchGame());
    },
    // ترك شاشة انتظار الدعوة إلى لعبة أخرى (تحدي اليوم من القائمة): أُلغيت دعوته — لا تبقى شاشتها تحت اللعبة
    onInviteAbandoned: () => { onlineScreen.classList.add("hidden"); },
    // انتهت الدعوة بلا مباراة (رفض، في مباراة، انتهت المهلة، فشل الإرسال): للقائمة + رسالة واضحة
    onInviteEnded: (reason, friendName) => {
      onlineScreen.classList.add("hidden");
      setupScreen.classList.remove("hidden");
      showInviteAlert(inviteEndText(reason, friendName));
    },
    // المستلم: قبل الدعوة
    onJoining: () => {
      config.online = true;
      config.onlinePlayerNum = 2;
      document.getElementById("friends-panel")?.classList.add("hidden");
      document.getElementById("chat-panel")?.classList.add("hidden");
      setupScreen.classList.add("hidden");
      onlineScreen.classList.remove("hidden");
      onlineUI.showStep("playing");
    },
    onJoined: (roomData, invite) => {
      const myName = userNameEl.textContent || "لاعب";
      const oppName = roomData.p1name || invite.fromName || "الخصم";
      config.rows = roomData.cfg.rows; config.cols = roomData.cfg.cols;
      config.players = 2;
      config.onlinePlayerNames = { 1: oppName, 2: myName };
      document.getElementById("online-my-name").textContent  = myName;
      document.getElementById("online-opp-name").textContent = oppName;
      launchOnlineGame(2, onlineTurnInd, () => launchGame());
    },
    // القبول فشل (ألغاها صاحبها / انتهت / انقطاع): للقائمة + رسالة (كان يعود بصمت)
    onJoinFailed: (message) => {
      onlineScreen.classList.add("hidden");
      setupScreen.classList.remove("hidden");
      showInviteAlert(message);
    },
  };
  // زر "🎮 تحدي" في نافذة المحادثة: نفس الدعوة (كان يُطلق حدثاً لا يستمع له أحد)
  document.addEventListener("chat:invite", e => { if (e?.detail?.uid) startInvite(e.detail); });

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
    onBuy: async (type) => {
      await buyShopTool(type);
    },
  });

  // ── التحدي اليومي ────────────────────────────────────────────
  initDailyChallengeUI({
    onGameStart: (aiPlayer) => {
      setupScreen.classList.add("hidden");
      showGameUI();
      resetMatchTimer();
      startBoard(config, aiPlayer);
      onlineUI.startPresenceSync();   // تحدي اليوم مباراة أيضاً (كان يبقى "متصل" أثناءه — v35.9) — بعد startBoard الذي يصفّر نهاية سابقة
      updateScoreboard();
      updateTurnUI(config);
      refreshInventory(config);
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
    // v36.0 (الخطوة 1.11): حساب واحد لكل تحميل صفحة — خروج (من الزر أو تبويب آخر أو انتهاء الجلسة) أو حساب
    // آخر بعد بدء الجلسة = صفحة جديدة نظيفة، لا تهيئة ثانية فوق الأولى (دعوة تنتظر تُلغى قبلها)
    const step = sessionStep(user);
    if (step === "reload") { freshPage(() => resetInvites()); return; }
    if (step === "same") return;
    if (user) {
      authScreen.classList.add("hidden");
      userBar.classList.remove("hidden");
      setupScreen.classList.remove("hidden");
      const myPhoto = safeImageSrc(user.photoURL);   // v36.0: صور حسابات Google فقط، وبلا referrer
      userPhoto.referrerPolicy = "no-referrer";
      userPhoto.src = myPhoto;
      userPhoto.style.display = myPhoto ? "block" : "none";
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
        onInviteFriend: friend => startInvite(friend),
        onOpenChat: friend => openChat(friend),
      });

      // ── 🎮 دعوات الأصدقاء: إرسال واستقبال (v35.9) ─────────
      initInvites(inviteHooks);

      initChatNotifications();
      cleanupOldRooms();
      initMessagesUI({ onOpenChat: friend => openChat(friend) });
      refreshXPBar();
      refreshCoinsBadge();
      loadLearnedPowers();
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
      // بلا دخول من أول التحميل (الخروج بعد جلسة يعيد الصفحة أعلاه — v36.0)
      resetInvites();             // لا دعوة معلّقة بعد تسجيل الخروج (v35.9)
      authScreen.classList.remove("hidden");
      userBar.classList.add("hidden");
      setupScreen.classList.add("hidden");
    }
  });

  // ── Restart / Play Again ─────────────────────────────────────
  const restartBtn   = document.getElementById("restart");
  const playAgainBtn = document.getElementById("play-again");

  // خروج واحد في كل مرة: نقرة ثانية أثناء خروج جارٍ (ينتظر الشبكة حتى 4 ثوانٍ) لا تبدأ خروجاً
  // ثانياً — كانت تسلك المسار الهادئ فتلغي ما يعتمد عليه الانسحاب الأول (مراجعة v35.7 الثالثة).
  // v35.9: والخروج الهادئ لقبول دعوة (أو إرسالها) من شاشة النتيجة يمرّ من هنا أيضاً — يشارك أي خروج جارٍ
  let exitPromise = null;
  function exitOnce() {
    if (!exitPromise) exitPromise = handleExitClick().finally(() => { exitPromise = null; });
    return exitPromise;
  }
  restartBtn?.addEventListener("click", () => { exitOnce(); });
  async function handleExitClick() {
    // 👁️ المشاهد: خروج لا يمسّ المباراة إطلاقاً (ليس طرفاً فيها)
    if (config.spectator) {
      audioManager.playButtonClick();
      audioManager.stopBackgroundMusic();
      stopTurnTimer();
      try { await onlineManager.leaveSpectator(); } catch {}
      config.spectator = false;
      config.online = false;
      config.multiPlayers = null;
      try { setMyPresence("online", "خروج"); } catch {}
      userBar.classList.remove("hidden");
      infoDiv.classList.add("hidden");
      document.getElementById("board")?.classList.add("hidden");
      document.getElementById("nat-turn-indicator")?.classList.add("hidden");
      document.getElementById("inventory-bar")?.classList.add("hidden");
      document.getElementById("spectator-count")?.classList.add("hidden");
      document.getElementById("spectator-mute")?.classList.add("hidden");
      onlineScreen.classList.add("hidden");
      setupScreen.classList.remove("hidden");
      gameSetup.resetUI();
      return;
    }
    // قاعدة موحّدة: أي مباراة أونلاين جارية → تأكيد الانسحاب (الانسحاب = خسارة)
    // بعد انتهاء المباراة طبيعياً: خروج عادي بلا تأكيد ولا خسارة
    // v35.7: ومن خرج من مباراة جماعية جارية (نفد وقته/انقطع ولم يعد) سُجّلت خسارته لحظة خروجه —
    // خروجه الآن هادئ بلا تحذير (كان يُحذَّر من خسارة وقعت أصلاً)
    const isLiveOnline = config.online && !state.gameFinished && !isOutOfMatch();   // يشمل الثنائي
    if (isLiveOnline) {
      // كالألعاب العالمية: التحذير يقول بالضبط ما سيضيع قبل التأكيد (الانسحاب = خسارة + جواهر المباراة)
      const lost = getMatchCoins() || 0;
      const ok = window.confirm("هل تود الانسحاب من المباراة؟\n⚠️ الانسحاب يعني خسارتك للمباراة"
        + (lost > 0 ? `\n💎 وتضيع ${lost} عملة جمعتها من جواهر هذه المباراة` : ""));
      if (!ok) return;
    }
    audioManager.playButtonClick();
    audioManager.stopBackgroundMusic();
    stopTurnTimer();
    if (config.online) {
      // v35.6: الانسحاب أثناء مباراة جارية تُسجَّل فيه الخسارة (ثنائي وجماعي)، والخصم يرى فوزه
      // في نافذة النتيجة. بعد النهاية الطبيعية: مغادرة هادئة كما كانت.
      const forfeited = await leaveOnlineMatch();
      if (forfeited) flashToast("😔 انسحبت وخسرت المباراة");
    }
    config.online = false;
    config.multiPlayers = null;
    config.spectator = false;
    try { setMyPresence("online", "خروج"); } catch {}
    userBar.classList.remove("hidden");
    infoDiv.classList.add("hidden");
    document.getElementById("board")?.classList.add("hidden");
    document.getElementById("nat-turn-indicator")?.classList.add("hidden");
    document.getElementById("inventory-bar")?.classList.add("hidden");
    onlineScreen.classList.add("hidden");
    setupScreen.classList.remove("hidden");
    gameSetup.resetUI();
    resetState();
  }

  playAgainBtn?.addEventListener("click", async () => {
    winnerScreen?.classList.add("hidden");
    // 👁️ المشاهد: مغادرة نظيفة للمشاهدة (ليس لاعباً ليعيد اللعب)
    if (config.spectator) {
      try { await onlineManager.leaveSpectator(); } catch {}
      config.spectator = false;
      config.online = false;
      config.multiPlayers = null;
      audioManager.stopBackgroundMusic();
      stopTurnTimer();
      userBar.classList.remove("hidden");
      infoDiv.classList.add("hidden");
      document.getElementById("board")?.classList.add("hidden");
      document.getElementById("nat-turn-indicator")?.classList.add("hidden");
      document.getElementById("inventory-bar")?.classList.add("hidden");
      onlineScreen.classList.add("hidden");
      setupScreen.classList.remove("hidden");
      gameSetup.resetUI();
      return;
    }
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
