import { CFG, LANDMARKS } from '../core/config.js';
import { toast } from '../core/dom.js';
import { state } from '../core/state.js';
import { map, dist } from '../world/map.js';
import { poiIcon } from '../world/markers.js';
import { fmEvent } from './fm.js';

// ================= ЗАВДАННЯ =================
// Замовлення «забери в А, довези в Б» між реальними орієнтирами Оболоні (LANDMARKS).
export function newJob(){
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
export function checkJob(lat,lng){
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

document.getElementById('jobBtn').addEventListener('click',newJob);
