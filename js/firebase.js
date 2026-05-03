// 📄 firebase.js — v11.7
// إدارة اللعب الأونلاين عبر Firebase Realtime Database

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, set, get, onValue, update, remove, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDnPrPobXSL8vc7Cr_AAVO6K03sc7gAgWA",
  authDomain: "jazma-e17c5.firebaseapp.com",
  projectId: "jazma-e17c5",
  storageBucket: "jazma-e17c5.firebasestorage.app",
  messagingSenderId: "924710370216",
  appId: "1:924710370216:web:99d697db3cfca06492fb9d",
  measurementId: "G-96RYZW0XGM",
  databaseURL: "https://jazma-e17c5-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// توليد كود غرفة عشوائي (6 أرقام)
function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export class OnlineManager {
  constructor() {
    this.roomCode    = null;
    this.playerNum   = null;   // 1 أو 2
    this.playerName  = null;
    this._listeners  = [];     // لإلغاء كل المستمعين عند المغادرة

    // Callbacks
    this._onOpponentJoined = null;
    this._onOpponentLeft   = null;
    this._onMove           = null;
    this._onRematch        = null;
  }

  // ─── إنشاء غرفة ──────────────────────────────────────────────
  async createRoom(cfg, playerName) {
    const code = generateRoomCode();
    this.roomCode   = code;
    this.playerNum  = 1;
    this.playerName = playerName;

    await set(ref(db, `rooms/${code}`), {
      cfg:    { rows: cfg.rows, cols: cfg.cols },
      status: "waiting",
      players: {
        1: { name: playerName, online: true },
      },
      gameState: {
        lines: [],
        currentPlayer: 1,
        scores: { 1: 0, 2: 0 },
        lastMove: null,
        lastMoveBy: null,
      },
      rematch: null,
    });

    // لو انقطع الاتصال، نحذف الغرفة تلقائياً
    onDisconnect(ref(db, `rooms/${code}`)).remove();

    this._listenStatus(code);
    this._listenGameState(code);
    this._listenRematch(code);

    return code;
  }

  // ─── الانضمام لغرفة ──────────────────────────────────────────
  async joinRoom(code, playerName) {
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists())              throw new Error("الغرفة غير موجودة!");
    const room = snap.val();
    if (room.status !== "waiting")   throw new Error("الغرفة ممتلئة أو انتهت!");

    this.roomCode   = code;
    this.playerNum  = 2;
    this.playerName = playerName;

    await update(ref(db, `rooms/${code}`), {
      "players/2": { name: playerName, online: true },
      status: "playing",
    });

    onDisconnect(ref(db, `rooms/${code}/players/2/online`)).set(false);

    this._listenStatus(code);
    this._listenGameState(code);
    this._listenRematch(code);

    return room.cfg;
  }

  // ─── إرسال حركة ──────────────────────────────────────────────
  async sendMove(lineKey, newCurrentPlayer, newScores) {
    if (!this.roomCode) return;
    await update(ref(db, `rooms/${this.roomCode}/gameState`), {
      lines:         newCurrentPlayer === 1 ? [] : [],  // placeholder — نبنيها أسفل
      currentPlayer: newCurrentPlayer,
      scores:        newScores,
      lastMove:      lineKey,
      lastMoveBy:    this.playerNum,
    });
  }

  // ─── إرسال الحالة الكاملة (أدق وأأمن) ───────────────────────
  async pushState(linesArray, currentPlayer, scores, lastMove) {
    if (!this.roomCode) return;
    await update(ref(db, `rooms/${this.roomCode}/gameState`), {
      lines:         linesArray,
      currentPlayer: currentPlayer,
      scores:        scores,
      lastMove:      lastMove,
      lastMoveBy:    this.playerNum,
    });
  }

  // ─── طلب إعادة مباراة ────────────────────────────────────────
  async requestRematch() {
    if (!this.roomCode) return;
    await update(ref(db, `rooms/${this.roomCode}/rematch`), {
      [`player${this.playerNum}`]: true,
    });
  }

  // ─── الاستماع لحالة الغرفة ───────────────────────────────────
  _listenStatus(code) {
    const unsub = onValue(ref(db, `rooms/${code}/players`), (snap) => {
      if (!snap.exists()) return;
      const players = snap.val();
      // اللاعب 2 انضم
      if (players[2] && this.playerNum === 1 && this._onOpponentJoined) {
        this._onOpponentJoined(players[2].name);
      }
      // أحد اللاعبين قطع الاتصال
      if (this.playerNum === 1 && players[2] && players[2].online === false && this._onOpponentLeft) {
        this._onOpponentLeft();
      }
      if (this.playerNum === 2 && players[1] && players[1].online === false && this._onOpponentLeft) {
        this._onOpponentLeft();
      }
    });
    this._listeners.push(unsub);
  }

  // ─── الاستماع لحركات الخصم ───────────────────────────────────
  _listenGameState(code) {
    const unsub = onValue(ref(db, `rooms/${code}/gameState`), (snap) => {
      if (!snap.exists()) return;
      const data = snap.val();
      // نستقبل فقط حركات الخصم
      if (data.lastMoveBy && data.lastMoveBy !== this.playerNum && this._onMove) {
        this._onMove(data);
      }
    });
    this._listeners.push(unsub);
  }

  // ─── الاستماع لطلب إعادة مباراة ─────────────────────────────
  _listenRematch(code) {
    const unsub = onValue(ref(db, `rooms/${code}/rematch`), (snap) => {
      if (!snap.exists() || !this._onRematch) return;
      const data = snap.val();
      const otherKey = this.playerNum === 1 ? "player2" : "player1";
      if (data && data[otherKey]) {
        this._onRematch();
      }
    });
    this._listeners.push(unsub);
  }

  // ─── جلب اسم الخصم ───────────────────────────────────────────
  async getOpponentName() {
    const otherNum = this.playerNum === 1 ? 2 : 1;
    const snap = await get(ref(db, `rooms/${this.roomCode}/players/${otherNum}/name`));
    return snap.exists() ? snap.val() : "الخصم";
  }

  // ─── مغادرة الغرفة ───────────────────────────────────────────
  async leaveRoom() {
    this._listeners.forEach(unsub => unsub());
    this._listeners = [];
    if (this.roomCode) {
      await update(ref(db, `rooms/${this.roomCode}`), { status: "finished" });
    }
    this.roomCode   = null;
    this.playerNum  = null;
    this.playerName = null;
  }

  // ─── Callbacks ───────────────────────────────────────────────
  onOpponentJoined(cb) { this._onOpponentJoined = cb; }
  onOpponentLeft(cb)   { this._onOpponentLeft   = cb; }
  onMove(cb)           { this._onMove           = cb; }
  onRematch(cb)        { this._onRematch        = cb; }

  isMyTurn(currentPlayer) { return currentPlayer === this.playerNum; }
}

export const onlineManager = new OnlineManager();
