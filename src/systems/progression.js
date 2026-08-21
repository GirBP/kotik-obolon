import { ac, bell } from '../core/audio.js';
import { esc, toast } from '../core/dom.js';
import { updateHUD } from '../ui/hud.js';


// ============================================================
// 🏅 ПРОГРЕСІЯ ВОДІЯ (PROGRESSION) — v0.8
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий
// класичний <script>, що й основна гра (index.html) — бачить її
// глобали лексично й НІЧОГО з них не переоголошує:
//   money, phase, lastT, toast(msg), updateHUD(), esc(s),
//   window.SAVE (.stats()), window.MUTED, ac(), bell(freq,t0,dur,vol)
// DOM: перевикористовує класи .overlay/.card/.cta/.paw/.legend/.hidden
// з index.html (як SETTINGS/SIGNS) — саму розмітку сторінки не чіпає.
//
// Тон (docs/UNIVERSE.md §2,§6): тепло, без гриндфесту й соромлення.
// Досягнення — приємні дрібнички, а не список вимог. Ранги — теплі,
// районні: Новачок → Впевнений водій → Знавець району → Майстер
// дороги → Оболонський ас.
//
// Дані: localStorage['kotik_prog'] = { v, xp, achievements:[...ids],
//   counters:{ deliveries, kmNoFine } } — фіксована форма, achievements
//   не може вирости понад заданий каталог (8 id), counters — 2 числа.
// Також ЧИТАЄ (не пише) localStorage['kotik_signs_seen'] від SIGNS,
// щоб не дублювати підрахунок вивчених знаків.
//
// Усе в try/catch: localStorage може кидати у приватному режимі —
// тоді просто працюємо без збереження, гра ніколи не падає через це.
//
// Контракт: window.PROGRESSION = { init, addXP, event, openPanel, rank }
// ============================================================
(function(){
  'use strict';

  var PROG_KEY   = 'kotik_prog';
  var PROG_VER   = 1;
  var SIGNS_KEY  = 'kotik_signs_seen'; // той самий ключ, що й window.SIGNS (index.html)
  var PERSIST_THROTTLE = 2000; // мс — не частіше ~1 раз/2с пишемо в localStorage (як SAVE)

  // ---- ранги: теплі, районні, пороги «без гринду» ----
  var RANKS = [
    { id:'novak',    name:'Новачок',            min:0    },
    { id:'confident', name:'Впевнений водій',    min:100  },
    { id:'expert',   name:'Знавець району',      min:300  },
    { id:'master',   name:'Майстер дороги',      min:700  },
    { id:'ace',      name:'Оболонський ас',      min:1500 }
  ];

  // ---- досягнення: фіксований каталог з 8 штук, кожне даємо раз ----
  // xp — разовий бонус при розблокуванні (окремо від «базового» XP за дію).
  var ACHIEVEMENTS = {
    first_delivery: { name:'Перша доставка',     icon:'📦', xp:20,
      desc:'Довіз перше замовлення до адресата.' },
    ten_deliveries: { name:'10 доставок',         icon:'🚚', xp:60,
      desc:'Уже справжній кур’єр Оболоні.' },
    five_signs:     { name:'Вивчив 5 знаків',     icon:'🎓', xp:40,
      desc:'Розібрався у п’яти дорожніх знаках.' },
    night_driver:   { name:'Нічний водій',        icon:'🌙', xp:30,
      desc:'Перша поїздка з увімкненими фарами.' },
    no_fines_5km:   { name:'Без штрафів 5 км',    icon:'🐕‍🦺', xp:35,
      desc:'5 км чесної їзди — жодного зауваження від інспектора.' },
    blessed:        { name:'Благословенний',      icon:'⛪', xp:25,
      desc:'Зазирнув до храму за благословенням дороги.' },
    district_wave:  { name:'Хвиля району',        icon:'📻', xp:20,
      desc:'Увімкнув Оболонь FM — хвилю свого району.' },
    neighbor:       { name:'Сусід',                icon:'🐾', xp:20,
      desc:'Лишив теплий слід для інших котиків.' }
  };
  // порядок показу в панелі (стабільний, не залежить від порядку розблокування)
  var ACH_ORDER = ['first_delivery','ten_deliveries','five_signs','night_driver',
                    'no_fines_5km','blessed','district_wave','neighbor'];

  var inited = false;
  var state = null; // { v, xp, achievements:[], counters:{deliveries,kmNoFine} }
  var lastPersistAt = 0, pendingPersist = null;

  // ---- панель профілю: DOM/пауза ----
  var panel=null, body=null, pausedByUs=false;

  function isNum(v){ return typeof v==='number' && isFinite(v); }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }

  function toastSafe(msg){ try{ if(typeof toast==='function') toast(msg); }catch(e){} }
  function _hudSafe(){ try{ if(typeof updateHUD==='function') updateHUD(); }catch(e){} }
  function escSafe(s){ try{ return (typeof esc==='function') ? esc(String(s)) : String(s); }catch(e){ return ''; } }

  // ---- дефолтний стан ----
  function defaults(){
    return { v:PROG_VER, xp:0, achievements:[], counters:{ deliveries:0, kmNoFine:0 } };
  }

  // ---- валідація: битий/чужорідний JSON → дефолт, ніколи не падаємо ----
  function validate(obj){
    try{
      if(!obj || typeof obj!=='object') return null;
      if(obj.v!==PROG_VER) return null;
      if(!isNum(obj.xp) || obj.xp<0) return null;
      if(!Array.isArray(obj.achievements)) return null;
      // фіксований каталог: фільтруємо невідомі/дубльовані id, ріст неможливий
      var seen={}, ach=[];
      for(var i=0;i<obj.achievements.length;i++){
        var id=obj.achievements[i];
        if(typeof id==='string' && ACHIEVEMENTS[id] && !seen[id]){ seen[id]=1; ach.push(id); }
      }
      var c = obj.counters && typeof obj.counters==='object' ? obj.counters : {};
      var deliveries = isNum(c.deliveries) && c.deliveries>=0 ? c.deliveries : 0;
      var kmNoFine = isNum(c.kmNoFine) && c.kmNoFine>=0 ? c.kmNoFine : 0;
      return { v:PROG_VER, xp:obj.xp, achievements:ach, counters:{ deliveries:deliveries, kmNoFine:kmNoFine } };
    }catch(e){ return null; }
  }

  function readRaw(){
    try{
      var raw = localStorage.getItem(PROG_KEY);
      if(!raw) return null;
      return validate(JSON.parse(raw));
    }catch(e){ return null; }
  }
  function writeRaw(obj){
    try{ localStorage.setItem(PROG_KEY, JSON.stringify(obj)); return true; }catch(e){ return false; }
  }

  function persistNow(){
    try{ writeRaw(state); }catch(e){}
    lastPersistAt = nowMs();
  }
  // публічний персист: throttle ~1 раз/2с (як SAVE.save()) — щоб часті виклики
  // (напр. event('km', ...) щокадру під час їзди) не гальмували
  function persist(){
    try{
      clearTimeout(pendingPersist);
      var elapsed = nowMs() - lastPersistAt;
      if(elapsed >= PERSIST_THROTTLE){ persistNow(); }
      else { pendingPersist = setTimeout(persistNow, PERSIST_THROTTLE - elapsed); }
    }catch(e){}
  }

  // ---- ранги: індекс за XP / об'єкт для UI ----
  function rankIndexForXP(xp){
    var idx=0;
    for(var i=0;i<RANKS.length;i++){ if(xp>=RANKS[i].min) idx=i; }
    return idx;
  }
  function rank(){
    try{
      var xp = (state && isNum(state.xp)) ? state.xp : 0;
      var idx = rankIndexForXP(xp);
      var cur = RANKS[idx];
      var next = RANKS[idx+1] || null;
      var pct = next ? Math.max(0, Math.min(1, (xp-cur.min)/(next.min-cur.min))) : 1;
      return {
        id:cur.id, name:cur.name, index:idx, xp:xp, min:cur.min,
        next: next ? next.name : null, nextMin: next ? next.min : null,
        toNext: next ? Math.max(0, next.min-xp) : 0, pct: pct, isMax: !next
      };
    }catch(e){ return { id:'novak', name:'Новачок', index:0, xp:0, min:0, next:'Впевнений водій', nextMin:100, toNext:100, pct:0, isMax:false }; }
  }

  // ---- приємний акорд при новому ранзі (тихо, лише !MUTED) ----
  function playRankChime(){
    try{
      if(window.MUTED) return;
      if(typeof ac !== 'function' || typeof bell !== 'function') return;
      var t0 = ac().currentTime;
      // тепла висхідна мажорна арпеджіо — інша за тембром/ритмом від дзвонів
      // храму (churchBells) і сигналу «привіт» (playHorn), щоб не плутались
      bell(523, t0,       0.16, 0.15);
      bell(659, t0+0.12,  0.16, 0.15);
      bell(784, t0+0.24,  0.20, 0.17);
      bell(1047,t0+0.38,  0.32, 0.18);
    }catch(e){}
  }

  // ---- XP і ранги ----
  function addXP(n, reason){
    try{
      if(!inited) init();
      var amt = (typeof n==='number' && isFinite(n)) ? n : 0;
      if(amt<=0) return;
      var before = rankIndexForXP(state.xp);
      state.xp += amt;
      var after = rankIndexForXP(state.xp);
      if(after > before){
        var r = RANKS[after];
        toastSafe('🏅 Новий ранг: '+r.name);
        playRankChime();
      }
      persist();
    }catch(e){}
  }

  // ---- скільки знаків уже вивчено (читаємо стан SIGNS, не дублюємо) ----
  function countSignsSeen(){
    try{
      var raw = localStorage.getItem(SIGNS_KEY);
      if(!raw) return 0;
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.length : 0;
    }catch(e){ return 0; }
  }

  // ---- розблокувати досягнення (раз назавжди) ----
  function unlock(id){
    try{
      var def = ACHIEVEMENTS[id];
      if(!def) return;
      if(!state.achievements) state.achievements=[];
      if(state.achievements.indexOf(id) !== -1) return;          // вже є
      if(state.achievements.length >= ACH_ORDER.length) return;  // захист: понад фіксований каталог не росте
      state.achievements.push(id);
      toastSafe('🏆 '+def.icon+' Досягнення: '+def.name+' (+'+def.xp+' XP)');
      addXP(def.xp, 'achv:'+id); // сам зробить persist()
      persist();
    }catch(e){}
  }
  function isUnlocked(id){
    try{ return !!(state && state.achievements && state.achievements.indexOf(id)!==-1); }catch(e){ return false; }
  }

  // ---- ігрові події: базовий XP за дію + перевірка ачівок ----
  function event(name, payload){
    try{
      if(!inited) init();
      if(!state) return;
      switch(name){
        case 'delivery':
          state.counters.deliveries = (state.counters.deliveries||0) + 1;
          addXP(15, 'доставка');
          if(state.counters.deliveries===1) unlock('first_delivery');
          if(state.counters.deliveries>=10) unlock('ten_deliveries');
          persist();
          break;
        case 'sign_learned':
          addXP(10, 'знак');
          if(countSignsSeen()>=5) unlock('five_signs');
          persist();
          break;
        case 'church':
          addXP(20, 'храм');
          unlock('blessed');
          persist();
          break;
        case 'fm_on':
          addXP(10, 'Оболонь FM');
          unlock('district_wave');
          persist();
          break;
        case 'trace_left':
          addXP(10, 'слід сусіда');
          unlock('neighbor');
          persist();
          break;
        case 'night_drive':
          unlock('night_driver'); // разова відзнака, XP додає сам unlock()
          break;
        case 'fine':
          // штраф скидає лічильник «чесних» кілометрів (без осуду — просто заново)
          state.counters.kmNoFine = 0;
          persist();
          break;
        case 'km':
          var km = (typeof payload==='number' && isFinite(payload) && payload>0) ? payload : 0;
          if(km<=0) return;
          if(!isUnlocked('no_fines_5km')){
            state.counters.kmNoFine = (state.counters.kmNoFine||0) + km;
            if(state.counters.kmNoFine>=5) unlock('no_fines_5km');
          }
          persist();
          break;
        default: break;
      }
    }catch(e){}
  }

  // ============================================================
  // Панель профілю — .overlay/.card, як SETTINGS/SIGNS
  // ============================================================
  function progressBarHtml(r){
    var pct = Math.round(r.pct*100);
    var sub = r.isMax
      ? 'Максимальний ранг — далі просто гарна дорога 🐾'
      : (r.toNext+' XP до рангу «'+escSafe(r.next)+'»');
    return '' +
      '<div class="legend" style="margin-top:6px;">' +
        '<b>'+escSafe(r.name)+'</b> · '+Math.round(r.xp)+' XP<br>' +
        '<div style="background:#e3e5ea;border-radius:8px;height:10px;margin:8px 0;overflow:hidden;">' +
          '<div style="background:var(--accent,#e8a33a);height:100%;width:'+pct+'%;"></div>' +
        '</div>' +
        '<span style="font-size:12px;color:#666;">'+escSafe(sub)+'</span>' +
      '</div>';
  }

  function achievementsHtml(){
    var rows = ['<div class="legend" style="margin-top:10px;text-align:left;"><b>Досягнення</b><br>'];
    for(var i=0;i<ACH_ORDER.length;i++){
      var id = ACH_ORDER[i], def = ACHIEVEMENTS[id];
      if(!def) continue;
      var got = isUnlocked(id);
      var icon = got ? def.icon : '🔒';
      var style = got ? '' : 'opacity:.5;';
      rows.push('<div style="margin-top:6px;'+style+'">'+icon+' <b>'+escSafe(def.name)+'</b><br>' +
        '<span style="font-size:12px;color:#666;">'+escSafe(def.desc)+'</span></div>');
    }
    rows.push('</div>');
    return rows.join('');
  }

  function statsHtml(){
    try{
      var s = (window.SAVE && window.SAVE.stats) ? window.SAVE.stats() : {totalKm:0,totalEarned:0,sessions:0,money:0};
      var got = (state && state.achievements) ? state.achievements.length : 0;
      return '<div class="legend" style="margin-top:10px;">' +
        '<b>Коротка статистика</b><br>' +
        '🛞 Пробіг: '+(s.totalKm||0).toFixed(1)+' км<br>' +
        '📦 Усього зароблено: '+Math.round(s.totalEarned||0)+' грн<br>' +
        '🚗 Поїздок: '+(s.sessions||0)+'<br>' +
        '🏆 Досягнень: '+got+' з '+ACH_ORDER.length +
        '</div>';
    }catch(e){ return ''; }
  }

  function render(){
    try{
      if(!body) return;
      var r = rank();
      body.innerHTML = progressBarHtml(r) + statsHtml() + achievementsHtml();
    }catch(e){}
  }

  function ensureDom(){
    try{
      panel = document.getElementById('progPanel');
      if(!panel){
        panel = document.createElement('div');
        panel.id='progPanel'; panel.className='overlay hidden';
        panel.innerHTML =
          '<div class="card">' +
            '<div class="paw">🏅</div>' +
            '<h1>Профіль водія</h1>' +
            '<div id="progBody"></div>' +
            '<button class="cta" id="progClose" style="margin-top:12px;">Закрити</button>' +
          '</div>';
        document.body.appendChild(panel);
        panel.addEventListener('click', function(ev){ if(ev.target===panel) closePanel(); });
        var c=document.getElementById('progClose'); if(c) c.addEventListener('click', closePanel);
      }
      body = document.getElementById('progBody');
    }catch(e){}
  }

  // Відкриття лише при phase==='play' (тоді самі ставимо на паузу власною
  // фазою 'progress', як SIGNS робить із 'signs') або коли гра вже на паузі
  // (напр. відкрито з панелі SETTINGS) — тоді нічого з phase не чіпаємо.
  function openPanel(){
    try{
      if(typeof state.phase === 'undefined') return;
      if(state.phase==='play'){ state.phase='progress'; pausedByUs=true; }
      else if(state.phase==='pause'){ pausedByUs=false; }
      else { return; } // інші фази (меню/заправка/знаки/послідовність) — не лізем поверх
      ensureDom();
      render();
      if(panel) panel.classList.remove('hidden');
    }catch(e){}
  }
  function closePanel(){
    try{
      if(panel) panel.classList.add('hidden');
      if(pausedByUs && typeof state.phase!=='undefined' && state.phase==='progress'){
        state.phase='play';
        try{ state.lastT = performance.now(); }catch(e2){}
      }
      pausedByUs=false;
    }catch(e){}
  }

  // ---- init: ідемпотентний ----
  function init(){
    try{
      if(inited) return;
      inited = true;
      state = readRaw() || defaults();
      lastPersistAt = nowMs();
    }catch(e){
      inited = true;
      state = defaults();
    }
  }

  window.PROGRESSION = { init:init, addXP:addXP, event:event, openPanel:openPanel, rank:rank };
})();
