// ================= КОНФІГ =================
const CFG = {
  zoom: 19, center: [50.5085, 30.5030],
  tank: 50, startFuel: 5, startMoney: 900,
  consCity: 12.0,           // л/100км (місто, ігровий темп)
  idleLh: 1.1,              // л/год на холостому
  maxSpeed: 58, accel: 22, brake: 60, friction: 10, turn: 2.7, cruise: 42,
  jobBase: 40, jobPerKm: 20,
  churchBonus: 50, churchCooldownSec: 90,
  arrive: 22,              // м — радіус «прибуття»
  laneW: 3.0,              // ширина смуги, м
  radioR: 85,              // радіус дії радіо біля POI, м (храми стоять у глибині кварталів)
  holdMs: 240,             // тап (зміна смуги) vs утримання (кермо)
};
const BRAND_PRICE = { WOG:78.9, ОККО:78.9, SOCAR:77.9, KLO:72.9, "КЛО":72.9,
  "Народна":71.0, Parallel:73.0 };
const LPG_PRICE = 40.0;

// ===== КПП (реалістична модель, спец) =====
const GEARS_M = { '-1':-13.53, '0':0, '1':14.15, '2':7.95, '3':5.54, '4':4.22, '5':3.36 };
const ENG = { idle:800, redline:6000, fuelcut:6500, stall:450, stallGrace:0.35,
  revUp:9, revDown:6, mass:1200, KFAC:8.77, forceK:300, dragA:0.32, roll:60, brakeN:6500 };
function torqueCurve(rpm){ const p=[[800,0.5],[2000,0.78],[3500,1.0],[4500,0.97],[6000,0.6],[6500,0]];
  if(rpm<=p[0][0]) return p[0][1];
  for(let i=0;i<p.length-1;i++){ if(rpm<=p[i+1][0]){ const [x0,y0]=p[i],[x1,y1]=p[i+1];
    return y0+(y1-y0)*(rpm-x0)/(x1-x0); } } return 0; }
function updateDrivetrain(dt){
  const running = car.engineRunning && fuel>0;
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
  if(car.engineRunning && engaged>0 && car.gear!==0 && fuel>0)
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
const LANDMARKS = [
  { name:"Метро «Оболонь»", lat:50.50130, lng:30.49830 },
  { name:"Метро «Мінська»", lat:50.51220, lng:30.49850 },
  { name:"Метро «Героїв Дніпра»", lat:50.52230, lng:30.49900 },
  { name:"ТРЦ Dream Town", lat:50.52360, lng:30.49720 },
  { name:"Парк «Наталка»", lat:50.51880, lng:30.51920 },
  { name:"Оболонська набережна", lat:50.51150, lng:30.51600 },
  { name:"Озеро Опечень", lat:50.51400, lng:30.50650 },
  { name:"Оболонський проспект", lat:50.50650, lng:30.49950 },
];

// ================= КАРТА =================
// N4: Leaflet міг не завантажитись (CDN впав) — без цього гравець просто
// зависає на «Завантаження…» без пояснення.
if(typeof L==='undefined'){
  try{ var _ln=document.getElementById('loadNote'); if(_ln) _ln.textContent='Не вдалось завантажити карту (перевір інтернет).'; }catch(e){}
  throw new Error('no leaflet');
}
const canvasR = L.canvas({ padding: 0.4 });
const map = L.map('map', { center: CFG.center, zoom: CFG.zoom, zoomControl:false, attributionControl:false,
  dragging:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false,
  touchZoom:false, inertia:false, zoomSnap:0, renderer: canvasR });
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  { maxZoom: CFG.zoom, maxNativeZoom: 19, subdomains:'abcd' }).addTo(map);

// ================= ГЕО-ХЕЛПЕРИ (equirectangular XY) =================
const ORG = { lat: CFG.center[0], lng: CFG.center[1] };
const MLAT = 111320, MLNG = 111320 * Math.cos(ORG.lat*Math.PI/180);
const toXY = (lat,lng) => ({ x:(lng-ORG.lng)*MLNG, y:(lat-ORG.lat)*MLAT });
const fromXY = (x,y) => ({ lat:ORG.lat+y/MLAT, lng:ORG.lng+x/MLNG });

// ================= СТАН =================
const carEl = document.getElementById('car');
let phase='menu', roadsOnly=true;
let car={ x:0, y:0, heading:0, speed:0 };
let fuel=CFG.startFuel, money=CFG.startMoney, fuelType='A95';
let churchCd=0, blessing=0;
let job=null; // {from,to,stage:'pickup'|'deliver',fromMk,toMk,dist}
let jobMarker=null;
const input={ left:false, right:false, gas:false, brake:false, clutch:false };
let selectedMode='auto';
let handedMode='two', steerTarget=0, steerActive=false, steerStartX=0, cruiseSet=40;
let curLanes=1;
let lastRoadHit=null; // кеш результату nearestRoad() цього кадру (дедуп — SPEED читає це замість повторного виклику)
function laneChange(dir){ // -1 = лівіше (до осі), +1 = правіше (до узбіччя)
  if(!roadsOnly || curLanes<2) return;
  const old=car.lane;
  car.lane=Math.max(0,Math.min(curLanes-1, car.lane+dir));
  if(car.lane!==old){ window.SFX&&window.SFX.play('blinker'); toast(`Смуга ${car.lane+1} із ${curLanes}`); }
}
let segments=[], grid=new Map(), GRID=60;
let fuelMarks=[], churchMarks=[], stations=[];
let lastT=0;

// ================= ДОРОГИ (сегменти + сітка) =================
function buildRoads(roads){
  const markings=[];
  roads.forEach(line=>{ const g=line.g;
    const lanes=line.l||1, oneway=line.o||0, cls=line.h||'service';
    const ptsXY=g.map(p=>toXY(p[0],p[1]));
    for(let i=0;i<g.length-1;i++){
      const A=ptsXY[i], B=ptsXY[i+1];
      const dx=B.x-A.x, dy=B.y-A.y, len2=dx*dx+dy*dy;
      if(len2<0.5) continue;
      const s={ ax:A.x,ay:A.y,dx,dy,len2, name:line.n||'', l:lanes, o:oneway, svc: cls==='service'?1:0 };
      const idx=segments.push(s)-1;
      const x0=Math.min(A.x,B.x), x1=Math.max(A.x,B.x), y0=Math.min(A.y,B.y), y1=Math.max(A.y,B.y);
      for(let cx=Math.floor(x0/GRID);cx<=Math.floor(x1/GRID);cx++)
        for(let cy=Math.floor(y0/GRID);cy<=Math.floor(y1/GRID);cy++){
          const k=cx+','+cy; if(!grid.has(k)) grid.set(k,[]); grid.get(k).push(idx);
        }
    }
    // розмітка — лише на класифікованих дорогах (у дворах її нема)
    if(cls!=='service' && cls!=='living_street' && ptsXY.length>1){
      markings.push({pts:ptsXY, lanes, oneway});
    }
  });
  drawMarkings(markings);
}

// зміщення полілінії на d метрів праворуч від напряму (усереднені нормалі)
function offsetLine(pts, d){
  const out=[];
  for(let i=0;i<pts.length;i++){
    const p0=pts[Math.max(0,i-1)], p1=pts[Math.min(pts.length-1,i+1)];
    let nx=p1.y-p0.y, ny=-(p1.x-p0.x);
    const L=Math.hypot(nx,ny)||1; nx/=L; ny/=L;
    out.push(fromXY(pts[i].x+nx*d, pts[i].y+ny*d));
  }
  return out.map(p=>[p.lat,p.lng]);
}
function drawMarkings(ways){
  const layer=L.layerGroup();
  const W=CFG.laneW;
  ways.forEach(w=>{
    const latlngs=w.pts.map(p=>{ const q=fromXY(p.x,p.y); return [q.lat,q.lng]; });
    if(w.oneway){
      // односмугова стрічка: роздільники між смугами, по центру ширини
      for(let k=1;k<w.lanes;k++){
        const off=(k - w.lanes/2)*W;
        L.polyline(offsetLine(w.pts,off), {color:'#fff', weight:1.3, opacity:.85, dashArray:'7,11', interactive:false}).addTo(layer);
      }
    } else {
      // осьова: суцільна (широкі) або переривчаста (вузькі)
      if(w.lanes>=2)
        L.polyline(latlngs, {color:'#fff', weight:2.2, opacity:.95, interactive:false}).addTo(layer);
      else
        L.polyline(latlngs, {color:'#fff', weight:1.4, opacity:.8, dashArray:'9,13', interactive:false}).addTo(layer);
      // роздільники смуг у кожному напрямку
      for(let k=1;k<w.lanes;k++){
        for(const sgn of [1,-1]){
          L.polyline(offsetLine(w.pts, sgn*k*W), {color:'#fff', weight:1.2, opacity:.75, dashArray:'7,11', interactive:false}).addTo(layer);
        }
      }
    }
  });
  layer.addTo(map);
}
function nearestRoad(x,y,stickyName){
  // score = відстань + штраф двору − бонус «тієї самої вулиці»:
  // великі дороги не втрачаються через паралельні проїзди, але у двір заїхати можна.
  const cx=Math.floor(x/GRID), cy=Math.floor(y/GRID);
  let best=null, bs=Infinity;
  for(let R=1; R<=6; R++){
    for(let i=-R;i<=R;i++) for(let j=-R;j<=R;j++){
      const arr=grid.get((cx+i)+','+(cy+j)); if(!arr) continue;
      for(const idx of arr){ const s=segments[idx];
        let t=((x-s.ax)*s.dx+(y-s.ay)*s.dy)/s.len2; t=Math.max(0,Math.min(1,t));
        const px=s.ax+t*s.dx, py=s.ay+t*s.dy;
        const d=Math.sqrt((x-px)*(x-px)+(y-py)*(y-py));
        let score=d + (s.svc?9:0);
        if(stickyName && s.name && s.name===stickyName) score-=7;
        if(score<bs){ bs=score; best={px,py,dist:d,ang:Math.atan2(s.dx,s.dy),name:s.name,l:s.l||1,o:s.o||0,svc:s.svc||0}; }
      }}
    if(best) break;
  }
  return best;
}

// ================= POI =================
function poiIcon(cls,emoji){ return L.divIcon({ className:'', iconSize:[30,30], iconAnchor:[15,30],
  html:`<div class="poi ${cls}"><span>${emoji}</span></div>` }); }
let sensPoi=null;
function addPOIs(pois){
  pois.fuel.forEach(f=>{ const price=BRAND_PRICE[f.name]||74.0;
    stations.push({...f, a95:price, lpg:LPG_PRICE});
    fuelMarks.push(L.marker([f.lat,f.lng],{icon:poiIcon('fuel','⛽')}).addTo(map)); });
  pois.churches.forEach(c=>{
    // персональний радіус: храм може стояти в глибині кварталу — рахуємо від найближчої дороги
    const xy=toXY(c.lat,c.lng); const nr=nearestRoad(xy.x,xy.y);
    const r=Math.max(CFG.radioR, (nr?nr.dist:0)+30);
    churchMarks.push({...c, r,
    mk:L.marker([c.lat,c.lng],{icon:poiIcon('church','⛪')}).addTo(map)}); });
  if(pois.sens){ sensPoi=pois.sens;
    L.marker([sensPoi.lat,sensPoi.lng],{icon:poiIcon('sens','📚')}).addTo(map); }
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
let radio={on:false,type:null,audio:null};
// ID відео з ОФІЦІЙНОГО каналу Стерненка для радіо «Сенс» (офіційний YouTube-embed:
// звук стрімиться з його каналу, нічого не копіюється). Заповнюється власником гри.
const SENS_YT=[];
function openYt(){ const ids=SENS_YT.filter(Boolean); if(!ids.length) return false;
  const id=ids[Math.floor(Math.random()*ids.length)];
  document.getElementById('ytFrame').src='https://www.youtube-nocookie.com/embed/'+encodeURIComponent(id)+'?autoplay=1&playsinline=1';
  document.getElementById('ytBox').classList.remove('hidden'); return true; }
function closeYt(){ document.getElementById('ytFrame').src=''; document.getElementById('ytBox').classList.add('hidden'); }
document.getElementById('ytClose').addEventListener('click',()=>stopRadio());
let AC=null;
function ac(){ if(!AC){ const C=window.AudioContext||window.webkitAudioContext; AC=new C(); } if(AC.state==='suspended') AC.resume(); return AC; }
function bell(freq,t0,dur,vol){ if(window.MUTED) return; const a=ac(); const o=a.createOscillator(), g=a.createGain();
  o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(a.destination);
  g.gain.setValueAtTime(vol,t0); g.gain.exponentialRampToValueAtTime(0.001,t0+dur);
  o.start(t0); o.stop(t0+dur); }
function churchBells(){ const t=ac().currentTime+0.05; [523,392,330,392,523].forEach((f,i)=>bell(f,t+i*0.9,2.4,0.22)); }
function sensJingle(){ const t=ac().currentTime+0.05; [660,880,990].forEach((f,i)=>bell(f,t+i*0.18,0.5,0.18)); }
function speakLines(lines){ if(window.MUTED) return true;
  if(!('speechSynthesis' in window)) return false;
  const vs=speechSynthesis.getVoices(); const uk=vs.find(v=>/^uk/i.test(v.lang));
  if(!uk) return false;
  speechSynthesis.cancel();
  lines.forEach(tx=>{ const u=new SpeechSynthesisUtterance(tx); u.voice=uk; u.lang=uk.lang; u.rate=1.0; speechSynthesis.speak(u); });
  return true;
}
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
function stopRadio(){
  closeYt();
  if(radio.audio){ try{radio.audio.pause();}catch(_){ } radio.audio=null; }
  try{ window.speechSynthesis && speechSynthesis.cancel(); }catch(_){ }
  radio.on=false; radio.type=null;
  const b=document.getElementById('radioBtn'); b.classList.remove('on'); b.textContent='📻 Радіо';
}
let radioNearType=null;
function updateRadio(lat,lng){
  let t=null;
  if(sensPoi && dist(lat,lng,sensPoi.lat,sensPoi.lng)<CFG.radioR) t='sens';
  if(!t){ for(const c of churchMarks){ if(dist(lat,lng,c.lat,c.lng)<(c.r||CFG.radioR)){ t='church'; break; } } }
  radioNearType=t;
  if(radio.on && !t) stopRadio();               // від'їхав — радіо згасає
  const b=document.getElementById('radioBtn');
  b.style.display = (t||radio.on) ? 'block' : 'none';
}
document.getElementById('radioBtn').addEventListener('click',()=>{
  if(radio.on) stopRadio(); else if(radioNearType) startRadio(radioNearType);
});
if('speechSynthesis' in window){ speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged=()=>speechSynthesis.getVoices(); }

// ================= МУЛЬТИПЛЕЄР (публічний MQTT-брокер) =================
// Канал публічний (best-effort): передаються лише нік і позиція котика в грі.
const MP_BROKERS=['wss://broker.emqx.io:8084/mqtt','wss://broker.hivemq.com:8884/mqtt'];
let mpEnabled=false;
const mp={on:false,client:null,id:'k'+Math.random().toString(36).slice(2,9),
          nick:'Котик',room:'obolon',ghosts:new Map(),pubT:null,pruneT:null,brokerIdx:0,base:''};
function hueOf(id){ let h=0; for(const ch of id) h=(h*31+ch.charCodeAt(0))%360; return h; }
function esc(s){ return String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c])); }
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
  mp.pubT=setInterval(()=>{ if(mp.on && phase==='play' && mp.client && mp.client.connected){
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
function mpStop(){ if(mp.client){ try{ mp.client.publish(mp.base+'/leave',JSON.stringify({id:mp.id})); mp.client.end(true); }catch(_){ } }
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
  mpEnabled=!mpEnabled;
  const b=document.getElementById('mpToggle');
  b.textContent='👥 Грати разом: '+(mpEnabled?'увімк':'вимк');
  b.classList.toggle('on',mpEnabled);
});
try{ document.getElementById('mpNick').value=localStorage.getItem('mpNick')||'';
     document.getElementById('mpRoom').value=localStorage.getItem('mpRoom')||'obolon'; }catch(_){ }

// ================= ЕКОНОМІКА / ПАЛИВО =================
function rangeKm(){ return (fuel / CFG.consCity) * 100; }
function useFuel(distM){
  let rate=CFG.consCity;
  if(fuelType==='LPG') rate*=1.12;        // газ: дешевший, але витрата вища (+12%)
  if(blessing>0) rate*=0.85;
  fuel=Math.max(0, fuel - (rate/100)*(distM/1000));
}
function dist(aLat,aLng,bLat,bLng){ return map.distance([aLat,aLng],[bLat,bLng]); }

// ================= ЗАВДАННЯ =================
function newJob(){
  if(job){ toast('Спершу заверши поточне замовлення'); return; }
  let a=LANDMARKS[Math.floor(Math.random()*LANDMARKS.length)], b;
  do{ b=LANDMARKS[Math.floor(Math.random()*LANDMARKS.length)]; }while(b===a);
  const d=dist(a.lat,a.lng,b.lat,b.lng)/1000;
  job={ from:a, to:b, stage:'pickup', distKm:d, fare:Math.round(CFG.jobBase+CFG.jobPerKm*d) };
  document.getElementById('jobBtn').classList.add('on');
  setJobMarker(a);
  toast(`📦 Забери посилку: ${a.name}`);
}
function setJobMarker(pt){
  if(jobMarker) map.removeLayer(jobMarker);
  jobMarker=L.marker([pt.lat,pt.lng],{icon:poiIcon('job','📦')}).addTo(map);
}
function checkJob(lat,lng){
  if(!job) return;
  const tgt = job.stage==='pickup'? job.from : job.to;
  if(dist(lat,lng,tgt.lat,tgt.lng) < CFG.arrive){
    if(job.stage==='pickup'){ job.stage='deliver'; setJobMarker(job.to);
      toast(`Везіть до: ${job.to.name} (${job.fare} грн)`); }
    else{ money+=job.fare; window.SFX&&window.SFX.play('cash'); window.SAVE&&window.SAVE.addEarned(job.fare); toast(`✅ Доставлено! +${job.fare} грн`); fmEvent('job'); window.PROGRESSION&&window.PROGRESSION.event('delivery');
      if(jobMarker){ map.removeLayer(jobMarker); jobMarker=null; }
      job=null; document.getElementById('jobBtn').classList.remove('on'); }
  }
}

// ================= UI =================
let bannerT;
function toast(msg){ const b=document.getElementById('bannerMsg'); b.textContent=msg; b.classList.add('show');
  clearTimeout(bannerT); bannerT=setTimeout(()=>b.classList.remove('show'),3400); }
function updateHUD(){
  try{
    const moneyTxt=String(Math.round(money));
    if(hudCache.money!==moneyTxt){ hudCache.money=moneyTxt; document.getElementById('money').textContent=moneyTxt; }
    const speedTxt=String(Math.round(Math.abs(car.speed)));
    if(hudCache.speed!==speedTxt){ hudCache.speed=speedTxt; document.getElementById('speed').textContent=speedTxt; }
    const pct=Math.max(0,Math.min(1,fuel/CFG.tank));
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
let ctxAction=null;
function setCtxBtn(btn,txt,disp){
  if(hudCache.ctxTxt!==txt){ hudCache.ctxTxt=txt; btn.textContent=txt; }
  if(hudCache.ctxDisp!==disp){ hudCache.ctxDisp=disp; btn.style.display=disp; }
}
function updateCtx(lat,lng){
  const btn=document.getElementById('ctx');
  // заглухлий двигун (механіка) — завести
  if(car.mode==='manual' && !car.engineRunning && Math.abs(car.speed)<8){
    setCtxBtn(btn,'🔑 Завести двигун','block'); ctxAction=startEngine; return;
  }
  // АЗС
  let near=null;
  for(const s of stations){ if(dist(lat,lng,s.lat,s.lng)<CFG.arrive){ near={type:'fuel',s}; break; } }
  if(!near) for(const c of churchMarks){ if(dist(lat,lng,c.lat,c.lng)<CFG.arrive){ near={type:'church',c}; break; } }
  if(near && Math.abs(car.speed)<8){
    if(near.type==='fuel'){ setCtxBtn(btn,'⛽ Заправитись','block'); ctxAction=()=>openFuel(near.s); }
    else{ const ready=churchCd<=0; setCtxBtn(btn, ready?'⛪ Зайти до храму':'⛪ Вже сьогодні','block'); ctxAction=ready?visitChurch:null; }
  } else { setCtxBtn(btn,hudCache.ctxTxt||'','none'); ctxAction=null; }
}
function visitChurch(){ if(churchCd>0) return; money+=CFG.churchBonus; blessing=1; churchCd=CFG.churchCooldownSec; window.SFX&&window.SFX.play('cash');
  toast(`🙏 +${CFG.churchBonus} грн · Благословення дороги (−15% пального)`); fmEvent('church'); window.PROGRESSION&&window.PROGRESSION.event('church'); window.SAVE&&window.SAVE.save(); }

function openFuel(s){ phase='fuel';
  document.getElementById('fuelStation').textContent='АЗС '+s.name;
  document.getElementById('fuelNow').textContent=fuel.toFixed(1);
  document.getElementById('fuelMoney').textContent=Math.round(money);
  document.getElementById('priceA95').textContent=s.a95.toFixed(2)+' грн/л';
  document.getElementById('priceLPG').textContent=s.lpg.toFixed(2)+' грн/л';
  document.getElementById('fuelPanel').classList.remove('hidden');
  fuelPanel._s=s;
}
function doRefuel(kind){ const s=fuelPanel._s; const price = kind==='LPG'?s.lpg:s.a95;
  const need=CFG.tank-fuel;
  let liters, cost;
  if(kind==='500'){ liters=Math.min(500/s.a95, need); cost=liters*s.a95; }
  else { liters=need; cost=liters*price; }
  if(cost>money){ liters=money/price; cost=money; }
  money-=cost; fuel+=liters;
  if(kind==='LPG'){ fuelType='LPG'; } else { fuelType='A95'; }
  toast(`Залито ${liters.toFixed(1)} л ${kind==='LPG'?'газу':'А-95'} на ${Math.round(cost)} грн`);
  fmEvent('refuel'); window.SAVE&&window.SAVE.save();
  closeFuel();
}
function closeFuel(){ document.getElementById('fuelPanel').classList.add('hidden'); phase='play'; }
const fuelPanel=document.getElementById('fuelPanel');

// ================= ЦИКЛ =================
function tick(now){
  requestAnimationFrame(tick);
  if(phase!=='play'){ lastT=now; window.AUDIO&&window.AUDIO.step(0.016); return; }
  let dt=(now-lastT)/1000; lastT=now; if(dt<=0) return; if(dt>0.05) dt=0.05;
  step(dt); window.AUDIO&&window.AUDIO.step(dt);
}
function step(dt){
  if(handedMode==='one'){
    // кермуємо ◀▶, гальмуємо; авто саме розганяється до заданої макс. швидкості
    if(car.engineRunning && fuel>0 && !input.brake && Math.abs(car.speed)<cruiseSet) input.gas=true;
    else if(!input.brake) input.gas=false;
  }
  if(input.left)  car.heading-=CFG.turn*dt;
  if(input.right) car.heading+=CFG.turn*dt;
  // зчеплення (плавно) + трансмісія (авто/механіка)
  if(car.mode==='manual'){ const tgt=input.clutch?1:0; car.clutch+=(tgt-car.clutch)*(input.clutch?14:4)*dt; car.clutch=Math.max(0,Math.min(1,car.clutch)); }
  updateDrivetrain(dt);
  if(fuel<=0) toastLowFuelMaybe();

  const mps=car.speed/3.6, distM=mps*dt;
  car.x+=distM*Math.sin(car.heading); car.y+=distM*Math.cos(car.heading);
  window.SAVE&&window.SAVE.addKm(Math.abs(distM)/1000);
  window.PROGRESSION&&window.PROGRESSION.event('km', Math.abs(distM)/1000);

  // режим «лише по дорогах» — м'яко притягуємо до найближчої дороги + вирівнюємо курс
  if(roadsOnly){
    const r=nearestRoad(car.x,car.y, car.roadName);
    lastRoadHit=r||null;
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
      const steering=(input.left||input.right||Math.abs(steerTarget)>0.15);
      const align=steering?dt*1.5:dt*5;   // менше вирівнювання під час керма (щоб можна було повертати)
      car.heading+=diff*Math.min(1,align);
      curLanes=lanes;
      const nm = r.name || (r.svc ? 'двір · проїзд' : '—');
      streetName(nm + (lanes>1 && !r.svc ? ` · смуга ${car.lane+1}/${lanes}` : ''));
    }
  } else { curLanes=1; lastRoadHit=null; streetName('вільний режим'); }

  // паливо / бонуси / кулдауни
  if(Math.abs(car.speed)>0.5) useFuel(Math.abs(distM)); else if(car.engineRunning) fuel=Math.max(0,fuel-CFG.idleLh/3600*dt);
  if(churchCd>0) churchCd-=dt;
  if(blessing>0) blessing-=distM/1000/10; // тане за 10 км

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
let lowShown=false;
function toastLowFuelMaybe(){ if(!lowShown && fuel<=0){ lowShown=true; toast('⛽ Пусто! Дійди пішки або заправся.'); fmEvent('lowFuel'); } }
let curStreet='';
let hudCache={}; // кеш останніх записаних значень DOM у updateHUD/updateCtx — пишемо лише коли змінилось
function streetName(n){ if(n!==curStreet){ curStreet=n; document.getElementById('street').firstElementChild.textContent=n||'—'; } }
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
    if(roadsOnly && phase==='play' && curLanes>1){
      timer=setTimeout(()=>{ held=true; input[key]=true; }, CFG.holdMs);   // кермо після затримки
    } else { held=true; input[key]=true; }                                  // вільний режим — одразу кермо
  });
  const up=e=>{ e.preventDefault(); clearTimeout(timer);
    const wasTap=!held && (performance.now()-downAt)<CFG.holdMs;
    input[key]=false;
    if(wasTap && phase==='play') laneChange(dir); };
  b.addEventListener('pointerup',up); b.addEventListener('pointercancel',up);
}
bindSteer('left','left',-1); bindSteer('right','right',1);
const steerKeyState={};
function steerKeyDown(key,dir){
  if(steerKeyState[key]) return; steerKeyState[key]={at:performance.now(),held:false,timer:null};
  if(roadsOnly && phase==='play' && curLanes>1)
    steerKeyState[key].timer=setTimeout(()=>{ steerKeyState[key].held=true; input[key]=true; }, CFG.holdMs);
  else { steerKeyState[key].held=true; input[key]=true; }
}
function steerKeyUp(key,dir){
  const st=steerKeyState[key]; if(!st) return; clearTimeout(st.timer);
  const wasTap=!st.held && (performance.now()-st.at)<CFG.holdMs;
  input[key]=false; delete steerKeyState[key];
  if(wasTap && phase==='play') laneChange(dir);
}
// механіка: зчеплення (утримання) + передачі + вибір режиму
(function(){ const cb=document.getElementById('clutchBtn');
  cb.addEventListener('pointerdown',e=>{ e.preventDefault(); try{cb.setPointerCapture(e.pointerId);}catch(_){ } input.clutch=true; cb.classList.add('pressed'); });
  const off=e=>{ e.preventDefault(); input.clutch=false; cb.classList.remove('pressed'); };
  cb.addEventListener('pointerup',off); cb.addEventListener('pointercancel',off); })();
document.getElementById('gearUp').addEventListener('click',()=>shiftGear(1));
document.getElementById('gearDown').addEventListener('click',()=>shiftGear(-1));
const mA=document.getElementById('modeAuto'), mM=document.getElementById('modeManual');
mA.addEventListener('click',()=>{ selectedMode='auto'; mA.classList.add('on'); mM.classList.remove('on'); });
mM.addEventListener('click',()=>{ selectedMode='manual'; mM.classList.add('on'); mA.classList.remove('on'); });
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

document.getElementById('modeBtn').addEventListener('click',()=>{ roadsOnly=!roadsOnly;
  const b=document.getElementById('modeBtn'); b.classList.toggle('on',!roadsOnly);
  b.innerHTML = roadsOnly?'🛣️<small>ДОРОГИ</small>':'🗺️<small>БУДЬ-ДЕ</small>';
  toast(roadsOnly?'Режим: лише по дорогах':'Режим: їзда будь-де'); });
document.getElementById('jobBtn').addEventListener('click',newJob);
// ===== керування однією рукою (тягни-кермуй + автогаз) =====
(function(){ const z=document.getElementById('steerZone');
  z.addEventListener('pointerdown',e=>{ e.preventDefault(); steerActive=true; steerStartX=e.clientX; try{z.setPointerCapture(e.pointerId);}catch(_){ } });
  z.addEventListener('pointermove',e=>{ if(!steerActive) return; const dx=e.clientX-steerStartX; steerTarget=Math.max(-1,Math.min(1, dx/(window.innerWidth*0.22))); });
  const off=()=>{ steerActive=false; steerTarget=0; };
  z.addEventListener('pointerup',off); z.addEventListener('pointercancel',off); })();
function applyHanded(){ const one=handedMode==='one';
  document.getElementById('steerZone').classList.add('hidden');       // без перетягування
  document.getElementById('steerHint').classList.add('hidden');
  document.getElementById('left').style.display='';                   // стрілки лишаються — ними кермуємо
  document.getElementById('right').style.display='';
  document.getElementById('gas').style.display=one?'none':'';         // у 1 руку газ автоматичний — кнопки нема
  document.getElementById('spdBtn').classList.toggle('hidden', !one);
  document.getElementById('spdVal').textContent=cruiseSet;
  const hb=document.getElementById('handBtn'); hb.innerHTML=one?'🖐️<small>1 РУКА</small>':'✌️<small>2 РУКИ</small>'; hb.classList.toggle('on',one);
  if(one){ selectedMode='auto'; if(car&&'mode' in car) car.mode='auto';
    document.getElementById('modeAuto').classList.add('on'); document.getElementById('modeManual').classList.remove('on');
    document.getElementById('manualCtl').classList.add('hidden'); document.getElementById('gearChip').classList.add('hidden'); input.gas=false; }
}
window.applyHanded=applyHanded;
document.getElementById('handBtn').addEventListener('click',()=>{ handedMode=handedMode==='one'?'two':'one'; applyHanded(); });
document.getElementById('spdBtn').addEventListener('click',()=>{ const opts=[30,40,50,58];
  cruiseSet=opts[(opts.indexOf(cruiseSet)+1)%opts.length]; document.getElementById('spdVal').textContent=cruiseSet;
  toast('Макс. швидкість: '+cruiseSet+' км/год'); });
document.getElementById('ctx').addEventListener('click',()=>{ if(ctxAction) ctxAction(); });
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
let seqIdx=0, seqTimer=null;
function initGame(){ if(handedMode==='one') selectedMode='auto';
  car={x:0,y:0,heading:0,speed:0,engineRunning:false,belt:false,
  mode:selectedMode, gear:0, clutch:1, rpm:0, gearDisp:'N', stallT:0, lane:99};
  fuel=CFG.startFuel; money=CFG.startMoney; churchCd=0; blessing=0; job=null; lowShown=false;
  document.getElementById('manualCtl').classList.toggle('hidden', selectedMode!=='manual');
  document.getElementById('gearChip').classList.toggle('hidden', selectedMode!=='manual');
  document.getElementById('jobBtn').classList.remove('on'); updateHUD(); }
function startGame(){ initGame(); window.SAVE&&window.SAVE.applyRestore(); car.engineRunning=true; car.belt=true; window.SFX&&window.SFX.play('engine_start');   // швидкий старт (фолбек/тест)
  if(mpEnabled && !mp.on) mpStart();
  document.getElementById('startScreen').classList.add('hidden'); document.getElementById('seq').classList.add('hidden');
  phase='play'; lastT=performance.now(); window.applyHanded&&window.applyHanded();
  window.ONBOARDING&&window.ONBOARDING.enterPlay();
  try{ var _a=document.getElementById('actions'); if(_a) _a.style.display=''; }catch(e){} }
function startSequence(){ initGame();
  if(mpEnabled && !mp.on) mpStart();
  document.getElementById('startScreen').classList.add('hidden');
  const p=fromXY(0,0); map.setView([p.lat,p.lng],CFG.zoom,{animate:false});
  phase='sequence'; seqIdx=0; document.getElementById('seq').classList.remove('hidden'); runSeqStep();
  try{ var _a=document.getElementById('actions'); if(_a) _a.style.display='none'; }catch(e){} }
function runSeqStep(){
  if(seqIdx>=SEQ.length){ finishSequence(); return; }
  const s=SEQ[seqIdx];
  document.getElementById('seqStep').textContent = s.tap || s.msg;
  document.getElementById('seqSub').textContent = '';
  renderSeqList();
  const btn=document.getElementById('seqBtn');
  if(s.tap){ btn.classList.remove('hidden'); }
  else { btn.classList.add('hidden'); clearTimeout(seqTimer); seqTimer=setTimeout(()=>{ seqIdx++; runSeqStep(); }, s.auto); }
}
function seqAction(){ const s=SEQ[seqIdx]; if(!s || !s.tap) return;
  if(s.flag==='belt'){ car.belt=true; window.SFX&&window.SFX.play('belt'); }
  if(s.flag==='engine'){ car.engineRunning=true; window.SFX&&window.SFX.play('engine_start'); }
  if(s.flag==='gear' && car.mode==='manual'){ car.gear=1; car.clutch=1; }
  if(s.flag==='blinker') window.SFX&&window.SFX.play('blinker');
  document.getElementById('seqSub').textContent = s.done || '';
  document.getElementById('seqBtn').classList.add('hidden');
  seqIdx++; clearTimeout(seqTimer); seqTimer=setTimeout(runSeqStep, 420); }
function renderSeqList(){ const items=SEQ.map((s,i)=>({s,i})).filter(o=>o.s.tap);
  document.getElementById('seqList').innerHTML = items.map(o=>{
    const cls=o.i<seqIdx?'done':(o.i===seqIdx?'cur':'');
    return `<span class="it ${cls}">${o.s.short}</span>`; }).join(''); }
function finishSequence(){ window.SAVE&&window.SAVE.applyRestore(); document.getElementById('seq').classList.add('hidden');
  car.engineRunning=true; window.SFX&&window.SFX.play('engine_start'); phase='play'; lastT=performance.now(); window.applyHanded&&window.applyHanded();
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
    if(typeof phase !== 'undefined' && phase !== 'play') return false;
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
    if(typeof phase !== 'undefined' && phase !== 'play') return;
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


// ============================================================
// «Київський час» — живий модуль часу доби / світла / погоди
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий
// класичний <script>, що й основна гра — бачить її глобали
// (CFG, map, car, phase, fuel, money, toXY/fromXY, dist, nearestRoad,
// toast, ac, updateHUD) і нічого з них не перевизначає.
//
// Контракт:
//   window.LIVE       — стан (grip/isNight/phaseOfDay/precip/tempC/code/sunriseH/sunsetH)
//   window.liveInit() — одноразова ініціалізація (виклик один раз після завантаження гри)
//   window.liveStep(dt) — виклик щокадру із step(dt); нічого не рахує в фізиці,
//                          лише оновлює візуал і поля LIVE (гравець сам множить
//                          гальмування/зчеплення на LIVE.grip)
// ============================================================
(function(){
  'use strict';

  // ---------- координати Оболоні (ті самі, що CFG.center) ----------
  var OM_LAT = 50.5085, OM_LNG = 30.5030;
  var OM_URL = 'https://api.open-meteo.com/v1/forecast?latitude=' + OM_LAT +
    '&longitude=' + OM_LNG +
    '&current=temperature_2m,weather_code,is_day&daily=sunrise,sunset&timezone=Europe%2FKyiv';

  // ---------- офлайн-фолбек: помісячна таблиця схід/захід для Києва ----------
  // [схід_год.дес, захід_год.дес] — орієнтовні середні по місяцю, локальний час Києва.
  var SUN_FALLBACK = [
    [7.90, 16.60], // січень
    [7.30, 17.40], // лютий
    [6.30, 18.20], // березень
    [6.00, 20.00], // квітень
    [5.30, 20.70], // травень
    [4.90, 21.20], // червень
    [5.20, 21.10], // липень
    [5.90, 20.30], // серпень
    [6.60, 19.30], // вересень
    [7.30, 18.10], // жовтень
    [7.30, 16.60], // листопад
    [8.00, 16.10]  // грудень
  ];

  // ---------- кешовані форматери київського часу (не створювати щокадру) ----------
  var fmtHM = null, fmtMonth = null;
  try{ fmtHM = new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',hour12:false,hour:'2-digit',minute:'2-digit'}); }catch(e){ fmtHM=null; }
  try{ fmtMonth = new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',month:'numeric'}); }catch(e){ fmtMonth=null; }

  function kyivHM(){
    try{
      if(!fmtHM) throw new Error('no intl');
      var parts = fmtHM.formatToParts(new Date());
      var hh='--', mm='--';
      for(var i=0;i<parts.length;i++){
        if(parts[i].type==='hour') hh=parts[i].value;
        else if(parts[i].type==='minute') mm=parts[i].value;
      }
      if(hh==='24') hh='00';
      return {hh:hh, mm:mm};
    }catch(e){
      var d=new Date();
      return {hh:String(d.getHours()).padStart(2,'0'), mm:String(d.getMinutes()).padStart(2,'0')};
    }
  }
  function kyivHourNow(){
    var t=kyivHM();
    var h=parseInt(t.hh,10), m=parseInt(t.mm,10);
    if(isNaN(h)||isNaN(m)) { var d=new Date(); return d.getHours()+d.getMinutes()/60; }
    return h+m/60;
  }
  function kyivMonthNow(){
    try{
      if(!fmtMonth) throw new Error('no intl');
      var v=parseInt(fmtMonth.format(new Date()),10)-1;
      if(isNaN(v)||v<0||v>11) throw new Error('bad month');
      return v;
    }catch(e){ return new Date().getMonth(); }
  }

  // ---------- WMO weather_code → опади ----------
  function classifyPrecip(code){
    if(code==null || isNaN(code)) return 'none';
    if((code>=51 && code<=67) || (code>=80 && code<=82) || (code>=95 && code<=99)) return 'rain';
    if((code>=71 && code<=77) || (code===85 || code===86)) return 'snow';
    return 'none'; // ясно/хмарно/туман (45,48) тощо
  }
  function gripFor(precip){
    if(precip==='rain') return 0.7;
    if(precip==='snow') return 0.55;
    return 1.0;
  }

  // ---------- фази доби: вага golden/twilight/night довкола сходу і заходу ----------
  var GOLDEN_MIN = 40;   // золота година: ±40 хв від сходу/заходу
  var TWI_MIN = 60;      // ще +60 хв на сутінки/світанок після золотої години
  function clamp01(v){ return v<0?0:(v>1?1:v); }
  function circDistH(h,e){ var d=Math.abs(h-e); return Math.min(d,24-d); } // у годинах, з обгортанням доби

  function computeWeights(hour, sunriseH, sunsetH){
    var dayW=0, goldenW=0, twilightW=0, nightW=0;
    var isDaySide = hour>=sunriseH && hour<sunsetH;
    if(isDaySide){
      var dMin = Math.min(hour-sunriseH, sunsetH-hour)*60;
      goldenW = clamp01(1 - dMin/GOLDEN_MIN);
      dayW = 1-goldenW;
    } else {
      var dMin2 = Math.min(circDistH(hour,sunriseH), circDistH(hour,sunsetH))*60;
      goldenW = clamp01(1 - dMin2/GOLDEN_MIN);
      var rem = 1-goldenW;
      var twiFrac = clamp01(1 - Math.max(0,dMin2-GOLDEN_MIN)/TWI_MIN);
      twilightW = rem*twiFrac;
      nightW = rem*(1-twiFrac);
    }
    return {day:dayW, golden:goldenW, twilight:twilightW, night:nightW};
  }
  function dominantPhase(w){
    var m = Math.max(w.day, w.golden, w.twilight, w.night);
    if(w.golden===m) return 'golden';
    if(w.day===m) return 'day';
    if(w.twilight===m) return 'twilight';
    return 'night';
  }

  // базові кольори тінту (RGBA); «день» — прозорий, тому в суму внеску не дає ні кольору, ні альфи
  var COL_GOLDEN   = {r:255,g:171,b:64,  a:0.30};
  var COL_TWILIGHT = {r:64, g:56, b:150, a:0.30};
  var COL_NIGHT    = {r:8,  g:16, b:46,  a:0.42}; // максимум альфи всього тінту — карта завжди читабельна

  function mixTint(w){
    var wSum = w.golden + w.twilight + w.night;
    if(wSum<=0.0001) return {r:0,g:0,b:0,a:0};
    var r=(w.golden*COL_GOLDEN.r + w.twilight*COL_TWILIGHT.r + w.night*COL_NIGHT.r)/wSum;
    var g=(w.golden*COL_GOLDEN.g + w.twilight*COL_TWILIGHT.g + w.night*COL_NIGHT.g)/wSum;
    var b=(w.golden*COL_GOLDEN.b + w.twilight*COL_TWILIGHT.b + w.night*COL_NIGHT.b)/wSum;
    var a= w.golden*COL_GOLDEN.a + w.twilight*COL_TWILIGHT.a + w.night*COL_NIGHT.a; // day не додає альфи
    return {r:r, g:g, b:b, a:a};
  }

  var PHASE_ICON = { day:'☀️', golden:'🌇', twilight:'🌆', night:'🌙' };

  // ---------- парсинг ISO-часу від Open-Meteo (timezone=Europe/Kyiv, наївний рядок без зсуву) ----------
  // Навмисно НЕ через new Date(iso) — це залежало б від таймзони пристрою гравця.
  function parseIsoHour(iso){
    if(!iso) return null;
    var m = /T(\d{2}):(\d{2})/.exec(iso);
    if(!m) return null;
    var h=parseInt(m[1],10), mi=parseInt(m[2],10);
    if(isNaN(h)||isNaN(mi)) return null;
    return h+mi/60;
  }

  // ---------- стан ----------
  var LIVE = null; // призначається у liveInit(); window.LIVE вказує на той самий об'єкт
  var elTint=null, elHL=null, elPrecip=null, elChipTxt=null;
  var prevIsNight=false, lastPrecipClass='', slowTimer=999; // 999 → перший виклик liveStep одразу оновить повільний блок

  function applyFallbackSun(){
    try{
      var mo = kyivMonthNow();
      var row = SUN_FALLBACK[mo] || SUN_FALLBACK[0];
      LIVE.sunriseH = row[0];
      LIVE.sunsetH = row[1];
    }catch(e){ /* лишаємо попередні/дефолтні значення */ }
  }
  function applyFallbackWeather(){
    // офлайн-фолбек за завданням: погода = ясно
    LIVE.code = (LIVE.code==null) ? 0 : LIVE.code;
    LIVE.precip = 'none';
    LIVE.grip = 1.0;
  }

  function fetchWeather(){
    try{
      if(typeof fetch !== 'function') { applyFallbackSun(); applyFallbackWeather(); return; }
      fetch(OM_URL, {cache:'no-store'}).then(function(res){
        if(!res || !res.ok) throw new Error('bad response '+(res&&res.status));
        return res.json();
      }).then(function(data){
        try{
          var cur = (data && data.current) || {};
          var daily = (data && data.daily) || {};
          if(typeof cur.temperature_2m === 'number') LIVE.tempC = Math.round(cur.temperature_2m);
          if(typeof cur.weather_code === 'number') LIVE.code = cur.weather_code;
          var srH = parseIsoHour(daily.sunrise && daily.sunrise[0]);
          var ssH = parseIsoHour(daily.sunset && daily.sunset[0]);
          if(srH!=null) LIVE.sunriseH = srH;
          if(ssH!=null) LIVE.sunsetH = ssH;
          LIVE.precip = classifyPrecip(LIVE.code);
          LIVE.grip = gripFor(LIVE.precip);
        }catch(e2){ applyFallbackSun(); applyFallbackWeather(); }
      }).catch(function(){ applyFallbackSun(); applyFallbackWeather(); });
    }catch(e){ try{ applyFallbackSun(); applyFallbackWeather(); }catch(e2){} }
  }

  // ---------- DOM: тінт карти / конус фар / опади / чіп HUD ----------
  function injectStyles(){
    if(document.getElementById('liveStyles')) return;
    var css =
      '#liveTint{position:fixed;inset:0;z-index:3;pointer-events:none;background:rgba(0,0,0,0);}' +
      '#liveHeadlights{position:fixed;left:50%;top:50%;width:260px;height:280px;margin:-280px 0 0 -130px;' +
        'transform-origin:50% 100%;pointer-events:none;z-index:4;opacity:0;transition:opacity .5s ease;' +
        'clip-path:polygon(41% 100%,59% 100%,88% 6%,12% 6%);' +
        'background:radial-gradient(ellipse 170px 270px at 50% 100%, rgba(255,244,200,.36), rgba(255,244,200,.12) 55%, rgba(255,244,200,0) 78%);}' +
      '#livePrecip{position:fixed;inset:0;z-index:4;pointer-events:none;opacity:0;transition:opacity .4s;}' +
      '#livePrecip.live-rain{opacity:.5;' +
        'background-image:repeating-linear-gradient(112deg, rgba(200,222,255,.55) 0 1.5px, transparent 1.5px 16px);' +
        'background-size:3px 140%;animation:liveRainFall .4s linear infinite;}' +
      '#livePrecip.live-snow{opacity:.65;' +
        'background-image:radial-gradient(circle, rgba(255,255,255,.9) 1.6px, transparent 1.8px);' +
        'background-size:28px 28px;animation:liveSnowFall 4s linear infinite;}' +
      '@keyframes liveRainFall{from{background-position:0 0;}to{background-position:-30px 130px;}}' +
      '@keyframes liveSnowFall{from{background-position:0 0;}to{background-position:16px 240px;}}' +
      '#liveChip{white-space:nowrap;}';
    var styleEl = document.createElement('style');
    styleEl.id = 'liveStyles';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }
  function ensureDom(){
    injectStyles();
    elTint = document.getElementById('liveTint');
    if(!elTint){ elTint=document.createElement('div'); elTint.id='liveTint'; document.body.appendChild(elTint); }
    elHL = document.getElementById('liveHeadlights');
    if(!elHL){ elHL=document.createElement('div'); elHL.id='liveHeadlights'; document.body.appendChild(elHL); }
    elPrecip = document.getElementById('livePrecip');
    if(!elPrecip){ elPrecip=document.createElement('div'); elPrecip.id='livePrecip'; document.body.appendChild(elPrecip); }
    var chip = document.getElementById('liveChip');
    if(!chip){
      chip = document.createElement('div');
      chip.id = 'liveChip';
      chip.className = 'chip';
      var span = document.createElement('span');
      span.id = 'liveChipTxt';
      span.textContent = '…';
      chip.appendChild(span);
      var hud = document.getElementById('hud');
      if(hud) hud.appendChild(chip); else document.body.appendChild(chip);
      elChipTxt = span; // пряме посилання — надійніше за повторний getElementById одразу після вставки
    } else {
      elChipTxt = document.getElementById('liveChipTxt') || elChipTxt;
    }
  }

  function renderChipText(){
    if(!elChipTxt) return;
    try{
      var t = kyivHM();
      var phaseIcon = PHASE_ICON[LIVE.phaseOfDay] || '☀️';
      var precipIcon = LIVE.precip==='rain' ? '🌧' : (LIVE.precip==='snow' ? '❄️' : '');
      var tempBlock = '';
      if(LIVE.tempC!=null){
        var sign = LIVE.tempC>=0 ? '+' : '';
        tempBlock = (precipIcon ? precipIcon+' ' : '') + sign + LIVE.tempC + '°';
      } else if(precipIcon){
        tempBlock = precipIcon;
      }
      elChipTxt.textContent = tempBlock ? (phaseIcon+' '+t.hh+':'+t.mm+' · '+tempBlock) : (phaseIcon+' '+t.hh+':'+t.mm);
    }catch(e){ /* мовчки лишаємо попередній текст */ }
  }

  // повільний блок (~1 раз/с): година, тінт, фаза доби, isNight, тост фар, чіп
  function slowUpdate(){
    var hour = kyivHourNow();
    var w = computeWeights(hour, LIVE.sunriseH, LIVE.sunsetH);
    LIVE.phaseOfDay = dominantPhase(w);

    var tint = mixTint(w);
    if(elTint) elTint.style.background = 'rgba('+(tint.r|0)+','+(tint.g|0)+','+(tint.b|0)+','+tint.a.toFixed(3)+')';

    var nowNight = (hour < LIVE.sunriseH) || (hour >= LIVE.sunsetH);
    LIVE.isNight = nowNight;
    if(elHL) elHL.style.opacity = nowNight ? '1' : '0';
    if(nowNight && !prevIsNight){
      try{
        var okPhase = (typeof phase === 'undefined') || phase === 'play';
        if(okPhase && typeof toast === 'function') toast('💡 Увімкнув фари');
        if(okPhase) window.PROGRESSION && window.PROGRESSION.event('night_drive');
      }catch(e){ /* ignore */ }
    }
    prevIsNight = nowNight;

    var pClass = LIVE.precip==='rain' ? 'live-rain' : (LIVE.precip==='snow' ? 'live-snow' : '');
    if(elPrecip && pClass!==lastPrecipClass){ elPrecip.className = pClass; lastPrecipClass = pClass; }

    renderChipText();
  }

  // ---------- публічний контракт ----------
  window.LIVE = window.LIVE || {
    grip: 1, isNight: false, phaseOfDay: 'day', precip: 'none',
    tempC: null, code: null, sunriseH: 6, sunsetH: 21
  };

  window.liveInit = function(){
    try{
      if(window.__liveInited) return;
      window.__liveInited = true;
      LIVE = window.LIVE;

      ensureDom();
      applyFallbackSun();        // синхронний фолбек одразу, щоб не чекати мережі для першого кадру
      slowTimer = 999;           // форсує негайний slowUpdate() на першому liveStep
      try{ slowUpdate(); }catch(e){}

      fetchWeather();            // перший запит (без блокування)
      try{
        setInterval(function(){ try{ fetchWeather(); }catch(e){} }, 10*60*1000); // раз на ~10 хв
      }catch(e){ /* ignore */ }
    }catch(e){ /* ніколи не ламаємо завантаження гри */ }
  };

  window.liveStep = function(dt){
    try{
      if(!LIVE) return; // liveInit() ще не викликали
      var d = (typeof dt === 'number' && dt > 0 && dt < 1) ? dt : 0.016;

      // конус фар — щокадру, синхронно з поворотом авто
      if(elHL){
        var heading = 0;
        try{ if(typeof car !== 'undefined' && typeof car.heading === 'number') heading = car.heading; }catch(e){}
        elHL.style.transform = 'rotate('+heading+'rad)';
      }

      // усе, що залежить від часу доби/погоди, — не частіше ~1 раз/с
      slowTimer += d;
      if(slowTimer >= 1){
        slowTimer = 0;
        slowUpdate();
      }
    }catch(e){ /* ніколи не ламаємо цикл гри */ }
  };
})();


// старт живих підсистем (Оболонь FM + Київський час)

// ================= 💾 SAVE + 🐾 СЛІДИ СУСІДІВ + ⚙️ НАЛАШТУВАННЯ (v0.6) =================
// ============================================================
// 💾 ЗБЕРЕЖЕННЯ ПРОГРЕСУ (SAVE)
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий
// класичний <script>, що й основна гра — бачить її глобали
// (money, fuel, fuelType, selectedMode, handedMode, roadsOnly, cruiseSet,
// CFG, car, phase, toast, updateHUD, applyHanded) і нічого з них не
// перевизначає. Присвоєння глобалам тут (money=…, fuel=…) міняють саме
// ту `let`-змінну, що й решта гри, бо модуль живе в тому самому <script>.
//
// Контракт: window.SAVE = { load, applyRestore, save, addKm, addEarned,
//           stats, wipe }
//
// Усе в try/catch: localStorage може кидати у приватному режимі —
// тоді граємо без збереження, гра ніколи не падає через це.
// ============================================================
(function(){
  'use strict';

  var SAVE_KEY       = 'kotik_save_v1';
  var SAVE_VERSION   = 1;
  var SAVE_THROTTLE  = 2000;   // мс — не частіше ~1 раз/2с пишемо в localStorage
  var AUTOSAVE_EVERY = 15000;  // мс — періодичне автозбереження

  var FUEL_TYPES = { A95:1, LPG:1 };
  var MODES      = { auto:1, manual:1 };
  var HANDS      = { two:1, one:1 };

  var saved       = null;   // внутрішній стан: { v, money, fuel, fuelType, selectedMode,
                             //   handedMode, roadsOnly, cruiseSet, totalKm, totalEarned, sessions }
  var hasSave     = false;  // чи існувало ВАЛІДНЕ збереження до load() (розрізняє «перший запуск»)
  var lastSaveAt  = 0;      // мітка часу останнього фактичного запису в localStorage
  var pendingSave = null;   // setTimeout id відкладеного запису (throttle)

  function now(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function isNum(v){ return typeof v==='number' && isFinite(v); }

  // ---- валідація: битий/чужорідний JSON → null, ігноруємо, не падаємо ----
  function validate(obj){
    try{
      if(!obj || typeof obj!=='object') return null;
      if(obj.v!==SAVE_VERSION) return null;
      if(!isNum(obj.money) || obj.money<0) return null;
      if(!isNum(obj.fuel) || obj.fuel<0) return null;
      if(typeof obj.fuelType!=='string' || !FUEL_TYPES[obj.fuelType]) return null;
      if(typeof obj.selectedMode!=='string' || !MODES[obj.selectedMode]) return null;
      if(typeof obj.handedMode!=='string' || !HANDS[obj.handedMode]) return null;
      if(typeof obj.roadsOnly!=='boolean') return null;
      if(!isNum(obj.cruiseSet) || obj.cruiseSet<=0) return null;
      if(!isNum(obj.totalKm) || obj.totalKm<0) return null;
      if(!isNum(obj.totalEarned) || obj.totalEarned<0) return null;
      if(!isNum(obj.sessions) || obj.sessions<0) return null;
      return {
        v:SAVE_VERSION, money:obj.money, fuel:obj.fuel, fuelType:obj.fuelType,
        selectedMode:obj.selectedMode, handedMode:obj.handedMode, roadsOnly:obj.roadsOnly,
        cruiseSet:obj.cruiseSet, totalKm:obj.totalKm, totalEarned:obj.totalEarned,
        sessions:obj.sessions
      };
    }catch(_){ return null; }
  }

  function readRaw(){
    try{
      var raw = localStorage.getItem(SAVE_KEY);
      if(!raw) return null;
      return validate(JSON.parse(raw));
    }catch(_){ return null; } // битий JSON / localStorage недоступний → як «нема збереження»
  }
  function writeRaw(obj){
    try{ localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); return true; }
    catch(_){ return false; } // приватний режим і т.п. → мовчки не зберігаємо
  }

  // ---- зібрати поточний стан гри + вже накопичену статистику ----
  function collectCurrent(){
    var stat = saved || {};
    return {
      v:SAVE_VERSION,
      money: isNum(money) ? money : CFG.startMoney,
      fuel: isNum(fuel) ? fuel : CFG.startFuel,
      fuelType: (fuelType==='LPG') ? 'LPG' : 'A95',
      selectedMode: (selectedMode==='manual') ? 'manual' : 'auto',
      handedMode: (handedMode==='one') ? 'one' : 'two',
      roadsOnly: !!roadsOnly,
      cruiseSet: isNum(cruiseSet) ? cruiseSet : 40,
      totalKm: isNum(stat.totalKm) ? stat.totalKm : 0,
      totalEarned: isNum(stat.totalEarned) ? stat.totalEarned : 0,
      sessions: isNum(stat.sessions) ? stat.sessions : 0
    };
  }

  // негайний фактичний запис (без throttle) — для autosave-подій, де відкладати не варто
  function saveNow(){
    try{
      var obj = collectCurrent();
      if(writeRaw(obj)) saved = obj;
      lastSaveAt = now();
    }catch(_){ }
  }

  // публічний save(): throttle ~1 раз/2с, щоб часті виклики (кожен кадр із addKm) не гальмували
  function save(){
    try{
      clearTimeout(pendingSave);
      var elapsed = now() - lastSaveAt;
      if(elapsed >= SAVE_THROTTLE){ saveNow(); }
      else { pendingSave = setTimeout(saveNow, SAVE_THROTTLE - elapsed); }
    }catch(_){ }
  }

  // ---- завантаження (виклик один раз, до старту гри) ----
  function load(){
    try{
      var existing = readRaw();
      hasSave = !!existing;
      saved = existing || {
        v:SAVE_VERSION, money:CFG.startMoney, fuel:CFG.startFuel, fuelType:'A95',
        selectedMode:'auto', handedMode:'two', roadsOnly:true, cruiseSet:40,
        totalKm:0, totalEarned:0, sessions:0
      };
      saved.sessions = (isNum(saved.sessions) ? saved.sessions : 0) + 1;
      writeRaw(saved);
      lastSaveAt = now();
    }catch(_){ }
  }

  // ---- застосувати збережений прогрес до глобалів гри ----
  function applyRestore(){
    try{
      if(!hasSave || !saved) return; // нема збереження → перший запуск, лишаємо дефолти initGame()
      money = isNum(saved.money) ? saved.money : money;
      fuel = isNum(saved.fuel) ? saved.fuel : fuel;
      if(fuel > CFG.tank) fuel = CFG.tank;     // захист від битих/старих значень понад бак
      if(fuel < 2) fuel = 2;                    // захист від застрягання: завжди можна доїхати до АЗС
      fuelType = (saved.fuelType==='LPG') ? 'LPG' : 'A95';
      selectedMode = (saved.selectedMode==='manual') ? 'manual' : 'auto';
      handedMode = (saved.handedMode==='one') ? 'one' : 'two';
      roadsOnly = !!saved.roadsOnly;
      cruiseSet = isNum(saved.cruiseSet) ? saved.cruiseSet : cruiseSet;
      if(typeof updateHUD==='function') updateHUD();
    }catch(_){ }
  }

  // ---- накопичувальна статистика ----
  function addKm(km){
    try{
      if(!isNum(km) || km<=0) return;
      if(!saved) saved = collectCurrent();
      saved.totalKm = (isNum(saved.totalKm) ? saved.totalKm : 0) + km;
      save();
    }catch(_){ }
  }
  function addEarned(grn){
    try{
      if(!isNum(grn) || grn<=0) return;
      if(!saved) saved = collectCurrent();
      saved.totalEarned = (isNum(saved.totalEarned) ? saved.totalEarned : 0) + grn;
      save();
    }catch(_){ }
  }

  // ---- для панелі налаштувань ----
  function stats(){
    try{
      var s = saved || {};
      return {
        totalKm: isNum(s.totalKm) ? s.totalKm : 0,
        totalEarned: isNum(s.totalEarned) ? s.totalEarned : 0,
        sessions: isNum(s.sessions) ? s.sessions : 0,
        money: isNum(money) ? Math.round(money) : 0
      };
    }catch(_){ return { totalKm:0, totalEarned:0, sessions:0, money:0 }; }
  }

  // ---- «почати заново»: стерти збереження, скинути економіку до дефолтів CFG ----
  function wipe(){
    try{
      try{ localStorage.removeItem(SAVE_KEY); }catch(_){ }
      money = CFG.startMoney; fuel = CFG.startFuel; fuelType = 'A95';
      saved = null; hasSave = false;
      saveNow(); // одразу пишемо чисте збереження (нульова статистика), щоб стара не ожила
      if(typeof updateHUD==='function') updateHUD();
      if(typeof toast==='function') toast('Прогрес скинуто');
    }catch(_){ }
  }

  // ---- автозбереження: не покладаємось лише на явні виклики з ігрових подій ----
  try{
    document.addEventListener('visibilitychange', function(){
      try{ if(document.visibilityState==='hidden') saveNow(); }catch(_){ }
    });
  }catch(_){ }
  try{
    addEventListener('pagehide', function(){ try{ saveNow(); }catch(_){ } });
  }catch(_){ }
  try{
    setInterval(function(){ try{ saveNow(); }catch(_){ } }, AUTOSAVE_EVERY);
  }catch(_){ }

  window.SAVE = { load:load, applyRestore:applyRestore, save:save, addKm:addKm,
                  addEarned:addEarned, stats:stats, wipe:wipe };
})();


// ============================================================
// «Сліди сусідів» — теплий соціальний шар (v0.6)
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий
// класичний <script>, що й основна гра — бачить її глобали й нічого
// з них не перевизначає:
//   map (Leaflet), car{x,y,heading,speed,...}, phase ('play' під час їзди),
//   money (let), fuel (let), toXY/fromXY, dist(aLat,aLng,bLat,bLng),
//   toast(msg), updateHUD(), ac(), bell(freq,t0,dur,vol),
//   stations[], mp{nick,...}, MP_BROKERS[], window.mqtt, poiIcon(cls,emoji),
//   DOM: #actions, #hud
//
// Інші гравці присутні в районі не машинами, а слідами доброти:
// кожен слід — окремий retained MQTT-топік kotikobolon/traces/<id>.
// Новий клієнт при підписці на kotikobolon/traces/# одразу отримує
// всі збережені сліди (це і є вся «мережа» — без сервера).
// Порожній payload у retained-топіку = слід видалено.
//
// Контракт:
//   window.TRACES.init()        — одноразово при завантаженні (готує
//                                  кнопку/DOM/стан; MQTT ще НЕ підключає)
//   window.TRACES.step(dt)      — виклик щокадру із step(dt) під час
//                                  phase==='play' (перший виклик — тригер
//                                  підключення до MQTT)
//   window.TRACES.setEnabled(b) — увімк/вимк фічу (persist у localStorage)
//   window.TRACES.enabled       — поточний прапорець (bool)
//   window.TRACES.leaveMenu()   — примусово закрити меню вибору сліду
// ============================================================
(function(){
  'use strict';

  // ---------- ключі localStorage ----------
  var LS_ON            = 'kotik_traces_on';        // '1' | '0'
  var LS_DAY            = 'kotik_traces_day';       // {date:'YYYY-M-D', count:N}
  var LS_MINE           = 'kotik_traces_mine';      // {id: expMs, ...} — власні сліди
  var LS_COFFEE_CLAIMED = 'kotik_coffee_claimed';   // [id, id, ...]

  var TOPIC_BASE = 'kotikobolon/traces/';
  var TOPIC_WILD = 'kotikobolon/traces/#';

  var DAY_MS = 24*3600*1000;

  // ---------- типи слідів: ГОТОВІ фрази, гравець лише обирає ----------
  var TYPES = {
    beauty: {
      emoji:'📍', label:'Краса', exp: 7*DAY_MS,
      phrases:['Звідси гарний захід 🌇','Тут тихо і добре','Гарний краєвид на Дніпро','Улюблене місце району']
    },
    warn: {
      emoji:'⚠️', label:'Обережно', exp: 7*DAY_MS,
      phrases:['Обережно, яма','Тут часто пішоходи','Слизько після дощу','Уважно — діти']
    },
    coffee: {
      emoji:'☕', label:'Підвішена кава', exp: 2*DAY_MS, cost:40,
      phrases:['Гарного дня, котику ☕','Ти впораєшся',"З любов'ю від сусіда"]
    },
    hello: {
      emoji:'📣', label:'Привіт (гудок)', exp: 12*3600*1000,
      phrases:[]
    }
  };

  var STATION_NEAR_R = 30;   // м — АЗС поруч, щоб лишити каву
  var COFFEE_CLAIM_R = 25;   // м — до чужої кави, щоб забрати
  var HELLO_HEAR_R   = 30;   // м — до чужого привіту, щоб почути гудок
  var SLOW_SPEED     = 8;    // км/год — «стоїть» (як у updateCtx)
  var DAILY_MAX      = 5;
  var COOLDOWN_MS    = 10000;
  var PROX_EVERY_S   = 0.25; // як часто перевіряти близькість (не щокадру)

  // ---------- приватний стан модуля ----------
  var myClientId   = 'ktr_' + Math.random().toString(36).slice(2,10);
  var mqttClient    = null;
  var brokerIdx     = 0;
  var mqttUnavailable = false;

  var tracesById    = new Map(); // id -> {data, marker, mine, lat, lng}
  var mineMap       = {};        // id -> expMs (власні сліди; переживає перезавантаження)
  var claimedSet    = new Set(); // id забраних кав
  var heardHello    = new Set(); // id привітів, почутих ЦІЄЇ сесії

  var layer         = null;      // L.layerGroup з усіма маркерами слідів
  var elBtn         = null, elMenu = null, elList = null, elClaim = null;
  var menuView       = 'root';
  var nearCoffeeId   = null;
  var lastCreateAt   = 0;
  var proxAccum      = 0;

  // ---------- дрібні хелпери ----------
  function toastSafe(msg){ try{ if(typeof toast==='function') toast(msg); }catch(e){} }

  function loadJSON(key, fallback){
    try{ var raw=localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch(e){ return fallback; }
  }
  function saveJSON(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }

  function localDateKey(){
    var d=new Date();
    return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
  }

  function getNick(){
    try{ if(typeof mp!=='undefined' && mp && mp.nick) return String(mp.nick).slice(0,12); }catch(e){}
    try{ var n=localStorage.getItem('mpNick'); if(n) return String(n).slice(0,12); }catch(e){}
    return 'Котик';
  }

  function nearAnyStation(){
    try{
      if(typeof stations==='undefined' || !stations || !stations.length) return false;
      var p=fromXY(car.x,car.y);
      for(var i=0;i<stations.length;i++){
        var s=stations[i];
        if(dist(p.lat,p.lng,s.lat,s.lng) < STATION_NEAR_R) return true;
      }
    }catch(e){}
    return false;
  }

  function newTraceId(){
    return 'tr'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  }

  // ---------- «власні» сліди (щоб інакше показувати й вміти прибрати прострочені) ----------
  function loadMine(){
    var obj = loadJSON(LS_MINE, {});
    if(!obj || typeof obj!=='object') obj={};
    return obj;
  }
  function saveMine(){ saveJSON(LS_MINE, mineMap); }
  function markMine(id, exp){ try{ mineMap[id]=exp; saveMine(); }catch(e){} }
  function isMine(id){ return !!(mineMap && Object.prototype.hasOwnProperty.call(mineMap,id)); }

  // ---------- забрані кави (щоб не забрати двічі) ----------
  // M3: масив інакше росте назавжди — відкидаємо застарілі id (>3 доби; кава й так
  // живе лише 2 доби, тож 3 — надійний запас) і підстраховуємось лімітом розміру.
  var CLAIMED_MAX_AGE_MS = 3*DAY_MS;
  var CLAIMED_MAX_COUNT  = 200;
  function claimedIdAgeMs(id){
    try{
      if(typeof id!=='string' || id.slice(0,2)!=='tr' || id.length<=8) return null;
      var t36 = id.slice(2, id.length-6);
      var t = parseInt(t36, 36);
      if(!isFinite(t) || t<=0) return null;
      return Date.now() - t;
    }catch(e){ return null; }
  }
  function loadClaimed(){
    var arr = loadJSON(LS_COFFEE_CLAIMED, []);
    if(!Array.isArray(arr)) arr=[];
    arr = arr.filter(function(id){
      var age = claimedIdAgeMs(id);
      return age===null ? true : age <= CLAIMED_MAX_AGE_MS; // невпізнаний формат — лишаємо, покладаємось на ліміт розміру нижче
    });
    if(arr.length > CLAIMED_MAX_COUNT) arr = arr.slice(arr.length - CLAIMED_MAX_COUNT);
    return new Set(arr);
  }
  function saveClaimed(){ try{ saveJSON(LS_COFFEE_CLAIMED, Array.from(claimedSet)); }catch(e){} }
  function isCoffeeClaimed(id){ return claimedSet.has(id); }
  function markCoffeeClaimed(id){ claimedSet.add(id); saveClaimed(); }

  // ---------- антиспам: ≤5 власних слідів/добу + кулдаун ~10с ----------
  function canCreateToday(){
    var day = loadJSON(LS_DAY, {date:'',count:0});
    return day.date !== localDateKey() || day.count < DAILY_MAX;
  }
  function bumpDailyCounter(){
    var day = loadJSON(LS_DAY, {date:'',count:0});
    var key = localDateKey();
    if(day.date !== key) day = {date:key, count:0};
    day.count++;
    saveJSON(LS_DAY, day);
  }

  // ---------- звук: тихий клаксон-«привіт» ----------
  function playHorn(){
    try{
      var t0 = ac().currentTime;
      bell(520, t0,      0.14, 0.14);
      bell(390, t0+0.10, 0.18, 0.14);
    }catch(e){}
  }

  // ================= MQTT =================
  function connectMqtt(){
    try{
      var url = MP_BROKERS[brokerIdx % MP_BROKERS.length];
      mqttClient = mqtt.connect(url, { clientId:myClientId, keepalive:30, connectTimeout:6000 });
    }catch(e){
      mqttClient=null;
      brokerIdx++;
      if(brokerIdx < MP_BROKERS.length) connectMqtt();
      else { mqttUnavailable=true; applyEnabledVisual(); }
      return;
    }
    try{
      mqttClient.on('connect', function(){
        try{ mqttClient.subscribe(TOPIC_WILD); }catch(e){}
      });
      mqttClient.on('message', function(topic, payload){
        try{ handleIncoming(topic, payload); }catch(e){}
      });
      mqttClient.on('error', function(){
        try{ mqttClient.end(true); }catch(e){}
        mqttClient=null;
        brokerIdx++;
        if(brokerIdx < MP_BROKERS.length && window.TRACES.enabled){ connectMqtt(); }
        else { mqttUnavailable=true; applyEnabledVisual(); }
      });
    }catch(e){ mqttClient=null; mqttUnavailable=true; applyEnabledVisual(); }
  }

  function disconnectMqtt(){
    try{ if(mqttClient) mqttClient.end(true); }catch(e){}
    mqttClient=null;
    try{
      tracesById.forEach(function(t){ try{ layer.removeLayer(t.marker); }catch(e){} });
    }catch(e){}
    tracesById.clear();
    nearCoffeeId=null;
  }

  function ensureConnected(){
    try{
      if(!window.TRACES.enabled || mqttUnavailable || mqttClient) return;
      if(typeof phase==='undefined' || phase!=='play') return;
      if(!window.mqtt){ mqttUnavailable=true; applyEnabledVisual(); return; }
      connectMqtt();
    }catch(e){}
  }

  function handleIncoming(topic, payloadBuf){
    if(typeof topic!=='string' || topic.indexOf(TOPIC_BASE)!==0) return;
    var id = topic.slice(TOPIC_BASE.length);
    if(!id) return;
    var raw = payloadBuf ? payloadBuf.toString() : '';
    if(!raw){ removeTraceMarker(id); tracesById.delete(id); heardHello.delete(id); return; }
    if(raw.length>4096){ return; } // публічний retained-топік — захист від велетенського сміття
    var d;
    try{ d=JSON.parse(raw); }catch(e){ return; }
    if(!d || !d.id || !TYPES[d.type] || typeof d.x!=='number' || typeof d.y!=='number') return;
    if(d.exp && Date.now() > d.exp){
      removeTraceMarker(id); tracesById.delete(id); heardHello.delete(id);
      if(isMine(id)) clearOwnTrace(id);
      return;
    }
    upsertTrace(id, d);
  }

  function clearOwnTrace(id){
    try{ if(mqttClient && mqttClient.connected) mqttClient.publish(TOPIC_BASE+id, '', {retain:true}); }catch(e){}
    try{ delete mineMap[id]; saveMine(); }catch(e){}
  }

  function pruneOwnExpired(){
    var now=Date.now(), changed=false;
    for(var id in mineMap){
      if(!Object.prototype.hasOwnProperty.call(mineMap,id)) continue;
      if(now > mineMap[id]){
        if(tracesById.has(id)){
          removeTraceMarker(id); tracesById.delete(id);
          try{ if(mqttClient && mqttClient.connected) mqttClient.publish(TOPIC_BASE+id, '', {retain:true}); }catch(e){}
        }
        delete mineMap[id]; changed=true;
      }
    }
    if(changed) saveMine();
  }

  // M1: чужі сліди прострочуються тим самим exp, але їх ніхто локально не прибирав —
  // без цього tracesById/heardHello ростуть, доки хтось не опублікує порожній payload.
  function pruneForeignExpired(){
    try{
      var now = Date.now();
      tracesById.forEach(function(t, id){
        if(t && t.data && t.data.exp && now > t.data.exp){
          removeTraceMarker(id); tracesById.delete(id); heardHello.delete(id);
        }
      });
    }catch(e){}
  }

  // ================= маркери на карті =================
  function upsertTrace(id, d){
    var typeDef = TYPES[d.type]; if(!typeDef) return;
    var mine = isMine(id);
    var p; try{ p=fromXY(d.x,d.y); }catch(e){ return; }
    var existing = tracesById.get(id);
    if(existing){
      existing.data=d; existing.lat=p.lat; existing.lng=p.lng;
      try{ existing.marker.setLatLng([p.lat,p.lng]); }catch(e){}
      return;
    }
    var cls = 'trace-'+d.type + (mine ? ' trace-mine' : '');
    var marker;
    try{ marker = L.marker([p.lat,p.lng], {icon:poiIcon(cls, typeDef.emoji)}).addTo(layer); }
    catch(e){ return; }
    try{
      marker.on('click', function(){
        try{
          var who = mine ? 'Твій слід' : (d.nick || 'Сусід');
          var text = d.type==='hello' ? (who + (mine ? ' (привіт)' : ' тут проїжджав')) :
                     (d.msg ? (who+': «'+d.msg+'»') : who);
          toastSafe(typeDef.emoji+' '+text);
        }catch(e){}
      });
    }catch(e){}
    tracesById.set(id, {data:d, marker:marker, mine:mine, lat:p.lat, lng:p.lng});
  }

  function removeTraceMarker(id){
    var t=tracesById.get(id);
    if(t && t.marker){ try{ layer.removeLayer(t.marker); }catch(e){} }
  }

  // ================= створення нового сліду =================
  function createTrace(type, msgText){
    try{
      if(!window.TRACES.enabled || mqttUnavailable) return false;
      var typeDef = TYPES[type]; if(!typeDef) return false;
      var now = Date.now();
      if(now - lastCreateAt < COOLDOWN_MS){ toastSafe('🐾 Зачекай трохи перед новим слідом'); return false; }
      if(!canCreateToday()){ toastSafe('🐾 На сьогодні слідів досить — повертайся завтра'); return false; }
      if(type==='coffee'){
        if(typeof money!=='number' || money < typeDef.cost){ toastSafe('☕ Не вистачає грошей на каву (40 грн)'); return false; }
        if(!nearAnyStation()){ toastSafe('☕ Каву можна лишити лише біля АЗС'); return false; }
      }
      if(!mqttClient || !mqttClient.connected){ toastSafe('🐾 Немає звʼязку — слід не надіслано'); return false; }
      var id = newTraceId();
      var exp = now + typeDef.exp;
      var payload = { id:id, type:type, msg: msgText||'', nick:getNick(),
                       x:+car.x.toFixed(1), y:+car.y.toFixed(1), t:now, exp:exp };
      try{ mqttClient.publish(TOPIC_BASE+id, JSON.stringify(payload), {retain:true, qos:0}); }
      catch(e){ toastSafe('🐾 Не вдалось надіслати слід'); return false; }
      if(type==='coffee'){ try{ money -= typeDef.cost; updateHUD(); }catch(e){} }
      lastCreateAt = now;
      bumpDailyCounter();
      markMine(id, exp);
      upsertTrace(id, payload);
      try{ window.PROGRESSION && window.PROGRESSION.event('trace_left'); }catch(e){}
      return true;
    }catch(e){ return false; }
  }

  // ================= близькість: кава-забрати / гудок-привіт =================
  function checkProximity(){
    try{
      var p = fromXY(car.x, car.y);
      var slow = Math.abs(car.speed) < SLOW_SPEED;
      var bestId=null, bestD=Infinity;
      tracesById.forEach(function(t, id){
        var d=t.data;
        if(d.type==='coffee' && !t.mine && !isCoffeeClaimed(id) && slow){
          var dc = dist(p.lat,p.lng,t.lat,t.lng);
          if(dc < COFFEE_CLAIM_R && dc < bestD){ bestD=dc; bestId=id; }
        }
        if(d.type==='hello' && !t.mine && !heardHello.has(id)){
          var dh = dist(p.lat,p.lng,t.lat,t.lng);
          if(dh < HELLO_HEAR_R){
            heardHello.add(id);
            playHorn();
            toastSafe('🐾 '+(d.nick||'Сусід')+' передав тут привіт');
          }
        }
      });
      nearCoffeeId = bestId;
      updateClaimButtonVisibility();
    }catch(e){}
  }

  function doClaimCoffee(){
    try{
      var id = nearCoffeeId; if(!id) return;
      if(isCoffeeClaimed(id)){ nearCoffeeId=null; updateClaimButtonVisibility(); return; }
      var t = tracesById.get(id);
      if(!t){ nearCoffeeId=null; updateClaimButtonVisibility(); return; }
      var d = t.data;
      markCoffeeClaimed(id);
      if(typeof money==='number'){ money += 40; try{ updateHUD(); }catch(e){} }
      try{ window.SFX&&window.SFX.play('cash'); }catch(e){}
      toastSafe('☕ Кава забрана!'+(d.msg ? (' «'+d.msg+'»') : '')+' +40 грн');
      removeTraceMarker(id); tracesById.delete(id);
      try{ if(mqttClient && mqttClient.connected) mqttClient.publish(TOPIC_BASE+id, '', {retain:true}); }catch(e){}
      nearCoffeeId=null;
      updateClaimButtonVisibility();
    }catch(e){}
  }

  function updateClaimButtonVisibility(){
    try{
      if(!elClaim) return;
      var show = window.TRACES.enabled && !!nearCoffeeId &&
                 (typeof phase==='undefined' || phase==='play');
      elClaim.style.display = show ? 'block' : 'none';
    }catch(e){}
  }

  // ================= UI: кнопка + меню вибору сліду =================
  function injectStyles(){
    if(document.getElementById('tracesStyles')) return;
    var css =
      '#trClaim{position:absolute;left:50%;bottom:322px;transform:translateX(-50%);z-index:12;pointer-events:auto;'+
        'background:#c98a2e;color:#fff;font-weight:800;font-size:14px;padding:11px 18px;border:none;border-radius:16px;'+
        'box-shadow:0 6px 18px rgba(0,0,0,.35);display:none;}'+
      '#trClaim:active{transform:translateX(-50%) scale(.95);}'+
      '#trList .trOpt:disabled{opacity:.45;}'+
      '.poi.trace-beauty{background:#2b9d6b;}'+
      '.poi.trace-warn{background:#d97b1f;}'+
      '.poi.trace-coffee{background:#a9662c;}'+
      '.poi.trace-hello{background:#3a7fd9;}'+
      '.poi.trace-mine{opacity:.72;filter:saturate(.75);'+
        'box-shadow:0 0 0 2px rgba(255,255,255,.55),0 2px 5px rgba(0,0,0,.35);}';
    var styleEl=document.createElement('style');
    styleEl.id='tracesStyles';
    styleEl.textContent=css;
    document.head.appendChild(styleEl);
  }

  function ensureDom(){
    injectStyles();

    elBtn = document.getElementById('traceBtn');
    if(!elBtn){
      elBtn = document.createElement('button');
      elBtn.className='act'; elBtn.id='traceBtn'; elBtn.title='Слід сусіда';
      elBtn.innerHTML='🐾<small>СЛІД</small>';
      var actions=document.getElementById('actions');
      if(actions) actions.appendChild(elBtn); else document.body.appendChild(elBtn);
      elBtn.addEventListener('click', openMenu);
    }

    elMenu = document.getElementById('trOverlay');
    if(!elMenu){
      elMenu = document.createElement('div');
      elMenu.id='trOverlay'; elMenu.className='overlay hidden';
      elMenu.innerHTML =
        '<div class="card">'+
          '<div class="paw">🐾</div>'+
          '<h1>Слід сусіда</h1>'+
          '<p>Тепла присутність — без токсу. Обери, що лишити тут.</p>'+
          '<div id="trList"></div>'+
          '<button class="cta sec" id="trClose" style="margin-top:8px;">Закрити</button>'+
        '</div>';
      document.body.appendChild(elMenu);
      elMenu.addEventListener('click', function(e){ if(e.target===elMenu) closeMenu(); });
      var closeBtn=document.getElementById('trClose');
      if(closeBtn) closeBtn.addEventListener('click', closeMenu);
    }
    elList = document.getElementById('trList');

    elClaim = document.getElementById('trClaim');
    if(!elClaim){
      elClaim = document.createElement('button');
      elClaim.id='trClaim'; elClaim.textContent='☕ Забрати каву';
      document.body.appendChild(elClaim);
      elClaim.addEventListener('click', doClaimCoffee);
    }

    if(!layer){ try{ layer = L.layerGroup(); }catch(e){} }
  }

  function trOptHtml(key,label,disabled){
    return '<button class="cta sec trOpt" data-k="'+key+'" style="margin-top:8px;"'+(disabled?' disabled':'')+'>'+label+'</button>';
  }

  function renderRoot(){
    menuView='root';
    if(!elList) return;
    var parts=[];
    parts.push(trOptHtml('beauty', TYPES.beauty.emoji+' '+TYPES.beauty.label, false));
    parts.push(trOptHtml('warn',   TYPES.warn.emoji+' '+TYPES.warn.label, false));
    var canLeaveCoffee = nearAnyStation();
    var haveMoney = (typeof money==='number') && money >= TYPES.coffee.cost;
    if(canLeaveCoffee){
      var lbl = TYPES.coffee.emoji+' '+TYPES.coffee.label+' — '+TYPES.coffee.cost+' грн'+(haveMoney?'':' (не вистачає)');
      parts.push(trOptHtml('coffee', lbl, !haveMoney));
    } else {
      parts.push('<div class="legend">'+TYPES.coffee.emoji+' Підвішену каву можна лишити лише біля АЗС</div>');
    }
    parts.push(trOptHtml('hello', TYPES.hello.emoji+' '+TYPES.hello.label, false));
    elList.innerHTML = parts.join('');

    var opts = elList.querySelectorAll('.trOpt');
    for(var i=0;i<opts.length;i++){
      (function(btn){
        btn.addEventListener('click', function(){
          var k=btn.getAttribute('data-k');
          if(k==='hello'){
            playHorn();
            var ok=createTrace('hello','');
            if(ok) toastSafe('📣 Привіт передано сусідам!');
            closeMenu();
          } else {
            renderPhrases(k);
          }
        });
      })(opts[i]);
    }
  }

  function renderPhrases(type){
    menuView=type;
    var def=TYPES[type];
    if(!elList || !def) return;
    var parts=['<button class="cta sec" id="trBack" style="margin-top:0;">← Назад</button>'];
    for(var i=0;i<def.phrases.length;i++){
      parts.push('<button class="cta sec trPh" data-i="'+i+'" style="margin-top:8px;">'+def.phrases[i]+'</button>');
    }
    elList.innerHTML = parts.join('');

    var back=document.getElementById('trBack');
    if(back) back.addEventListener('click', renderRoot);

    var phBtns = elList.querySelectorAll('.trPh');
    for(var j=0;j<phBtns.length;j++){
      (function(btn){
        btn.addEventListener('click', function(){
          var idx=parseInt(btn.getAttribute('data-i'),10);
          var msg=def.phrases[idx];
          var ok=createTrace(type, msg);
          if(ok) toastSafe(def.emoji+' Слід залишено: «'+msg+'»');
          closeMenu();
        });
      })(phBtns[j]);
    }
  }

  function openMenu(){
    try{
      if(!window.TRACES.enabled || mqttUnavailable){ toastSafe('🐾 Сліди сусідів зараз недоступні'); return; }
      ensureDom();
      renderRoot();
      if(elMenu) elMenu.classList.remove('hidden');
    }catch(e){}
  }
  function closeMenu(){
    try{ if(elMenu) elMenu.classList.add('hidden'); }catch(e){}
  }

  // ================= увімк/вимк =================
  function applyEnabledVisual(){
    try{
      if(elBtn) elBtn.style.display = (window.TRACES.enabled && !mqttUnavailable) ? '' : 'none';
      if(!window.TRACES.enabled){
        closeMenu();
        if(elClaim) elClaim.style.display='none';
        try{ if(layer) map.removeLayer(layer); }catch(e){}
      } else {
        try{ if(layer && !map.hasLayer(layer)) layer.addTo(map); }catch(e){}
      }
    }catch(e){}
  }

  // ================= публічний контракт =================
  window.TRACES = window.TRACES || {};
  window.TRACES.enabled = true;

  window.TRACES.init = function(){
    try{
      if(window.__tracesInited) return;
      window.__tracesInited = true;

      var onPref = null;
      try{ onPref = localStorage.getItem(LS_ON); }catch(e){}
      window.TRACES.enabled = (onPref===null) ? true : (onPref==='1' || onPref==='true');

      mineMap = loadMine();
      claimedSet = loadClaimed();

      ensureDom();
      applyEnabledVisual();
    }catch(e){}
  };

  window.TRACES.step = function(dt){
    try{
      ensureConnected();
      if(!window.TRACES.enabled){ if(elClaim) elClaim.style.display='none'; return; }
      if(typeof phase==='undefined' || phase!=='play'){ if(elClaim) elClaim.style.display='none'; return; }
      var d = (typeof dt==='number' && dt>0 && dt<1) ? dt : 0.016;
      proxAccum += d;
      if(proxAccum >= PROX_EVERY_S){
        proxAccum = 0;
        checkProximity();
        pruneOwnExpired();
        pruneForeignExpired();
      }
    }catch(e){}
  };

  window.TRACES.setEnabled = function(v){
    try{
      var val = !!v;
      window.TRACES.enabled = val;
      try{ localStorage.setItem(LS_ON, val ? '1' : '0'); }catch(e){}
      if(!val){
        closeMenu();
        disconnectMqtt();
      } else {
        mqttUnavailable=false; // дає тумблеру відновити фічу після мережевого збою
      }
      applyEnabledVisual();
      if(val) ensureConnected();
    }catch(e){}
  };

  window.TRACES.leaveMenu = function(){ closeMenu(); };
})();


// ============================================================
// ⚙️ НАЛАШТУВАННЯ + ПАУЗА (SETTINGS) — v0.6
// Вставляється ІНЛАЙН у той самий <script>, що й гра. Бачить глобали
// (phase, lastT, roadsOnly, toast, updateHUD) і модулі (window.FM/fmToggle,
// window.TRACES, window.SAVE). Нічого не переоголошує.
// Контракт: window.SETTINGS = { init, open, close, isPaused }
// Також вводить window.MUTED (гра сама перевіряє його у speakLines/bell).
// ============================================================
(function(){
  'use strict';

  var LS_MUTED = 'kotik_muted';
  var panel=null, body=null, prevPhase='play', paused=false, confirmWipe=false;

  function on(v){ return v ? ' on' : ''; }

  function setMuted(v){
    try{ window.MUTED = !!v; localStorage.setItem(LS_MUTED, v ? '1':'0');
      if(v){
        try{ if(typeof speechSynthesis!=='undefined') speechSynthesis.cancel(); }catch(e){}
        try{ if(typeof stopRadio==='function') stopRadio(); }catch(e){}
      }
    }catch(e){ window.MUTED = !!v; }
  }

  function render(){
    try{
      if(!body) return;
      var fmOn = !!(window.FM && window.FM.on);
      var trOn = !!(window.TRACES && window.TRACES.enabled);
      var muted = !!window.MUTED;
      var roads = (typeof roadsOnly!=='undefined') ? !!roadsOnly : true;
      var s = (window.SAVE && window.SAVE.stats) ? window.SAVE.stats() : {totalKm:0,totalEarned:0,sessions:0,money:0};
      var rows = [];
      rows.push('<button class="cta sec'+on(!muted)+'" data-a="sound">'+(muted?'🔇 Звук: вимкнено':'🔊 Звук: увімкнено')+'</button>');
      rows.push('<button class="cta sec'+on(fmOn)+'" data-a="fm">📻 Оболонь FM: '+(fmOn?'увімк':'вимк')+'</button>');
      rows.push('<button class="cta sec'+on(trOn)+'" data-a="traces">🐾 Сліди сусідів: '+(trOn?'увімк':'вимк')+'</button>');
      rows.push('<button class="cta sec'+on(roads)+'" data-a="roads">'+(roads?'🛣️ Рух: лише по дорогах':'🗺️ Рух: будь-де')+'</button>');
      rows.push('<div class="legend" style="margin-top:10px;">'+
        '<b>Твій район у цифрах</b><br>'+
        '💵 Гаманець: '+Math.round(s.money)+' грн<br>'+
        '🛞 Пробіг: '+(s.totalKm||0).toFixed(1)+' км<br>'+
        '📦 Усього зароблено: '+Math.round(s.totalEarned||0)+' грн<br>'+
        '🚗 Поїздок: '+(s.sessions||0)+'</div>');
      rows.push('<button class="cta sec" data-a="profile">🏅 Профіль водія</button>');
      if(confirmWipe){
        rows.push('<div class="legend" style="margin-top:10px;color:#a33;"><b>Точно почати заново?</b> Це зітре весь прогрес.</div>');
        rows.push('<div class="row"><button class="cta" data-a="wipeYes" style="background:#d93a34;color:#fff;">Так, стерти</button>'+
          '<button class="cta sec" data-a="wipeNo">Ні</button></div>');
      } else {
        rows.push('<button class="cta sec" data-a="wipe" style="margin-top:10px;color:#a33;">🗑 Почати заново</button>');
      }
      body.innerHTML = rows.join('');
      var btns = body.querySelectorAll('[data-a]');
      for(var i=0;i<btns.length;i++){ btns[i].addEventListener('click', onAction); }
    }catch(e){}
  }

  function onAction(e){
    try{
      var a = e.currentTarget.getAttribute('data-a');
      if(a==='sound'){ setMuted(!window.MUTED); }
      else if(a==='fm'){ if(typeof fmToggle==='function') fmToggle(); else if(window.FM&&window.FM.toggle) window.FM.toggle(); }
      else if(a==='traces'){ if(window.TRACES&&window.TRACES.setEnabled) window.TRACES.setEnabled(!window.TRACES.enabled); }
      else if(a==='roads'){ var b=document.getElementById('modeBtn'); if(b) b.click(); else if(typeof roadsOnly!=='undefined') roadsOnly=!roadsOnly; }
      else if(a==='profile'){ close(); if(window.PROGRESSION && window.PROGRESSION.openPanel) window.PROGRESSION.openPanel(); }
      else if(a==='wipe'){ confirmWipe=true; }
      else if(a==='wipeYes'){ confirmWipe=false; if(window.SAVE&&window.SAVE.wipe) window.SAVE.wipe(); }
      else if(a==='wipeNo'){ confirmWipe=false; }
      render();
    }catch(e2){}
  }

  function ensureDom(){
    try{
      var btn = document.getElementById('settingsBtn');
      if(!btn){
        btn = document.createElement('button');
        btn.className='act'; btn.id='settingsBtn'; btn.title='Налаштування';
        btn.innerHTML='⚙️<small>МЕНЮ</small>';
        var actions=document.getElementById('actions');
        if(actions) actions.appendChild(btn); else document.body.appendChild(btn);
        btn.addEventListener('click', open);
      }
      panel = document.getElementById('setPanel');
      if(!panel){
        panel = document.createElement('div');
        panel.id='setPanel'; panel.className='overlay hidden';
        panel.innerHTML =
          '<div class="card">'+
            '<div class="paw">⚙️</div>'+
            '<h1>Пауза й налаштування</h1>'+
            '<div id="setBody"></div>'+
            '<button class="cta" id="setResume" style="margin-top:12px;">▶ Продовжити</button>'+
          '</div>';
        document.body.appendChild(panel);
        panel.addEventListener('click', function(ev){ if(ev.target===panel) close(); });
        var r=document.getElementById('setResume'); if(r) r.addEventListener('click', close);
      }
      body = document.getElementById('setBody');
    }catch(e){}
  }

  function open(){
    try{
      ensureDom(); confirmWipe=false;
      if(typeof phase!=='undefined' && phase==='play'){ prevPhase='play'; phase='pause'; paused=true; }
      else { prevPhase = (typeof phase!=='undefined') ? phase : 'play'; }
      render();
      if(panel) panel.classList.remove('hidden');
    }catch(e){}
  }
  function close(){
    try{
      if(panel) panel.classList.add('hidden');
      if(paused && prevPhase==='play'){ phase='play'; try{ lastT = performance.now(); }catch(e){} }
      paused=false;
    }catch(e){}
  }

  function init(){
    try{
      var m=null; try{ m=localStorage.getItem(LS_MUTED); }catch(e){}
      window.MUTED = (m==='1');
      ensureDom();
    }catch(e){}
  }

  window.SETTINGS = { init:init, open:open, close:close, isPaused:function(){ return paused; } };
})();



// ================= 🚦 ПДР-ЯДРО v0.7 (POLICE/LIGHTS/SPEED/PEDS/SIGNS/AUDIO) =================

// ============================================================
// 🐕‍🦺 ПАТРУЛЬ + ШТРАФИ (POLICE) — v0.7
// Вставляється ІНЛАЙН у той самий <script>, що й гра (index.html).
// Бачить глобали (money, phase, toast, speakLines, updateHUD) і модулі
// (window.MUTED, window.SAVE.save(), window.FM.event()) — і НІЧОГО з
// них не перевизначає. Присвоєння money=… тут міняє саме ту `let
// money`, що й решта гри, бо модуль живе в тому самому <script>.
//
// Викликають цей модуль майбутні механіки (світлофори/швидкість/
// пішоходи): window.POLICE.fine('red_light') тощо.
//
// Контракт: window.POLICE = { init, fine, total }
// (+ bare fine/POLICE: window.fine === POLICE.fine, а бare `POLICE` —
//  звичайна властивість глобального об'єкта, тому доступна і без
//  префікса `window.` з будь-якого іншого top-level коду сторінки.)
//
// Тон світу (docs/UNIVERSE.md, §2 і §8): інспектор — ВВІЧЛИВИЙ пес.
// Він не соромить і не карає заради кари — цитує пункт ПДР і зичить
// гарної дороги. «Дорога — це повага», а не покарання.
//
// Дані: data/pdr_rules.json, схема { ruleId: {no,text,fine} }.
// init() робить fetch; якщо він не вдався (offline/404/старий
// браузер) — працює інлайн-фолбек нижче (FALLBACK_RULES), гра
// ніколи не падає і завжди має що показати. Фолбек підмінюється
// «на льоту»: щойно fetch довантажить дані, наступні виклики fine()
// вже читають актуальний текст/суму з файлу (по кожному ruleId
// окремо — часткові дані теж ок).
//
// Усе в try/catch. Без зовнішніх бібліотек.
// ============================================================
(function(){
  'use strict';

  var RULES_URL   = 'data/pdr_rules.json';
  var LS_KEY       = 'kotik_fines';   // {count, sum} — статистика штрафів
  var COOLDOWN_MS  = 8000;             // не частіше ніж раз на ~8с той самий ruleId

  // ---------- інлайн-фолбек (кілька правил, щоб працювало завжди) ----------
  // Синхронізовано з data/pdr_rules.json (той самий текст/суми), щоб
  // офлайн-гравець і той, у кого fetch спрацював, бачили однакове —
  // це саме фолбек на випадок відсутньої мережі, а не окремий контент.
  var FALLBACK_RULES = {
    red_light:  { no:'8.7.3 “е”; 8.10',       text:'Червоний сигнал світлофора забороняє рух — водій має зупинитися перед стоп-лінією чи знаком, а не їхати далі.', fine:350 },
    speeding:   { no:'12.4',                   text:'У населеному пункті дозволена швидкість — не більше 50 км/год, перевищувати не можна.',                       fine:250 },
    pedestrian: { no:'18.1',                   text:'Наближаючись до нерегульованого пішохідного переходу з пішоходами, водій повинен знизити швидкість або зупинитися й дати їм дорогу.', fine:300 },
    seatbelt:   { no:'2.3 “в”',                text:'Водій зобов’язаний бути пристебнутим ременем безпеки і не возити пасажирів, які не пристебнуті.',             fine:150 },
    stop_sign:  { no:'Додаток 1, знак 2.2',    text:'Знак «Проїзд без зупинки заборонено» вимагає зупинитися перед стоп-лінією (або самим знаком) і пропустити транспорт на перетинній дорозі.', fine:200 }
  };

  var rules = null;        // {ruleId:{no,text,fine}} з fetch (може бути частковим/відсутнім)
  var lastFineAt = {};     // ruleId -> timestamp останнього штрафу (кулдаун)
  var stats = { count:0, sum:0 };

  // ---------- localStorage: лічильник штрафів (для панелі статистики) ----------
  function loadStats(){
    try{
      var raw = localStorage.getItem(LS_KEY);
      if(!raw) return;
      var obj = JSON.parse(raw);
      if(obj && typeof obj.count === 'number' && typeof obj.sum === 'number'){
        stats.count = obj.count; stats.sum = obj.sum;
      }
    }catch(e){ /* приватний режим / битий JSON — просто граємо з нуля */ }
  }
  function saveStats(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(stats)); }catch(e){}
  }

  // ---------- дані правил ----------
  function loadRules(){
    try{
      fetch(RULES_URL).then(function(r){
        if(!r || !r.ok) throw new Error('http '+(r&&r.status));
        return r.json();
      }).then(function(json){
        if(json && typeof json === 'object') rules = json;
      }).catch(function(){ /* лишаємось на FALLBACK_RULES */ });
    }catch(e){ /* fetch недоступний узагалі — фолбек і без цього спрацює */ }
  }

  function ruleFor(ruleId){
    if(rules && rules[ruleId]) return rules[ruleId];
    return FALLBACK_RULES[ruleId] || null;
  }

  // ---------- головна точка входу ----------
  // window.POLICE.fine(ruleId, key) — викликають модулі світлофорів/швидкості/
  // пішоходів при порушенні. key (необов'язковий) робить кулдаун per-instance —
  // напр. окремий світлофор чи перехід, щоб два різних реальних порушення
  // того самого типу за COOLDOWN_MS не гасили одне одного. Повертає true,
  // якщо штраф застосовано, false — якщо ruleId невідомий або спрацював кулдаун.
  function fine(ruleId, key){
    try{
      if(!ruleId) return false;
      // під час паузи/меню/заправки штрафи не нараховуємо (як fmStep)
      if(typeof phase !== 'undefined' && phase !== 'play') return false;

      var rule = ruleFor(ruleId);
      if(!rule) return false; // невідомий ruleId — тихо ігноруємо, гра не падає

      var cdKey = ruleId + (key!=null ? (':'+key) : '');
      var now = Date.now();
      var last = lastFineAt[cdKey] || 0;
      if(now - last < COOLDOWN_MS) return false; // кулдаун — не спамимо тим самим штрафом
      lastFineAt[cdKey] = now;

      var amount = Math.max(0, Number(rule.fine) || 0);
      try{
        if(typeof money === 'number'){ money = Math.max(0, money - amount); }
      }catch(e){}

      stats.count += 1; stats.sum += amount;
      saveStats();

      var msg = '🐕‍🦺 Інспектор: '+rule.text+' (ПДР '+rule.no+'). Штраф −'+amount+' грн. Гарної дороги!';
      try{ if(typeof toast === 'function') toast(msg); }catch(e){}

      try{ window.SFX && window.SFX.play('siren'); }catch(e){}

      try{
        if(!window.MUTED && typeof speakLines === 'function'){
          speakLines(['Інспектор дорожнього руху.', rule.text+'.', 'Штраф '+amount+' гривень.', 'Гарної дороги!']);
        }
      }catch(e){}

      try{ window.SAVE && window.SAVE.save && window.SAVE.save(); }catch(e){}
      try{ if(typeof updateHUD === 'function') updateHUD(); }catch(e){}
      try{ window.FM && window.FM.event && window.FM.event('fine'); }catch(e){}
      try{ window.PROGRESSION && window.PROGRESSION.event && window.PROGRESSION.event('fine'); }catch(e){}

      return true;
    }catch(e){ return false; }
  }

  // window.POLICE.total() -> {count, sum} — для панелі статистики
  function total(){
    return { count: stats.count, sum: stats.sum };
  }

  function init(){
    try{ loadStats(); }catch(e){}
    try{ loadRules(); }catch(e){}
  }

  window.POLICE = { init:init, fine:fine, total:total };
  window.fine = fine; // bare-контракт: зручний виклик з модулів світлофорів/швидкості/пішоходів
})();


// ============================================================
// «Світлофори» — справжні перехрестя Оболоні оживають (v0.7)
// Для «Котик за кермом». Вставляється ІНЛАЙН у той самий класичний
// <script>, що й основна гра — бачить її глобали й нічого з них не
// перевизначає:
//   map (Leaflet), car{x,y,heading,speed}, phase ('play' під час їзди),
//   toXY(lat,lng), fromXY(x,y), dist(aLat,aLng,bLat,bLng) → м,
//   toast(msg), updateHUD(), window.POLICE (.fine('red_light')),
//   window.MUTED, ac(), bell(freq,t0,dur,vol)
//
// Дані: data/pdr.json → { lights:[[lat,lng], ...] (~40 перехресть),
//   crossings:[...], limits:{...} }. Якщо fetch не вдався — тихий
// фолбек: гра просто їде без світлофорів (жодного toast/помилки).
//
// Що робить модуль:
//   - малює кожен світлофор як L.divIcon (кольоровий кружечок
//     🟢/🟡/🔴 за поточною фазою) і додає на карту в init();
//   - спільний за задумом, але зсунутий за індексом цикл фаз:
//     зелений ~14с → жовтий ~3с → червоний ~14с. Зсув на світлофор
//     розподілений рівномірно по всьому періоду, щоб перехрестя не
//     блимали синхронно, як один величезний світлофор;
//   - у step(dt) шукає найближчий до котика світлофор і, якщо той
//     близько (<14 м), у стані «червоний» (або «жовтий» на швидкості
//     >25) і котик їде швидше 12 км/год — фіксує проїзд на червоне:
//     POLICE.fine('red_light') + коротке бібікання (bell, якщо не
//     MUTED). Per-light кулдаун (довший за фазу «червоний») гарантує,
//     що один проїзд не оштрафує двічі — навіть якщо всередині
//     POLICE.fine() свого кулдауну раптом нема.
//   - рендер (перефарбовування кружечків) не частіше ніж раз на
//     ~0.3с; сканування відстані — щокадру (40 точок — це дешево).
//
// Контракт:
//   window.LIGHTS.init()    — одноразово при завантаженні (fetch
//                              pdr.json, малює маркери; тихий фолбек)
//   window.LIGHTS.step(dt)  — виклик щокадру із step(dt) під час
//                              phase==='play'
// ============================================================
(function(){
  'use strict';

  // ---------- тайминг фаз (сек) ----------
  var GREEN_S  = 14;
  var YELLOW_S = 3;
  var RED_S    = 14;
  var PERIOD_S = GREEN_S + YELLOW_S + RED_S; // 31

  // ---------- детекція проїзду на червоне ----------
  var TRIGGER_R      = 14;   // м — «на перехресті»
  var MIN_VIOLATE_KMH = 12;  // км/год — нижче цього не штрафуємо (майже стоїть)
  var YELLOW_RISK_KMH = 25;  // км/год — на жовтому штрафуємо тільки на такій швидкості
  var FINE_COOLDOWN_S = 18;  // > RED_S, щоб один проїзд на червоне не дав два штрафи

  // ---------- рендер ----------
  var RENDER_EVERY_S = 0.3;
  var EMOJI = { green:'🟢', yellow:'🟡', red:'🔴' };

  var lights = [];          // [{lat,lng,offset,marker,el,lastColor,lastFineClock}]
  var clock = 0;            // власний ігровий годинник модуля (йде лише під час step)
  var renderAccum = 0;
  var startedLoad = false;
  var ready = false;        // true, коли маркери вже намальовані

  // ---------- стилі кружечків (інжектимо самі, index.html не чіпаємо) ----------
  function injectStyles(){
    try{
      if(document.getElementById('lightsStyles')) return;
      var css = '.lightDot{width:22px;height:22px;display:flex;align-items:center;'+
        'justify-content:center;font-size:15px;line-height:1;pointer-events:none;'+
        'box-shadow:0 2px 4px rgba(0,0,0,.4);}';
      var styleEl = document.createElement('style');
      styleEl.id = 'lightsStyles';
      styleEl.textContent = css;
      document.head.appendChild(styleEl);
    }catch(e){}
  }

  // ---------- фаза світлофора у момент часу t (з власним зсувом) ----------
  function stateAt(offsetS, t){
    var x = (t + offsetS) % PERIOD_S;
    if(x < 0) x += PERIOD_S;
    if(x < GREEN_S) return 'green';
    if(x < GREEN_S + YELLOW_S) return 'yellow';
    return 'red';
  }

  function makeIcon(){
    return L.divIcon({ className:'', iconSize:[22,22], iconAnchor:[11,11],
      html:'<div class="lightDot">🟢</div>' });
  }

  function buildLights(raw){
    if(!Array.isArray(raw) || !raw.length) return; // тихий фолбек: нема даних — нема світлофорів
    injectStyles();
    var n = raw.length;
    for(var i=0;i<n;i++){
      var pt = raw[i];
      if(!pt || pt.length < 2) continue;
      var lat = +pt[0], lng = +pt[1];
      if(!isFinite(lat) || !isFinite(lng)) continue;

      var offset = (i * PERIOD_S / n) % PERIOD_S; // рівномірний зсув фази за індексом

      var marker = null, el = null;
      try{
        marker = L.marker([lat,lng], { icon:makeIcon(), interactive:false, keyboard:false }).addTo(map);
        var rootEl = marker.getElement ? marker.getElement() : null;
        el = rootEl ? rootEl.querySelector('.lightDot') : null;
      }catch(e){ continue; }

      // G1: кешуємо XY одразу — step() рахує пеленг «світлофор попереду авто»
      // без повторних перетворень щокадру.
      var xy = null;
      try{ xy = toXY(lat,lng); }catch(e){}

      lights.push({
        lat:lat, lng:lng, x: xy?xy.x:0, y: xy?xy.y:0, offset:offset,
        marker:marker, el:el,
        lastColor:'green',
        lastFineClock:-1e9
      });
    }
    ready = lights.length > 0;
    if(ready) renderAll(clock); // одразу коректні кольори, не чекаючи першого throttle-тіку
  }

  function renderAll(t){
    for(var i=0;i<lights.length;i++){
      var lt = lights[i];
      var st = stateAt(lt.offset, t);
      if(st === lt.lastColor) continue;
      lt.lastColor = st;
      if(lt.el) lt.el.textContent = EMOJI[st];
    }
  }

  function beepViolation(){
    try{
      if(window.MUTED) return;
      var t = ac().currentTime;
      bell(300, t, 0.09, 0.22);
      bell(210, t + 0.1, 0.13, 0.2);
    }catch(e){}
  }

  // ================= публічний контракт =================
  function init(){
    try{
      if(startedLoad) return;
      startedLoad = true;
      fetch('data/pdr.json').then(function(r){
        if(!r || !r.ok) throw new Error('pdr.json: bad response');
        return r.json();
      }).then(function(j){
        try{ buildLights(j && j.lights); }catch(e){}
      }).catch(function(){
        // тихий фолбек — просто немає світлофорів, гра їде далі
      });
    }catch(e){
      // тихий фолбек
    }
  }

  function step(dt){
    try{
      if(!ready || !lights.length) return;
      // step() і так викликається лише під час phase==='play' (гейт у tick()),
      // але дублюємо перевірку — так само, як TRACES.step — про всяк випадок.
      if(typeof phase !== 'undefined' && phase !== 'play') return;
      if(typeof dt !== 'number' || !isFinite(dt) || dt <= 0) return;

      clock += dt;
      renderAccum += dt;
      if(renderAccum >= RENDER_EVERY_S){
        renderAccum = 0;
        try{ renderAll(clock); }catch(e){}
      }

      var p = fromXY(car.x, car.y);
      var nearestIdx = -1, nearestD = Infinity;
      for(var i=0;i<lights.length;i++){
        var Lg = lights[i];
        var d = dist(p.lat, p.lng, Lg.lat, Lg.lng);
        if(d < nearestD){ nearestD = d; nearestIdx = i; }
      }
      if(nearestIdx < 0) return;

      if(nearestD < TRIGGER_R){
        var target = lights[nearestIdx];
        var st = stateAt(target.offset, clock);
        var speedKmh = Math.abs(car.speed);
        var violating = (st === 'red') || (st === 'yellow' && speedKmh > YELLOW_RISK_KMH);
        // G1: карати лише якщо ЦЕЙ світлофор попереду за курсом авто (±60°) —
        // інакше штрафуємо за світлофор на перпендикулярній/сусідній вулиці.
        var ahead = true;
        try{
          var ang = Math.atan2(target.x - car.x, target.y - car.y);
          var diff = ((ang - car.heading + Math.PI) % (2*Math.PI)) - Math.PI;
          ahead = Math.abs(diff) < 1.05;
        }catch(e){ ahead = true; }
        if(violating && ahead && speedKmh > MIN_VIOLATE_KMH && (clock - target.lastFineClock) > FINE_COOLDOWN_S){
          target.lastFineClock = clock;
          try{ window.POLICE && window.POLICE.fine && window.POLICE.fine('red_light', nearestIdx); }catch(e){}
          beepViolation();
        }
      }
    }catch(e){}
  }

  window.LIGHTS = { init:init, step:step };
})();


// ============================================================
// 🚓 SPEED — обмеження швидкості + контроль перевищення
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий
// класичний <script>, що й основна гра — бачить її глобали
// (CFG, car{x,y,speed}, phase, nearestRoad(x,y,name)→{svc,name,...},
// toast, updateHUD, window.POLICE, window.MUTED, dist, fromXY) і
// нічого з них тут не перевизначає.
//
// ПДР України: у населеному пункті — 50 км/год; у житловій/дворовій
// зоні — 20 км/год (п. 3.29 «Обмеження максимальної швидкості» —
// логіка гри: якщо найближча дорога під авто службова/двір (svc===1) →
// ліміт 20, інакше — 50). Тон — docs/UNIVERSE.md: дорога тут повага,
// а не заборона, тож попередження м'яке, цитатою ліміту, без сорому.
//
// Контракт:
//   window.SPEED.init()   — одноразова ініціалізація (створює знак
//                            #speedLimit у #hud; викликати один раз
//                            після завантаження гри, коли DOM готовий)
//   window.SPEED.step(dt) — виклик щокадру із step(dt): визначає
//                            поточний ліміт (згладжено), оновлює HUD-
//                            знак і рахує неперервне перевищення
//   window.SPEED.limit()  — поточний підтверджений ліміт (число,
//                            20 або 50) — можна читати з інших модулів
// ============================================================
(function(){
  'use strict';

  // ---------- налаштування ----------
  var DEFAULT_LIMIT    = 50;   // старт: населений пункт, поки нема даних про дорогу під авто
  var SPD_CONFIRM_SEC  = 0.5;  // скільки секунд новий "сирий" ліміт має протриматись поспіль,
                                // щоб замінити підтверджений — анти-мигтіння на межі двір/вулиця
  var SPD_TOLERANCE    = 10;   // км/год толеранс понад ліміт, перш ніж це вважається перевищенням
  var SPD_WARN_SEC     = 2.0;  // секунд неперервного перевищення до першого попередження (toast)
  var SPD_FINE_GAP_SEC = 2.0;  // ще стільки ж — до штрафу; далі, поки триває, чек-ін у POLICE
                                // раз на SPD_FINE_GAP_SEC (сам POLICE вирішує, штрафувати чи ні —
                                // у нього свій кулдаун, тут ми лише не спамимо викликами щокадру)
  var SPD_HUD_THROTTLE = 0.5;  // не частіше разу на ~0.5с переписувати текст у знаку (крім змін —
                                // ті показуються одразу, throttle лише прибирає зайві DOM-записи)

  // ---------- внутрішній стан (усе з префіксом spd, щоб нічого не перетнути) ----------
  var spdLimit        = DEFAULT_LIMIT; // підтверджений (згладжений) ліміт — те, що бачить гравець
  var spdPendingLimit = DEFAULT_LIMIT; // "сирий" ліміт, визначений на поточному кадрі
  var spdPendingT     = 0;             // скільки часу поспіль тримається spdPendingLimit

  var spdOverT   = 0;     // секунд поспіль |car.speed| > spdLimit + SPD_TOLERANCE
  var spdWarned  = false; // перше попередження цього епізоду перевищення вже показане
  var spdFined   = false; // штрафна позначка цього епізоду вже спрацювала (перший чек-ін зроблено)
  var spdFineAcc = 0;     // акумулятор для періодичних чек-інів у POLICE.fine після spdFined

  var spdHudAcc  = 0;     // акумулятор для throttle HUD-рендеру
  var spdLastTxt = null;  // останній записаний у DOM текст знаку (щоб не писати те саме дарма)

  var elSign = null;
  var spdInited = false;

  // ---------- DOM / стилі ----------
  function injectStyles(){
    try{
      if(document.getElementById('speedStyles')) return;
      var css =
        '#speedLimit{width:34px;height:34px;border-radius:50%;background:#fff;' +
          'border:4px solid var(--red,#d93a34);color:#141414;font-weight:900;font-size:14px;' +
          'font-family:inherit;letter-spacing:-.4px;line-height:1;' +
          'display:flex;align-items:center;justify-content:center;' +
          'box-shadow:0 3px 10px rgba(0,0,0,.3);flex:0 0 auto;align-self:center;}';
      var styleEl = document.createElement('style');
      styleEl.id = 'speedStyles';
      styleEl.textContent = css;
      document.head.appendChild(styleEl);
    }catch(e){ /* без стилю знак все одно з'явиться, лише не оформлений */ }
  }
  function ensureDom(){
    injectStyles();
    elSign = document.getElementById('speedLimit');
    if(!elSign){
      elSign = document.createElement('div');
      elSign.id = 'speedLimit';
      elSign.title = 'Обмеження швидкості';
      elSign.textContent = String(DEFAULT_LIMIT);
      spdLastTxt = String(DEFAULT_LIMIT);
      var hud = document.getElementById('hud');
      if(hud) hud.appendChild(elSign); else document.body.appendChild(elSign);
    }
  }
  function renderSign(){
    try{
      if(!elSign) return;
      var txt = String(spdLimit);
      if(txt !== spdLastTxt){ elSign.textContent = txt; spdLastTxt = txt; }
    }catch(e){}
  }

  // ---------- визначення ліміту під авто ----------
  // Дворова/службова дорога (svc===1) → 20 км/год; будь-яка інша → 50 км/год.
  // Перф: не викликає nearestRoad() сам (те саме вже рахує step() раз за кадр) —
  // натомість читає кеш window.lastRoadHit, який step() виставляє щокадру.
  function rawLimitAt(x, y){
    try{
      if(typeof roadsOnly !== 'undefined' && !roadsOnly) return 50; // вільний режим — завжди «місто»
      var r = (typeof lastRoadHit !== 'undefined') ? lastRoadHit : null;
      if(!r) return null; // дороги ще не завантажені / авто поза сіткою — тримаємось попереднього ліміту
      return r.svc ? 20 : 50;
    }catch(e){ return null; }
  }
  function updateLimit(dt){
    try{
      if(typeof car === 'undefined' || !car) return;
      var raw = rawLimitAt(car.x, car.y);
      if(raw == null) return; // немає свіжих даних цього кадру — не чіпаємо ні pending, ні підтверджений ліміт

      if(raw === spdPendingLimit) spdPendingT += dt;
      else { spdPendingLimit = raw; spdPendingT = 0; }

      // застосовуємо новий ліміт лише після того, як він "устоявся" SPD_CONFIRM_SEC поспіль —
      // це і є згладжування, яке не дає знаку мигтіти на межі двір/вулиця
      if(spdPendingT >= SPD_CONFIRM_SEC && spdLimit !== spdPendingLimit) spdLimit = spdPendingLimit;
    }catch(e){}
  }
  function updateHud(dt){
    try{
      spdHudAcc += (typeof dt === 'number' && dt > 0) ? dt : 0;
      var changed = String(spdLimit) !== spdLastTxt;
      if(changed || spdHudAcc >= SPD_HUD_THROTTLE){
        renderSign();
        spdHudAcc = 0;
      }
    }catch(e){}
  }

  // ---------- контроль перевищення ----------
  function resetOverspeedTimers(){
    spdOverT = 0; spdWarned = false; spdFined = false; spdFineAcc = 0;
  }
  function updateEnforcement(dt){
    try{
      if(typeof car === 'undefined' || !car) return;
      var speed = Math.abs(typeof car.speed === 'number' ? car.speed : 0);
      var threshold = spdLimit + SPD_TOLERANCE;

      if(speed <= threshold){
        if(spdOverT !== 0 || spdWarned || spdFined) resetOverspeedTimers(); // швидкість у нормі — скидаємо таймери
        return;
      }

      spdOverT += (typeof dt === 'number' && dt > 0) ? dt : 0;

      if(!spdWarned && spdOverT >= SPD_WARN_SEC){
        spdWarned = true;
        try{ if(typeof toast === 'function') toast('🚗 Перевищення! Ліміт ' + spdLimit); }catch(e){}
      }

      var fineAt = SPD_WARN_SEC + SPD_FINE_GAP_SEC; // ще ~2с після попередження → перший штраф
      if(spdWarned && !spdFined && spdOverT >= fineAt){
        spdFined = true; spdFineAcc = 0;
        try{ window.POLICE && window.POLICE.fine && window.POLICE.fine('speeding'); }catch(e){}
      } else if(spdFined){
        // водій і далі перевищує — не спамимо POLICE щокадру, чекінимось раз на SPD_FINE_GAP_SEC;
        // сам POLICE вирішує (свій кулдаун), чи це справді новий штраф
        spdFineAcc += (typeof dt === 'number' && dt > 0) ? dt : 0;
        if(spdFineAcc >= SPD_FINE_GAP_SEC){
          spdFineAcc = 0;
          try{ window.POLICE && window.POLICE.fine && window.POLICE.fine('speeding'); }catch(e){}
        }
      }
    }catch(e){}
  }

  // ================= КОНТРАКТ =================
  function spdInit(){
    try{
      if(spdInited) return;
      spdInited = true;
      spdLimit = DEFAULT_LIMIT; spdPendingLimit = DEFAULT_LIMIT; spdPendingT = 0;
      resetOverspeedTimers();
      ensureDom();
      renderSign();
    }catch(e){ /* ніколи не ламаємо завантаження гри */ }
  }
  function spdStep(dt){
    try{
      if(!spdInited) ensureDom(); // захист: якщо step() викликали без init() — знак все одно з'явиться
      if(typeof phase !== 'undefined' && phase !== 'play') return; // поза грою (меню/пауза/заправка) — не рахуємо
      var d = (typeof dt === 'number' && dt > 0 && dt < 1) ? dt : 0.016;
      updateLimit(d);
      updateHud(d);
      updateEnforcement(d);
    }catch(e){ /* ніколи не ламаємо ігровий цикл */ }
  }
  function spdLimitGetter(){ return spdLimit; }

  window.SPEED = { init: spdInit, step: spdStep, limit: spdLimitGetter };
})();


// ================= ПІШОХОДИ НА ПЕРЕХОДАХ (v0.7, PEDS) =================
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий класичний
// <script>, що й основна гра (ANOTHER inline module, той самий патерн, що й
// window.TRACES / window.FM / window.SETTINGS) — бачить її глобали й НІЧОГО
// з них не перевизначає:
//   map (Leaflet), L (глобал бібліотеки Leaflet, з якої зроблено map),
//   car{x,y,heading,speed,...} (speed — км/год, може бути від'ємна заднім ходом,
//     тому скрізь беремо Math.abs(car.speed)),
//   phase (let-змінна; 'play' під час активної їзди — НЕ функція),
//   toXY(lat,lng)->{x,y} / fromXY(x,y)->{lat,lng} (локальна рівнокутна
//     проєкція в метрах навколо ORG — та сама, що штовхає car.x/car.y),
//   dist(aLat,aLng,bLat,bLng) -> метри (map.distance, Leaflet-хаверсин),
//   toast(msg), window.POLICE (може ще не існувати — викликаємо захисно),
//   window.MUTED, ac() (AudioContext-хелпер) + bell(freq,t0,dur,vol)
//     (bell потребує t0 у годиннику AudioContext, тому без ac() його
//     коректно не викликати — цей самий тандем ac()+bell використовують
//     TRACES.playHorn() і FM-модуль, тож він так само вважається "своїм"
//     глобалом гри, хоч у ТЗ не перелічений явно).
//
// Рух авто в грі — компасна конвенція (0 рад = північ/+y, зростання —
// за годинниковою стрілкою до +x): car.x += d*sin(heading); car.y += d*cos(heading).
// Тут скрізь використовується та сама формула для будь-яких напрямків.
//
// Ідея: тримаємо МАЛО (≤3) активних пішоходів біля авто. Коли з'являється
// порожній перехід поблизу курсу авто — з невеликим шансом на ньому "оживає"
// пішохід (маркер 🚶), повільно переходить дорогу впоперек напрямку руху
// авто (як проксі "найближчої дороги" — легка симуляція без роутингу) і
// зникає. Якщо авто мчить повз активного пішохода занадто швидко й близько —
// штраф (через window.POLICE, якщо є) і м'який тост-нагадування. Якщо
// пригальмувало поряд — пішохід тихо дякує (зрідка).
//
// Дані: data/pdr.json -> { crossings:[[lat,lng], ...] (~95), lights:[...] }.
// Використовуємо лише crossings. Якщо fetch не вдався або формат неочікуваний —
// м'який фолбек: PEDS просто нічого не робить (гра лишається грою без пішоходів).
//
// Контракт:
//   window.PEDS.init()   — одноразово при завантаженні: fetch('data/pdr.json'),
//                          готує список переходів. Мережевий виклик, нічого
//                          не блокує; при помилці — тихий фолбек (без пішоходів).
//   window.PEDS.step(dt) — виклик щокадру (як window.TRACES.step(dt)) під час
//                          phase==='play'. Сам собі рано виходить, якщо
//                          phase!=='play' або дані ще не завантажились.
//
// Продуктивність: активних пішоходів ≤3; повний прохід по ~95 переходах —
// не щокадру, а throttle раз на ~0.3с; усе обгорнуто в try/catch, щоб збій
// цього модуля ніколи не заважав основному ігровому цоклу.
// ============================================================
window.PEDS = (function(){
  'use strict';

  // ---------- налаштування (легко підкрутити під плейтест) ----------
  var ACTIVE_MAX          = 3;      // максимум активних пішоходів одночасно
  var SCAN_INTERVAL_S     = 0.3;    // throttle скану переходів, сек
  var ACTIVATE_RADIUS_M   = 90;     // "попереду/поряд" — радіус активації, м
  var MIN_SPAWN_DIST_M    = 35;     // не спавнити пішохода ближче ніж це до авто (щоб не зʼявлявся впритул)
  var DESPAWN_RADIUS_M    = 150;    // прибираємо маркер, якщо авто відʼїхало далі, м
  var FINE_GRACE_S        = 1;      // сек після спавну — не штрафуємо (пішохід ще "нереальний" для гравця)
  var BEHIND_TOLERANCE_M  = -20;    // проєкція на напрям авто; менше — перехід явно "позаду", пропускаємо
  var SPAWN_CHANCE_TICK   = 0.15;   // шанс "оживити" придатний перехід за один tick скану
  var RESPAWN_COOLDOWN_MS = 9000;   // кулдаун переходу після того, як пішохід зник (щоб не миготіло)
  var CROSS_DUR_MIN_S     = 3.5;    // тривалість переходу дороги пішоходом, сек
  var CROSS_DUR_MAX_S     = 5.5;
  var CROSS_HALFW_MIN_M   = 3.2;    // половина ширини "переходу" впоперек дороги, м
  var CROSS_HALFW_MAX_M   = 4.6;

  var FINE_SPEED_KMH      = 20;     // швидкість, вище якої "не пропускаєш"
  var FINE_DIST_M         = 15;     // на такій відстані від переходу це вже порушення
  var THANK_SPEED_KMH     = 10;     // якщо авто повільніше — вважаємо, що гальмуєш і пропускаєш
  var THANK_DIST_M        = 20;     // трохи ширше коло для "дякую", ніж для штрафу
  var THANK_TOAST_CHANCE  = 0.25;   // тост "дякую" — зрідка, щоб не набридало

  // ---------- стан модуля ----------
  var crossings = [];   // [{id,lat,lng,x,y,ped:null|obj,cooldownUntil:0}]
  var active = [];      // активні пішоходи: посилання на ped-обʼєкти
  var scanAccum = 0;    // акумулятор часу для throttle скану
  var ready = false;    // дані завантажено успішно (хоч би 0 переходів — все одно ready)

  // ---------- ініціалізація даних ----------
  function init(){
    try{
      if(typeof fetch !== 'function') return; // немає fetch — тихий фолбек, без пішоходів
      fetch('data/pdr.json').then(function(r){
        if(!r || !r.ok) throw new Error('pdr.json http');
        return r.json();
      }).then(function(d){
        try{
          var list = (d && Array.isArray(d.crossings)) ? d.crossings : [];
          var out = [];
          for(var i=0;i<list.length;i++){
            var c = list[i];
            if(!c || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
            var lat = c[0], lng = c[1];
            var xy;
            try{ xy = toXY(lat,lng); }catch(e){ continue; }
            out.push({ id:i, lat:lat, lng:lng, x:xy.x, y:xy.y, ped:null, cooldownUntil:0 });
          }
          crossings = out;
          ready = true;
        }catch(e){ crossings = []; ready = true; }
      }).catch(function(){ crossings = []; ready = true; }); // фолбек: без пішоходів, гра йде далі
    }catch(e){ crossings = []; ready = true; }
  }

  // ---------- звук "дякую" (тихий, як TRACES.playHorn) ----------
  function playThanks(){
    try{
      if(window.MUTED) return;
      if(typeof ac !== 'function' || typeof bell !== 'function') return;
      var t0 = ac().currentTime;
      bell(880,  t0,      0.12, 0.10);
      bell(1175, t0+0.09, 0.16, 0.10);
    }catch(e){ /* звук не критичний */ }
  }

  // ---------- маркер пішохода (повністю inline-стилі, без зовн. CSS/бібліотек) ----------
  function makeIcon(){
    return L.divIcon({
      className: '',
      iconSize: [24,24],
      iconAnchor: [12,12],
      html: '<div style="display:flex;align-items:center;justify-content:center;'
          + 'width:22px;height:22px;border-radius:50%;background:#ffd23f;'
          + 'border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.35);'
          + 'font-size:13px;line-height:1">🚶</div>'
    });
  }

  // ---------- спроба "оживити" пішохода на переході ----------
  function spawnPed(c){
    if(active.length >= ACTIVE_MAX) return;
    if(c.ped) return;
    var heading = (car && typeof car.heading === 'number') ? car.heading : 0;
    var perp = heading + Math.PI/2; // впоперек напрямку руху авто (проксі "нормалі дороги")
    var half = CROSS_HALFW_MIN_M + Math.random()*(CROSS_HALFW_MAX_M-CROSS_HALFW_MIN_M);
    var dur  = CROSS_DUR_MIN_S + Math.random()*(CROSS_DUR_MAX_S-CROSS_DUR_MIN_S);
    var sign = Math.random() < 0.5 ? -1 : 1;
    var mk;
    try{ mk = L.marker([c.lat, c.lng], { icon: makeIcon(), interactive:false }).addTo(map); }
    catch(e){ return; }
    var ped = {
      crossing: c, marker: mk, t: 0, age: 0, dur: dur, half: half, sign: sign, perp: perp,
      fined: false, thanked: false, lat: c.lat, lng: c.lng
    };
    c.ped = ped;
    active.push(ped);
  }

  function removePed(ped){
    try{ if(ped.marker) map.removeLayer(ped.marker); }catch(e){}
    if(ped.crossing){
      ped.crossing.ped = null;
      ped.crossing.cooldownUntil = Date.now() + RESPAWN_COOLDOWN_MS;
    }
    var idx = active.indexOf(ped);
    if(idx >= 0) active.splice(idx,1);
  }

  // позиція пішохода: лінійна інтерполяція (зі згладжуванням) впоперек дороги,
  // від одного краю переходу до іншого, через точку самого переходу (t=dur/2)
  function updatePedPosition(ped){
    var k = ped.dur > 0 ? Math.min(1, ped.t/ped.dur) : 1;
    k = k*k*(3-2*k); // легкий smoothstep — не "важка симуляція", просто плавніше
    var off = ped.sign * ped.half * (2*k - 1); // -half..+half
    var dx = Math.sin(ped.perp), dy = Math.cos(ped.perp); // та сама компасна конвенція, що й у car.x/y
    var x = ped.crossing.x + dx*off;
    var y = ped.crossing.y + dy*off;
    try{
      var p = fromXY(x,y);
      ped.marker.setLatLng([p.lat, p.lng]);
      ped.x = x; ped.y = y; ped.lat = p.lat; ped.lng = p.lng; // G2(в): жива позиція — для дистанції штрафу
    }catch(e){ /* якщо не вийшло — маркер лишиться на попередній позиції цього кадру */ }
  }

  // ---------- правило проїзду: штраф за "не пропускаєш" / тихе "дякую" ----------
  function checkCarInteraction(ped, carLat, carLng, dCarToCrossing){
    var speed = (car && typeof car.speed === 'number') ? car.speed : 0;
    var absSpeed = Math.abs(speed);

    if(!ped.fined && ped.age > FINE_GRACE_S && absSpeed > FINE_SPEED_KMH && dCarToCrossing < FINE_DIST_M){
      ped.fined = true;
      try{ toast('🚶 Пропускай пішохода!'); }catch(e){}
      try{ window.POLICE && window.POLICE.fine && window.POLICE.fine('pedestrian', ped.crossing && ped.crossing.id); }catch(e){}
      return;
    }
    if(!ped.thanked && absSpeed < THANK_SPEED_KMH && dCarToCrossing < THANK_DIST_M){
      ped.thanked = true;
      if(Math.random() < THANK_TOAST_CHANCE){
        try{ toast('🚶 Дякую, що пропускаєш!'); }catch(e){}
      }
      playThanks();
    }
  }

  // ---------- throttled-скан переходів на предмет "оживлення" ----------
  function scanForSpawn(carX, carY, carP){
    if(active.length >= ACTIVE_MAX) return;
    var heading = (car && typeof car.heading === 'number') ? car.heading : 0;
    var hx = Math.sin(heading), hy = Math.cos(heading); // одиничний напрям руху авто (компасна конвенція)
    var now = Date.now();
    for(var i=0; i<crossings.length; i++){
      if(active.length >= ACTIVE_MAX) break;
      var c = crossings[i];
      if(c.ped) continue;
      if(c.cooldownUntil && now < c.cooldownUntil) continue;

      // дешевий фільтр "не позаду авто" через локальні XY (ті самі метри, що й toXY/fromXY)
      var proj = (c.x-carX)*hx + (c.y-carY)*hy;
      if(proj < BEHIND_TOLERANCE_M) continue;

      var d;
      try{ d = dist(carP.lat, carP.lng, c.lat, c.lng); }catch(e){ continue; }
      if(d > ACTIVATE_RADIUS_M || d < MIN_SPAWN_DIST_M) continue;

      if(Math.random() < SPAWN_CHANCE_TICK) spawnPed(c);
    }
  }

  // ---------- головний тик (кожен кадр під час phase==='play') ----------
  function step(dt){
    try{
      if(typeof phase === 'undefined' || phase !== 'play') return;
      if(!ready || !crossings.length) return;
      if(typeof car === 'undefined' || typeof map === 'undefined') return;
      if(typeof dt !== 'number' || dt <= 0) return;

      var carP;
      try{ carP = fromXY(car.x, car.y); }catch(e){ return; }

      scanAccum += dt;
      if(scanAccum >= SCAN_INTERVAL_S){
        scanAccum = 0;
        try{ scanForSpawn(car.x, car.y, carP); }catch(e){}
      }

      for(var i=active.length-1; i>=0; i--){
        var ped = active[i];
        ped.t += dt; ped.age += dt;
        try{ updatePedPosition(ped); }catch(e){}

        // G2(в): дистанція — від живої позиції пішохода (updatePedPosition щойно
        // оновила ped.lat/ped.lng), а не від фіксованої точки переходу.
        var d = Infinity;
        try{ d = dist(carP.lat, carP.lng, (typeof ped.lat==='number'?ped.lat:ped.crossing.lat), (typeof ped.lng==='number'?ped.lng:ped.crossing.lng)); }catch(e){}

        // прибираємо далекі/завершені маркери, щоб не накопичувались
        if(ped.t >= ped.dur || d > DESPAWN_RADIUS_M){
          removePed(ped);
          continue;
        }
        try{ checkCarInteraction(ped, carP.lat, carP.lng, d); }catch(e){}
      }
    }catch(e){ /* PEDS ніколи не має зламати основний ігровий цикл */ }
  }

  return { init: init, step: step };
})();


// ============================================================
// 🚸 ДОРОЖНІ ЗНАКИ — НАВЧАЛЬНИЙ ШАР (SIGNS) — v0.7
// Вставляється ІНЛАЙН у той самий <script>, що й гра «Котик за кермом»
// (index.html). Бачить глобали лексично (той самий <script>-блок, звичайний,
// не type=module): map (Leaflet), car, phase, toXY, fromXY, dist, toast,
// LANDMARKS, stations, churchMarks, money, updateHUD. НІЧОГО з цього не
// переоголошує — лише читає/мутує (money, phase — так само, як це вже
// роблять модулі TRACES/SETTINGS/fuel-панель у цьому файлі).
//
// Що робить: кладе на карту 8 маркерів-бейджів реальних дорожніх знаків
// ПДР України (коди й офіційні назви звірені з каталогом
// KotikPDR/Data/SignsData.swift — той самий каталог, який пройшов скіл
// pdr-sign-audit для застосунку «Котик ПДР»). Тап по бейджу → картка-оверлей
// (перевикористані класи .overlay/.card/.cta/.paw/.hidden з index.html)
// з назвою, кодом і поясненням. Перший тап на кожен ОКРЕМИЙ знак дає
// разовий бонус навчання (+10 грн, тост), повторний тап — лише картка,
// без бонуса. Прогрес «вивчених» знаків зберігається в
// localStorage['kotik_signs_seen'] (масив кодів) і переживає перезавантаження.
//
// ЧЕСНІСТЬ ЛОКАЦІЙ: там, де знак прив'язаний до конкретного реального
// об'єкта (метро, проспект, храм, АЗС) — координати взяті з наявних у грі
// LANDMARKS / data/pois.json (реальні точки Оболоні). Там, де знак означає
// загальний режим (житлова зона, заборона зупинки біля ТРЦ) — координата
// підібрана вручну в межах bbox Оболоні як ЛОГІЧНЕ, а не GPS-звірене місце
// встановлення конкретного стовпа. Точність, яка тут КРИТИЧНА і перевірена —
// це код знака, офіційна назва і зміст пункту ПДР, а не точна GPS-точка стовпа.
//
// Контракт: window.SIGNS = { init }
// ============================================================
(function(){
  'use strict';

  var LS_SEEN = 'kotik_signs_seen';
  var BONUS = 10;

  // ---- Каталог знаків (код/назва/зміст — за чинним ПДР України) ----
  // group керує лише кольором бейджа (не є частиною офіційних даних):
  //   warn=попереджувальні, prio=пріоритету, proh=заборонні,
  //   info=інформаційно-вказівні, serv=сервісу.
  var SIGN_DATA = [
    { code:'1.32', name:'Пішохідний перехід', group:'warn', shape:'tri', badge:'🚶',
      lat:50.50130, lng:30.49830, near:'біля метро «Оболонь»',
      text:'Попереджувальний знак: попереду — нерегульований пішохідний перехід. Скинь швидкість заздалегідь і будь готовий/готова пропустити пішоходів.' },
    { code:'5.38.1', name:'Пішохідний перехід', group:'info', shape:'circ', badge:'🚸',
      lat:50.51220, lng:30.49850, near:'біля метро «Мінська»',
      text:'Інформаційно-вказівний знак: позначає саме місце нерегульованого пішохідного переходу. Тут пішохід має перевагу — зупинись і дай пройти.' },
    { code:'3.29', name:'Обмеження максимальної швидкості', group:'proh', shape:'circ', badge:'50',
      lat:50.50650, lng:30.49950, near:'на Оболонському проспекті',
      text:'Заборонний знак: рухатися швидше за вказане число не можна. Тут — не більше 50 км/год, навіть якщо дорога здається порожньою.' },
    { code:'2.1', name:'Дати дорогу', group:'prio', shape:'triDown', badge:'▽',
      lat:50.51150, lng:30.51600, near:'на в’їзді до Оболонської набережної',
      text:'Знак пріоритету: перед перехрестям треба дати дорогу транспорту, що рухається дорогою, яку ти перетинаєш. Спочатку пропусти — потім їдь.' },
    { code:'2.3', name:'Головна дорога', group:'prio', shape:'diamond', badge:'◆',
      lat:50.51212, lng:30.51242, near:'біля Свято-Покровського храму',
      text:'Знак пріоритету: ти на головній дорозі — маєш перевагу проїзду на найближчих нерегульованих перехрестях.' },
    { code:'6.7.1', name:'Автозаправні станції', group:'serv', shape:'circ', badge:'⛽',
      lat:50.50700, lng:30.48300, near:'перед АЗС ОККО',
      text:'Знак сервісу: попереду — автозаправна станція. Гарний момент зазирнути, якщо бак підводить.' },
    { code:'5.34', name:'Житлова зона', group:'info', shape:'circ', badge:'🏠',
      lat:50.51000, lng:30.50800, near:'на типовому в’їзді у двір панельок',
      text:'Інформаційно-вказівний знак: тут діє особливий режим — не більше 20 км/год, і пішохід завжди головний. У дворі — повільно й ніжно.' },
    { code:'3.34', name:'Зупинку заборонено', group:'proh', shape:'circ', badge:'⛔',
      lat:50.52300, lng:30.49750, near:'біля ТРЦ Dream Town',
      text:'Заборонний знак: тут не можна ні зупинятись, ні стояти — навіть на хвилинку. Висади чи забери пасажира трохи далі.' }
  ];

  var markers = [];
  var seen = null;               // Set<string> кодів, що вже дали бонус
  var elOverlay=null, elPaw=null, elTitle=null, elCode=null, elText=null, elOk=null;
  var prevPhase='play', pausedByUs=false;

  // ---- безпечні обгортки ----
  function toastSafe(msg){ try{ if(typeof toast==='function') toast(msg); }catch(e){} }
  function hudSafe(){ try{ if(typeof updateHUD==='function') updateHUD(); }catch(e){} }

  // ---- localStorage: «вивчені» знаки ----
  function loadSeen(){
    var out=new Set();
    try{
      var raw=localStorage.getItem(LS_SEEN);
      if(raw){ var arr=JSON.parse(raw); if(Array.isArray(arr)) arr.forEach(function(c){ out.add(String(c)); }); }
    }catch(e){}
    return out;
  }
  function saveSeen(){
    try{ localStorage.setItem(LS_SEEN, JSON.stringify(Array.from(seen))); }catch(e){}
  }
  function isSeen(code){ try{ return !!seen && seen.has(code); }catch(e){ return false; } }
  function markSeen(code){ try{ if(seen){ seen.add(code); saveSeen(); } }catch(e){} }

  // ---- стилі (інжектуються самим модулем, index.html не редагується) ----
  function injectStyles(){
    try{
      if(document.getElementById('signsStyles')) return;
      var css =
        '.sign-badge{width:26px;height:26px;display:flex;align-items:center;justify-content:center;'+
          'font-size:12px;font-weight:800;line-height:1;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.35);'+
          'border-radius:50%;background:#fff;}'+
        '.sign-badge.tri{border-radius:5px;clip-path:polygon(50% 6%,4% 96%,96% 96%);padding-top:6px;box-shadow:none;}'+
        '.sign-badge.triDown{border-radius:5px;clip-path:polygon(4% 4%,96% 4%,50% 94%);padding-bottom:6px;box-shadow:none;}'+
        '.sign-badge.diamond{border-radius:4px;transform:rotate(45deg);}'+
        '.sign-badge.diamond span{transform:rotate(-45deg);display:block;}'+
        '.sign-badge.g-warn{background:#fff8dc;border:2px solid #e8442e;color:#8a2110;}'+
        '.sign-badge.g-proh{background:#fff;border:2px solid #e8442e;color:#c0271f;}'+
        '.sign-badge.g-prio{background:#fff;border:2px solid #e0a112;color:#8a5c05;}'+
        '.sign-badge.g-info{background:#eaf2ff;border:2px solid #2b6fd4;color:#1c4e99;}'+
        '.sign-badge.g-serv{background:#eafff2;border:2px solid #1a7a4f;color:#0e5c39;}'+
        '.sign-badge.seen{opacity:.8;filter:saturate(.85);}';
      var styleEl=document.createElement('style');
      styleEl.id='signsStyles';
      styleEl.textContent=css;
      document.head.appendChild(styleEl);
    }catch(e){}
  }

  // ---- DOM картки-оверлея (створюється один раз, лінива ініціалізація) ----
  function ensureDom(){
    try{
      elOverlay=document.getElementById('signsOverlay');
      if(!elOverlay){
        elOverlay=document.createElement('div');
        elOverlay.id='signsOverlay';
        elOverlay.className='overlay hidden';
        elOverlay.innerHTML =
          '<div class="card">'+
            '<div class="paw" id="signsPaw">🚦</div>'+
            '<h1 id="signsTitle">—</h1>'+
            '<p id="signsCode" style="color:#999;font-size:12px;margin:-8px 0 8px;">—</p>'+
            '<p id="signsText">—</p>'+
            '<button class="cta" id="signsOk">Зрозуміло ✅</button>'+
          '</div>';
        document.body.appendChild(elOverlay);
        elOverlay.addEventListener('click', function(e){ if(e.target===elOverlay) closeCard(); });
      }
      elPaw=document.getElementById('signsPaw');
      elTitle=document.getElementById('signsTitle');
      elCode=document.getElementById('signsCode');
      elText=document.getElementById('signsText');
      elOk=document.getElementById('signsOk');
      if(elOk && !elOk.__wired){ elOk.__wired=true; elOk.addEventListener('click', closeCard); }
    }catch(e){}
  }

  // ---- відкрити/закрити картку ----
  function openCard(sign){
    try{
      ensureDom();
      if(elPaw) elPaw.textContent=sign.badge || '🚦';
      if(elTitle) elTitle.textContent=sign.name;
      if(elCode) elCode.textContent='Знак '+sign.code+' · '+sign.near;
      if(elText) elText.textContent=sign.text;

      var firstTime=!isSeen(sign.code);
      if(firstTime){
        markSeen(sign.code);
        try{ if(typeof money==='number'){ money+=BONUS; hudSafe(); } }catch(e){}
        try{ window.SFX&&window.SFX.play('cash'); }catch(e){}
        toastSafe('+'+BONUS+' грн за вивчений знак 🎓 '+sign.code);
        try{ window.PROGRESSION && window.PROGRESSION.event('sign_learned'); }catch(e){}
      }

      // ставимо гру на паузу на час читання картки (як фуел-панель/налаштування)
      try{
        if(typeof phase!=='undefined' && phase==='play'){ prevPhase='play'; phase='signs'; pausedByUs=true; }
        else { pausedByUs=false; }
      }catch(e){ pausedByUs=false; }

      if(elOverlay) elOverlay.classList.remove('hidden');
    }catch(e){}
  }
  function closeCard(){
    try{
      if(elOverlay) elOverlay.classList.add('hidden');
      try{
        if(pausedByUs && typeof phase!=='undefined' && phase==='signs'){
          phase='play'; try{ lastT=performance.now(); }catch(e2){}
        }
      }catch(e){}
      pausedByUs=false;
    }catch(e){}
  }

  // ---- маркер-бейдж для одного знака ----
  function signIcon(sign){
    var cls='sign-badge g-'+sign.group+(sign.shape==='tri'?' tri':(sign.shape==='triDown'?' triDown':(sign.shape==='diamond'?' diamond':'')))+
             (isSeen(sign.code)?' seen':'');
    var html='<div class="'+cls+'" data-code="'+sign.code+'"><span>'+sign.badge+'</span></div>';
    return L.divIcon({ className:'', iconSize:[26,26], iconAnchor:[13,13], html:html });
  }

  function addMarkers(){
    try{
      if(typeof map==='undefined' || !map || typeof L==='undefined') return;
      SIGN_DATA.forEach(function(sign){
        try{
          var mk=L.marker([sign.lat,sign.lng], {icon:signIcon(sign), title:sign.code+' '+sign.name}).addTo(map);
          mk.on('click', function(){
            try{
              if(typeof phase!=='undefined' && phase!=='play') return; // не лізти поверх іншого оверлея
              openCard(sign);
            }catch(e){}
          });
          markers.push({sign:sign, mk:mk});
        }catch(e){}
      });
    }catch(e){}
  }

  // ---- публічний контракт ----
  window.SIGNS = window.SIGNS || {};
  window.SIGNS.init = function(){
    try{
      if(window.__signsInited) return;
      window.__signsInited=true;
      seen=loadSeen();
      injectStyles();
      ensureDom();
      addMarkers();
    }catch(e){}
  };
})();


// ============================================================
// 🔊 ДВИГУН МУРКОЧЕ (AUDIO) — v0.7, WebAudio, без зовнішніх бібліотек
// ------------------------------------------------------------
// Канон (docs/UNIVERSE.md, §4 «Звуковий пейзаж»): «...муркотіння двигуна
// (так, двигун у цьому світі муркоче)» — тепле, тихе, не набридливе,
// а не рев чи гуркіт.
//
// Бачить глобали гри й нічого з них не переоголошує:
//   car   { speed, rpm, mode, engineRunning, ... }  — стан авто
//   phase                                            — 'menu' | 'play' | 'pause' | ...
//   ac()                                             — спільний AudioContext (lazy, з auto-resume)
//   window.MUTED                                     — глобальний прапорець «звук вимкнено»
//
// Дизайн:
// - Один граф на весь час життя сторінки: 2 осцилятори (sawtooth, злегка
//   рознесені по detune) → lowpass-фільтр (тепло/приглушено) → engineGain
//   → destination. Осцилятори СТАРТУЮТЬ РІВНО ОДИН РАЗ (buildGraph),
//   далі лише змінюються їхні frequency/detune/gain — жодного накопичення
//   вузлів чи повторних .start().
// - «Муркотіння» = повільне вібрато (детюн ±неск. центів, ~4.5 Гц) на пітчі
//   + легке тремоло гучності (~6.5 Гц) навколо базового gain. Обидва —
//   окремі LFO, підключені як модулятори до AudioParam (сумуються з
//   .value, який виставляється у step()), а не пересоздаються щокадру.
// - Базова частота: у 'manual' — від car.rpm (idle..redline), інакше
//   (автомат) — від car.speed (0..CFG.maxSpeed). Значення idle/redline/
//   maxSpeed продубльовані тут локально (RPM_IDLE/RPM_REDLINE/SPEED_MAX),
//   щоб модуль лишався самодостатнім і не залежав від внутрішніх ENG/CFG
//   гри — якщо ці числа в грі зміняться, звук просто трохи розʼїдеться
//   з тахометром, але не зламається.
// - Гучність навмисно тиха: 0.03..0.07 (+ до ~10% тремоло), щоб муркотіння
//   не набридало і не заважало диктору/радіо/дзвонам.
// - AudioContext НЕ створюється і граф НЕ будується до першого виклику
//   step() у фазі 'play' (де вже точно був жест гравця — старт гри є
//   кліком/тапом). init() лише готує внутрішній стан модуля, без побудови
//   аудіографа і без звернень до ac().
// - window.MUTED глушить МИТТЄВО (без плавної інтерполяції): за один
//   виклик step() гучність падає в 0, а не «стигне» через кілька кадрів.
//   Коли двигун заглух або гра не в фазі 'play' — гучність теж іде до 0,
//   але плавно (щоб не клацало), окремою (швидшою) інтерполяцією.
//
// Контракт: window.AUDIO = { init, step }
// ============================================================
(function(){
  'use strict';

  // ---- локальні «дзеркала» ігрових діапазонів (нічого зовнішнього не займають) ----
  var RPM_IDLE    = 800;   // ~ ENG.idle в грі
  var RPM_REDLINE = 6000;  // ~ ENG.redline в грі
  var SPEED_MAX   = 58;    // ~ CFG.maxSpeed в грі (км/год)

  var FREQ_MIN = 55,  FREQ_MAX = 130;   // Гц, базовий тон муркотіння (низько й тепло)
  var GAIN_MIN = 0.03, GAIN_MAX = 0.07; // тихо: ледь чутне мурчання → трохи виразніше на обертах

  var GAIN_RATE_UP   = 3.2;  // 1/с, швидкість наближення гучності/частоти до цілі під час руху
  var GAIN_RATE_DOWN = 6.0;  // 1/с, швидкість плавного затихання (двигун вимкнено / не 'play')
  var FREQ_RATE      = 3.5;  // 1/с, швидкість інтерполяції частоти

  var TREMOLO_HZ    = 6.5;   // «муркотливе» тремоло гучності
  var TREMOLO_DEPTH  = 0.10; // частка від поточного gain
  var VIBRATO_HZ     = 4.5;  // повільне вібрато пітчу
  var VIBRATO_CENTS  = 8;    // глибина вібрато в центах

  // ---- внутрішній стан ----
  var built       = false;  // граф уже побудований і осцилятори запущені
  var unsupported = false;  // WebAudio недоступний / створення графа провалилось — більше не пробуємо
  var curFreq     = FREQ_MIN;
  var curGain     = 0;

  var osc1, osc2, vibLfo, vibGain, tremLfo, tremDepth, filter, mixGain, engineGain;

  function clamp01(x){ return x<0?0:(x>1?1:x); }

  // Побудова аудіографа. Викликається щонайбільше один раз (guard через built/unsupported),
  // і лише зсередини step(), коли phase==='play' — тобто вже точно після жесту гравця.
  function buildGraph(){
    try{
      var a = ac();

      osc1 = a.createOscillator(); osc1.type = 'sawtooth';
      osc2 = a.createOscillator(); osc2.type = 'sawtooth'; osc2.detune.value = 6; // легкий розстрій для густоти

      vibLfo  = a.createOscillator(); vibLfo.type = 'sine'; vibLfo.frequency.value = VIBRATO_HZ;
      vibGain = a.createGain(); vibGain.gain.value = VIBRATO_CENTS; // глибина в центах

      tremLfo   = a.createOscillator(); tremLfo.type = 'sine'; tremLfo.frequency.value = TREMOLO_HZ;
      tremDepth = a.createGain(); tremDepth.gain.value = 0; // оновлюється щокадру в step()

      filter = a.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 0.4;
      filter.frequency.value = FREQ_MIN * 2.6 + 60;

      mixGain    = a.createGain(); mixGain.gain.value = 0.5; // сума двох осциляторів, щоб не клипало
      engineGain = a.createGain(); engineGain.gain.value = 0; // стартуємо в тиші

      osc1.connect(mixGain); osc2.connect(mixGain);
      mixGain.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(a.destination);

      vibLfo.connect(vibGain);
      vibGain.connect(osc1.detune);
      vibGain.connect(osc2.detune);

      tremLfo.connect(tremDepth);
      tremDepth.connect(engineGain.gain); // додається до engineGain.gain.value, який виставляємо в step()

      osc1.frequency.value = curFreq;
      osc2.frequency.value = curFreq;

      osc1.start(); osc2.start(); vibLfo.start(); tremLfo.start();

      built = true;
    }catch(e){
      built = false;
      unsupported = true; // WebAudio недоступний у цьому середовищі — більше не пробуємо щокадру
    }
  }

  // Цільові частота/гучність муркотіння для поточного стану авто.
  // 'manual' → від car.rpm (idle..redline); інакше (автомат) → від car.speed (0..maxSpeed).
  function computeTarget(){
    var t;
    if(car.mode === 'manual'){
      var rpm = car.rpm || 0;
      t = clamp01((rpm - RPM_IDLE) / (RPM_REDLINE - RPM_IDLE));
    } else {
      var spd = Math.abs(car.speed || 0);
      t = clamp01(spd / SPEED_MAX);
    }
    return {
      freq: FREQ_MIN + (FREQ_MAX - FREQ_MIN) * t,
      gain: GAIN_MIN + (GAIN_MAX - GAIN_MIN) * t
    };
  }

  // init(): лише готує стан модуля. НІЧОГО не створює в WebAudio і НЕ звертається до ac() —
  // граф і осцилятори будуються лізі, зсередини step(), коли гра вже в фазі 'play'
  // (тобто вже точно після жесту гравця, наприклад кліку «Поїхали»/«Завести»).
  function init(){
    try{
      built = false;
      unsupported = false;
      curFreq = FREQ_MIN;
      curGain = 0;
    }catch(e){}
  }

  // step(dt): викликати щокадру (dt у секундах), незалежно від того, чи phase==='play' —
  // саме так модуль може плавно приглушити муркотіння, коли гра ставиться на паузу
  // чи повертається в меню, а не «застрягти» на останній гучності.
  function step(dt){
    try{
      if(typeof car === 'undefined' || !car || typeof phase === 'undefined') return;
      dt = (typeof dt === 'number' && isFinite(dt) && dt > 0) ? Math.min(dt, 0.1) : 0;

      // window.MUTED глушить МИТТЄВО — без плавної інтерполяції.
      if(window.MUTED){
        curGain = 0;
        if(built){ engineGain.gain.value = 0; tremDepth.gain.value = 0; }
        return;
      }

      var playing = (phase === 'play');

      // Ще ніколи не грали (граф не побудований) і зараз не в грі — робити нічого,
      // AudioContext і осцилятори не створюємо завчасно (без жесту гравця).
      if(!playing && !built) return;

      if(playing && !built && !unsupported) buildGraph();
      if(!built) return; // WebAudio недоступний у цьому браузері — тихо виходимо

      ac(); // сам ac() резюмить AudioContext, якщо він 'suspended' (напр. після сну вкладки)

      var running = playing && !!car.engineRunning;
      var target = running ? computeTarget() : { freq: curFreq, gain: 0 };
      var gainRate = running ? GAIN_RATE_UP : GAIN_RATE_DOWN;

      curGain += (target.gain - curGain) * Math.min(1, dt * gainRate);
      curFreq += (target.freq - curFreq) * Math.min(1, dt * FREQ_RATE);
      if(curGain < 0.0005) curGain = 0;

      osc1.frequency.value = curFreq;
      osc2.frequency.value = curFreq;
      filter.frequency.value = curFreq * 2.6 + 60; // трохи яскравіше на вищих обертах/швидкості

      engineGain.gain.value = curGain;
      tremDepth.gain.value = curGain * TREMOLO_DEPTH;
    }catch(e){
      // WebAudio недоступний / інша похибка середовища — гра просто лишається без муркотіння
    }
  }

  window.AUDIO = { init: init, step: step };
})();

// ============================================================
// 🔊 SFX — короткі діегетичні звуки подій (v0.8), WebAudio inline-модуль
// ------------------------------------------------------------
// Канон (docs/UNIVERSE.md):
//   §7.2 «Ремінь безпеки звучить як «клац» — і це найприємніший звук
//   у світі.» §2.3 «Тепло»: жодної різкості чи агресії — навіть штраф
//   від патруля подається м'яко, з повагою, не соромленням.
//
// Бачить глобали гри й нічого з них не переоголошує:
//   ac()            — спільний AudioContext (lazy, з auto-resume; index.html:529)
//   window.MUTED    — глобальний прапорець «звук вимкнено» (index.html:2452+)
//
// Дизайн:
// - SFX.play(name) щоразу будує СВІЙ короткий аудіограф (осцилятори і/або
//   шумовий сплеск → опційний фільтр → gain-envelope → destination) і
//   одразу планує коректний .stop() на кожному джерело-вузлі. Жоден вузол
//   не живе довше за сам звук: жодних постійних осциляторів, жодного
//   накопичення (на відміну від window.AUDIO — того «муркотіння двигуна»,
//   який навмисно тримає граф весь час гри; SFX — про одноразові події).
// - Усі звуки — 0.1–0.6с, помірна гучність (peak ≤ ~0.20 на голос),
//   щоб не набридали при частих подіях (доставки, повороти, знаки).
// - window.MUTED перевіряється ПЕРШИМ рядком play() — якщо звук вимкнено,
//   WebAudio-граф навіть не починає будуватись.
// - Усе в try/catch: WebAudio може бути недоступний (старий браузер,
//   обмежений iframe, залізо без звукової карти) — тоді SFX тихо не
//   робить нічого, гра не падає і в консоль нічого не летить.
//
// Контракт: window.SFX = { play(name), init() }
//   SFX.play(name), name ∈ {
//     'belt'          — «клац» ременя безпеки (дві швидкі транзієнти)
//     'blinker'       — «тік-так» поворотника (два м'які кліки-реле)
//     'cash'          — приємний «дзинь» заробітку (висхідне тризвуччя)
//     'engine_start'  — коротке низьке «врум» запуску двигуна
//     'signal_horn'   — дуже м'який ввічливий гудок-привітання
//     'siren'         — короткий делікатний сигнал патруля (для штрафу;
//                       свідомо НЕ різкий — це не вий, а м'яке «ду-ду»)
//     'chime'         — світлий мажорний акорд (успіх/досягнення/новий ранг)
//   }
//   Невідома назва або вимкнений звук — тихий no-op.
//
//   SFX.init() — необов'язковий «прогрів»: заздалегідь створює/резюмить
//   спільний AudioContext (варто викликати з жесту гравця, напр. на кліку
//   «Поїхали»/старті послідовності посадки), щоб перший реальний SFX.play()
//   не мав затримки на створення контексту. Якщо ніколи не викликати —
//   все одно все працює: ac() у першому play() створить контекст ліниво.
// ============================================================
(function(){
  'use strict';

  // ---- короткий тон: осцилятор → (опційно) біквад-фільтр → gain-envelope → dest ----
  // opts: { type, vol, attack, freqTo, filterType, filterFreq, filterQ }
  function tone(a, dest, freq, t0, dur, opts){
    opts = opts || {};
    var type   = opts.type   || 'sine';
    var vol    = opts.vol    != null ? opts.vol    : 0.12;
    var attack = opts.attack != null ? opts.attack : 0.008;

    var o = a.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t0);
    if(opts.freqTo != null){ o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqTo), t0 + dur); }

    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0005, vol), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    if(opts.filterType){
      var f = a.createBiquadFilter();
      f.type = opts.filterType;
      f.frequency.value = opts.filterFreq || 800;
      if(opts.filterQ != null) f.Q.value = opts.filterQ;
      o.connect(f); f.connect(g);
    } else {
      o.connect(g);
    }
    g.connect(dest);

    var stopAt = t0 + dur + 0.02;
    o.start(t0); o.stop(stopAt);
    return o;
  }

  // ---- короткий шумовий сплеск («клац»/«тік»): білий шум → bandpass → envelope ----
  // opts: { vol, filterType, filterFreq, filterQ }
  function click(a, dest, t0, dur, opts){
    opts = opts || {};
    var vol = opts.vol != null ? opts.vol : 0.15;

    var n = Math.max(1, Math.round(a.sampleRate * dur));
    var buf = a.createBuffer(1, n, a.sampleRate);
    var d = buf.getChannelData(0);
    for(var i = 0; i < n; i++){ d[i] = (Math.random() * 2 - 1) * (1 - i / n); } // лінійно затухаючий шум

    var src = a.createBufferSource();
    src.buffer = buf;

    var f = a.createBiquadFilter();
    f.type = opts.filterType || 'bandpass';
    f.frequency.value = opts.filterFreq || 2200;
    f.Q.value = opts.filterQ != null ? opts.filterQ : 1.2;

    var g = a.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);

    src.connect(f); f.connect(g); g.connect(dest);

    var stopAt = t0 + dur + 0.01;
    src.start(t0); src.stop(stopAt);
    return src;
  }

  // ---- рецепти звуків: name -> function(a) { ...будує граф на a.currentTime... } ----
  var PLAYERS = {

    // «клац» ременя — дві швидкі транзієнти впритул (замок + натяг), ~0.13с
    belt: function(a){
      var t0 = a.currentTime;
      click(a, a.destination, t0,        0.025, { vol: 0.20, filterFreq: 3200, filterQ: 2.4 });
      click(a, a.destination, t0 + 0.07, 0.06,  { vol: 0.14, filterFreq: 1400, filterQ: 1.3 });
    },

    // «тік-так» поворотника — два м'які кліки-реле з паузою, ~0.19с
    blinker: function(a){
      var t0 = a.currentTime;
      click(a, a.destination, t0,        0.025, { vol: 0.11, filterFreq: 1800, filterQ: 3 });
      click(a, a.destination, t0 + 0.16, 0.025, { vol: 0.11, filterFreq: 1500, filterQ: 3 });
    },

    // приємний «дзинь» заробітку — коротке висхідне тризвуччя дзвіночком, ~0.37с
    cash: function(a){
      var t0 = a.currentTime;
      [880, 1318.5, 1760].forEach(function(f, i){
        tone(a, a.destination, f, t0 + i * 0.045, 0.28, { type: 'triangle', vol: 0.10, attack: 0.004 });
      });
    },

    // коротке низьке «врум» запуску — приглушений пірнаючий саптус, ~0.33с
    engine_start: function(a){
      var t0 = a.currentTime;
      tone(a, a.destination, 90, t0, 0.32, {
        type: 'sawtooth', vol: 0.16, attack: 0.02, freqTo: 48,
        filterType: 'lowpass', filterFreq: 420, filterQ: 0.6
      });
      tone(a, a.destination, 60, t0 + 0.03, 0.24, {
        type: 'triangle', vol: 0.09, attack: 0.01, freqTo: 40,
        filterType: 'lowpass', filterFreq: 260, filterQ: 0.5
      });
    },

    // дуже м'який ввічливий гудок — короткий приглушений двотон, ~0.24с
    signal_horn: function(a){
      var t0 = a.currentTime;
      tone(a, a.destination, 330, t0, 0.22, {
        type: 'sine', vol: 0.13, attack: 0.02,
        filterType: 'lowpass', filterFreq: 1200, filterQ: 0.7
      });
      tone(a, a.destination, 262, t0 + 0.02, 0.22, {
        type: 'sine', vol: 0.10, attack: 0.02,
        filterType: 'lowpass', filterFreq: 1000, filterQ: 0.7
      });
    },

    // короткий делікатний сигнал патруля (для штрафу) — м'яке «ду-ду», НЕ вий, ~0.36с
    siren: function(a){
      var t0 = a.currentTime;
      tone(a, a.destination, 660, t0,        0.16, { type: 'sine', vol: 0.12, attack: 0.015 });
      tone(a, a.destination, 494, t0 + 0.18, 0.18, { type: 'sine', vol: 0.12, attack: 0.015 });
    },

    // світлий акорд — мажорне тризвуччя разом, тепло й дзвінко, ~0.50с
    chime: function(a){
      var t0 = a.currentTime;
      [523.25, 659.25, 784.0].forEach(function(f){
        tone(a, a.destination, f, t0, 0.5, { type: 'sine', vol: 0.09, attack: 0.01 });
      });
      tone(a, a.destination, 1046.5, t0 + 0.02, 0.45, { type: 'triangle', vol: 0.05, attack: 0.01 });
    }
  };

  // ---- публічний вхід ----
  function play(name){
    try{
      if(window.MUTED) return;               // ОБОВ'ЯЗКОВА перевірка — першим рядком
      var fn = PLAYERS[name];
      if(!fn) return;                          // невідома назва — тихо ігноруємо
      var a = ac();                            // спільний AudioContext гри (лениво створює/резюмить)
      if(!a) return;
      fn(a);
    }catch(e){ /* WebAudio недоступний або впав на цьому кроці — тихий no-op, гра не падає */ }
  }

  // ---- необов'язковий прогрів (див. контракт вище) ----
  function init(){
    try{
      if(!window.MUTED) ac();
    }catch(e){ /* тихо ігноруємо — перший play() спробує ще раз */ }
  }

  window.SFX = { play: play, init: init };
})();

// ============================================================
// 🌙 НІЧНІ ПАСАЖИРИ — «НІЧНА ЗМІНА» (PASSENGERS) — v0.8
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий
// класичний <script>, що й основна гра (той самий патерн, що й
// window.SIGNS / window.PEDS / window.LIGHTS — module IIFE в кінці файлу).
// Бачить глобали гри лексично й НІЧОГО з них не перевизначає:
//   map (Leaflet), L, car{x,y,heading,speed} (speed — км/год, може бути
//     від'ємна заднім ходом, тому Math.abs(car.speed)),
//   phase (let-змінна, не функція; 'play' під час активної їзди — тут
//     тимчасово ставимо 'ride' на час діалогу, як SIGNS ставить 'signs'),
//   money (let-змінна — тут += fareBonus напряму, як це вже роблять
//     checkJob()/visitChurch()/SIGNS),
//   toXY/fromXY (локальна рівнокутна проєкція в метрах навколо ORG),
//   dist(aLat,aLng,bLat,bLng) -> метри (map.distance, Leaflet-хаверсин),
//   toast(msg), speakLines([...]) -> bool (спробує TTS укр. голосом; сам
//     перевіряє window.MUTED і мовчки повертає false, якщо голосу нема),
//   updateHUD(), poiIcon (тут не використовуємо — свій маркер-бейдж,
//     повністю inline-стилі, як у PEDS/TRACES, щоб не чіпати CSS файлу),
//   esc(s) (HTML-екранування), window.MUTED, window.SAVE.addEarned,
//   window.LIVE.isNight, lastT (let-змінна — скидаємо при поверненні
//     у 'play', як це роблять SIGNS/SETTINGS, щоб dt не стрибнув).
//
// Ідея (докс/UNIVERSE.md, §8 «Куди світ росте»): вночі котик підробляє
// нічним таксі. Пасажир — коротка новела на 2-4 репліки з вибором тону
// (тепло/цікаво/тихо), яка завжди тепло завершується подякою і гривнями.
// Жодної токсичності, жодного поспіху — саме дух «тепла» з трьох стовпів
// всесвіту.
//
// Дані: fetch('data/passengers.json') -> { passengers:[ {id,name,
//   from:{name,lat,lng}, to:{name,lat,lng}, fareBonus, beats:[{say,
//   choices:[{t,tone,reply}]}], farewell} ] }. `to` наразі не
//   використовується логікою (посадка = одразу діалог, простіше і
//   надійніше за фізичне довезення) — читаємо його, але нічого не
//   ламаємо, якщо його нема. Якщо fetch не вдався/порожній/криво
//   зверстаний — тихий фолбек: один вбудований пасажир (нижче), гра
//   працює завжди, навіть офлайн.
//
// Поведінка:
//   - Лише вночі (window.LIVE.isNight) і лише під час phase==='play':
//     раз на ~60с ігрового часу (акумулятор dt, не setInterval) пропонує
//     випадкового ще не "звезеного" цієї сесії/тижня пасажира — маркер
//     🧍 на його from, toast.
//   - Коли авто близько до from (<25м) і майже стоїть (|speed|<8 км/год)
//     — "посадка": прибираємо маркер очікування, phase='ride' (щоб авто
//     не їхало під час діалогу), відкриваємо оверлей (.overlay/.card/.cta,
//     як fuelPanel/signsOverlay), показуємо beat.say + кнопки-варіанти.
//     Вибір -> показуємо reply, за ~1.2с -> наступний beat; після
//     останнього -> farewell, +fareBonus (money += ..., SAVE.addEarned),
//     toast, закриваємо оверлей, phase='play', lastT=performance.now().
//   - Возених пасажирів пам'ятаємо в localStorage['kotik_passengers']
//     (масив id). Коли провезли geniuinely всіх доступних — список
//     скидається сам (новий "тижневий" цикл), тому localStorage ніколи
//     не росте безмежно (розмір обмежений кількістю пасажирів у даних).
//
// Надійність: усе в try/catch; init() ідемпотентний (window.__...Inited
// guard); маркери завжди прибираються (clearOffer перед стартом поїздки,
// у finishRide про всяк випадок теж); throttle пропозицій — акумулятор,
// не щокадру; жодного setInterval; будь-який текст пасажира йде в
// innerHTML лише через esc(); звук лише якщо !MUTED (сам speakLines це
// перевіряє); оверлей використовує наявний .overlay (z-index 30) і
// відкривається лише коли доречно (після посадки).
//
// Контракт: window.PASSENGERS = { init, step }
// ============================================================
(function(){
  'use strict';

  var LS_KEY          = 'kotik_passengers'; // масив id вже "звезених" пасажирів
  var OFFER_INTERVAL_S = 60;   // не частіше разу на ~60с ігрового (нічного) часу
  var PICKUP_RADIUS_M  = 25;   // м — "авто біля пасажира"
  var STOPPED_KMH      = 8;    // км/год — "авто майже стоїть"
  var REPLY_DELAY_MS   = 1200; // пауза між reply і наступним beat

  // ---- вбудований фолбек: один нічний пасажир, щоб гра працювала завжди,
  // навіть без мережі/до того, як data/passengers.json зʼявиться на сервері.
  // (Той самий канонічний текст, що й у складеному контенті "Нічної зміни" —
  // нічний кур'єр Вітя, Богатирська/Тимошенка.)
  var FALLBACK_PASSENGERS = [
    {
      id: 'kuryer-vitia',
      name: 'Вітя',
      from: { name: "Дарк-кухня на Богатирській", lat: 50.5192, lng: 30.4976 },
      to:   { name: "Двір на Тимошенка", lat: 50.5138, lng: 30.4952 },
      fareBonus: 65,
      beats: [
        {
          say: "Дякую, що підібрав! У велосипеда ланцюг злетів просто на морозі, а руки вже не мої 🥶",
          choices: [
            { t: "Тут тепло, грійся.", tone: "warm", reply: "Дякую… о, вже відчуваю пальці. Це найкраща мить за всю зміну." },
            { t: "Скільки замовлень сьогодні?", tone: "curious", reply: "Дванадцять. Останнє — оця піца, яку я так і не довіз." },
            { t: "Просто вмикаю пічку.", tone: "quiet", reply: "…дякую. Іноді тиша краща за розмову." }
          ]
        },
        {
          say: "Знаєш, найгірше — не холод, а коли бачиш світло у вікні й розумієш, що там уже сплять.",
          choices: [
            { t: "Ти сам вибрав нічну зміну?", tone: "curious", reply: "Так, вдень плачу за універ. Уночі тихіше, і тариф кращий." },
            { t: "Це важка робота.", tone: "warm", reply: "Буває. Але коли хтось відчиняє двері з «дякую» — миттю тепліє." },
            { t: "…", tone: "quiet", reply: "Розумію мовчання. Не всі ночі про слова." }
          ]
        },
        {
          say: "О, це Богатирська! Тут узимку сніг до ранку ніхто не чистить — тільки котячі сліди лишаються.",
          choices: [
            { t: "Тримайся, доїдемо швидко.", tone: "warm", reply: "Дякую. З тобою якось спокійніше, навіть двірники не поспішають." },
            { t: "А новий велосипед купиш?", tone: "curious", reply: "Коплю потроху. Навіть чергу на заправці KLO можна вистояти щасливим заради цього." }
          ]
        }
      ],
      farewell: "Дякую, що підвіз, водію. Наступного разу — кава з мене, обіцяю!"
    }
  ];

  // ---------- стан модуля ----------
  var passengers = [];      // санітизований список {id,name,from,fareBonus,beats,farewell}
  var loaded     = false;   // true, коли passengers[] готовий (успіх або фолбек)
  var ridden     = null;    // Set<string> id — кого вже "звезли" цієї сесії/тижня
  var inited     = false;

  var offerAcc = 0;         // акумулятор ігрового (нічного) часу до наступної пропозиції
  var offer    = null;      // { p, marker } — пасажир чекає на посадку
  var ride     = null;      // { p, beatIdx, timer } — активний діалог у салоні

  var el = {};               // кеш DOM-вузлів оверлею (лінива побудова)

  // ---------- безпечні обгортки ----------
  function toastSafe(msg){ try{ if(typeof toast === 'function') toast(msg); }catch(e){} }
  function hudSafe(){ try{ if(typeof updateHUD === 'function') updateHUD(); }catch(e){} }
  function speakSafe(lines){ try{ if(typeof speakLines === 'function') speakLines(lines); }catch(e){} }
  function escSafe(s){ try{ return (typeof esc === 'function') ? esc(String(s == null ? '' : s)) : String(s == null ? '' : s); }catch(e){ return ''; } }

  // ---------- localStorage: хто вже "звезений" ----------
  function loadRidden(){
    var out = new Set();
    try{
      var raw = localStorage.getItem(LS_KEY);
      if(raw){
        var arr = JSON.parse(raw);
        if(Array.isArray(arr)) arr.forEach(function(id){ out.add(String(id)); });
      }
    }catch(e){}
    return out;
  }
  function saveRidden(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(Array.from(ridden))); }catch(e){}
  }
  function isRidden(id){ try{ return !!ridden && ridden.has(id); }catch(e){ return false; } }
  function markRidden(id){
    try{
      if(!ridden) ridden = new Set();
      ridden.add(String(id));
      // "тижневий" цикл: коли звезли вже стільки ж, скільки маємо пасажирів
      // (або більше) — скидаємо, щоб localStorage не ріс безмежно і щоб
      // пасажири могли з'являтись знову замість того, щоб пропозиції зникли назавжди.
      if(passengers.length && ridden.size >= passengers.length) ridden = new Set();
      saveRidden();
    }catch(e){}
  }

  // ---------- санітизація вхідних даних (fetch може бути кривим після ручного мержу) ----------
  function sanitizeList(list){
    var out = [];
    if(!Array.isArray(list)) return out;
    for(var i = 0; i < list.length; i++){
      try{
        var p = list[i];
        if(!p || typeof p !== 'object') continue;
        if(!p.from || typeof p.from.lat !== 'number' || typeof p.from.lng !== 'number') continue;
        if(!Array.isArray(p.beats) || !p.beats.length) continue;

        var beats = [];
        for(var j = 0; j < p.beats.length; j++){
          var b = p.beats[j];
          if(!b || typeof b.say !== 'string' || !b.say) continue;
          var rawChoices = Array.isArray(b.choices) ? b.choices : [];
          var choices = [];
          for(var k = 0; k < rawChoices.length; k++){
            var c = rawChoices[k];
            if(c && typeof c.t === 'string' && c.t && typeof c.reply === 'string' && c.reply){
              choices.push({ t: c.t, tone: (typeof c.tone === 'string' ? c.tone : ''), reply: c.reply });
            }
          }
          if(!choices.length) continue; // beat без жодного валідного варіанту — пропускаємо
          beats.push({ say: b.say, choices: choices });
        }
        if(!beats.length) continue;

        out.push({
          id: (typeof p.id === 'string' && p.id) ? p.id : ('psg' + i),
          name: (typeof p.name === 'string' && p.name) ? p.name : 'Пасажир',
          from: {
            name: (p.from && typeof p.from.name === 'string') ? p.from.name : '',
            lat: p.from.lat, lng: p.from.lng
          },
          fareBonus: (typeof p.fareBonus === 'number' && p.fareBonus > 0) ? p.fareBonus : 40,
          beats: beats,
          farewell: (typeof p.farewell === 'string' && p.farewell) ? p.farewell : 'Дякую, що підвіз!'
        });
      }catch(e){ /* один кривий запис не має ламати решту списку */ }
    }
    return out;
  }

  // ---------- завантаження даних (мережа, з тихим фолбеком) ----------
  function loadData(){
    try{
      if(typeof fetch !== 'function'){
        passengers = sanitizeList(FALLBACK_PASSENGERS);
        loaded = true;
        return;
      }
      fetch('data/passengers.json').then(function(r){
        if(!r || !r.ok) throw new Error('passengers.json http');
        return r.json();
      }).then(function(d){
        try{
          var list = sanitizeList(d && d.passengers);
          passengers = list.length ? list : sanitizeList(FALLBACK_PASSENGERS);
        }catch(e){ passengers = sanitizeList(FALLBACK_PASSENGERS); }
        loaded = true;
      }).catch(function(){
        passengers = sanitizeList(FALLBACK_PASSENGERS);
        loaded = true;
      });
    }catch(e){
      passengers = sanitizeList(FALLBACK_PASSENGERS);
      loaded = true;
    }
  }

  function pickAvailable(){
    try{
      if(!passengers.length) return null;
      var pool = passengers.filter(function(p){ return p && p.id && !isRidden(p.id); });
      if(!pool.length){ ridden = new Set(); saveRidden(); pool = passengers.slice(); } // всіх звезли — новий цикл
      if(!pool.length) return null;
      return pool[Math.floor(Math.random() * pool.length)] || null;
    }catch(e){ return null; }
  }

  // ---------- маркер очікування (inline-стилі, без CSS-файлу, як у PEDS/TRACES) ----------
  function waitIcon(){
    return L.divIcon({
      className: '', iconSize: [64, 34], iconAnchor: [32, 30],
      html: '<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">'
        + '<div style="font-size:10px;font-weight:800;background:rgba(20,22,26,.85);color:#fff;'
        + 'border-radius:6px;padding:1px 6px;margin-bottom:2px;white-space:nowrap">🌙 чекає</div>'
        + '<div style="width:26px;height:26px;border-radius:50%;background:#2b2d42;border:2px solid #fff;'
        + 'display:flex;align-items:center;justify-content:center;font-size:15px;'
        + 'box-shadow:0 2px 6px rgba(0,0,0,.4)">🧍</div>'
        + '</div>'
    });
  }

  function placeOffer(p){
    try{
      if(typeof map === 'undefined' || !map || typeof L === 'undefined') return false;
      if(!p || !p.from) return false;
      var mk = L.marker([p.from.lat, p.from.lng], {
        icon: waitIcon(), interactive: false, keyboard: false, title: p.name || 'Пасажир'
      }).addTo(map);
      offer = { p: p, marker: mk };
      toastSafe('🌙 Нічний пасажир чекає: ' + (p.from.name || p.name || 'десь поруч'));
      return true;
    }catch(e){ return false; }
  }
  function clearOffer(){
    try{ if(offer && offer.marker) map.removeLayer(offer.marker); }catch(e){}
    offer = null;
  }

  // ---------- DOM оверлею-діалогу (лінива побудова, index.html не редагується) ----------
  function ensureDom(){
    try{
      el.overlay = document.getElementById('psgOverlay');
      if(!el.overlay){
        el.overlay = document.createElement('div');
        el.overlay.id = 'psgOverlay';
        el.overlay.className = 'overlay hidden';
        el.overlay.innerHTML =
          '<div class="card">' +
            '<div class="paw">🌙</div>' +
            '<h1 id="psgName">—</h1>' +
            '<p id="psgSay">—</p>' +
            '<p id="psgReply" style="display:none;color:#2b7fd4;font-weight:600;"></p>' +
            '<div id="psgChoices"></div>' +
          '</div>';
        document.body.appendChild(el.overlay);
        el.choices = document.getElementById('psgChoices');
        // делегування: один обробник на контейнер варіантів, не по одному на кнопку
        // (контейнер перебудовується innerHTML щобіт — окремі addEventListener на
        // кнопках просто зникали б разом з ними, це нормально, але делегування простіше й безпечніше)
        el.choices.addEventListener('click', function(e){
          try{
            if(!ride) return;
            var btn = e.target && e.target.closest ? e.target.closest('button[data-i]') : null;
            if(!btn) return;
            var i = parseInt(btn.getAttribute('data-i'), 10);
            var beat = ride.p && ride.p.beats ? ride.p.beats[ride.beatIdx] : null;
            var choice = beat && beat.choices ? beat.choices[i] : null;
            if(!choice) return;
            onChoice(choice);
          }catch(err){}
        });
      }
      el.name = document.getElementById('psgName');
      el.say = document.getElementById('psgSay');
      el.reply = document.getElementById('psgReply');
      el.choices = document.getElementById('psgChoices');
    }catch(e){}
  }

  function setHtmlSafe(node, text){
    try{ if(node) node.innerHTML = escSafe(text); }catch(e){}
  }

  function clearReplyTimer(){
    try{ if(ride && ride.timer){ clearTimeout(ride.timer); ride.timer = null; } }catch(e){}
  }

  function renderBeat(idx){
    try{
      if(!ride) return;
      var beat = ride.p.beats[idx];
      if(!beat){ finishRide(); return; } // захист: якщо beats скінчились неочікувано
      ride.beatIdx = idx;

      setHtmlSafe(el.name, ride.p.name || 'Пасажир');
      setHtmlSafe(el.say, beat.say || '');
      if(el.reply){ el.reply.style.display = 'none'; setHtmlSafe(el.reply, ''); }

      var html = '';
      for(var i = 0; i < beat.choices.length; i++){
        html += '<button class="cta sec" data-i="' + i + '" style="margin-top:8px;display:block;width:100%">' +
          escSafe(beat.choices[i].t || '…') + '</button>';
      }
      if(el.choices){ el.choices.innerHTML = html; el.choices.style.display = ''; }

      speakSafe([beat.say]);
    }catch(e){ finishRide(); }
  }

  function onChoice(choice){
    try{
      if(!ride) return;
      if(el.choices) el.choices.style.display = 'none';
      if(el.reply){ setHtmlSafe(el.reply, choice.reply || ''); el.reply.style.display = ''; }
      speakSafe([choice.reply || '']);

      clearReplyTimer();
      ride.timer = setTimeout(function(){
        try{
          if(!ride) return;
          ride.timer = null;
          var next = ride.beatIdx + 1;
          if(ride.p.beats && next < ride.p.beats.length) renderBeat(next);
          else finishRide();
        }catch(e){ finishRide(); }
      }, REPLY_DELAY_MS);
    }catch(e){}
  }

  function startRide(p){
    try{
      ensureDom();
      clearOffer(); // пасажир уже в салоні — прибираємо маркер очікування
      ride = { p: p, beatIdx: 0, timer: null };
      try{
        if(typeof phase !== 'undefined' && phase === 'play') phase = 'ride';
      }catch(e){}
      if(!p.beats || !p.beats.length){ finishRide(); return; } // захист від порожніх даних
      renderBeat(0);
      if(el.overlay) el.overlay.classList.remove('hidden');
    }catch(e){
      // навіть якщо старт зламався — не лишаємо гру заблокованою у 'ride'
      try{ if(typeof phase !== 'undefined' && phase === 'ride'){ phase = 'play'; lastT = performance.now(); } }catch(e2){}
      ride = null;
    }
  }

  function finishRide(){
    var p = null;
    try{
      clearReplyTimer();
      p = ride && ride.p;
      if(el.overlay) el.overlay.classList.add('hidden');
    }catch(e){}
    try{
      if(typeof phase !== 'undefined' && phase === 'ride'){ phase = 'play'; lastT = performance.now(); }
    }catch(e){}
    try{
      if(p){
        var bonus = (typeof p.fareBonus === 'number' && p.fareBonus > 0) ? p.fareBonus : 0;
        if(bonus > 0){
          try{ if(typeof money === 'number') money += bonus; }catch(e){}
          try{ window.SAVE && window.SAVE.addEarned && window.SAVE.addEarned(bonus); }catch(e){}
        }
        hudSafe();
        var msg = '🌙 ' + (p.farewell || 'Дякую за поїздку!') + (bonus > 0 ? (' (+' + bonus + ' грн)') : '');
        toastSafe(msg);
        speakSafe([p.farewell || 'Дякую за поїздку!']);
        if(p.id) markRidden(p.id);
      }
    }catch(e){}
    clearOffer(); // про всяк випадок — не лишати осиротілий маркер
    ride = null;
    offerAcc = 0; // невеликий "перепочинок" перед наступною пропозицією цієї ночі
  }

  // ---------- перевірка посадки: авто близько й майже стоїть ----------
  function checkPickup(){
    try{
      if(!offer) return;
      if(typeof car === 'undefined' || !car) return;
      var p = offer.p;
      if(!p || !p.from) return;
      var carP;
      try{ carP = fromXY(car.x, car.y); }catch(e){ return; }
      var d = dist(carP.lat, carP.lng, p.from.lat, p.from.lng);
      var speed = Math.abs(typeof car.speed === 'number' ? car.speed : 0);
      if(d < PICKUP_RADIUS_M && speed < STOPPED_KMH) startRide(p);
    }catch(e){}
  }

  // ================= публічний контракт =================
  function init(){
    try{
      if(window.__passengersInited) return;
      window.__passengersInited = true;
      ridden = loadRidden();
      loadData();
      ensureDom();
      inited = true;
    }catch(e){ /* ніколи не ламаємо завантаження гри */ }
  }

  function step(dt){
    try{
      if(!inited) return;
      if(typeof phase === 'undefined') return;
      // step() і так викликається лише під час phase==='play' (гейт у tick()/step()
      // головного циклу — там само, де TRACES/LIGHTS/SPEED/PEDS), але дублюємо
      // перевірку, як це роблять сусідні модулі, про всяк випадок.
      if(phase !== 'play') return;
      var d = (typeof dt === 'number' && dt > 0 && dt < 1) ? dt : 0.016;

      if(ride) return; // діалог відкритий (не мало б статись — phase тоді вже не 'play')

      if(offer){ checkPickup(); return; } // є пасажир, що чекає — лише стежимо за посадкою

      if(!loaded || !passengers.length) return;

      var night = false;
      try{ night = !!(window.LIVE && window.LIVE.isNight); }catch(e){}
      if(!night) return; // пропозиції — лише вночі; акумулятор просто не росте вдень

      offerAcc += d;
      if(offerAcc >= OFFER_INTERVAL_S){
        offerAcc = 0;
        var p = pickAvailable();
        if(p) placeOffer(p);
      }
    }catch(e){ /* PASSENGERS ніколи не має зламати основний ігровий цикл */ }
  }

  window.PASSENGERS = { init: init, step: step };
})();

// ================= 🎙️ ОБОЛОНЬ FM: КВЕСТИ Й ДЗВІНКИ В ЕФІР (FMQUESTS, v0.8) =================
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий класичний
// <script>, що й основна гра (ЩЕ ОДИН inline-модуль, той самий патерн, що й
// window.FM / window.PEDS / window.TRACES) — бачить її глобали й НІЧОГО з них
// не перевизначає:
//   map (Leaflet), car{x,y,heading,speed,...}, phase (let-змінна; 'play' під
//   час активної їзди — НЕ функція), money (let), toXY/fromXY, dist(aLat,aLng,
//   bLat,bLng)->метри, toast(msg), speakLines(lines[])->bool, poiIcon(cls,emoji),
//   esc(s), window.MUTED, window.FM{on,event}, window.SAVE{addEarned,save},
//   updateHUD().
//   Також захисно (typeof-перевіркою) читає `radio` — локальне радіо біля
//   Сенсу/церков: поки воно грає, FMQUESTS не накладає свій голос зверху
//   (щоб не було двох голосів одночасно), але сам об'єктив (маркер/оголошення)
//   це не блокує — просто TTS цього разу мовчить, є toast.
//
// Ідея: районна станція Оболонь FM (та сама, що й window.FM) час від часу
// оголошує КВЕСТ («на набережній потрібна допомога») або приймає ДЗВІНОК
// В ЕФІР від слухача («заїдь забери мене з Х, довези до Y»). Гравець нічого
// не приймає руками — щойно диджей оголосив, це вже активний об'єктив:
// один-єдиний маркер на карті. Доїхав ближче ~25м до цілі — готово.
//
// Дані: data/fm_quests.json -> { quests:[{id,title,dj_intro,type,target:
// {name,lat,lng},reward,dj_outro}], calls:[{caller,request,from:{name,lat,lng},
// to:{name,lat,lng},reward}] }. Якщо fetch не вдався або формат неочікуваний —
// мовчазний фолбек на вбудований FMQ_FALLBACK нижче (ті самі реальні точки
// Оболоні, що й LANDMARKS/pois.json — канон «справжність місця» не ламаємо).
//
// Контракт: window.FMQUESTS = { init, step }
//   init() — одноразово (ІДЕМПОТЕНТНО) при завантаженні: fetch даних,
//            підготовка стану, ін'єкція власного CSS-класу маркера.
//            Мережевий виклик, нічого не блокує.
//   step(dt) — виклик щокадру (як window.PEDS.step(dt)) з основного ігрового
//            циклу під час phase==='play'. Сам собі рано виходить, якщо
//            радіо вимкнено / гра не в грі.
//
// Надійність: усе в try/catch (збій цього модуля ніколи не ламає гру);
// throttle — акумулятор ігрового dt (НЕ setInterval, НЕ щокадру побічні
// ефекти); рівно ОДИН активний об'єктив і ОДИН маркер за раз — перш ніж
// оголосити новий, попередній обов'язково завершено чи прибрано; текст, що
// йде в innerHTML маркера, проходить esc(); нічого не росте колекціями —
// стан це щонайбільше один активний об'єктив-обʼєкт.
// ============================================================
window.FMQUESTS = (function(){
  'use strict';

  // ---------- налаштування ----------
  var ARRIVE_M    = 25;    // м — радіус «доїхав до цілі» (за ТЗ, не CFG.arrive)
  var GAP_MIN_S   = 75;    // c — розкид навколо цілі ~90с (не метроном)
  var GAP_MAX_S   = 105;
  var CALL_CHANCE = 0.5;   // якщо є і квести, і дзвінки — шанс обрати саме дзвінок

  // ---------- стан модуля (усі імена з префіксом fq, щоб не перетнутись з рештою гри) ----------
  var fqInited  = false;        // ідемпотентність init()
  var fqData    = null;         // { quests:[...], calls:[...] } — з fm_quests.json або фолбек
  var fqAcc     = 0;            // акумулятор часу до наступного оголошення, c
  var fqNextGap = 90;           // ціль накопичення поточного циклу, c (рандомиться)
  var fqActive  = null;         // { kind:'quest'|'call', data, stage } — ОДИН активний об'єктив
  var fqMarker  = null;         // Leaflet-маркер поточного об'єктиву — ОДИН

  // ---------- фолбек-контент: реальні точки Оболоні (канон «справжність місця») ----------
  var FMQ_FALLBACK = {
    quests: [
      { id:'q_sens', title:'Книжки для «Сенсу»', dj_intro:'Друзі, книгарні «Сенс» на Оболоні потрібна допомога — завезіть, будь ласка, коробку книжок!', type:'delivery', target:{ name:'Книгарня «Сенс»', lat:50.5232, lng:30.4978 }, reward:55, dj_outro:'Книжки доїхали! «Сенс» дякує — і ми дякуємо.' },
      { id:'q_naberezhna', title:'Вода для волонтерів', dj_intro:'На набережній волонтери прибирають берег — підвезіть, будь ласка, воду для команди.', type:'volunteer', target:{ name:'Оболонська набережна', lat:50.5115, lng:30.516 }, reward:45, dj_outro:'Воду довезли, спраглих не лишили. Дякуємо!' },
      { id:'q_opechen', title:'Корм для качок', dj_intro:'Біля озера Опечень порожня годівниця — хто підвезе корм для качок?', type:'care', target:{ name:'Озеро Опечень', lat:50.514, lng:30.5065 }, reward:40, dj_outro:'Качки на Опечені вже ситі. Гарна справа!' },
      { id:'q_dreamtown', title:'Загублена парасолька', dj_intro:'У Dream Town хтось загубив парасольку — довезіть до інфостійки, будь ласка.', type:'lostfound', target:{ name:'ТРЦ Dream Town', lat:50.5236, lng:30.4972 }, reward:35, dj_outro:'Парасолька повернулась до господаря. Оболонь FM це любить.' },
      { id:'q_park', title:'Горішки для білочок', dj_intro:'У парку «Наталка» просять привезти горішки для білочок — хто поруч?', type:'care', target:{ name:'Парк «Наталка»', lat:50.5188, lng:30.5192 }, reward:40, dj_outro:'Білочки в парку «Наталка» вже пригощаються. Дякуємо!' },
      { id:'q_pokrovsky', title:'Свічки для храму', dj_intro:'Свято-Покровському храму привезли свічки з майстерні — довезете востаннє до дверей?', type:'delivery', target:{ name:'Свято-Покровський храм', lat:50.51212, lng:30.51242 }, reward:50, dj_outro:'Свічки на місці. Гарної дороги зі спокійним серцем.' },
      { id:'q_wog', title:'Забутий термос', dj_intro:'На заправці WOG хтось забув термос за кермом — підвезіть господарю, він чекає там само.', type:'lostfound', target:{ name:'АЗС WOG', lat:50.52805, lng:30.48267 }, reward:30, dj_outro:'Термос знайшов господаря. Кава ще гаряча, кажуть.' }
    ],
    calls: [
      { caller:'Оксана з Мінської', request:'Ой, привіт в ефір! Заберіть мене від метро «Мінська» і довезіть до озера Опечень, будь ласка.', from:{ name:'Метро «Мінська»', lat:50.5122, lng:30.4985 }, to:{ name:'Озеро Опечень', lat:50.514, lng:30.5065 }, reward:60 },
      { caller:'Максим', request:'Слухайте, хто там на проспекті Івасюка — підкиньте мене до Dream Town, запізнююсь!', from:{ name:'Оболонський проспект', lat:50.5065, lng:30.4995 }, to:{ name:'ТРЦ Dream Town', lat:50.5236, lng:30.4972 }, reward:65 },
      { caller:'Бабуся Галина', request:'Синочку, забери мене від метро «Героїв Дніпра», довези до храму на набережній.', from:{ name:'Метро «Героїв Дніпра»', lat:50.5223, lng:30.499 }, to:{ name:'Свято-Покровський храм', lat:50.51212, lng:30.51242 }, reward:70 },
      { caller:'Тарас', request:'В ефір: мені треба від метро «Оболонь» до парку «Наталка», підвезете?', from:{ name:'Метро «Оболонь»', lat:50.5013, lng:30.4983 }, to:{ name:'Парк «Наталка»', lat:50.5188, lng:30.5192 }, reward:55 },
      { caller:'Ірина', request:'Доброго вечора! Стою біля озера Опечень, а мені на набережну — заберете?', from:{ name:'Озеро Опечень', lat:50.514, lng:30.5065 }, to:{ name:'Оболонська набережна', lat:50.5115, lng:30.516 }, reward:40 }
    ]
  };

  // ---------- дрібні хелпери ----------
  function fqRand(min, max){ return min + Math.random() * (max - min); }
  function fqEnsureData(){ if(!fqData) fqData = FMQ_FALLBACK; }

  function fqValidLoc(o){
    return !!(o && typeof o === 'object' &&
      typeof o.lat === 'number' && isFinite(o.lat) &&
      typeof o.lng === 'number' && isFinite(o.lng));
  }
  function fqValidQuest(q){
    try{ return !!(q && typeof q === 'object' && typeof q.reward === 'number' && q.reward > 0 && fqValidLoc(q.target)); }
    catch(e){ return false; }
  }
  function fqValidCall(c){
    try{ return !!(c && typeof c === 'object' && typeof c.reward === 'number' && c.reward > 0 && fqValidLoc(c.from) && fqValidLoc(c.to)); }
    catch(e){ return false; }
  }

  // ---------- дані: fetch з фолбеком (той самий патерн, що й fmLoadData/PEDS.init) ----------
  function fqNormalize(j){
    try{
      if(!j || typeof j !== 'object') return FMQ_FALLBACK;
      var quests = Array.isArray(j.quests) ? j.quests.filter(fqValidQuest) : [];
      var calls  = Array.isArray(j.calls)  ? j.calls.filter(fqValidCall)   : [];
      if(!quests.length) quests = FMQ_FALLBACK.quests;
      if(!calls.length)  calls  = FMQ_FALLBACK.calls;
      return { quests: quests, calls: calls };
    }catch(e){ return FMQ_FALLBACK; }
  }
  function fqLoad(){
    try{
      if(typeof fetch !== 'function'){ fqData = FMQ_FALLBACK; return; }
      fetch('data/fm_quests.json').then(function(r){
        if(!r || !r.ok) throw new Error('fm_quests.json http');
        return r.json();
      }).then(function(j){
        fqData = fqNormalize(j);
      }).catch(function(){
        if(!fqData) fqData = FMQ_FALLBACK; // fetch/parse не вдався — лишаємось на фолбеку
      });
    }catch(e){ if(!fqData) fqData = FMQ_FALLBACK; }
  }

  // ---------- власний вигляд маркера (окремий CSS-клас, id-guarded ін'єкція — як TRACES.injectStyles) ----------
  function fqInjectStyles(){
    try{
      if(document.getElementById('fmqStyles')) return;
      var css = '.poi.fmq{background:#c2255c;}';
      var styleEl = document.createElement('style');
      styleEl.id = 'fmqStyles';
      styleEl.textContent = css;
      document.head.appendChild(styleEl);
    }catch(e){}
  }
  // Мітка з назвою над піном — той самий патерн, що й ghostIcon (нік мультиплеєра):
  // текст користувацького походження (назва цілі/ім'я слухача з JSON) ОБОВ'ЯЗКОВО через esc().
  function fqIcon(label, emoji){
    try{
      var safeLabel = esc(String(label || ''));
      var safeEmoji = String(emoji || '📻');
      return L.divIcon({
        className: '', iconSize: [70, 44], iconAnchor: [35, 44],
        html: '<div style="text-align:center">' +
                '<div style="font-size:9px;font-weight:800;background:rgba(20,22,26,.85);color:#fff;' +
                'border-radius:6px;padding:1px 5px;margin-bottom:1px;white-space:nowrap;max-width:96px;' +
                'overflow:hidden;display:inline-block">' + safeLabel + '</div>' +
                '<div class="poi fmq" style="margin:0 auto"><span>' + safeEmoji + '</span></div>' +
              '</div>'
      });
    }catch(e){
      try{ return poiIcon('fmq', emoji); }catch(e2){ return null; }
    }
  }
  function fqSetMarker(loc, emoji){
    try{
      fqRemoveMarker(); // ОДИН маркер об'єктиву — перед новим завжди прибираємо старий
      var icon = fqIcon(loc && loc.name, emoji);
      if(!icon) return;
      fqMarker = L.marker([loc.lat, loc.lng], { icon: icon, interactive: false }).addTo(map);
    }catch(e){}
  }
  function fqRemoveMarker(){
    try{ if(fqMarker){ map.removeLayer(fqMarker); fqMarker = null; } }catch(e){}
  }

  // ---------- мовлення: лише коли можна (не MUTED, і локальне радіо зараз не грає) ----------
  function fqCanSpeak(){
    try{
      if(window.MUTED) return false;
      if(typeof radio !== 'undefined' && radio && radio.on) return false; // не накладаємо голос на локальне радіо
      return true;
    }catch(e){ return false; }
  }
  function fqSay(lines){
    try{
      if(!fqCanSpeak() || !lines || !lines.length) return;
      speakLines(lines);
    }catch(e){}
  }

  // ---------- оголошення нового об'єктиву ----------
  function fqPickKind(){
    try{
      fqEnsureData();
      var hasQ = !!(fqData.quests && fqData.quests.length);
      var hasC = !!(fqData.calls && fqData.calls.length);
      if(!hasQ && !hasC) return null;
      if(!hasQ) return 'call';
      if(!hasC) return 'quest';
      return (Math.random() < CALL_CHANCE) ? 'call' : 'quest';
    }catch(e){ return null; }
  }
  function fqAnnounce(){
    try{
      if(fqActive) return; // лише один активний об'єктив за раз — не плодимо
      var kind = fqPickKind();
      if(!kind) return;
      fqEnsureData();
      var pool = fqData[kind === 'call' ? 'calls' : 'quests'];
      if(!pool || !pool.length) return;
      var item = pool[Math.floor(Math.random() * pool.length)];

      if(kind === 'quest'){
        if(!fqValidQuest(item)) return;
        fqActive = { kind: 'quest', data: item, stage: 'target' };
        fqSetMarker(item.target, '🎯');
        var qTitle = item.title ? (item.title + ': ') : '';
        toast('📻 ' + qTitle + (item.dj_intro || 'Диджей оголошує квест!'));
        fqSay(item.dj_intro ? [item.dj_intro] : null);
      } else {
        if(!fqValidCall(item)) return;
        fqActive = { kind: 'call', data: item, stage: 'from' };
        fqSetMarker(item.from, '📍');
        var who = item.caller ? (item.caller + ': ') : '';
        toast('📻 ' + who + (item.request || 'Дзвінок в ефір!'));
        fqSay(item.request ? [(item.caller ? (item.caller + ' в ефірі. ') : '') + item.request] : null);
      }
    }catch(e){}
  }

  // ---------- завершення / прогрес активного об'єктиву ----------
  function fqReward(n){
    try{
      var r = (typeof n === 'number' && isFinite(n) && n > 0) ? n : 0;
      if(r > 0){
        money += r;
        try{ window.SAVE && window.SAVE.addEarned && window.SAVE.addEarned(r); }catch(e){}
        try{ window.SAVE && window.SAVE.save && window.SAVE.save(); }catch(e){}
        try{ updateHUD(); }catch(e){}
      }
      return r;
    }catch(e){ return 0; }
  }
  function fqCompleteQuest(){
    try{
      var r = fqReward(fqActive.data.reward);
      var outro = fqActive.data.dj_outro || 'Дякуємо, диджей задоволений!';
      toast('✅ ' + outro + (r ? (' +' + Math.round(r) + ' грн') : ''));
      fqSay([outro]);
      fqRemoveMarker();
      fqActive = null;
    }catch(e){ fqRemoveMarker(); fqActive = null; }
  }
  function fqCompleteCall(){
    try{
      var r = fqReward(fqActive.data.reward);
      var who = fqActive.data.caller || 'Слухач';
      toast('✅ ' + who + ' дякує за підвезення!' + (r ? (' +' + Math.round(r) + ' грн') : ''));
      fqSay(['Дякую, що підвезли! Оболонь FM цінує добрих сусідів.']);
      fqRemoveMarker();
      fqActive = null;
    }catch(e){ fqRemoveMarker(); fqActive = null; }
  }
  function fqCheckArrival(){
    try{
      if(!fqActive) return;
      if(typeof car === 'undefined') return;
      var p = fromXY(car.x, car.y);
      if(fqActive.kind === 'quest'){
        var t = fqActive.data.target;
        if(dist(p.lat, p.lng, t.lat, t.lng) < ARRIVE_M) fqCompleteQuest();
        return;
      }
      // call: спершу забрати (from), тоді довезти (to)
      if(fqActive.stage === 'from'){
        var f = fqActive.data.from;
        if(dist(p.lat, p.lng, f.lat, f.lng) < ARRIVE_M){
          fqActive.stage = 'to';
          fqSetMarker(fqActive.data.to, '🏁');
          toast('🙋 Забрали! Тепер до: ' + (fqActive.data.to && fqActive.data.to.name || 'мети'));
        }
      } else {
        var d = fqActive.data.to;
        if(dist(p.lat, p.lng, d.lat, d.lng) < ARRIVE_M) fqCompleteCall();
      }
    }catch(e){}
  }

  // ================= КОНТРАКТ (window.FMQUESTS) =================
  function init(){
    try{
      if(fqInited) return; // ідемпотентність — повторний виклик нічого не ламає
      fqInited = true;
      fqAcc = 0;
      fqNextGap = fqRand(GAP_MIN_S, GAP_MAX_S);
      fqInjectStyles();
      fqLoad();
    }catch(e){}
  }
  function step(dt){
    try{
      if(typeof phase === 'undefined' || phase !== 'play') return;
      if(typeof dt !== 'number' || dt <= 0) return;

      // активний об'єктив перевіряємо незалежно від стану FM/радіо — щоб гравець
      // завжди міг довезти вже прийняте й отримати нагороду, навіть вимкнувши FM.
      if(fqActive){ fqCheckArrival(); return; }

      if(!(window.FM && window.FM.on)){ fqAcc = 0; return; } // FM вимкнено — нові об'єктиви не оголошуємо
      fqEnsureData();

      fqAcc += dt;
      if(fqAcc >= fqNextGap){
        fqAcc = 0;
        fqNextGap = fqRand(GAP_MIN_S, GAP_MAX_S);
        fqAnnounce();
      }
    }catch(e){}
  }

  return { init: init, step: step };
})();

// ============================================================
// 🏅 ПРОГРЕСІЯ ВОДІЯ (PROGRESSION) — v0.8
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий
// класичний <script>, що й основна гра (index.html) — бачить її
// глобали лексично й НІЧОГО з них не переоголошує:
//   money, phase, lastT, toast(msg), updateHUD(), esc(s),
//   window.SAVE (.stats()), window.MUTED, ac(), bell(freq,t0,dur,vol)
// DOM: перевикористовує класи .overlay/.card/.cta/.paw/.legend/.hidden
// з index.html (як SETTINGS/SIGNS) — саму розмітку сторінки не чіпає.
//
// Тон (docs/UNIVERSE.md §2,§6): тепло, без гриндфесту й соромлення.
// Досягнення — приємні дрібнички, а не список вимог. Ранги — теплі,
// районні: Новачок → Впевнений водій → Знавець району → Майстер
// дороги → Оболонський ас.
//
// Дані: localStorage['kotik_prog'] = { v, xp, achievements:[...ids],
//   counters:{ deliveries, kmNoFine } } — фіксована форма, achievements
//   не може вирости понад заданий каталог (8 id), counters — 2 числа.
// Також ЧИТАЄ (не пише) localStorage['kotik_signs_seen'] від SIGNS,
// щоб не дублювати підрахунок вивчених знаків.
//
// Усе в try/catch: localStorage може кидати у приватному режимі —
// тоді просто працюємо без збереження, гра ніколи не падає через це.
//
// Контракт: window.PROGRESSION = { init, addXP, event, openPanel, rank }
// ============================================================
(function(){
  'use strict';

  var PROG_KEY   = 'kotik_prog';
  var PROG_VER   = 1;
  var SIGNS_KEY  = 'kotik_signs_seen'; // той самий ключ, що й window.SIGNS (index.html)
  var PERSIST_THROTTLE = 2000; // мс — не частіше ~1 раз/2с пишемо в localStorage (як SAVE)

  // ---- ранги: теплі, районні, пороги «без гринду» ----
  var RANKS = [
    { id:'novak',    name:'Новачок',            min:0    },
    { id:'confident', name:'Впевнений водій',    min:100  },
    { id:'expert',   name:'Знавець району',      min:300  },
    { id:'master',   name:'Майстер дороги',      min:700  },
    { id:'ace',      name:'Оболонський ас',      min:1500 }
  ];

  // ---- досягнення: фіксований каталог з 8 штук, кожне даємо раз ----
  // xp — разовий бонус при розблокуванні (окремо від «базового» XP за дію).
  var ACHIEVEMENTS = {
    first_delivery: { name:'Перша доставка',     icon:'📦', xp:20,
      desc:'Довіз перше замовлення до адресата.' },
    ten_deliveries: { name:'10 доставок',         icon:'🚚', xp:60,
      desc:'Уже справжній кур’єр Оболоні.' },
    five_signs:     { name:'Вивчив 5 знаків',     icon:'🎓', xp:40,
      desc:'Розібрався у п’яти дорожніх знаках.' },
    night_driver:   { name:'Нічний водій',        icon:'🌙', xp:30,
      desc:'Перша поїздка з увімкненими фарами.' },
    no_fines_5km:   { name:'Без штрафів 5 км',    icon:'🐕‍🦺', xp:35,
      desc:'5 км чесної їзди — жодного зауваження від інспектора.' },
    blessed:        { name:'Благословенний',      icon:'⛪', xp:25,
      desc:'Зазирнув до храму за благословенням дороги.' },
    district_wave:  { name:'Хвиля району',        icon:'📻', xp:20,
      desc:'Увімкнув Оболонь FM — хвилю свого району.' },
    neighbor:       { name:'Сусід',                icon:'🐾', xp:20,
      desc:'Лишив теплий слід для інших котиків.' }
  };
  // порядок показу в панелі (стабільний, не залежить від порядку розблокування)
  var ACH_ORDER = ['first_delivery','ten_deliveries','five_signs','night_driver',
                    'no_fines_5km','blessed','district_wave','neighbor'];

  var inited = false;
  var state = null; // { v, xp, achievements:[], counters:{deliveries,kmNoFine} }
  var lastPersistAt = 0, pendingPersist = null;

  // ---- панель профілю: DOM/пауза ----
  var panel=null, body=null, pausedByUs=false;

  function isNum(v){ return typeof v==='number' && isFinite(v); }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }

  function toastSafe(msg){ try{ if(typeof toast==='function') toast(msg); }catch(e){} }
  function hudSafe(){ try{ if(typeof updateHUD==='function') updateHUD(); }catch(e){} }
  function escSafe(s){ try{ return (typeof esc==='function') ? esc(String(s)) : String(s); }catch(e){ return ''; } }

  // ---- дефолтний стан ----
  function defaults(){
    return { v:PROG_VER, xp:0, achievements:[], counters:{ deliveries:0, kmNoFine:0 } };
  }

  // ---- валідація: битий/чужорідний JSON → дефолт, ніколи не падаємо ----
  function validate(obj){
    try{
      if(!obj || typeof obj!=='object') return null;
      if(obj.v!==PROG_VER) return null;
      if(!isNum(obj.xp) || obj.xp<0) return null;
      if(!Array.isArray(obj.achievements)) return null;
      // фіксований каталог: фільтруємо невідомі/дубльовані id, ріст неможливий
      var seen={}, ach=[];
      for(var i=0;i<obj.achievements.length;i++){
        var id=obj.achievements[i];
        if(typeof id==='string' && ACHIEVEMENTS[id] && !seen[id]){ seen[id]=1; ach.push(id); }
      }
      var c = obj.counters && typeof obj.counters==='object' ? obj.counters : {};
      var deliveries = isNum(c.deliveries) && c.deliveries>=0 ? c.deliveries : 0;
      var kmNoFine = isNum(c.kmNoFine) && c.kmNoFine>=0 ? c.kmNoFine : 0;
      return { v:PROG_VER, xp:obj.xp, achievements:ach, counters:{ deliveries:deliveries, kmNoFine:kmNoFine } };
    }catch(e){ return null; }
  }

  function readRaw(){
    try{
      var raw = localStorage.getItem(PROG_KEY);
      if(!raw) return null;
      return validate(JSON.parse(raw));
    }catch(e){ return null; }
  }
  function writeRaw(obj){
    try{ localStorage.setItem(PROG_KEY, JSON.stringify(obj)); return true; }catch(e){ return false; }
  }

  function persistNow(){
    try{ writeRaw(state); }catch(e){}
    lastPersistAt = nowMs();
  }
  // публічний персист: throttle ~1 раз/2с (як SAVE.save()) — щоб часті виклики
  // (напр. event('km', ...) щокадру під час їзди) не гальмували
  function persist(){
    try{
      clearTimeout(pendingPersist);
      var elapsed = nowMs() - lastPersistAt;
      if(elapsed >= PERSIST_THROTTLE){ persistNow(); }
      else { pendingPersist = setTimeout(persistNow, PERSIST_THROTTLE - elapsed); }
    }catch(e){}
  }

  // ---- ранги: індекс за XP / об'єкт для UI ----
  function rankIndexForXP(xp){
    var idx=0;
    for(var i=0;i<RANKS.length;i++){ if(xp>=RANKS[i].min) idx=i; }
    return idx;
  }
  function rank(){
    try{
      var xp = (state && isNum(state.xp)) ? state.xp : 0;
      var idx = rankIndexForXP(xp);
      var cur = RANKS[idx];
      var next = RANKS[idx+1] || null;
      var pct = next ? Math.max(0, Math.min(1, (xp-cur.min)/(next.min-cur.min))) : 1;
      return {
        id:cur.id, name:cur.name, index:idx, xp:xp, min:cur.min,
        next: next ? next.name : null, nextMin: next ? next.min : null,
        toNext: next ? Math.max(0, next.min-xp) : 0, pct: pct, isMax: !next
      };
    }catch(e){ return { id:'novak', name:'Новачок', index:0, xp:0, min:0, next:'Впевнений водій', nextMin:100, toNext:100, pct:0, isMax:false }; }
  }

  // ---- приємний акорд при новому ранзі (тихо, лише !MUTED) ----
  function playRankChime(){
    try{
      if(window.MUTED) return;
      if(typeof ac !== 'function' || typeof bell !== 'function') return;
      var t0 = ac().currentTime;
      // тепла висхідна мажорна арпеджіо — інша за тембром/ритмом від дзвонів
      // храму (churchBells) і сигналу «привіт» (playHorn), щоб не плутались
      bell(523, t0,       0.16, 0.15);
      bell(659, t0+0.12,  0.16, 0.15);
      bell(784, t0+0.24,  0.20, 0.17);
      bell(1047,t0+0.38,  0.32, 0.18);
    }catch(e){}
  }

  // ---- XP і ранги ----
  function addXP(n, reason){
    try{
      if(!inited) init();
      var amt = (typeof n==='number' && isFinite(n)) ? n : 0;
      if(amt<=0) return;
      var before = rankIndexForXP(state.xp);
      state.xp += amt;
      var after = rankIndexForXP(state.xp);
      if(after > before){
        var r = RANKS[after];
        toastSafe('🏅 Новий ранг: '+r.name);
        playRankChime();
      }
      persist();
    }catch(e){}
  }

  // ---- скільки знаків уже вивчено (читаємо стан SIGNS, не дублюємо) ----
  function countSignsSeen(){
    try{
      var raw = localStorage.getItem(SIGNS_KEY);
      if(!raw) return 0;
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.length : 0;
    }catch(e){ return 0; }
  }

  // ---- розблокувати досягнення (раз назавжди) ----
  function unlock(id){
    try{
      var def = ACHIEVEMENTS[id];
      if(!def) return;
      if(!state.achievements) state.achievements=[];
      if(state.achievements.indexOf(id) !== -1) return;          // вже є
      if(state.achievements.length >= ACH_ORDER.length) return;  // захист: понад фіксований каталог не росте
      state.achievements.push(id);
      toastSafe('🏆 '+def.icon+' Досягнення: '+def.name+' (+'+def.xp+' XP)');
      addXP(def.xp, 'achv:'+id); // сам зробить persist()
      persist();
    }catch(e){}
  }
  function isUnlocked(id){
    try{ return !!(state && state.achievements && state.achievements.indexOf(id)!==-1); }catch(e){ return false; }
  }

  // ---- ігрові події: базовий XP за дію + перевірка ачівок ----
  function event(name, payload){
    try{
      if(!inited) init();
      if(!state) return;
      switch(name){
        case 'delivery':
          state.counters.deliveries = (state.counters.deliveries||0) + 1;
          addXP(15, 'доставка');
          if(state.counters.deliveries===1) unlock('first_delivery');
          if(state.counters.deliveries>=10) unlock('ten_deliveries');
          persist();
          break;
        case 'sign_learned':
          addXP(10, 'знак');
          if(countSignsSeen()>=5) unlock('five_signs');
          persist();
          break;
        case 'church':
          addXP(20, 'храм');
          unlock('blessed');
          persist();
          break;
        case 'fm_on':
          addXP(10, 'Оболонь FM');
          unlock('district_wave');
          persist();
          break;
        case 'trace_left':
          addXP(10, 'слід сусіда');
          unlock('neighbor');
          persist();
          break;
        case 'night_drive':
          unlock('night_driver'); // разова відзнака, XP додає сам unlock()
          break;
        case 'fine':
          // штраф скидає лічильник «чесних» кілометрів (без осуду — просто заново)
          state.counters.kmNoFine = 0;
          persist();
          break;
        case 'km':
          var km = (typeof payload==='number' && isFinite(payload) && payload>0) ? payload : 0;
          if(km<=0) return;
          if(!isUnlocked('no_fines_5km')){
            state.counters.kmNoFine = (state.counters.kmNoFine||0) + km;
            if(state.counters.kmNoFine>=5) unlock('no_fines_5km');
          }
          persist();
          break;
        default: break;
      }
    }catch(e){}
  }

  // ============================================================
  // Панель профілю — .overlay/.card, як SETTINGS/SIGNS
  // ============================================================
  function progressBarHtml(r){
    var pct = Math.round(r.pct*100);
    var sub = r.isMax
      ? 'Максимальний ранг — далі просто гарна дорога 🐾'
      : (r.toNext+' XP до рангу «'+escSafe(r.next)+'»');
    return '' +
      '<div class="legend" style="margin-top:6px;">' +
        '<b>'+escSafe(r.name)+'</b> · '+Math.round(r.xp)+' XP<br>' +
        '<div style="background:#e3e5ea;border-radius:8px;height:10px;margin:8px 0;overflow:hidden;">' +
          '<div style="background:var(--accent,#e8a33a);height:100%;width:'+pct+'%;"></div>' +
        '</div>' +
        '<span style="font-size:12px;color:#666;">'+escSafe(sub)+'</span>' +
      '</div>';
  }

  function achievementsHtml(){
    var rows = ['<div class="legend" style="margin-top:10px;text-align:left;"><b>Досягнення</b><br>'];
    for(var i=0;i<ACH_ORDER.length;i++){
      var id = ACH_ORDER[i], def = ACHIEVEMENTS[id];
      if(!def) continue;
      var got = isUnlocked(id);
      var icon = got ? def.icon : '🔒';
      var style = got ? '' : 'opacity:.5;';
      rows.push('<div style="margin-top:6px;'+style+'">'+icon+' <b>'+escSafe(def.name)+'</b><br>' +
        '<span style="font-size:12px;color:#666;">'+escSafe(def.desc)+'</span></div>');
    }
    rows.push('</div>');
    return rows.join('');
  }

  function statsHtml(){
    try{
      var s = (window.SAVE && window.SAVE.stats) ? window.SAVE.stats() : {totalKm:0,totalEarned:0,sessions:0,money:0};
      var got = (state && state.achievements) ? state.achievements.length : 0;
      return '<div class="legend" style="margin-top:10px;">' +
        '<b>Коротка статистика</b><br>' +
        '🛞 Пробіг: '+(s.totalKm||0).toFixed(1)+' км<br>' +
        '📦 Усього зароблено: '+Math.round(s.totalEarned||0)+' грн<br>' +
        '🚗 Поїздок: '+(s.sessions||0)+'<br>' +
        '🏆 Досягнень: '+got+' з '+ACH_ORDER.length +
        '</div>';
    }catch(e){ return ''; }
  }

  function render(){
    try{
      if(!body) return;
      var r = rank();
      body.innerHTML = progressBarHtml(r) + statsHtml() + achievementsHtml();
    }catch(e){}
  }

  function ensureDom(){
    try{
      panel = document.getElementById('progPanel');
      if(!panel){
        panel = document.createElement('div');
        panel.id='progPanel'; panel.className='overlay hidden';
        panel.innerHTML =
          '<div class="card">' +
            '<div class="paw">🏅</div>' +
            '<h1>Профіль водія</h1>' +
            '<div id="progBody"></div>' +
            '<button class="cta" id="progClose" style="margin-top:12px;">Закрити</button>' +
          '</div>';
        document.body.appendChild(panel);
        panel.addEventListener('click', function(ev){ if(ev.target===panel) closePanel(); });
        var c=document.getElementById('progClose'); if(c) c.addEventListener('click', closePanel);
      }
      body = document.getElementById('progBody');
    }catch(e){}
  }

  // Відкриття лише при phase==='play' (тоді самі ставимо на паузу власною
  // фазою 'progress', як SIGNS робить із 'signs') або коли гра вже на паузі
  // (напр. відкрито з панелі SETTINGS) — тоді нічого з phase не чіпаємо.
  function openPanel(){
    try{
      if(typeof phase === 'undefined') return;
      if(phase==='play'){ phase='progress'; pausedByUs=true; }
      else if(phase==='pause'){ pausedByUs=false; }
      else { return; } // інші фази (меню/заправка/знаки/послідовність) — не лізем поверх
      ensureDom();
      render();
      if(panel) panel.classList.remove('hidden');
    }catch(e){}
  }
  function closePanel(){
    try{
      if(panel) panel.classList.add('hidden');
      if(pausedByUs && typeof phase!=='undefined' && phase==='progress'){
        phase='play';
        try{ lastT = performance.now(); }catch(e2){}
      }
      pausedByUs=false;
    }catch(e){}
  }

  // ---- init: ідемпотентний ----
  function init(){
    try{
      if(inited) return;
      inited = true;
      state = readRaw() || defaults();
      lastPersistAt = nowMs();
    }catch(e){
      inited = true;
      state = defaults();
    }
  }

  window.PROGRESSION = { init:init, addXP:addXP, event:event, openPanel:openPanel, rank:rank };
})();

// ============================================================
// 🎓 ONBOARDING — лагідний туторіал першого запуску + ПДР-поради
// на екрані завантаження (v0.8, «Котик за кермом»).
// Вставляється ІНЛАЙН у той самий <script>, що й гра
// (index.html), поруч із SIGNS/TRACES/SETTINGS/PEDS. Бачить
// глобали лексично (той самий <script>-блок) і НІЧОГО з них не
// переоголошує — лише читає/мутує (phase, toast, esc,
// localStorage — так само, як це вже роблять інші модулі тут).
//
// Що робить:
//  1) Поки гравець на стартовому екрані (#startScreen, phase
//     === 'menu') — показує ВИПАДКОВУ теплу ПДР-пораду у
//     невеликому блоці під стартовою карткою (#pdrTip,
//     створюється самим модулем — index.html не редагується) і
//     періодично її оновлює (throttle-таймер).
//  2) При першому вході в реальну поїздку (phase==='play' після
//     стартової послідовності) — якщо це перший запуск гри на
//     цьому пристрої (localStorage['kotik_onboarded'] ще не
//     стоїть) — показує 2–3 короткі дружні toast-підказки одну
//     за одною з паузами, і більше ніколи їх не повторює.
//
// Контент порад: data/pdr_tips.json → { tips:[{text, rule}] }.
// Фетчиться в init(); якщо файл відсутній/не завантажився/має
// невалідну форму — модуль тихо лишається на вбудованому
// фолбеку (TIPS_FALLBACK нижче) і працює так само коректно.
// Точні номери пунктів ПДР у фолбеку — ті самі, що вже звірені
// й використовуються в грі (POLICE-модуль, data/pdr_rules.json):
// нічого нового не вигадано.
//
// Надійність:
//  - усе в try/catch, модуль ніколи не має зламати гру;
//  - init() ідемпотентний (повторний виклик — no-op);
//  - текст поради вставляється в DOM ЛИШЕ через esc();
//  - throttle-таймер порад:
//      а) явно чиститься викликом window.ONBOARDING.enterPlay()
//         (його треба зачепити в startGame()/finishSequence()
//         одразу після phase='play' — див.
//         onboarding_integration.md);
//      б) про всяк випадок сам себе зупиняє, щойно на черговому
//         тіку бачить phase !== 'menu' — навіть якщо крок (а)
//         з якоїсь причини не зачепили, таймер не «тікає» довго;
//  - лише ОДИН setInterval за раз (для ротації порад), і він
//    завжди прибирається через clearInterval — жодних витоків;
//  - toast-підказки першого запуску — через chain setTimeout з
//    ids, які теж прибираються (clearOnboardTimers) при
//    повторному/неочікуваному виклику enterPlay();
//  - прапорець «онбординг показано» пишеться в localStorage
//    ДО того, як стартує послідовність toast'ів (не після) —
//    щоб дубль-виклик enterPlay() не показав тижо туторіал ще раз.
//
// Контракт: window.ONBOARDING = { init, enterPlay }
//   window.ONBOARDING.init()      — одноразово при завантаженні,
//                                    поруч з іншими *.init() у
//                                    боот-ланцюжку index.html.
//   window.ONBOARDING.enterPlay() — викликати ОДИН раз одразу
//                                    після встановлення phase='play'
//                                    у startGame()/finishSequence().
// ============================================================
(function(){
  'use strict';

  var LS_ONBOARDED   = 'kotik_onboarded';
  var TIPS_URL        = 'data/pdr_tips.json';
  var TIP_ROTATE_MS   = 8000;   // throttle: як часто міняти пораду на старті
  var ONBOARD_GAP_MS  = 4000;   // пауза між toast-підказками першого запуску
  var ONBOARD_FIRST_DELAY_MS = 3800; // щоб не збити власний "🚗 Поїхали!" toast гри

  // Фолбек-поради: номери пунктів ПДР — ті самі, що вже звірені
  // й живуть у data/pdr_rules.json / POLICE-модулі цієї гри.
  // Нових номерів тут не вигадано.
  var TIPS_FALLBACK = [
    { text: 'Червоне світло — це привід зупинитись перед стоп-лінією, а не проскочити. Зелене нікуди не дінеться.', rule: 'ПДР 8.7.3 “е”; 8.10' },
    { text: 'У місті не поспішай вище 50 км/год — і дорога, і бак пального скажуть тобі дякую.', rule: 'ПДР 12.4' },
    { text: 'Бачиш пішохода біля переходу — притримайся і дай пройти. Хороший котик завжди дає дорогу.', rule: 'ПДР 18.1' },
    { text: 'Ремінь — це «клац» на початку кожної поїздки. Маленький ритуал, який береже.', rule: 'ПДР 2.3 “в”' },
    { text: 'Побачив знак «Стоп» — зупинись повністю, навіть на секунду. Потім спокійно їдь далі.', rule: 'ПДР Додаток 1, знак 2.2' }
  ];

  var ONBOARD_MESSAGES = [
    '🛣️ Тримайся смуги — тап ◀▶ змінює смугу',
    '⛽ Стеж за пальним — заправся на будь-якій АЗС',
    '🌙 Вночі вмикай фари й тримай дистанцію'
  ];

  var booted = false;          // init() ідемпотентність
  var tips = TIPS_FALLBACK.slice();
  var tipTimer = null;         // throttle-таймер ротації порад на старті
  var onboardTimers = [];      // ids setTimeout для toast-послідовності
  var introduced = false;      // внутрішній guard: enterPlay() вже відпрацював у цій сесії

  // ---------- безпечні обгортки навколо глобалів гри ----------
  function toastSafe(msg){ try{ if(typeof toast==='function') toast(msg); }catch(e){} }
  function escSafe(s){
    try{ return (typeof esc==='function') ? esc(String(s)) : String(s).replace(/[<>&"']/g,''); }
    catch(e){ return ''; }
  }

  // ---------- порада: вибір / рендер ----------
  function pickRandomTip(){
    try{
      if(!tips || !tips.length) return null;
      return tips[Math.floor(Math.random() * tips.length)];
    }catch(e){ return null; }
  }

  function ensureTipEl(){
    try{
      var el = document.getElementById('pdrTip');
      if(el) return el;
      var card = document.querySelector('#startScreen .card');
      if(!card) return null;
      el = document.createElement('div');
      el.id = 'pdrTip';
      el.className = 'legend';
      el.style.marginTop = '8px';
      var loadNote = document.getElementById('loadNote');
      // кладемо ПІСЛЯ #loadNote — теплий рядок у самому низу картки,
      // не заважає статусу завантаження карти над ним
      if(loadNote && loadNote.parentNode === card && loadNote.nextSibling){
        card.insertBefore(el, loadNote.nextSibling);
      } else {
        card.appendChild(el);
      }
      return el;
    }catch(e){ return null; }
  }

  function showRandomTip(){
    try{
      var el = ensureTipEl();
      if(!el) return;
      var t = pickRandomTip();
      if(!t || !t.text) return;
      var html = '💡 Порада: ' + escSafe(t.text);
      if(t.rule) html += ' <small style="opacity:.65">(' + escSafe(t.rule) + ')</small>';
      el.innerHTML = html;
    }catch(e){}
  }

  function startTipRotation(){
    try{
      stopTipRotation();
      showRandomTip();
      tipTimer = setInterval(function(){
        try{
          // самозахист: якщо гру вже почали, а явний enterPlay() з
          // якоїсь причини не зачепили — таймер сам себе гасить
          // не пізніше наступного тіку, а не «тікає» весь матч.
          if(typeof phase !== 'undefined' && phase !== 'menu'){ stopTipRotation(); return; }
          showRandomTip();
        }catch(e){ stopTipRotation(); }
      }, TIP_ROTATE_MS);
    }catch(e){}
  }

  function stopTipRotation(){
    try{ if(tipTimer){ clearInterval(tipTimer); tipTimer = null; } }catch(e){}
  }

  // ---------- контент: data/pdr_tips.json з тихим фолбеком ----------
  function loadTips(){
    try{
      fetch(TIPS_URL).then(function(r){
        if(!r.ok) throw new Error('pdr_tips http ' + r.status);
        return r.json();
      }).then(function(data){
        try{
          if(data && Array.isArray(data.tips)){
            var cleaned = data.tips.filter(function(t){
              return t && typeof t.text === 'string' && t.text.trim().length > 0;
            }).map(function(t){
              return { text: String(t.text), rule: (typeof t.rule === 'string' ? t.rule : '') };
            });
            if(cleaned.length) tips = cleaned;
          }
        }catch(e){ /* лишаємось на тому, що вже мали (фолбек або попередній фетч) */ }
      }).catch(function(){ /* мережа/файл недоступні — тихо лишаємось на фолбеку */ });
    }catch(e){ /* fetch недоступний у цьому середовищі — фолбек і так уже активний */ }
  }

  // ---------- перший вхід у play: 2–3 дружні toast-підказки ----------
  function clearOnboardTimers(){
    try{ onboardTimers.forEach(function(id){ clearTimeout(id); }); }catch(e){}
    onboardTimers = [];
  }

  function maybeRunFirstRideTutorial(){
    try{
      var already = null;
      try{ already = localStorage.getItem(LS_ONBOARDED); }catch(e){ already = 'unknown'; }
      // 'unknown' (localStorage недоступний, напр. приватний режим) —
      // про всяк випадок НЕ показуємо повторно нав'язливо щоразу;
      // просто вважаємо, що онбординг уже "показано" цього разу.
      if(already) return;

      // ставимо прапорець ОДРАЗУ, до того як щось показали — щоб
      // дубль-виклик enterPlay() (напр. якщо його зачепили і в
      // startGame(), і в finishSequence()) не запустив другу хвилю.
      try{ localStorage.setItem(LS_ONBOARDED, '1'); }catch(e){}

      clearOnboardTimers();
      ONBOARD_MESSAGES.forEach(function(msg, i){
        var id = setTimeout(function(){
          toastSafe(msg);
        }, ONBOARD_FIRST_DELAY_MS + i * ONBOARD_GAP_MS);
        onboardTimers.push(id);
      });
    }catch(e){}
  }

  // ---------- публічний хук: викликати з startGame()/finishSequence() ----------
  function enterPlay(){
    try{
      stopTipRotation(); // на старті гри порада на завантажувальному екрані більше не потрібна
      if(introduced) return; // цю ігрову сесію туторіал уже запускали — не дублюємо
      introduced = true;
      maybeRunFirstRideTutorial();
    }catch(e){}
  }

  // ---------- init ----------
  function init(){
    try{
      if(booted) return; // ідемпотентність
      booted = true;
      loadTips();
      startTipRotation();
    }catch(e){}
  }

  window.ONBOARDING = { init: init, enterPlay: enterPlay };
})();


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
      roadsOnly=false;
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
  window.__game = {
    startGame, startSequence, finishSequence, step, toast, fmToggle, laneChange,
    nearestRoad, toXY, fromXY, initGame,
    get car() { return car; }, set car(v) { car = v; },
    get money() { return money; }, set money(v) { money = v; },
    get fuel() { return fuel; }, set fuel(v) { fuel = v; },
    get fuelType() { return fuelType; }, set fuelType(v) { fuelType = v; },
    get phase() { return phase; }, set phase(v) { phase = v; },
    get roadsOnly() { return roadsOnly; }, set roadsOnly(v) { roadsOnly = v; },
    get selectedMode() { return selectedMode; }, set selectedMode(v) { selectedMode = v; },
    get handedMode() { return handedMode; }, set handedMode(v) { handedMode = v; },
    get segments() { return segments; },
    get input() { return input; },
    get lastRoadHit() { return lastRoadHit; }, set lastRoadHit(v) { lastRoadHit = v; },
  };
}
