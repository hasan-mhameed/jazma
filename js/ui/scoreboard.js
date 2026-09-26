// 📄 scoreboard.js — v35.5 (Nature cards + level badge — "من أنا" من مصدر واحد)
import { state }  from "../core/state.js?v=1790376125";
import { config } from "../config/config.js?v=1790376125";
import { getXP, getLevelFromXP } from "../xp.js?v=1790376125";
import { getCurrentUser } from "../auth.js?v=1790376125";
import { getParticipants, getMyNum, getPlayerUid } from "../core/matchResult.js?v=1790376125";

const AVATARS = ['🦊', '🤖', '🦅', '🐺'];
const COLORS  = ['p1', 'p2', 'p3', 'p4'];

function playerName(cfg, i) {
  if (cfg.aiMode === 'ai' && i === 2) return 'الكمبيوتر';
  if (cfg.aiMode === 'online' && cfg.onlinePlayerNames) return cfg.onlinePlayerNames[i] || `لاعب ${i}`;
  if (cfg.localPlayerNames) return cfg.localPlayerNames[i] || `لاعب ${i}`;
  return `لاعب ${i}`;
}

export function renderScoreboard(cfg) {
  const scoreboard = document.getElementById("scores");
  if (!scoreboard) return;
  scoreboard.innerHTML = "";
  // في الأونلاين الجماعي قد لا يبدأ ترقيم اللاعبين من 1 (بعد مغادرات قبل البدء)
  // فالبطاقات لمن لعب فعلاً فقط — نفس المصدر الذي تبني منه نافذة النهاية ترتيبها
  const seats = getParticipants(cfg);
  scoreboard.className = `players-count-${seats.length}`;
  const scores = state.scores || {};

  for (const i of seats) {
    const card = document.createElement("div");
    card.id = `pcard${i}`;
    card.className = `nat-player-card ${COLORS[i-1] || 'p1'}`;
    // لاعب خرج من المباراة (انسحاب/انقطاع/نفاد وقت) → بطاقته باهتة ومشطوبة
    const isOut = !!(cfg.multiPlayers &&
      Object.values(cfg.multiPlayers).some(p => p && p.num === i && p.active === false));
    if (isOut) card.classList.add('out');

    card.innerHTML = `
      <div class="npc-avatar">${AVATARS[i-1] || '🎮'}</div>
      <div class="npc-info">
        <div class="npc-name-row">
          <span class="npc-name">${playerName(cfg, i)}</span>
          <span class="npc-level" id="plevel${i}">⭐ —</span>
        </div>
        <div class="npc-turn-tag">دوره الآن</div>
        ${isOut ? '<span class="npc-out-badge">🚪 خرج</span>' : ''}
      </div>
      <span class="npc-bank" id="pbank${i}"></span>
      <div class="npc-score" id="p${i}">${scores[i] || 0}</div>`;

    // ضغط البطاقة → معلومات اللاعب
    card.addEventListener('click', () => showPlayerInfo(cfg, i));
    scoreboard.appendChild(card);
  }

  loadLevels(cfg);
}

// ── جلب مستوى اللاعبين ──
// كل بطاقة تحمل مستوى صاحبها الحقيقي. أونلاين: بطاقتي على مقعدي الحقيقي (لا المقعد 1 دائماً —
// كان المنضمّ يرى مستواه على بطاقة خصمه)، والخصوم من قائمة لاعبي المباراة، والمشاهد يرى الجميع.
async function loadLevels(cfg) {
  const myUid = getCurrentUser()?.uid;
  if (cfg.aiMode === 'online') {
    await Promise.all(getParticipants(cfg).map(async num => {
      const uid = getPlayerUid(cfg, num, myUid);
      if (!uid) return;
      try {
        const xp = await getXP(uid);
        setLevelBadge(num, getLevelFromXP(xp).current);
      } catch {}
    }));
    return;
  }
  // ضد الكمبيوتر والمحلي: أنا المقعد 1 (نفس الجهاز)
  const me = getMyNum(cfg);
  if (myUid && me != null) {
    const xp  = await getXP(myUid);
    const lvl = getLevelFromXP(xp);
    setLevelBadge(me, lvl.current);
  }
  if (cfg.aiMode === 'ai') {
    const el = document.getElementById('plevel2');
    if (el) el.textContent = '🤖 AI';
  } else {
    // محلي — لاعبين بدون حساب منفصل
    for (let i = 2; i <= cfg.players; i++) {
      const el = document.getElementById(`plevel${i}`);
      if (el) el.textContent = '';
    }
  }
}

function setLevelBadge(i, level) {
  const el = document.getElementById(`plevel${i}`);
  if (el && level) el.textContent = `${level.icon} ${level.level}`;
}

// ── modal معلومات اللاعب ──
async function showPlayerInfo(cfg, i) {
  document.getElementById('player-info-modal')?.remove();
  const name = playerName(cfg, i);
  const avatar = AVATARS[i-1] || '🎮';

  let levelInfo = '', xpInfo = '';
  const myUid = getCurrentUser()?.uid;
  // صاحب البطاقة الحقيقي: أونلاين من مقعده (لا "1 = أنا")، وغير ذلك أنا المقعد 1
  let uid = null;
  if (cfg.aiMode === 'online') uid = getPlayerUid(cfg, i, myUid);
  else if (i === getMyNum(cfg)) uid = myUid;

  if (uid) {
    const xp  = await getXP(uid);
    const lvl = getLevelFromXP(xp);
    levelInfo = `${lvl.current.icon} ${lvl.current.title} (مستوى ${lvl.current.level})`;
    xpInfo = `${xp} XP`;
  } else if (cfg.aiMode === 'ai' && i === 2) {
    levelInfo = '🤖 ذكاء اصطناعي';
    xpInfo = cfg.aiDifficulty === 'easy' ? 'سهل' : cfg.aiDifficulty === 'nightmare' ? 'صعب' : 'متوسط';
  } else {
    levelInfo = cfg.aiMode === 'online' ? '🌐 لاعب أونلاين' : '👤 لاعب محلي';
  }

  const modal = document.createElement('div');
  modal.id = 'player-info-modal';
  modal.innerHTML = `
    <div id="player-info-box">
      <div class="pinfo-avatar ${COLORS[i-1]}">${avatar}</div>
      <h3>${name}</h3>
      <div class="pinfo-level">${levelInfo}</div>
      ${xpInfo ? `<div class="pinfo-xp">${xpInfo}</div>` : ''}
      <div class="pinfo-score">النقاط الحالية: ${state.scores[i] || 0}</div>
      <button id="pinfo-close" type="button">حسناً</button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('pinfo-close').addEventListener('click', () => modal.remove());
}

export function updateScoreboard(cfg = null) {
  const scores = state.scores || {};
  for (const id in scores) {
    const span = document.getElementById(`p${id}`);
    if (span) span.textContent = scores[id];
  }
  // تحديث حالة "خرج" (انسحاب/انقطاع/نفاد وقت) دون إعادة بناء البطاقات
  const players = cfg?.multiPlayers || config?.multiPlayers;
  if (players) {
    Object.values(players).forEach(p => {
      if (!p || typeof p.num !== 'number') return;
      const card = document.getElementById(`pcard${p.num}`);
      if (!card) return;
      const isOut = p.active === false;
      card.classList.toggle('out', isOut);
      // نضيف/نزيل شارة "خرج" فعلياً (لا نعتمد على CSS وحده)
      const info = card.querySelector('.npc-info');
      let badge = card.querySelector('.npc-out-badge');
      if (isOut && !badge && info) {
        badge = document.createElement('span');
        badge.className = 'npc-out-badge';
        badge.textContent = '🚪 خرج';
        info.appendChild(badge);
      } else if (!isOut && badge) {
        badge.remove();
      }
    });
  }
}
