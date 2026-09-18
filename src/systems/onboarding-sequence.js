import { CFG } from '../core/config.js';
import { fromXY } from '../core/geo.js';
import { toast } from '../core/dom.js';
import { state, car, resetCar } from '../core/state.js';
import { map } from '../world/map.js';
import { updateHUD } from '../ui/hud.js';

// ================= СТАРТ + ПОСЛІДОВНІСТЬ =================
// Ритуал старту (вийти з дому → відімкнути → пристебнутись → завести → рушити),
// показаний покроково при першому вході, і швидкий initGame()/startGame() для
// подальших заїздів/дев-тестів (обходить SEQ).
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

export function initGame(){ if(state.handedMode==='one') state.selectedMode='auto';
  resetCar({x:0,y:0,heading:0,speed:0,engineRunning:false,belt:false,
  mode:state.selectedMode, gear:0, clutch:1, rpm:0, gearDisp:'N', stallT:0, lane:99});
  state.fuel=CFG.startFuel; state.money=CFG.startMoney; state.churchCd=0; state.blessing=0; state.job=null; state.lowShown=false;
  document.getElementById('manualCtl').classList.toggle('hidden', state.selectedMode!=='manual');
  document.getElementById('gearChip').classList.toggle('hidden', state.selectedMode!=='manual');
  document.getElementById('jobBtn').classList.remove('on'); updateHUD(); }
export function startGame(){ initGame(); window.SAVE&&window.SAVE.applyRestore(); car.engineRunning=true; car.belt=true; window.SFX&&window.SFX.play('engine_start');   // швидкий старт (фолбек/тест)
  if(state.mpEnabled) window.MP&&window.MP.start();
  document.getElementById('startScreen').classList.add('hidden'); document.getElementById('seq').classList.add('hidden');
  state.phase='play'; state.lastT=performance.now(); window.applyHanded&&window.applyHanded();
  window.ONBOARDING&&window.ONBOARDING.enterPlay();
  try{ var _a=document.getElementById('actions'); if(_a) _a.style.display=''; }catch(e){} }
export function startSequence(){ initGame();
  if(state.mpEnabled) window.MP&&window.MP.start();
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
export function finishSequence(){ window.SAVE&&window.SAVE.applyRestore(); document.getElementById('seq').classList.add('hidden');
  car.engineRunning=true; window.SFX&&window.SFX.play('engine_start'); state.phase='play'; state.lastT=performance.now(); window.applyHanded&&window.applyHanded();
  window.ONBOARDING&&window.ONBOARDING.enterPlay();
  try{ var _a=document.getElementById('actions'); if(_a) _a.style.display=''; }catch(e){}
  if(car.mode==='manual'){ car.gear=1;
    toast('🔧 Механіка: тримай 🖐 Зчеплення, дай Газ — і плавно відпусти зчеплення. Інакше заглухне!'); }
  else toast('🚗 Поїхали! Ремінь пристебнуто, двигун працює.'); }
document.getElementById('startBtn').addEventListener('click', startSequence);
document.getElementById('seqBtn').addEventListener('click', seqAction);
