// 📄 firebase.js — v11.8
import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, onDisconnect }
                            from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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
  }

  // ══ إنشاء غرفة ══════════════════════════════════════════════
  async createRoom(cfg, name) {
    const code = genCode();
    this.roomCode  = code;
    this.playerNum = 1;
    this._gameStarted = false;

    await set(ref(db, `rooms/${code}`), {
      cfg:    { rows: cfg.rows, cols: cfg.cols },
      status: "waiting",
      p1name: name,
      p2name: "",
      move: { key: "", by: 0, seq: 0 },  // ✅ نستخدم seq لتمييز الحركات
    });

    onDisconnect(ref(db, `rooms/${code}`)).remove();
    this._listenForPlayer2(code);
    this._listenForMoves(code);
    this._listenForRestart(code);
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
      status: "playing",
    });

    onDisconnect(ref(db, `rooms/${code}/status`)).set("finished");
    this._listenForMoves(code);
    this._listenForOpponentLeave(code);
    this._listenForRestart(code);
    return { cfg: room.cfg, p1name: room.p1name };
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

  // ══ الاستماع لانضمام اللاعب 2 (مرة وحدة فقط) ═══════════════
  _listenForPlayer2(code) {
    const unsub = onValue(ref(db, `rooms/${code}/status`), (snap) => {
      if (snap.val() === "playing" && !this._gameStarted) {
        this._gameStarted = true;
        // اجلب اسم اللاعب 2
        get(ref(db, `rooms/${code}/p2name`)).then(s => {
          this._cbJoined && this._cbJoined(s.val() || "اللاعب 2");
        });
      }
      if (snap.val() === "finished" && this._gameStarted) {
        this._cbLeft && this._cbLeft();
      }
    });
    this._unsubs.push(unsub);
  }

  // ══ الاستماع للحركات ════════════════════════════════════════
  _listenForMoves(code) {
    const unsub = onValue(ref(db, `rooms/${code}/move`), (snap) => {
      if (!snap.exists()) return;
      const data = snap.val();
      if (!data.by || !data.key) return;
      if (data.by === this.playerNum) return;
      const moveId = `${data.key}_${data.seq}`;
      if (moveId === this._lastApplied) return;
      this._lastApplied = moveId;
      this._cbMove && this._cbMove(data.key);
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
      await update(ref(db, `rooms/${this.roomCode}`), { status: "finished" });
    }
    this.roomCode  = null;
    this.playerNum = null;
    this._gameStarted = false;
    this._lastMoveKey = null;
    this._lastApplied = null;
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

  onRestart(cb) { this._cbRestart = cb; }
}

export const onlineManager = new OnlineManager();
