import { ac, bell } from '../core/audio.js';
import { fromXY, toXY } from '../core/geo.js';
import { car, state } from '../core/state.js';
import { dist, map } from '../world/map.js';



// ============================================================
// «Світлофори» — справжні перехрестя Оболоні оживають (v0.7)
// Для «Котик за кермом». Вставляється ІНЛАЙН у той самий класичний
// <script>, що й основна гра — бачить її глобали й нічого з них не
// перевизначає:
//   map (Leaflet), car{x,y,heading,speed}, phase ('play' під час їзди),
//   toXY(lat,lng), fromXY(x,y), dist(aLat,aLng,bLat,bLng) → м,
//   toast(msg), updateHUD(), window.POLICE (.fine('red_light')),
//   window.MUTED, ac(), bell(freq,t0,dur,vol)
//
// Дані: data/pdr.json → { lights:[[lat,lng], ...] (~40 перехресть),
//   crossings:[...], limits:{...} }. Якщо fetch не вдався — тихий
// фолбек: гра просто їде без світлофорів (жодного toast/помилки).
//
// Що робить модуль:
//   - малює кожен світлофор як L.divIcon (кольоровий кружечок
//     🟢/🟡/🔴 за поточною фазою) і додає на карту в init();
//   - спільний за задумом, але зсунутий за індексом цикл фаз:
//     зелений ~14с → жовтий ~3с → червоний ~14с. Зсув на світлофор
//     розподілений рівномірно по всьому періоду, щоб перехрестя не
//     блимали синхронно, як один величезний світлофор;
//   - у step(dt) шукає найближчий до котика світлофор і, якщо той
//     близько (<14 м), у стані «червоний» (або «жовтий» на швидкості
//     >25) і котик їде швидше 12 км/год — фіксує проїзд на червоне:
//     POLICE.fine('red_light') + коротке бібікання (bell, якщо не
//     MUTED). Per-light кулдаун (довший за фазу «червоний») гарантує,
//     що один проїзд не оштрафує двічі — навіть якщо всередині
//     POLICE.fine() свого кулдауну раптом нема.
//   - рендер (перефарбовування кружечків) не частіше ніж раз на
//     ~0.3с; сканування відстані — щокадру (40 точок — це дешево).
//
// Контракт:
//   window.LIGHTS.init()    — одноразово при завантаженні (fetch
//                              pdr.json, малює маркери; тихий фолбек)
//   window.LIGHTS.step(dt)  — виклик щокадру із step(dt) під час
//                              phase==='play'
// ============================================================
(function(){
  'use strict';

  // ---------- тайминг фаз (сек) ----------
  var GREEN_S  = 14;
  var YELLOW_S = 3;
  var RED_S    = 14;
  var PERIOD_S = GREEN_S + YELLOW_S + RED_S; // 31

  // ---------- детекція проїзду на червоне ----------
  var TRIGGER_R      = 14;   // м — «на перехресті»
  var MIN_VIOLATE_KMH = 12;  // км/год — нижче цього не штрафуємо (майже стоїть)
  var YELLOW_RISK_KMH = 25;  // км/год — на жовтому штрафуємо тільки на такій швидкості
  var FINE_COOLDOWN_S = 18;  // > RED_S, щоб один проїзд на червоне не дав два штрафи

  // ---------- рендер ----------
  var RENDER_EVERY_S = 0.3;
  var EMOJI = { green:'🟢', yellow:'🟡', red:'🔴' };

  var lights = [];          // [{lat,lng,offset,marker,el,lastColor,lastFineClock}]
  var clock = 0;            // власний ігровий годинник модуля (йде лише під час step)
  var renderAccum = 0;
  var startedLoad = false;
  var ready = false;        // true, коли маркери вже намальовані

  // ---------- стилі кружечків (інжектимо самі, index.html не чіпаємо) ----------
  function injectStyles(){
    try{
      if(document.getElementById('lightsStyles')) return;
      var css = '.lightDot{width:22px;height:22px;display:flex;align-items:center;'+
        'justify-content:center;font-size:15px;line-height:1;pointer-events:none;'+
        'box-shadow:0 2px 4px rgba(0,0,0,.4);}';
      var styleEl = document.createElement('style');
      styleEl.id = 'lightsStyles';
      styleEl.textContent = css;
      document.head.appendChild(styleEl);
    }catch(e){}
  }

  // ---------- фаза світлофора у момент часу t (з власним зсувом) ----------
  function stateAt(offsetS, t){
    var x = (t + offsetS) % PERIOD_S;
    if(x < 0) x += PERIOD_S;
    if(x < GREEN_S) return 'green';
    if(x < GREEN_S + YELLOW_S) return 'yellow';
    return 'red';
  }

  function makeIcon(){
    return L.divIcon({ className:'', iconSize:[22,22], iconAnchor:[11,11],
      html:'<div class="lightDot">🟢</div>' });
  }

  function buildLights(raw){
    if(!Array.isArray(raw) || !raw.length) return; // тихий фолбек: нема даних — нема світлофорів
    injectStyles();
    var n = raw.length;
    for(var i=0;i<n;i++){
      var pt = raw[i];
      if(!pt || pt.length < 2) continue;
      var lat = +pt[0], lng = +pt[1];
      if(!isFinite(lat) || !isFinite(lng)) continue;

      var offset = (i * PERIOD_S / n) % PERIOD_S; // рівномірний зсув фази за індексом

      var marker = null, el = null;
      try{
        marker = L.marker([lat,lng], { icon:makeIcon(), interactive:false, keyboard:false }).addTo(map);
        var rootEl = marker.getElement ? marker.getElement() : null;
        el = rootEl ? rootEl.querySelector('.lightDot') : null;
      }catch(e){ continue; }

      // G1: кешуємо XY одразу — step() рахує пеленг «світлофор попереду авто»
      // без повторних перетворень щокадру.
      var xy = null;
      try{ xy = toXY(lat,lng); }catch(e){}

      lights.push({
        lat:lat, lng:lng, x: xy?xy.x:0, y: xy?xy.y:0, offset:offset,
        marker:marker, el:el,
        lastColor:'green',
        lastFineClock:-1e9
      });
    }
    ready = lights.length > 0;
    if(ready) renderAll(clock); // одразу коректні кольори, не чекаючи першого throttle-тіку
  }

  function renderAll(t){
    for(var i=0;i<lights.length;i++){
      var lt = lights[i];
      var st = stateAt(lt.offset, t);
      if(st === lt.lastColor) continue;
      lt.lastColor = st;
      if(lt.el) lt.el.textContent = EMOJI[st];
    }
  }

  function beepViolation(){
    try{
      if(window.MUTED) return;
      var t = ac().currentTime;
      bell(300, t, 0.09, 0.22);
      bell(210, t + 0.1, 0.13, 0.2);
    }catch(e){}
  }

  // ================= публічний контракт =================
  function init(){
    try{
      if(startedLoad) return;
      startedLoad = true;
      fetch('data/pdr.json').then(function(r){
        if(!r || !r.ok) throw new Error('pdr.json: bad response');
        return r.json();
      }).then(function(j){
        try{ buildLights(j && j.lights); }catch(e){}
      }).catch(function(){
        // тихий фолбек — просто немає світлофорів, гра їде далі
      });
    }catch(e){
      // тихий фолбек
    }
  }

  function step(dt){
    try{
      if(!ready || !lights.length) return;
      // step() і так викликається лише під час phase==='play' (гейт у tick()),
      // але дублюємо перевірку — так само, як TRACES.step — про всяк випадок.
      if(typeof state.phase !== 'undefined' && state.phase !== 'play') return;
      if(typeof dt !== 'number' || !isFinite(dt) || dt <= 0) return;

      clock += dt;
      renderAccum += dt;
      if(renderAccum >= RENDER_EVERY_S){
        renderAccum = 0;
        try{ renderAll(clock); }catch(e){}
      }

      var p = fromXY(car.x, car.y);
      var nearestIdx = -1, nearestD = Infinity;
      for(var i=0;i<lights.length;i++){
        var Lg = lights[i];
        var d = dist(p.lat, p.lng, Lg.lat, Lg.lng);
        if(d < nearestD){ nearestD = d; nearestIdx = i; }
      }
      if(nearestIdx < 0) return;

      if(nearestD < TRIGGER_R){
        var target = lights[nearestIdx];
        var st = stateAt(target.offset, clock);
        var speedKmh = Math.abs(car.speed);
        var violating = (st === 'red') || (st === 'yellow' && speedKmh > YELLOW_RISK_KMH);
        // G1: карати лише якщо ЦЕЙ світлофор попереду за курсом авто (±60°) —
        // інакше штрафуємо за світлофор на перпендикулярній/сусідній вулиці.
        var ahead = true;
        try{
          var ang = Math.atan2(target.x - car.x, target.y - car.y);
          var diff = ((ang - car.heading + Math.PI) % (2*Math.PI)) - Math.PI;
          ahead = Math.abs(diff) < 1.05;
        }catch(e){ ahead = true; }
        if(violating && ahead && speedKmh > MIN_VIOLATE_KMH && (clock - target.lastFineClock) > FINE_COOLDOWN_S){
          target.lastFineClock = clock;
          try{ window.POLICE && window.POLICE.fine && window.POLICE.fine('red_light', nearestIdx); }catch(e){}
          beepViolation();
        }
      }
    }catch(e){}
  }

  window.LIGHTS = { init:init, step:step };
})();
