// 📄 firebase.js — v11.8
import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, onDisconnect, remove, off, runTransaction, onChildAdded, push }
                            from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getCurrentUser }   from "./auth.js?v=1783792812";

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
  async pushMove(lineKey, seq) {
    if (!this.roomCode) return;
    await update(ref(db, `rooms/${this.roomCode}/move`), {
      key: lineKey,
      by:  this.playerNum,
      seq: seq,  // رقم تسلسلي يضمن عدم تكرار نفس الحركة
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
    onDisconnect(ref(db, `rooms/${code}/players/${myUid}/active`)).set(false);
    this._listenLobby(code);
    this._listenForMultiMoves(code);
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
            onDisconnect(ref(db, `rooms/${code}/players/${this._myUid}/active`)).set(false);
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
  async pushMultiMove(lineKey, nextTurn, seq) {
    if (!this.roomCode) return;
    // سجل حركات كامل (append) — لا حركة تمحو أخرى، والمتأخر يستلم الكل بالترتيب
    const mref = push(ref(db, `rooms/${this.roomCode}/moves`));
    await set(mref, { key: lineKey, by: this.playerNum, seq: seq || Date.now(), nextTurn });
    await update(ref(db, `rooms/${this.roomCode}`), { turn: nextTurn });
  }

  // مستمع سجل الحركات الجماعي — onChildAdded يسلّم كل الحركات (حتى القديمة) بالترتيب
  _listenForMultiMoves(code) {
    const unsub = onChildAdded(ref(db, `rooms/${code}/moves`), (snap) => {
      const data = snap.val();
      if (!data || !data.by || !data.key) return;
      if (data.by === this.playerNum) return; // حركاتنا لا تُعاد علينا
      if (!this._cbMove) { this._pendingMoves.push(data); return; } // لسا نحمّل: نخزّن بالطابور
      this._cbMove(data.key, data.nextTurn, data.by);
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
      this._cbMove(data.key, data.nextTurn, data.by);
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
        // في اللوبي الجماعي: المضيف يمسح الغرفة، الضيف يزيل نفسه
        try {
          if (this.playerNum === 1) {
            await remove(ref(db, `rooms/${this.roomCode}`));
          } else {
            await remove(ref(db, `rooms/${this.roomCode}/players/${this._myUid}`));
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
      q.forEach(d => cb(d.key, d.nextTurn, d.by));
    }
    // تسليم حركة معلّقة (الثنائي)
    if (this._pendingMove) {
      const d = this._pendingMove; this._pendingMove = null;
      const moveId = `${d.key}_${d.seq}`;
      if (moveId !== this._lastApplied) {
        this._lastApplied = moveId;
        cb(d.key, d.nextTurn, d.by);
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
