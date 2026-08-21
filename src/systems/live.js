import { toast } from '../core/dom.js';
import { car, state } from '../core/state.js';



// ============================================================
// «Київський час» — живий модуль часу доби / світла / погоди
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий
// класичний <script>, що й основна гра — бачить її глобали
// (CFG, map, car, phase, fuel, money, toXY/fromXY, dist, nearestRoad,
// toast, ac, updateHUD) і нічого з них не перевизначає.
//
// Контракт:
//   window.LIVE       — стан (grip/isNight/phaseOfDay/precip/tempC/code/sunriseH/sunsetH)
//   window.liveInit() — одноразова ініціалізація (виклик один раз після завантаження гри)
//   window.liveStep(dt) — виклик щокадру із step(dt); нічого не рахує в фізиці,
//                          лише оновлює візуал і поля LIVE (гравець сам множить
//                          гальмування/зчеплення на LIVE.grip)
// ============================================================
(function(){
  'use strict';

  // ---------- координати Оболоні (ті самі, що CFG.center) ----------
  var OM_LAT = 50.5085, OM_LNG = 30.5030;
  var OM_URL = 'https://api.open-meteo.com/v1/forecast?latitude=' + OM_LAT +
    '&longitude=' + OM_LNG +
    '&current=temperature_2m,weather_code,is_day&daily=sunrise,sunset&timezone=Europe%2FKyiv';

  // ---------- офлайн-фолбек: помісячна таблиця схід/захід для Києва ----------
  // [схід_год.дес, захід_год.дес] — орієнтовні середні по місяцю, локальний час Києва.
  var SUN_FALLBACK = [
    [7.90, 16.60], // січень
    [7.30, 17.40], // лютий
    [6.30, 18.20], // березень
    [6.00, 20.00], // квітень
    [5.30, 20.70], // травень
    [4.90, 21.20], // червень
    [5.20, 21.10], // липень
    [5.90, 20.30], // серпень
    [6.60, 19.30], // вересень
    [7.30, 18.10], // жовтень
    [7.30, 16.60], // листопад
    [8.00, 16.10]  // грудень
  ];

  // ---------- кешовані форматери київського часу (не створювати щокадру) ----------
  var fmtHM = null, fmtMonth = null;
  try{ fmtHM = new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',hour12:false,hour:'2-digit',minute:'2-digit'}); }catch(e){ fmtHM=null; }
  try{ fmtMonth = new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',month:'numeric'}); }catch(e){ fmtMonth=null; }

  function kyivHM(){
    try{
      if(!fmtHM) throw new Error('no intl');
      var parts = fmtHM.formatToParts(new Date());
      var hh='--', mm='--';
      for(var i=0;i<parts.length;i++){
        if(parts[i].type==='hour') hh=parts[i].value;
        else if(parts[i].type==='minute') mm=parts[i].value;
      }
      if(hh==='24') hh='00';
      return {hh:hh, mm:mm};
    }catch(e){
      var d=new Date();
      return {hh:String(d.getHours()).padStart(2,'0'), mm:String(d.getMinutes()).padStart(2,'0')};
    }
  }
  function kyivHourNow(){
    var t=kyivHM();
    var h=parseInt(t.hh,10), m=parseInt(t.mm,10);
    if(isNaN(h)||isNaN(m)) { var d=new Date(); return d.getHours()+d.getMinutes()/60; }
    return h+m/60;
  }
  function kyivMonthNow(){
    try{
      if(!fmtMonth) throw new Error('no intl');
      var v=parseInt(fmtMonth.format(new Date()),10)-1;
      if(isNaN(v)||v<0||v>11) throw new Error('bad month');
      return v;
    }catch(e){ return new Date().getMonth(); }
  }

  // ---------- WMO weather_code → опади ----------
  function classifyPrecip(code){
    if(code==null || isNaN(code)) return 'none';
    if((code>=51 && code<=67) || (code>=80 && code<=82) || (code>=95 && code<=99)) return 'rain';
    if((code>=71 && code<=77) || (code===85 || code===86)) return 'snow';
    return 'none'; // ясно/хмарно/туман (45,48) тощо
  }
  function gripFor(precip){
    if(precip==='rain') return 0.7;
    if(precip==='snow') return 0.55;
    return 1.0;
  }

  // ---------- фази доби: вага golden/twilight/night довкола сходу і заходу ----------
  var GOLDEN_MIN = 40;   // золота година: ±40 хв від сходу/заходу
  var TWI_MIN = 60;      // ще +60 хв на сутінки/світанок після золотої години
  function clamp01(v){ return v<0?0:(v>1?1:v); }
  function circDistH(h,e){ var d=Math.abs(h-e); return Math.min(d,24-d); } // у годинах, з обгортанням доби

  function computeWeights(hour, sunriseH, sunsetH){
    var dayW=0, goldenW=0, twilightW=0, nightW=0;
    var isDaySide = hour>=sunriseH && hour<sunsetH;
    if(isDaySide){
      var dMin = Math.min(hour-sunriseH, sunsetH-hour)*60;
      goldenW = clamp01(1 - dMin/GOLDEN_MIN);
      dayW = 1-goldenW;
    } else {
      var dMin2 = Math.min(circDistH(hour,sunriseH), circDistH(hour,sunsetH))*60;
      goldenW = clamp01(1 - dMin2/GOLDEN_MIN);
      var rem = 1-goldenW;
      var twiFrac = clamp01(1 - Math.max(0,dMin2-GOLDEN_MIN)/TWI_MIN);
      twilightW = rem*twiFrac;
      nightW = rem*(1-twiFrac);
    }
    return {day:dayW, golden:goldenW, twilight:twilightW, night:nightW};
  }
  function dominantPhase(w){
    var m = Math.max(w.day, w.golden, w.twilight, w.night);
    if(w.golden===m) return 'golden';
    if(w.day===m) return 'day';
    if(w.twilight===m) return 'twilight';
    return 'night';
  }

  // базові кольори тінту (RGBA); «день» — прозорий, тому в суму внеску не дає ні кольору, ні альфи
  var COL_GOLDEN   = {r:255,g:171,b:64,  a:0.30};
  var COL_TWILIGHT = {r:64, g:56, b:150, a:0.30};
  var COL_NIGHT    = {r:8,  g:16, b:46,  a:0.42}; // максимум альфи всього тінту — карта завжди читабельна

  function mixTint(w){
    var wSum = w.golden + w.twilight + w.night;
    if(wSum<=0.0001) return {r:0,g:0,b:0,a:0};
    var r=(w.golden*COL_GOLDEN.r + w.twilight*COL_TWILIGHT.r + w.night*COL_NIGHT.r)/wSum;
    var g=(w.golden*COL_GOLDEN.g + w.twilight*COL_TWILIGHT.g + w.night*COL_NIGHT.g)/wSum;
    var b=(w.golden*COL_GOLDEN.b + w.twilight*COL_TWILIGHT.b + w.night*COL_NIGHT.b)/wSum;
    var a= w.golden*COL_GOLDEN.a + w.twilight*COL_TWILIGHT.a + w.night*COL_NIGHT.a; // day не додає альфи
    return {r:r, g:g, b:b, a:a};
  }

  var PHASE_ICON = { day:'☀️', golden:'🌇', twilight:'🌆', night:'🌙' };

  // ---------- парсинг ISO-часу від Open-Meteo (timezone=Europe/Kyiv, наївний рядок без зсуву) ----------
  // Навмисно НЕ через new Date(iso) — це залежало б від таймзони пристрою гравця.
  function parseIsoHour(iso){
    if(!iso) return null;
    var m = /T(\d{2}):(\d{2})/.exec(iso);
    if(!m) return null;
    var h=parseInt(m[1],10), mi=parseInt(m[2],10);
    if(isNaN(h)||isNaN(mi)) return null;
    return h+mi/60;
  }

  // ---------- стан ----------
  var LIVE = null; // призначається у liveInit(); window.LIVE вказує на той самий об'єкт
  var elTint=null, elHL=null, elPrecip=null, elChipTxt=null;
  var prevIsNight=false, lastPrecipClass='', slowTimer=999; // 999 → перший виклик liveStep одразу оновить повільний блок

  function applyFallbackSun(){
    try{
      var mo = kyivMonthNow();
      var row = SUN_FALLBACK[mo] || SUN_FALLBACK[0];
      LIVE.sunriseH = row[0];
      LIVE.sunsetH = row[1];
    }catch(e){ /* лишаємо попередні/дефолтні значення */ }
  }
  function applyFallbackWeather(){
    // офлайн-фолбек за завданням: погода = ясно
    LIVE.code = (LIVE.code==null) ? 0 : LIVE.code;
    LIVE.precip = 'none';
    LIVE.grip = 1.0;
  }

  function fetchWeather(){
    try{
      if(typeof fetch !== 'function') { applyFallbackSun(); applyFallbackWeather(); return; }
      fetch(OM_URL, {cache:'no-store'}).then(function(res){
        if(!res || !res.ok) throw new Error('bad response '+(res&&res.status));
        return res.json();
      }).then(function(data){
        try{
          var cur = (data && data.current) || {};
          var daily = (data && data.daily) || {};
          if(typeof cur.temperature_2m === 'number') LIVE.tempC = Math.round(cur.temperature_2m);
          if(typeof cur.weather_code === 'number') LIVE.code = cur.weather_code;
          var srH = parseIsoHour(daily.sunrise && daily.sunrise[0]);
          var ssH = parseIsoHour(daily.sunset && daily.sunset[0]);
          if(srH!=null) LIVE.sunriseH = srH;
          if(ssH!=null) LIVE.sunsetH = ssH;
          LIVE.precip = classifyPrecip(LIVE.code);
          LIVE.grip = gripFor(LIVE.precip);
        }catch(e2){ applyFallbackSun(); applyFallbackWeather(); }
      }).catch(function(){ applyFallbackSun(); applyFallbackWeather(); });
    }catch(e){ try{ applyFallbackSun(); applyFallbackWeather(); }catch(e2){} }
  }

  // ---------- DOM: тінт карти / конус фар / опади / чіп HUD ----------
  function injectStyles(){
    if(document.getElementById('liveStyles')) return;
    var css =
      '#liveTint{position:fixed;inset:0;z-index:3;pointer-events:none;background:rgba(0,0,0,0);}' +
      '#liveHeadlights{position:fixed;left:50%;top:50%;width:260px;height:280px;margin:-280px 0 0 -130px;' +
        'transform-origin:50% 100%;pointer-events:none;z-index:4;opacity:0;transition:opacity .5s ease;' +
        'clip-path:polygon(41% 100%,59% 100%,88% 6%,12% 6%);' +
        'background:radial-gradient(ellipse 170px 270px at 50% 100%, rgba(255,244,200,.36), rgba(255,244,200,.12) 55%, rgba(255,244,200,0) 78%);}' +
      '#livePrecip{position:fixed;inset:0;z-index:4;pointer-events:none;opacity:0;transition:opacity .4s;}' +
      '#livePrecip.live-rain{opacity:.5;' +
        'background-image:repeating-linear-gradient(112deg, rgba(200,222,255,.55) 0 1.5px, transparent 1.5px 16px);' +
        'background-size:3px 140%;animation:liveRainFall .4s linear infinite;}' +
      '#livePrecip.live-snow{opacity:.65;' +
        'background-image:radial-gradient(circle, rgba(255,255,255,.9) 1.6px, transparent 1.8px);' +
        'background-size:28px 28px;animation:liveSnowFall 4s linear infinite;}' +
      '@keyframes liveRainFall{from{background-position:0 0;}to{background-position:-30px 130px;}}' +
      '@keyframes liveSnowFall{from{background-position:0 0;}to{background-position:16px 240px;}}' +
      '#liveChip{white-space:nowrap;}';
    var styleEl = document.createElement('style');
    styleEl.id = 'liveStyles';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }
  function ensureDom(){
    injectStyles();
    elTint = document.getElementById('liveTint');
    if(!elTint){ elTint=document.createElement('div'); elTint.id='liveTint'; document.body.appendChild(elTint); }
    elHL = document.getElementById('liveHeadlights');
    if(!elHL){ elHL=document.createElement('div'); elHL.id='liveHeadlights'; document.body.appendChild(elHL); }
    elPrecip = document.getElementById('livePrecip');
    if(!elPrecip){ elPrecip=document.createElement('div'); elPrecip.id='livePrecip'; document.body.appendChild(elPrecip); }
    var chip = document.getElementById('liveChip');
    if(!chip){
      chip = document.createElement('div');
      chip.id = 'liveChip';
      chip.className = 'chip';
      var span = document.createElement('span');
      span.id = 'liveChipTxt';
      span.textContent = '…';
      chip.appendChild(span);
      var hud = document.getElementById('hud');
      if(hud) hud.appendChild(chip); else document.body.appendChild(chip);
      elChipTxt = span; // пряме посилання — надійніше за повторний getElementById одразу після вставки
    } else {
      elChipTxt = document.getElementById('liveChipTxt') || elChipTxt;
    }
  }

  function renderChipText(){
    if(!elChipTxt) return;
    try{
      var t = kyivHM();
      var phaseIcon = PHASE_ICON[LIVE.phaseOfDay] || '☀️';
      var precipIcon = LIVE.precip==='rain' ? '🌧' : (LIVE.precip==='snow' ? '❄️' : '');
      var tempBlock = '';
      if(LIVE.tempC!=null){
        var sign = LIVE.tempC>=0 ? '+' : '';
        tempBlock = (precipIcon ? precipIcon+' ' : '') + sign + LIVE.tempC + '°';
      } else if(precipIcon){
        tempBlock = precipIcon;
      }
      elChipTxt.textContent = tempBlock ? (phaseIcon+' '+t.hh+':'+t.mm+' · '+tempBlock) : (phaseIcon+' '+t.hh+':'+t.mm);
    }catch(e){ /* мовчки лишаємо попередній текст */ }
  }

  // повільний блок (~1 раз/с): година, тінт, фаза доби, isNight, тост фар, чіп
  function slowUpdate(){
    var hour = kyivHourNow();
    var w = computeWeights(hour, LIVE.sunriseH, LIVE.sunsetH);
    LIVE.phaseOfDay = dominantPhase(w);

    var tint = mixTint(w);
    if(elTint) elTint.style.background = 'rgba('+(tint.r|0)+','+(tint.g|0)+','+(tint.b|0)+','+tint.a.toFixed(3)+')';

    var nowNight = (hour < LIVE.sunriseH) || (hour >= LIVE.sunsetH);
    LIVE.isNight = nowNight;
    if(elHL) elHL.style.opacity = nowNight ? '1' : '0';
    if(nowNight && !prevIsNight){
      try{
        var okPhase = (typeof state.phase === 'undefined') || state.phase === 'play';
        if(okPhase && typeof toast === 'function') toast('💡 Увімкнув фари');
        if(okPhase) window.PROGRESSION && window.PROGRESSION.event('night_drive');
      }catch(e){ /* ignore */ }
    }
    prevIsNight = nowNight;

    var pClass = LIVE.precip==='rain' ? 'live-rain' : (LIVE.precip==='snow' ? 'live-snow' : '');
    if(elPrecip && pClass!==lastPrecipClass){ elPrecip.className = pClass; lastPrecipClass = pClass; }

    renderChipText();
  }

  // ---------- публічний контракт ----------
  window.LIVE = window.LIVE || {
    grip: 1, isNight: false, phaseOfDay: 'day', precip: 'none',
    tempC: null, code: null, sunriseH: 6, sunsetH: 21
  };

  window.liveInit = function(){
    try{
      if(window.__liveInited) return;
      window.__liveInited = true;
      LIVE = window.LIVE;

      ensureDom();
      applyFallbackSun();        // синхронний фолбек одразу, щоб не чекати мережі для першого кадру
      slowTimer = 999;           // форсує негайний slowUpdate() на першому liveStep
      try{ slowUpdate(); }catch(e){}

      fetchWeather();            // перший запит (без блокування)
      try{
        setInterval(function(){ try{ fetchWeather(); }catch(e){} }, 10*60*1000); // раз на ~10 хв
      }catch(e){ /* ignore */ }
    }catch(e){ /* ніколи не ламаємо завантаження гри */ }
  };

  window.liveStep = function(dt){
    try{
      if(!LIVE) return; // liveInit() ще не викликали
      var d = (typeof dt === 'number' && dt > 0 && dt < 1) ? dt : 0.016;

      // конус фар — щокадру, синхронно з поворотом авто
      if(elHL){
        var heading = 0;
        try{ if(typeof car !== 'undefined' && typeof car.heading === 'number') heading = car.heading; }catch(e){}
        elHL.style.transform = 'rotate('+heading+'rad)';
      }

      // усе, що залежить від часу доби/погоди, — не частіше ~1 раз/с
      slowTimer += d;
      if(slowTimer >= 1){
        slowTimer = 0;
        slowUpdate();
      }
    }catch(e){ /* ніколи не ламаємо цикл гри */ }
  };
})();
