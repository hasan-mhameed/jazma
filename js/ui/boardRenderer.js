// 📄 boardRenderer.js — v15.0 (PixiJS v8 Enhanced)
import { state }                              from "../core/state.js?v=1781647508";
import { makeKey }                            from "../utils.js?v=1781647508";
import { config }                             from "../config/config.js?v=1781647508";
import { renderScoreboard, updateScoreboard } from "./scoreboard.js?v=1781647508";
import { updateTurn, updateTurnUI }           from "./turnManager.js?v=1781647508";
import { endGame }                            from "./gameEnd.js?v=1781647508";
import { audioManager }                       from "../audio/audioManager.js?v=1781647508";
import { checkSquaresAround }                 from "../core/logic.js?v=1781647508";
import { onlineManager }                      from "../firebase.js?v=1781647508";

let app=null, edgeObjects=[], squareLayer=null, edgeLayer=null,
    dotLayer=null, fxLayer=null, glowLayer=null, aiPlayer=null,
    isAIThinking=false, _dots=[];

const THEME = {
  bg:0x0a0a18, dot:0xc8b8ff, dotGlow:0x9d8df7, dotCorner:0xfbbf24,
  edgeIdle:0x1e1e38, edgeHover:0x7c6af7, squareAlpha:0.28,
  playerColors:[0x7c6af7,0xf87171,0x4ade80,0xfbbf24],
  playerGlows:[0x9d8df7,0xfca5a5,0x86efac,0xfcd34d],
};

export async function initBoard(cfg, ai=null) {
  aiPlayer=ai; isAIThinking=false; edgeObjects=[]; _dots=[];
  while (cfg.colors.length < cfg.players)
    cfg.colors.push(`hsl(${Math.floor(Math.random()*360)},70%,50%)`);

  const SIZE=Math.min(window.innerWidth*0.88, window.innerHeight*0.54, 500);
  const padding=SIZE*0.13;
  const spacing=(SIZE-padding*2)/(Math.max(cfg.cols,cfg.rows)-1);
  const W=padding*2+(cfg.cols-1)*spacing;
  const H=padding*2+(cfg.rows-1)*spacing;
  cfg._pixi={spacing,padding,W,H};

  if (app){ try { app.destroy({ removeView: false }, { children: true, texture: true }); } catch(e){} app=null; }

  // نستبدل الـ canvas بنسخة نظيفة — يتجنب بقايا الـ WebGL context القديم
  let canvasEl = document.getElementById('board');
  if (canvasEl) {
    const fresh = canvasEl.cloneNode(false);
    fresh.className = canvasEl.className;
    canvasEl.parentNode.replaceChild(fresh, canvasEl);
    canvasEl = fresh;
  }

  app=new PIXI.Application();
  await app.init({
    canvas: canvasEl,
    width:W, height:H, backgroundColor:THEME.bg,
    antialias:true, resolution:Math.min(window.devicePixelRatio||1,2),
    autoDensity:true,
  });

  glowLayer=new PIXI.Container(); app.stage.addChild(glowLayer);
  squareLayer=new PIXI.Container(); app.stage.addChild(squareLayer);
  edgeLayer=new PIXI.Container(); app.stage.addChild(edgeLayer);
  dotLayer=new PIXI.Container(); app.stage.addChild(dotLayer);
  fxLayer=new PIXI.Container(); app.stage.addChild(fxLayer);

  for (let r=0;r<cfg.rows;r++) for (let c=0;c<cfg.cols;c++) {
    const x=padding+c*spacing, y=padding+r*spacing;
    const isCorner=(r===0||r===cfg.rows-1)&&(c===0||c===cfg.cols-1);
    const dotObj=drawDot(x,y,isCorner);
    _dots.push({g:dotObj, t:Math.random()*Math.PI*2});
  }

  state.lines=new Set(); state.currentPlayer=1; state.scores={};
  for (let i=1;i<=cfg.players;i++) state.scores[i]=0;

  for (let r=0;r<cfg.rows;r++) for (let c=0;c<cfg.cols;c++) {
    if (c<cfg.cols-1) addEdge(r,c,r,c+1,cfg);
    if (r<cfg.rows-1) addEdge(r,c,r+1,c,cfg);
  }

  let t=0;
  app.ticker.add(()=>{
    t+=0.02;
    _dots.forEach(d=>{ d.g.scale.set(1+Math.sin(d.t+t)*0.12); });
  });

  renderScoreboard(cfg); updateScoreboard(); updateTurnUI(cfg); updateTurn(cfg);
}

function drawDot(x,y,isCorner) {
  const r=isCorner?7:5;
  const color=isCorner?THEME.dotCorner:THEME.dot;
  const glow=isCorner?0xfcd34d:THEME.dotGlow;
  const glowG=new PIXI.Graphics();
  glowG.circle(0,0,r+6).fill({color:glow,alpha:0.15});
  glowG.x=x; glowG.y=y; glowLayer.addChild(glowG);
  const g=new PIXI.Graphics();
  g.circle(0,0,r).fill({color,alpha:1});
  g.circle(0,0,r*0.45).fill({color:0xffffff,alpha:0.5});
  g.x=x; g.y=y; dotLayer.addChild(g);
  return g;
}

function addEdge(r1,c1,r2,c2,cfg) {
  const {spacing,padding}=cfg._pixi;
  const x1=padding+c1*spacing, y1=padding+r1*spacing;
  const x2=padding+c2*spacing, y2=padding+r2*spacing;
  const key=makeKey(r1,c1,r2,c2);

  const line=new PIXI.Graphics();
  drawIdleLine(line,x1,y1,x2,y2);
  edgeLayer.addChild(line);

  const lineGlow=new PIXI.Graphics();
  lineGlow.alpha=0; glowLayer.addChild(lineGlow);

  const hit=new PIXI.Graphics();
  const isH=r1===r2;
  if (isH) hit.rect(Math.min(x1,x2)-6,y1-14,Math.abs(x2-x1)+12,28).fill({color:0xffffff,alpha:0});
  else hit.rect(x1-14,Math.min(y1,y2)-6,28,Math.abs(y2-y1)+12).fill({color:0xffffff,alpha:0});
  hit.eventMode='static'; hit.cursor='pointer';
  edgeLayer.addChild(hit);

  hit.on('pointerover',()=>{
    if (state.lines.has(key)) return;
    drawHoverLine(line,x1,y1,x2,y2);
    drawGlowLine(lineGlow,x1,y1,x2,y2,THEME.edgeHover,0.3);
  });
  hit.on('pointerout',()=>{
    if (state.lines.has(key)) return;
    drawIdleLine(line,x1,y1,x2,y2);
    lineGlow.clear(); lineGlow.alpha=0;
  });
  hit.on('pointertap',()=>handleEdgeClick({key,line,lineGlow,x1,y1,x2,y2,r1,c1,r2,c2},cfg));

  edgeObjects.push({key,line,lineGlow,hit,x1,y1,x2,y2,r1,c1,r2,c2});
}

function drawIdleLine(g,x1,y1,x2,y2){g.clear();g.moveTo(x1,y1).lineTo(x2,y2).stroke({color:THEME.edgeIdle,width:2.5,cap:'round'});}
function drawHoverLine(g,x1,y1,x2,y2){g.clear();g.moveTo(x1,y1).lineTo(x2,y2).stroke({color:THEME.edgeHover,width:3.5,cap:'round',alpha:0.85});}
function drawGlowLine(g,x1,y1,x2,y2,color,alpha){g.clear();g.moveTo(x1,y1).lineTo(x2,y2).stroke({color,width:10,cap:'round',alpha});g.alpha=1;}

function drawPlayerLine(g,lineGlow,x1,y1,x2,y2,player) {
  const color=THEME.playerColors[player-1]||0x888888;
  const glow=THEME.playerGlows[player-1]||0x888888;
  let progress=0;
  const animate=()=>{
    progress+=0.12;
    const t=Math.min(progress,1);
    const mx=x1+(x2-x1)*t, my=y1+(y2-y1)*t;
    g.clear();
    g.moveTo(x1,y1).lineTo(mx,my).stroke({color,width:4.5,cap:'round'});
    drawGlowLine(lineGlow,x1,y1,mx,my,glow,0.25);
    if (t<1) requestAnimationFrame(animate);
    else {
      let ga=0.25;
      const fadeGlow=()=>{ga-=0.02;lineGlow.alpha=Math.max(ga,0);if(ga>0)requestAnimationFrame(fadeGlow);else{lineGlow.clear();lineGlow.alpha=0;}};
      setTimeout(()=>requestAnimationFrame(fadeGlow),300);
    }
  };
  requestAnimationFrame(animate);
}

export function handleEdgeClick(edgeObj,cfg,isOpponentMove=false) {
  if (isAIThinking) return;
  if (cfg.aiMode==='online'&&!isOpponentMove&&!onlineManager.isMyTurn(state.currentPlayer)) return;
  const {key,line,lineGlow,x1,y1,x2,y2,r1,c1,r2,c2}=edgeObj;
  if (state.lines.has(key)) return;

  audioManager.playLineDraw();
  drawPlayerLine(line,lineGlow,x1,y1,x2,y2,state.currentPlayer);
  state.lines.add(key);

  let squareCompleted=false;
  checkSquaresAround(r1,c1,r2,c2,cfg).forEach(([r,c])=>{
    fillSquare(r,c,cfg,state.currentPlayer);
    state.scores[state.currentPlayer]=(state.scores[state.currentPlayer]||0)+1;
    squareCompleted=true;
    audioManager.playSquareComplete();
    const cx=cfg._pixi.padding+c*cfg._pixi.spacing+cfg._pixi.spacing/2;
    const cy=cfg._pixi.padding+r*cfg._pixi.spacing+cfg._pixi.spacing/2;
    spawnParticles(cx,cy,THEME.playerColors[state.currentPlayer-1]||0x888888);
  });

  updateScoreboard();

  const totalSquares=(cfg.rows-1)*(cfg.cols-1);
  const filled=Object.values(state.scores||{}).reduce((a,b)=>(+a||0)+(+b||0),0);
  if (filled===totalSquares) {
    if (cfg.aiMode==='online'&&!isOpponentMove) onlineManager.pushMove(key,Date.now());
    endGame(cfg,state.scores); return;
  }

  if (!squareCompleted) {
    state.currentPlayer=(state.currentPlayer%cfg.players)+1;
    updateTurn(cfg);
  }

  if (cfg.aiMode==='online'&&!isOpponentMove) onlineManager.pushMove(key,Date.now());
  setTimeout(()=>triggerAIIfNeeded(cfg),100);
}

export function fillSquare(r,c,cfg,player) {
  const {spacing,padding}=cfg._pixi;
  const x=padding+c*spacing+3, y=padding+r*spacing+3;
  const w=spacing-6, h=spacing-6;
  const color=THEME.playerColors[player-1]||0x888888;
  const glow=THEME.playerGlows[player-1]||0x888888;

  const glowSq=new PIXI.Graphics();
  glowSq.roundRect(x-4,y-4,w+8,h+8,8).fill({color:glow,alpha:0});
  squareLayer.addChild(glowSq);

  const sq=new PIXI.Graphics();
  sq.roundRect(x,y,w,h,6).fill({color,alpha:0});
  squareLayer.addChild(sq);

  const label=new PIXI.Text({text:String(player),style:{
    fill:color, fontSize:Math.floor(spacing*0.32),
    fontWeight:'bold', fontFamily:'sans-serif',
  }});
  label.anchor.set(0.5);
  label.x=x+w/2; label.y=y+h/2; label.alpha=0;
  squareLayer.addChild(label);

  let alpha=0;
  const animate=()=>{
    alpha+=0.06;
    const a=Math.min(alpha,1);
    sq.clear(); sq.roundRect(x,y,w,h,6).fill({color,alpha:a*THEME.squareAlpha});
    glowSq.clear(); glowSq.roundRect(x-4,y-4,w+8,h+8,8).fill({color:glow,alpha:a*0.08});
    label.alpha=a*0.4;
    if (alpha<1) requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

function spawnParticles(cx,cy,color) {
  const COUNT=14;
  for (let i=0;i<COUNT;i++) {
    const p=new PIXI.Graphics();
    const size=2+Math.random()*3;
    p.circle(0,0,size).fill({color,alpha:1});
    p.x=cx; p.y=cy; fxLayer.addChild(p);
    const angle=(i/COUNT)*Math.PI*2+Math.random()*0.3;
    const speed=2.5+Math.random()*3;
    const vx=Math.cos(angle)*speed, vy=Math.sin(angle)*speed;
    let life=1.0;
    const tick=()=>{
      life-=0.04; p.x+=vx; p.y+=vy*0.9;
      p.alpha=Math.max(life,0); p.scale.set(Math.max(life,0));
      if (life>0) requestAnimationFrame(tick); else fxLayer.removeChild(p);
    };
    requestAnimationFrame(tick);
  }
  const ring=new PIXI.Graphics();
  fxLayer.addChild(ring);
  let rLife=1, rSize=0;
  const ringTick=()=>{
    rLife-=0.05; rSize+=4;
    ring.clear(); ring.circle(cx,cy,rSize).stroke({color,width:2,alpha:rLife*0.6});
    if (rLife>0) requestAnimationFrame(ringTick); else fxLayer.removeChild(ring);
  };
  requestAnimationFrame(ringTick);
}

function triggerAIIfNeeded(cfg) {
  if (!aiPlayer||state.currentPlayer!==2||isAIThinking) return;
  isAIThinking=true;
  setTimeout(()=>executeAIMove(cfg),500);
}
function executeAIMove(cfg) {
  const move=aiPlayer.makeMove(cfg);
  if (!move){isAIThinking=false;return;}
  if (state.lines.has(move.key)){isAIThinking=false;setTimeout(()=>triggerAIIfNeeded(cfg),100);return;}
  const edgeObj=edgeObjects.find(e=>e.key===move.key);
  if (!edgeObj){isAIThinking=false;return;}
  isAIThinking=false;
  handleEdgeClick(edgeObj,cfg);
}

export function applyOnlineMove(lineKey,cfg) {
  if (state.lines.has(lineKey)) return;
  const edgeObj=edgeObjects.find(e=>e.key===lineKey);
  if (edgeObj) handleEdgeClick(edgeObj,cfg,true);
}

export function resetState() {
  state.currentPlayer=1; state.lines=new Set();
  if (state.scores) for (const k in state.scores) state.scores[k]=0;
  _dots=[];
  if (app){ try { app.destroy({ removeView: false }, { children: true, texture: true }); } catch(e){} app=null; }
}
