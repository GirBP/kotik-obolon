import { toast } from '../core/dom.js';
import { ac, bell } from '../core/audio.js';
import { speakLines } from '../core/tts.js';
import { state, radio } from '../core/state.js';

// ================= ОБОЛОНЬ FM =================
// Постійна районна радіостанція (на відміну від локального радіо біля Сенсу/храмів).
// Контент: data/radio.json; якщо fetch не вдався — працює на вбудованому фолбеці нижче.
// Контракт: window.FM = { on, init:fmInit, toggle:fmToggle, event:fmEvent, step:fmStep,
//           duck:fmDuck, unduck:fmUnduck } — так її бачать інші системи (police.js,
//           fmquests.js, settings.js), які лишаються на патерні window.<NAME>.
// main.js та jobs.js імпортують fmInit/fmEvent/fmStep напряму (звичайний ES-імпорт).

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

// window.FM визначаємо одразу, а не в кінці файлу: усі функції нижче — звичайні top-level
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

// ================= КОНТРАКТ (bare export + window.FM) =================
export function fmInit(){
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
export function fmToggle(){
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
export function fmEvent(type){
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
export function fmStep(dt){
  try{
    if(!FM.on) return;
    if(typeof state.phase !== 'undefined' && state.phase !== 'play') return;
    const suppressed = fmDucked || (typeof radio !== 'undefined' && radio && radio.on);
    if(suppressed){
      if(!fmWasSuppressed){ fmWasSuppressed = true; fmStopSpeaking(); } // скасувати один раз на межі, не щокадру
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
export function fmDuck(){
  try{ fmDucked = true; fmStopSpeaking(); }catch(_){}
}
export function fmUnduck(){
  try{ fmDucked = false; }catch(_){}
}
