// 📄 gameEnd.js — v35.7 (النتيجة من مصدر واحد + كل النهايات تمرّ من هنا)
// النهايات: اكتمال اللوحة، نفاد بنك الوقت، انسحاب/انقطاع الخصوم (نافذة النتيجة + التسجيل)،
// والانسحاب بالزر (تسجيل الخسارة فقط — recordForfeit)، والخروج من مباراة جماعية جارية
// (نفاد الوقت أو الانقطاع بلا عودة — recordElimination، v35.7).
import { audioManager } from "../audio/audioManager.js?v=1790420518";
import { updateAIStats, updateLocalStats, updateOnlineStats,
         updateMultiStats, currentUser, getAllStats } from "../auth.js?v=1790420518";
import { saveMatch } from "../history.js?v=1790420518";
import { checkAchievements, updateStreak, getTotalMatches } from "../achievements.js?v=1790420518";
import { showNewAchievements } from "./achievementsUI.js?v=1790420518";
import { calcXP, addXP } from "../xp.js?v=1790420518";
import { showXPGain } from "./xpUI.js?v=1790420518";
import { isDailyActive, finishDailyChallenge } from "./dailyChallengeUI.js?v=1790420518";
import { commitMatchCoins, getMatchCoins } from "../core/wallet.js?v=1790420518";
import { computeMatchResult, multiHistoryResult, getMyNum, OUT_LABELS } from "../core/matchResult.js?v=1790420518";

export let _matchStartTime = Date.now();
// مرة واحدة لكل مباراة: نهايتان متزامنتان (مثلاً آخر حركة + خروج خصم) لا تسجّلان مرتين
// ولا تضيفان عملات المباراة مرتين. يُصفَّر مع بدء كل مباراة (resetMatchTimer).
// الوعد نفسه يُحفظ: النهاية الثانية تنتظر نتيجة الأولى (فيبقى مربع "إحصائياتك" ظاهراً).
let _recordPromise = null;
let _coinsPromise = null;
let _forfeited = false;
// رقم المباراة الجارية: نافذة نتيجة مباراة سابقة (تسجيلها يأخذ رحلات شبكة) لا تُعرض فوق
// مباراة جديدة بدأت خلالها (مراجعة v35.6)
let _matchSeq = 0;
export function resetMatchTimer() {
  _matchStartTime = Date.now();
  _recordPromise = null; _coinsPromise = null; _forfeited = false;
  _matchSeq++;
}

// مساعد يحسب من history 1v1
function fromHistory(h) {
  if (!h || typeof h !== 'object') return { w: 0, l: 0, d: 0 };
  const vals = Object.values(h);
  return {
    w: vals.filter(v => v.r === 'w').length,
    l: vals.filter(v => v.r === 'l').length,
    d: vals.filter(v => v.r === 'd').length,
  };
}

// ── تسجيل نتيجتي: إحصائيات، سجل المباريات، السلسلة، الإنجازات، الخبرة ──
// لصاحب الجهاز فقط (المشاهد بلا مقعد ليس طرفاً)، ومرة واحدة لكل مباراة.
// يرجع (وعداً ببيانات) مربع "إحصائياتك" أو null.
function recordMyResult(cfg, R, scores, opts = {}) {
  if (!currentUser || R.me == null) return Promise.resolve(null);
  if (!_recordPromise) {
    // ما يتغيّر مع بدء مباراة جديدة يُلتقط الآن (التسجيل يمرّ بعدة رحلات شبكة)
    const startedAt = _matchStartTime;
    const daily = isDailyActive();
    _recordPromise = doRecord(cfg, R, scores, { ...opts, startedAt, daily })
      .catch(e => { console.error("recordMyResult", e); return null; });
  }
  return _recordPromise;
}

async function doRecord(cfg, R, scores, { silent = false, startedAt, daily }) {
  const myResult = R.myResult;   // 'win' | 'loss' | 'draw' — لمقعدي أنا
  let headToHead = null;          // { myW, myL, myD, label } أو { isMulti, rank, ... }

  // اسم خصمي في مباراة الاثنين أونلاين (ثنائي، أو غرفة جماعية بقي فيها اثنان)
  const oppNum  = R.opponent ? R.opponent.num : null;
  const oppName = (oppNum != null && cfg.onlinePlayerNames?.[oppNum]) || "الخصم";

  if (R.category === 'multi') {
    // ── متعدد اللاعبين (3 فأكثر لعبوا فعلاً): مركزي أنا ونقاطي ──
    await updateMultiStats(R.myRank, R.count, R.myScore);

    // نجلب الإحصائيات الفردية لعرضها
    const stats   = await getAllStats(currentUser.uid);
    const history = stats.multi?.history || {};
    const records = Object.values(history);
    const total   = records.length;
    const wins    = records.filter(r => r.rank === 1).length;
    const avgScore = total > 0
      ? (records.reduce((s, r) => s + (r.score || 0), 0) / total).toFixed(1)
      : 0;
    headToHead = {
      isMulti: true,
      total, wins, avgScore,
      myRank:  R.myRank,
      players: R.count,
      label: `${R.count} لاعبين`,
    };

  } else if (R.category === 'ai') {
    await updateAIStats(myResult);
    const stats   = await getAllStats(currentUser.uid);
    const { w, l, d } = fromHistory(stats.ai?.history);
    headToHead = { myW: w, myL: l, myD: d, label: "أنت vs الكمبيوتر" };

  } else if (R.category === 'online') {
    // واحد ضد واحد: الخصم الحقيقي (من قائمة لاعبي المباراة في الغرفة الجماعية)
    // لا cfg.onlineOpponentUid وحده — قد يكون متبقّياً من مباراة ثنائية سابقة
    const opponentUid = R.opponent ? R.opponent.uid : null;
    await updateOnlineStats(myResult, opponentUid, oppName);
    const stats = await getAllStats(currentUser.uid);
    const { w, l, d } = fromHistory(opponentUid ? stats.online?.[opponentUid]?.history : null);
    headToHead = { myW: w, myL: l, myD: d, label: `أنت vs ${oppName}` };

  } else {
    const p2 = cfg.localPlayerNames?.[2] || '';
    await updateLocalStats(myResult, p2);
    const stats = await getAllStats(currentUser.uid);
    const key   = p2
      ? `vs_${p2.trim().toLowerCase().replace(/\s+/g, '_')}`
      : '__general__';
    const { w, l, d } = fromHistory(stats.local?.[key]?.history);
    headToHead = { myW: w, myL: l, myD: d, label: p2 ? `أنت vs ${p2}` : "محلي" };
  }

  window._refreshStats?.();

  // ── حفظ المباراة في التاريخ ─────────────────────────────────
  const duration = Math.floor((Date.now() - startedAt) / 1000);
  const grid     = `${cfg.rows}x${cfg.cols}`;

  if (R.category === 'multi') {
    await saveMatch({
      mode:    'multi',
      result:  multiHistoryResult(R),   // الأول فوز، الأخير خسارة، الوسط تعادل
      myScore: R.myScore,
      oppScore: 0,
      vs:      '',
      grid, duration,
    });
  } else if (R.category === 'ai') {
    await saveMatch({
      mode: 'ai', result: myResult,
      myScore: R.myScore, oppScore: R.bestOppScore,
      vs: 'الكمبيوتر', grid, duration,
    });
  } else if (R.category === 'online') {
    await saveMatch({
      mode: 'online', result: myResult,
      myScore: R.myScore, oppScore: R.opponent ? R.opponent.score : 0,
      vs: oppName, grid, duration,
    });
  } else {
    const p2 = cfg.localPlayerNames?.[2] || '';
    await saveMatch({
      mode: 'local', result: myResult,
      myScore: R.myScore, oppScore: R.bestOppScore,
      vs: p2, grid, duration,
    });
  }

  // ── التحقق من الإنجازات ──────────────────────────────────
  const mainResult = myResult;

  const [streak, totalMatches, allStats] = await Promise.all([
    updateStreak(mainResult),       // يحدث السلسلة ويرجع القيمة الجديدة
    getTotalMatches(currentUser.uid),
    getAllStats(currentUser.uid),
  ]);

  const matchData = {
    mode:          cfg.aiMode === 'online' ? 'online' : R.category,   // 'ai' | 'local' | 'multi'
    result:        mainResult,
    myScore:       R.myScore,
    oppScore:      R.bestOppScore,   // أعلى نقاط بين خصومي (لإنجاز "فوز بفارق")
    aiDifficulty:  cfg.aiDifficulty || 'easy',
    currentStreak: streak,
  };

  const newAchievements = await checkAchievements(matchData, allStats, totalMatches);
  if (newAchievements.length > 0 && !silent) {
    setTimeout(() => showNewAchievements(newAchievements), 1500);
  }

  // ── XP ────────────────────────────────────────────────────
  if (daily) {
    // التحدي اليومي يتولى الـ XP بنفسه
    await finishDailyChallenge(
      mainResult,
      scores[1] || 0,
      scores[2] || 0
    );
  } else {
    const xpData = {
      mode:         matchData.mode,
      result:       mainResult,
      aiDifficulty: cfg.aiDifficulty || 'easy',
      gridSize:     cfg.rows,
      rank:         R.category === 'multi' ? R.myRank : 1,
      players:      R.count,
    };
    const xpResult = await addXP(calcXP(xpData));
    if (xpResult && !silent) {
      const delay = newAchievements.length > 0 ? 2500 : 800;
      setTimeout(() => showXPGain(xpResult), delay);
    }
  }
  return headToHead;
}

// لقطة من الإعدادات: المغادرة تصفّرها بعد لحظات، والتسجيل يمرّ بعدة رحلات شبكة
function snapshotCfg(cfg) {
  return {
    ...cfg,
    onlinePlayerNames: { ...(cfg.onlinePlayerNames || {}) },
    localPlayerNames:  cfg.localPlayerNames ? { ...cfg.localPlayerNames } : cfg.localPlayerNames,
    multiPlayers:      cfg.multiPlayers ? JSON.parse(JSON.stringify(cfg.multiPlayers)) : null,
  };
}

// ── 🚪 الانسحاب بالزر أثناء مباراة جارية = خسارة مسجّلة (قرار "المنسحب يخسر") ──
// بلا نافذة نتيجة (اللاعب يغادر)، وبلا عملات المباراة (الانسحاب يخسرها).
// تؤخذ لقطة فورية: المغادرة تصفّر الإعدادات والنقاط بعد لحظات.
export async function recordForfeit(cfg, scores) {
  const me = getMyNum(cfg);
  if (me == null || !currentUser) return;
  const snap = snapshotCfg(cfg);
  const sc = { ...(scores || {}) };
  const R  = computeMatchResult(snap, sc, { exitInfo: { [me]: "انسحب" } });
  _forfeited = true;   // عملات المباراة لا تُضاف للمنسحب
  await recordMyResult(snap, R, sc, { silent: true });
}

// ── 🚪 خرجتُ من مباراة جماعية ما زالت جارية للباقين (v35.7) ──
// reason: "time" (نفد وقتي) | "dropped" (انقطعت ولم أعد خلال المهلة) — كما في الغرفة (outReason).
// النتيجة تُسجَّل لحظة الخروج لا في نهاية المباراة: إغلاق الصفحة بعدها لا يُسقط الخسارة،
// والمركز يثبت بترتيب الخروج. العملات حسب السبب:
//   نفاد الوقت قاعدة لعب عادية → عملات المباراة محفوظة (تُثبَّت الآن، كالثنائي)؛
//   الانقطاع بلا عودة خلال المهلة يُعامَل كالانسحاب → بلا عملات المباراة
//   (المهلة هي فرصة العودة؛ وإلا صار قطع الشبكة أربح من الانسحاب لمن يخسر).
// النهاية اللاحقة (آخر الباقين أو اكتمال اللوحة) تعرض النتيجة النهائية بلا تسجيل ثانٍ.
// cfg يحمل عادةً قائمة اللاعبين التي فيها خروجي (active:false + outAt، كما أكّدها الخادم).
// pending: خروجي لم يصل من الخادم بعد (نفد وقتي وأغادر قبل تأكيده) — يُعدّ خروج "الآن".
// silent: التسجيل لحظة المغادرة بزر الخروج — بلا إشعارات خبرة وإنجازات فوق القائمة (كالانسحاب)
export function recordElimination(cfg, scores, reason, { pending = false, silent = false } = {}) {
  const snap = snapshotCfg(cfg);
  const sc = { ...(scores || {}) };
  const me = getMyNum(snap);
  if (me == null) return null;
  const R  = computeMatchResult(snap, sc, pending ? { exitInfo: { [me]: OUT_LABELS[reason] || "انسحب" } } : {});
  if (R.me == null) return null;
  // (سبب غير معروف — أخرجني جهاز بنسخة أقدم لا تكتب السبب: لا نعاقب بلا دليل)
  // lost: عملات جواهر المباراة التي ضاعت (تُعرض بالرقم على البطاقة — شفافية كالألعاب العالمية)
  let lost = 0;
  if (reason === "dropped" || reason === "left") { lost = _coinsPromise ? 0 : (getMatchCoins() || 0); _forfeited = true; }
  const coins = commitCoinsOnce();
  const recorded = recordMyResult(snap, R, sc, { silent });
  return { R, coins, recorded, lost };
}

// 💎 عملات المباراة: تُضاف مرة واحدة لكل مباراة (والمنسحب لا يأخذها)
function commitCoinsOnce() {
  if (_forfeited) return Promise.resolve({ earned: 0, total: null });
  if (!_coinsPromise) {
    _coinsPromise = commitMatchCoins().catch(() => ({ earned: 0, total: null }));
  }
  return _coinsPromise;
}

// opts.title: عنوان النافذة لنهايات الخروج ("🏆 فزت! انسحب فلان") بدل "فلان فاز"
// opts.displayIf: شرط العرض بعد التسجيل (لو غادر اللاعب قبل ظهور النافذة: تسجيل وعملات بلا عرض)
export async function endGame(cfg, scores, forced = false, loserPlayer = null, exitInfo = null, opts = {}) {
  const totalSquares = (cfg.rows - 1) * (cfg.cols - 1);
  const filled = Object.values(scores).reduce((a, b) => (+a||0) + (+b||0), 0);
  // النهاية الطبيعية تتطلب اكتمال اللوحة؛ الإجبارية (نفاد بنك الوقت/خروج الخصوم) تتخطّاه
  if (!forced && filled < totalSquares) return;

  // v35.7 (مراجعة): النهاية الطبيعية في الجماعي أونلاين تُحسب بعد لحظة لا فوراً — عند العودة من
  // انقطاع يسلّم Firebase ما فات دفعةً واحدة: الحركات أولاً (فتكتمل اللوحة هنا) ثم قائمة اللاعبين
  // (وفيها خروجي أثناء غيابي). الحساب الفوري كان يعدّني ما زلت في المباراة فيسجّل لي فوزاً وأنا خارجها.
  // (cfg هنا هو الإعدادات الحيّة نفسها: تُحدَّث قائمتها قبل أن نكمل)
  if (!forced && cfg.aiMode === "online" && cfg.multiPlayers) {
    await new Promise(res => setTimeout(res, 0));
  }

  // النتيجة من مصدر واحد (core/matchResult.js):
  // - من لعب فعلاً فقط: المقعد الفارغ (غادر صاحبه قبل البدء) لا يظهر كلاعب برصيد 0
  // - "أنا" = مقعدي الحقيقي أونلاين (لا المقعد 1)، والمشاهد لا يُسجَّل له شيء
  // - الخارجون (نفد وقته/انسحب/انقطع) بالأسفل وخارج حساب الفوز، والمتعادلون يتشاركون المركز
  const R = computeMatchResult(cfg, scores, { exitInfo, loserPlayer });
  const { ranking, isDraw, winnerNum } = R;

  function playerName(num) {
    if (cfg.aiMode === "online" && cfg.onlinePlayerNames)
      return cfg.onlinePlayerNames[num] || `لاعب ${num}`;
    if (cfg.aiMode === "ai") return num === 1 ? "أنت" : "الكمبيوتر";
    if (cfg.localPlayerNames?.[num]) return cfg.localPlayerNames[num];
    return `لاعب ${num}`;
  }

  // ── رسالة الفائز ─────────────────────────────────────────────
  let message;
  if (opts && opts.title) {
    message = opts.title;
  } else if (isDraw) {
    message = "🤝 تعادل!";
  } else {
    message = cfg.aiMode === "ai" && winnerNum === 1
      ? "🎉 أنت الفائز!"
      : cfg.aiMode === "ai" && winnerNum === 2
      ? "🤖 الكمبيوتر فاز!"
      : `🎉 ${playerName(winnerNum)} فاز!`;
  }

  // ── العملات والإحصائيات (مرة واحدة لكل مباراة) ────────────────
  // العملات تُثبَّت فوراً قبل أي انتظار: لو بدأت مباراة جديدة أثناء التسجيل (رحلات شبكة)
  // تُصفَّر عملات المباراة وحارسها، فتضيع عملات هذه وتلتقط تلك التثبيت (مراجعة v35.6)
  const seq   = _matchSeq;
  const coins = commitCoinsOnce();
  const headToHead = await recordMyResult(cfg, R, scores);

  // بدأت مباراة جديدة أثناء التسجيل: لا نعرض نتيجة القديمة فوقها
  if (seq !== _matchSeq) return;
  // غادر اللاعب قبل ظهور النافذة (نهايات الخروج): سُجّلت النتيجة وأُضيفت العملات، بلا عرض
  if (opts && typeof opts.displayIf === 'function' && !opts.displayIf()) return;

  // ── عرض شاشة النتيجة ─────────────────────────────────────────
  const winnerScreen  = document.getElementById("winner-screen");
  const winnerMessage = document.getElementById("winner-message");
  const winnerDetails = document.getElementById("winner-details");
  const headToHeadEl  = document.getElementById("head-to-head");

  if (!winnerScreen || !winnerMessage) return;

  winnerMessage.textContent = message;

  // ترتيب اللاعبين — من لعب فعلاً فقط، والمتعادلون يتشاركون المركز (1، 1، 3)
  if (winnerDetails) {
    winnerDetails.textContent = "";
    ranking.forEach(p => {
      const color = cfg.colors[p.player - 1] || "#999";
      const row   = document.createElement("div");
      const isExited = p.exited;
      row.style.color        = color;
      row.style.padding      = "6px 0";
      row.style.fontSize     = "1.05rem";
      row.style.borderBottom = "1px solid rgba(255,255,255,0.08)";
      row.style.opacity      = isExited ? "0.6" : "1";
      // شارة توضّح خروج اللاعب (نفد وقته/انسحب/انقطع) — النقاط تبقى ظاهرة لكن مؤطّرة
      const badge = isExited
        ? ` <span style="font-size:0.8rem;background:rgba(248,113,113,0.2);color:#fca5a5;padding:1px 7px;border-radius:8px;border:1px solid #f8717155;">${isExited}</span>`
        : "";
      row.innerHTML = `${p.rank}. ${playerName(p.player)}: ${p.score} نقطة${badge}`;
      winnerDetails.appendChild(row);
    });

    // 💎 العملات المكتسبة (أُضيفت مرة واحدة — سطرها يُعاد رسمه لو أُعيد عرض النافذة)
    coins.then(({ earned, total }) => {
      if (earned > 0) {
        const coinRow = document.createElement("div");
        coinRow.style.cssText = "margin-top:12px;padding:10px;border-radius:10px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.3);color:#fcd34d;font-weight:700;font-size:1.05rem;text-align:center;";
        coinRow.textContent = `💎 ربحت ${earned} عملة!`;
        winnerDetails.appendChild(coinRow);
      }
      // تحديث الشارة في navbar
      const el = document.getElementById('coins-count');
      if (el && total != null) el.textContent = total;
    });
  }

  // سجل أنت vs الخصم / إحصائياتك الفردية
  if (headToHeadEl) {
    if (headToHead && currentUser) {
      if (headToHead.isMulti) {
        const { total, wins, avgScore, myRank, players } = headToHead;
        const winPct   = total > 0 ? Math.round((wins / total) * 100) : 0;
        const medals    = ['🥇','🥈','🥉'];
        const rankEmoji = medals[myRank - 1] ?? `#${myRank}`;
        headToHeadEl.innerHTML = `
          <div class="h2h-label">إحصائياتك — ${players} لاعبين</div>
          <div class="h2h-multi-row">
            <span class="hm-stat"><span class="hm-val">${rankEmoji}</span><span class="hm-lbl">هذه الجولة</span></span>
            <span class="hm-stat"><span class="hm-val hm-gold">${winPct}%</span><span class="hm-lbl">نسبة الأول</span></span>
            <span class="hm-stat"><span class="hm-val">${avgScore}</span><span class="hm-lbl">متوسط النقاط</span></span>
            <span class="hm-stat"><span class="hm-val">${total}</span><span class="hm-lbl">مباراة</span></span>
          </div>`;
      } else {
        const { myW, myL, myD, label } = headToHead;
        headToHeadEl.innerHTML = `
          <div class="h2h-label">${label}</div>
          <div class="h2h-score">
            <span class="h2h-win">🏆 ${myW}</span>
            <span class="h2h-sep">–</span>
            <span class="h2h-loss">💔 ${myL}</span>
            ${myD > 0 ? `<span class="h2h-sep">·</span><span class="h2h-draw">🤝 ${myD}</span>` : ''}
          </div>`;
      }
      headToHeadEl.classList.remove("hidden");
    } else {
      headToHeadEl.classList.add("hidden");
    }
  }

  // بطاقة "خرجت من المباراة" (v35.7) لا تبقى تحت نافذة النتيجة النهائية
  document.getElementById("out-card")?.remove();
  winnerScreen.classList.remove("hidden");
  setTimeout(() => audioManager.playWin(), 300);
}
