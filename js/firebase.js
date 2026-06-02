// 📄 firebase.js — v11.8
import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, onDisconnect, remove, off }
                            from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getCurrentUser }   from "./auth.js?v=1780438051";

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
        this._cbJoined && this._cbJoined(room.p2name);
      }
      if (room.status === "finished" && this._gameStarted) {
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

  onRestart(cb)       { this._cbRestart = cb; }
  onMove(cb)          { this._cbMove    = cb; }
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
