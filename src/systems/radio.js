import { CFG } from '../core/config.js';
import { ac, bell } from '../core/audio.js';
import { toast } from '../core/dom.js';
import { speakLines } from '../core/tts.js';
import { state, churchMarks, radio } from '../core/state.js';
import { dist } from '../world/map.js';

// ================= РАДІО (Сенс / церква) =================
// Локальне радіо, що вмикається біля книгарні «Сенс» або храмів (на відміну
// від районної станції Оболонь FM у systems/fm.js — вони взаємно глушать одне одного).
// Голосу Стерненка тут немає і він не імітується: диктор (TTS) лише згадує співпрацю.
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

// ID відео з офіційного каналу Стерненка для радіо «Сенс» (офіційний YouTube-embed:
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
  if(window.MUTED) return; // при вимкненому звуці радіо не запускаємо (ні YouTube, ні mp3)
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

export function updateRadio(lat,lng){
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
