import { CFG } from './core/config.js';
import { toXY, fromXY } from './core/geo.js';
import { toast } from './core/dom.js';
import { state, input, car, segments, stations, churchMarks, hudCache } from './core/state.js';

import { map, dist } from './world/map.js';
import { buildRoads, nearestRoad } from './world/roads.js';
import { addPOIs } from './world/pois.js';
import { addScenery, refreshScenery } from './world/scenery.js';
import { setTheme, DAY, NIGHT } from './world/theme.js';

import { updateHUD, setCtxBtn } from './ui/hud.js';
import { fmInit, fmEvent, fmStep, fmToggle } from './systems/fm.js';
import { updateRadio } from './systems/radio.js';
import { updateDrivetrain, startEngine } from './systems/drivetrain.js';
import { checkJob } from './systems/jobs.js';
import { initGame, startGame, startSequence, finishSequence } from './systems/onboarding-sequence.js';
import { laneChange } from './systems/input.js';
import './systems/live.js';
import './systems/save.js';
import './systems/traces.js';
import './systems/settings.js';
import './systems/police.js';
import './systems/lights.js';
import './systems/speed.js';
import './systems/peds.js';
import './systems/signs.js';
import './systems/audio.js';
import './systems/sfx.js';
import './systems/passengers.js';
import './systems/fmquests.js';
import './systems/progression.js';
import './systems/onboarding.js';
import './systems/multiplayer.js';
import './systems/postcard.js';
import './systems/catrig.js';

// (фізика КПП — чиста частина в core/drivetrain.js, обгортка в systems/drivetrain.js)

// Орієнтири для замовлень (реальні місця Оболоні)



// ================= ГЕО-ХЕЛПЕРИ (equirectangular XY) =================





// ================= СТАН =================
const carEl = document.getElementById('car');




 // {from,to,stage:'pickup'|'deliver',fromMk,toMk,dist}





 // кеш результату nearestRoad() цього кадру (дедуп — SPEED читає це замість повторного виклику)
// (laneChange — у systems/input.js)






// (локальне радіо Сенс/церква винесено у systems/radio.js)
// (мультиплеєр винесено у systems/multiplayer.js)

// ================= ЕКОНОМІКА / ПАЛИВО =================
function useFuel(distM){
  let rate=CFG.consCity;
  if(state.fuelType==='LPG') rate*=1.12;        // газ: дешевший, але витрата вища (+12%)
  if(state.blessing>0) rate*=0.85;
  state.fuel=Math.max(0, state.fuel - (rate/100)*(distM/1000));
}

// (система замовлень винесена у systems/jobs.js)

// ================= UI =================


function updateCtx(lat,lng){
  const btn=document.getElementById('ctx');
  // заглухлий двигун (механіка) — завести
  if(car.mode==='manual' && !car.engineRunning && Math.abs(car.speed)<8){
    setCtxBtn(btn,'🔑 Завести двигун','block'); state.ctxAction=startEngine; return;
  }
  // АЗС
  let near=null;
  for(const s of stations){ if(dist(lat,lng,s.lat,s.lng)<CFG.arrive){ near={type:'fuel',s}; break; } }
  if(!near) for(const c of churchMarks){ if(dist(lat,lng,c.lat,c.lng)<CFG.arrive){ near={type:'church',c}; break; } }
  if(near && Math.abs(car.speed)<8){
    if(near.type==='fuel'){ setCtxBtn(btn,'⛽ Заправитись','block'); state.ctxAction=()=>openFuel(near.s); }
    else{ const ready=state.churchCd<=0; setCtxBtn(btn, ready?'⛪ Зайти до храму':'⛪ Вже сьогодні','block'); state.ctxAction=ready?visitChurch:null; }
  } else { setCtxBtn(btn,hudCache.ctxTxt||'','none'); state.ctxAction=null; }
}
function visitChurch(){ if(state.churchCd>0) return; state.money+=CFG.churchBonus; state.blessing=1; state.churchCd=CFG.churchCooldownSec; window.SFX&&window.SFX.play('cash');
  toast(`🙏 +${CFG.churchBonus} грн · Благословення дороги (−15% пального)`); fmEvent('church'); window.PROGRESSION&&window.PROGRESSION.event('church'); window.SAVE&&window.SAVE.save(); }

function openFuel(s){ state.phase='fuel';
  document.getElementById('fuelStation').textContent='АЗС '+s.name;
  document.getElementById('fuelNow').textContent=state.fuel.toFixed(1);
  document.getElementById('fuelMoney').textContent=Math.round(state.money);
  document.getElementById('priceA95').textContent=s.a95.toFixed(2)+' грн/л';
  document.getElementById('priceLPG').textContent=s.lpg.toFixed(2)+' грн/л';
  document.getElementById('fuelPanel').classList.remove('hidden');
  fuelPanel._s=s;
}
function doRefuel(kind){ const s=fuelPanel._s; const price = kind==='LPG'?s.lpg:s.a95;
  const need=CFG.tank-state.fuel;
  let liters, cost;
  if(kind==='500'){ liters=Math.min(500/s.a95, need); cost=liters*s.a95; }
  else { liters=need; cost=liters*price; }
  if(cost>state.money){ liters=state.money/price; cost=state.money; }
  state.money-=cost; state.fuel+=liters;
  if(kind==='LPG'){ state.fuelType='LPG'; } else { state.fuelType='A95'; }
  toast(`Залито ${liters.toFixed(1)} л ${kind==='LPG'?'газу':'А-95'} на ${Math.round(cost)} грн`);
  fmEvent('refuel'); window.SAVE&&window.SAVE.save();
  closeFuel();
}
function closeFuel(){ document.getElementById('fuelPanel').classList.add('hidden'); state.phase='play'; }
const fuelPanel=document.getElementById('fuelPanel');

// ================= ЦИКЛ =================
function tick(now){
  requestAnimationFrame(tick);
  if(state.phase!=='play'){ state.lastT=now; window.AUDIO&&window.AUDIO.step(0.016); window.MP&&window.MP.step(); return; }
  let dt=(now-state.lastT)/1000; state.lastT=now; if(dt<=0) return; if(dt>0.05) dt=0.05;
  step(dt); window.AUDIO&&window.AUDIO.step(dt); window.MP&&window.MP.step();
}
function step(dt){
  if(state.handedMode==='one'){
    // кермуємо ◀▶, гальмуємо; авто саме розганяється до заданої макс. швидкості
    if(car.engineRunning && state.fuel>0 && !input.brake && Math.abs(car.speed)<state.cruiseSet) input.gas=true;
    else if(!input.brake) input.gas=false;
  }
  if(input.left)  car.heading-=CFG.turn*dt;
  if(input.right) car.heading+=CFG.turn*dt;
  // зчеплення (плавно) + трансмісія (авто/механіка)
  if(car.mode==='manual'){ const tgt=input.clutch?1:0; car.clutch+=(tgt-car.clutch)*(input.clutch?14:4)*dt; car.clutch=Math.max(0,Math.min(1,car.clutch)); }
  updateDrivetrain(dt);
  if(state.fuel<=0) toastLowFuelMaybe();

  const mps=car.speed/3.6, distM=mps*dt;
  car.x+=distM*Math.sin(car.heading); car.y+=distM*Math.cos(car.heading);
  window.SAVE&&window.SAVE.addKm(Math.abs(distM)/1000);
  window.PROGRESSION&&window.PROGRESSION.event('km', Math.abs(distM)/1000);

  // режим «лише по дорогах» — м'яко притягуємо до найближчої дороги + вирівнюємо курс
  if(state.roadsOnly){
    const r=nearestRoad(car.x,car.y, car.roadName);
    state.lastRoadHit=r||null;
    if(r){
      car.roadName=r.name;
      // напрям руху вздовж дороги (з двох — ближчий до курсу)
      let a=r.ang; let diff=((a-car.heading+Math.PI)%(2*Math.PI))-Math.PI;
      if(Math.abs(diff)>Math.PI/2){ a+=Math.PI; diff=((a-car.heading+Math.PI)%(2*Math.PI))-Math.PI; }
      // правостороння їзда: ціль = вісь + зсув у свою смугу (праворуч від напряму руху)
      const lanes = r.svc?1:(r.l||1);
      if(car.lane>lanes-1) car.lane=lanes-1;
      let off;
      if(r.svc) off=0;                                        // у дворах — по осі проїзду
      else if(r.o) off=(car.lane+0.5-lanes/2)*CFG.laneW;      // односторонка: смуги центровано
      else off=(car.lane+0.5)*CFG.laneW;                      // двобічна: праворуч від осьової
      const tx=r.px+Math.cos(a)*off, ty=r.py-Math.sin(a)*off;
      const dx2=car.x-tx, dy2=car.y-ty;
      if(dx2*dx2+dy2*dy2>14*14){ car.x=tx; car.y=ty; }        // задалеко — жорстко в смугу
      else { const k=Math.min(1,dt*10); car.x+=(tx-car.x)*k; car.y+=(ty-car.y)*k; }
      const steering=(input.left||input.right||Math.abs(state.steerTarget)>0.15);
      const align=steering?dt*1.5:dt*5;   // менше вирівнювання під час керма (щоб можна було повертати)
      car.heading+=diff*Math.min(1,align);
      state.curLanes=lanes;
      const nm = r.name || (r.svc ? 'двір · проїзд' : '—');
      streetName(nm + (lanes>1 && !r.svc ? ` · смуга ${car.lane+1}/${lanes}` : ''));
    }
  } else { state.curLanes=1; state.lastRoadHit=null; streetName('вільний режим'); }

  // паливо / бонуси / кулдауни
  if(Math.abs(car.speed)>0.5) useFuel(Math.abs(distM)); else if(car.engineRunning) state.fuel=Math.max(0,state.fuel-CFG.idleLh/3600*dt);
  if(state.churchCd>0) state.churchCd-=dt;
  if(state.blessing>0) state.blessing-=distM/1000/10; // тане за 10 км

  const p=fromXY(car.x,car.y);
  map.setView([p.lat,p.lng],CFG.zoom,{animate:false});
  carEl.style.transform=`rotate(${car.heading}rad)`;
  checkJob(p.lat,p.lng);
  updateCtx(p.lat,p.lng);
  updateRadio(p.lat,p.lng);
  fmStep(dt);
  window.FMQUESTS&&window.FMQUESTS.step(dt);
  window.liveStep&&window.liveStep(dt);
  window.TRACES&&window.TRACES.step(dt);
  window.LIGHTS&&window.LIGHTS.step(dt);
  window.SPEED&&window.SPEED.step(dt);
  window.PEDS&&window.PEDS.step(dt);
  window.CATRIG&&window.CATRIG.step(dt);
  applyDayNight();
  window.PASSENGERS&&window.PASSENGERS.step(dt);
  updateHUD();
}

function toastLowFuelMaybe(){ if(!state.lowShown && state.fuel<=0){ state.lowShown=true; toast('⛽ Пусто! Дійди пішки або заправся.'); fmEvent('lowFuel'); } }

 // кеш останніх записаних значень DOM у updateHUD/updateCtx — пишемо лише коли змінилось
function streetName(n){ if(n!==state.curStreet){ state.curStreet=n; document.getElementById('street').firstElementChild.textContent=n||'—'; } }
requestAnimationFrame(tick);

// (прив'язка вводу — клавіатура/дотик/кермо/передачі — винесена у systems/input.js)
document.getElementById('ctx').addEventListener('click',()=>{ if(state.ctxAction) state.ctxAction(); });
document.getElementById('fullA95').addEventListener('click',()=>doRefuel('A95'));
document.getElementById('fullLPG').addEventListener('click',()=>doRefuel('LPG'));
document.getElementById('fuel500').addEventListener('click',()=>doRefuel('500'));
document.getElementById('fuelClose').addEventListener('click',closeFuel);

// (стартова послідовність винесена у systems/onboarding-sequence.js)
addEventListener('resize',()=>map.invalidateSize()); setTimeout(()=>map.invalidateSize(),300);


fmInit(); window.liveInit&&window.liveInit(); window.SAVE&&window.SAVE.load(); window.TRACES&&window.TRACES.init(); window.SETTINGS&&window.SETTINGS.init(); window.POLICE&&window.POLICE.init(); window.LIGHTS&&window.LIGHTS.init(); window.SPEED&&window.SPEED.init(); window.PEDS&&window.PEDS.init(); window.SIGNS&&window.SIGNS.init(); window.AUDIO&&window.AUDIO.init(); window.SFX&&window.SFX.init(); window.PROGRESSION&&window.PROGRESSION.init(); window.PASSENGERS&&window.PASSENGERS.init(); window.FMQUESTS&&window.FMQUESTS.init(); window.ONBOARDING&&window.ONBOARDING.init(); window.MP&&window.MP.init(); window.CATRIG&&window.CATRIG.init();

// День↔ніч міняє ПАЛІТРУ світу (а не накладає сіру плівку). Перемикаємо дискретно,
// лише коли фаза реально змінилась: зміна теми = перемальовка всіх кешованих тайлів.
let _wasNight = null;
function applyDayNight(){
  try{
    if(!window.OWN_WORLD || !window.LIVE) return;
    const isNight = !!window.LIVE.isNight;
    if(isNight === _wasNight) return;
    _wasNight = isNight;
    setTheme(isNight ? NIGHT : DAY);
    refreshScenery();
  }catch(e){}
}

// ================= ЗАВАНТАЖЕННЯ ДАНИХ =================
// N2: roads і pois завантажуються незалежно (allSettled) — падіння одного не
// відкидає інший; кожен fetch перевіряє r.ok; якщо дороги не завантажились
// (або сегментів 0), гра лишається керованою — вимикаємо roadsOnly і попереджаємо.
Promise.allSettled([
  fetch('data/roads.json').then(r=>{ if(!r.ok) throw new Error('roads http '+r.status); return r.json(); }),
  fetch('data/pois.json').then(r=>{ if(!r.ok) throw new Error('pois http '+r.status); return r.json(); }),
  fetch('data/world.json').then(r=>{ if(!r.ok) throw new Error('world http '+r.status); return r.json(); })
]).then(([roadsRes, poisRes, worldRes])=>{
  try{
    var notes=[];
    if(roadsRes.status==='fulfilled'){
      try{ buildRoads(roadsRes.value.roads); }catch(e){ notes.push('Помилка обробки доріг'); }
    } else { notes.push('Дороги не завантажились'); }
    // власний рендер світу (будівлі/вода/зелень/дороги). Якщо не вийшло —
    // лишається тайлова підкладка, тож гра виглядає гірше, але працює.
    if(worldRes.status==='fulfilled' && roadsRes.status==='fulfilled'){
      try{
        addScenery(map, worldRes.value, roadsRes.value.roads);
        document.body.classList.add('own-world');   // ховає чужі тайли
        window.OWN_WORLD = true;
      }catch(e){ notes.push('Власний світ не намалювався'); }
    } else if(worldRes.status!=='fulfilled'){ notes.push('геометрія світу не завантажилась'); }
    if(segments.length===0){
      state.roadsOnly=false;
      notes.push('режим вільної їзди');
      try{
        var b=document.getElementById('modeBtn');
        if(b){ b.classList.add('on'); b.innerHTML='🗺️<small>БУДЬ-ДЕ</small>'; }
      }catch(e){}
      try{ toast('🗺️ Дороги не завантажились — увімкнено вільну їзду'); }catch(e){}
    }
    if(poisRes.status==='fulfilled'){
      try{ addPOIs(poisRes.value); }catch(e){ notes.push('Помилка обробки точок'); }
    } else { notes.push('точки (АЗС/храми) не завантажились'); }
    if(stations.length===0) notes.push('АЗС не завантажено');
    var base=`Готово: ${segments.length} відрізків доріг, ${stations.length} АЗС, ${churchMarks.length} храмів`;
    document.getElementById('loadNote').textContent = notes.length ? (base+' · '+notes.join('; ')) : base;
  }catch(e){ try{ document.getElementById('loadNote').textContent='Помилка завантаження даних: '+e; }catch(e2){} }
});


// ===== DEV-ТЕСТ-МІСТ (Vite прибирає з прод-збірки: import.meta.env.DEV===false) =====
if (import.meta.env && import.meta.env.DEV) {
  window.__game = { startGame, startSequence, finishSequence, step, toast, fmToggle,
    laneChange, nearestRoad, toXY, fromXY, initGame, state, input, car, segments };
}
