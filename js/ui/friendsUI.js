// 📄 ui/friendsUI.js
// قائمة الأصدقاء + البحث + الإجراءات
import { watchPresence, PRESENCE_META, lastSeenText, displayState } from "../presence.js?v=1792488854";
import { searchUsers, sendFriendRequest, acceptFriendRequest,
         rejectFriendRequest, removeFriend,
         listenFriendRequests, listenFriends } from "../friends.js?v=1792488854";
import { outgoingInvite, onInviteStateChange } from "./inviteUI.js?v=1792488854";
import { asText, firstInitial, safeImageSrc } from "./safeText.js?v=1792488854";
import { getCurrentUser } from "../auth.js?v=1792488854";

// زر "دعوة" يعكس حالة الدعوة الصادرة (v35.9): ⏳ للصديق المدعوّ ما دامت دعوته قائمة، ويرجع مع أي نهاية لها
// (قبول ثم مباراة، رفض، "في مباراة"، انتهاء المهلة، إلغاء، فشل) — كان لا يرجع إلا عند الرفض
function paintInviteBtn(btn) {
  const out = outgoingInvite();
  const mine = !!out && out.friendUid === btn.dataset.uid;
  btn.textContent = mine ? "⏳" : "🎮 دعوة";
  btn.disabled = mine;
  btn.title = mine ? "بانتظار ردّه على دعوتك" : "";
}
let _inviteStateUnsub = null;

// متابعات بطاقات الأصدقاء الظاهرة (الحضور + مؤقّت التحديث) — تُوقف كلها قبل إعادة رسم القائمة (v36.0 — 1.11).
// كانت: تبقى متابعة البطاقة المحذوفة، ولا تستلم الجديدة شيئاً (حالة الصديق تتجمّد)، ومؤقّتها لا يتوقف أبداً
// (كان يعتمد على حدث DOMNodeRemoved الذي أزالته المتصفحات الحديثة).
let _cardStops = [];
function stopFriendCards() {
  _cardStops.splice(0).forEach(stop => { try { stop(); } catch {} });
}
// أصدقائي الحاليون (مفاتيح قائمتي) — نتيجة البحث عن صديق حالي تقول "✓ صديقك" بدل "➕ إضافة" (v36.1)
const _friendKeys = new Set();


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

  // رسالة قصيرة في لوحة الأصدقاء عند فشل عملية (v36.1 — الخطوة 1.13): كانت كل الأخطاء صامتة
  // ("✅ أُرسل" قبل الكتابة، والحذف يترك صداقة من طرف واحد بلا كلمة)
  let flashEl = document.getElementById("friends-flash");
  if (!flashEl && searchResults?.parentNode) {
    flashEl = document.createElement("p");
    flashEl.id = "friends-flash";
    flashEl.className = "friends-empty hidden";
    searchResults.parentNode.insertBefore(flashEl, searchResults);
  }
  let flashTimer = null;
  function flash(text) {
    if (!flashEl) return;
    flashEl.textContent = text;
    flashEl.classList.remove("hidden");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => flashEl.classList.add("hidden"), 6000);
  }

  // تحديث كل أزرار "دعوة" الظاهرة مع كل تغيّر في الدعوة الصادرة (اشتراك واحد ولو تكرّرت التهيئة)
  try { _inviteStateUnsub?.(); } catch {}
  _inviteStateUnsub = onInviteStateChange(() => {
    friendsList?.querySelectorAll(".btn-invite").forEach(paintInviteBtn);
  });

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
    let results = null;
    try { results = await searchUsers(q); }
    catch { results = null; }
    finally { friendsSearchBtn.textContent = "🔍"; }   // v36.0: الزر يرجع ولو فشل البحث
    searchResults.innerHTML = "";
    if (!Array.isArray(results)) {
      searchResults.innerHTML = `<p class="friends-empty">تعذّر البحث — حاول مجدداً</p>`;
      return;
    }
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
    const photo = safeImageSrc(user.photo);     // v36.0: صور حسابات Google فقط، وبلا referrer
    if (photo) {
      avatar = document.createElement("img");
      avatar.referrerPolicy = "no-referrer";
      avatar.src = photo; avatar.alt = userName;
    } else {
      avatar = document.createElement("div");
      avatar.className = "friend-avatar-placeholder";
      avatar.textContent = firstInitial(userName);
    }
    const name    = document.createElement("span"); name.className = "friend-name"; name.textContent = userName;
    const actions = document.createElement("div");  actions.className = "friend-actions";

    // 🟢 مؤشّر الحضور + آخر ظهور (للأصدقاء فقط — يُتابَع حياً)
    let presenceEl = null;
    if (type === "friend" && user.uid) {
      presenceEl = document.createElement("span");
      presenceEl.className = "friend-presence";
      presenceEl.textContent = "⚫";
      name.appendChild(document.createElement("br"));
      const sub = document.createElement("small");
      sub.className = "friend-presence-text";
      sub.textContent = "…";
      name.appendChild(sub);
      let _lastPresence = null;
      const paint = () => {
        const st = displayState(_lastPresence);
        const meta = PRESENCE_META[st] || PRESENCE_META.offline;
        presenceEl.textContent = meta.dot;
        presenceEl.title = meta.label;
        card.dataset.presence = st;
        sub.textContent = (st === "offline")
          ? (lastSeenText(_lastPresence?.lastSeen) || meta.label)
          : meta.label;
      };
      const stopWatch = watchPresence(user.uid, (p) => { _lastPresence = p; paint(); });
      // تحديث دوري: "انقطاع مؤقت" تنتهي بعد المهلة، و"آخر ظهور" يتقادم
      const tick = setInterval(paint, 5000);
      _cardStops.push(() => { stopWatch(); clearInterval(tick); });
    }

    function addAction(cls, text) {
      const btn = document.createElement("button");
      btn.className = cls; btn.dataset.uid = asText(user.uid); btn.textContent = text;
      actions.appendChild(btn); return btn;
    }

    if (type === "search") {
      // "✓ صديقك" للصداقة من الطرفين فقط. في قائمتي وحدي (صداقة من طرف واحد بقيت من v36.0): "➕ إضافة" — طلب جديد
      // يقبله فتكتمل (كان "✓ صديقك" يخفي الزر فلا يصلحها من جهتي شيء — مراجعة v36.1)
      const me = getCurrentUser()?.uid;
      const back = me && user.friends && typeof user.friends === "object" ? user.friends[me] : null;
      const mutual = _friendKeys.has(user.uid) && !!back && typeof back === "object";   // مدخل صداقة = كائن (كالقائمة نفسها)
      if (mutual) { const b = addAction("btn-add-done", "✓ صديقك"); b.disabled = true; }
      else addAction("btn-add", "➕ إضافة");
    }
    if (type === "request") { addAction("btn-accept", "✓ قبول"); addAction("btn-reject", "✕ رفض"); }
    if (type === "friend")  { addAction("btn-invite", "🎮 دعوة"); addAction("btn-chat", "💬"); addAction("btn-remove", "حذف"); }

    if (presenceEl) card.append(presenceEl, avatar, name, actions);
    else card.append(avatar, name, actions);

    // v36.1 (1.13): كل عملية تنتظر نتيجتها الفعلية من الخادم، والفشل يُقال بوضوح (لا خطأ صامت في الـconsole)
    card.querySelector(".btn-add")?.addEventListener("click", async e => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = "⏳";
      try {
        await sendFriendRequest(user.uid);
        btn.textContent = "✅ أُرسل";
      } catch {
        btn.textContent = "⚠️ لم يُرسل";
        flash(`⚠️ تعذّر إرسال الطلب إلى ${userName} — حاول مجدداً`);
        setTimeout(() => { btn.textContent = "➕ إضافة"; btn.disabled = false; }, 3000);
      }
    });
    const requestBtns = () => [...card.querySelectorAll(".btn-accept, .btn-reject")];
    const setBusy = (on) => requestBtns().forEach(b => { b.disabled = on; });
    card.querySelector(".btn-accept")?.addEventListener("click", async () => {
      setBusy(true);
      try {
        const res = await acceptFriendRequest(user.uid);
        if (res?.reason === "stale") flash(`📭 طلب ${userName} من نسخة قديمة من اللعبة — اطلب منه تحديث الصفحة وإرساله من جديد`);
        else if (res?.reason === "gone") flash("📭 هذا الطلب لم يعد صالحاً");
      } catch {
        flash(`⚠️ تعذّر قبول طلب ${userName} — حاول مجدداً`);
        setBusy(false);
      }
    });
    card.querySelector(".btn-reject")?.addEventListener("click", async () => {
      setBusy(true);
      try { await rejectFriendRequest(user.uid); }
      catch { flash(`⚠️ تعذّر رفض طلب ${userName} — حاول مجدداً`); setBusy(false); }
    });
    card.querySelector(".btn-remove")?.addEventListener("click", async e => {
      if (!confirm(`حذف ${userName} من الأصدقاء؟`)) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await removeFriend(user.uid); }
      catch { flash(`⚠️ تعذّر حذف ${userName} — حاول مجدداً`); btn.disabled = false; }
    });
    card.querySelector(".btn-chat")?.addEventListener("click",   () => onOpenChat?.(user));
    const inviteBtn = card.querySelector(".btn-invite");
    if (inviteBtn) {
      paintInviteBtn(inviteBtn);
      // الحالة (⏳ ثم الرجوع) تأتي من الدعوة نفسها — لا من الزر
      inviteBtn.addEventListener("click", () => { onInviteFriend?.(user); });
    }

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
    _friendKeys.clear();
    friends.forEach(f => _friendKeys.add(f.uid));
    stopFriendCards();
    friendsList.innerHTML = "";
    if (friends.length === 0) {
      friendsList.innerHTML = `<p class="friends-empty">لا يوجد أصدقاء بعد</p>`;
      return;
    }
    friends.forEach(f => friendsList.appendChild(makeFriendCard(f, "friend")));
  });
}
