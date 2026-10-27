// 📄 invite.js — v35.9 (الخطوة 1.8)
// طبقة البيانات لدعوات اللعب بين الأصدقاء (المنطق والواجهة في ui/inviteUI.js)
//
//   invites/<toUid>            دعوة واحدة معلّقة للمستلم: { fromUid, fromName, roomCode, cfg, sentAt }
//   inviteRejections/<fromUid> ردّ على دعوة صاحبها: { rejectedBy, name, ts, roomCode, reason }
//     reason: "rejected" (رفضها) | "playing" (في مباراة الآن — ردّ تلقائي)
//     (نسخ أقدم تكتب الرفض بلا roomCode ولا reason)
//
// الحذف المشروط بمعاملة: لا نمسح دعوة أو ردّاً غير الذي نقصده (دعوة أحدث حلّت مكانها مثلاً).
// ذاكرة محلية باردة تعطي null: نرجع null (لا يُلغي) — الخادم يرفضها إن كانت القيمة موجودة فتُعاد
// المعاملة بقيمتها الحقيقية (إرجاع undefined على null بارد يُنهيها دون سؤال الخادم).

import { getDatabase, ref, set, onValue, remove, runTransaction }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getApps, initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getCurrentUser } from "./auth.js?v=1793139376";

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

const myUid = () => getCurrentUser()?.uid || null;
const quiet = p => { try { Promise.resolve(p).catch(() => {}); } catch {} };

// حذف عقدة فقط إن كانت ما زالت "هي" (match)، بمعاملة. لا تُنتظر (بلا شبكة تكمل وحدها لاحقاً)
function removeIf(path, match) {
  try {
    return runTransaction(ref(db, path), (cur) => {
      if (cur === null) return null;
      return match(cur) ? null : undefined;
    }, { applyLocally: false }).catch(() => null);
  } catch { return Promise.resolve(null); }
}

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

// ─── الاستماع للدعوات الواردة (cb(invite | null)) ─────────────
export function listenForInvites(cb) {
  const uid = myUid();
  if (!uid) return () => {};
  return onValue(ref(db, `invites/${uid}`), (snap) => cb(snap.exists() ? snap.val() : null));
}

// ─── متابعة غرفة دعوة (المستلم: هل ما زال صاحبها ينتظر فيها؟ / صاحبها: هل عادت بعد انقطاع؟) ──
export function watchInviteRoom(code, cb) {
  if (!code) { cb(null); return () => {}; }
  return onValue(ref(db, `rooms/${code}`), (snap) => cb(snap.exists() ? snap.val() : null));
}

// ─── الردّ على دعوة (رفض، أو "في مباراة") ثم مسحها من خانتي ────
// الردّ يحمل رمز الغرفة: صاحب الدعوة لا يعمل به إلا لدعوته القائمة في تلك الغرفة
export function replyToInvite(invite, reason = "rejected") {
  const me = getCurrentUser();
  if (!me?.uid || !invite?.fromUid) return;
  quiet(set(ref(db, `inviteRejections/${invite.fromUid}`), {
    rejectedBy: me.uid,
    name:       me.displayName || "لاعب",
    ts:         Date.now(),
    roomCode:   invite.roomCode || "",
    reason,
  }));
  clearInviteIf(invite);
}

// ─── الاستماع للردود على دعواتي (cb(reply | null)) ────────────
export function listenForInviteReplies(cb) {
  const uid = myUid();
  if (!uid) return () => {};
  return onValue(ref(db, `inviteRejections/${uid}`), (snap) => cb(snap.exists() ? snap.val() : null));
}

// ─── مسح ردّ عالجناه (أو قديم لا يخصّ دعوتنا الحالية) — هو نفسه فقط ──
export function removeInviteReply(reply) {
  const uid = myUid();
  if (!uid || !reply) return Promise.resolve(null);
  return removeIf(`inviteRejections/${uid}`, cur =>
    cur.ts === reply.ts && (cur.roomCode || "") === (reply.roomCode || "") && cur.rejectedBy === reply.rejectedBy);
}

// ─── مسح كل الردود القديمة قبل دعوة جديدة (لا ردّ بلا رمز غرفة من دعوة سابقة يُقرأ لها) ──
export function clearMyInviteReplies() {
  const uid = myUid();
  if (!uid) return Promise.resolve();
  return remove(ref(db, `inviteRejections/${uid}`)).catch(() => {});
}

// ─── مسح دعوة من خانتي — هي نفسها فقط (لا دعوة أحدث حلّت مكانها) ──
export function clearInviteIf(invite) {
  const uid = myUid();
  if (!uid || !invite) return Promise.resolve(null);
  return removeIf(`invites/${uid}`, cur =>
    cur.fromUid === invite.fromUid && cur.roomCode === invite.roomCode && cur.sentAt === invite.sentAt);
}

// ─── صاحب الدعوة يسحبها من خانة صديقه (ألغاها/انتهت مهلتها/رُفضت) — دعوته هو لتلك الغرفة فقط ──
// (أفضل جهد: إن تعذّر، يكتشف المستلم ذلك من غرفتها التي لم تعد تنتظر)
export function withdrawInvite(toUid, roomCode, fromUid = null) {
  const uid = fromUid || myUid();      // هوية صاحبها كما أرسلها (قد يكون سجّل خروجه للتوّ)
  if (!uid || !toUid || !roomCode) return Promise.resolve(null);
  return removeIf(`invites/${toUid}`, cur => cur.fromUid === uid && cur.roomCode === roomCode);
}
