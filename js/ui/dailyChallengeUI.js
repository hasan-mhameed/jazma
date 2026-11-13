// 📄 ui/dailyChallengeUI.js
import { getDailyConfig, difficultyName, hasPlayedToday,
         saveDailyResult, getDailyLeaderboard, todayStr } from "../dailyChallenge.js?v=1794502787";
import { config }      from "../config/config.js?v=1794502787";
import { AIPlayer }    from "../ai/aiPlayer.js?v=1794502787";
import { addXP, calcXP } from "../xp.js?v=1794502787";
import { showXPGain }  from "./xpUI.js?v=1794502787";
import { getCurrentUser } from "../auth.js?v=1794502787";
import { esc } from "./safeText.js?v=1794502787";

let _dailyActive    = false;
let _dailyStartTime = null;
let _dailyDate      = null;   // يوم التحدي الذي بدأت به المباراة (بساعة الخادم — 3.3ج-4)

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
    _dailyDate = cfg.date;
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
  try {
    await saveDailyResult(result, myScore, oppScore, duration, user?.displayName, _dailyDate);
  } catch (e) {
    // 3.3ج-4: نتيجة اليوم مرة واحدة لا تُعدَّل (القواعد) — كُتبت من قبل (صفحة أو جهاز آخر لعب التحدي نفسه): هذه
    // المحاولة لا تُحتسب ولا خبرة لها؛ وإن فشلت لسبب آخر (انقطاع) فلا خبرة بلا نتيجة محفوظة
    dailyToast(e?.daily === "already" ? "📅 نتيجتك لتحدي اليوم مسجّلة من قبل — هذه المحاولة لا تُحتسب" : "⚠️ تعذّر حفظ نتيجة التحدي — تحقّق من اتصالك");
    console.debug("saveDailyResult", e?.code || e);
    return;
  }

  // XP bonus للتحدي اليومي (بإعداد اليوم الذي لُعب). انقطاعٌ أثناء معاملة الخبرة يُلغيها برفض (الحزمة لا تعيد
  // معاملة أُرسلت) — لا يُسقط ما بعدها (مراجعة ج-4)
  const cfg     = getDailyConfig(_dailyDate);
  const baseXP  = calcXP({ mode: 'ai', result, aiDifficulty: cfg.difficulty,
                            gridSize: cfg.gridSize, rank: 1, players: 2 });
  const bonus   = result === 'win' ? 20 : result === 'draw' ? 10 : 5;
  let xpResult = null;
  try { xpResult = await addXP(baseXP + bonus); } catch (e) { console.debug("daily xp", e?.code || e); }
  if (xpResult) setTimeout(() => showXPGain(xpResult), 1500);
}

// تنبيه صغير عابر (كتنبيهات الدعوة)
function dailyToast(text) {
  const t = document.createElement("div");
  t.textContent = text;
  t.style.cssText = "position:fixed;top:70px;left:50%;transform:translateX(-50%);background:#1e293bee;color:#fff;"
    + "padding:10px 18px;border-radius:12px;z-index:10000;font-weight:700;font-size:0.95rem;max-width:90vw;"
    + "text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.4);direction:rtl";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── رسم المودال ───────────────────────────────────────────────────
function gridLabel(size) {
  const sq = size - 1; // 4 نقاط = 3×3 مربعات
  return `${sq}×${sq} مربعات`;
}

async function renderDailyModal() {
  const info    = document.getElementById('daily-info');
  const lbList  = document.getElementById('daily-leaderboard');
  const startBtn= document.getElementById('daily-start-btn');
  const cfg     = getDailyConfig();
  const played  = await hasPlayedToday();

  if (info) {
    info.innerHTML = `
      <div class="daily-date">📅 ${esc(new Date().toLocaleDateString('ar',
        { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
      <div class="daily-details">
        <span>🗺️ ${esc(gridLabel(cfg.gridSize))}</span>
        <span>⚡ ${esc(difficultyName(cfg.difficulty))}</span>
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
      // v36.0 (1.10): كل لاعب يكتب نتيجته بنفسه (الاسم والنقاط والمدة) فتظهر عند الجميع — نص لا شيفرة
      lbList.innerHTML = leaders.map((p, i) => `
        <div class="daily-lb-row ${p.uid === getCurrentUser()?.uid ? 'daily-lb-me' : ''}">
          <span class="daily-lb-rank">${esc(medals[i] || `#${i + 1}`)}</span>
          <span class="daily-lb-name">${esc(p.name)}</span>
          <span class="daily-lb-score">🏆 ${esc(p.myScore)}</span>
          <span class="daily-lb-time">⏱️ ${esc(Math.floor(p.duration / 60))}:${esc(String(p.duration % 60).padStart(2, '0'))}</span>
        </div>`).join('');
    }
  }
}
