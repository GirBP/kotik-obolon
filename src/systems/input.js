import { CFG } from '../core/config.js';
import { toast } from '../core/dom.js';
import { state, input, car } from '../core/state.js';
import { shiftGear, startEngine } from './drivetrain.js';

// ================= ВВІД =================
// Прив'язка клавіатури/дотику до input (core/state.js) і до дій, що не є станом
// самого вводу (зміна смуги, перемикання передач, старт двигуна, режим керування).
export function laneChange(dir){ // -1 = лівіше (до осі), +1 = правіше (до узбіччя)
  if(!state.roadsOnly || state.curLanes<2) return;
  const old=car.lane;
  car.lane=Math.max(0,Math.min(state.curLanes-1, car.lane+dir));
  if(car.lane!==old){ window.SFX&&window.SFX.play('blinker'); toast(`Смуга ${car.lane+1} із ${state.curLanes}`); }
}

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
function steerKeyDown(key,_dir){
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
