// 📄 presence.js
// نظام الحضور: يحدّث حالة المستخدم على Firebase ويقرأ حالات الآخرين
// الحالات: online (متصل) | playing (في مباراة) | away (انقطاع مؤقت) | offline (غير متصل)
//
// v36.1 (الخطوة 1.14): الحالة تصحّح نفسها. كانت الصفحة تكتب حالتها عند تغيّرها فقط، فإن صارت القيمة في القاعدة
// غير ما تعرضه الصفحة (أمر انقطاع قديم نفّذه الخادم بعد عودة الاتصال، أو صفحة/جهاز آخر بالحساب نفسه كتب فوقها،
// أو كتابة رُفضت) بقيت خاطئة حتى التغيّر التالي — في فحص v36.0 ظهر "أ" متصلاً وهو في مباراة. الآن الصفحة تتابع
// حالتها كما في القاعدة وتعيد كتابتها بعد مهلة قصيرة إن خالفت الواقع، بتباعد متزايد (لا عاصفة كتابات).
// وسجل تشخيص لآخر الأحداث يُطلب من الـconsole: JAZAM_PRESENCE()
import { getDatabase, ref, onValue, onDisconnect, update, serverTimestamp }
                            from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getCurrentUser, onUserChange } from "./auth.js?v=1792711190";

const db = getDatabase();

let _myUid = null;
let _myState = "online";
let _connUnsub = null;
let _selfUnsub = null;       // متابعة حالتي كما في القاعدة (v36.1)
let _connected = false;      // .info/connected — لا تصحيح بلا اتصال (والكتابة تنتظر العودة أصلاً)
let _server;                 // آخر قيمة لحالتي في القاعدة: undefined = لم تصل بعد، null = لا شيء
const _watchers = new Set(); // دوال إيقاف متابعات حضور الآخرين القائمة (v36.0)

// معرّف هذه الصفحة (عشوائي، لا علاقة له بالحساب): يميّز ما كتبته هي عمّا كتبته صفحة أو جهاز آخر بالحساب نفسه.
// يُكتب مع الحالة التي كُتب بها (by = "<الصفحة>:<الحالة>"): نسخة أقدم من اللعبة تغيّر state وحدها وتترك by كما هو،
// فلو كان by الصفحةَ وحدها لظنّت هذه الصفحة أن "في مباراة" التي كتبتها النسخة الأقدم كتابةٌ قديمة لها فتمحوها
// (مراجعة v36.1) — بالحالة معه لا يطابق إلا ما كتبته هي فعلاً
const SESSION = Math.random().toString(36).slice(2, 10);
const _tag = (state) => `${SESSION}:${state}`;

// ── سجل التشخيص (v36.1): آخر الأحداث فقط، بلا معرّف حساب ولا اسم ولا إيميل ──
const DIAG_MAX = 100;
const _diag = [];
const _inflight = new Map();   // كتابات لم يؤكّدها الخادم بعد: رقمها ← وقت بدئها
let _writeSeq = 0;
let _healsTotal = 0;
function _log(ev, detail = "") {
  _diag.push({ t: Date.now(), ev, detail: String(detail) });
  if (_diag.length > DIAG_MAX) _diag.shift();
}
// للوحدات الأخرى: ما يفسّر قرار الحالة (نشاط اللاعب حين يتغيّر)
export function presenceNote(ev, detail) { _log(ev, detail); }

function _origin(v) {
  if (!v) return "";
  const by = typeof v.by === "string" ? v.by : "";
  if (by === _tag(v.state)) return "هذه الصفحة";
  if (by && by.endsWith(":" + v.state) && !by.startsWith(SESSION + ":")) return "صفحة أخرى بحسابك";
  return "نسخة أقدم من اللعبة";
}
function _describe(v) {
  if (v === undefined) return "لم تصل بعد";
  if (!v || typeof v.state !== "string") return "لا شيء";
  return `${v.state} (${_origin(v)})`;
}

// ── تسجيل حضورنا ومتابعة الاتصال ────────────────────────────
// مهم: نربط التسجيل بتغيّر حالة الدخول — استدعاء واحد عند التشغيل يفشل
// لأن currentUser تكون null قبل اكتمال المصادقة
export function initPresence() {
  try { (typeof window !== "undefined" ? window : globalThis).JAZAM_PRESENCE = printPresenceReport; } catch {}
  // نسجّل فوراً إن كان المستخدم جاهزاً
  const now = getCurrentUser();
  if (now?.uid) _startFor(now.uid);
  // ونتابع أي تغيّر لاحق (دخول/خروج/ترقية حساب ضيف)
  onUserChange((user) => {
    if (user?.uid) _startFor(user.uid);
    else {
      if (_myUid) _log("stop", "خروج من الحساب");
      _stop();
      _myUid = null;
      unwatchAllPresence();      // لا متابعات لحساب خرج (والصفحة تُعاد بعدها أصلاً — v36.0، 1.11)
    }
  });
}

function _stop() {
  if (_connUnsub) { try { _connUnsub(); } catch {} _connUnsub = null; }
  if (_selfUnsub) { try { _selfUnsub(); } catch {} _selfUnsub = null; }
  _clearHeal();
  _connected = false;
  _server = undefined;
}

function _startFor(uid) {
  if (_myUid === uid && _connUnsub) return; // مسجَّل بالفعل لنفس المستخدم
  _stop();
  _myUid = uid;
  _heals = 0; _lastHealAt = 0;
  _log("start", `الحالة ${_myState}`);

  const myRef = ref(db, `users/${uid}/presence`);
  const connRef = ref(db, ".info/connected");

  // حالتي كما في القاعدة — ما يراه الأصدقاء فعلاً
  _selfUnsub = onValue(myRef, (snap) => {
    if (_myUid !== uid) return;
    const v = snap.val();
    const before = _describe(_server);
    _server = v;
    if (_describe(v) !== before) _log("db", _describe(v));
    _scheduleHeal();
  }, (err) => { _log("fail", `متابعة حالتي: ${err?.code || err?.message || err}`); });

  _connUnsub = onValue(connRef, (snap) => {
    if (_myUid !== uid) return;
    const c = snap.val() === true;
    if (c !== _connected) _log("conn", c ? "متصل" : "انقطع");
    _connected = c;
    if (!c) { _clearHeal(); return; } // غير متصل — Firebase سيكتب offline عبر onDisconnect
    // درس v29.8: onDisconnect يُستهلك بعد انطلاقه → نعيد تسجيله عند كل عودة اتصال
    onDisconnect(myRef).update({ state: "offline", lastSeen: serverTimestamp(), by: _tag("offline") })
      .catch((e) => _log("fail", `أمر الانقطاع: ${e?.code || e?.message || e}`));
    _write("اتصال");
  });
}

// كتابة حالتي الحالية (مع معرّف الصفحة)
function _write(why) {
  if (!_myUid) return;
  const state = _myState, t0 = Date.now(), id = ++_writeSeq;
  _inflight.set(id, t0);
  _log("write", `${state} (${why})`);
  update(ref(db, `users/${_myUid}/presence`), { state, lastSeen: serverTimestamp(), by: _tag(state) })
    .then(() => {
      const ms = Date.now() - t0;
      if (ms > 3000) _log("slow", `${state} أكّده الخادم بعد ${(ms / 1000).toFixed(1)}ث`);
    })
    .catch((e) => {
      _log("fail", `${state} (${why}): ${e?.code || e?.message || e}`);
      _scheduleHeal();         // رُفضت: محاولة لاحقة بالتباعد نفسه (القاعدة ما زالت على القديم)
    })
    .finally(() => _inflight.delete(id));
}

// تغيير حالتنا (مثلاً عند دخول مباراة أو الخروج منها)
// بلا تغيير = بلا كتابة (v35.9): مزامنة الحضور مع المباراة تستدعيها كل ثانية. وعودة الاتصال يعيد
// مستمع .info/connected أعلاه كتابة الحالة الحالية دائماً، وما يخالفها في القاعدة يصحَّح (v36.1)
// why (اختياري): سبب التغيير لسجل التشخيص
export function setMyPresence(state, why = "") {
  const next = state || "online";
  if (next === _myState) return;
  _log("set", `${_myState} → ${next}${why ? ` (${why})` : ""}${_myUid ? "" : " — قبل الدخول"}`);
  _myState = next;
  if (!_myUid) return;
  _write("تغيّر");
}

// ── التصحيح الذاتي (v36.1) ───────────────────────────────────
// ترتيب الحالات حين تتنازع صفحتان بالحساب نفسه: الأعلى يبقى (في مباراة > متصل > انقطاع مؤقت > غير متصل)،
// فلا تتعاركان على القيمة — والأدنى لا يكتب فوق الأعلى إلا عند تغيّر حالته هو
const RANK = { offline: 0, away: 1, online: 2, playing: 3 };
const HEAL_MS = 1500;          // مهلة قبل التصحيح: كتابة في الطريق أو قيمة متأخرة تصل أولاً
const HEAL_MAX_MS = 60000;     // أقصى تباعد بين تصحيحات متتالية
const HEAL_QUIET_MS = 120000;  // بلا تصحيح دقيقتين → يعود سريعاً
let _healTimer = null, _heals = 0, _lastHealAt = 0;

function _needsHeal(v) {
  if (!v || typeof v.state !== "string") return true;          // مُسحت أو ناقصة
  if (v.state === _myState) return false;
  if (v.state === "offline") return true;                        // أمر انقطاع قديم نُفّذ بعد عودتنا، أو صفحة أخرى أُغلقت
  if (v.by === _tag(v.state)) return true;                       // كتابة لنا قديمة أو مرفوضة (كتراجع "في مباراة" ← "متصل")
  return (RANK[_myState] ?? 0) > (RANK[v.state] ?? 0);          // صفحة أخرى بحالة أدنى
}

function _scheduleHeal() {
  if (_healTimer || !_myUid || !_connected || _server === undefined || !_needsHeal(_server)) return;
  if (Date.now() - _lastHealAt > HEAL_QUIET_MS) _heals = 0;
  const delay = _heals === 0 ? HEAL_MS : Math.min(HEAL_MAX_MS, 5000 * 2 ** (_heals - 1));
  _healTimer = setTimeout(_heal, delay);
}

function _heal() {
  _healTimer = null;
  if (!_myUid || !_connected || _server === undefined || !_needsHeal(_server)) return;
  _heals++; _healsTotal++; _lastHealAt = Date.now();
  const was = _describe(_server);
  _log("heal", `في القاعدة ${was} → ${_myState} (#${_heals})`);
  try { console.info(`🟢 الحضور: صُحّحت حالتك في القاعدة (${was} → ${_myState})`); } catch {}
  _write("تصحيح");
}

function _clearHeal() {
  if (_healTimer) { clearTimeout(_healTimer); _healTimer = null; }
}

// ── تقرير التشخيص: JAZAM_PRESENCE() في الـconsole ─────────────
export function presenceReport() {
  const now = Date.now();
  const W = typeof window !== "undefined" ? window : globalThis;
  const two = n => String(n).padStart(2, "0");
  const clock = t => { const d = new Date(t); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };
  const oldest = _inflight.size ? Math.round((now - Math.min(..._inflight.values())) / 1000) : 0;
  const lines = [
    `🟢 الحضور — النسخة ${W.JAZAM_VERSION || "?"} — الصفحة ${SESSION} — ${clock(now)}`,
    `حالتي هنا: ${_myState} | في القاعدة: ${_describe(_server)} | الاتصال: ${_connected ? "متصل" : "منقطع"} | الحساب: ${_myUid ? "داخل" : "خارج"}`,
    `كتابات لم يؤكّدها الخادم: ${_inflight.size}${_inflight.size ? ` (أقدمها منذ ${oldest}ث)` : ""} | تصحيحات: ${_healsTotal}`,
    `آخر الأحداث (${_diag.length}):`,
    ..._diag.map(e => `${clock(e.t)}  ${e.ev.padEnd(8)} ${e.detail}`),
  ];
  return {
    text: lines.join("\n"),
    version: W.JAZAM_VERSION || null, session: SESSION, myState: _myState,
    db: _server === undefined ? undefined : (_server ? { state: _server.state ?? null, origin: _origin(_server) } : null),
    connected: _connected, signedIn: !!_myUid, pending: _inflight.size, pendingOldestSec: oldest,
    heals: _healsTotal, events: _diag.map(e => ({ ...e })),
  };
}
function printPresenceReport() {
  const r = presenceReport();
  try { console.log(r.text); } catch {}
  return "↑ انسخ النص أعلاه وأرسله";
}

// ── متابعة حضور مستخدم آخر ──────────────────────────────────
// v36.0 (الخطوة 1.11): كل استدعاء متابعةٌ مستقلة تُرجع دالة إيقافها (Firebase يجمع المستمعين على المسار
// نفسه داخلياً — طلب واحد للخادم). كانت: متابعة واحدة لكل صديق مهما تكرّر الطلب، فبطاقة الصديق الجديدة بعد
// إعادة رسم القائمة (إضافة/حذف صديق) لا تستلم شيئاً وتتجمّد على "غير متصل"، والقديمة المحذوفة تبقى تستلم.
export function watchPresence(uid, cb) {
  if (!uid || typeof cb !== "function") return () => {};
  let stopped = false;
  const unsub = onValue(ref(db, `users/${uid}/presence`), (snap) => {
    if (!stopped) cb(snap.val() || { state: "offline", lastSeen: null });
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    _watchers.delete(stop);
    try { unsub(); } catch {}
  };
  _watchers.add(stop);
  return stop;
}

export function unwatchAllPresence() {
  [..._watchers].forEach(stop => stop());
}

// مهلة اعتبار الانقطاع "مؤقتاً" — مطابقة لمهلة السماح داخل المباراة
const GRACE_MS = 10000;

// الحالة المعروضة: نستنتج "انقطاع مؤقت" محلياً بدل انتظار كتابة من جهاز مقطوع
// (عند الانقطاع الفعلي لا يستطيع الجهاز الكتابة، فـ onDisconnect يكتب offline مباشرة)
export function displayState(p) {
  const st = p?.state || "offline";
  if (st !== "offline") return st;
  const ls = p?.lastSeen;
  if (typeof ls === "number" && (Date.now() - ls) < GRACE_MS) return "away";
  return "offline";
}

// ── أدوات العرض ─────────────────────────────────────────────
export const PRESENCE_META = {
  online:  { dot: "🟢", label: "متصل" },
  playing: { dot: "🔵", label: "في مباراة" },
  away:    { dot: "🟡", label: "انقطاع مؤقت" },
  offline: { dot: "⚫", label: "غير متصل" },
};

// نص "آخر ظهور" بصيغة مفهومة
export function lastSeenText(ts) {
  if (typeof ts !== "number") return "";
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1)  return "الآن";
  if (min < 60) return `قبل ${min} دقيقة`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `قبل ${hr} ساعة`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "أمس";
  if (day < 7)   return `قبل ${day} أيام`;
  return "قبل فترة طويلة";
}
