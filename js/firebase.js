// 📄 firebase.js — v11.8
import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, onDisconnect, remove, off, runTransaction, onChildAdded, push, serverTimestamp }
                            from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getCurrentUser }   from "./auth.js?v=1786920203";

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
      if (age > oneHour || room.status === "finished") {
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
  }

  // ══ إنشاء غرفة ══════════════════════════════════════════════
  async createRoom(cfg, name) {
    const code = genCode();
    this.roomCode  = code;
    this.playerNum = 1;
    this._gameStarted = false;

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

    onDisconnect(ref(db, `rooms/${code}`)).remove();
    this._listenForPlayer2(code);
    this._listenForMoves(code);
    this._listenBankUpdate(code);
    this._listenClock(code);
    this._watchServerOffset();
    this._listenForRestart(code);
    this._monitorConnection();
    return code;
  }

  // ══ الانضمام ════════════════════════════════════════════════
  async joinRoom(code, name) {
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists())             throw new Error("الغرفة غير موجودة!");
    const room = snap.val();
    if (room.status !== "waiting")  throw new Error("الغرفة ممتلئة أو انتهت!");

    this.roomCode  = code;
    this.playerNum = 2;
    this._gameStarted = false;

    await update(ref(db, `rooms/${code}`), {
      p2name: name,
      p2uid:  getCurrentUser()?.uid || "",
      status: "playing",
    });

    onDisconnect(ref(db, `rooms/${code}/status`)).set("finished");
    this._listenForMoves(code);
    this._listenBankUpdate(code);
    this._listenClock(code);
    this._watchServerOffset();
    this._listenForOpponentLeave(code);
    this._listenForRestart(code);
    this._monitorConnection();
    return { cfg: room.cfg, p1name: room.p1name, p1uid: room.p1uid };
  }

  // ══ مطابقة عشوائية (زي السنوكر) ═══════════════════════════════
  // تبحث عن خصم ينتظر؛ إن وُجد تنضم إليه، وإلا تنشئ غرفة عامة وتنتظر
  async findRandomMatch(cfg, name) {
    const myUid = getCurrentUser()?.uid || "";
    // نبحث عن غرف عامة منتظرة
    let joinCode = null, joinRoom = null;
    try {
      const snap = await get(ref(db, "rooms"));
      if (snap.exists()) {
        const rooms = snap.val();
        for (const [code, room] of Object.entries(rooms)) {
          if (room && room.public === true && room.status === "waiting"
              && room.p1uid !== myUid
              && room.cfg && Number(room.cfg.rows) === Number(cfg.rows)) {
            joinCode = code; joinRoom = room; break;
          }
        }
      }
    } catch {}

    if (joinCode) {
      // ننضم كخصم — نحاول حجز المكان
      this.roomCode  = joinCode;
      this.playerNum = 2;
      this._gameStarted = false;
      await update(ref(db, `rooms/${joinCode}`), {
        p2name: name, p2uid: myUid, status: "playing", public: false,
      });
      onDisconnect(ref(db, `rooms/${joinCode}/status`)).set("finished");
      this._listenForMoves(joinCode);
      this._listenBankUpdate(joinCode);
      this._listenClock(joinCode);
      this._watchServerOffset();
      this._listenForOpponentLeave(joinCode);
      this._listenForRestart(joinCode);
      this._monitorConnection();
      return { role: "guest", code: joinCode, cfg: joinRoom.cfg,
               p1name: joinRoom.p1name, p1uid: joinRoom.p1uid };
    }

    // لا يوجد خصم — ننشئ غرفة عامة وننتظر
    const code = genCode();
    this.roomCode  = code;
    this.playerNum = 1;
    this._gameStarted = false;
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
    onDisconnect(ref(db, `rooms/${code}`)).remove();
    this._listenForPlayer2(code);
    this._listenForMoves(code);
    this._listenBankUpdate(code);
    this._listenClock(code);
    this._watchServerOffset();
    this._listenForOpponentLeave(code);
    this._listenForRestart(code);
    this._monitorConnection();
    return { role: "host", code };
  }

  // إلغاء انتظار المطابقة العشوائية
  async cancelRandomMatch() {
    if (this.roomCode && this.playerNum === 1) {
      try { await remove(ref(db, `rooms/${this.roomCode}`)); } catch {}
    }
    this.roomCode = null; this.playerNum = null;
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
    await update(ref(db, `rooms/${this.roomCode}/move`), {
      key: lineKey,
      by:  this.playerNum,
      seq: seq,  // رقم تسلسلي يضمن عدم تكرار نفس الحركة
      ...(bankLeft != null ? { bank: bankLeft } : {}),
      ...(nextTurn != null ? { nextTurn } : {}),
    });
  }

  // ══ الاستماع لانضمام اللاعب 2 ══════════════════════════════
  _listenForPlayer2(code) {
    const unsub = onValue(ref(db, `rooms/${code}`), (snap) => {
      if (!snap.exists()) return;
      const room = snap.val();
      if (room.status === "playing" && !this._gameStarted && room.p2name) {
        this._gameStarted = true;
        // بدأ اللعب: نغيّر سلوك الانقطاع من "مسح" إلى "إنهاء" (ليصل إشعار للخصم)
        try {
          onDisconnect(ref(db, `rooms/${code}`)).cancel();
          onDisconnect(ref(db, `rooms/${code}/status`)).set("finished");
        } catch {}
        this._cbJoined && this._cbJoined(room.p2name);
      }
      if (room.status === "finished" && this._gameStarted) {
        this._cbLeft && this._cbLeft();
      }
    });
    this._unsubs.push(unsub);
  }

  // ══ الاستماع للحركات ════════════════════════════════════════
  // كشف نوع الغرفة (multi أو duo) قبل الانضمام
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
    // عند انقطاع المضيف في اللوبي: تُمسح الغرفة
    onDisconnect(ref(db, `rooms/${code}`)).remove();
    this._listenLobby(code);
    this._listenForMultiMoves(code);
    this._listenBankUpdate(code);
    this._listenClock(code);
    this._listenApproval(code);
    this._watchServerOffset();
    this._monitorConnection();
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
    if (room.playerCount >= room.maxPlayers) throw new Error("الغرفة ممتلئة!");

    // نستخدم transaction لضمان رقم لاعب فريد (يمنع تعارض الانضمام المتزامن)
    let myNum = null;
    const roomRef = ref(db, `rooms/${code}`);
    await runTransaction(roomRef, (cur) => {
      if (!cur) return cur;
      if (cur.status !== "lobby") return cur; // بدأت المباراة
      const count = cur.playerCount || Object.keys(cur.players || {}).length;
      if (count >= cur.maxPlayers) return cur; // ممتلئة
      myNum = count + 1;
      cur.players = cur.players || {};
      cur.players[myUid] = { name, num: myNum, active: true };
      cur.playerCount = myNum;
      return cur;
    });

    if (!myNum) throw new Error("تعذّر الانضمام (الغرفة ممتلئة أو بدأت)!");

    this.roomCode  = code;
    this.playerNum = myNum;
    this._isMulti  = true;
    this._gameStarted = false;
    this._myUid = myUid;

    // عند انقطاع اللاعب: نعلّمه غير نشط
    onDisconnect(ref(db, `rooms/${code}/players/${myUid}/disconnectedAt`)).set(serverTimestamp());
    this._listenLobby(code);
    this._listenForMultiMoves(code);
    this._listenBankUpdate(code);
    this._listenClock(code);
    this._listenApproval(code);
    this._watchServerOffset();
    this._monitorConnection();
    return { code, myNum, cfg: room.cfg, maxPlayers: room.maxPlayers };
  }

  // المضيف يبدأ المباراة
  async startMultiGame() {
    if (!this.roomCode) return;
    await update(ref(db, `rooms/${this.roomCode}`), { status: "playing", turn: 1 });
  }

  // الاستماع للوبي (انضمام/خروج لاعبين + بدء المباراة)
  _listenLobby(code) {
    const unsub = onValue(ref(db, `rooms/${code}`), (snap) => {
      if (!snap.exists()) { this._cbPlayerLeft && this._cbPlayerLeft("host_left"); return; }
      const room = snap.val();
      const players = room.players || {};
      // تحديث قائمة اللوبي
      this._cbLobby && this._cbLobby(players, room);
      // بدء المباراة
      if (room.status === "playing" && !this._gameStarted) {
        this._gameStarted = true;
        // عند بدء اللعب: المضيف يبدّل onDisconnect لعدم مسح الغرفة
        if (this.playerNum === 1) {
          try {
            onDisconnect(ref(db, `rooms/${code}`)).cancel();
            onDisconnect(ref(db, `rooms/${code}/players/${this._myUid}/disconnectedAt`)).set(serverTimestamp());
          } catch {}
        }
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
    let foundCode = null;
    try {
      const snap = await get(ref(db, "rooms"));
      if (snap.exists()) {
        for (const [code, room] of Object.entries(snap.val())) {
          if (room && room.multi === true && room.public === true
              && room.status === "lobby"
              && Number(room.maxPlayers) === Number(wantedPlayers)
              && room.cfg && Number(room.cfg.rows) === Number(cfg.rows)
              && (room.playerCount || 0) < room.maxPlayers
              && !(room.players && room.players[myUid])) {
            foundCode = code; break;
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

  // تعليم نفسي/لاعب آخر خارج المباراة (نفاد بنك الوقت — نمط bank)
  async markSelfInactive() {
    if (!this.roomCode || !this._myUid) return;
    try { await update(ref(db, `rooms/${this.roomCode}/players/${this._myUid}`), { active: false }); } catch {}
  }
  async markPlayerInactiveByNum(num) {
    if (!this.roomCode) return;
    try {
      const snap = await get(ref(db, `rooms/${this.roomCode}/players`));
      if (!snap.exists()) return;
      for (const [uid, p] of Object.entries(snap.val())) {
        if (p && p.num === num && p.active !== false) {
          await update(ref(db, `rooms/${this.roomCode}/players/${uid}`), { active: false });
          return;
        }
      }
    } catch {}
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
  async markWaitStart() {
    if (!this.roomCode) return;
    try {
      const snap = await get(ref(db, `rooms/${this.roomCode}/waitStartedAt`));
      if (snap.exists() && snap.val()) return; // مضبوط مسبقاً — لا نعيده
      await update(ref(db, `rooms/${this.roomCode}`), { waitStartedAt: serverTimestamp() });
    } catch {}
  }

  // تنظيف حالة الموافقة والانتظار (عند بدء المباراة أو المغادرة)
  async clearApprovalState() {
    if (!this.roomCode) return;
    try {
      await update(ref(db, `rooms/${this.roomCode}`), { approval: null, waitStartedAt: null });
    } catch {}
  }

  // ══ مهلة السماح عند الانقطاع (Grace Period) ══
  // عند عودة الاتصال: نمسح ختم الانقطاع (اللاعب رجع ضمن المهلة)
  async clearMyDisconnectMark() {
    if (!this.roomCode || !this._myUid) return;
    try {
      await update(ref(db, `rooms/${this.roomCode}/players/${this._myUid}`), { disconnectedAt: null });
      // مهم: onDisconnect يُستهلك بعد انطلاقه — نعيد تسجيله ليعمل في الانقطاعات التالية
      onDisconnect(ref(db, `rooms/${this.roomCode}/players/${this._myUid}/disconnectedAt`)).set(serverTimestamp());
    } catch {}
  }

  // إخراج لاعب تجاوز مهلة السماح (يُنفّذها أي جهاز متصل — الحساب حتمي فالتكرار غير ضار)
  async expirePlayerByNum(num) {
    if (!this.roomCode) return;
    try {
      const snap = await get(ref(db, `rooms/${this.roomCode}/players`));
      if (!snap.exists()) return;
      for (const [uid, p] of Object.entries(snap.val())) {
        if (p && p.num === num && p.active !== false) {
          await update(ref(db, `rooms/${this.roomCode}/players/${uid}`), { active: false, disconnectedAt: null });
          return;
        }
      }
    } catch {}
  }

  // ══ جولة الموافقة (المطابقة العشوائية الجماعية بعدد ناقص) ══
  // المنشئ يفتح الجولة: كل اللاعبين الحاضرين "pending" حتى يقرّروا
  async startApprovalRound(availableCount, wantedCount) {
    if (!this.roomCode) return;
    try {
      // حماية: لا نعيد بناء جولة قائمة (وإلا تُمحى قرارات اللاعبين المسجّلة)
      const cur = await get(ref(db, `rooms/${this.roomCode}/approval`));
      if (cur.exists() && cur.val()?.state === "asking") return;
      const snap = await get(ref(db, `rooms/${this.roomCode}/players`));
      if (!snap.exists()) return;
      const decisions = {};
      Object.values(snap.val()).forEach(p => { decisions[p.num] = "pending"; });
      await update(ref(db, `rooms/${this.roomCode}/approval`), {
        state: "asking", available: availableCount, wanted: wantedCount,
        startedAt: serverTimestamp(), decisions,
      });
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
  _listenForOpponentLeave(code) {
    let firstCall = true; // تجاهل أول استدعاء (القيمة الحالية)
    const unsub = onValue(ref(db, `rooms/${code}/status`), (snap) => {
      if (firstCall) { firstCall = false; return; }
      if (snap.val() === "finished") {
        this._cbLeft && this._cbLeft();
      }
    });
    this._unsubs.push(unsub);
  }

  // ══ مغادرة ══════════════════════════════════════════════════
  async leaveRoom() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
    if (this.roomCode) {
      if (this._isMulti && this._gameStarted) {
        // غرفة جماعية أثناء اللعب: نعلّم أنفسنا منسحبين فقط — المباراة تكمل للباقين
        try { await update(ref(db, `rooms/${this.roomCode}/players/${this._myUid}`), { active: false }); } catch {}
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
      } else {
        // الثنائي: كما كان
        await update(ref(db, `rooms/${this.roomCode}`), { status: "finished" });
      }
    }
    this.roomCode  = null;
    this.playerNum = null;
    this._isMulti  = false;
    this._gameStarted = false;
    this._lastMoveKey = null;
    this._lastApplied = null;
    this._pendingMove = null;
    this._pendingMoves = [];
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
  onOpponentLeft(cb)  { this._cbLeft    = cb; }
  onConnectionChange(cb) { this._cbConnection = cb; }
  isMyTurn(cp)        { return cp === this.playerNum; }

  // ══ مراقبة الاتصال بـ Firebase ══════════════════════════════
  _monitorConnection() {
    const connRef = ref(db, ".info/connected");
    const unsub   = onValue(connRef, snap => {
      const connected = snap.val();
      this._cbConnection && this._cbConnection(connected);
    });
    this._unsubs.push(unsub);
  }
  isMyTurn(cp)        { return cp === this.playerNum; }

  async getOpponentUid() {
    if (!this.roomCode) return null;
    const snap = await get(ref(db, `rooms/${this.roomCode}`));
    if (!snap.exists()) return null;
    const room = snap.val();
    return this.playerNum === 1 ? room.p2uid : room.p1uid;
  }
}

export const onlineManager = new OnlineManager();
