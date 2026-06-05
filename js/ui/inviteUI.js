// 📄 ui/inviteUI.js
// نظام الدعوات — إرسال، استقبال، رفض
import { listenForInvites, clearInvite, rejectInvite, listenForInviteRejection } from "../invite.js?v=1780699111";
import { sendGameInvite } from "../invite.js?v=1780699111";
import { onlineManager } from "../firebase.js?v=1780699111";

let _rejectionUnsub = null;
let pendingInvite   = null;

export function initInviteListener({ onInviteAccepted }) {
  const inviteNotification = document.getElementById("invite-notification");
  const inviteText         = document.getElementById("invite-text");
  const inviteAcceptBtn    = document.getElementById("invite-accept-btn");
  const inviteRejectBtn    = document.getElementById("invite-reject-btn");

  listenForInvites(async invite => {
    if (!invite) {
      inviteNotification.classList.add("hidden");
      pendingInvite = null;
      return;
    }
    pendingInvite = invite;
    inviteText.textContent = `🎮 ${invite.fromName} يدعوك للعب!`;
    inviteNotification.classList.remove("hidden");
  });

  inviteAcceptBtn?.addEventListener("click", async () => {
    if (!pendingInvite) return;
    inviteNotification.classList.add("hidden");
    const invite = pendingInvite;
    pendingInvite = null;
    await clearInvite();
    onInviteAccepted?.(invite);
  });

  inviteRejectBtn?.addEventListener("click", async () => {
    inviteNotification.classList.add("hidden");
    if (pendingInvite) await rejectInvite(pendingInvite);
    pendingInvite = null;
  });
}

export async function sendInviteGame(friend, config, myName, callbacks) {
  const { onOpponentJoined, onRoomReady, onRejection } = callbacks;

  config.online  = true;
  config.onlinePlayerNum = 1;

  onlineManager.onOpponentJoined(oppName => onOpponentJoined(oppName));

  const code = await onlineManager.createRoom(config, myName);
  await sendGameInvite(friend.uid, code, config);
  onRoomReady?.(code, friend.name);
  watchForRejection(friend.name, onRejection);
}

export function watchForRejection(friendName, onRejected) {
  if (_rejectionUnsub) { _rejectionUnsub(); _rejectionUnsub = null; }
  _rejectionUnsub = listenForInviteRejection(() => {
    if (_rejectionUnsub) { _rejectionUnsub(); _rejectionUnsub = null; }
    onlineManager.leaveRoom();
    onRejected?.(friendName);
  });
}

export function showRejectionAlert(name) {
  const box = document.createElement("div");
  box.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:#1e1e2e;border:2px solid #f87171;border-radius:16px;
    padding:28px 36px;text-align:center;z-index:9999;box-shadow:0 8px 40px #0008;`;
  const msg = document.createElement("p");
  msg.style.cssText = "font-size:1.1rem;margin-bottom:16px;";
  msg.textContent = `😔 ${name || "اللاعب"} رفض الدعوة`;
  const ok = document.createElement("button");
  ok.style.cssText = "background:#7c6af7;color:#fff;border:none;padding:9px 22px;border-radius:8px;cursor:pointer;";
  ok.textContent = "حسناً";
  ok.addEventListener("click", () => box.remove());
  box.append(msg, ok);
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 5000);
}
