import { ac, bell } from '../core/audio.js';
import { toast } from '../core/dom.js';
import { fromXY, toXY } from '../core/geo.js';
import { car, state } from '../core/state.js';
import { dist, map } from '../world/map.js';



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
      if(typeof state.phase === 'undefined' || state.phase !== 'play') return;
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
