// 📄 ui/chatUI.js
// المحادثة بين الأصدقاء + الإشعارات
import { sendMessage, listenMessages, listenUnread, markAsRead, markDelivered, markRead } from "../chat.js?v=1780271092";
import { getCurrentUser } from "../auth.js?v=1780271092";
import { audioManager } from "../audio/audioManager.js?v=1780271092";
import { playNotifSound } from "../audio/notif.js?v=1780271092";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const EMOJIS = ["😊","😂","❤️","👍","🔥","🎮","😍","🤣","😭","💯",
                "🙏","👏","😎","🤔","😅","🥳","😢","💪","🤝","✌️",
                "👋","🎉","😆","🙈","💀","😤","🥰","😏","🤩","👀"];

let currentChatFriend = null;
let chatUnsub         = null;
let chatNotifTimeout  = null;
const _notifUnsubs    = new Map();
const _lastSeenMsg    = new Map();
const _notifReady     = new Set();
const db              = getDatabase();

function asText(v, fallback = "") { return String(v ?? fallback); }

export function initChatUI({ onInviteFromChat }) {
  const emojiPicker = document.getElementById("emoji-picker");

  // ── إيموجي ──────────────────────────────────────────────────
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

  // ── إرسال ───────────────────────────────────────────────────
  async function doSend() {
    const input = document.getElementById("chat-input");
    const text  = input.value.trim();
    if (!text || !currentChatFriend) return;
    input.value = "";
    emojiPicker?.classList.add("hidden");
    await sendMessage(currentChatFriend.uid, text);
    input.focus();
  }
  document.getElementById("chat-send-btn").onclick = doSend;
  document.getElementById("chat-input").onkeydown  = e => { if (e.key === "Enter") doSend(); };

  // ── رجوع ────────────────────────────────────────────────────
  document.getElementById("chat-back-btn").onclick = () => {
    document.getElementById("chat-panel").classList.add("hidden");
    document.getElementById("friends-panel").classList.remove("hidden");
    emojiPicker?.classList.add("hidden");
    if (chatUnsub) { chatUnsub(); chatUnsub = null; }
    currentChatFriend = null;
  };
}

export function openChat(friend) {
  currentChatFriend = friend;
  const myUid = getCurrentUser()?.uid;
  document.getElementById("chat-with-name").textContent   = friend.name;
  document.getElementById("chat-with-avatar").textContent = friend.name?.[0]?.toUpperCase() || "?";
  document.getElementById("chat-messages").innerHTML      = "";
  document.getElementById("chat-invite-btn").onclick = () => {
    document.getElementById("chat-panel").classList.add("hidden");
    // نُطلق حدث خارجي بدل استدعاء مباشر
    document.dispatchEvent(new CustomEvent("chat:invite", { detail: friend }));
  };
  markAsRead(friend.uid); markRead(friend.uid); markDelivered(friend.uid);
  document.getElementById("friends-panel").classList.add("hidden");
  document.getElementById("chat-panel").classList.remove("hidden");
  document.getElementById("chat-input").focus();
  if (chatUnsub) chatUnsub();
  chatUnsub = listenMessages(friend.uid, msgs => {
    renderMessages(msgs, myUid);
    markAsRead(friend.uid); markRead(friend.uid);
  });
}

function renderMessages(msgs, myUid) {
  const box = document.getElementById("chat-messages");
  if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop <= box.clientHeight + 50;
  box.innerHTML = "";
  if (msgs.length === 0) {
    const p = document.createElement("p"); p.className = "friends-empty";
    p.textContent = "لا رسائل بعد، ابدأ المحادثة!"; box.appendChild(p); return;
  }
  msgs.forEach(msg => {
    if (!msg.text) return;
    const isMine = msg.fromUid === myUid;
    const div    = document.createElement("div"); div.className = `chat-msg ${isMine ? "mine" : "theirs"}`;
    const time   = msg.ts ? new Date(msg.ts).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "";
    div.appendChild(document.createTextNode(asText(msg.text)));
    const timeEl = document.createElement("div"); timeEl.className = "chat-msg-time";
    if (isMine) {
      const statusEl = document.createElement("span");
      if (msg.status === "read")      { statusEl.className = "msg-status status-read";      statusEl.textContent = "✓✓"; }
      else if (msg.status === "delivered") { statusEl.className = "msg-status status-delivered"; statusEl.textContent = "✓✓"; }
      else                            { statusEl.className = "msg-status status-sent";      statusEl.textContent = "✓"; }
      timeEl.appendChild(statusEl);
    }
    timeEl.appendChild(document.createTextNode(time));
    div.appendChild(timeEl);
    box.appendChild(div);
  });
  if (atBottom) box.scrollTop = box.scrollHeight;
}

export function initChatNotifications() {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  onValue(ref(db, `users/${myUid}/friends`), snap => {
    if (!snap.exists()) return;
    Object.values(snap.val()).forEach(friend => {
      if (_notifUnsubs.has(friend.uid)) return;
      const unsub = listenMessages(friend.uid, msgs => {
        const lastMsg = msgs[msgs.length - 1];
        const lastTs  = lastMsg?.ts || 0;
        if (!_notifReady.has(friend.uid)) {
          _notifReady.add(friend.uid);
          _lastSeenMsg.set(friend.uid, lastTs);
          return;
        }
        if (!msgs.length) return;
        const isFromFriend = lastMsg.fromUid === friend.uid;
        const chatOpen     = currentChatFriend?.uid === friend.uid;
        const isNew        = lastTs > (_lastSeenMsg.get(friend.uid) || 0);
        if (chatOpen || !isFromFriend) { if (isNew) _lastSeenMsg.set(friend.uid, lastTs); return; }
        if (isNew) {
          _lastSeenMsg.set(friend.uid, lastTs);
          _showChatNotification(friend, lastMsg.text);
          markDelivered(friend.uid);
        }
      });
      _notifUnsubs.set(friend.uid, unsub);
    });
  });
}

function _showChatNotification(friend, text) {
  let notif = document.getElementById("chat-notification");
  if (!notif) { notif = document.createElement("div"); notif.id = "chat-notification"; document.body.appendChild(notif); }
  notif.textContent = "";
  const icon = document.createElement("span"); icon.style.fontSize = "1.2rem"; icon.textContent = "💬";
  const content = document.createElement("div"); content.className = "notif-text";
  const name    = document.createElement("div"); name.className = "notif-name"; name.textContent = asText(friend.name, "لاعب");
  const preview = document.createElement("div");
  const safe    = asText(text); preview.textContent = safe.length > 30 ? `${safe.slice(0, 30)}...` : safe;
  content.append(name, preview); notif.append(icon, content);
  notif.style.display = "flex";
  notif.onclick = () => {
    audioManager.playButtonClick();
    notif.style.display = "none";
    document.getElementById("friends-panel").classList.remove("hidden");
    openChat(friend);
  };
  if (chatNotifTimeout) clearTimeout(chatNotifTimeout);
  chatNotifTimeout = setTimeout(() => { notif.style.display = "none"; }, 5000);
  if ("Notification" in window && Notification.permission === "granted")
    new Notification(`💬 ${friend.name}`, { body: text, icon: "/jazma/images/google.svg" });
  playNotifSound();
}
