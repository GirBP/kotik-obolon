// ================= HUD =================
import { CFG, ENG } from '../core/config.js';
import { car, hudCache, state } from '../core/state.js';

export function rangeKm(){ return (state.fuel / CFG.consCity) * 100; }
export function updateHUD(){
  try{
    const moneyTxt=String(Math.round(state.money));
    if(hudCache.money!==moneyTxt){ hudCache.money=moneyTxt; document.getElementById('money').textContent=moneyTxt; }
    const speedTxt=String(Math.round(Math.abs(car.speed)));
    if(hudCache.speed!==speedTxt){ hudCache.speed=speedTxt; document.getElementById('speed').textContent=speedTxt; }
    const pct=Math.max(0,Math.min(1,state.fuel/CFG.tank));
    const widthTxt=(pct*100)+'%';
    const bgTxt = pct<0.15?'#d93a34':(pct<0.3?'#e8a33a':'#2eb35c');
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
      const rpmBgTxt=(car.rpm>ENG.redline)?'#d93a34':(car.rpm>ENG.redline*0.85?'#e8a33a':'#2b7fd4');
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
