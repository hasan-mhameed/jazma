// 📄 firebase.js — v11.8
import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, onDisconnect, remove, off, runTransaction, onChildAdded, push, serverTimestamp }
                            from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getCurrentUser }   from "./auth.js?v=1792364320";

const firebaseConfig = {
  apiKey:            "AIzaSyDnPrPobXSL8vc7Cr_AAVO6K03sc7gAgWA",
  authDomain:        "jazma-e17c5.firebaseapp.com",
  databaseURL:       "https://jazma-e17c5-default-rtdb.firebaseio.com",
  projectId:         "jazma-e17c5",
  storageBucket:     "jazma-e17c5.firebasestorage.app",
  messagingSenderId: "924710370216",
  appId:             "1:924710370216:web:99d697db3cfca06492fb9d",
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// عقدة غرفة بلا صاحب: لا إعدادات (cfg) ولا منشئ ثنائي (p1uid) ولا غرفة جماعية — بقايا كتبها أمر انقطاع شارد
// (أو كتابة متأخرة) بعد مسح الغرفة، مثل {status:"finished", dropped2:true} وحدها. كل غرفة حقيقية تُنشأ بإعداداتها
// كاملة (ثنائية وجماعية)، فلا تُعدّ بقايا أبداً. لا يدخلها أحد، ولا تخصّ أحداً (مراجعة v35.8 الرابعة)
function isOrphanRoomNode(room) {
  return !!room && typeof room === "object" && !room.cfg && !room.p1uid && !room.multi;
}

// ── تنظيف الغرف القديمة (أكثر من ساعة) ─────────────────────────
export async function cleanupOldRooms() {
  try {
    const snap = await get(ref(db, "rooms"));
    if (!snap.exists()) return;
    const now     = Date.now();
    const oneHour = 60 * 60 * 1000;
    const tasks   = [];
    snap.forEach(child => {
      const room = child.val();
      const age  = now - (room.createdAt || 0);
      // غرفة لوبي بلا لاعبين: بقايا انقطاع آخر من كان فيها — تُمسح فوراً
      const emptyLobby = room && room.multi === true && room.status === "lobby"
        && !Object.keys(room.players || {}).length;
      if (age > oneHour || room.status === "finished" || emptyLobby) {
        tasks.push(remove(ref(db, `rooms/${child.key}`)));
      }
    });
    await Promise.all(tasks);
  } catch { /* صامت */ }
}

export class OnlineManager {
  constructor() {
    this.roomCode  = null;
    this.playerNum = null;
    this._unsubs   = [];
    this._cbMove   = null;
    this._cbJoined = null;
    this._cbLeft   = null;
    this._gameStarted = false; // ✅ منع تشغيل اللعبة أكثر من مرة
    this._lastMoveKey = null;  // ✅ منع تطبيق نفس الحركة مرتين
    this._pendingMove = null;  // ✅ حركة وصلت قبل جاهزية المستقبِل (ثنائي)
    this._pendingMoves = [];   // ✅ طابور حركات معلّقة (جماعي — سجل كامل)
    this._lastBankSeq = null;  // ✅ منع تكرار تحديث البنك الفوري
    this._cbBankUpdate = null;
    this._serverOffset = 0;    // فرق توقيت الجهاز عن Firebase
    this._cbClock = null;      // مستمع الساعة المركزية
    this._lastClock = null;    // آخر حالة ساعة (تفادي فقدان الأولى)
    this._cbApproval = null;   // مستمع جولة الموافقة
    this._lastApproval = null;
    // ── حالة التعدد (3-4 لاعبين) ──
    this._isMulti     = false;
    this._cbLobby     = null;  // تحديث قائمة اللاعبين في اللوبي
    this._cbMultiStart= null;  // بدء المباراة المتعددة
    this._cbPlayerLeft= null;  // خروج لاعب (تعدد)
    this._leaving     = false; // انسحاب من مباراة جماعية جارٍ: لا كتابة على مقعدي حتى يُحسم (v35.7)
    this._leavePromise = null; // المغادرة الجارية (نقرة ثانية تنتظرها)
    this._rearmPending = false; // عدنا للاتصال ومقعدي لم يظهر بعد: التسليح مع أول لقطة تُظهره
    // ── الثنائي: البحث والانضمام الذرّي (v35.8 — الخطوة 1.3) ──
    this._duoSearchSeq = 0;     // رقم جلسة البحث العشوائي: الإلغاء (أو المغادرة) يُبطل بحثاً ما زال جارياً
    this._duoPublic   = false;  // غرفتي الثنائية عامة (بحث عشوائي) لا بالكود — لإعادة فتحها كما كانت
    this._reopeningCode = null; // إعادة فتح غرفتي جارية (منضمّ ألغى بحثه بلحظة انضمامه)
    this._duoHostData = null;   // بيانات إنشاء غرفتي المنتظرة — لإعادتها إن اختفت وأنا أنتظر فيها
    this._restoringCode = null; // إعادة غرفتي المختفية جارية
  }

  // ══ إنشاء غرفة ══════════════════════════════════════════════
  async createRoom(cfg, name) {
    const code = genCode();
    const leaveSeq = this._duoSearchSeq;   // كل مغادرة تزيده فوراً — نعرف به إن غادرنا أثناء الإنشاء (v35.9)
    this.roomCode  = code;
    this.playerNum = 1;
    this._gameStarted = false;
    this._duoPublic = false;
    this._lastRoom = null;          // لا لقطة من غرفة سابقة (تُقرأ لإبلاغ "انتهت" المبكر)

    // أمر المسح عند الانقطاع قبل الإنشاء (v35.8) — كما في البحث العشوائي: لا غرفة منتظرة بلا صاحب
    try { onDisconnect(ref(db, `rooms/${code}`)).remove().catch(() => {}); } catch {}
    this._duoHostData = {
      cfg:       { rows: cfg.rows, cols: cfg.cols },
      p1name:    name,
      p1uid:     getCurrentUser()?.uid || "",
    };
    await set(ref(db, `rooms/${code}`), {
      cfg:       { rows: cfg.rows, cols: cfg.cols },
      status:    "waiting",
      p1name:    name,
      p1uid:     getCurrentUser()?.uid || "",
      p2name:    "",
      p2uid:     "",
      createdAt: Date.now(),
      move:      { key: "", by: 0, seq: 0 },
    });
    // تُركت أثناء إنشائها (قبول دعوة صديق بنفس اللحظة — v35.9): ألغتها المغادرة ذرّياً، فلا مستمعين لها
    // (كانت تُسجَّل فوق الغرفة التالية وتُفصل معها فقط)
    if (this.roomCode !== code || this._duoSearchSeq !== leaveSeq) return code;
    // ونسلّحه مرة ثانية بعد الإنشاء (مراجعة v35.8): انقطاع لحظي والإنشاء في الطريق يستهلك الأمر الأول عند
    // الخادم (يمسح غرفة لم تُنشأ بعد)، ثم يُعاد إرسال الإنشاء بعد العودة فتبقى غرفة بلا أمر مسح. التكرار لا يضر.
    try { onDisconnect(ref(db, `rooms/${code}`)).remove().catch(() => {}); } catch {}

    this._listenForPlayer2(code);
    this._listenForMoves(code);
    this._listenBankUpdate(code);
    this._listenClock(code);
    this._watchServerOffset();
    this._listenForRestart(code);
    this._monitorConnection();
    this._listenSpectators(code);
    return code;
  }

  // ══ الانضمام ════════════════════════════════════════════════
  async joinRoom(code, name) {
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists())             throw new Error("الغرفة غير موجودة!");
    const room = snap.val();
    if (room.status !== "waiting")  throw new Error("الغرفة ممتلئة أو انتهت!");

    // ذرّياً (v35.8): لا ندخل إلا غرفة ما زالت تنتظر وحدها — منضمّان بنفس اللحظة: واحد فقط يدخل،
    // وغرفة ألغاها صاحبها للتوّ لا "تُبعث" بكتابتنا غرفةً شبحية بلا منشئ (كانت كتابة عمياء فوق ما قرأناه)
    const info = {};
    const joined = await this._joinDuoAtomic(code, name, getCurrentUser()?.uid || "", null, false, info);
    if (!joined) throw new Error(info.unknown ? "تعذّر الانضمام بسبب انقطاع الاتصال — حاول مجدداً" : "الغرفة ممتلئة أو انتهت!");

    this.roomCode  = code;
    this.playerNum = 2;
    this._gameStarted = false;
    this._lastRoom = null;

    // الانقطاع ينهي المباراة ويسجّل من انقطع (droppedN) في كتابة واحدة ذرّية —
    // فيعرف الطرف الآخر أنه فاز، ويعرف المنقطع (لو عاد) أنه هو من خرج (v35.6)
    this._armDuoDisconnect(code);
    this._listenForMoves(code);
    this._listenBankUpdate(code);
    this._listenClock(code);
    this._watchServerOffset();
    this._listenForOpponentLeave(code);
    this._listenForRestart(code);
    this._monitorConnection();
    this._listenSpectators(code);
    return { cfg: joined.cfg, p1name: joined.p1name, p1uid: joined.p1uid };
  }

  // ══ مطابقة عشوائية (زي السنوكر) ═══════════════════════════════
  // تبحث عن خصم ينتظر؛ إن وُجد تنضم إليه، وإلا تنشئ غرفة عامة وتنتظر.
  // v35.8 (الخطوة 1.3): الانضمام بمعاملة ذرّية — منضمّان بنفس اللحظة لنفس المنتظر: واحد يدخل والآخر يجرّب
  // غيره أو ينشئ غرفته (كانا يدخلان معاً: كتابة عمياء، والمنتظر يرى خصماً واحداً). والبحث جلسة يُبطلها الإلغاء:
  // ضغط "إلغاء" أثناء البحث نفسه (قبل أن يكتمل) لا ينتهي بغرفة منتظرة ولا بمباراة لمن ألغى.
  // يرجع { role: "guest" | "host" | "cancelled" }
  async findRandomMatch(cfg, name) {
    const seq = ++this._duoSearchSeq;
    const alive = () => seq === this._duoSearchSeq;
    const myUid = getCurrentUser()?.uid || "";
    // الغرف العامة المنتظرة بنفس الحجم، الأقدم أولاً (أطولهم انتظاراً أحقّهم)
    let candidates = [];
    try {
      const snap = await get(ref(db, "rooms"));
      if (snap.exists()) {
        candidates = Object.entries(snap.val() || {})
          .filter(([, room]) => this._duoJoinable(room, myUid, cfg.rows, true))
          .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0))
          .map(([code]) => code);
      }
    } catch {}
    if (!alive()) return { role: "cancelled" };

    for (const joinCode of candidates.slice(0, 5)) {
      const joined = await this._joinDuoAtomic(joinCode, name, myUid, cfg.rows, true);
      if (!alive()) {
        // ألغينا البحث والمعاملة في الطريق فاعتُمد انضمامنا: نلغي المباراة قبل بدئها (لا تُحسب لأحد) —
        // لا نتركه يلعب وحده أمام خصم ألغى (المنتظر يعيد فتح غرفته إن لم يكن بدأ)
        if (joined) this._abortDuoMatch(joinCode, 2, myUid);
        return { role: "cancelled" };
      }
      if (!joined) continue;          // سبقنا غيرنا إليها، أو أُلغيت، أو تغيّرت — التالية
      this.roomCode  = joinCode;
      this.playerNum = 2;
      this._gameStarted = false;
      this._duoPublic = false;
      this._lastRoom = null;
      // انقطاع = إنهاء + تسجيل من انقطع (ذرّياً) — انظر joinRoom
      this._armDuoDisconnect(joinCode);
      this._listenForMoves(joinCode);
      this._listenBankUpdate(joinCode);
      this._listenClock(joinCode);
      this._watchServerOffset();
      this._listenForOpponentLeave(joinCode);
      this._listenForRestart(joinCode);
      this._monitorConnection();
      this._listenSpectators(joinCode);
      return { role: "guest", code: joinCode, cfg: joined.cfg,
               p1name: joined.p1name, p1uid: joined.p1uid };
    }

    // لا يوجد خصم — ننشئ غرفة عامة وننتظر
    const code = genCode();
    this.roomCode  = code;
    this.playerNum = 1;
    this._gameStarted = false;
    this._duoPublic = true;
    this._lastRoom = null;
    // أمر المسح عند الانقطاع **قبل** إنشاء الغرفة (v35.8): الخادم ينفّذ طلبات الاتصال بترتيبها — فلو أُغلقت الصفحة
    // بعد وصول الإنشاء لا تبقى غرفة منتظرة بلا صاحب (كان يُسجَّل بعده، فتضيع لحظة بينهما يدخلها باحث ويعلق)
    try { onDisconnect(ref(db, `rooms/${code}`)).remove().catch(() => {}); } catch {}
    this._duoHostData = { cfg: { rows: cfg.rows, cols: cfg.cols }, public: true, p1name: name, p1uid: myUid };
    await set(ref(db, `rooms/${code}`), {
      cfg:       { rows: cfg.rows, cols: cfg.cols },
      status:    "waiting",
      public:    true,           // غرفة مطابقة عشوائية
      p1name:    name,
      p1uid:     myUid,
      p2name:    "", p2uid: "",
      createdAt: Date.now(),
      move:      { key: "", by: 0, seq: 0 },
    });
    // أُلغي البحث أثناء الإنشاء: الإلغاء رأى الغرفة (roomCode ضُبط قبل الكتابة) وحذفها ذرّياً بعد وصولها
    // (وأمر انقطاعها يبقى مسلّحاً حتى يُحسم الحذف) — لا مستمعين لغرفة لم تعد لنا
    if (!alive()) return { role: "cancelled" };
    // ونسلّح أمر المسح مرة ثانية بعد الإنشاء (مراجعة v35.8): انقطاع لحظي والإنشاء في الطريق يستهلك الأمر الأول
    // عند الخادم، ثم يُعاد إرسال الإنشاء بعد العودة فتبقى غرفة بلا أمر مسح. التكرار لا يضر.
    try { onDisconnect(ref(db, `rooms/${code}`)).remove().catch(() => {}); } catch {}
    this._listenForPlayer2(code);
    this._listenForMoves(code);
    this._listenBankUpdate(code);
    this._listenClock(code);
    this._watchServerOffset();
    this._listenForOpponentLeave(code);
    this._listenForRestart(code);
    this._monitorConnection();
    this._listenSpectators(code);
    return { role: "host", code };
  }

  // إلغاء انتظار المطابقة العشوائية (v35.8: ذرّي، ولا يسحب من ألغى لمباراة)
  // الترتيب هو الحل، وكله في اللحظة نفسها بلا أي انتظار: (1) نُبطل البحث الجاري، (2) نبدأ معاملة الغرفة
  // والمستمعون ما زالوا متصلين — ذاكرتها دافئة فتُعتمد من أول رحلة (بعد فصلهم كانت تبدأ بذاكرة باردة فتحتاج
  // رحلتين، وإغلاق الصفحة بينهما ترك غرفة "تنتظر" بلا صاحب — مراجعة v35.8): تنتظر وحدها → تُحذف؛ سبقنا منضمّ
  // بلحظة → تُلغى مباراته قبل بدئها (لا تُحسب)، (3) نفصل كل المستمعين — فلا لقطة "انضمّ خصم" تصل بعد الضغط
  // تبدأ لنا مباراة. لا ننتظر المعاملة: بلا شبكة كانت ستعلّق زر الإلغاء (تكمل وحدها وتُعاد إن ضاع ردّها،
  // وأمر المسح عند الانقطاع يبقى مسلّحاً حتى تُحسم — إغلاق الصفحة قبلها يحذف الغرفة عند الخادم)
  async cancelRandomMatch() {
    this._duoSearchSeq++;
    // بدأت المباراة فعلاً (نقرة متأخرة)، أو انضممنا كخصم: لا "إلغاء" لمباراة قائمة — الخروج منها انسحاب.
    // (والغرف الجماعية لها مسارها: leaveRoom — هذا للبحث الثنائي وحده)
    if (this._gameStarted || this.playerNum === 2 || this._isMulti) return;
    const code = this.roomCode, wasHost = this.playerNum === 1;
    if (code && wasHost) this._cancelDuoHosting(code);
    this._unsubs.forEach(u => u());
    this._unsubs = [];
    this._lastRoom = null;
    this._cbJoined = null;
    this.roomCode = null; this.playerNum = null;
  }

  // ── أدوات الانضمام والإلغاء الذرّيين للثنائي (v35.8) ──
  // غرفة ثنائية يمكن دخولها الآن: تنتظر، بلا خصم، لها منشئ وإعدادات (غرفة شبحية بلا منشئ لا تُدخل)
  // rows: حجم مطلوب (null = أي حجم، للغرفة بالكود)، publicOnly: العشوائي لا يدخل غرف الأكواد ولا غرفه هو
  _duoJoinable(room, myUid, rows, publicOnly) {
    if (!room || typeof room !== "object" || room.multi === true) return false;
    if (room.status !== "waiting" || room.p2uid || !room.cfg || room.p1name == null) return false;
    if (rows != null && Number(room.cfg.rows) !== Number(rows)) return false;
    if (publicOnly && (room.public !== true || room.p1uid === myUid)) return false;
    return true;
  }
  // يرجع الغرفة كما اعتمدها الخادم بعد انضمامنا، أو null (سبقنا غيرنا / أُلغيت / لا تصلح).
  // مراجعة v35.8: رفضُ المعاملة لا يعني أننا لم ننضم — انقطاع بعد إرسالها يُسقط ردّها وقد اعتمدها الخادم،
  // فيبدأ المنتظر مباراة أمام خصم يظن أنه لم ينضم (ينتظر بنك وقته كاملاً، أو يخسر إن خرج). النتيجة إذن
  // غير معروفة: لا نبني عليها مباراة (قد نعود بعد دقائق لمباراة انتهت)، ونلغيها قبل بدئها إن كانت اعتُمدت
  // (abortedBy: 2 — تُعاد المحاولة بعد عودة الاتصال): المنتظر يعيد فتح غرفته، أو يرى "ألغى الخصم… لم تُحسب".
  // info.unknown = true في هذه الحالة (لرسالة الغرفة بالكود)
  async _joinDuoAtomic(code, name, myUid, rows, publicOnly, info = {}) {
    try {
      const res = await runTransaction(ref(db, `rooms/${code}`), (room) => {
        // ذاكرة محلية باردة: null لا يُلغي — الخادم يرفضه إن كانت الغرفة موجودة فتُعاد بقيمتها الحقيقية
        // (ولو غير موجودة فعلاً: لا شيء يُكتب، والنتيجة فارغة = لم ننضم)
        if (room === null) return null;
        if (!this._duoJoinable(room, myUid, rows, publicOnly)) return;
        return { ...room, p2name: name, p2uid: myUid, status: "playing", public: false };
      }, { applyLocally: false });
      const v = res && res.committed && res.snapshot ? res.snapshot.val() : null;
      return (v && v.status === "playing" && v.p2uid === myUid) ? v : null;
    } catch {
      info.unknown = true;
      this._abortDuoMatch(code, 2, myUid);
      return null;
    }
  }
  // معاملة على غرفة تُعاد إن رُفضت (انقطاع ضيّع ردّها، أو ألغتها كتابة محلية): ننتظر الاتصال ثم نعيدها —
  // دالة التحديث تقرّر من جديد على قيمة الخادم الحقيقية، فالإعادة آمنة (مراجعة v35.8: عمليات الإلغاء والإعادة
  // كانت محاولة واحدة؛ ضياع ردّها ترك منتظراً أمام خصم غائب أو في غرفة منتهية). المحاولة الأولى تبدأ في اللحظة
  // نفسها (قبل أي انتظار) — فتقرأ ذاكرة الغرفة كما هي الآن. يرجع نتيجة المعاملة، أو null بعد استنفاد المحاولات.
  async _roomTxnReliably(code, update, tries = 6) {
    for (let i = 0; i < tries; i++) {
      try {
        return await runTransaction(ref(db, `rooms/${code}`), update, { applyLocally: false });
      } catch {}
      await this._waitOnline();
      await new Promise(res => setTimeout(res, 300 * (i + 1)));
    }
    return null;
  }
  // المضيف يلغي غرفة لم يبدأ فيها مباراة: تنتظر وحدها → تُحذف؛ دخلها منضمّ بلحظة الإلغاء → مباراته تُلغى
  // قبل بدئها (abortedBy: 1 — لا فوز له ولا خسارة لأحد). بلا انتظار: يكمل وحده ولو بلا شبكة.
  // أمر المسح عند الانقطاع يبقى مسلّحاً حتى تُحسم المعاملة (مراجعة v35.8): كان يُلغى أولاً — فإغلاق الصفحة
  // قبل وصول الحذف ترك غرفة "تنتظر" عامة بلا صاحب يدخلها الباحث التالي ويعلق بلا خصم. المسح بعد الحسم لا يضر
  // (غرفة محذوفة أو ملغاة)، ثم نلغيه كي لا يمسّ غرفةً جديدة بالرمز نفسه لاحقاً.
  _cancelDuoHosting(code) {
    // صاحب الغرفة كما أنشأها (مراجعة v35.9): تسجيل الخروج أثناء الانتظار يجعل المستخدم الحالي null فلا تُعرف
    // غرفته — كانت تبقى "تنتظر" بلا صاحب وبلا أمر مسح، ويدخلها صديقه إلى مباراة لا أحد فيها
    const myUid = this._duoHostData?.p1uid || getCurrentUser()?.uid || "";
    const task = this._roomTxnReliably(code, (room) => {
      if (room === null) return null;
      if (isOrphanRoomNode(room)) return null;               // بقايا بلا صاحب حلّت مكان غرفتي: نمسحها معها
      if ((room.p1uid || "") !== myUid) return;            // ليست غرفتي (لا نمسّ غيرها)
      if (room.status === "waiting" && !room.p2uid) return null;
      // منضمّ ألغى بحثه بلحظة انضمامه (abortedBy: 2) وإعادة فتحها في الطريق: نحذفها أيضاً — وإلا عادت
      // "تنتظر" بعد مغادرتنا (المعاملة الأولى تقرأ ذاكرتنا "منتهية" فيرفضها الخادم وتُعاد بقيمته "تنتظر").
      // ومثلها "منتهية" بلا خصم (كتابة شاردة من منضمّ سابق — نفس شرط إعادة الفتح، مراجعة v35.8 الرابعة)
      if (room.status === "finished" && (room.abortedBy === 2 || !room.p2uid)) return null;
      if (room.status === "playing" && room.p2uid && !room.abortedBy)
        return { ...room, status: "finished", abortedBy: 1 };
      return;
    });
    task.then(res => {
      if (res) { try { onDisconnect(ref(db, `rooms/${code}`)).cancel().catch(() => {}); } catch {} }
    }).catch(() => {});
    return task;
  }
  // انضممنا ثم تبيّن أننا ألغينا البحث (أو ضاع رد انضمامنا): مباراتنا تُلغى قبل بدئها (abortedBy: 2) —
  // المنتظر يعيد فتح غرفته إن لم يكن بدأ، أو يرى "ألغى الخصم قبل أن تبدأ المباراة — لم تُحسب"
  _abortDuoMatch(code, seat, myUid) {
    return this._roomTxnReliably(code, (room) => {
      if (room === null) return null;
      if (room.status !== "playing" || room.abortedBy || (room["p" + seat + "uid"] || "") !== myUid) return;
      return { ...room, status: "finished", abortedBy: seat };
    }).catch(() => {});
  }
  // المنضمّ ألغى بحثه بلحظة انضمامه قبل أن نبدأ: نعيد فتح غرفتنا كما كانت ونكمل الانتظار بلا أثر.
  // فقط ما دمنا ننتظر فيها (المحاولة تُعاد بعد عودة الاتصال — لا نعيد فتح غرفة ألغيناها في الأثناء)
  _reopenDuoRoom(code) {
    if (this._reopeningCode === code) return;
    this._reopeningCode = code;
    const pub = this._duoPublic;
    const myUid = getCurrentUser()?.uid || "";
    this._roomTxnReliably(code, (room) => {
      if (room === null) return null;
      if (!this._stillHostingDuo(code)) return;
      // غرفتي أنا فقط (مراجعة v35.8 الرابعة): عقدة بلا صاحب تعيدها _restoreDuoRoom كاملة، وغرفة غيري لا نمسّها
      if ((room.p1uid || "") !== myUid) return;
      if (room.status !== "finished" || !(room.abortedBy === 2 || !room.p2uid)) return;
      // نمسح كل علامات نهاية لم تبدأ عندنا (كي لا تقرأها مباراة لاحقة في الغرفة كخروج خصم)
      const { abortedBy, dropped1, dropped2, leftBy, vanished, ...rest } = room;
      return { ...rest, status: "waiting", p2name: "", p2uid: "", ...(pub ? { public: true } : {}) };
    }).catch(() => {}).finally(() => { if (this._reopeningCode === code) this._reopeningCode = null; });
  }
  // ما زلت أنتظر في غرفتي الثنائية هذه (لم تبدأ مباراة، ولم ألغِ)
  _stillHostingDuo(code) {
    return this.roomCode === code && this.playerNum === 1 && !this._gameStarted && !this._isMulti && !this.isSpectator;
  }
  // غرفتي اختفت وأنا أنتظر فيها: نعيدها كما كانت بعد عودة الاتصال (مراجعة v35.8).
  // السبب الأشيع: انقطاع لحظي (الجوال) — الخادم ينفّذ أمر "امسح الغرفة" المسجّل لإغلاق الصفحة، والصفحة ما زالت
  // مفتوحة تنتظر، فلا يجدها باحث ولا صديق معه الكود ("الغرفة غير موجودة!") ونحن ننتظر للأبد. وقد يُنفَّذ الأمر
  // متأخراً بعد عودتنا (اتصال قديم لاحظ الخادم سقوطه لاحقاً)، أو يمسحها منظّف الغرف — المستمع يرى الاختفاء كله.
  // أمر المسح يُسلَّح أولاً على الاتصال الحالي (كالإنشاء)، والإعادة بمعاملة: فقط إن كانت غير موجودة فعلاً.
  async _restoreDuoRoom(code) {
    if (this._restoringCode === code || !this._duoHostData) return;
    this._restoringCode = code;
    const data = this._duoHostData;
    try {
      await this._waitOnline();
      if (!this._stillHostingDuo(code)) return;
      try { onDisconnect(ref(db, `rooms/${code}`)).remove().catch(() => {}); } catch {}
      await this._roomTxnReliably(code, (room) => {
        if (!this._stillHostingDuo(code)) return;          // ألغينا أو بدأت مباراة في الأثناء
        // موجودة (ذاكرتنا متأخرة): لا نلمسها — إلا عقدة بلا صاحب: بقايا أمر انقطاع شارد كتبه منضمّ سابق بعد مسحها
        // (سقط بصمت فلم يُلغِ أمره)، فنعيد غرفتنا فوقها. كانت "موجودة" فلا نعيدها وننتظر للأبد (مراجعة v35.8 الرابعة)
        if (room !== null && !isOrphanRoomNode(room)) return;
        return { ...data, status: "waiting", p2name: "", p2uid: "", createdAt: Date.now(),
                 move: { key: "", by: 0, seq: 0 } };
      });
    } catch {} finally { if (this._restoringCode === code) this._restoringCode = null; }
  }

  // ══ مشاركة خريطة العناصر (تزامن التوزيع) ═══════════════════════
  async shareElementMap(map) {
    if (!this.roomCode) return;
    try { await update(ref(db, `rooms/${this.roomCode}`), { elementMap: map || {} }); } catch {}
  }
  // الضيف يجلب خريطة العناصر التي بثّها المضيف
  async fetchElementMap() {
    if (!this.roomCode) return null;
    try {
      const snap = await get(ref(db, `rooms/${this.roomCode}/elementMap`));
      return snap.exists() ? snap.val() : null;
    } catch { return null; }
  }

  // ══ إرسال حركة ══════════════════════════════════════════════
  async pushMove(lineKey, seq, bankLeft = null, nextTurn = null) {
    if (!this.roomCode) return;
    const payload = {
      key: lineKey,
      by:  this.playerNum,
      seq: seq,  // رقم تسلسلي يضمن عدم تكرار نفس الحركة
      ...(bankLeft != null ? { bank: bankLeft } : {}),
      ...(nextTurn != null ? { nextTurn } : {}),
    };
    // مسار اللاعبين كما هو تماماً (لا نغيّر شيئاً في منطقهم المستقر)
    await update(ref(db, `rooms/${this.roomCode}/move`), payload);
    // + سجل موازٍ (append) للمشاهدين: يتيح رؤية ما فات عند الدخول من المنتصف
    // لا يقرأه اللاعبون إطلاقاً — إضافة صامتة آمنة
    try {
      const mref = push(ref(db, `rooms/${this.roomCode}/moves`));
      await set(mref, payload);
    } catch {}
  }

  // ══ الثنائي: من انقطع؟ (v35.6) ══════════════════════════════
  // الانقطاع ينهي المباراة ويعلّم **مقعدي** (dropped1/dropped2) في كتابة ذرّية واحدة.
  // علم لكل مقعد (لا حقل مشترك): انقطاع لاحق للطرف الآخر لا يمحو علامتي.
  // مهم: Firebase يطبّق أوامر onDisconnect **محلياً** على جهاز من انقطع لحظة يكتشف انقطاعه —
  // فيرى "انتهت" قبل الجميع؛ علامته في نفس اللقطة تمنعه من إعلان فوز ليس له.
  _armDuoDisconnect(code) {
    try {
      onDisconnect(ref(db, `rooms/${code}`)).update({ status: "finished", ["dropped" + this.playerNum]: true }).catch(() => {});
    } catch {}
  }
  // نهاية المباراة عندي: لا نكتب شيئاً بعدها لو أغلقتُ الصفحة (كانت تبقى مسلّحة للأبد)
  // المشاهد لا يملك أمراً على مستوى الغرفة — والإلغاء عليها يلغي معه تنظيف حضوره (spectators/uid)
  disarmDuoDisconnect() {
    if (!this.roomCode || this._isMulti || this.isSpectator) return;
    try { onDisconnect(ref(db, `rooms/${this.roomCode}`)).cancel().catch(() => {}); } catch {}
  }
  // آخر لقطة للغرفة من مستمعها (تشمل ما طبّقه Firebase محلياً عند انقطاعي) — بلا قراءة من الشبكة
  lastRoom() { return this._lastRoom || null; }
  isOnline() { return this._online; }

  // ══ الاستماع لانضمام اللاعب 2 ══════════════════════════════
  _listenForPlayer2(code) {
    const unsub = onValue(ref(db, `rooms/${code}`), (snap) => {
      const hosting = this._stillHostingDuo(code);
      // غرفتي اختفت وأنا أنتظر فيها (انقطاع لحظي نفّذ فيه الخادم أمر مسحها، أو منظّف الغرف): نعيدها.
      // ومثلها عقدة بلا صاحب حلّت مكانها (بقايا أمر انقطاع شارد بعد المسح — مراجعة v35.8 الرابعة). فقط ما دمت أنتظر:
      // بعد البدء تمرّ اللقطة لمعالج الخروج كما هي
      if (!snap.exists() || (hosting && isOrphanRoomNode(snap.val()))) {
        if (hosting) this._restoreDuoRoom(code);
        return;
      }
      const room = snap.val();
      this._lastRoom = room;
      // المنضمّ ألغى بحثه بلحظة انضمامه ولم نكن بدأنا (v35.8): نعيد فتح الغرفة ونكمل الانتظار بلا أثر
      // (بدونها تبقى غرفتنا "منتهية" ونحن ننتظر فيها للأبد — لا أحد يدخل غرفة منتهية). ومثلها "منتهية" بلا خصم
      // ونحن ننتظر: كتابة شاردة من منضمّ سابق خرج منها (أمر انقطاعه، أو خروجه) — مراجعة v35.8 الثالثة
      if (room.status === "finished" && (room.abortedBy === 2 || !room.p2uid) && !this._gameStarted) {
        this._reopenDuoRoom(code);
        return;
      }
      if (room.status === "playing" && !this._gameStarted && room.p2name) {
        this._gameStarted = true;
        // بدأ اللعب: نغيّر سلوك الانقطاع من "مسح" إلى "إنهاء" (ليصل إشعار للخصم)
        // + تسجيل من انقطع (droppedN) في نفس الكتابة الذرّية (v35.6)
        try { onDisconnect(ref(db, `rooms/${code}`)).cancel().catch(() => {}); } catch {}
        this._armDuoDisconnect(code);
        this._cbJoined && this._cbJoined(room.p2name);
      }
      if (room.status === "finished" && this._gameStarted) {
        // نمرّر اللقطة نفسها: القرار (من خرج؟) يُتّخذ منها لا من قراءة شبكة قد تتأخر أو تتقادم
        this._cbLeft && this._cbLeft(room);
      }
    });
    this._unsubs.push(unsub);
  }

  // ══ الاستماع للحركات ════════════════════════════════════════
  // كشف نوع الغرفة (multi أو duo) قبل الانضمام
  // ══ وضع المشاهدة (قراءة فقط) ═══════════════════════════════
  // المشاهد لا يُسجَّل ضمن players (لا رقم لاعب، لا دور) بل تحت spectators
  async joinAsSpectator(code) {
    code = (code || "").trim();
    const myUid = getCurrentUser()?.uid || ("guest_" + Date.now());
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) throw new Error("المباراة غير موجودة!");
    const room = snap.val();
    if (room.status === "finished") throw new Error("انتهت هذه المباراة!");

    this.roomCode   = code;
    this.playerNum  = null;      // مشاهد: بلا رقم لاعب
    this.isSpectator = true;
    this._myUid     = myUid;
    this._isMulti   = !!room.multi;
    this._gameStarted = room.status === "playing";

    // تسجيل المشاهد + إزالته تلقائياً عند الانقطاع
    try {
      await update(ref(db, `rooms/${code}/spectators/${myUid}`), {
        name: getCurrentUser()?.displayName || "مشاهد", at: serverTimestamp(),
      });
      onDisconnect(ref(db, `rooms/${code}/spectators/${myUid}`)).remove();
    } catch {}

    // نستمع للحركات (نفس قنوات اللاعبين) وللساعة ولحالة الغرفة
    if (room.multi) this._listenForMultiMoves(code);
    else { this._listenForMoves(code); this._listenForOpponentLeave(code); }
    this._listenBankUpdate(code);
    this._listenClock(code);
    this._watchServerOffset();
    this._listenLobby(code);
    this._monitorConnection();
    this._listenSpectators(code);

    return { cfg: room.cfg, players: room.players || {}, multi: !!room.multi, status: room.status,
             p1name: room.p1name || null, p2name: room.p2name || null };
  }

  // جلب سجل الحركات الكامل وتطبيقه (الدخول من منتصف المباراة يرى ما فات)
  async fetchMovesHistory() {
    if (!this.roomCode) return [];
    try {
      const snap = await get(ref(db, `rooms/${this.roomCode}/moves`));
      if (!snap.exists()) return [];
      const arr = Object.values(snap.val() || {});
      return arr.filter(m => m && m.key).sort((a, b) => (a.seq || 0) - (b.seq || 0));
    } catch { return []; }
  }

  // قراءة لقطة الغرفة (يستخدمها المشاهد لمعرفة من غادر بالاسم)
  async getRoomSnapshot() {
    if (!this.roomCode) return null;
    try {
      const snap = await get(ref(db, `rooms/${this.roomCode}`));
      return snap.exists() ? snap.val() : null;
    } catch { return null; }
  }

  // ترشيح المضيف ذرّياً: يفوز واحد فقط حتى لو رشّح الجميع أنفسهم بنفس اللحظة
  // (الحساب المحلي "أصغر رقم حاضر" يعطي نتائج مختلفة قبل وصول القائمة الكاملة)
  async claimHostIfVacant(presentNums) {
    if (!this.roomCode || !this.playerNum) return;
    try {
      await runTransaction(ref(db, `rooms/${this.roomCode}/hostNum`), (cur) => {
        // مضيف حالي وما زال حاضراً → لا نغيّره
        if (typeof cur === 'number' && presentNums.includes(cur)) return cur;
        // شاغر: يفوز أصغر رقم حاضر (حساب متطابق، والترانزاكشن تحسم التسابق)
        const candidate = presentNums.length ? Math.min(...presentNums) : this.playerNum;
        return candidate;
      });
    } catch {}
  }

  // 👁️ متابعة عدد المشاهدين (للاعبين والمشاهدين معاً)
  _listenSpectators(code) {
    const unsub = onValue(ref(db, `rooms/${code}/spectators`), (snap) => {
      const count = snap.exists() ? Object.keys(snap.val() || {}).length : 0;
      this._lastSpecCount = count;
      this._cbSpectators && this._cbSpectators(count);
    });
    this._unsubs.push(unsub);
  }
  onSpectatorsChange(cb) {
    this._cbSpectators = cb;
    if (typeof this._lastSpecCount === 'number') cb(this._lastSpecCount);
  }

  // مغادرة وضع المشاهدة
  async leaveSpectator() {
    const code = this.roomCode, uid = this._myUid;
    this._unsubs.forEach(u => u()); this._unsubs = [];
    if (code && uid) {
      // بلا انتظار الردود (مراجعة v35.7 الرابعة): انقطاع أثناء الانتظار كان يعلّق زر الخروج — والترتيب محفوظ
      try { onDisconnect(ref(db, `rooms/${code}/spectators/${uid}`)).cancel().catch(() => {}); } catch {}
      try { remove(ref(db, `rooms/${code}/spectators/${uid}`)).catch(() => {}); } catch {}
    }
    this.roomCode = null; this.isSpectator = false; this._isMulti = false;
    this._gameStarted = false; this._lastApplied = null;
    this._pendingMove = null; this._pendingMoves = [];
    this._lastClock = null; this._cbMove = null; this._cbClock = null;
    this._cbLobby = null; this._cbPlayerLeft = null; this._lastPlayers = null;
    // v35.6: معالجات المباراة السابقة لا تبقى لتلتقط أحداث الغرفة التالية
    this._cbLeft = null; this._cbRestart = null; this._lastRoom = null;
  }

  async getRoomType(code) {
    try {
      const snap = await get(ref(db, `rooms/${(code||"").trim()}`));
      if (!snap.exists()) throw new Error("الغرفة غير موجودة!");
      return snap.val().multi ? "multi" : "duo";
    } catch (e) { throw e; }
  }

  // ═══════════════════════════════════════════════════════════
  //  الغرف متعددة اللاعبين (3-4) — نظام players مرن
  // ═══════════════════════════════════════════════════════════

  // إنشاء غرفة متعددة (المضيف يحدّد الحد الأقصى)
  async createMultiRoom(cfg, name, maxPlayers) {
    const code = genCode();
    const leaveSeq = this._duoSearchSeq;   // كل مغادرة تزيده فوراً (مغادرة اللوبي الجماعي لا تصفّر roomCode إلا بعد كتاباتها)
    const myUid = getCurrentUser()?.uid || ("guest_" + Date.now());
    this.roomCode  = code;
    this.playerNum = 1;
    this._isMulti  = true;
    this._gameStarted = false;
    this._myUid = myUid;

    await set(ref(db, `rooms/${code}`), {
      cfg:        { rows: cfg.rows, cols: cfg.cols },
      status:     "lobby",
      multi:      true,
      maxPlayers: Math.min(Math.max(maxPlayers, 2), 4),
      hostUid:    myUid,
      players:    { [myUid]: { name, num: 1, active: true } },
      playerCount: 1,
      turn:       1,
      move:       { key: "", by: 0, seq: 0 },
      createdAt:  Date.now(),
    });
    // تُركت أثناء إنشائها (v35.9): لا أوامر ولا مستمعين لها — والمغادرة نفسها تمسحها
    if (this.roomCode !== code || this._duoSearchSeq !== leaveSeq) return { code, left: true };
    // عند انقطاع المنشئ في اللوبي (إغلاق تبويب/تحديث صفحة/انقطاع شبكة):
    // يُزال **هو فقط** كالمنضمّين، والغرفة تستمر للباقين وينتقل التاج لأصغر رقم حاضر.
    // (كانت تُمسح الغرفة كاملة: في العشوائي يُطرد الجميع، وفي الغرفة بالكود يعلقون بلا مضيف)
    onDisconnect(ref(db, `rooms/${code}/players/${myUid}`)).remove();
    this._listenLobby(code);
    this._listenForMultiMoves(code);
    this._listenBankUpdate(code);
    this._listenClock(code);
    this._listenApproval(code);
    this._watchServerOffset();
    this._monitorConnection();
    this._listenSpectators(code);
    return { code };
  }

  // الانضمام لغرفة متعددة
  async joinMultiRoom(code, name) {
    code = (code || "").trim();
    const myUid = getCurrentUser()?.uid || ("guest_" + Date.now());
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) throw new Error("الغرفة غير موجودة!");
    const room = snap.val();
    if (!room.multi) throw new Error("هذه ليست غرفة متعددة!");
    if (room.status !== "lobby") throw new Error("المباراة بدأت أو انتهت!");
    // العدد الفعلي لا playerCount (قد يتقادم بعد إزالة منقطع) — والترانزاكشن تحسم السباق
    if (Object.keys(room.players || {}).length >= room.maxPlayers) throw new Error("الغرفة ممتلئة!");

    // نستخدم transaction لضمان رقم لاعب فريد (يمنع تعارض الانضمام المتزامن)
    let myNum = null;
    const roomRef = ref(db, `rooms/${code}`);
    await runTransaction(roomRef, (cur) => {
      if (!cur) return cur;
      if (cur.status !== "lobby") return cur; // بدأت المباراة
      cur.players = cur.players || {};
      const present = Object.values(cur.players).filter(p => p && typeof p.num === 'number');
      const count = present.length;
      if (count >= cur.maxPlayers) return cur; // ممتلئة
      // رقم المقعد = أصغر رقم غير محجوز (لا "العدد + 1")
      // بعد المغادرات تصير الأرقام غير متتالية ({2,3} ثم {2})، فكان "العدد + 1"
      // يعطي العائد رقماً محجوزاً (2) → لاعبان بنفس الرقم → خانة تصويت واحدة لهما
      const used = new Set(present.map(p => p.num));
      let seat = 1;
      while (used.has(seat)) seat++;
      myNum = seat;
      // إن كان تصويت جارياً: ندخل كمنتظرين (خارج الجولة) حتى تُحسم
      // جولة ميتة (تجاوزت مهلتها بوضوح) لا تحبس منضمّاً — نتجاهلها
      const ap = cur.approval;
      const apAge = (ap && typeof ap.startedAt === 'number')
        ? (this.serverNow() - ap.startedAt) : Infinity;
      const voting = !!ap && ap.state === "asking" && apAge <= 25000;
      // المقعد كان لغيرنا وغادر: نُزيل أي قرار متبقٍّ له في الجولة (لا يُنسب إلينا)
      if (ap?.decisions && ap.decisions[myNum] != null) {
        cur.approval.decisions[myNum] = null;
      }
      cur.players[myUid] = voting
        ? { name, num: myNum, active: true, waiting: true }
        : { name, num: myNum, active: true };
      cur.playerCount = count + 1;   // العدد الفعلي (لا رقم المقعد)
      return cur;
    });

    if (!myNum) throw new Error("تعذّر الانضمام (الغرفة ممتلئة أو بدأت)!");

    this.roomCode  = code;
    this.playerNum = myNum;
    this._isMulti  = true;
    this._gameStarted = false;
    this._myUid = myUid;

    // عند انقطاع اللاعب: نعلّمه غير نشط
    // أثناء اللوبي/البحث: الانقطاع (تحديث الصفحة/إغلاقها) = خروج فوري
    // لا مهلة سماح هنا — وإلا يبقى اسمه في القائمة فتعلق جولة الموافقة بانتظار غائب
    onDisconnect(ref(db, `rooms/${code}/players/${myUid}`)).remove();
    this._listenLobby(code);
    this._listenForMultiMoves(code);
    this._listenBankUpdate(code);
    this._listenClock(code);
    this._listenApproval(code);
    this._watchServerOffset();
    this._monitorConnection();
    this._listenSpectators(code);
    return { code, myNum, cfg: room.cfg, maxPlayers: room.maxPlayers };
  }

  // المضيف يبدأ المباراة
  async startMultiGame(voterNums = null) {
    if (!this.roomCode) return;
    // بدء ذرّي في كتابة واحدة: تصفية اللاعبين + تحويل الحالة إلى "playing" معاً.
    // - يحدث مرة واحدة فقط مهما تعدّد من يظنّ نفسه مضيفاً (لا جلستان منفصلتان)
    // - سابقاً كانت الحالة تتحوّل أولاً ثم يُزال المنتظرون بخطوة لاحقة، فيستلم
    //   المنتظر لقطة "بدأت" وهو ما زال في القائمة → يدخل مباراة لم يصوّت عليها،
    //   ويُحسب رقمه في الدور الأول وتهيئة الساعة عند الجميع
    // - applyLocally:false → لا يرى أحد (ولا المضيف) إلا الحالة المعتمدة من الخادم
    const onlyVoters = Array.isArray(voterNums) && voterNums.length > 0;
    try {
      await runTransaction(ref(db, `rooms/${this.roomCode}`), (cur) => {
        if (!cur) return cur;
        if (cur.status !== "lobby") return;                 // بدأت أو انتهت → إلغاء بلا تكرار
        const kept = {};
        Object.entries(cur.players || {}).forEach(([uid, p]) => {
          if (!p || typeof p.num !== 'number') return;
          if (onlyVoters && !voterNums.includes(p.num)) return; // غير المصوّتين (المنتظرون) خارج المباراة
          const { waiting, ...rest } = p;                       // لا حالة "منتظر" داخل مباراة
          kept[uid] = rest;
        });
        const nums = Object.values(kept).map(p => p.num);
        if (nums.length < 2) {
          // غادر مصوّت في اللحظة الأخيرة: لا مباراة بلاعب واحد — نعود لمرحلة التجميع
          if (onlyVoters) { cur.approval = null; cur.waitStartedAt = null; return cur; }
          return;                                            // إلغاء بلا تغيير
        }
        cur.players = kept;
        cur.playerCount = nums.length;
        cur.status = "playing";
        cur.turn = Math.min(...nums);                        // أصغر مقعد حاضر (لا "1" ثابتاً)
        return cur;
      }, { applyLocally: false });
    } catch {}
  }

  // الاستماع للوبي (انضمام/خروج لاعبين + بدء المباراة)
  _listenLobby(code) {
    const unsub = onValue(ref(db, `rooms/${code}`), (snap) => {
      if (!snap.exists()) { this._cbPlayerLeft && this._cbPlayerLeft("host_left"); return; }
      const room = snap.val();
      const players = room.players || {};
      this._lastPlayers = players;   // v35.7: هل خرجتُ؟ (لا يُعاد إخراج من خرج)
      // عدنا للاتصال ومقعدي لم يظهر حيّاً بعد في نسختنا المحلية: نسلّح الختم مع أول لقطة تُظهره (مراجعة v35.7 الثالثة)
      if (this._rearmPending && this._gameStarted && !this._leaving && this._mySeatLive()) {
        this._rearmPending = false;
        this._armMyStamp(code);
      }
      // أُزلنا من الغرفة (كنّا منتظرين والمباراة بدأت بالمصوّتين) → نبحث من جديد
      if (this._myUid && !this._gameStarted && players && !players[this._myUid]
          && Object.keys(players).length > 0) {
        this._cbPlayerLeft && this._cbPlayerLeft("removed_waiting");
        return;
      }
      // تحديث قائمة اللوبي
      this._cbLobby && this._cbLobby(players, room);
      // بدء المباراة
      if (room.status === "playing" && !this._gameStarted) {
        this._gameStarted = true;
        // عند بدء اللعب: نبدّل سلوك الانقطاع من "إزالة فورية" (المناسب للوبي)
        // إلى "ختم انقطاع" (مهلة السماح) — لكل اللاعبين، لا المضيف وحده.
        // الترتيب مهم (مراجعة v35.7): إلغاء أوامر مسار يلغي معها كل ما تحته — فالإلغاءات أولاً ثم الختم.
        // كان المنشئ يسلّح ختمه ثم يلغي أوامر الغرفة كلها فيُمسح الختم معها: لا يُخرَج بانقطاعه أبداً.
        // تُرسل الثلاثة معاً بترتيبها بلا انتظار: الخادم ينفّذ طلبات الاتصال الواحد بترتيبها، وانتظار
        // تأكيد الإلغاءات كان يُسقط التسليح كلياً لو انقطعنا قبل وصول التأكيد (مراجعة v35.7 الثالثة).
        // (وعودة الاتصال أثناء المباراة تعيد تسليحه على الاتصال الجديد — _monitorConnection)
        try {
          const uid = this._myUid;
          if (this.playerNum === 1) onDisconnect(ref(db, `rooms/${code}`)).cancel().catch(() => {});   // مسح الغرفة (قديم)
          if (uid) {
            onDisconnect(ref(db, `rooms/${code}/players/${uid}`)).cancel().catch(() => {});             // إزالة اللوبي
            onDisconnect(ref(db, `rooms/${code}/players/${uid}/disconnectedAt`)).set(serverTimestamp()).catch(() => {});
          }
        } catch {}
        this._cbMultiStart && this._cbMultiStart(room);
      }
      // خروج لاعب أثناء اللعب (صار غير نشط)
      if (room.status === "playing" && this._gameStarted) {
        this._cbPlayerLeft && this._cbPlayerLeft(players);
      }
    });
    this._unsubs.push(unsub);
  }

  // إرسال حركة متعددة (مع رقم الدور التالي)
  async pushMultiMove(lineKey, nextTurn, seq, bankLeft = null) {
    if (!this.roomCode) return;
    // سجل حركات كامل (append) — لا حركة تمحو أخرى، والمتأخر يستلم الكل بالترتيب
    const mref = push(ref(db, `rooms/${this.roomCode}/moves`));
    await set(mref, { key: lineKey, by: this.playerNum, seq: seq || Date.now(), nextTurn,
      ...(bankLeft != null ? { bank: bankLeft } : {}) });
    await update(ref(db, `rooms/${this.roomCode}`), { turn: nextTurn });
  }

  // نقل الدور بدون حركة (انتهاء الوقت) — عبر نفس سجل الحركات الموثوق
  async pushTurnSkip(nextTurn) {
    if (!this.roomCode) return;
    const mref = push(ref(db, `rooms/${this.roomCode}/moves`));
    await set(mref, { key: "__skip__", by: this.playerNum, seq: Date.now(), nextTurn });
    await update(ref(db, `rooms/${this.roomCode}`), { turn: nextTurn });
  }

  // ══ مطابقة عشوائية جماعية (3-4) — تطابق العدد والحجم ══════════
  async findRandomMultiMatch(cfg, name, wantedPlayers) {
    const myUid = getCurrentUser()?.uid || ("guest_" + Date.now());
    // نبحث عن غرفة جماعية عامة مطابقة (نفس العدد المطلوب + نفس الحجم) وفيها مكان
    // ملاحظة: أثناء التصويت (approval.state === "asking") لا نمنع الانضمام،
    // بل ندخل بحالة "منتظر" (waiting) خارج التصويت — فلا تشتيت في غرف متوازية
    let foundCode = null;
    try {
      const snap = await get(ref(db, "rooms"));
      if (snap.exists()) {
        for (const [code, room] of Object.entries(snap.val())) {
          // ملاحظة: لا نمنع العودة للغرفة التي غادرناها — المنع كان يشتّت
          // لاعبَين متاحين في غرفتين منفصلتين. الحماية الحقيقية: الرافض لا يُحبس
          // في جولته (أدناه + في الواجهة)، وقراره القديم يُزال عند عودته.
          if (room && room.multi === true && room.public === true
              && room.status === "lobby"
              && Number(room.maxPlayers) === Number(wantedPlayers)
              && room.cfg && Number(room.cfg.rows) === Number(cfg.rows)
              && !(room.players && room.players[myUid])) {
            // العدد الفعلي من القائمة لا من playerCount: قد يتقادم حين يُزال لاعب
            // بانقطاعه (onDisconnect يزيل عقدته فقط) فتبدو الغرفة ممتلئة وهي ليست كذلك
            const present = Object.keys(room.players || {}).length;
            if (!present) continue;                    // غرفة مهجورة — يمسحها التنظيف
            const voting = room.approval && room.approval.state === "asking";
            // أثناء التصويت: ندخل كمنتظرين ما لم يكتمل عدد المنتظرين لتجمّع مستقل
            if (voting) {
              const waitingCount = Object.values(room.players || {})
                .filter(p => p && p.waiting === true).length;
              if (waitingCount >= Number(wantedPlayers)) continue; // يكفون لتجمّع خاص → غرفة جديدة
              foundCode = code; break;
            }
            if (present < room.maxPlayers) { foundCode = code; break; }
          }
        }
      }
    } catch {}

    if (foundCode) {
      try {
        const res = await this.joinMultiRoom(foundCode, name);
        return { role: "joiner", ...res };
      } catch { /* امتلأت في سباق — ننشئ بدلاً */ }
    }
    // لا غرفة مناسبة — ننشئ غرفة جماعية عامة وننتظر
    const { code } = await this.createMultiRoom(cfg, name, wantedPlayers);
    await update(ref(db, `rooms/${code}`), { public: true });
    return { role: "creator", code };
  }

  // ══ الخروج من مباراة جماعية جارية (v35.7) ══
  // كل إخراج يكتب مع active:false **سببه** (outReason) و**لحظته** (outAt، ختم الخادم):
  // السبب للشارة ولقاعدة العملات، واللحظة لترتيب الخارجين بترتيب خروجهم (أول من خرج = آخر مركز).
  // **ذرّياً ومرة واحدة**: من خرج لا يُعاد إخراجه — كتابة ثانية (جهاز آخر أنقذ نافد الوقت، أو
  // كتابة جهاز كان منقطعاً ووصلت متأخرة) كانت ستغيّر سببه ولحظته فيتغيّر مركزه عند الآخرين.
  // applyLocally:false: لا يرى أحد إلا ما اعتمده الخادم (لا لاعب يختفي لحظياً من القائمة).
  // المعاملة على قائمة اللاعبين كلها (لا مقعد واحد): الخادم يرتّب الخروجات المتزامنة واحداً بعد
  // الآخر، ويرجع القائمة كما اعتمدها — فيها كل خروج سبق خروجنا، فمركزنا منها لا يتكرّر مع أحد.
  // pick(uid, player) يختار المقعد. محاولة واحدة، ونتيجتها تميّز ثلاث حالات (مراجعة v35.7 الثانية):
  //   { ok: true,  players } — اعتُمد الإخراج، والقائمة كما اعتمدها الخادم
  //   { ok: false, players } — لا شيء يُكتب: لا مقعد بهذا الوصف، أو خرج قبلنا (القائمة كما هي عند الخادم)
  //   { ok: false, error: true } — أُلغيت المعاملة أو فشلت: كتابة محلية على المسار نفسه (مسح ختم
  //     الانقطاع مثلاً)، أو تطبيق Firebase أوامر انقطاعنا محلياً لحظة انقطاعنا — يستحق إعادة المحاولة.
  // code: غرفة محدّدة (مهمة انسحاب تكمل بعد مغادرتنا لها)
  async _markOutAttempt(pick, reason, extra = {}, code = this.roomCode) {
    if (!code) return { ok: false, error: true };
    try {
      const res = await runTransaction(ref(db, `rooms/${code}/players`), (cur) => {
        // ذاكرة محلية باردة: null لا يُلغي (الإلغاء كان سيُسقط الإخراج بصمت) — الخادم يرفضها
        // لاختلاف القيمة فتُعاد المحاولة بالقيمة الحقيقية؛ ولو القائمة غير موجودة فعلاً: لا شيء
        if (cur === null) return null;
        const hit = Object.entries(cur).find(([uid, p]) => p && pick(uid, p));
        if (!hit) return;                                   // لا مقعد بهذا الوصف
        const [uid, p] = hit;
        if (p.active === false) return;                     // خرج قبلنا: لا نعيد إخراجه
        cur[uid] = { ...p, ...extra, active: false, outReason: reason, outAt: serverTimestamp() };
        return cur;
      }, { applyLocally: false });
      const players = res && res.snapshot ? (res.snapshot.val() || null) : null;
      return res && res.committed && players ? { ok: true, players } : { ok: false, players };
    } catch { return { ok: false, error: true }; }
  }
  // الواجهة القديمة: القائمة المعتمدة أو null (لإخراج الآخرين: تتكرّر من كل جهاز ومع كل لقطة)
  async _markOutWhere(pick, reason, extra = {}) {
    const r = await this._markOutAttempt(pick, reason, extra);
    return r.ok ? r.players : null;
  }
  // لخروجي أنا: نعيد المحاولة إن أُلغيت المعاملة (بعد عودة الاتصال) — خروجي لا يكرّره جهاز غيري
  async _markOutReliably(pick, reason, extra = {}, { code = this.roomCode, tries = 3, onRetry = null } = {}) {
    let r = { ok: false, error: true };
    for (let i = 0; i < tries; i++) {
      r = await this._markOutAttempt(pick, reason, extra, code);
      if (!r.error) return r;
      await this._waitOnline();
      if (onRetry) { try { onRetry(); } catch {} }
      await new Promise(res => setTimeout(res, 300 * (i + 1)));
    }
    return r;
  }
  // ينتظر اتصالاً بالخادم (مستمع مستقل: مستمعات الغرفة قد تُفصل بالمغادرة قبل أن ينتهي من يحتاجه)
  _waitOnline() {
    return new Promise(resolve => {
      let unsub = null, done = false;
      const finish = () => { if (done) return; done = true; resolve(); if (unsub) { try { unsub(); } catch {} } };
      try {
        unsub = onValue(ref(db, ".info/connected"), snap => { if (snap.val() === true) finish(); });
        if (done && unsub) { try { unsub(); } catch {} }
      } catch { finish(); }
    });
  }
  // هل مقعدي خارج في آخر قائمة وصلتنا؟ (اختصار محلي قبل المعاملة)
  _iAmOutLocally() {
    const me = this._lastPlayers && this._myUid ? this._lastPlayers[this._myUid] : null;
    return !!(me && me.active === false);
  }
  // مقعدي موجود ونشط في آخر قائمة وصلتنا؟ — شرط تسليح ختم الانقطاع: ختمٌ على مقعد غير موجود يكتب
  // عند إغلاق الصفحة مقعداً شبحاً بلا رقم ولا اسم (مقعد حذفه أمر "إزالة اللوبي" قبل إلغائه — موثّق لـ3.6).
  // (قد تُظهر النسخة المحلية مقعدي محذوفاً وهو باقٍ عند الخادم: Firebase يطبّق محلياً أمر إزالة لم يصله
  //  تأكيد إلغائه — لذلك ننتظر لقطة الخادم بعد العودة بدل الحكم لحظة الاتصال)
  _mySeatLive() {
    const me = this._lastPlayers && this._myUid ? this._lastPlayers[this._myUid] : null;
    return !!(me && me.active !== false && Number.isInteger(me.num));
  }
  _armMyStamp(code = this.roomCode) {
    if (!code || !this._myUid) return;
    try { onDisconnect(ref(db, `rooms/${code}/players/${this._myUid}/disconnectedAt`)).set(serverTimestamp()).catch(() => {}); } catch {}
  }

  // تعليم نفسي/لاعب آخر خارج المباراة (نفاد بنك الوقت — نمط bank)
  // يرجع قائمة اللاعبين كما اعتمدها الخادم بعد خروجي (أو null)
  async markSelfInactive() {
    if (!this.roomCode || !this._myUid || this._iAmOutLocally()) return null;
    const me = this._myUid;
    const r = await this._markOutReliably(uid => uid === me, "time");
    return r.ok ? r.players : null;
  }
  async markPlayerInactiveByNum(num) {
    return this._markOutWhere((uid, p) => p.num === num, "time");
  }

  // بثّ فوري لتحديث بنك لاعب (عند شراء أداة وقت بين الحركات — لا ننتظر الحركة التالية)
  async pushBankUpdate(player, bankLeft) {
    if (!this.roomCode || typeof bankLeft !== 'number') return;
    try {
      await update(ref(db, `rooms/${this.roomCode}`), {
        bankUpdate: { player, bank: bankLeft, seq: Date.now(), by: this.playerNum },
      });
    } catch {}
  }

  _listenBankUpdate(code) {
    const unsub = onValue(ref(db, `rooms/${code}/bankUpdate`), (snap) => {
      if (!snap.exists()) return;
      const d = snap.val();
      if (!d || typeof d.player !== 'number' || typeof d.bank !== 'number') return;
      if (d.by === this.playerNum) return;         // تحديثاتنا لا تُعاد علينا
      if (d.seq === this._lastBankSeq) return;      // منع التكرار
      this._lastBankSeq = d.seq;
      this._cbBankUpdate && this._cbBankUpdate(d.player, d.bank);
    });
    this._unsubs.push(unsub);
  }
  onBankUpdate(cb) { this._cbBankUpdate = cb; }

  // ══ الساعة المركزية (بنك الوقت أونلاين — مرجع Firebase موحّد) ══
  // فرق توقيت الجهاز عن سيرفر Firebase (يُحسب مرة، للتزامن الدقيق)
  _watchServerOffset() {
    const offRef = ref(db, ".info/serverTimeOffset");
    const unsub = onValue(offRef, snap => { this._serverOffset = snap.val() || 0; });
    this._unsubs.push(unsub);
  }
  serverNow() { return Date.now() + (this._serverOffset || 0); }

  // تهيئة الساعة عند بدء المباراة (المضيف/المنشئ فقط)
  async initClock(banks, firstPlayer) {
    if (!this.roomCode) return;
    await update(ref(db, `rooms/${this.roomCode}/clock`), {
      banks, currentPlayer: firstPlayer, turnStartAt: serverTimestamp(),
    });
  }

  // تحديث الساعة عند حركة: نخصم المستهلك من بنك اللاعب الحالي ونبدأ دور التالي
  async pushClock(prevPlayer, prevBankLeft, nextPlayer) {
    if (!this.roomCode) return;
    const upd = { currentPlayer: nextPlayer, turnStartAt: serverTimestamp() };
    if (typeof prevBankLeft === 'number') upd[`banks/${prevPlayer}`] = Math.max(0, Math.round(prevBankLeft));
    await update(ref(db, `rooms/${this.roomCode}/clock`), upd);
  }

  // تعديل بنك لاعب مباشرة (أداة ±وقت) — مرجع واحد يراه الجميع فوراً
  async updateClockBank(player, newBank) {
    if (!this.roomCode || typeof newBank !== 'number') return;
    // إذا كان اللاعب صاحب الدور الحالي: نعيد ضبط turnStartAt أيضاً
    // (وإلا يُطرح الزمن المنقضي من القيمة الجديدة فتظهر أقل)
    const upd = { [`banks/${player}`]: Math.max(0, Math.round(newBank)) };
    try {
      const snap = await get(ref(db, `rooms/${this.roomCode}/clock/currentPlayer`));
      if (snap.exists() && Number(snap.val()) === Number(player)) {
        upd.turnStartAt = serverTimestamp();
      }
    } catch {}
    await update(ref(db, `rooms/${this.roomCode}/clock`), upd);
  }

  // الاستماع لحالة الساعة (كل الأجهزة)
  _listenClock(code) {
    const unsub = onValue(ref(db, `rooms/${code}/clock`), snap => {
      if (!snap.exists()) return;
      const clk = snap.val();
      this._lastClock = clk; // نخزّن آخر حالة (قد تصل قبل تسجيل الـ callback)
      this._cbClock && this._cbClock(clk);
    });
    this._unsubs.push(unsub);
  }
  onClock(cb) {
    this._cbClock = cb;
    // تسليم آخر حالة ساعة وصلت قبل التسجيل (تفادي فقدان الحالة الأولى)
    if (this._lastClock) cb(this._lastClock);
  }

  // ختم زمني مشترك لبدء عدّاد الانتظار (يوحّد العدّ عند الجميع)
  // force=true: دورة جديدة عمداً → نكتب ختماً جديداً حتى لو وُجد ختم قديم
  // (بلا ذلك يبقى الختم القديم فيحسب العدّاد زمناً منقضياً ويعرض 0)
  // atTs: ختم محدّد (لمواصلة عدّ جارٍ بدل إعادته)
  async markWaitStart(force = false, atTs = null) {
    if (!this.roomCode) return null;
    try {
      const fresh = (typeof atTs === 'number') ? atTs : this.serverNow();
      await runTransaction(ref(db, `rooms/${this.roomCode}/waitStartedAt`), (cur) => {
        if (cur && !force) return cur;   // الحالة العادية: لا نغيّر ختماً قائماً
        return fresh;                    // أول من يصل يكتب، أو كتابة إجبارية
      });
      return fresh;
    } catch { return null; }
  }

  // تنظيف حالة الموافقة والانتظار (عند بدء المباراة أو المغادرة)
  // تحرير المنتظرين (بعد حسم الجولة) ليصبحوا أعضاء عاديين في الدورة التالية
  async releaseWaitingPlayers() {
    if (!this.roomCode) return;
    try {
      const snap = await get(ref(db, `rooms/${this.roomCode}/players`));
      if (!snap.exists()) return;
      const updates = {};
      Object.entries(snap.val()).forEach(([uid, p]) => {
        if (p && p.waiting === true) updates[`${uid}/waiting`] = null;
      });
      if (Object.keys(updates).length) {
        await update(ref(db, `rooms/${this.roomCode}/players`), updates);
      }
    } catch {}
  }

  // تنظيف حالة الموافقة فقط (لا نمسح ختم الانتظار — وإلا يُعاد عدّاد الآخرين)
  async clearApprovalState() {
    if (!this.roomCode) return;
    try {
      await update(ref(db, `rooms/${this.roomCode}`), { approval: null });
    } catch {}
  }

  // تنظيف كامل (موافقة + ختم انتظار) — يُستخدم عند بدء المباراة فقط
  async clearRoundState() {
    if (!this.roomCode) return;
    try {
      await update(ref(db, `rooms/${this.roomCode}`), { approval: null, waitStartedAt: null });
    } catch {}
  }

  // ══ مهلة السماح عند الانقطاع (Grace Period) ══
  // عند عودة الاتصال: نمسح ختم الانقطاع (اللاعب رجع ضمن المهلة)
  async clearMyDisconnectMark() {
    // أثناء انسحابي: لا كتابة على مقعدي — كتابة محلية على المسار تُلغي معاملة الانسحاب المنتظرة
    // (زر الخروج بلا شبكة ثم العودة: كان المقعد يبقى "نشطاً" بلا ختم ولا أوامر — مراجعة v35.7 الثانية)
    if (!this.roomCode || !this._myUid || this._iAmOutLocally() || this._leaving) return;
    const code = this.roomCode;
    try {
      await update(ref(db, `rooms/${code}/players/${this._myUid}`), { disconnectedAt: null });
      // خرجتُ خلال انتظار الكتابة (وصلت قائمة الخادم بعد العودة)، أو غادرت الغرفة: لا نعيد التسليح
      // — وإلا يكتب إغلاق الصفحة لاحقاً ختم انقطاع على مقعد خارج (مراجعة v35.7)؛ ولا على مقعد غير ظاهر
      if (this.roomCode !== code || this._iAmOutLocally() || this._leaving || !this._mySeatLive()) return;
      // مهم: onDisconnect يُستهلك بعد انطلاقه — نعيد تسجيله ليعمل في الانقطاعات التالية
      onDisconnect(ref(db, `rooms/${code}/players/${this._myUid}/disconnectedAt`)).set(serverTimestamp());
    } catch {}
  }

  // خرجتُ من المباراة (v35.7): حضوري لم يعد يعني أحداً — لا ختم انقطاع يُكتب على مقعد خارج
  async disarmMyDisconnectMark() {
    if (!this.roomCode || !this._myUid) return;
    try { await onDisconnect(ref(db, `rooms/${this.roomCode}/players/${this._myUid}/disconnectedAt`)).cancel(); } catch {}
  }

  // إخراج لاعب تجاوز مهلة السماح (يُنفّذها أي جهاز متصل — الحساب حتمي فالتكرار غير ضار)
  async expirePlayerByNum(num) {
    return this._markOutWhere((uid, p) => p.num === num, "dropped", { disconnectedAt: null });
  }

  // ══ جولة الموافقة (المطابقة العشوائية الجماعية بعدد ناقص) ══
  // المنشئ يفتح الجولة: كل اللاعبين الحاضرين "pending" حتى يقرّروا
  async startApprovalRound(availableCount, wantedCount, excludeNums = []) {
    if (!this.roomCode) return;
    try {
      // حماية: لا نعيد بناء جولة قائمة (وإلا تُمحى قرارات اللاعبين المسجّلة)
      const cur = await get(ref(db, `rooms/${this.roomCode}/approval`));
      const curVal = cur.exists() ? cur.val() : null;
      if (curVal && curVal.state === "asking") {
        const age = (typeof curVal.startedAt === 'number')
          ? (this.serverNow() - curVal.startedAt) : Infinity;
        // جولة حيّة → لا نعيد البناء. جولة ميتة → ننظّفها ونكمل
        if (age <= 25000) return "already-asking";
        try { await update(ref(db, `rooms/${this.roomCode}`), { approval: null }); } catch {}
      }
      // نقرأ القائمة الحيّة لحظة الفتح ونستبعد غير النشطين/المغادرين
      // (وإلا تُفتح الجولة باسم لاعب خرج فتُهدر جولة كاملة قبل أن تعمل)
      const snap = await get(ref(db, `rooms/${this.roomCode}/players`));
      if (!snap.exists()) return;
      const present = Object.values(snap.val()).filter(p =>
        p && p.active !== false && typeof p.num === 'number'
        && p.disconnectedAt == null && p.waiting !== true
        // نستبعد من عرفنا خروجه صراحةً (قد لا تكون إزالته اكتملت في Firebase بعد)
        && !excludeNums.includes(p.num)
      );
      if (present.length < 2) {
        return "too-few";   // حارس مستقل: لا تصويت بلاعب واحد مهما كان التوقيت
      }
      const decisions = {};
      present.forEach(p => { decisions[p.num] = "pending"; });
      await update(ref(db, `rooms/${this.roomCode}/approval`), {
        state: "asking", available: present.length, wanted: wantedCount,
        startedAt: serverTimestamp(), decisions,
      });
      return "opened";
    } catch {}
  }

  // إزالة قرار لاعب غادر من جولة قائمة (بدل انتظار قرار لن يأتي)
  async pruneApprovalDecision(playerNum) {
    if (!this.roomCode || typeof playerNum !== 'number') return;
    try {
      await update(ref(db, `rooms/${this.roomCode}/approval/decisions`), { [playerNum]: null });
    } catch {}
  }

  // تسجيل قرار لاعب (accepted | rejected)
  async setApprovalDecision(decision) {
    if (!this.roomCode || !this.playerNum) return;
    try {
      await update(ref(db, `rooms/${this.roomCode}/approval/decisions`), {
        [this.playerNum]: decision,
      });
    } catch {}
  }

  // إنهاء الجولة (المنشئ): "confirmed" تبدأ المباراة، "cancelled" عودة للبحث
  async closeApprovalRound(result) {
    if (!this.roomCode) return;
    try {
      await update(ref(db, `rooms/${this.roomCode}/approval`), { state: result });
    } catch {}
  }

  _listenApproval(code) {
    const unsub = onValue(ref(db, `rooms/${code}/approval`), snap => {
      if (!snap.exists()) return;
      const a = snap.val();
      this._lastApproval = a;
      this._cbApproval && this._cbApproval(a);
    });
    this._unsubs.push(unsub);
  }
  onApproval(cb) {
    this._cbApproval = cb;
    if (this._lastApproval) cb(this._lastApproval);
  }

  // مستمع سجل الحركات الجماعي — onChildAdded يسلّم كل الحركات (حتى القديمة) بالترتيب
  _listenForMultiMoves(code) {
    const unsub = onChildAdded(ref(db, `rooms/${code}/moves`), (snap) => {
      const data = snap.val();
      if (!data || !data.by || !data.key) return;
      if (data.by === this.playerNum) return; // حركاتنا لا تُعاد علينا
      if (!this._cbMove) { this._pendingMoves.push(data); return; } // لسا نحمّل: نخزّن بالطابور
      this._cbMove(data.key, data.nextTurn, data.by, data.bank);
    });
    this._unsubs.push(unsub);
  }

  onLobbyUpdate(cb)  { this._cbLobby = cb; }
  onMultiStart(cb)   { this._cbMultiStart = cb; }
  onPlayerLeft(cb)   { this._cbPlayerLeft = cb; }

  _listenForMoves(code) {
    const unsub = onValue(ref(db, `rooms/${code}/move`), (snap) => {
      if (!snap.exists()) return;
      const data = snap.val();
      if (!data.by || !data.key) return;
      if (data.by === this.playerNum) return;
      const moveId = `${data.key}_${data.seq}`;
      if (moveId === this._lastApplied) return;
      this._lastApplied = moveId;
      // لو المستقبِل غير جاهز بعد (لسا يحمّل اللعبة): نخزّن الحركة معلّقة
      if (!this._cbMove) { this._pendingMove = data; this._lastApplied = null; return; }
      // للتعدد: نمرّر (مفتاح الخط، الدور التالي، صاحب الحركة)
      this._cbMove(data.key, data.nextTurn, data.by, data.bank);
    });
    this._unsubs.push(unsub);
  }

  // ══ الاستماع لمغادرة الخصم (للاعب 2) ════════════════════════
  // v35.6: على الغرفة كلها (كان على status وحده) — فتصل مع "انتهت" علامةُ من خرج
  // (leftBy/droppedN) في نفس اللقطة، بما فيها ما طبّقه Firebase محلياً عند انقطاعي أنا
  _listenForOpponentLeave(code) {
    let firstCall = true; // تجاهل أول استدعاء (القيمة الحالية)
    // طرف في مباراة: المنضمّ دائماً، والمضيف بعد أن بدأ — المضيف المنتظر لا يُنهي شيئاً بما يراه هنا
    // (منضمّ ألغى بحثه بلحظة انضمامه: تعيد _listenForPlayer2 فتح الغرفة ونكمل الانتظار — v35.8)
    const inMatch = () => this.playerNum === 2 || this._gameStarted;
    const myUid = getCurrentUser()?.uid || "";
    // اختفت مباراتنا قبل أن تبدأ (بلا نتيجة لأحد) — مرة واحدة، على آخر لقطة لغرفتنا نحن
    const vanish = () => {
      if (!inMatch() || (this._lastRoom && this._lastRoom.status === "finished")) return;
      this._lastRoom = { ...(this._lastRoom || {}), status: "finished", vanished: true };
      // أمر "انتهت + انقطع" المسلّح على الغرفة لم يعد يخصّنا (مراجعة v35.8 الثالثة): إغلاق الصفحة قبل أن تُظهر
      // الواجهة الرسالة كان يكتبه فوق غرفة المنتظر المُعادة ("منتهية" وهو ينتظر) — أو يُنشئ غرفة بقايا إن مُسحت
      try { onDisconnect(ref(db, `rooms/${code}`)).cancel().catch(() => {}); } catch {}
      this._cbLeft && this._cbLeft(this._lastRoom);
    };
    const unsub = onValue(ref(db, `rooms/${code}`), (snap) => {
      // نهاية لا رجعة فيها وصلتنا (اختفت الغرفة، أو أُلغيت قبل البدء): تبقى كما هي — لقطة لاحقة لا تمحوها
      // (غرفة أعادها منشئها أو فتحها من جديد كانت تكتب فوقها "تنتظر"، فيفوت الواجهةَ أن المباراة أُلغيت — مراجعة v35.8 الثانية)
      const lr = this._lastRoom;
      if (lr && lr.status === "finished" && (lr.vanished || lr.abortedBy)) return;
      if (!snap.exists()) {
        // اختفت الغرفة ونحن فيها (v35.8): مسحها أمر انقطاع منشئٍ أُغلقت صفحته بلحظة انضمامنا قبل أن يثبّت
        // بدء المباراة — لا خصم ولا مباراة. كنا ننتظر حركته الأولى للأبد (هو من يبدأ الساعة أيضاً):
        // نُنهيها بلا نتيجة لأحد. (انقطاعنا نحن يُطبَّق محلياً أيضاً — تفرزه الواجهة: غير متصل = انقطع اتصالك)
        // ولو في أول لقطة: الغرفة موجودة يقيناً لحظة التسجيل (انضمامنا اعتُمد، أو أنشأناها) — قد تُمسح بين
        // اعتماد انضمامنا وتسجيل المستمع (كشفه مستكشف البحث الثنائي)
        vanish();
        return;
      }
      const room = snap.val();
      // المنضمّ: مقعدي لم يعد لي في الغرفة = مباراتي اختفت (مراجعة v35.8 الثانية). منشئ سقط اتصاله بلحظة انضمامنا
      // (قبل أن يرى الانضمام) مسحها الخادم بأمره، ثم عاد فأعادها "تنتظر" بلا خصم — وقد يدخلها غيرنا. ولو في أول لقطة.
      // (نبني على آخر لقطة لغرفتنا نحن — لا على غرفة غيرنا: علاماتها (droppedN/leftBy) ليست لمباراتنا)
      if (this.playerNum === 2 && (room.status === "waiting" || (room.p2uid || "") !== myUid)) {
        vanish();
        return;
      }
      this._lastRoom = room;
      if (firstCall) { firstCall = false; return; }
      if (room.status === "finished" && inMatch()) {
        this._cbLeft && this._cbLeft(room);
      }
    });
    this._unsubs.push(unsub);
  }

  // ══ مغادرة ══════════════════════════════════════════════════
  // announce (الثنائي): نعلن الخروج (status: finished + leftBy) فقط لو خرجنا من مباراة جارية.
  // بعد نهاية المباراة عندي: مغادرة صامتة — وإلا يكتب الفائز leftBy فوق غرفة انتهت فيقرأها
  // من انقطع ثم عاد كأن خصمه انسحب (v35.6). الافتراضي true للمستدعين القدامى.
  leaveRoom(opts = {}) {
    // انسحاب جارٍ ينتظر حسم خروجي: نقرة خروج ثانية (المسار الهادئ) كانت تلغي أوامر الانقطاع كلها —
    // ومعها ختمي الذي يضمن خروجي لو أُغلقت الصفحة قبل الحسم (مقعد عالق). الآن تنتظر المغادرة نفسها.
    // (مراجعة v35.7 الثالثة)
    if (this._leaving && this._leavePromise) return this._leavePromise;
    const p = this._leaveRoomOnce(opts);
    this._leavePromise = p;
    p.then(() => { if (this._leavePromise === p) this._leavePromise = null; },
           () => { if (this._leavePromise === p) this._leavePromise = null; });
    return p;
  }
  async _leaveRoomOnce({ announce = true } = {}) {
    // 👁️ حماية: المشاهد لا يغادر عبر مسار اللاعبين إطلاقاً (وإلا تُنهى المباراة)
    if (this.isSpectator) return this.leaveSpectator();
    this._duoSearchSeq++;   // أي مغادرة تُنهي بحثاً ثنائياً ما زال جارياً (لا غرفة ولا انضمام بعدها — v35.8)
    // نتذكّر الغرفة التي نغادرها: لا نعود إليها فوراً في بحث جديد
    // (وإلا يعود الرافض لجولته نفسها فيُحبس كمنتظر — حلقة مغلقة)
    if (this.roomCode) this._recentlyLeft = { code: this.roomCode, at: Date.now() };
    // غرفة جماعية أثناء اللعب: نعلّم أنفسنا منسحبين — المباراة تكمل للباقين. (v35.7)
    // أولاً وقبل أي شيء، والمستمع ما زال متصلاً: الذاكرة المحلية دافئة فتنجح المعاملة من أول رحلة
    // (بعد فصل المستمعين كانت تُرفض وتُعاد)، فيُختم خروجنا بأقرب لحظة لضغط الزر — ولو أُغلقت الصفحة
    // قبل أن تكتمل تبقى أوامر الانقطاع مسلّحة فيُخرجنا الباقون بعد المهلة بدل مقعد عالق.
    // فقط لو خرجنا من مباراة جارية (announce) ولم نكن خارجها أصلاً: من خرج (نفد وقته/انقطع)
    // أو انتهت مباراته يغادر بصمت — لا سبب ولا لحظة خروج تُكتب فوق ما حدث.
    // مراجعة v35.7 الثانية: المعاملة قد تُلغى (كتابة محلية على مقعدي، أو انقطاع لحظي يطبّق فيه Firebase
    // أوامر انقطاعي محلياً) فتُعاد؛ وأمر ختم انقطاعي يبقى مسلّحاً حتى يُعتمد خروجي — لو أُغلقت الصفحة
    // قبلها يُخرجنا الباقون بعد المهلة ("انقطع") بدل مقعد عالق "نشط" ينتظرون بنكه كاملاً.
    // وبلا شبكة لا نعلّق زر الخروج: ننتظر قليلاً فقط، والمهمة تكمل وحدها بعد مغادرتنا.
    let withdraw = null;           // نتيجة الانسحاب إن حُسمت خلال الانتظار (القائمة كما اعتمدها الخادم)
    let exitUnsettled = false;     // انسحاب لم يُحسم بعد: لا نلغي أوامر الانقطاع (تُلغى عند حسمه)
    if (this.roomCode && this._isMulti && this._gameStarted && this._myUid && announce && !this._iAmOutLocally()) {
      this._leaving = true;
      const task = this._withdrawTask(this.roomCode, this._myUid);
      const waitMs = this._online === false ? 0 : 4000;
      withdraw = await Promise.race([task, new Promise(res => setTimeout(() => res(null), waitMs))]);
      exitUnsettled = !withdraw || !!withdraw.error;
    }
    // الثنائي، مضيف لم تبدأ عنده مباراة (يلغي غرفة تنتظر: بالكود، أو عشوائية ثم "العب ضد الكمبيوتر"):
    // إلغاء ذرّي (v35.8) — تُحذف إن كانت تنتظر وحدها، ومن دخلها بلحظة المغادرة تُلغى مباراته قبل بدئها.
    // كان "انسحاباً" (leftBy) يمنح المنضمّ بنفس اللحظة فوزاً من مجرد إلغاء، ومع announce=false كانت الغرفة
    // تبقى "تنتظر" بلا مضيف (أمر انقطاعه أُلغي) فيدخلها باحث ويعلق بلا خصم. تبدأ المعاملة هنا قبل فصل
    // المستمعين (ذاكرة دافئة = رحلة واحدة)، وأمر المسح عند الانقطاع يبقى مسلّحاً حتى تُحسم (مراجعة v35.8)
    const duoHostCancel = !!this.roomCode && !this._isMulti && this.playerNum === 1 && !this._gameStarted;
    if (duoHostCancel) this._cancelDuoHosting(this.roomCode);
    this._unsubs.forEach(u => u());
    this._unsubs = [];
    this._lastRoom = null;
    // إلغاء أي onDisconnect مسجّل للغرفة القديمة (وإلا يكتب فيها بعد مغادرتنا)
    // مستوى الغرفة يُلغى دائماً (الثنائي لا يضبط _myUid — كان يبقى مسلّحاً بعد المغادرة) — إلا غرفة ثنائية
    // نلغيها كمضيف: أمر مسحها يبقى حتى يُحسم الإلغاء، ثم يُلغيه _cancelDuoHosting
    // (الإلغاء على مسار يشمل كل ما تحته — فلا شيء منه وانسحابنا لم يُحسم: ختم انقطاعنا هو ضمانه)
    // تُرسل بترتيبها بلا انتظار ردودها (مراجعة v35.7 الرابعة): انقطاع أثناء انتظار الرد يُسقط الرد نهائياً
    // فلا ينتهي الانتظار أبداً — وزر الخروج يبقى معلّقاً حتى إعادة تحميل الصفحة. الخادم ينفّذها بترتيبها.
    const quiet = p => { try { p.catch(() => {}); } catch {} };
    if (this.roomCode && !exitUnsettled && !duoHostCancel) {
      try { quiet(onDisconnect(ref(db, `rooms/${this.roomCode}`)).cancel()); } catch {}
    }
    if (this.roomCode && this._myUid && !exitUnsettled) {
      try {
        quiet(onDisconnect(ref(db, `rooms/${this.roomCode}/players/${this._myUid}`)).cancel());
        quiet(onDisconnect(ref(db, `rooms/${this.roomCode}/players/${this._myUid}/disconnectedAt`)).cancel());
      } catch {}
    }
    if (this.roomCode) {
      if (this._isMulti && this._gameStarted) {
        // غرفة جماعية أثناء اللعب: خروجنا (إن كان انسحاباً) كُتب أعلاه قبل فصل المستمعين
      } else if (this._isMulti && !this._gameStarted) {
        // في اللوبي الجماعي: نزيل أنفسنا فقط. لو كنا المنشئ وبقي آخرون → الغرفة تستمر لهم
        // (نقل الملكية: أصغر رقم حاضر يتولّى المسؤولية — يُحسب عند العملاء)
        try {
          await remove(ref(db, `rooms/${this.roomCode}/players/${this._myUid}`));
          const snap = await get(ref(db, `rooms/${this.roomCode}/players`));
          const rest = snap.exists() ? Object.values(snap.val()) : [];
          if (rest.length === 0) {
            // لم يبقَ أحد → نحذف الغرفة كاملة
            await remove(ref(db, `rooms/${this.roomCode}`));
          } else {
            // تحديث العدّاد ونقل الملكية لأصغر رقم حاضر
            const nums = rest.map(p => p.num).sort((a, b) => a - b);
            await update(ref(db, `rooms/${this.roomCode}`), {
              playerCount: rest.length,
              hostNum: nums[0],
            });
          }
        } catch {}
      } else if (duoHostCancel) {
        // الثنائي، مضيف لم تبدأ عنده مباراة: أُلغيت الغرفة ذرّياً أعلاه (قبل فصل المستمعين)
      } else {
        // الثنائي: ننهي المباراة فقط إذا كنّا لاعبين فيها فعلاً
        // (leaveRoom تُستدعى أيضاً كتنظيف قبل البحث — يجب ألّا تُنهي غرفة غيرنا)
        if (this.playerNum && announce) {
          await update(ref(db, `rooms/${this.roomCode}`), {
            status: "finished", leftBy: this.playerNum,
          });
        }
      }
    }
    this.roomCode  = null;
    this.playerNum = null;
    this._isMulti  = false;
    this.isSpectator = false;  // وضع المشاهدة (قراءة فقط)
    this._gameStarted = false;
    this._lastMoveKey = null;
    this._lastApplied = null;
    this._pendingMove = null;
    this._pendingMoves = [];
    // تصفير كل الحالة المخزّنة والمستمعات (وإلا تُسلَّم بيانات غرفة قديمة للبحث الجديد)
    this._lastClock = null;
    this._lastPlayers = null;
    this._lastApproval = null;
    this._lastBankSeq = null;
    this._cbClock = null;
    this._cbApproval = null;
    this._cbBankUpdate = null;
    this._cbLobby = null;
    this._cbMultiStart = null;
    this._cbPlayerLeft = null;
    // v35.6 (مراجعة): معالجات نهاية المباراة والحركات تُفصل مع المغادرة — وإلا تلتقط أحداث
    // الغرفة التالية قبل أن تسجّل مباراتها معالجاتها (فوز يُسجَّل مرتين، أو حركات أولى تضيع
    // في معالج قديم بدل أن تنتظر في الطابور). ما يصل قبل التسجيل يُسلَّم عنده (onOpponentLeft).
    this._cbLeft = null;
    this._cbRestart = null;
    this._cbMove = null;
    this._leaving = false;
    this._rearmPending = false;
    // withdraw: { ok, players } حُسم الانسحاب (ok = اعتُمد؛ وإلا كنّا خارجين قبله)، أو null (لم يُحسم بعد)
    return { withdraw: withdraw && !withdraw.error ? withdraw : null };
  }

  // ══ مهمة الانسحاب من مباراة جماعية جارية (v35.7، مراجعة ثانية) ══
  // مستقلة عن حالة الغرفة الحالية (قد نغادر قبل اكتمالها، وقد تبدأ مباراة جديدة): تعيد المحاولة حتى
  // يُعتمد خروجنا "انسحب" أو نجد أنفسنا خارجين أصلاً (أخرجنا غيرنا بعد المهلة / نفد وقتنا) —
  // وعندها فقط نلغي أمر ختم انقطاعنا. بعد انقطاع يكون الخادم قد استهلك ذلك الأمر: نعيد تسليحه قبل كل
  // محاولة جديدة (تسجيله لا يكتب بيانات فلا يُلغي المعاملة) — فلو أُغلقت الصفحة قبل الحسم يُخرجنا الباقون.
  _withdrawTask(code, uid) {
    const stampRef = ref(db, `rooms/${code}/players/${uid}/disconnectedAt`);
    return (async () => {
      const r = await this._markOutReliably(u => u === uid, "left", { disconnectedAt: null }, {
        code, tries: 8,
        onRetry: () => { onDisconnect(stampRef).set(serverTimestamp()).catch(() => {}); },
      });
      // (بلا انتظار الرد: انقطاع أثناء انتظاره يُسقطه فتبقى المهمة معلّقة — مراجعة v35.7 الخامسة)
      if (!r.error) { try { onDisconnect(stampRef).cancel().catch(() => {}); } catch {} }
      return r;
    })();
  }

  // ══ إرسال إشعار restart ═════════════════════════════════════
  async sendRestart() {
    if (!this.roomCode) return;
    // نكتب في node منفصل عشان ما يتداخل مع status
    await update(ref(db, `rooms/${this.roomCode}/signals`), {
      restart: this.playerNum,
      ts: Date.now(),
    });
  }

  // ══ الاستماع لـ restart ══════════════════════════════════════
  _listenForRestart(code) {
    const unsub = onValue(ref(db, `rooms/${code}/signals/restart`), (snap) => {
      if (!snap.exists()) return;
      const by = snap.val();
      if (by && by !== this.playerNum) {
        this._cbRestart && this._cbRestart();
      }
    });
    this._unsubs.push(unsub);
  }

  onRestart(cb)       { this._cbRestart = cb; }
  onMove(cb) {
    this._cbMove = cb;
    // تسليم طابور الحركات الجماعية المعلّقة (بالترتيب)
    if (this._pendingMoves && this._pendingMoves.length) {
      const q = this._pendingMoves; this._pendingMoves = [];
      q.forEach(d => cb(d.key, d.nextTurn, d.by, d.bank));
    }
    // تسليم حركة معلّقة (الثنائي)
    if (this._pendingMove) {
      const d = this._pendingMove; this._pendingMove = null;
      const moveId = `${d.key}_${d.seq}`;
      if (moveId !== this._lastApplied) {
        this._lastApplied = moveId;
        cb(d.key, d.nextTurn, d.by, d.bank);
      }
    }
  }
  onOpponentJoined(cb){ this._cbJoined  = cb; }
  onOpponentLeft(cb)  {
    this._cbLeft = cb;
    // "انتهت" وصلت قبل تسجيل المعالج (أول لحظات المباراة، قبل اكتمال تحميلها) → نسلّمها الآن
    // بدل أن تضيع (المعالج يقرّر من اللقطة نفسها؛ ويتجاهلها لو كانت المباراة منتهية عنده) — v35.6
    const r = this._lastRoom;
    if (cb && r && r.status === "finished") {
      setTimeout(() => { if (this._cbLeft === cb && this._lastRoom === r) cb(r); }, 0);
    }
  }
  onConnectionChange(cb) { this._cbConnection = cb; }
  isMyTurn(cp)        { return !this.isSpectator && cp === this.playerNum; }

  // ══ مراقبة الاتصال بـ Firebase ══════════════════════════════
  _monitorConnection() {
    const connRef = ref(db, ".info/connected");
    const unsub   = onValue(connRef, snap => {
      const connected = snap.val();
      this._online = connected;   // v35.6: من كان غير متصل لحظة النهاية لا يعلن فوزاً
      // مباراة جماعية جارية وأنا فيها: أوامر الانقطاع تخصّ الاتصال الذي سُجّلت عليه (يستهلكها الخادم
      // عند سقوطه، وقد يضيع تسجيلها لو سقط قبل تأكيدها) — نعيد تسليح ختمي على كل اتصال جديد.
      // (لا على مقعد خارج أو غير ظاهر، ولا أثناء انسحابي — مراجعة v35.7 الثالثة)
      if (connected === true && this._isMulti && this._gameStarted && this.roomCode && this._myUid
          && !this.isSpectator && !this._leaving && !this._iAmOutLocally()) {
        if (this._mySeatLive()) this._armMyStamp();
        else this._rearmPending = true;      // النسخة المحلية لا تُظهر مقعدي بعد: أول لقطة من الخادم تقرّر
      }
      this._cbConnection && this._cbConnection(connected);
    });
    this._unsubs.push(unsub);
  }
  isMyTurn(cp)        { return !this.isSpectator && cp === this.playerNum; }

  async getOpponentUid() {
    if (!this.roomCode) return null;
    const snap = await get(ref(db, `rooms/${this.roomCode}`));
    if (!snap.exists()) return null;
    const room = snap.val();
    return this.playerNum === 1 ? room.p2uid : room.p1uid;
  }
}

export const onlineManager = new OnlineManager();
