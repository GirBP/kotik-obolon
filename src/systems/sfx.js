import { ac } from '../core/audio.js';


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
