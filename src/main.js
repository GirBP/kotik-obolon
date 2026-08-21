import { CFG, GEARS_M, ENG, torqueCurve, LANDMARKS, MP_BROKERS } from './core/config.js';
import { toXY, fromXY } from './core/geo.js';
import { ac, bell } from './core/audio.js';
import { esc, toast } from './core/dom.js';
import { state, input, car, resetCar, segments, stations, churchMarks, radio, hudCache } from './core/state.js';

import { map, dist } from './world/map.js';
import { poiIcon } from './world/markers.js';
import { buildRoads, nearestRoad } from './world/roads.js';
import { addPOIs } from './world/pois.js';
import { speakLines } from './core/tts.js';

import { updateHUD, setCtxBtn } from './ui/hud.js';
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

// ================= КОНФІГ =================




// ===== КПП (реалістична модель, спец) =====



function updateDrivetrain(dt){
  const running = car.engineRunning && state.fuel>0;
  const throttle = (input.gas && running)?1:0;
  if(car.mode!=='manual'){
    // АВТОМАТ — аркадна модель, без глохнення
    const grip=(window.LIVE?window.LIVE.grip:1);   // мокра/слизька дорога → довший гальмівний шлях
    if(running){ if(input.gas) car.speed+=CFG.accel*dt; else if(input.brake) car.speed-=CFG.brake*grip*dt; else car.speed-=CFG.friction*dt; }
    else { if(input.brake) car.speed-=CFG.brake*grip*dt; else car.speed-=CFG.friction*dt; }
    car.speed=Math.max(0,Math.min(CFG.maxSpeed,car.speed)); car.gearDisp='D'; return;
  }
  // МЕХАНІКА
  const comb=GEARS_M[String(car.gear)]||0;
  const engaged = car.engineRunning ? (car.gear!==0 ? (1-car.clutch) : 0) : 0;
  const freeTarget = ENG.idle + throttle*(ENG.redline-ENG.idle);
  const wheelRPM = Math.abs(car.speed)*Math.abs(comb)*ENG.KFAC;
  const rpmTarget = freeTarget*(1-engaged) + wheelRPM*engaged;
  car.rpm += (rpmTarget-car.rpm)*(rpmTarget>car.rpm?ENG.revUp:ENG.revDown)*dt;
  car.rpm = Math.max(0, Math.min(ENG.fuelcut, car.rpm));
  if(!car.engineRunning) car.rpm=0;
  let engineForce=0;
  if(car.engineRunning && engaged>0 && car.gear!==0 && state.fuel>0)
    engineForce = torqueCurve(car.rpm)*throttle*Math.abs(comb)*ENG.forceK*engaged*Math.sign(comb);
  const brakeForce=(input.brake?1:0)*ENG.brakeN*(window.LIVE?window.LIVE.grip:1);
  const drag=ENG.dragA*car.speed*Math.abs(car.speed)+ENG.roll*Math.sign(car.speed);
  const accel=(engineForce - brakeForce*Math.sign(car.speed) - drag)/ENG.mass;
  car.speed += accel*dt*3.6;
  const minS = car.gear===-1? -CFG.maxSpeed*0.4 : 0;
  car.speed = Math.max(minS, Math.min(CFG.maxSpeed, car.speed));
  if(car.engineRunning && engaged>0.5 && car.rpm<ENG.stall){ car.stallT=(car.stallT||0)+dt;
    if(car.stallT>ENG.stallGrace){ car.engineRunning=false; car.rpm=0; car.speed*=0.6; toast('💥 Двигун заглух! Вижми зчеплення і заведи (🔑).'); fmEvent('stall'); } }
  else car.stallT=0;
  car.gearDisp = car.gear===-1?'R':(car.gear===0?'N':String(car.gear));
}
function shiftGear(delta){
  if(car.mode!=='manual') return;
  if(car.clutch<0.7){ toast('Вижми зчеплення, щоб перемкнути передачу'); return; }
  car.gear=Math.max(-1,Math.min(5, car.gear+delta));
  toast('Передача: '+(car.gear===-1?'R':car.gear===0?'N':car.gear));
}
function startEngine(){ if(!car.engineRunning){ if(car.mode==='manual' && car.clutch<0.7 && car.gear!==0){ toast('Вижми зчеплення, щоб завести'); return; }
  car.engineRunning=true; car.rpm=ENG.idle; window.SFX&&window.SFX.play('engine_start'); toast('🔑 Двигун заведено'); } }

// Орієнтири для замовлень (реальні місця Оболоні)



// ================= ГЕО-ХЕЛПЕРИ (equirectangular XY) =================





// ================= СТАН =================
const carEl = document.getElementById('car');




 // {from,to,stage:'pickup'|'deliver',fromMk,toMk,dist}





 // кеш результату nearestRoad() цього кадру (дедуп — SPEED читає це замість повторного виклику)
function laneChange(dir){ // -1 = лівіше (до осі), +1 = правіше (до узбіччя)
  if(!state.roadsOnly || state.curLanes<2) return;
  const old=car.lane;
  car.lane=Math.max(0,Math.min(state.curLanes-1, car.lane+dir));
  if(car.lane!==old){ window.SFX&&window.SFX.play('blinker'); toast(`Смуга ${car.lane+1} із ${state.curLanes}`); }
}






// ================= РАДІО (Сенс / церква) =================
// Голосу Стерненка тут НЕМАЄ і не імітується: диктор (TTS) лише згадує співпрацю.
// Якщо покладеш ліцензовані файли assets/radio_sens.mp3 / assets/radio_church.mp3 —
// гратимуть вони замість синтезу.
const RADIO_TEXT={
  sens:["Ви слухаєте Радіо «Сенс»!",
        "У книгарні «Сенс» — нові українські книжки, кава та розмови про головне.",
        "Триває спільний благодійний збір книгарні «Сенс» і Сергія Стерненка на дрони для війська — долучайтесь!",
        "Читаймо українське. Слава Україні!"],
  church:["Отче наш, що єси на небесах, нехай святиться ім'я Твоє.",
        "Нехай прийде Царство Твоє, нехай буде воля Твоя, як на небі, так і на землі.",
        "Хліб наш насущний дай нам сьогодні.",
        "І прости нам провини наші, як і ми прощаємо винуватцям нашим.",
        "І не введи нас у спокусу, але визволи нас від лукавого. Амінь."]
};

// ID відео з ОФІЦІЙНОГО каналу Стерненка для радіо «Сенс» (офіційний YouTube-embed:
// звук стрімиться з його каналу, нічого не копіюється). Заповнюється власником гри.
const SENS_YT=[];
function openYt(){ const ids=SENS_YT.filter(Boolean); if(!ids.length) return false;
  const id=ids[Math.floor(Math.random()*ids.length)];
  document.getElementById('ytFrame').src='https://www.youtube-nocookie.com/embed/'+encodeURIComponent(id)+'?autoplay=1&playsinline=1';
  document.getElementById('ytBox').classList.remove('hidden'); return true; }
function closeYt(){ document.getElementById('ytFrame').src=''; document.getElementById('ytBox').classList.add('hidden'); }
document.getElementById('ytClose').addEventListener('click',()=>stopRadio());



function churchBells(){ const t=ac().currentTime+0.05; [523,392,330,392,523].forEach((f,i)=>bell(f,t+i*0.9,2.4,0.22)); }
function sensJingle(){ const t=ac().currentTime+0.05; [660,880,990].forEach((f,i)=>bell(f,t+i*0.18,0.5,0.18)); }
function synthRadio(type){
  if(type==='sens'){ sensJingle(); setTimeout(()=>{ if(radio.on&&radio.type==='sens'){ if(!speakLines(RADIO_TEXT.sens)) toast('📻 '+RADIO_TEXT.sens[2]); } },800); }
  else { churchBells(); setTimeout(()=>{ if(radio.on&&radio.type==='church'){ if(!speakLines(RADIO_TEXT.church)) toast('📻 '+RADIO_TEXT.church[0]); } },4200); }
}
function startRadio(type){
  if(window.MUTED) return; // G4: при вимкненому звуці радіо не запускаємо (ні YouTube, ні mp3)
  stopRadio(); radio.on=true; radio.type=type;
  document.getElementById('radioBtn').classList.add('on');
  document.getElementById('radioBtn').textContent='📻 Вимкнути';
  if(type==='sens' && openYt()){                        // офіційний YouTube-embed, якщо задано відео
    toast('📻 Радіо «Сенс»: ефір з каналу Стерненка'); return; }
  const a=new Audio('assets/radio_'+type+'.mp3');       // власний файл, якщо є
  a.onerror=()=>{ radio.audio=null; if(radio.on&&radio.type===type) synthRadio(type); };
  a.oncanplaythrough=()=>{ if(radio.on&&radio.type===type){ a.loop=true; a.play().catch(()=>synthRadio(type)); } };
  radio.audio=a;
  document.getElementById('radioBtn').classList.add('on');
  document.getElementById('radioBtn').textContent='📻 Вимкнути';
  toast(type==='sens' ? '📻 Радіо «Сенс» в ефірі!' : '🔔 Дзвони та молитва');
}
export function stopRadio(){
  closeYt();
  if(radio.audio){ try{radio.audio.pause();}catch(_){ } radio.audio=null; }
  try{ window.speechSynthesis && speechSynthesis.cancel(); }catch(_){ }
  radio.on=false; radio.type=null;
  const b=document.getElementById('radioBtn'); b.classList.remove('on'); b.textContent='📻 Радіо';
}

function updateRadio(lat,lng){
  let t=null;
  if(state.sensPoi && dist(lat,lng,state.sensPoi.lat,state.sensPoi.lng)<CFG.radioR) t='sens';
  if(!t){ for(const c of churchMarks){ if(dist(lat,lng,c.lat,c.lng)<(c.r||CFG.radioR)){ t='church'; break; } } }
  state.radioNearType=t;
  if(radio.on && !t) stopRadio();               // від'їхав — радіо згасає
  const b=document.getElementById('radioBtn');
  b.style.display = (t||radio.on) ? 'block' : 'none';
}
document.getElementById('radioBtn').addEventListener('click',()=>{
  if(radio.on) stopRadio(); else if(state.radioNearType) startRadio(state.radioNearType);
});
if('speechSynthesis' in window){ speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged=()=>speechSynthesis.getVoices(); }

// ================= МУЛЬТИПЛЕЄР (публічний MQTT-брокер) =================
// Канал публічний (best-effort): передаються лише нік і позиція котика в грі.


export const mp={on:false,client:null,id:'k'+Math.random().toString(36).slice(2,9),
          nick:'Котик',room:'obolon',ghosts:new Map(),pubT:null,pruneT:null,brokerIdx:0,base:''};
function hueOf(id){ let h=0; for(const ch of id) h=(h*31+ch.charCodeAt(0))%360; return h; }

function ghostIcon(n,hue){ return L.divIcon({className:'',iconSize:[40,46],iconAnchor:[20,23],
  html:`<div style="text-align:center"><div style="font-size:9px;font-weight:800;background:rgba(20,22,26,.85);color:#fff;border-radius:6px;padding:1px 5px;margin-bottom:1px;white-space:nowrap;max-width:64px;overflow:hidden">${esc(n)}</div><div style="width:16px;height:26px;margin:0 auto;background:hsl(${hue},85%,55%);border-radius:6px 6px 7px 7px;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.4)"></div></div>`}); }
function mpStart(){
  if(!window.mqtt){ toast('👥 Мультиплеєр недоступний (не завантажився mqtt)'); return; }
  mp.nick=(document.getElementById('mpNick').value.trim()||'Котик').slice(0,12);
  mp.room=(document.getElementById('mpRoom').value.trim().replace(/[^\wа-яіїєґ-]/gi,'')||'obolon').slice(0,16);
  try{ localStorage.setItem('mpNick',mp.nick); localStorage.setItem('mpRoom',mp.room); }catch(_){ }
  mp.base='kotikobolon/'+mp.room;
  connectBroker();
  clearInterval(mp.pubT); clearInterval(mp.pruneT);
  mp.pubT=setInterval(()=>{ if(mp.on && state.phase==='play' && mp.client && mp.client.connected){
    mp.client.publish(mp.base+'/pos', JSON.stringify({id:mp.id,n:mp.nick,x:+car.x.toFixed(1),y:+car.y.toFixed(1)})); } },150);
  mp.pruneT=setInterval(mpPrune,2000);
}
function connectBroker(){
  if(mp.client) return; // не перестворювати клієнт, якщо вже є (у т.ч. під час реконекту)
  const url=MP_BROKERS[mp.brokerIdx%MP_BROKERS.length];
  try{ mp.client=mqtt.connect(url,{clientId:'kotik_'+mp.id,keepalive:30,connectTimeout:6000,
    will:{topic:mp.base+'/leave',payload:JSON.stringify({id:mp.id}),qos:0,retain:false}}); }
  catch(_){ return; }
  mp.client.on('connect',()=>{ mp.on=true;
    mp.client.subscribe(mp.base+'/pos'); mp.client.subscribe(mp.base+'/leave');
    toast('👥 Кімната «'+mp.room+'»: підʼєднано'); updateMpChip(); });
  mp.client.on('message',(t,msg)=>{ try{ const d=JSON.parse(msg.toString());
    if(!d.id || d.id===mp.id) return;
    if(t.endsWith('/leave')){ mpDrop(d.id); return; }
    if(typeof d.x!=='number' || typeof d.y!=='number') return;
    mpGhost(d); }catch(_){ } });
  mp.client.on('error',()=>{ if(!mp.on){ try{mp.client.end(true);}catch(_){ }
    mp.client=null; // дозволяє connectBroker() перестворити клієнт для наступного брокера
    mp.brokerIdx++; if(mp.brokerIdx<MP_BROKERS.length) connectBroker();
    else toast('👥 Брокер недоступний — мультиплеєр вимкнено'); } });
  try{
    mp.client.on('close',()=>{ mp.on=false; updateMpChip(); });
    mp.client.on('offline',()=>{ mp.on=false; });
  }catch(e){}
}
function _mpStop(){ if(mp.client){ try{ mp.client.publish(mp.base+'/leave',JSON.stringify({id:mp.id})); mp.client.end(true); }catch(_){ } }
  mp.client=null; mp.on=false; clearInterval(mp.pubT);
  mp.ghosts.forEach(g=>map.removeLayer(g.mk)); mp.ghosts.clear(); updateMpChip(); }
function mpGhost(d){ let g=mp.ghosts.get(d.id); const p=fromXY(d.x,d.y);
  if(!g){ g={mk:L.marker([p.lat,p.lng],{icon:ghostIcon((d.n||'?').slice(0,12),hueOf(d.id)),interactive:false}).addTo(map),last:0};
    mp.ghosts.set(d.id,g); updateMpChip(); toast('👥 '+(d.n||'Гравець')+' у кімнаті!'); }
  g.last=performance.now(); g.mk.setLatLng([p.lat,p.lng]); }
function mpDrop(id){ const g=mp.ghosts.get(id); if(g){ map.removeLayer(g.mk); mp.ghosts.delete(id); updateMpChip(); } }
function mpPrune(){ const now=performance.now(); for(const [id,g] of mp.ghosts){ if(now-g.last>6000) mpDrop(id); } }
function updateMpChip(){ const c=document.getElementById('mpChip');
  if(mp.on){ c.classList.remove('hidden'); c.textContent='👥 '+(1+mp.ghosts.size); } else c.classList.add('hidden'); }
document.getElementById('mpToggle').addEventListener('click',()=>{
  state.mpEnabled=!state.mpEnabled;
  const b=document.getElementById('mpToggle');
  b.textContent='👥 Грати разом: '+(state.mpEnabled?'увімк':'вимк');
  b.classList.toggle('on',state.mpEnabled);
});
try{ document.getElementById('mpNick').value=localStorage.getItem('mpNick')||'';
     document.getElementById('mpRoom').value=localStorage.getItem('mpRoom')||'obolon'; }catch(_){ }

// ================= ЕКОНОМІКА / ПАЛИВО =================
function useFuel(distM){
  let rate=CFG.consCity;
  if(state.fuelType==='LPG') rate*=1.12;        // газ: дешевший, але витрата вища (+12%)
  if(state.blessing>0) rate*=0.85;
  state.fuel=Math.max(0, state.fuel - (rate/100)*(distM/1000));
}

// ================= ЗАВДАННЯ =================
function newJob(){
  if(state.job){ toast('Спершу заверши поточне замовлення'); return; }
  let a=LANDMARKS[Math.floor(Math.random()*LANDMARKS.length)], b;
  do{ b=LANDMARKS[Math.floor(Math.random()*LANDMARKS.length)]; }while(b===a);
  const d=dist(a.lat,a.lng,b.lat,b.lng)/1000;
  state.job={ from:a, to:b, stage:'pickup', distKm:d, fare:Math.round(CFG.jobBase+CFG.jobPerKm*d) };
  document.getElementById('jobBtn').classList.add('on');
  setJobMarker(a);
  toast(`📦 Забери посилку: ${a.name}`);
}
function setJobMarker(pt){
  if(state.jobMarker) map.removeLayer(state.jobMarker);
  state.jobMarker=L.marker([pt.lat,pt.lng],{icon:poiIcon('job','📦')}).addTo(map);
}
function checkJob(lat,lng){
  if(!state.job) return;
  const tgt = state.job.stage==='pickup'? state.job.from : state.job.to;
  if(dist(lat,lng,tgt.lat,tgt.lng) < CFG.arrive){
    if(state.job.stage==='pickup'){ state.job.stage='deliver'; setJobMarker(state.job.to);
      toast(`Везіть до: ${state.job.to.name} (${state.job.fare} грн)`); }
    else{ state.money+=state.job.fare; window.SFX&&window.SFX.play('cash'); window.SAVE&&window.SAVE.addEarned(state.job.fare); toast(`✅ Доставлено! +${state.job.fare} грн`); fmEvent('job'); window.PROGRESSION&&window.PROGRESSION.event('delivery');
      if(state.jobMarker){ map.removeLayer(state.jobMarker); state.jobMarker=null; }
      state.job=null; document.getElementById('jobBtn').classList.remove('on'); }
  }
}

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
  if(state.phase!=='play'){ state.lastT=now; window.AUDIO&&window.AUDIO.step(0.016); return; }
  let dt=(now-state.lastT)/1000; state.lastT=now; if(dt<=0) return; if(dt>0.05) dt=0.05;
  step(dt); window.AUDIO&&window.AUDIO.step(dt);
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
  window.PASSENGERS&&window.PASSENGERS.step(dt);
  updateHUD();
}

function toastLowFuelMaybe(){ if(!state.lowShown && state.fuel<=0){ state.lowShown=true; toast('⛽ Пусто! Дійди пішки або заправся.'); fmEvent('lowFuel'); } }

 // кеш останніх записаних значень DOM у updateHUD/updateCtx — пишемо лише коли змінилось
function streetName(n){ if(n!==state.curStreet){ state.curStreet=n; document.getElementById('street').firstElementChild.textContent=n||'—'; } }
requestAnimationFrame(tick);

// ================= ВВІД =================
function bind(id,key){ const b=document.getElementById(id);
  b.addEventListener('pointerdown',e=>{ e.preventDefault(); try{b.setPointerCapture(e.pointerId);}catch(_){ } input[key]=true; });
  const off=e=>{ e.preventDefault(); input[key]=false; };
  b.addEventListener('pointerup',off); b.addEventListener('pointercancel',off); }
bind('gas','gas'); bind('brake','brake');
// ◀▶: короткий тап = зміна смуги (у режимі доріг), утримання = кермо
function bindSteer(id,key,dir){
  const b=document.getElementById(id); let downAt=0, timer=null, held=false;
  b.addEventListener('pointerdown',e=>{ e.preventDefault(); try{b.setPointerCapture(e.pointerId);}catch(_){}
    downAt=performance.now(); held=false;
    if(state.roadsOnly && state.phase==='play' && state.curLanes>1){
      timer=setTimeout(()=>{ held=true; input[key]=true; }, CFG.holdMs);   // кермо після затримки
    } else { held=true; input[key]=true; }                                  // вільний режим — одразу кермо
  });
  const up=e=>{ e.preventDefault(); clearTimeout(timer);
    const wasTap=!held && (performance.now()-downAt)<CFG.holdMs;
    input[key]=false;
    if(wasTap && state.phase==='play') laneChange(dir); };
  b.addEventListener('pointerup',up); b.addEventListener('pointercancel',up);
}
bindSteer('left','left',-1); bindSteer('right','right',1);
const steerKeyState={};
function steerKeyDown(key,dir){
  if(steerKeyState[key]) return; steerKeyState[key]={at:performance.now(),held:false,timer:null};
  if(state.roadsOnly && state.phase==='play' && state.curLanes>1)
    steerKeyState[key].timer=setTimeout(()=>{ steerKeyState[key].held=true; input[key]=true; }, CFG.holdMs);
  else { steerKeyState[key].held=true; input[key]=true; }
}
function steerKeyUp(key,dir){
  const st=steerKeyState[key]; if(!st) return; clearTimeout(st.timer);
  const wasTap=!st.held && (performance.now()-st.at)<CFG.holdMs;
  input[key]=false; delete steerKeyState[key];
  if(wasTap && state.phase==='play') laneChange(dir);
}
// механіка: зчеплення (утримання) + передачі + вибір режиму
(function(){ const cb=document.getElementById('clutchBtn');
  cb.addEventListener('pointerdown',e=>{ e.preventDefault(); try{cb.setPointerCapture(e.pointerId);}catch(_){ } input.clutch=true; cb.classList.add('pressed'); });
  const off=e=>{ e.preventDefault(); input.clutch=false; cb.classList.remove('pressed'); };
  cb.addEventListener('pointerup',off); cb.addEventListener('pointercancel',off); })();
document.getElementById('gearUp').addEventListener('click',()=>shiftGear(1));
document.getElementById('gearDown').addEventListener('click',()=>shiftGear(-1));
const mA=document.getElementById('modeAuto'), mM=document.getElementById('modeManual');
mA.addEventListener('click',()=>{ state.selectedMode='auto'; mA.classList.add('on'); mM.classList.remove('on'); });
mM.addEventListener('click',()=>{ state.selectedMode='manual'; mM.classList.add('on'); mA.classList.remove('on'); });
const km={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'gas',ArrowDown:'brake',a:'left',d:'right',w:'gas',s:'brake',c:'clutch',ф:'left',в:'right',ц:'gas',і:'brake',с:'clutch'};
addEventListener('keydown',e=>{ const k=km[e.key]; if(k){ e.preventDefault();
    if(k==='left'||k==='right'){ if(!e.repeat) steerKeyDown(k, k==='left'?-1:1); }
    else input[k]=true;
    return; }
  if(e.key==='e'||e.key==='E'||e.key==='у'){ shiftGear(1); } else if(e.key==='q'||e.key==='Q'||e.key==='й'){ shiftGear(-1); }
  else if(e.key==='r'||e.key==='R'||e.key==='к'){ startEngine(); } });
addEventListener('keyup',e=>{ const k=km[e.key]; if(k){ e.preventDefault();
    if(k==='left'||k==='right') steerKeyUp(k, k==='left'?-1:1);
    else input[k]=false; }});

document.getElementById('modeBtn').addEventListener('click',()=>{ state.roadsOnly=!state.roadsOnly;
  const b=document.getElementById('modeBtn'); b.classList.toggle('on',!state.roadsOnly);
  b.innerHTML = state.roadsOnly?'🛣️<small>ДОРОГИ</small>':'🗺️<small>БУДЬ-ДЕ</small>';
  toast(state.roadsOnly?'Режим: лише по дорогах':'Режим: їзда будь-де'); });
document.getElementById('jobBtn').addEventListener('click',newJob);
// ===== керування однією рукою (тягни-кермуй + автогаз) =====
(function(){ const z=document.getElementById('steerZone');
  z.addEventListener('pointerdown',e=>{ e.preventDefault(); state.steerActive=true; state.steerStartX=e.clientX; try{z.setPointerCapture(e.pointerId);}catch(_){ } });
  z.addEventListener('pointermove',e=>{ if(!state.steerActive) return; const dx=e.clientX-state.steerStartX; state.steerTarget=Math.max(-1,Math.min(1, dx/(window.innerWidth*0.22))); });
  const off=()=>{ state.steerActive=false; state.steerTarget=0; };
  z.addEventListener('pointerup',off); z.addEventListener('pointercancel',off); })();
function applyHanded(){ const one=state.handedMode==='one';
  document.getElementById('steerZone').classList.add('hidden');       // без перетягування
  document.getElementById('steerHint').classList.add('hidden');
  document.getElementById('left').style.display='';                   // стрілки лишаються — ними кермуємо
  document.getElementById('right').style.display='';
  document.getElementById('gas').style.display=one?'none':'';         // у 1 руку газ автоматичний — кнопки нема
  document.getElementById('spdBtn').classList.toggle('hidden', !one);
  document.getElementById('spdVal').textContent=state.cruiseSet;
  const hb=document.getElementById('handBtn'); hb.innerHTML=one?'🖐️<small>1 РУКА</small>':'✌️<small>2 РУКИ</small>'; hb.classList.toggle('on',one);
  if(one){ state.selectedMode='auto'; if(car&&'mode' in car) car.mode='auto';
    document.getElementById('modeAuto').classList.add('on'); document.getElementById('modeManual').classList.remove('on');
    document.getElementById('manualCtl').classList.add('hidden'); document.getElementById('gearChip').classList.add('hidden'); input.gas=false; }
}
window.applyHanded=applyHanded;
document.getElementById('handBtn').addEventListener('click',()=>{ state.handedMode=state.handedMode==='one'?'two':'one'; applyHanded(); });
document.getElementById('spdBtn').addEventListener('click',()=>{ const opts=[30,40,50,58];
  state.cruiseSet=opts[(opts.indexOf(state.cruiseSet)+1)%opts.length]; document.getElementById('spdVal').textContent=state.cruiseSet;
  toast('Макс. швидкість: '+state.cruiseSet+' км/год'); });
document.getElementById('ctx').addEventListener('click',()=>{ if(state.ctxAction) state.ctxAction(); });
document.getElementById('fullA95').addEventListener('click',()=>doRefuel('A95'));
document.getElementById('fullLPG').addEventListener('click',()=>doRefuel('LPG'));
document.getElementById('fuel500').addEventListener('click',()=>doRefuel('500'));
document.getElementById('fuelClose').addEventListener('click',closeFuel);

// ================= СТАРТ + ПОСЛІДОВНІСТЬ =================
const SEQ=[
 {auto:1200, msg:'🚶 Виходиш з дому…'},
 {auto:1600, msg:'🚶 Прямуєш до авто…'},
 {tap:'🔓 Тапни, щоб відімкнути авто', short:'Замок', done:'Біп-біп! Авто відімкнено'},
 {auto:900, msg:'🚪 Сідаєш і зачиняєш двері…'},
 {tap:'🔒 Пристебни ремінь безпеки', short:'Ремінь', flag:'belt', done:'Клац! Ремінь пристебнуто ✔'},
 {tap:'🔑 Заведи двигун', short:'Запалювання', flag:'engine', done:'Двигун заведено, гуде'},
 {tap:'🖐️ Зніми з ручника', short:'Ручник', done:'Ручник знято'},
 {tap:'⚙️ Увімкни передачу (D / 1-ша)', short:'Передача', flag:'gear', done:'Готово до руху'},
 {tap:'🚦 Увімкни лівий поворотник', short:'Поворотник', flag:'blinker', done:'Поворотник блимає'},
 {auto:800, msg:'🚀 Рушаємо! Щасливої дороги, котику.'},
];

function initGame(){ if(state.handedMode==='one') state.selectedMode='auto';
  resetCar({x:0,y:0,heading:0,speed:0,engineRunning:false,belt:false,
  mode:state.selectedMode, gear:0, clutch:1, rpm:0, gearDisp:'N', stallT:0, lane:99});
  state.fuel=CFG.startFuel; state.money=CFG.startMoney; state.churchCd=0; state.blessing=0; state.job=null; state.lowShown=false;
  document.getElementById('manualCtl').classList.toggle('hidden', state.selectedMode!=='manual');
  document.getElementById('gearChip').classList.toggle('hidden', state.selectedMode!=='manual');
  document.getElementById('jobBtn').classList.remove('on'); updateHUD(); }
function startGame(){ initGame(); window.SAVE&&window.SAVE.applyRestore(); car.engineRunning=true; car.belt=true; window.SFX&&window.SFX.play('engine_start');   // швидкий старт (фолбек/тест)
  if(state.mpEnabled && !mp.on) mpStart();
  document.getElementById('startScreen').classList.add('hidden'); document.getElementById('seq').classList.add('hidden');
  state.phase='play'; state.lastT=performance.now(); window.applyHanded&&window.applyHanded();
  window.ONBOARDING&&window.ONBOARDING.enterPlay();
  try{ var _a=document.getElementById('actions'); if(_a) _a.style.display=''; }catch(e){} }
function startSequence(){ initGame();
  if(state.mpEnabled && !mp.on) mpStart();
  document.getElementById('startScreen').classList.add('hidden');
  const p=fromXY(0,0); map.setView([p.lat,p.lng],CFG.zoom,{animate:false});
  state.phase='sequence'; state.seqIdx=0; document.getElementById('seq').classList.remove('hidden'); runSeqStep();
  try{ var _a=document.getElementById('actions'); if(_a) _a.style.display='none'; }catch(e){} }
function runSeqStep(){
  if(state.seqIdx>=SEQ.length){ finishSequence(); return; }
  const s=SEQ[state.seqIdx];
  document.getElementById('seqStep').textContent = s.tap || s.msg;
  document.getElementById('seqSub').textContent = '';
  renderSeqList();
  const btn=document.getElementById('seqBtn');
  if(s.tap){ btn.classList.remove('hidden'); }
  else { btn.classList.add('hidden'); clearTimeout(state.seqTimer); state.seqTimer=setTimeout(()=>{ state.seqIdx++; runSeqStep(); }, s.auto); }
}
function seqAction(){ const s=SEQ[state.seqIdx]; if(!s || !s.tap) return;
  if(s.flag==='belt'){ car.belt=true; window.SFX&&window.SFX.play('belt'); }
  if(s.flag==='engine'){ car.engineRunning=true; window.SFX&&window.SFX.play('engine_start'); }
  if(s.flag==='gear' && car.mode==='manual'){ car.gear=1; car.clutch=1; }
  if(s.flag==='blinker') window.SFX&&window.SFX.play('blinker');
  document.getElementById('seqSub').textContent = s.done || '';
  document.getElementById('seqBtn').classList.add('hidden');
  state.seqIdx++; clearTimeout(state.seqTimer); state.seqTimer=setTimeout(runSeqStep, 420); }
function renderSeqList(){ const items=SEQ.map((s,i)=>({s,i})).filter(o=>o.s.tap);
  document.getElementById('seqList').innerHTML = items.map(o=>{
    const cls=o.i<state.seqIdx?'done':(o.i===state.seqIdx?'cur':'');
    return `<span class="it ${cls}">${o.s.short}</span>`; }).join(''); }
function finishSequence(){ window.SAVE&&window.SAVE.applyRestore(); document.getElementById('seq').classList.add('hidden');
  car.engineRunning=true; window.SFX&&window.SFX.play('engine_start'); state.phase='play'; state.lastT=performance.now(); window.applyHanded&&window.applyHanded();
  window.ONBOARDING&&window.ONBOARDING.enterPlay();
  try{ var _a=document.getElementById('actions'); if(_a) _a.style.display=''; }catch(e){}
  if(car.mode==='manual'){ car.gear=1;
    toast('🔧 Механіка: тримай 🖐 Зчеплення, дай Газ — і плавно відпусти зчеплення. Інакше заглухне!'); }
  else toast('🚗 Поїхали! Ремінь пристебнуто, двигун працює.'); }
document.getElementById('startBtn').addEventListener('click', startSequence);
document.getElementById('seqBtn').addEventListener('click', seqAction);
addEventListener('resize',()=>map.invalidateSize()); setTimeout(()=>map.invalidateSize(),300);


// ================= 📻 ОБОЛОНЬ FM + 🌗 КИЇВСЬКИЙ ЧАС (v0.5) =================
// ================= 📻 ОБОЛОНЬ FM (v0.5) =================
// Постійна районна радіостанція (на відміну від локального радіо біля Сенсу/храмів).
// Контент: data/radio.json; якщо fetch не вдався — працює на вбудованому фолбеці нижче.
// Бачить глобали гри (car, phase, fuel, money, toast, speakLines, ac, bell, updateHUD,
// radio/startRadio/stopRadio, window.LIVE) — нічого з цього тут не переоголошується.
// Контракт: window.FM = { on, init:fmInit, toggle:fmToggle, event:fmEvent, step:fmStep,
//           duck:fmDuck, unduck:fmUnduck }. Ті самі функції доступні і як bare-виклики
//           (fmInit(), fmToggle(), fmEvent(type), fmStep(dt)) — це звичайні top-level
//           function-декларації, просто ще й зібрані в об'єкт window.FM нижче.

const FM_STORAGE_KEY   = 'fmOn';
const FM_GAP_MIN        = 16;   // c, мінімальний інтервал між сегментами ефіру
const FM_GAP_MAX        = 26;   // c, максимальний інтервал
const FM_JINGLE_EVERY   = 4;    // кожен ~4-й сегмент — джингл замість рубрики/idle
const FM_IDLE_CHANCE    = 0.22; // шанс idle-репліки діджея замість тематичної рубрики
const FM_EVENT_COOLDOWN = 12;   // c, per-type кулдаун для fmEvent(type)

// Мінімальний вбудований контент — на випадок, якщо data/radio.json не завантажився.
const FM_FALLBACK = {
  station: { name:'Оболонь FM', freq:'101.3 FM', tag:'хвиля твого району' },
  jingles: [
    ['Оболонь FM — сто один і три десятих.'],
    ['Ти на хвилі свого району. Оболонь FM.'],
    ['Оболонь FM: їдь тихо, слухай гучно.']
  ],
  rubrics: [
    { id:'street', title:'Вулична хвиля', when:'any', lines:[
      'На проспекті Івасюка сьогодні спокійно — три смуги амбіцій дихають рівно.',
      'Хтось щойно акуратно перешикувався на Мінській. Поважаємо.',
      'Двори — не траса. Повільно й ніжно, як каже кожен добрий котик.'
    ]},
    { id:'night', title:'Нічний ефір', when:'night', lines:[
      'Панельки засвітили вікна. Оболонь готується спати, а ти ще в дорозі.',
      'Фари увімкнено? Нічна Оболонь любить уважних водіїв.'
    ]},
    { id:'rain', title:'Дощова хвиля', when:'rain', lines:[
      'Двірники ганяють краплі, а ми ганяємо думки. Обережно на мокрому.',
      'Дощ над Дніпром. Гальмівний шлях довший — тримай дистанцію.'
    ]}
  ],
  dj: {
    welcome:     ['Вітаємо на хвилі Оболонь FM! Пристебнись і поїхали.'],
    idle:        ['Оболонь FM з тобою, поки ти в дорозі.', 'Тримаємо хвилю разом із тобою.'],
    goodDriving: ['Гарно ведеш. Район це цінує.'],
    stall:       ['Двигун образився, буває. Заведи знову і забудь.'],
    refuel:      ['Бак повний — можна їхати хоч на набережну.'],
    church:      ['Дзвони почуто. Гарної дороги зі спокійним серцем.'],
    job:         ['Ще одна доставка позаду. Оболонь дякує.'],
    lowFuel:     ['Пальне на нулі. До найближчої АЗС — не зволікай.'],
    night:       ['Місто вмикає вечірні вогні.'],
    rain:        ['Дощ над районом. Їдь м’якше.']
  }
};

// ---- внутрішній стан модуля (усі імена з префіксом fm, щоб не перетнутись з рештою гри) ----
let fmData          = null;   // { station, jingles, rubrics, dj } — з radio.json або фолбек
let fmAcc           = 0;      // акумулятор часу до наступного сегмента (c)
let fmNextGap       = 20;     // ціль накопичення для поточного циклу (c), рандомиться нижче
let fmSegCount      = 0;      // лічильник зіграних сегментів (для "кожен ~4-й — джингл")
let fmDucked        = false;  // тимчасове примусове мовчання (fmDuck/fmUnduck)
let fmWasSuppressed = false;  // чи вже скасували поточну репліку через придушення (щоб не робити це щокадру)
const fmLastEventAt = Object.create(null); // per-type мітки часу для кулдауну fmEvent

// window.FM визначаємо ОДРАЗУ (а не в кінці файлу): усі функції нижче — звичайні top-level
// function-декларації, які хостяться повністю, тож посилання на них тут коректні незалежно
// від порядку виконання; так FM.on гарантовано існує ще до першого можливого виклику fmInit/fmStep.
window.FM = { on:false, init:fmInit, toggle:fmToggle, event:fmEvent, step:fmStep, duck:fmDuck, unduck:fmUnduck };
const FM = window.FM; // локальний alias — усі функції нижче звертаються саме до цього об'єкта

function fmRand(min, max){ return min + Math.random() * (max - min); }

// ---- дані ----
function fmNormalizeData(j){
  try{
    if(!j || typeof j !== 'object') return FM_FALLBACK;
    return {
      station: (j.station && typeof j.station === 'object') ? j.station : FM_FALLBACK.station,
      jingles: (Array.isArray(j.jingles) && j.jingles.length) ? j.jingles : FM_FALLBACK.jingles,
      rubrics: (Array.isArray(j.rubrics) && j.rubrics.length) ? j.rubrics : FM_FALLBACK.rubrics,
      dj: Object.assign({}, FM_FALLBACK.dj, (j.dj && typeof j.dj === 'object') ? j.dj : {})
    };
  }catch(_){ return FM_FALLBACK; }
}
function fmEnsureData(){ if(!fmData) fmData = FM_FALLBACK; }
function fmLoadData(){
  try{
    fetch('data/radio.json').then(function(r){
      if(!r || !r.ok) throw new Error('radio.json: bad response');
      return r.json();
    }).then(function(j){
      fmData = fmNormalizeData(j);
    }).catch(function(){
      if(!fmData) fmData = FM_FALLBACK; // fetch/parse не вдався — лишаємось на фолбеку
    });
  }catch(_){ if(!fmData) fmData = FM_FALLBACK; }
}

function fmNormLines(x){
  if(Array.isArray(x)) return x.filter(function(v){ return typeof v === 'string' && v.length; });
  if(typeof x === 'string' && x.length) return [x];
  return [];
}
// dj[type] може бути рядком або масивом реплік (тоді обираємо випадкову) — підтримуємо обидва.
function fmDjLines(type){
  try{
    fmEnsureData();
    const v = fmData.dj && fmData.dj[type];
    if(!v) return null;
    if(typeof v === 'string') return fmNormLines(v);
    if(Array.isArray(v) && v.length){
      const pick = v[Math.floor(Math.random() * v.length)];
      const lines = fmNormLines(pick);
      return lines.length ? lines : fmNormLines(v);
    }
    return null;
  }catch(_){ return null; }
}

// Контекстно зважений вибір рубрики: LIVE.isNight підвищує вагу when:'night',
// LIVE.precip!=='none' — when:'rain'; інакше домінують 'any'/'day'. Не виключаємо
// нічну/дощову повністю поза контекстом — просто рідше випадають ("віддавай перевагу").
function fmPickRubric(){
  try{
    fmEnsureData();
    const rubrics = (fmData.rubrics || []).filter(function(r){ return r && Array.isArray(r.lines) && r.lines.length; });
    if(!rubrics.length) return null;
    let isNight = false, isRain = false;
    try{
      if(window.LIVE){
        isNight = !!window.LIVE.isNight;
        isRain  = !!(window.LIVE.precip && window.LIVE.precip !== 'none');
      }
    }catch(_){}
    const weighted = [];
    rubrics.forEach(function(r){
      const when = r.when || 'any';
      let w = 2; // базова вага для 'any'
      if(when === 'night')      w = isNight ? 6 : 1;
      else if(when === 'rain')  w = isRain ? 6 : 1;
      else if(when === 'day')   w = isNight ? 1 : 3;
      for(let i = 0; i < w; i++) weighted.push(r);
    });
    return weighted[Math.floor(Math.random() * weighted.length)] || null;
  }catch(_){ return null; }
}

// ---- мовлення ----
function fmActiveNow(){
  try{
    if(!FM.on) return false;
    if(fmDucked) return false;
    if(typeof state.phase !== 'undefined' && state.phase !== 'play') return false;
    if(typeof radio !== 'undefined' && radio && radio.on) return false;
    return true;
  }catch(_){ return false; }
}
function fmStopSpeaking(){
  try{ if(typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }catch(_){}
}
function fmSpeak(lines){
  try{
    if(!fmActiveNow() || !lines || !lines.length) return false;
    const ok = speakLines(lines);
    if(!ok) toast('📻 ' + lines[0]); // немає укр. TTS-голосу — хоч тост, станція не мовчить у пустоту
    return ok;
  }catch(_){ return false; }
}
function fmBell(){
  try{
    if(typeof bell !== 'function' || typeof ac !== 'function') return;
    const t = ac().currentTime + 0.05;
    [740, 988, 1245].forEach(function(f, i){ bell(f, t + i * 0.16, 0.42, 0.16); });
  }catch(_){}
}
function fmPlayJingle(){
  try{
    fmBell();
    setTimeout(function(){
      try{
        if(!fmActiveNow()) return;
        fmEnsureData();
        const jingles = Array.isArray(fmData.jingles)
          ? fmData.jingles.map(fmNormLines).filter(function(a){ return a.length; })
          : [];
        if(jingles.length){ fmSpeak(jingles[Math.floor(Math.random() * jingles.length)]); }
        else if(fmData.station && fmData.station.name){ fmSpeak([fmData.station.name + '.']); }
      }catch(_){}
    }, 550);
  }catch(_){}
}
function fmPlayNext(){
  try{
    if(!fmActiveNow()) return;
    fmEnsureData();
    fmSegCount++;
    if(fmSegCount % FM_JINGLE_EVERY === 0){ fmPlayJingle(); return; }
    if(Math.random() < FM_IDLE_CHANCE){
      const idle = fmDjLines('idle');
      if(idle && idle.length){ fmSpeak(idle); return; }
    }
    const r = fmPickRubric();
    if(r && r.lines && r.lines.length){
      fmSpeak([r.lines[Math.floor(Math.random() * r.lines.length)]]);
    } else {
      const idle = fmDjLines('idle');
      if(idle && idle.length) fmSpeak(idle);
    }
  }catch(_){}
}

// ---- UI (#fmBtn) ----
function fmRenderBtn(){
  try{
    const b = document.getElementById('fmBtn');
    if(!b) return;
    b.classList.toggle('on', !!FM.on);
    b.innerHTML = FM.on ? '📻<small>FM ▶</small>' : '📻<small>FM</small>';
  }catch(_){}
}
function fmBindBtn(){
  try{
    const b = document.getElementById('fmBtn');
    if(b && !b.dataset.fmBound){
      b.dataset.fmBound = '1';
      b.addEventListener('click', fmToggle);
    }
  }catch(_){}
}

// ================= КОНТРАКТ (bare + window.FM) =================
function fmInit(){
  try{
    let pref = null;
    try{ pref = localStorage.getItem(FM_STORAGE_KEY); }catch(_){}
    FM.on = (pref === '1'); // лише позначаємо преференцію; TTS без жесту гравця не стартує
    fmAcc = 0; fmNextGap = fmRand(FM_GAP_MIN, FM_GAP_MAX); fmSegCount = 0; fmWasSuppressed = false;
    fmLoadData();
    fmBindBtn();
    fmRenderBtn();
  }catch(_){}
}
function fmToggle(){
  try{
    FM.on = !FM.on;
    try{ localStorage.setItem(FM_STORAGE_KEY, FM.on ? '1' : '0'); }catch(_){}
    fmRenderBtn();
    if(FM.on){
      toast('📻 Оболонь FM — хвиля твого району');
      fmAcc = 0; fmNextGap = fmRand(FM_GAP_MIN, FM_GAP_MAX);
      fmEvent('welcome'); // спрацює одразу, лише якщо вже в грі (phase==='play') і не грає локальне радіо
      window.PROGRESSION&&window.PROGRESSION.event('fm_on');
    } else {
      toast('Оболонь FM вимкнено');
      fmStopSpeaking();
    }
  }catch(_){}
}
function fmEvent(type){
  try{
    if(!fmActiveNow()) return;
    fmEnsureData();
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const last = fmLastEventAt[type] || 0;
    if(now - last < FM_EVENT_COOLDOWN * 1000) return;
    const lines = fmDjLines(type);
    if(!lines || !lines.length) return;
    fmLastEventAt[type] = now;
    fmSpeak(lines);
  }catch(_){}
}
function fmStep(dt){
  try{
    if(!FM.on) return;
    if(typeof state.phase !== 'undefined' && state.phase !== 'play') return;
    const suppressed = fmDucked || (typeof radio !== 'undefined' && radio && radio.on);
    if(suppressed){
      if(!fmWasSuppressed){ fmWasSuppressed = true; fmStopSpeaking(); } // скасувати ОДИН раз на межі, не щокадру
      return;
    }
    fmWasSuppressed = false;
    fmEnsureData();
    fmAcc += (typeof dt === 'number' && dt > 0) ? dt : 0;
    if(fmAcc >= fmNextGap){
      fmAcc = 0;
      fmNextGap = fmRand(FM_GAP_MIN, FM_GAP_MAX);
      fmPlayNext();
    }
  }catch(_){}
}
function fmDuck(){
  try{ fmDucked = true; fmStopSpeaking(); }catch(_){}
}
function fmUnduck(){
  try{ fmDucked = false; }catch(_){}
}


fmInit(); window.liveInit&&window.liveInit(); window.SAVE&&window.SAVE.load(); window.TRACES&&window.TRACES.init(); window.SETTINGS&&window.SETTINGS.init(); window.POLICE&&window.POLICE.init(); window.LIGHTS&&window.LIGHTS.init(); window.SPEED&&window.SPEED.init(); window.PEDS&&window.PEDS.init(); window.SIGNS&&window.SIGNS.init(); window.AUDIO&&window.AUDIO.init(); window.SFX&&window.SFX.init(); window.PROGRESSION&&window.PROGRESSION.init(); window.PASSENGERS&&window.PASSENGERS.init(); window.FMQUESTS&&window.FMQUESTS.init(); window.ONBOARDING&&window.ONBOARDING.init();

// ================= ЗАВАНТАЖЕННЯ ДАНИХ =================
// N2: roads і pois завантажуються незалежно (allSettled) — падіння одного не
// відкидає інший; кожен fetch перевіряє r.ok; якщо дороги не завантажились
// (або сегментів 0), гра лишається керованою — вимикаємо roadsOnly і попереджаємо.
Promise.allSettled([
  fetch('data/roads.json').then(r=>{ if(!r.ok) throw new Error('roads http '+r.status); return r.json(); }),
  fetch('data/pois.json').then(r=>{ if(!r.ok) throw new Error('pois http '+r.status); return r.json(); })
]).then(([roadsRes, poisRes])=>{
  try{
    var notes=[];
    if(roadsRes.status==='fulfilled'){
      try{ buildRoads(roadsRes.value.roads); }catch(e){ notes.push('Помилка обробки доріг'); }
    } else { notes.push('Дороги не завантажились'); }
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
