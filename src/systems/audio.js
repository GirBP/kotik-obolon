import { ac } from '../core/audio.js';
import { car, state } from '../core/state.js';



// Муркотіння двигуна, WebAudio, без зовнішніх бібліотек. Звук навмисно
// теплий і тихий, а не рев чи гуркіт двигуна — це частина тону світу гри.
//
// Бачить глобалі гри й нічого з них не переоголошує:
//   car   { speed, rpm, mode, engineRunning, ... }  — стан авто
//   phase                                            — 'menu' | 'play' | 'pause' | ...
//   ac()                                             — спільний AudioContext (lazy, з auto-resume)
//   window.MUTED                                     — глобальний прапорець «звук вимкнено»
//
// Один граф на весь час життя сторінки: 2 осцилятори (sawtooth, злегка
// рознесені по detune) → lowpass-фільтр → engineGain → destination.
// Осцилятори стартують рівно один раз (buildGraph), далі змінюються лише
// їхні frequency/detune/gain — жодного накопичення вузлів чи повторних .start().
// «Муркотіння» — повільне вібрато пітчу (~4.5 Гц) + тремоло гучності (~6.5 Гц),
// обидва окремі LFO-модулятори AudioParam, не пересоздаються щокадру.
//
// Базова частота: у 'manual' — від car.rpm (idle..redline), інакше — від
// car.speed. Межі (RPM_IDLE/RPM_REDLINE/SPEED_MAX) продубльовані тут
// локально, щоб модуль лишався самодостатнім і не тягнув внутрішні ENG/CFG
// гри — якщо ці числа зміняться, звук трохи розʼїдеться з тахометром,
// але не зламається.
//
// AudioContext не створюється і граф не будується до першого виклику step()
// у фазі 'play' — тобто вже після жесту гравця (клік/тап «Поїхали»).
// window.MUTED глушить миттєво, без плавної інтерполяції; при зупинці
// двигуна чи виході з 'play' гучність теж іде до нуля, але плавно.
//
// Контракт: window.AUDIO = { init, step }
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

  // init() лише готує стан модуля, нічого не створює в WebAudio і не звертається до ac() —
  // граф і осцилятори будуються ліниво, зсередини step(), коли гра вже в фазі 'play'
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

      // window.MUTED глушить миттєво, без плавної інтерполяції.
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
