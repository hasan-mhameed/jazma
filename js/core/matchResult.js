// 📄 matchResult.js — v35.5 (+ v35.7: سبب الخروج وترتيب الخارجين بترتيب خروجهم)
// نتيجة المباراة من مصدر واحد: من لعب فعلاً، ومن "أنا"، ومركز كل لاعب.
// دالة نقية (بلا DOM ولا Firebase): تستعملها نافذة النهاية وشريط النقاط، ويختبرها المحاكي.
//
// لماذا؟ نافذة النهاية كُتبت أصلاً للعب المحلي ("أنت" = المقعد 1 والمقاعد متتالية)
// وأُضيف الأونلاين فوقها، فظهر: مقعد فارغ كلاعب برصيد 0 في النتيجة، وإحصائيات كل
// الأجهزة تُحسب للمقعد 1، والمشاهد تُسجَّل عليه مباراة لم يلعبها.

/** أرقام مقاعد من لعبوا المباراة فعلاً (الحاضر والخارج أثناءها) — بلا المقاعد الفارغة */
export function getParticipants(cfg) {
  const mp = cfg && cfg.multiPlayers;
  if (mp && typeof mp === "object") {
    const nums = [...new Set(Object.values(mp)
      .map(p => p && p.num)
      .filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
    if (nums.length) return nums;
  }
  const n = Math.max(2, Number(cfg && cfg.players) || 2);
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** رقم مقعدي: أونلاين = مقعدي الحقيقي، المشاهد = لا أحد، ضد الكمبيوتر والمحلي = 1 */
export function getMyNum(cfg) {
  if (!cfg || cfg.spectator) return null;
  if (cfg.aiMode === "online") {
    return Number.isInteger(cfg.onlinePlayerNum) ? cfg.onlinePlayerNum : null;
  }
  return 1;
}

/** uid صاحب مقعد (أونلاين): من قائمة لاعبي المباراة، أو الخصم في الثنائي */
export function getPlayerUid(cfg, num, myUid = null) {
  if (!cfg || cfg.aiMode !== "online" || !Number.isInteger(num)) return null;
  const me = getMyNum(cfg);
  if (me != null && num === me) return myUid;
  const mp = cfg.multiPlayers;
  if (mp && typeof mp === "object") {
    for (const [key, p] of Object.entries(mp)) {
      if (p && p.num === num) return p.uid || key;   // اللاعبون مخزّنون بمفتاح uid
    }
    return null;
  }
  // الثنائي: الطرف الآخر — للاعب فقط (المشاهد قد يحمل uid خصم من مباراته السابقة)
  return me != null ? (cfg.onlineOpponentUid || null) : null;
}

// سبب خروج لاعب من مباراة جماعية جارية — يكتبه من نفّذ الإخراج مع active:false (v35.7)
export const OUT_LABELS = { time: "نفد وقته", dropped: "انقطع", left: "انسحب" };

/** الخارجون وسبب خروجهم: { رقم المقعد: "نفد وقته" | "انقطع" | "انسحب" } */
export function getExited(cfg, { exitInfo = null, loserPlayer = null } = {}) {
  const exited = {};
  if (exitInfo && typeof exitInfo === "object") Object.assign(exited, exitInfo);
  if (loserPlayer != null && !exited[loserPlayer]) exited[loserPlayer] = "نفد وقته";
  const mp = cfg && cfg.multiPlayers;
  if (mp && typeof mp === "object") {
    Object.values(mp).forEach(p => {
      if (p && p.active === false && Number.isInteger(p.num) && !exited[p.num]) {
        exited[p.num] = OUT_LABELS[p.outReason] || "انسحب";   // غرف قديمة بلا سبب = انسحب
      }
    });
  }
  return exited;
}

/**
 * لحظة خروج كل مقعد (ختم الخادم outAt) — لترتيب الخارجين بترتيب خروجهم (v35.7).
 * - خروج مخزَّن بختم: لحظته.
 * - خروج مخزَّن بلا ختم (كتبه جهاز بنسخة أقدم): الأقدم (−∞) — لا "الأحدث للأبد" فيتقدّم على كل من خرج بعده.
 * - خارج لم يُخزَّن خروجه بعد (المنسحب الآن قبل كتابة ختمه، نفاد الوقت بالثنائي عبر exitInfo/loserPlayer): الآن (+∞).
 */
function exitTimes(cfg) {
  const t = {};
  const mp = cfg && cfg.multiPlayers;
  if (mp && typeof mp === "object") {
    Object.values(mp).forEach(p => {
      if (!p || !Number.isInteger(p.num) || p.active !== false) return;
      t[p.num] = typeof p.outAt === "number" ? p.outAt : -Infinity;
    });
  }
  return n => (n in t ? t[n] : Infinity);
}

/**
 * النتيجة الكاملة للمباراة.
 * ranking: [{ player, score, exited, rank }] — المتنافسون بالنقاط ثم الخارجون بالأسفل
 * المركز يتشاركه المتعادلون (1، 1، 3)، والخارج دائماً بعد كل المتنافسين.
 * الخارجون بترتيب خروجهم (v35.7): أول من خرج = آخر مركز، فمركز كلٍّ منهم يثبت لحظة خروجه
 * (يُسجَّل حينها) ولا يتكرّر — والنقاط تفصل فقط بين من لا نعرف ترتيب خروجهم.
 * me/myResult/myRank/myScore: null للمشاهد (لا يُسجَّل له شيء).
 * category: 'ai' | 'local' | 'online' (واحد ضد واحد) | 'multi' (3 فأكثر)
 *   — مباراة لاعبَين من غرفة جماعية تُعدّ واحداً ضد واحد.
 */
export function computeMatchResult(cfg, scores, opts = {}) {
  const participants = getParticipants(cfg);
  const exitedAll = getExited(cfg, opts);
  const exited = {};
  participants.forEach(n => { if (exitedAll[n]) exited[n] = exitedAll[n]; });
  const scoreOf = n => Number(scores && scores[n]) || 0;
  const outAt = exitTimes(cfg);
  // خارج x قبل خارج r بالترتيب؟ الأحدث خروجاً أعلى؛ ونفس اللحظة (أو بلا أختام) → النقاط
  const exitedAbove = (x, r) => {
    const ox = outAt(x.player), or = outAt(r.player);
    return ox !== or ? ox > or : x.score > r.score;
  };

  const ranking = participants.map(n => ({ player: n, score: scoreOf(n), exited: exited[n] || null }));
  ranking.sort((a, b) =>
    (a.exited ? 1 : 0) - (b.exited ? 1 : 0)
    || (a.exited && b.exited ? (exitedAbove(a, b) ? -1 : exitedAbove(b, a) ? 1 : 0) : 0)
    || b.score - a.score || a.player - b.player);

  // الخارجون خسروا مؤكّداً: الفوز والتعادل بين المتنافسين فقط
  const contenders = ranking.filter(r => !r.exited);
  const outs       = ranking.filter(r => r.exited);
  const pool       = contenders.length ? contenders : ranking;   // احتياط: خرج الجميع
  const maxScore   = pool.length ? Math.max(...pool.map(r => r.score)) : 0;   // لا pool[0]: الخارجون مرتّبون بالخروج لا بالنقاط
  const top        = pool.filter(r => r.score === maxScore).map(r => r.player);
  const isDraw     = top.length > 1;
  const winnerNum  = isDraw ? null : (top.length ? top[0] : null);

  ranking.forEach(r => {
    r.rank = r.exited
      ? contenders.length + 1 + outs.filter(x => exitedAbove(x, r)).length
      : 1 + contenders.filter(x => x.score > r.score).length;
  });

  const me   = getMyNum(cfg);
  const mine = me != null ? ranking.find(r => r.player === me) || null : null;
  let myResult = null;
  if (mine) {
    if (mine.exited)           myResult = "loss";
    else if (top.includes(me)) myResult = isDraw ? "draw" : "win";
    else                       myResult = "loss";
  }

  const count = participants.length;
  const aiMode = cfg && cfg.aiMode;
  const category = aiMode === "ai"     ? "ai"
                 : aiMode === "online" ? (count >= 3 ? "multi" : "online")
                 :                       (count >= 3 ? "multi" : "local");

  // خصومي: أعلى نقاطهم (لإنجاز "فوز بفارق")، والخصم نفسه في مباراة الاثنين
  let opponent = null, bestOppScore = 0;
  if (mine) {
    const others = ranking.filter(r => r.player !== me);
    bestOppScore = others.length ? Math.max(...others.map(r => r.score)) : 0;
    if (count === 2 && others.length === 1) {
      const o = others[0];
      opponent = { num: o.player, score: o.score, uid: getPlayerUid(cfg, o.player) };
    }
  }

  return {
    participants, count, ranking, exited, isDraw, winnerNum, top,
    me: mine ? me : null,
    myResult,
    myRank:  mine ? mine.rank  : null,
    myScore: mine ? mine.score : null,
    category, opponent, bestOppScore,
  };
}

/**
 * نتيجة سجل المباريات للجماعي (3 فأكثر): الأول فوز، الأخير خسارة، والوسط تعادل
 * (أيقونة السجل تميّز المركز الأوسط عن الخسارة). المتعادلون على القمة = تعادل.
 */
export function multiHistoryResult(R) {
  if (!R || R.me == null) return null;
  if (R.exited[R.me]) return "loss";
  if (R.myResult === "win" || R.myResult === "draw") return R.myResult;
  const lowest = !R.ranking.some(r => r.rank > R.myRank);
  return lowest ? "loss" : "draw";
}
