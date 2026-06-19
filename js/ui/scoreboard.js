// 📄 scoreboard.js — v16.0 (Nature cards + level badge)
import { state }  from "../core/state.js?v=1781892598";
import { config } from "../config/config.js?v=1781892598";
import { getXP, getLevelFromXP } from "../xp.js?v=1781892598";
import { getCurrentUser } from "../auth.js?v=1781892598";

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
  scoreboard.className = `players-count-${cfg.players}`;
  const scores = state.scores || {};

  for (let i = 1; i <= cfg.players; i++) {
    const card = document.createElement("div");
    card.id = `pcard${i}`;
    card.className = `nat-player-card ${COLORS[i-1] || 'p1'}`;

    card.innerHTML = `
      <div class="npc-avatar">${AVATARS[i-1] || '🎮'}</div>
      <div class="npc-info">
        <div class="npc-name-row">
          <span class="npc-name">${playerName(cfg, i)}</span>
          <span class="npc-level" id="plevel${i}">⭐ —</span>
        </div>
        <div class="npc-turn-tag">دوره الآن</div>
      </div>
      <div class="npc-score" id="p${i}">${scores[i] || 0}</div>`;

    // ضغط البطاقة → معلومات اللاعب
    card.addEventListener('click', () => showPlayerInfo(cfg, i));
    scoreboard.appendChild(card);
  }

  loadLevels(cfg);
}

// ── جلب مستوى اللاعبين ──
async function loadLevels(cfg) {
  // اللاعب الحالي (1) من حسابه
  const myUid = getCurrentUser()?.uid;
  if (myUid) {
    const xp  = await getXP(myUid);
    const lvl = getLevelFromXP(xp);
    setLevelBadge(1, lvl.current);
  }
  // الخصم أونلاين
  if (cfg.aiMode === 'online' && cfg.onlineOpponentUid) {
    const xp  = await getXP(cfg.onlineOpponentUid);
    const lvl = getLevelFromXP(xp);
    setLevelBadge(2, lvl.current);
  } else if (cfg.aiMode === 'ai') {
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
  let uid = null;
  if (i === 1) uid = myUid;
  else if (cfg.aiMode === 'online') uid = cfg.onlineOpponentUid;

  if (uid) {
    const xp  = await getXP(uid);
    const lvl = getLevelFromXP(xp);
    levelInfo = `${lvl.current.icon} ${lvl.current.title} (مستوى ${lvl.current.level})`;
    xpInfo = `${xp} XP`;
  } else if (cfg.aiMode === 'ai' && i === 2) {
    levelInfo = '🤖 ذكاء اصطناعي';
    xpInfo = cfg.aiDifficulty === 'easy' ? 'سهل' : cfg.aiDifficulty === 'nightmare' ? 'صعب' : 'متوسط';
  } else {
    levelInfo = '👤 لاعب محلي';
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

export function updateScoreboard() {
  const scores = state.scores || {};
  for (const id in scores) {
    const span = document.getElementById(`p${id}`);
    if (span) span.textContent = scores[id];
  }
}
