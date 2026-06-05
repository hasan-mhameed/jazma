// 📄 ui/dailyChallengeUI.js
import { getDailyConfig, difficultyName, hasPlayedToday,
         saveDailyResult, getDailyLeaderboard, todayStr } from "../dailyChallenge.js?v=1780700588";
import { config }      from "../config/config.js?v=1780700588";
import { AIPlayer }    from "../ai/aiPlayer.js?v=1780700588";
import { addXP, calcXP } from "../xp.js?v=1780700588";
import { showXPGain }  from "./xpUI.js?v=1780700588";
import { getCurrentUser } from "../auth.js?v=1780700588";

let _dailyActive    = false;
let _dailyStartTime = null;

export function isDailyActive() { return _dailyActive; }

// ── init ──────────────────────────────────────────────────────────
export function initDailyChallengeUI({ onGameStart, getAiPlayer }) {
  const btn   = document.getElementById('daily-btn');
  const modal = document.getElementById('daily-modal');
  const close = document.getElementById('close-daily-btn');
  const start = document.getElementById('daily-start-btn');
  const lb    = document.getElementById('daily-leaderboard');

  if (!btn) return;

  btn.addEventListener('click', async () => {
    modal.classList.remove('hidden');
    await renderDailyModal();
  });

  close?.addEventListener('click',  () => modal.classList.add('hidden'));
  modal?.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

  start?.addEventListener('click', async () => {
    const played = await hasPlayedToday();
    if (played) { alert('لعبت التحدي اليوم — عد غداً! 📅'); return; }

    const cfg = getDailyConfig();
    config.rows         = cfg.gridSize;
    config.cols         = cfg.gridSize;
    config.players      = 2;
    config.aiMode       = 'ai';
    config.aiDifficulty = cfg.difficulty;
    config.online       = false;
    config.localPlayerNames = { 1: getCurrentUser()?.displayName || 'أنت', 2: 'الكمبيوتر' };

    // نضع aiPlayer في config عشان يشتغل
    window._dailyAiPlayer = new AIPlayer(cfg.difficulty);
    _dailyActive    = true;
    _dailyStartTime = Date.now();

    modal.classList.add('hidden');
    onGameStart(window._dailyAiPlayer);
  });
}

// ── حفظ نتيجة التحدي اليومي (تُستدعى من gameEnd) ────────────────
export async function finishDailyChallenge(result, myScore, oppScore) {
  if (!_dailyActive) return;
  _dailyActive = false;
  const duration = Math.floor((Date.now() - _dailyStartTime) / 1000);
  const user     = getCurrentUser();
  await saveDailyResult(result, myScore, oppScore, duration, user?.displayName);

  // XP bonus للتحدي اليومي
  const cfg     = getDailyConfig();
  const baseXP  = calcXP({ mode: 'ai', result, aiDifficulty: cfg.difficulty,
                            gridSize: cfg.gridSize, rank: 1, players: 2 });
  const bonus   = result === 'win' ? 20 : result === 'draw' ? 10 : 5;
  const xpResult = await addXP(baseXP + bonus);
  if (xpResult) setTimeout(() => showXPGain(xpResult), 1500);
}

// ── رسم المودال ───────────────────────────────────────────────────
function gridLabel(size) {
  const labels = { 3: 'صغير (3×3)', 4: 'متوسط (4×4)', 5: 'كبير (5×5)', 6: 'ضخم (6×6)', 7: 'عملاق (7×7)' };
  return labels[size] || `${size}×${size}`;
}

async function renderDailyModal() {
  const info    = document.getElementById('daily-info');
  const lbList  = document.getElementById('daily-leaderboard');
  const startBtn= document.getElementById('daily-start-btn');
  const cfg     = getDailyConfig();
  const played  = await hasPlayedToday();

  if (info) {
    info.innerHTML = `
      <div class="daily-date">📅 ${new Date().toLocaleDateString('ar',
        { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div class="daily-details">
        <span>🗺️ ${gridLabel(cfg.gridSize)}</span>
        <span>⚡ ${difficultyName(cfg.difficulty)}</span>
      </div>
      ${played ? '<div class="daily-played">✅ لعبت التحدي اليوم!</div>' : ''}`;
  }

  if (startBtn) {
    startBtn.disabled    = played;
    startBtn.textContent = played ? '✅ لعبت اليوم' : '🚀 ابدأ التحدي';
  }

  // leaderboard
  if (lbList) {
    lbList.innerHTML = '<p class="history-loading">⏳ جاري التحميل...</p>';
    const leaders = await getDailyLeaderboard();
    if (leaders.length === 0) {
      lbList.innerHTML = '<p class="history-empty">لا يوجد فائزون بعد — كن الأول!</p>';
    } else {
      const medals = ['🥇', '🥈', '🥉'];
      lbList.innerHTML = leaders.map((p, i) => `
        <div class="daily-lb-row ${p.uid === getCurrentUser()?.uid ? 'daily-lb-me' : ''}">
          <span class="daily-lb-rank">${medals[i] || `#${i + 1}`}</span>
          <span class="daily-lb-name">${p.name}</span>
          <span class="daily-lb-score">🏆 ${p.myScore}</span>
          <span class="daily-lb-time">⏱️ ${Math.floor(p.duration / 60)}:${String(p.duration % 60).padStart(2, '0')}</span>
        </div>`).join('');
    }
  }
}
