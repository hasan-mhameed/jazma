// 📄 leaderboard.js — v12.3
import { getDatabase, ref, get }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getApps, initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

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

export async function getLeaderboard(limit = 10) {
  const snap = await get(ref(db, "users"));
  if (!snap.exists()) return [];

  const users = [];
  snap.forEach(child => {
    const u = child.val();
    const totalGames = (u.wins || 0) + (u.losses || 0);
    if (totalGames > 0) {
      users.push({
        uid:        u.uid,
        name:       u.name || "لاعب",
        photo:      u.photo || "",
        wins:       u.wins  || 0,
        losses:     u.losses || 0,
        totalGames,
        winRate:    Math.round(((u.wins || 0) / totalGames) * 100),
      });
    }
  });

  // ترتيب: أكثر انتصارات، بعدها أعلى نسبة فوز
  return users
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate)
    .slice(0, limit);
}
