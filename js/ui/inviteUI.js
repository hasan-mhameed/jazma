// 📄 ui/inviteUI.js — v35.9 (الخطوة 1.8)
// دعوات اللعب بين الأصدقاء — كما في الألعاب العالمية:
//  • صاحب الدعوة: دعوة واحدة قائمة في كل مرة — غرفة تنتظر صديقه مدة INVITE_TTL_SEC. تنتهي بأول ما يحدث:
//    قبول (بدأت المباراة)، رفض، "في مباراة الآن" (ردّ تلقائي)، انتهاء المهلة، إلغاؤه هو (أو أي مغادرة لغرفتها)،
//    أو فشل الإرسال — ومع نهايتها يُفصل كل مستمع لها، تُسحب من خانة صديقه، ويرجع زر "دعوة".
//    الردّ لا يُعمل به إلا إن كان لغرفة الدعوة القائمة: ردّ متأخر على دعوة قديمة لا يمسّ مباراة لاحقة.
//  • المستلم: الدعوة تُعرض فقط ما دامت غرفتها تنتظر صاحبها، وتختفي إن ألغاها أو انتهت مهلتها.
//    وأثناء مباراة لا تقاطعه: ردّ تلقائي "في مباراة الآن" وتنبيه صغير. القبول من بحث أو غرفة تنتظر أو من
//    شاشة نتيجة يُنهي ما هو فيه بهدوء ثم ينضم؛ وقبول دعوة لم تعد متاحة يعرض رسالة واضحة.
// الواجهة الخارجية (الشاشات وبدء المباراة) يمرّرها main.js عبر initInvites(hooks).
import { sendGameInvite, listenForInvites, watchInviteRoom, replyToInvite, listenForInviteReplies,
         removeInviteReply, clearMyInviteReplies, clearInviteIf, withdrawInvite } from "../invite.js?v=1792488854";
import { onlineManager } from "../firebase.js?v=1792488854";
import { getCurrentUser } from "../auth.js?v=1792488854";

export const INVITE_TTL_SEC = 60;        // مهلة الرد على الدعوة (عند صاحبها: عدّ تنازلي في شاشة الانتظار)
const ROOM_GONE_GRACE_MS   = 10000;      // غرفة دعوة اختفت: انقطاع لحظي عند صاحبها؟ تعود كما كانت — ننتظرها قليلاً
const LEGACY_REPLY_SKEW_MS = 120000;     // ردّ من نسخة قديمة (بلا رمز غرفة): أقدم من دعوتنا بكثير = لدعوة سابقة

let _hooks = {};
let _seq = 0;
let _out = null;            // دعوتي الصادرة القائمة (جلسة)
let _in = null;             // الدعوة الواردة الحالية
let _boundUid = null, _inviteUnsub = null, _buttonsBound = false;
const _stateSubs = new Set();

const myUid  = () => getCurrentUser()?.uid || null;
const asName = (v, fb) => { const s = String(v ?? "").trim(); return s || fb; };
const el     = id => document.getElementById(id);
const quiet  = p => { try { Promise.resolve(p).catch(() => {}); } catch {} };

// ما يفعله اللاعب الآن (من main.js): "idle" | "waiting" (بحث/غرفة تنتظر) | "done" (نتيجة/مشاهدة) | "playing"
function activity() {
  try { return _hooks.activity?.() || "idle"; } catch { return "idle"; }
}

// ═══ حالة الدعوة الصادرة (لأزرار "دعوة" في قائمة الأصدقاء) ═══
export function outgoingInvite() {
  return _out ? { friendUid: _out.friendUid, friendName: _out.friendName, phase: _out.phase, code: _out.code } : null;
}
export function onInviteStateChange(cb) {
  _stateSubs.add(cb);
  return () => _stateSubs.delete(cb);
}
function emit() {
  const s = outgoingInvite();
  _stateSubs.forEach(cb => { try { cb(s); } catch {} });
}

// ═══ التهيئة (عند كل دخول — آمنة للتكرار) ═══
export function initInvites(hooks = {}) {
  _hooks = hooks || {};
  const uid = myUid();
  if (_boundUid !== uid) {
    try { _inviteUnsub?.(); } catch {}
    _inviteUnsub = null;
    if (_in) endIncoming(_in, "replaced");
    if (_out) endOut(_out, "left");
    _boundUid = uid;
    if (uid) _inviteUnsub = listenForInvites(inv => onIncoming(inv));
  }
  bindButtons();
}

// تسجيل الخروج: لا دعوة صادرة ولا واردة تبقى معلّقة بعده (تُلغى غرفة الانتظار بهدوء).
// يُستدعى **قبل** تسجيل الخروج (مراجعة v35.9): يرجع وعد الإلغاء والسحب — ينتظره الخروج (بحدّ أقصى)
// فيصلان والمستخدم ما زال داخلاً
export function resetInvites() {
  try { _inviteUnsub?.(); } catch {}
  _inviteUnsub = null;
  _boundUid = null;
  if (_in) endIncoming(_in, "replaced");
  return _out ? endOut(_out, "left") : Promise.resolve();
}

// ═══════════════════ الدعوة الصادرة ═══════════════════
// يرجع true إن أُرسلت الدعوة وبدأ الانتظار
export async function startInvite(friend) {
  if (!friend?.uid) return false;
  if (_out) {
    if (_out.friendUid !== friend.uid) toast(`⚠️ عندك دعوة قائمة لـ${_out.friendName} — ألغِها أولاً`);
    return false;
  }
  // صديقك دعاك قبل أن تدعوه ودعوته ظاهرة أمامك: ندخل دعوته بدل غرفة ثانية تنتظر كلٌّ منكما فيها الآخر
  if (_in && _in.shown && !_in.handled && _in.inv.fromUid === friend.uid) { onAcceptClick(); return false; }
  const act = activity();
  if (act === "playing") { toast("⚠️ لا يمكنك إرسال دعوة أثناء مباراة — أنهِها أولاً"); return false; }
  if (act === "busy")    { toast("⏳ انتظر لحظة ثم أعد المحاولة"); return false; }   // إنشاء/انضمام جارٍ
  const s = _out = {
    id: ++_seq, friendUid: friend.uid, friendName: asName(friend.name, "صديقك"),
    code: null, cfg: null, phase: "preparing", startedAt: Date.now(), deadline: 0, lastLeft: null,
    myUid: myUid(), unsubReplies: null, unsubRoom: null, tick: null, roomMissing: false,
  };
  emit();
  try {
    // في بحث أو غرفة تنتظر، أو على شاشة نتيجة: نُنهيه بهدوء أولاً (لا غرفتان معاً)
    if (act !== "idle") {
      const ok = await _hooks.goIdle?.(act);
      if (_out !== s) return false;
      if (!ok) { endOut(s, "blocked"); return false; }
    }
    quiet(clearMyInviteReplies());     // ردود قديمة لا تُقرأ لهذه الدعوة
    const cfg = _hooks.prepareInviterConfig?.() || { rows: 4, cols: 4 };
    s.cfg = { rows: cfg.rows, cols: cfg.cols };
    onlineManager.onOpponentJoined(oppName => {
      if (_out === s) endOut(s, "accepted");
      _hooks.onOpponentJoined?.(oppName, s.friendName, s.cfg);
    });
    const code = await onlineManager.createRoom(cfg, _hooks.myName?.() || "لاعب");
    // انتهت الجلسة أثناء الإنشاء (تسجيل خروج): لا نُبقي غرفة لا يراها أحد ولا يدخلها أحد
    if (_out !== s) { if (onlineManager.roomCode === code) quiet(onlineManager.leaveRoom()); return false; }
    s.code = code;
    // بعد كل انتظار: ما زلنا في غرفة الدعوة؟ (مراجعة v35.9) — قبول دعوة أخرى أثناء التجهيز يُلغيها بهدوء،
    // وكانت شاشة انتظار هذه الدعوة تظهر فوق المباراة الجديدة (وزر إلغائها يغادر تلك المباراة = انسحاب)
    if (onlineManager.roomCode !== code) { endOut(s, "left"); return false; }
    await sendGameInvite(s.friendUid, code, s.cfg);
    if (_out !== s) {
      if (onlineManager.roomCode === code) quiet(onlineManager.leaveRoom());
      quiet(withdrawInvite(s.friendUid, code, s.myUid));
      return false;
    }
    if (onlineManager.roomCode !== code) { endOut(s, "left"); return false; }
    s.phase = "waiting";
    s.deadline = Date.now() + INVITE_TTL_SEC * 1000;
    s.unsubReplies = listenForInviteReplies(r => onReply(s, r));
    s.unsubRoom = watchInviteRoom(code, room => onOwnRoom(s, room));
    s.tick = setInterval(() => tickOut(s), 500);
    emit();
    _hooks.onWaiting?.(code, s.friendName, INVITE_TTL_SEC);
    return true;
  } catch (e) {
    // فشل إنشاء الغرفة نفسه: كنا أحراراً قبله، فأي غرفة مسجّلة الآن هي محاولتنا الفاشلة — لا نبقى "فيها"
    if (_out === s && !s.code && onlineManager.roomCode) quiet(onlineManager.leaveRoom({ announce: false }));
    if (_out === s) endOut(s, "failed");
    return false;
  }
}

// كل نصف ثانية: هل غادرنا غرفة الدعوة (زر الإلغاء أو أي مغادرة)؟ هل انتهت المهلة؟ + العدّ التنازلي
function tickOut(s) {
  if (_out !== s) return;
  if (onlineManager.roomCode !== s.code) { endOut(s, "left"); return; }
  // ترك شاشة الانتظار إلى لعبة أخرى (تحدي اليوم من القائمة — مراجعة v35.9): تُلغى الدعوة بهدوء، وإلا
  // قبولها يبدأ مباراة بلوحة غير لوحته
  if (activity() !== "waiting") { endOut(s, "abandoned"); return; }
  const left = Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000));
  if (left <= 0) { endOut(s, "expired"); return; }
  if (left !== s.lastLeft) { s.lastLeft = left; _hooks.onWaitTick?.(left, s.friendName); }
}

// ردّ وصل على inviteRejections/<أنا>: يُعمل به فقط إن كان لدعوتنا القائمة (رمز غرفتها)
function onReply(s, r) {
  if (_out !== s || !r || typeof r !== "object") return;
  const forThis = r.roomCode
    ? r.roomCode === s.code
    // نسخة قديمة عند الصديق (ردّ بلا رمز غرفة): نقبله من صديقنا المدعوّ إن لم يكن أقدم من دعوتنا بوضوح
    : (r.rejectedBy === s.friendUid && !(typeof r.ts === "number" && r.ts < s.startedAt - LEGACY_REPLY_SKEW_MS));
  if (!forThis) { quiet(removeInviteReply(r)); return; }      // ردّ على دعوة سابقة: يُمسح بلا أثر
  endOut(s, r.reason === "playing" ? "playing" : "rejected", r);
}

// غرفتنا اختفت بانقطاع لحظي ثم أعادها firebase.js كما كانت: صديقنا ربما مسح دعوتنا حين اختفت — نعيد إرسالها
function onOwnRoom(s, room) {
  if (_out !== s) return;
  if (!room) { s.roomMissing = true; return; }
  if (!s.roomMissing) return;
  if (room.status === "waiting" && !room.p2uid && room.p1uid === myUid()) {
    s.roomMissing = false;
    quiet(sendGameInvite(s.friendUid, s.code, s.cfg));
  }
}

// نهاية الدعوة الصادرة — مرة واحدة، أياً كان سببها
function endOut(s, reason, reply = null) {
  if (_out !== s) return;
  _out = null;
  if (s.tick) clearInterval(s.tick);
  try { s.unsubReplies?.(); } catch {}
  try { s.unsubRoom?.(); } catch {}
  if (reply) quiet(removeInviteReply(reply));
  const hosting = !!s.code && onlineManager.roomCode === s.code;
  // لم نعد في غرفة الدعوة (ألغيناها، أو قبلنا دعوة غيرنا): لا رسالة ولا شاشة — نحن من غادر
  if (reason !== "accepted" && s.code && !hosting) reason = "left";
  const tasks = [];
  if (reason !== "accepted" && hosting) {
    tasks.push(Promise.resolve(onlineManager.leaveRoom()).catch(() => {}));   // إلغاء ذرّي لغرفة تنتظر (v35.8)
  }
  if (reason !== "accepted" && s.code) tasks.push(Promise.resolve(withdrawInvite(s.friendUid, s.code, s.myUid)).catch(() => {}));
  const done = Promise.all(tasks);    // يُنتظر قبل تسجيل الخروج (بحدّ أقصى)
  emit();
  if (reason === "accepted" || reason === "left") return done;
  if (reason === "blocked")   { toast("⚠️ بدأت مباراتك — لم تُرسَل الدعوة"); return done; }
  if (reason === "abandoned") { _hooks.onInviteAbandoned?.(); toast(`📭 أُلغيت دعوتك لـ${s.friendName}`); return done; }
  _hooks.onInviteEnded?.(reason, s.friendName);
  return done;
}

// نص الرسالة لصاحب الدعوة عند نهايتها
export function inviteEndText(reason, name) {
  const n = asName(name, "صديقك");
  if (reason === "rejected") return `😔 ${n} رفض الدعوة`;
  if (reason === "playing")  return `🎮 ${n} في مباراة الآن — جرّب بعد قليل`;
  if (reason === "expired")  return `⌛ لم يردّ ${n} على الدعوة`;
  return "⚠️ تعذّر إرسال الدعوة — تحقّق من اتصالك وحاول مجدداً";
}

// ═══════════════════ الدعوة الواردة ═══════════════════
function roomValidFor(inv, room) {
  return !!room && typeof room === "object" && room.status === "waiting" && !room.p2uid
      && room.p1uid === inv.fromUid && room.multi !== true && !!room.cfg;
}

function onIncoming(inv) {
  const usable = !!inv && typeof inv === "object" && !!inv.fromUid && !!inv.roomCode && inv.fromUid !== myUid();
  const key = usable ? `${inv.fromUid}|${inv.roomCode}` : null;
  // نفس الدعوة (أعاد صاحبها إرسالها بعد انقطاع لحظي): نحدّث نسختها فقط
  if (_in && key && _in.key === key) { _in.inv = inv; return; }
  if (_in) endIncoming(_in, inv ? "replaced" : "withdrawn");
  if (!inv) return;
  if (!usable) { quiet(clearInviteIf(inv)); return; }       // بقايا تالفة لا تُعرض
  const cur = _in = {
    key, inv, room: undefined, shown: false, everShown: false, handled: false,
    goneTimer: null, unsubRoom: null, tick: null,
  };
  cur.unsubRoom = watchInviteRoom(inv.roomCode, room => onInviteRoom(cur, room));
  cur.tick = setInterval(() => evaluateIncoming(cur), 1000);
}

function onInviteRoom(cur, room) {
  if (_in !== cur) return;
  cur.room = room;
  if (cur.handled) return;
  if (roomValidFor(cur.inv, room)) {
    if (cur.goneTimer) { clearTimeout(cur.goneTimer); cur.goneTimer = null; }
    evaluateIncoming(cur);
    return;
  }
  hidePopup(cur);
  // الغرفة موجودة لكنها لم تعد تنتظر صاحب الدعوة: انتهت الدعوة
  if (room) { endIncoming(cur, "gone"); return; }
  // اختفت: انقطاع لحظي عند صاحبها (تعود كما كانت وتعود الدعوة)، أو ألغاها/أغلق صفحته — ننتظر قليلاً
  if (!cur.goneTimer) {
    cur.goneTimer = setTimeout(() => {
      cur.goneTimer = null;
      if (_in === cur && !cur.handled && !roomValidFor(cur.inv, cur.room)) endIncoming(cur, "gone");
    }, ROOM_GONE_GRACE_MS);
  }
}

// تُعرض الدعوة فقط وغرفتها تنتظر — وأثناء مباراة: ردّ تلقائي بدل المقاطعة (يُعاد التقييم كل ثانية)
function evaluateIncoming(cur) {
  if (_in !== cur || cur.handled) return;
  if (!roomValidFor(cur.inv, cur.room)) { hidePopup(cur); return; }
  if (activity() === "playing") { busyReply(cur); return; }
  showPopup(cur);
}

function inviterName(inv) { return asName(inv?.fromName, "صديقك"); }

function showPopup(cur) {
  const txt = el("invite-text");
  if (txt) txt.textContent = `🎮 ${inviterName(cur.inv)} يدعوك للعب!`;
  const box = el("invite-notification");
  // فوق كل شيء — حتى شاشة نتيجة المباراة (9999) وقائمة التنقّل (10000): القبول متاح منها (v35.9)
  // (مضبوط هنا لا في CSS وحده: ملف الأنماط قد يبقى مخزّناً قديماً عند المتصفح)
  if (box) box.style.zIndex = "10050";
  box?.classList.remove("hidden");
  cur.shown = true;
  cur.everShown = true;
}
function hidePopup(cur) {
  if (!cur || !cur.shown) return;
  cur.shown = false;
  el("invite-notification")?.classList.add("hidden");
}

// في مباراة الآن: نخبر صاحب الدعوة فوراً (لا ينتظر المهلة كاملة) وننبّه اللاعب بلطف بلا مقاطعة
function busyReply(cur, note = true) {
  cur.handled = true;
  replyToInvite(cur.inv, "playing");
  endIncoming(cur, "busy");
  if (note) toast(`📩 ${inviterName(cur.inv)} دعاك للعب — أخبرناه أنك في مباراة`);
}

function endIncoming(cur, why) {
  if (!cur) return;
  if (_in === cur) _in = null;
  if (cur.tick) { clearInterval(cur.tick); cur.tick = null; }
  if (cur.goneTimer) { clearTimeout(cur.goneTimer); cur.goneTimer = null; }
  try { cur.unsubRoom?.(); } catch {}
  cur.unsubRoom = null;
  hidePopup(cur);
  if (cur.handled) return;            // أنهيناها نحن (قبول/رفض/ردّ تلقائي): مُسحت هناك ولا تنبيه
  cur.handled = true;
  if (why === "gone") quiet(clearInviteIf(cur.inv));
  if (cur.everShown && (why === "gone" || why === "withdrawn")) toast(`📭 انتهت دعوة ${inviterName(cur.inv)}`);
}

async function onAcceptClick() {
  const cur = _in;
  if (!cur || !cur.shown || cur.handled) return;
  cur.handled = true;
  hidePopup(cur);
  const inv = cur.inv;
  const act = activity();
  if (act === "playing") { busyReply(cur); return; }
  // طلب إنشاء/انضمام جارٍ لم تظهر شاشته بعد: لحظة — الدعوة تبقى ظاهرة ويُضغط "قبول" بعدها
  if (act === "busy") { cur.handled = false; showPopup(cur); toast("⏳ انتظر لحظة ثم اضغط قبول"); return; }
  if (act !== "idle") {
    // بحث/غرفة تنتظر، أو شاشة نتيجة/مشاهدة: نُنهيه بهدوء — وإن تحوّل لمباراة بنفس اللحظة لا نقاطعها
    const ok = await _hooks.goIdle?.(act);
    if (!ok) { busyReply(cur); return; }
  }
  _hooks.onJoining?.(inv);
  try {
    const roomData = await onlineManager.joinRoom(inv.roomCode, _hooks.myName?.() || "لاعب");
    endIncoming(cur, "accepted");
    quiet(clearInviteIf(cur.inv));      // أحدث نسخة منها (قد يكون صاحبها أعاد إرسالها أثناء القبول)
    _hooks.onJoined?.(roomData, inv);
  } catch (e) {
    const msg = String(e?.message || "");
    if (/انقطاع/.test(msg) && _in === cur) {
      // نتيجة الانضمام مجهولة (انقطاع): الدعوة تبقى، وتعود للظهور إن بقيت غرفتها تنتظر (يُعاد التقييم كل ثانية)
      cur.handled = false;
      _hooks.onJoinFailed?.(msg, inv);
      return;
    }
    endIncoming(cur, "accepted");
    quiet(clearInviteIf(cur.inv));
    _hooks.onJoinFailed?.(/انقطاع/.test(msg) ? msg : `⚠️ الدعوة لم تعد متاحة — ربما ألغاها ${inviterName(inv)}`, inv);
  }
}

function onRejectClick() {
  const cur = _in;
  if (!cur || cur.handled) { el("invite-notification")?.classList.add("hidden"); return; }
  cur.handled = true;
  replyToInvite(cur.inv, "rejected");
  endIncoming(cur, "rejected");
}

function bindButtons() {
  if (_buttonsBound) return;
  _buttonsBound = true;
  el("invite-accept-btn")?.addEventListener("click", () => onAcceptClick());
  el("invite-reject-btn")?.addEventListener("click", () => onRejectClick());
}

// ═══════════════════ رسائل ═══════════════════
// تنبيه صغير عابر (لا يحجب شيئاً)
function toast(text) {
  if (_hooks.toast) { try { _hooks.toast(text); return; } catch {} }
  const t = document.createElement("div");
  t.textContent = text;
  t.style.cssText = "position:fixed;top:70px;left:50%;transform:translateX(-50%);background:#1e293bee;color:#fff;"
    + "padding:10px 18px;border-radius:12px;z-index:10000;font-weight:700;font-size:0.95rem;max-width:90vw;"
    + "text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.4);direction:rtl";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// رسالة وسط الشاشة بزر "حسناً" (تختفي وحدها بعد 5 ثوانٍ)
export function showInviteAlert(text) {
  const box = document.createElement("div");
  box.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:#1e1e2e;border:2px solid #f87171;border-radius:16px;
    padding:28px 36px;text-align:center;z-index:9999;box-shadow:0 8px 40px #0008;`;
  const msg = document.createElement("p");
  msg.style.cssText = "font-size:1.1rem;margin-bottom:16px;";
  msg.textContent = text;
  const ok = document.createElement("button");
  ok.style.cssText = "background:#7c6af7;color:#fff;border:none;padding:9px 22px;border-radius:8px;cursor:pointer;";
  ok.textContent = "حسناً";
  ok.addEventListener("click", () => box.remove());
  box.append(msg, ok);
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 5000);
}
