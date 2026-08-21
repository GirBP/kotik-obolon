// ================= HUD =================
import { CFG, ENG } from '../core/config.js';
import { car, hudCache, state } from '../core/state.js';

// «Ранкова шпальта»: акценти узгоджені з палітрою index.html (var(--red)/(--accent)/(--green))
const COL_STOP = '#FF5A4E';
const COL_WARN = '#F5A623';
const COL_GO = '#29B6C6';

// поріг «тиха ділянка»: гравець ледь рухається/стоїть — ховаємо неактивні чипи, лишаємо час/погоду й вулицю
const CALM_SPEED = 12; // км/год
const CALM_HOLD_SEC = 3; // скільки секунд поспіль треба їхати повільно, перш ніж ховати HUD

let calmSlowT = 0;   // секунд поспіль car.speed < CALM_SPEED
let calmOn = false;  // поточний стан класу #hud.calm (щоб не смикати DOM без зміни)
let calmLastMs = null; // час попереднього виклику (для власного dt — updateHUD() дт не отримує)

/** Автоприховування неактивних чипів на «тихих» ділянках (стоїть/повільно їде довше CALM_HOLD_SEC). */
function updateCalm(){
  const nowMs = (typeof performance!=='undefined' ? performance.now() : Date.now());
  const dt = calmLastMs==null ? 0 : Math.min(0.25, (nowMs-calmLastMs)/1000);
  calmLastMs = nowMs;

  const inPlay = (typeof state.phase === 'undefined') || state.phase === 'play';
  const slow = inPlay && Math.abs(car.speed) < CALM_SPEED;
  calmSlowT = slow ? calmSlowT+dt : 0;

  const shouldCalm = calmSlowT >= CALM_HOLD_SEC;
  if(shouldCalm !== calmOn){
    calmOn = shouldCalm;
    const hud = document.getElementById('hud');
    if(hud) hud.classList.toggle('calm', calmOn);
  }
}

export function rangeKm(){ return (state.fuel / CFG.consCity) * 100; }
export function updateHUD(){
  try{
    updateCalm();
    const moneyTxt=String(Math.round(state.money));
    if(hudCache.money!==moneyTxt){ hudCache.money=moneyTxt; document.getElementById('money').textContent=moneyTxt; }
    const speedAbs=Math.round(Math.abs(car.speed));
    const speedTxt=String(speedAbs);
    if(hudCache.speed!==speedTxt){
      hudCache.speed=speedTxt;
      const elSpeed=document.getElementById('speed');
      elSpeed.textContent=speedTxt;
      // кінетична типографіка: вага цифри росте з швидкістю (400 на стоянці → 650 на максимумі CFG.maxSpeed)
      const wght=Math.max(400,Math.min(650, 400+250*speedAbs/CFG.maxSpeed));
      elSpeed.style.fontVariationSettings="'wght' "+wght;
    }
    const pct=Math.max(0,Math.min(1,state.fuel/CFG.tank));
    const widthTxt=(pct*100)+'%';
    const bgTxt = pct<0.15?COL_STOP:(pct<0.3?COL_WARN:COL_GO);
    if(hudCache.fuelW!==widthTxt || hudCache.fuelBg!==bgTxt){
      const bar=document.getElementById('fuelBar');
      if(hudCache.fuelW!==widthTxt){ bar.style.width=widthTxt; hudCache.fuelW=widthTxt; }
      if(hudCache.fuelBg!==bgTxt){ bar.style.background=bgTxt; hudCache.fuelBg=bgTxt; }
    }
    const rangeTxt=String(Math.round(rangeKm()));
    if(hudCache.range!==rangeTxt){ hudCache.range=rangeTxt; document.getElementById('range').textContent=rangeTxt; }
    if(car.mode==='manual'){
      const gearTxt=car.gearDisp||'N';
      if(hudCache.gear!==gearTxt){ hudCache.gear=gearTxt; document.getElementById('gearVal').textContent=gearTxt; }
      const rp=Math.max(0,Math.min(1,(car.rpm||0)/ENG.redline));
      const rpmWTxt=(rp*100)+'%';
      const rpmBgTxt=(car.rpm>ENG.redline)?COL_STOP:(car.rpm>ENG.redline*0.85?COL_WARN:COL_GO);
      if(hudCache.rpmW!==rpmWTxt || hudCache.rpmBg!==rpmBgTxt){
        const rb=document.getElementById('rpmBar');
        if(hudCache.rpmW!==rpmWTxt){ rb.style.width=rpmWTxt; hudCache.rpmW=rpmWTxt; }
        if(hudCache.rpmBg!==rpmBgTxt){ rb.style.background=rpmBgTxt; hudCache.rpmBg=rpmBgTxt; }
      }
      const stallOn=!car.engineRunning;
      if(hudCache.stall!==stallOn){ hudCache.stall=stallOn; document.getElementById('gearChip').classList.toggle('stall', stallOn); }
    }
  }catch(e){}
}

// контекстна кнопка (АЗС / церква)

export function setCtxBtn(btn,txt,disp){
  if(hudCache.ctxTxt!==txt){ hudCache.ctxTxt=txt; btn.textContent=txt; }
  if(hudCache.ctxDisp!==disp){ hudCache.ctxDisp=disp; btn.style.display=disp; }
}
