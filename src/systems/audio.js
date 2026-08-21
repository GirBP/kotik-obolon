import { ac } from '../core/audio.js';
import { car, state } from '../core/state.js';



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
      if(typeof car === 'undefined' || !car || typeof state.phase === 'undefined') return;
      dt = (typeof dt === 'number' && isFinite(dt) && dt > 0) ? Math.min(dt, 0.1) : 0;

      // window.MUTED глушить МИТТЄВО — без плавної інтерполяції.
      if(window.MUTED){
        curGain = 0;
        if(built){ engineGain.gain.value = 0; tremDepth.gain.value = 0; }
        return;
      }

      var playing = (state.phase === 'play');

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
