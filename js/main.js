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
         registerWithEmail, signInWithEmail, updateStats, currentUser, getCurrentUser } from "./auth.js";
import { searchUsers, sendFriendRequest, acceptFriendRequest,
         rejectFriendRequest, removeFriend, listenFriendRequests, listenFriends } from "./friends.js";
import { sendGameInvite, listenForInvites, clearInvite, rejectInvite, listenForInviteRejection } from "./invite.js";
import { getLeaderboard } from "./leaderboard.js";
import { sendMessage, listenMessages, listenUnread, markAsRead, markDelivered, markRead } from "./chat.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { playNotifSound } from "./audio/notif.js";

let aiPlayer = null;

// تسجيل Service Worker للـ PWA
let _deferredInstallPrompt = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/jazma/service-worker.js")
    .catch(() => {});
}

// التقاط حدث التثبيت
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  // أظهر زر التثبيت
  const installBtn = document.getElementById("install-btn");
  if (installBtn) installBtn.classList.remove("hidden");
});

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

  // أصدقاء
  const friendsBtn        = document.getElementById("friends-btn");
  const leaderboardBtn    = document.getElementById("leaderboard-btn");
  const leaderboardPanel  = document.getElementById("leaderboard-panel");
  const leaderboardList   = document.getElementById("leaderboard-list");
  const closeLeaderboardBtn = document.getElementById("close-leaderboard-btn");
  const friendsPanel      = document.getElementById("friends-panel");
  const closeFriendsBtn   = document.getElementById("close-friends-btn");
  const friendsSearchInput= document.getElementById("friends-search-input");
  const friendsSearchBtn  = document.getElementById("friends-search-btn");
  const searchResults     = document.getElementById("search-results");
  const friendRequestsSec = document.getElementById("friend-requests-section");
  const friendRequestsList= document.getElementById("friend-requests-list");
  const friendsList       = document.getElementById("friends-list");
  const friendReqBadge    = document.getElementById("friend-requests-badge");

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
      initFriendsListeners();
      initInviteListener();
      initChatNotifications();

      // ── زر تفعيل الإشعارات ──
      const notifBtn = document.getElementById("notif-btn");
      if (notifBtn && "Notification" in window) {
        if (Notification.permission === "granted") {
          notifBtn.classList.add("hidden");
        } else {
          notifBtn.classList.remove("hidden");
          notifBtn.addEventListener("click", async () => {
            const perm = await Notification.requestPermission();
            if (perm === "granted") {
              notifBtn.classList.add("hidden");
              playNotifSound();
            }
          });
        }
      }

      // ── زر التثبيت ──
      const installBtn = document.getElementById("install-btn");
      if (installBtn) {
        installBtn.addEventListener("click", async () => {
          if (!_deferredInstallPrompt) return;
          _deferredInstallPrompt.prompt();
          const { outcome } = await _deferredInstallPrompt.userChoice;
          if (outcome === "accepted") installBtn.classList.add("hidden");
          _deferredInstallPrompt = null;
        });
      }

      // ── تحديث شريط الإحصائيات بعد كل مباراة ──
      async function refreshStats() {
        const profile = await getUserProfile(user.uid);
        if (profile) {
          userWinsEl.textContent   = `🏆 ${profile.wins   || 0}`;
          userLossesEl.textContent = `❌ ${profile.losses || 0}`;
        }
      }
      // نحدّث كل 10 ثواني لو اللاعب بالأونلاين
      setInterval(refreshStats, 10000);
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
      googleSigninBtn.innerHTML = `<img src="/jazma/images/google.svg" alt="Google" width="20"/> تسجيل الدخول بـ Google`;
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    await logout();
  });

  // ── لوحة المتصدرين ──
  leaderboardBtn?.addEventListener("click", async () => {
    leaderboardPanel.classList.remove("hidden");
    leaderboardList.innerHTML = `<p class="friends-empty">⏳ جاري التحميل...</p>`;
    const players = await getLeaderboard();
    leaderboardList.innerHTML = "";
    if (players.length === 0) {
      leaderboardList.innerHTML = `<p class="friends-empty">لا يوجد لاعبون بعد</p>`;
      return;
    }
    const medals = ["🥇","🥈","🥉"];
    players.forEach((p, i) => {
      const avatar = p.photo
        ? `<img class="leaderboard-avatar" src="${p.photo}" alt="${p.name}"/>`
        : `<div class="leaderboard-avatar-placeholder">${p.name?.[0]?.toUpperCase()||"?"}</div>`;
      const row = document.createElement("div");
      row.className = "leaderboard-row";
      row.innerHTML = `
        <div class="leaderboard-rank ${i<3?`rank-${i+1}`:''}">
          ${medals[i] || i+1}
        </div>
        ${avatar}
        <div class="leaderboard-info">
          <div class="leaderboard-name">${p.name}</div>
          <div class="leaderboard-stats">نسبة الفوز: ${p.winRate}% • ${p.totalGames} مباراة</div>
        </div>
        <div class="leaderboard-wins">🏆 ${p.wins}</div>
      `;
      leaderboardList.appendChild(row);
    });
  });

  closeLeaderboardBtn?.addEventListener("click", () => {
    leaderboardPanel.classList.add("hidden");
  });

  leaderboardPanel?.addEventListener("click", (e) => {
    if (e.target === leaderboardPanel) leaderboardPanel.classList.add("hidden");
  });

  /* ══════════════════════════════════════
     👥 منطق الأصدقاء
  ══════════════════════════════════════ */
  friendsBtn?.addEventListener("click", () => {
    friendsPanel.classList.remove("hidden");
  });

  closeFriendsBtn?.addEventListener("click", () => {
    friendsPanel.classList.add("hidden");
    searchResults.innerHTML = "";
    friendsSearchInput.value = "";
  });

  friendsPanel?.addEventListener("click", (e) => {
    if (e.target === friendsPanel) {
      friendsPanel.classList.add("hidden");
      searchResults.innerHTML = "";
    }
  });

  friendsSearchBtn?.addEventListener("click", doSearch);
  friendsSearchInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

  async function doSearch() {
    const q = friendsSearchInput.value.trim();
    if (!q) return;
    friendsSearchBtn.textContent = "⏳";
    const results = await searchUsers(q);
    friendsSearchBtn.textContent = "🔍";
    searchResults.innerHTML = "";
    if (results.length === 0) {
      searchResults.innerHTML = `<p class="friends-empty">لا نتائج</p>`;
      return;
    }
    searchResults.innerHTML = `<p class="search-result-label">نتائج البحث:</p>`;
    results.forEach(user => searchResults.appendChild(makeFriendCard(user, "search")));
  }

  function makeFriendCard(user, type) {
    const card = document.createElement("div");
    card.className = "friend-card";
    const avatar = user.photo
      ? `<img src="${user.photo}" alt="${user.name}"/>`
      : `<div class="friend-avatar-placeholder">${user.name?.[0]?.toUpperCase() || "?"}</div>`;
    let actions = "";
    if (type === "search")  actions = `<button class="btn-add" data-uid="${user.uid}">➕ إضافة</button>`;
    if (type === "request") actions = `<button class="btn-accept" data-uid="${user.uid}">✓ قبول</button><button class="btn-reject" data-uid="${user.uid}">✕ رفض</button>`;
    if (type === "friend")  actions = `<button class="btn-invite" data-uid="${user.uid}">🎮 دعوة</button><button class="btn-chat" data-uid="${user.uid}">💬</button><button class="btn-remove" data-uid="${user.uid}">حذف</button>`;
    card.innerHTML = `${avatar}<span class="friend-name">${user.name}</span><div class="friend-actions">${actions}</div>`;
    card.querySelector(".btn-add")?.addEventListener("click", async (e) => {
      e.target.textContent = "✅ أُرسل"; e.target.disabled = true;
      await sendFriendRequest(user.uid);
    });
    card.querySelector(".btn-accept")?.addEventListener("click", async () => { await acceptFriendRequest(user.uid); });
    card.querySelector(".btn-reject")?.addEventListener("click", async () => { await rejectFriendRequest(user.uid); });
    card.querySelector(".btn-remove")?.addEventListener("click", async () => {
      if (confirm(`حذف ${user.name} من الأصدقاء؟`)) await removeFriend(user.uid);
    });
    card.querySelector(".btn-chat")?.addEventListener("click", () => {
      openChat(user);
    });
    card.querySelector(".btn-invite")?.addEventListener("click", async (e) => {
      e.target.textContent = "⏳";
      e.target.disabled = true;
      await startInviteGame(user);
    });
    return card;
  }

  // ── دعوة صديق للعب ──
  async function startInviteGame(friend) {
    const gridSize = +gridSizeSelect.value || 4;
    config.rows = config.cols = gridSize;
    config.players = 2;
    config.online  = true;
    config.onlinePlayerNum = 1;

    onlineManager.onOpponentJoined((oppName) => {
      config.onlinePlayerNames = { 1: currentUserName(), 2: oppName };
      onlineMyName.textContent  = currentUserName();
      onlineOppName.textContent = oppName;
      friendsPanel.classList.add("hidden");
      showOnlineStep("playing");
      launchOnlineGame(1);
    });

    const code = await onlineManager.createRoom(config, currentUserName());
    await sendGameInvite(friend.uid, code, config);

    setupScreen.classList.add("hidden");
    onlineScreen.classList.remove("hidden");
    roomCodeDisplay.classList.add("hidden");
    copyCodeBtn.classList.add("hidden");
    document.getElementById("lobby-share-hint").classList.add("hidden");
    showOnlineStep("lobby");
    lobbyStatusText.textContent = `بانتظار ${friend.name}...`;
    friendsPanel.classList.add("hidden");

    // إشعار لو رفض الصديق
    watchForRejection(friend.name);
  }

  function currentUserName() {
    return document.getElementById("user-name")?.textContent || "لاعب";
  }

  // ── إشعار دعوة واردة ──
  const inviteNotification = document.getElementById("invite-notification");
  const inviteText         = document.getElementById("invite-text");
  const inviteAcceptBtn    = document.getElementById("invite-accept-btn");
  const inviteRejectBtn    = document.getElementById("invite-reject-btn");
  let   pendingInvite      = null;

  function initInviteListener() {
    listenForInvites(async (invite) => {
      if (!invite) {
        inviteNotification.classList.add("hidden");
        pendingInvite = null;
        return;
      }
      pendingInvite = invite;
      inviteText.textContent = `🎮 ${invite.fromName} يدعوك للعب!`;
      inviteNotification.classList.remove("hidden");
    });
  }

  inviteAcceptBtn?.addEventListener("click", async () => {
    if (!pendingInvite) return;
    inviteNotification.classList.add("hidden");
    const invite = pendingInvite;
    pendingInvite = null;
    await clearInvite();

    config.online = true;
    config.onlinePlayerNum = 2;
    playerNameInput.value = currentUserName();

    setupScreen.classList.add("hidden");
    onlineScreen.classList.remove("hidden");
    // ✅ اذهب مباشرة للـ playing بدون إظهار name
    showOnlineStep("playing");

    try {
      const roomData = await onlineManager.joinRoom(invite.roomCode, currentUserName());
      config.rows = roomData.cfg.rows;
      config.cols = roomData.cfg.cols;
      config.players = 2;
      config.onlinePlayerNames = { 1: invite.fromName, 2: currentUserName() };
      onlineMyName.textContent  = currentUserName();
      onlineOppName.textContent = invite.fromName;
      launchOnlineGame(2);
    } catch (e) {
      onlineScreen.classList.add("hidden");
      setupScreen.classList.remove("hidden");
    }
  });

  inviteRejectBtn?.addEventListener("click", async () => {
    inviteNotification.classList.add("hidden");
    if (pendingInvite) await rejectInvite(pendingInvite);
    pendingInvite = null;
  });

  // ── الاستماع لرفض دعوتي ──
  let _rejectionUnsub = null;


  // ══════════════════════════════════════
  // 💬 منطق المحادثة v12.5
  // ══════════════════════════════════════
  let currentChatFriend = null;
  let chatUnsub = null;
  let currentMyUid = null;
  let chatNotifTimeout = null;
  const db_main = getDatabase();

  // ── إيموجي ──
  const EMOJIS = ["😊","😂","❤️","👍","🔥","🎮","😍","🤣","😭","💯",
                  "🙏","👏","😎","🤔","😅","🥳","😢","💪","🤝","✌️",
                  "👋","🎉","😆","🙈","💀","😤","🥰","😏","🤩","👀"];
  const emojiPicker = document.getElementById("emoji-picker");
  EMOJIS.forEach(emoji => {
    const span = document.createElement("span");
    span.className = "emoji-item";
    span.textContent = emoji;
    span.onclick = () => {
      const input = document.getElementById("chat-input");
      input.value += emoji;
      input.focus();
      emojiPicker.classList.add("hidden");
    };
    emojiPicker?.appendChild(span);
  });
  document.getElementById("emoji-btn").onclick = () => emojiPicker.classList.toggle("hidden");

  // ── إرسال ──
  document.getElementById("chat-send-btn").onclick = async () => {
    const input = document.getElementById("chat-input");
    const text  = input.value.trim();
    if (!text || !currentChatFriend) return;
    input.value = "";
    emojiPicker?.classList.add("hidden");
    await sendMessage(currentChatFriend.uid, text);
    input.focus();
  };

  document.getElementById("chat-input").onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const input = document.getElementById("chat-input");
    const text  = input.value.trim();
    if (!text || !currentChatFriend) return;
    input.value = "";
    emojiPicker?.classList.add("hidden");
    sendMessage(currentChatFriend.uid, text);
    input.focus();
  };

  document.getElementById("chat-back-btn").onclick = () => {
    document.getElementById("chat-panel").classList.add("hidden");
    document.getElementById("friends-panel").classList.remove("hidden");
    emojiPicker?.classList.add("hidden");
    if (chatUnsub) { chatUnsub(); chatUnsub = null; }
    currentChatFriend = null;
  };

  function openChat(friend) {
    currentChatFriend = friend;
    currentMyUid = getCurrentUser()?.uid;
    document.getElementById("chat-with-name").textContent   = friend.name;
    document.getElementById("chat-with-avatar").textContent = friend.name?.[0]?.toUpperCase() || "?";
    document.getElementById("chat-messages").innerHTML      = "";
    document.getElementById("chat-invite-btn").onclick = () => {
      document.getElementById("chat-panel").classList.add("hidden");
      startInviteGame(friend);
    };
    markAsRead(friend.uid);
    markRead(friend.uid);
    markDelivered(friend.uid);
    document.getElementById("friends-panel").classList.add("hidden");
    document.getElementById("chat-panel").classList.remove("hidden");
    document.getElementById("chat-input").focus();
    if (chatUnsub) chatUnsub();
    chatUnsub = listenMessages(friend.uid, (msgs) => {
      renderMessages(msgs, currentMyUid);
      markAsRead(friend.uid);
      markRead(friend.uid);
    });
  }

  function renderMessages(msgs, myUid) {
    const box = document.getElementById("chat-messages");
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop <= box.clientHeight + 50;
    box.innerHTML = "";
    if (msgs.length === 0) {
      box.innerHTML = `<p class="friends-empty">لا رسائل بعد، ابدأ المحادثة!</p>`;
      return;
    }
    msgs.forEach(msg => {
      if (!msg.text) return;
      const isMine = msg.fromUid === myUid;
      const div    = document.createElement("div");
      div.className = `chat-msg ${isMine ? "mine" : "theirs"}`;
      const time   = msg.ts ? new Date(msg.ts).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "";
      let statusIcon = "";
      if (isMine) {
        if      (msg.status === "read")      statusIcon = `<span class="msg-status status-read">✓✓</span>`;
        else if (msg.status === "delivered") statusIcon = `<span class="msg-status status-delivered">✓✓</span>`;
        else                                  statusIcon = `<span class="msg-status status-sent">✓</span>`;
      }
      div.innerHTML = `${msg.text}<div class="chat-msg-time">${statusIcon}${time}</div>`;
      box.appendChild(div);
    });
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  // ── إشعارات رسائل جديدة ──
  const _notifUnsubs  = new Map();
  const _lastSeenMsg  = new Map(); // نتتبع آخر رسالة شُوفت لكل صديق

  function initChatNotifications() {
    const myUid = getCurrentUser()?.uid;
    if (!myUid) return;

    onValue(ref(db_main, `users/${myUid}/friends`), (snap) => {
      if (!snap.exists()) return;
      const friends = Object.values(snap.val());

      friends.forEach(friend => {
        if (_notifUnsubs.has(friend.uid)) return;

        const unsub = listenMessages(friend.uid, (msgs) => {
          if (!msgs.length) return;
          const lastMsg      = msgs[msgs.length - 1];
          const isFromFriend = lastMsg.fromUid === friend.uid;
          const chatOpen     = currentChatFriend?.uid === friend.uid;
          const lastSeen     = _lastSeenMsg.get(friend.uid) || 0;
          const isNew        = lastMsg.ts > lastSeen;

          if (isFromFriend && isNew && !chatOpen) {
            _lastSeenMsg.set(friend.uid, lastMsg.ts);
            showChatNotification(friend, lastMsg.text);
            markDelivered(friend.uid);
          }

          // نحدّث lastSeen دايماً
          if (lastMsg.ts > lastSeen) {
            _lastSeenMsg.set(friend.uid, lastMsg.ts);
          }
        });

        _notifUnsubs.set(friend.uid, unsub);
      });
    });
  }

  function showChatNotification(friend, text) {
    let notif = document.getElementById("chat-notification");
    if (!notif) {
      notif = document.createElement("div");
      notif.id = "chat-notification";
      document.body.appendChild(notif);
    }
    notif.innerHTML = `
      <span style="font-size:1.2rem">💬</span>
      <div class="notif-text">
        <div class="notif-name">${friend.name}</div>
        <div>${text.length > 30 ? text.slice(0,30) + "..." : text}</div>
      </div>
    `;
    notif.style.display = "flex";
    notif.onclick = () => {
      audioManager.playButtonClick(); // صوت عند الضغط على الإشعار
      notif.style.display = "none";
      document.getElementById("friends-panel").classList.remove("hidden");
      openChat(friend);
    };
    if (chatNotifTimeout) clearTimeout(chatNotifTimeout);
    chatNotifTimeout = setTimeout(() => { notif.style.display = "none"; }, 5000);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`💬 ${friend.name}`, { body: text, icon: "/jazma/images/google.svg" });
    }
    // الصوت يشتغل لما المستخدم يضغط على الإشعار
    playNotifSound();
  }

  async function doSendMessage() {} // placeholder


  function watchForRejection(friendName) {
    // ألغِ أي listener قديم أولاً
    if (_rejectionUnsub) { _rejectionUnsub(); _rejectionUnsub = null; }

    _rejectionUnsub = listenForInviteRejection((data) => {
      if (_rejectionUnsub) { _rejectionUnsub(); _rejectionUnsub = null; }
      onlineManager.leaveRoom();
      onlineScreen.classList.add("hidden");
      setupScreen.classList.remove("hidden");
      showRejectionAlert(friendName);
    });
  }

  function showRejectionAlert(name) {
    const box = document.createElement("div");
    box.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      background:#1e1e2e;border:2px solid #f87171;border-radius:16px;
      padding:28px 36px;text-align:center;z-index:9999;box-shadow:0 8px 40px #0008;
    `;
    box.innerHTML = `
      <p style="font-size:1.1rem;margin-bottom:16px;">😔 ${name} رفض الدعوة</p>
      <button onclick="this.parentElement.remove()" style="background:#7c6af7;color:#fff;border:none;padding:9px 22px;border-radius:8px;cursor:pointer;">حسناً</button>
    `;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 5000);
  }

  function initFriendsListeners() {
    listenFriendRequests((requests) => {
      if (requests.length > 0) {
        friendReqBadge.textContent = requests.length;
        friendReqBadge.classList.remove("hidden");
        friendRequestsSec.classList.remove("hidden");
        friendRequestsList.innerHTML = "";
        requests.forEach(r => friendRequestsList.appendChild(makeFriendCard(r, "request")));
      } else {
        friendReqBadge.classList.add("hidden");
        friendRequestsSec.classList.add("hidden");
      }
    });
    listenFriends((friends) => {
      friendsList.innerHTML = "";
      if (friends.length === 0) {
        friendsList.innerHTML = `<p class="friends-empty">لا يوجد أصدقاء بعد</p>`;
        return;
      }
      friends.forEach(f => friendsList.appendChild(makeFriendCard(f, "friend")));
    });
  }

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

    // ✅ املأ الاسم تلقائياً من حساب المستخدم
    if (step === "name" || step === "lobby") {
      import("./auth.js").then(({ currentUser }) => {
        if (getCurrentUser()?.displayName) {
          playerNameInput.value = getCurrentUser().displayName;
        }
      });
    }

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
        roomCodeDisplay.classList.remove("hidden");
        copyCodeBtn.classList.remove("hidden");
        document.getElementById("lobby-share-hint").classList.remove("hidden");
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

    // ✅ شاشة تحميل قصيرة قبل ما تبدأ اللعبة
    onlineTurnInd.textContent = "⏳ جاري تحميل اللعبة...";
    onlineTurnInd.style.color = "#888";

    setTimeout(() => {
      launchGame();
      updateOnlineTurnIndicator();

      requestAnimationFrame(() => {
        onlineManager.onMove((lineKey) => {
          applyOpponentMove(lineKey);
        });
      });

      onlineManager.onOpponentLeft(() => { showDisconnectAlert(); });
      onlineManager.onRestart(() => { showRestartAlert(); });
    }, 800); // 800ms تعطي إحساس انتقال سلس
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

