import { toast } from '../core/dom.js';
import { car, state } from '../core/state.js';



// ============================================================
// 🚓 SPEED — обмеження швидкості + контроль перевищення
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий
// класичний <script>, що й основна гра — бачить її глобали
// (CFG, car{x,y,speed}, phase, nearestRoad(x,y,name)→{svc,name,...},
// toast, updateHUD, window.POLICE, window.MUTED, dist, fromXY) і
// нічого з них тут не перевизначає.
//
// ПДР України: у населеному пункті — 50 км/год; у житловій/дворовій
// зоні — 20 км/год (п. 3.29 «Обмеження максимальної швидкості» —
// логіка гри: якщо найближча дорога під авто службова/двір (svc===1) →
// ліміт 20, інакше — 50). Тон — docs/UNIVERSE.md: дорога тут повага,
// а не заборона, тож попередження м'яке, цитатою ліміту, без сорому.
//
// Контракт:
//   window.SPEED.init()   — одноразова ініціалізація (створює знак
//                            #speedLimit у #hud; викликати один раз
//                            після завантаження гри, коли DOM готовий)
//   window.SPEED.step(dt) — виклик щокадру із step(dt): визначає
//                            поточний ліміт (згладжено), оновлює HUD-
//                            знак і рахує неперервне перевищення
//   window.SPEED.limit()  — поточний підтверджений ліміт (число,
//                            20 або 50) — можна читати з інших модулів
// ============================================================
(function(){
  'use strict';

  // ---------- налаштування ----------
  var DEFAULT_LIMIT    = 50;   // старт: населений пункт, поки нема даних про дорогу під авто
  var SPD_CONFIRM_SEC  = 0.5;  // скільки секунд новий "сирий" ліміт має протриматись поспіль,
                                // щоб замінити підтверджений — анти-мигтіння на межі двір/вулиця
  var SPD_TOLERANCE    = 10;   // км/год толеранс понад ліміт, перш ніж це вважається перевищенням
  var SPD_WARN_SEC     = 2.0;  // секунд неперервного перевищення до першого попередження (toast)
  var SPD_FINE_GAP_SEC = 2.0;  // ще стільки ж — до штрафу; далі, поки триває, чек-ін у POLICE
                                // раз на SPD_FINE_GAP_SEC (сам POLICE вирішує, штрафувати чи ні —
                                // у нього свій кулдаун, тут ми лише не спамимо викликами щокадру)
  var SPD_HUD_THROTTLE = 0.5;  // не частіше разу на ~0.5с переписувати текст у знаку (крім змін —
                                // ті показуються одразу, throttle лише прибирає зайві DOM-записи)

  // ---------- внутрішній стан (усе з префіксом spd, щоб нічого не перетнути) ----------
  var spdLimit        = DEFAULT_LIMIT; // підтверджений (згладжений) ліміт — те, що бачить гравець
  var spdPendingLimit = DEFAULT_LIMIT; // "сирий" ліміт, визначений на поточному кадрі
  var spdPendingT     = 0;             // скільки часу поспіль тримається spdPendingLimit

  var spdOverT   = 0;     // секунд поспіль |car.speed| > spdLimit + SPD_TOLERANCE
  var spdWarned  = false; // перше попередження цього епізоду перевищення вже показане
  var spdFined   = false; // штрафна позначка цього епізоду вже спрацювала (перший чек-ін зроблено)
  var spdFineAcc = 0;     // акумулятор для періодичних чек-інів у POLICE.fine після spdFined

  var spdHudAcc  = 0;     // акумулятор для throttle HUD-рендеру
  var spdLastTxt = null;  // останній записаний у DOM текст знаку (щоб не писати те саме дарма)

  var elSign = null;
  var spdInited = false;

  // ---------- DOM / стилі ----------
  function injectStyles(){
    try{
      if(document.getElementById('speedStyles')) return;
      var css =
        '#speedLimit{width:34px;height:34px;border-radius:50%;background:#fff;' +
          'border:4px solid var(--red,#d93a34);color:#141414;font-weight:900;font-size:14px;' +
          'font-family:inherit;letter-spacing:-.4px;line-height:1;' +
          'display:flex;align-items:center;justify-content:center;' +
          'box-shadow:0 3px 10px rgba(0,0,0,.3);flex:0 0 auto;align-self:center;}';
      var styleEl = document.createElement('style');
      styleEl.id = 'speedStyles';
      styleEl.textContent = css;
      document.head.appendChild(styleEl);
    }catch(e){ /* без стилю знак все одно з'явиться, лише не оформлений */ }
  }
  function ensureDom(){
    injectStyles();
    elSign = document.getElementById('speedLimit');
    if(!elSign){
      elSign = document.createElement('div');
      elSign.id = 'speedLimit';
      elSign.title = 'Обмеження швидкості';
      elSign.textContent = String(DEFAULT_LIMIT);
      spdLastTxt = String(DEFAULT_LIMIT);
      var hud = document.getElementById('hud');
      if(hud) hud.appendChild(elSign); else document.body.appendChild(elSign);
    }
  }
  function renderSign(){
    try{
      if(!elSign) return;
      var txt = String(spdLimit);
      if(txt !== spdLastTxt){ elSign.textContent = txt; spdLastTxt = txt; }
    }catch(e){}
  }

  // ---------- визначення ліміту під авто ----------
  // Дворова/службова дорога (svc===1) → 20 км/год; будь-яка інша → 50 км/год.
  // Перф: не викликає nearestRoad() сам (те саме вже рахує step() раз за кадр) —
  // натомість читає кеш window.lastRoadHit, який step() виставляє щокадру.
  function rawLimitAt(x, y){
    try{
      if(typeof state.roadsOnly !== 'undefined' && !state.roadsOnly) return 50; // вільний режим — завжди «місто»
      var r = (typeof state.lastRoadHit !== 'undefined') ? state.lastRoadHit : null;
      if(!r) return null; // дороги ще не завантажені / авто поза сіткою — тримаємось попереднього ліміту
      return r.svc ? 20 : 50;
    }catch(e){ return null; }
  }
  function updateLimit(dt){
    try{
      if(typeof car === 'undefined' || !car) return;
      var raw = rawLimitAt(car.x, car.y);
      if(raw == null) return; // немає свіжих даних цього кадру — не чіпаємо ні pending, ні підтверджений ліміт

      if(raw === spdPendingLimit) spdPendingT += dt;
      else { spdPendingLimit = raw; spdPendingT = 0; }

      // застосовуємо новий ліміт лише після того, як він "устоявся" SPD_CONFIRM_SEC поспіль —
      // це і є згладжування, яке не дає знаку мигтіти на межі двір/вулиця
      if(spdPendingT >= SPD_CONFIRM_SEC && spdLimit !== spdPendingLimit) spdLimit = spdPendingLimit;
    }catch(e){}
  }
  function updateHud(dt){
    try{
      spdHudAcc += (typeof dt === 'number' && dt > 0) ? dt : 0;
      var changed = String(spdLimit) !== spdLastTxt;
      if(changed || spdHudAcc >= SPD_HUD_THROTTLE){
        renderSign();
        spdHudAcc = 0;
      }
    }catch(e){}
  }

  // ---------- контроль перевищення ----------
  function resetOverspeedTimers(){
    spdOverT = 0; spdWarned = false; spdFined = false; spdFineAcc = 0;
  }
  function updateEnforcement(dt){
    try{
      if(typeof car === 'undefined' || !car) return;
      var speed = Math.abs(typeof car.speed === 'number' ? car.speed : 0);
      var threshold = spdLimit + SPD_TOLERANCE;

      if(speed <= threshold){
        if(spdOverT !== 0 || spdWarned || spdFined) resetOverspeedTimers(); // швидкість у нормі — скидаємо таймери
        return;
      }

      spdOverT += (typeof dt === 'number' && dt > 0) ? dt : 0;

      if(!spdWarned && spdOverT >= SPD_WARN_SEC){
        spdWarned = true;
        try{ if(typeof toast === 'function') toast('🚗 Перевищення! Ліміт ' + spdLimit); }catch(e){}
      }

      var fineAt = SPD_WARN_SEC + SPD_FINE_GAP_SEC; // ще ~2с після попередження → перший штраф
      if(spdWarned && !spdFined && spdOverT >= fineAt){
        spdFined = true; spdFineAcc = 0;
        try{ window.POLICE && window.POLICE.fine && window.POLICE.fine('speeding'); }catch(e){}
      } else if(spdFined){
        // водій і далі перевищує — не спамимо POLICE щокадру, чекінимось раз на SPD_FINE_GAP_SEC;
        // сам POLICE вирішує (свій кулдаун), чи це справді новий штраф
        spdFineAcc += (typeof dt === 'number' && dt > 0) ? dt : 0;
        if(spdFineAcc >= SPD_FINE_GAP_SEC){
          spdFineAcc = 0;
          try{ window.POLICE && window.POLICE.fine && window.POLICE.fine('speeding'); }catch(e){}
        }
      }
    }catch(e){}
  }

  // ================= КОНТРАКТ =================
  function spdInit(){
    try{
      if(spdInited) return;
      spdInited = true;
      spdLimit = DEFAULT_LIMIT; spdPendingLimit = DEFAULT_LIMIT; spdPendingT = 0;
      resetOverspeedTimers();
      ensureDom();
      renderSign();
    }catch(e){ /* ніколи не ламаємо завантаження гри */ }
  }
  function spdStep(dt){
    try{
      if(!spdInited) ensureDom(); // захист: якщо step() викликали без init() — знак все одно з'явиться
      if(typeof state.phase !== 'undefined' && state.phase !== 'play') return; // поза грою (меню/пауза/заправка) — не рахуємо
      var d = (typeof dt === 'number' && dt > 0 && dt < 1) ? dt : 0.016;
      updateLimit(d);
      updateHud(d);
      updateEnforcement(d);
    }catch(e){ /* ніколи не ламаємо ігровий цикл */ }
  }
  function spdLimitGetter(){ return spdLimit; }

  window.SPEED = { init: spdInit, step: spdStep, limit: spdLimitGetter };
})();
