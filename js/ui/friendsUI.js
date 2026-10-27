// 📄 ui/friendsUI.js
// قائمة الأصدقاء + البحث + الإجراءات
import { watchPresence, PRESENCE_META, lastSeenText, displayState } from "../presence.js?v=1793139376";
import { searchUsers, sendFriendRequest, acceptFriendRequest,
         rejectFriendRequest, removeFriend,
         listenFriendRequests, listenFriends, listenSentRequests, isMutualFriend, isRequestPending } from "../friends.js?v=1793139376";
import { outgoingInvite, onInviteStateChange } from "./inviteUI.js?v=1793139376";
import { asText, firstInitial, safeImageSrc } from "./safeText.js?v=1793139376";
import { getCurrentUser } from "../auth.js?v=1793139376";
import { showNotificationCard } from "./chatUI.js?v=1793139376";

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

// ── زر بطاقة البحث من الواقع لحظة بلحظة (v36.2 — الخطوة 1.15) ──
// كان لقطة لحظة البحث: يبقى "✅ أُرسل" بعد قبوله حتى إعادة فتح القائمة (فحص 1 لـv36.1). الآن يُعاد رسمه مع كل تغيّر في
// قائمتي أو في طلباتي القائمة: "✓ صديقك" (من الطرفين) | "✅ أُرسل" (طلبي قائم) | "➕ إضافة" | "⏳" أثناء الإرسال |
// "⚠️ لم يُرسل" (3 ثوانٍ). و"✅ أُرسل" بعد تأكيد الخادم فقط — الكتابة المعلّقة لا تُظهرها
const _pendingSent = new Set();   // طلباتي القائمة (users/<أنا>/sentRequests)
const _knownMutual = new Set();   // صاروا أصدقاء من الطرفين ونتيجة البحث أقدم منه (قبولٌ يكتب الطرفين معاً)
const _sending     = new Set();   // إرسال جارٍ
const _sendFailed  = new Set();   // فشل للتو (يُعرض 3 ثوانٍ)
const _sentHere    = new Set();   // أرسلتُ له من هذه الصفحة للتوّ (قبل أن يصل حدث القائمة — طلبي في صندوقه أكيد)
const _staleProof  = new Set();   // دليلي باقٍ لكن طلبي ليس في صندوقه (رفضته نسخة أقدم) — "➕ إضافة" لا "✅ أُرسل"
const _settling    = new Set();   // تغيّر يُحسم الآن (طلب انتهى، أو دخل قائمتي) — "⏳" لا "➕ إضافة" عابرة قابلة للنقر
const _searchCards = new Map();   // uid ← إعادة رسم زر بطاقته في نتائج البحث الظاهرة
const repaintSearch = () => { for (const paint of _searchCards.values()) { try { paint(); } catch {} } };
function searchState(user) {
  if (_sending.has(user.uid) || _settling.has(user.uid)) return "sending";
  if (_sendFailed.has(user.uid)) return "failed";
  // 3.3أ: نتيجة البحث من الملف العام profiles (بلا friends/friendRequests) — نحكم من بياناتي أنا:
  // "✓ صديقك" للصداقة من الطرفين فقط (في قائمتي، وأكّدتها قراءة واحدة عبر _knownMutual — نسخة أقدم قد تكتب طرفاً
  // واحداً، وصداقة من طرف واحد يصلحها طلب جديد فلا نخفي زرّه)؛ "✅ أُرسل" ما دام طلبي قائماً في القاعدة
  // (users/<أنا>/sentRequests) أو أرسلته للتوّ من هذه الصفحة (قبل أن يصل حدث القائمة)
  if (_friendKeys.has(user.uid) && _knownMutual.has(user.uid)) return "friend";
  if ((_pendingSent.has(user.uid) || _sentHere.has(user.uid)) && !_staleProof.has(user.uid)) return "sent";
  return "add";
}
// تأكيد أن طلبي الصادر ما زال في صندوقه (قراءة واحدة) — دليلٌ بلا طلب (رفضته نسخة أقدم) يصير "➕ إضافة"
const confirmSent = (k) => isRequestPending(k)
  .then(there => { if (there) _staleProof.delete(k); else _staleProof.add(k); repaintSearch(); })
  .catch(() => {});
// انتظار حسم تغيّر (بحدّ أقصى — لا "⏳" عالقة)، وتأكيد الصداقة من الطرفين بقراءة واحدة (لا افتراض)
function settle(k, ms = 800) {
  _settling.add(k); repaintSearch();
  const done = () => { if (_settling.delete(k)) repaintSearch(); };
  setTimeout(done, ms);
  return done;
}
const confirmMutual = (k) => isMutualFriend(k)
  .then(m => { if (m && _friendKeys.has(k)) _knownMutual.add(k); else _knownMutual.delete(k); repaintSearch(); })
  .catch(() => {});


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
    _searchCards.clear();
    friendsSearchInput.value   = "";
  });

  friendsPanel?.addEventListener("click", e => {
    if (e.target === friendsPanel) {
      friendsPanel.classList.add("hidden");
      searchResults.innerHTML = "";
      _searchCards.clear();
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
    _searchCards.clear();
    _sentHere.clear(); _staleProof.clear();   // بحث جديد: نؤكّد كل حالة من القاعدة من جديد
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

    if (type === "search" && user.uid) {
      const paint = () => {
        const st = searchState(user);
        const btn = document.createElement("button");
        btn.dataset.uid = asText(user.uid);
        if (st === "add") {
          btn.className = "btn-add"; btn.textContent = "➕ إضافة";
          // v36.1 (1.13): ينتظر نتيجته الفعلية من الخادم، والفشل يُقال بوضوح (لا خطأ صامت في الـconsole)
          btn.addEventListener("click", async () => {
            _sending.add(user.uid); repaintSearch();
            try {
              await sendFriendRequest(user.uid);
              _sentHere.add(user.uid); _staleProof.delete(user.uid);   // أرسلته للتوّ: طلبي في صندوقه أكيد
            } catch {
              _sendFailed.add(user.uid);
              flash(`⚠️ تعذّر إرسال الطلب إلى ${userName} — حاول مجدداً`);
              setTimeout(() => { _sendFailed.delete(user.uid); repaintSearch(); }, 3000);
            } finally {
              _sending.delete(user.uid); repaintSearch();
            }
          });
        } else {
          btn.className = "btn-add-done"; btn.disabled = true;
          btn.textContent = { friend: "✓ صديقك", sent: "✅ أُرسل", sending: "⏳", failed: "⚠️ لم يُرسل" }[st];
        }
        actions.replaceChildren(btn);
      };
      _searchCards.set(user.uid, paint);
      // 3.3أ: نتيجة البحث من الملف العام (بلا friends/friendRequests) — نؤكّد من القاعدة بقراءة واحدة:
      // لمن في قائمتي: هل الصداقة من الطرفين؟ ("⏳" ثم "✓ صديقك" أو زر الإصلاح)؛ ولمن له دليل طلب عندي ولم أرسله
      // من هذه الصفحة للتوّ: هل طلبي ما زال في صندوقه؟ (دليل بلا طلب ← "➕ إضافة" لا "✅ أُرسل")
      if (_friendKeys.has(user.uid) && !_knownMutual.has(user.uid)) { const done = settle(user.uid); confirmMutual(user.uid).finally(done); }
      else if (_pendingSent.has(user.uid) && !_sentHere.has(user.uid)) confirmSent(user.uid);
      paint();
    }
    if (type === "request") { addAction("btn-accept", "✓ قبول"); addAction("btn-reject", "✕ رفض"); }
    if (type === "friend")  { addAction("btn-invite", "🎮 دعوة"); addAction("btn-chat", "💬"); addAction("btn-remove", "حذف"); }

    if (presenceEl) card.append(presenceEl, avatar, name, actions);
    else card.append(avatar, name, actions);

    // v36.1 (1.13): كل عملية تنتظر نتيجتها الفعلية من الخادم، والفشل يُقال بوضوح (لا خطأ صامت في الـconsole)
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
  // v36.2 (1.15): طلب جديد يصل والصفحة مفتوحة → بطاقة إشعار عابرة (كإشعار الرسائل)، والنقر يفتح القائمة على الطلب —
  // كانت الشارة وحدها (فحص 3 لـv36.1). الطلبات القائمة عند الدخول (أول لقطة) تكفيها الشارة، ولا إشعار واللوحة مفتوحة،
  // ولا أكثر من إشعار لكل مرسل في 10 دقائق (سحب طلبه وإعادته مراراً لا يصير إزعاجاً — مراجعة v36.2)
  let _reqSeen = null;
  const _toastedAt = new Map();
  const TOAST_GAP_MS = 10 * 60 * 1000;
  const notifyRequests = (fresh) => {
    const names = fresh.map(r => asText(r.name, "لاعب"));
    const title = names.length === 1 ? names[0] : "طلبات صداقة جديدة";
    const text  = names.length === 1 ? "أرسل لك طلب صداقة" : names.slice(0, 3).join("، ");
    showNotificationCard({
      icon: "📩", title, text,
      onClick: () => friendsPanel?.classList.remove("hidden"),
      systemTitle: `📩 ${title}`, systemBody: text,
    });
  };
  listenFriendRequests(requests => {
    const now = Date.now();
    const fresh = (_reqSeen ? requests.filter(r => !_reqSeen.has(r.uid)) : [])
      .filter(r => now - (_toastedAt.get(r.uid) || 0) > TOAST_GAP_MS);
    _reqSeen = new Set(requests.map(r => r.uid));
    if (fresh.length && friendsPanel?.classList.contains("hidden")) {
      fresh.forEach(r => _toastedAt.set(r.uid, now));
      try { notifyRequests(fresh); } catch {}
    }
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

  // طلباتي القائمة: "✅ أُرسل" ما دام قائماً. وطلبٌ انتهى (قُبل، أو رُفض، أو نظّفه التنظيف): يُحسم قبل الرسم — لمن في
  // قائمتي: هل صارت من الطرفين؟ (قراءة واحدة)؛ ولغيره: حدث القائمة القادم إن كان قبولاً، وإلا "➕ إضافة" بعد مهلة قصيرة
  let _sentReady = false;
  listenSentRequests(keys => {
    const gone = _sentReady ? [..._pendingSent].filter(k => !keys.includes(k)) : [];
    _pendingSent.clear(); keys.forEach(k => _pendingSent.add(k));
    _sentHere.clear();   // القاعدة هي المرجع الآن (طلباتي القائمة فعلاً) — الجسر المؤقت أدّى دوره
    _sentReady = true;
    for (const k of gone) {
      if (_knownMutual.has(k)) continue;
      const done = settle(k);
      if (_friendKeys.has(k)) confirmMutual(k).finally(done);
    }
    repaintSearch();
  });

  let _friendsReady = false;
  listenFriends(friends => {
    const before = new Set(_friendKeys);
    _friendKeys.clear();
    friends.forEach(f => _friendKeys.add(f.uid));
    // من دخل قائمتي وأنا أنظر: من الطرفين؟ — قراءة واحدة تؤكّده (نسخة أقدم قد تكتب طرفي وحده — مراجعة v36.2)
    if (_friendsReady) for (const k of _friendKeys) if (!before.has(k)) { const done = settle(k); confirmMutual(k).finally(done); }
    for (const k of [..._knownMutual]) if (!_friendKeys.has(k)) _knownMutual.delete(k);
    _friendsReady = true;
    repaintSearch();
    stopFriendCards();
    friendsList.innerHTML = "";
    if (friends.length === 0) {
      friendsList.innerHTML = `<p class="friends-empty">لا يوجد أصدقاء بعد</p>`;
      return;
    }
    friends.forEach(f => friendsList.appendChild(makeFriendCard(f, "friend")));
  });
}
