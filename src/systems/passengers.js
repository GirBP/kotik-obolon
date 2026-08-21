import { esc, toast } from '../core/dom.js';
import { fromXY } from '../core/geo.js';
import { car, state } from '../core/state.js';
import { speakLines } from '../core/tts.js';
import { updateHUD } from '../ui/hud.js';
import { dist, map } from '../world/map.js';


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
        if(typeof state.phase !== 'undefined' && state.phase === 'play') state.phase = 'ride';
      }catch(e){}
      if(!p.beats || !p.beats.length){ finishRide(); return; } // захист від порожніх даних
      renderBeat(0);
      if(el.overlay) el.overlay.classList.remove('hidden');
    }catch(e){
      // навіть якщо старт зламався — не лишаємо гру заблокованою у 'ride'
      try{ if(typeof state.phase !== 'undefined' && state.phase === 'ride'){ state.phase = 'play'; state.lastT = performance.now(); } }catch(e2){}
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
      if(typeof state.phase !== 'undefined' && state.phase === 'ride'){ state.phase = 'play'; state.lastT = performance.now(); }
    }catch(e){}
    try{
      if(p){
        var bonus = (typeof p.fareBonus === 'number' && p.fareBonus > 0) ? p.fareBonus : 0;
        if(bonus > 0){
          try{ if(typeof state.money === 'number') state.money += bonus; }catch(e){}
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
      if(typeof state.phase === 'undefined') return;
      // step() і так викликається лише під час phase==='play' (гейт у tick()/step()
      // головного циклу — там само, де TRACES/LIGHTS/SPEED/PEDS), але дублюємо
      // перевірку, як це роблять сусідні модулі, про всяк випадок.
      if(state.phase !== 'play') return;
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
