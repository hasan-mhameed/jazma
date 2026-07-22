// 📄 ui/messagesUI.js
// زر الرسائل في navbar + panel المحادثات

import { listenMessages, markAsRead, getLastReadMap, listenLastRead, chatKey } from "../chat.js?v=1784757639";
import { listenFriends }              from "../friends.js?v=1784757639";
import { getCurrentUser }             from "../auth.js?v=1784757639";

let _friends     = [];
let _unsubscribes = [];
let _unreadMap   = {};   // { uid: count }
let _lastMsgMap  = {};   // { uid: { text, ts } }
let _lastReadMap = {};   // { chatKey: ts } من Firebase
let _allMsgs     = {};   // { uid: [msgs] }
let _onOpenChat  = null;

// ── init ──────────────────────────────────────────────────────────
export function initMessagesUI({ onOpenChat }) {
  _onOpenChat = onOpenChat;

  const btn      = document.getElementById('messages-btn');
  const panel    = document.getElementById('messages-panel');
  const closeBtn = document.getElementById('close-messages-btn');

  btn?.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderMessagesList();
  });

  closeBtn?.addEventListener('click', () => panel.classList.add('hidden'));
  panel?.addEventListener('click', e => { if (e.target === panel) panel.classList.add('hidden'); });

  // لما تُفتح محادثة من أي مكان — امسح الـ unread
  document.addEventListener('chat:opened', e => clearUnreadFor(e.detail));

  // استمع لآخر قراءة من Firebase (يتبع الحساب على أي جهاز)
  listenLastRead(map => {
    _lastReadMap = map || {};
    recomputeUnread();
  });

  // استمع للأصدقاء وابدأ تتبع رسائلهم
  listenFriends(friends => {
    _friends = friends;
    startListening(friends);
  });
}

// ── إعادة حساب غير المقروء بعد تحديث lastRead ──
function recomputeUnread() {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  _friends.forEach(friend => {
    const k = [myUid, friend.uid].sort().join('_');
    const lastRead = _lastReadMap[k] || 0;
    const msgs = _allMsgs[friend.uid] || [];
    _unreadMap[friend.uid] = msgs.filter(m => m.fromUid === friend.uid && (m.ts || 0) > lastRead).length;
  });
  updateBadge();
  const panel = document.getElementById('messages-panel');
  if (!panel?.classList.contains('hidden')) renderMessagesList();
}

// ── بدء الاستماع لرسائل كل صديق ─────────────────────────────────
function startListening(friends) {
  _unsubscribes.forEach(fn => fn());
  _unsubscribes = [];

  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;

  friends.forEach(friend => {
    const k = [myUid, friend.uid].sort().join('_');

    const unsub = listenMessages(friend.uid, msgs => {
      _allMsgs[friend.uid] = msgs;
      const lastRead = _lastReadMap[k] || 0;
      const unread   = msgs.filter(m => m.fromUid === friend.uid && (m.ts || 0) > lastRead).length;
      const last     = msgs[msgs.length - 1];

      _unreadMap[friend.uid]  = unread;
      _lastMsgMap[friend.uid] = last ? { text: last.text, ts: last.ts } : null;

      updateBadge();
      const panel = document.getElementById('messages-panel');
      if (!panel?.classList.contains('hidden')) renderMessagesList();
    });

    _unsubscribes.push(unsub);
  });
}

// ── تحديث الـ badge ───────────────────────────────────────────────
function updateBadge() {
  const total  = Object.values(_unreadMap).reduce((a, b) => a + b, 0);
  const badge  = document.getElementById('messages-badge');
  // نزامن نقطة اللعب
  const gameDot = document.getElementById('game-msg-dot');
  if (gameDot) gameDot.classList.toggle('hidden', total === 0);
  if (!badge) return;
  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : total;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ── رسم قائمة المحادثات ───────────────────────────────────────────
function renderMessagesList() {
  const list = document.getElementById('messages-list');
  if (!list) return;

  // نرتب الأصدقاء — من عنده رسائل أولاً ثم الأحدث
  const sorted = [..._friends].sort((a, b) => {
    const unreadDiff = (_unreadMap[b.uid] || 0) - (_unreadMap[a.uid] || 0);
    if (unreadDiff !== 0) return unreadDiff;
    return (_lastMsgMap[b.uid]?.ts || 0) - (_lastMsgMap[a.uid]?.ts || 0);
  });

  if (sorted.length === 0) {
    list.innerHTML = '<p class="friends-empty">أضف أصدقاء للدردشة معهم</p>';
    return;
  }

  list.innerHTML = '';
  sorted.forEach(friend => {
    const unread  = _unreadMap[friend.uid] || 0;
    const lastMsg = _lastMsgMap[friend.uid];
    const row     = document.createElement('div');
    row.className = `msg-row ${unread > 0 ? 'msg-row-unread' : ''}`;

    const initial = (friend.name || '?')[0].toUpperCase();
    const preview = lastMsg?.text
      ? (lastMsg.text.length > 30 ? lastMsg.text.slice(0, 30) + '...' : lastMsg.text)
      : 'لا رسائل بعد';

    row.innerHTML = `
      <div class="msg-avatar">${initial}</div>
      <div class="msg-info">
        <div class="msg-name">${friend.name || 'لاعب'}</div>
        <div class="msg-preview">${preview}</div>
      </div>
      ${unread > 0 ? `<div class="msg-unread-badge">${unread}</div>` : ''}`;

    row.addEventListener('click', () => {
      // مسح الـ unread — markAsRead يكتب في Firebase
      markAsRead(friend.uid);
      _unreadMap[friend.uid] = 0;
      updateBadge();

      document.getElementById('messages-panel')?.classList.add('hidden');
      _onOpenChat?.(friend);
    });

    list.appendChild(row);
  });
}

// ── مسح الـ unread لصديق معين (تُستدعى من chatUI) ─────────────────
export function clearUnreadFor(friendUid) {
  _unreadMap[friendUid] = 0;
  updateBadge();
}
