// 📄 ui/friendsUI.js
// قائمة الأصدقاء + البحث + الإجراءات
import { searchUsers, sendFriendRequest, acceptFriendRequest,
         rejectFriendRequest, removeFriend,
         listenFriendRequests, listenFriends } from "../friends.js?v=1782603469";

function asText(v, fallback = "") { return String(v ?? fallback); }
function firstInitial(name) { return asText(name, "?").trim().charAt(0).toUpperCase() || "?"; }
function safeImageUrl(url) {
  try { const p = new URL(asText(url), location.href); return p.protocol === "https:" || p.protocol === "http:"; }
  catch { return false; }
}

// onInviteFriend يُمرر من main.js لأن إطلاق اللعبة يحتاج config
export function initFriendsUI({ onInviteFriend, onOpenChat }) {
  const friendsBtn         = document.getElementById("friends-btn");
  const friendsPanel       = document.getElementById("friends-panel");
  const closeFriendsBtn    = document.getElementById("close-friends-btn");
  const friendsSearchInput = document.getElementById("friends-search-input");
  const friendsSearchBtn   = document.getElementById("friends-search-btn");
  const searchResults      = document.getElementById("search-results");
  const friendRequestsSec  = document.getElementById("friend-requests-section");
  const friendRequestsList = document.getElementById("friend-requests-list");
  const friendsList        = document.getElementById("friends-list");
  const friendReqBadge     = document.getElementById("friend-requests-badge");

  friendsBtn?.addEventListener("click", () => friendsPanel.classList.remove("hidden"));

  closeFriendsBtn?.addEventListener("click", () => {
    friendsPanel.classList.add("hidden");
    searchResults.innerHTML    = "";
    friendsSearchInput.value   = "";
  });

  friendsPanel?.addEventListener("click", e => {
    if (e.target === friendsPanel) {
      friendsPanel.classList.add("hidden");
      searchResults.innerHTML = "";
    }
  });

  friendsSearchBtn?.addEventListener("click", doSearch);
  friendsSearchInput?.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

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
    const card     = document.createElement("div"); card.className = "friend-card";
    const userName = asText(user.name, "لاعب");
    let avatar;
    if (user.photo && safeImageUrl(user.photo)) {
      avatar = document.createElement("img");
      avatar.src = user.photo; avatar.alt = userName;
    } else {
      avatar = document.createElement("div");
      avatar.className = "friend-avatar-placeholder";
      avatar.textContent = firstInitial(userName);
    }
    const name    = document.createElement("span"); name.className = "friend-name"; name.textContent = userName;
    const actions = document.createElement("div");  actions.className = "friend-actions";

    function addAction(cls, text) {
      const btn = document.createElement("button");
      btn.className = cls; btn.dataset.uid = asText(user.uid); btn.textContent = text;
      actions.appendChild(btn); return btn;
    }

    if (type === "search")  addAction("btn-add", "➕ إضافة");
    if (type === "request") { addAction("btn-accept", "✓ قبول"); addAction("btn-reject", "✕ رفض"); }
    if (type === "friend")  { addAction("btn-invite", "🎮 دعوة"); addAction("btn-chat", "💬"); addAction("btn-remove", "حذف"); }

    card.append(avatar, name, actions);

    card.querySelector(".btn-add")?.addEventListener("click", async e => {
      e.target.textContent = "✅ أُرسل"; e.target.disabled = true;
      await sendFriendRequest(user.uid);
    });
    card.querySelector(".btn-accept")?.addEventListener("click", () => acceptFriendRequest(user.uid));
    card.querySelector(".btn-reject")?.addEventListener("click", () => rejectFriendRequest(user.uid));
    card.querySelector(".btn-remove")?.addEventListener("click", async () => {
      if (confirm(`حذف ${userName} من الأصدقاء؟`)) await removeFriend(user.uid);
    });
    card.querySelector(".btn-chat")?.addEventListener("click",   () => onOpenChat?.(user));
    card.querySelector(".btn-invite")?.addEventListener("click", async e => {
      const btn = e.target;
      btn.textContent = "⏳"; btn.disabled = true;
      await onInviteFriend?.(user, () => {
        // callback: يُستدعى عند الرفض لإرجاع الزر
        btn.textContent = "🎮 دعوة"; btn.disabled = false;
      });
    });

    return card;
  }

  // ── الاستماع لطلبات الأصدقاء والقائمة ──────────────────────
  listenFriendRequests(requests => {
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

  listenFriends(friends => {
    friendsList.innerHTML = "";
    if (friends.length === 0) {
      friendsList.innerHTML = `<p class="friends-empty">لا يوجد أصدقاء بعد</p>`;
      return;
    }
    friends.forEach(f => friendsList.appendChild(makeFriendCard(f, "friend")));
  });
}
