// 📄 invite.js — v12.2
// نظام دعوة الأصدقاء للعب

import { getDatabase, ref, set, onValue, update, remove }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getApps, initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getCurrentUser } from "./auth.js?v=1780700122";

const firebaseConfig = {
  apiKey:            "AIzaSyDnPrPobXSL8vc7Cr_AAVO6K03sc7gAgWA",
  authDomain:        "jazma-e17c5.firebaseapp.com",
  databaseURL:       "https://jazma-e17c5-default-rtdb.firebaseio.com",
  projectId:         "jazma-e17c5",
  storageBucket:     "jazma-e17c5.firebasestorage.app",
  messagingSenderId: "924710370216",
  appId:             "1:924710370216:web:99d697db3cfca06492fb9d",
};
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ─── إرسال دعوة لعب ──────────────────────────────────────────
export async function sendGameInvite(toUid, roomCode, cfg) {
  const from = getCurrentUser();
  if (!from) return;
  await set(ref(db, `invites/${toUid}`), {
    fromUid:  from.uid,
    fromName: from.displayName || "لاعب",
    roomCode: roomCode,
    cfg:      { rows: cfg.rows, cols: cfg.cols },
    sentAt:   Date.now(),
  });
}

// ─── الاستماع للدعوات الواردة ─────────────────────────────────
export function listenForInvites(cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  const unsub = onValue(ref(db, `invites/${myUid}`), (snap) => {
    if (snap.exists()) cb(snap.val());
    else cb(null);
  });
  return unsub;
}

// ─── إرسال إشعار رفض الدعوة ──────────────────────────────────
export async function rejectInvite(invite) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  // أرسل إشعار رفض لصاحب الدعوة
  await set(ref(db, `inviteRejections/${invite.fromUid}`), {
    rejectedBy: myUid,
    name: getCurrentUser()?.displayName || "لاعب",
    ts: Date.now(),
  });
  await clearInvite();
}

// ─── الاستماع لرفض الدعوة ────────────────────────────────────
export function listenForInviteRejection(cb) {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return () => {};
  const unsub = onValue(ref(db, `inviteRejections/${myUid}`), async (snap) => {
    if (snap.exists()) {
      cb(snap.val());
      await remove(ref(db, `inviteRejections/${myUid}`));
    }
  });
  return unsub;
}

// ─── حذف الدعوة بعد القبول ───────────────────────────────────
export async function clearInvite() {
  const myUid = getCurrentUser()?.uid;
  if (!myUid) return;
  await remove(ref(db, `invites/${myUid}`));
}
