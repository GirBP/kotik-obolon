import { ac, bell } from '../core/audio.js';
import { MP_BROKERS } from '../core/config.js';
import { toast } from '../core/dom.js';
import { fromXY } from '../core/geo.js';
import { car, state, stations } from '../core/state.js';
import { updateHUD } from '../ui/hud.js';
import { dist, map } from '../world/map.js';
import { poiIcon } from '../world/markers.js';
import { mp } from './multiplayer.js';



// ============================================================
// «Сліди сусідів» — теплий соціальний шар (v0.6)
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий
// класичний <script>, що й основна гра — бачить її глобали й нічого
// з них не перевизначає:
//   map (Leaflet), car{x,y,heading,speed,...}, phase ('play' під час їзди),
//   money (let), fuel (let), toXY/fromXY, dist(aLat,aLng,bLat,bLng),
//   toast(msg), updateHUD(), ac(), bell(freq,t0,dur,vol),
//   stations[], mp{nick,...}, MP_BROKERS[], window.mqtt, poiIcon(cls,emoji),
//   DOM: #actions, #hud
//
// Інші гравці присутні в районі не машинами, а слідами доброти:
// кожен слід — окремий retained MQTT-топік kotikobolon/traces/<id>.
// Новий клієнт при підписці на kotikobolon/traces/# одразу отримує
// всі збережені сліди (це і є вся «мережа» — без сервера).
// Порожній payload у retained-топіку = слід видалено.
//
// Контракт:
//   window.TRACES.init()        — одноразово при завантаженні (готує
//                                  кнопку/DOM/стан; MQTT ще НЕ підключає)
//   window.TRACES.step(dt)      — виклик щокадру із step(dt) під час
//                                  phase==='play' (перший виклик — тригер
//                                  підключення до MQTT)
//   window.TRACES.setEnabled(b) — увімк/вимк фічу (persist у localStorage)
//   window.TRACES.enabled       — поточний прапорець (bool)
//   window.TRACES.leaveMenu()   — примусово закрити меню вибору сліду
// ============================================================
(function(){
  'use strict';

  // ---------- ключі localStorage ----------
  var LS_ON            = 'kotik_traces_on';        // '1' | '0'
  var LS_DAY            = 'kotik_traces_day';       // {date:'YYYY-M-D', count:N}
  var LS_MINE           = 'kotik_traces_mine';      // {id: expMs, ...} — власні сліди
  var LS_COFFEE_CLAIMED = 'kotik_coffee_claimed';   // [id, id, ...]

  var TOPIC_BASE = 'kotikobolon/traces/';
  var TOPIC_WILD = 'kotikobolon/traces/#';

  var DAY_MS = 24*3600*1000;

  // ---------- типи слідів: ГОТОВІ фрази, гравець лише обирає ----------
  var TYPES = {
    beauty: {
      emoji:'📍', label:'Краса', exp: 7*DAY_MS,
      phrases:['Звідси гарний захід 🌇','Тут тихо і добре','Гарний краєвид на Дніпро','Улюблене місце району']
    },
    warn: {
      emoji:'⚠️', label:'Обережно', exp: 7*DAY_MS,
      phrases:['Обережно, яма','Тут часто пішоходи','Слизько після дощу','Уважно — діти']
    },
    coffee: {
      emoji:'☕', label:'Підвішена кава', exp: 2*DAY_MS, cost:40,
      phrases:['Гарного дня, котику ☕','Ти впораєшся',"З любов'ю від сусіда"]
    },
    hello: {
      emoji:'📣', label:'Привіт (гудок)', exp: 12*3600*1000,
      phrases:[]
    }
  };

  var STATION_NEAR_R = 30;   // м — АЗС поруч, щоб лишити каву
  var COFFEE_CLAIM_R = 25;   // м — до чужої кави, щоб забрати
  var HELLO_HEAR_R   = 30;   // м — до чужого привіту, щоб почути гудок
  var SLOW_SPEED     = 8;    // км/год — «стоїть» (як у updateCtx)
  var DAILY_MAX      = 5;
  var COOLDOWN_MS    = 10000;
  var PROX_EVERY_S   = 0.25; // як часто перевіряти близькість (не щокадру)

  // ---------- приватний стан модуля ----------
  var myClientId   = 'ktr_' + Math.random().toString(36).slice(2,10);
  var mqttClient    = null;
  var brokerIdx     = 0;
  var mqttUnavailable = false;

  var tracesById    = new Map(); // id -> {data, marker, mine, lat, lng}
  var mineMap       = {};        // id -> expMs (власні сліди; переживає перезавантаження)
  var claimedSet    = new Set(); // id забраних кав
  var heardHello    = new Set(); // id привітів, почутих ЦІЄЇ сесії

  var layer         = null;      // L.layerGroup з усіма маркерами слідів
  var elBtn         = null, elMenu = null, elList = null, elClaim = null;
  var _menuView       = 'root';
  var nearCoffeeId   = null;
  var lastCreateAt   = 0;
  var proxAccum      = 0;

  // ---------- дрібні хелпери ----------
  function toastSafe(msg){ try{ if(typeof toast==='function') toast(msg); }catch(e){} }

  function loadJSON(key, fallback){
    try{ var raw=localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch(e){ return fallback; }
  }
  function saveJSON(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }

  function localDateKey(){
    var d=new Date();
    return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
  }

  function getNick(){
    try{ if(mp && mp.nick) return String(mp.nick).slice(0,12); }catch(e){}
    try{ var n=localStorage.getItem('mpNick'); if(n) return String(n).slice(0,12); }catch(e){}
    return 'Котик';
  }

  function nearAnyStation(){
    try{
      if(typeof stations==='undefined' || !stations || !stations.length) return false;
      var p=fromXY(car.x,car.y);
      for(var i=0;i<stations.length;i++){
        var s=stations[i];
        if(dist(p.lat,p.lng,s.lat,s.lng) < STATION_NEAR_R) return true;
      }
    }catch(e){}
    return false;
  }

  function newTraceId(){
    return 'tr'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  }

  // ---------- «власні» сліди (щоб інакше показувати й вміти прибрати прострочені) ----------
  function loadMine(){
    var obj = loadJSON(LS_MINE, {});
    if(!obj || typeof obj!=='object') obj={};
    return obj;
  }
  function saveMine(){ saveJSON(LS_MINE, mineMap); }
  function markMine(id, exp){ try{ mineMap[id]=exp; saveMine(); }catch(e){} }
  function isMine(id){ return !!(mineMap && Object.prototype.hasOwnProperty.call(mineMap,id)); }

  // ---------- забрані кави (щоб не забрати двічі) ----------
  // M3: масив інакше росте назавжди — відкидаємо застарілі id (>3 доби; кава й так
  // живе лише 2 доби, тож 3 — надійний запас) і підстраховуємось лімітом розміру.
  var CLAIMED_MAX_AGE_MS = 3*DAY_MS;
  var CLAIMED_MAX_COUNT  = 200;
  function claimedIdAgeMs(id){
    try{
      if(typeof id!=='string' || id.slice(0,2)!=='tr' || id.length<=8) return null;
      var t36 = id.slice(2, id.length-6);
      var t = parseInt(t36, 36);
      if(!isFinite(t) || t<=0) return null;
      return Date.now() - t;
    }catch(e){ return null; }
  }
  function loadClaimed(){
    var arr = loadJSON(LS_COFFEE_CLAIMED, []);
    if(!Array.isArray(arr)) arr=[];
    arr = arr.filter(function(id){
      var age = claimedIdAgeMs(id);
      return age===null ? true : age <= CLAIMED_MAX_AGE_MS; // невпізнаний формат — лишаємо, покладаємось на ліміт розміру нижче
    });
    if(arr.length > CLAIMED_MAX_COUNT) arr = arr.slice(arr.length - CLAIMED_MAX_COUNT);
    return new Set(arr);
  }
  function saveClaimed(){ try{ saveJSON(LS_COFFEE_CLAIMED, Array.from(claimedSet)); }catch(e){} }
  function isCoffeeClaimed(id){ return claimedSet.has(id); }
  function markCoffeeClaimed(id){ claimedSet.add(id); saveClaimed(); }

  // ---------- антиспам: ≤5 власних слідів/добу + кулдаун ~10с ----------
  function canCreateToday(){
    var day = loadJSON(LS_DAY, {date:'',count:0});
    return day.date !== localDateKey() || day.count < DAILY_MAX;
  }
  function bumpDailyCounter(){
    var day = loadJSON(LS_DAY, {date:'',count:0});
    var key = localDateKey();
    if(day.date !== key) day = {date:key, count:0};
    day.count++;
    saveJSON(LS_DAY, day);
  }

  // ---------- звук: тихий клаксон-«привіт» ----------
  function playHorn(){
    try{
      var t0 = ac().currentTime;
      bell(520, t0,      0.14, 0.14);
      bell(390, t0+0.10, 0.18, 0.14);
    }catch(e){}
  }

  // ================= MQTT =================
  function connectMqtt(){
    try{
      var url = MP_BROKERS[brokerIdx % MP_BROKERS.length];
      mqttClient = mqtt.connect(url, { clientId:myClientId, keepalive:30, connectTimeout:6000 });
    }catch(e){
      mqttClient=null;
      brokerIdx++;
      if(brokerIdx < MP_BROKERS.length) connectMqtt();
      else { mqttUnavailable=true; applyEnabledVisual(); }
      return;
    }
    try{
      mqttClient.on('connect', function(){
        try{ mqttClient.subscribe(TOPIC_WILD); }catch(e){}
      });
      mqttClient.on('message', function(topic, payload){
        try{ handleIncoming(topic, payload); }catch(e){}
      });
      mqttClient.on('error', function(){
        try{ mqttClient.end(true); }catch(e){}
        mqttClient=null;
        brokerIdx++;
        if(brokerIdx < MP_BROKERS.length && window.TRACES.enabled){ connectMqtt(); }
        else { mqttUnavailable=true; applyEnabledVisual(); }
      });
    }catch(e){ mqttClient=null; mqttUnavailable=true; applyEnabledVisual(); }
  }

  function disconnectMqtt(){
    try{ if(mqttClient) mqttClient.end(true); }catch(e){}
    mqttClient=null;
    try{
      tracesById.forEach(function(t){ try{ layer.removeLayer(t.marker); }catch(e){} });
    }catch(e){}
    tracesById.clear();
    nearCoffeeId=null;
  }

  function ensureConnected(){
    try{
      if(!window.TRACES.enabled || mqttUnavailable || mqttClient) return;
      if(typeof state.phase==='undefined' || state.phase!=='play') return;
      if(!window.mqtt){ mqttUnavailable=true; applyEnabledVisual(); return; }
      connectMqtt();
    }catch(e){}
  }

  function handleIncoming(topic, payloadBuf){
    if(typeof topic!=='string' || topic.indexOf(TOPIC_BASE)!==0) return;
    var id = topic.slice(TOPIC_BASE.length);
    if(!id) return;
    var raw = payloadBuf ? payloadBuf.toString() : '';
    if(!raw){ removeTraceMarker(id); tracesById.delete(id); heardHello.delete(id); return; }
    if(raw.length>4096){ return; } // публічний retained-топік — захист від велетенського сміття
    var d;
    try{ d=JSON.parse(raw); }catch(e){ return; }
    if(!d || !d.id || !TYPES[d.type] || typeof d.x!=='number' || typeof d.y!=='number') return;
    if(d.exp && Date.now() > d.exp){
      removeTraceMarker(id); tracesById.delete(id); heardHello.delete(id);
      if(isMine(id)) clearOwnTrace(id);
      return;
    }
    upsertTrace(id, d);
  }

  function clearOwnTrace(id){
    try{ if(mqttClient && mqttClient.connected) mqttClient.publish(TOPIC_BASE+id, '', {retain:true}); }catch(e){}
    try{ delete mineMap[id]; saveMine(); }catch(e){}
  }

  function pruneOwnExpired(){
    var now=Date.now(), changed=false;
    for(var id in mineMap){
      if(!Object.prototype.hasOwnProperty.call(mineMap,id)) continue;
      if(now > mineMap[id]){
        if(tracesById.has(id)){
          removeTraceMarker(id); tracesById.delete(id);
          try{ if(mqttClient && mqttClient.connected) mqttClient.publish(TOPIC_BASE+id, '', {retain:true}); }catch(e){}
        }
        delete mineMap[id]; changed=true;
      }
    }
    if(changed) saveMine();
  }

  // M1: чужі сліди прострочуються тим самим exp, але їх ніхто локально не прибирав —
  // без цього tracesById/heardHello ростуть, доки хтось не опублікує порожній payload.
  function pruneForeignExpired(){
    try{
      var now = Date.now();
      tracesById.forEach(function(t, id){
        if(t && t.data && t.data.exp && now > t.data.exp){
          removeTraceMarker(id); tracesById.delete(id); heardHello.delete(id);
        }
      });
    }catch(e){}
  }

  // ================= маркери на карті =================
  function upsertTrace(id, d){
    var typeDef = TYPES[d.type]; if(!typeDef) return;
    var mine = isMine(id);
    var p; try{ p=fromXY(d.x,d.y); }catch(e){ return; }
    var existing = tracesById.get(id);
    if(existing){
      existing.data=d; existing.lat=p.lat; existing.lng=p.lng;
      try{ existing.marker.setLatLng([p.lat,p.lng]); }catch(e){}
      return;
    }
    var cls = 'trace-'+d.type + (mine ? ' trace-mine' : '');
    var marker;
    try{ marker = L.marker([p.lat,p.lng], {icon:poiIcon(cls, typeDef.emoji)}).addTo(layer); }
    catch(e){ return; }
    try{
      marker.on('click', function(){
        try{
          var who = mine ? 'Твій слід' : (d.nick || 'Сусід');
          var text = d.type==='hello' ? (who + (mine ? ' (привіт)' : ' тут проїжджав')) :
                     (d.msg ? (who+': «'+d.msg+'»') : who);
          toastSafe(typeDef.emoji+' '+text);
        }catch(e){}
      });
    }catch(e){}
    tracesById.set(id, {data:d, marker:marker, mine:mine, lat:p.lat, lng:p.lng});
  }

  function removeTraceMarker(id){
    var t=tracesById.get(id);
    if(t && t.marker){ try{ layer.removeLayer(t.marker); }catch(e){} }
  }

  // ================= створення нового сліду =================
  function createTrace(type, msgText){
    try{
      if(!window.TRACES.enabled || mqttUnavailable) return false;
      var typeDef = TYPES[type]; if(!typeDef) return false;
      var now = Date.now();
      if(now - lastCreateAt < COOLDOWN_MS){ toastSafe('🐾 Зачекай трохи перед новим слідом'); return false; }
      if(!canCreateToday()){ toastSafe('🐾 На сьогодні слідів досить — повертайся завтра'); return false; }
      if(type==='coffee'){
        if(typeof state.money!=='number' || state.money < typeDef.cost){ toastSafe('☕ Не вистачає грошей на каву (40 грн)'); return false; }
        if(!nearAnyStation()){ toastSafe('☕ Каву можна лишити лише біля АЗС'); return false; }
      }
      if(!mqttClient || !mqttClient.connected){ toastSafe('🐾 Немає звʼязку — слід не надіслано'); return false; }
      var id = newTraceId();
      var exp = now + typeDef.exp;
      var payload = { id:id, type:type, msg: msgText||'', nick:getNick(),
                       x:+car.x.toFixed(1), y:+car.y.toFixed(1), t:now, exp:exp };
      try{ mqttClient.publish(TOPIC_BASE+id, JSON.stringify(payload), {retain:true, qos:0}); }
      catch(e){ toastSafe('🐾 Не вдалось надіслати слід'); return false; }
      if(type==='coffee'){ try{ state.money -= typeDef.cost; updateHUD(); }catch(e){} }
      lastCreateAt = now;
      bumpDailyCounter();
      markMine(id, exp);
      upsertTrace(id, payload);
      try{ window.PROGRESSION && window.PROGRESSION.event('trace_left'); }catch(e){}
      return true;
    }catch(e){ return false; }
  }

  // ================= близькість: кава-забрати / гудок-привіт =================
  function checkProximity(){
    try{
      var p = fromXY(car.x, car.y);
      var slow = Math.abs(car.speed) < SLOW_SPEED;
      var bestId=null, bestD=Infinity;
      tracesById.forEach(function(t, id){
        var d=t.data;
        if(d.type==='coffee' && !t.mine && !isCoffeeClaimed(id) && slow){
          var dc = dist(p.lat,p.lng,t.lat,t.lng);
          if(dc < COFFEE_CLAIM_R && dc < bestD){ bestD=dc; bestId=id; }
        }
        if(d.type==='hello' && !t.mine && !heardHello.has(id)){
          var dh = dist(p.lat,p.lng,t.lat,t.lng);
          if(dh < HELLO_HEAR_R){
            heardHello.add(id);
            playHorn();
            toastSafe('🐾 '+(d.nick||'Сусід')+' передав тут привіт');
          }
        }
      });
      nearCoffeeId = bestId;
      updateClaimButtonVisibility();
    }catch(e){}
  }

  function doClaimCoffee(){
    try{
      var id = nearCoffeeId; if(!id) return;
      if(isCoffeeClaimed(id)){ nearCoffeeId=null; updateClaimButtonVisibility(); return; }
      var t = tracesById.get(id);
      if(!t){ nearCoffeeId=null; updateClaimButtonVisibility(); return; }
      var d = t.data;
      markCoffeeClaimed(id);
      if(typeof state.money==='number'){ state.money += 40; try{ updateHUD(); }catch(e){} }
      try{ window.SFX&&window.SFX.play('cash'); }catch(e){}
      toastSafe('☕ Кава забрана!'+(d.msg ? (' «'+d.msg+'»') : '')+' +40 грн');
      removeTraceMarker(id); tracesById.delete(id);
      try{ if(mqttClient && mqttClient.connected) mqttClient.publish(TOPIC_BASE+id, '', {retain:true}); }catch(e){}
      nearCoffeeId=null;
      updateClaimButtonVisibility();
    }catch(e){}
  }

  function updateClaimButtonVisibility(){
    try{
      if(!elClaim) return;
      var show = window.TRACES.enabled && !!nearCoffeeId &&
                 (typeof state.phase==='undefined' || state.phase==='play');
      elClaim.style.display = show ? 'block' : 'none';
    }catch(e){}
  }

  // ================= UI: кнопка + меню вибору сліду =================
  function injectStyles(){
    if(document.getElementById('tracesStyles')) return;
    var css =
      '#trClaim{position:absolute;left:50%;bottom:322px;transform:translateX(-50%);z-index:12;pointer-events:auto;'+
        'background:#c98a2e;color:#fff;font-weight:800;font-size:14px;padding:11px 18px;border:none;border-radius:16px;'+
        'box-shadow:0 6px 18px rgba(0,0,0,.35);display:none;}'+
      '#trClaim:active{transform:translateX(-50%) scale(.95);}'+
      '#trList .trOpt:disabled{opacity:.45;}'+
      '.poi.trace-beauty{background:#2b9d6b;}'+
      '.poi.trace-warn{background:#d97b1f;}'+
      '.poi.trace-coffee{background:#a9662c;}'+
      '.poi.trace-hello{background:#3a7fd9;}'+
      '.poi.trace-mine{opacity:.72;filter:saturate(.75);'+
        'box-shadow:0 0 0 2px rgba(255,255,255,.55),0 2px 5px rgba(0,0,0,.35);}';
    var styleEl=document.createElement('style');
    styleEl.id='tracesStyles';
    styleEl.textContent=css;
    document.head.appendChild(styleEl);
  }

  function ensureDom(){
    injectStyles();

    elBtn = document.getElementById('traceBtn');
    if(!elBtn){
      elBtn = document.createElement('button');
      elBtn.className='act'; elBtn.id='traceBtn'; elBtn.title='Слід сусіда';
      elBtn.innerHTML='🐾<small>СЛІД</small>';
      var actions=document.getElementById('actions');
      if(actions) actions.appendChild(elBtn); else document.body.appendChild(elBtn);
      elBtn.addEventListener('click', openMenu);
    }

    elMenu = document.getElementById('trOverlay');
    if(!elMenu){
      elMenu = document.createElement('div');
      elMenu.id='trOverlay'; elMenu.className='overlay hidden';
      elMenu.innerHTML =
        '<div class="card">'+
          '<div class="paw">🐾</div>'+
          '<h1>Слід сусіда</h1>'+
          '<p>Тепла присутність — без токсу. Обери, що лишити тут.</p>'+
          '<div id="trList"></div>'+
          '<button class="cta sec" id="trClose" style="margin-top:8px;">Закрити</button>'+
        '</div>';
      document.body.appendChild(elMenu);
      elMenu.addEventListener('click', function(e){ if(e.target===elMenu) closeMenu(); });
      var closeBtn=document.getElementById('trClose');
      if(closeBtn) closeBtn.addEventListener('click', closeMenu);
    }
    elList = document.getElementById('trList');

    elClaim = document.getElementById('trClaim');
    if(!elClaim){
      elClaim = document.createElement('button');
      elClaim.id='trClaim'; elClaim.textContent='☕ Забрати каву';
      document.body.appendChild(elClaim);
      elClaim.addEventListener('click', doClaimCoffee);
    }

    if(!layer){ try{ layer = L.layerGroup(); }catch(e){} }
  }

  function trOptHtml(key,label,disabled){
    return '<button class="cta sec trOpt" data-k="'+key+'" style="margin-top:8px;"'+(disabled?' disabled':'')+'>'+label+'</button>';
  }

  function renderRoot(){
    _menuView='root';
    if(!elList) return;
    var parts=[];
    parts.push(trOptHtml('beauty', TYPES.beauty.emoji+' '+TYPES.beauty.label, false));
    parts.push(trOptHtml('warn',   TYPES.warn.emoji+' '+TYPES.warn.label, false));
    var canLeaveCoffee = nearAnyStation();
    var haveMoney = (typeof state.money==='number') && state.money >= TYPES.coffee.cost;
    if(canLeaveCoffee){
      var lbl = TYPES.coffee.emoji+' '+TYPES.coffee.label+' — '+TYPES.coffee.cost+' грн'+(haveMoney?'':' (не вистачає)');
      parts.push(trOptHtml('coffee', lbl, !haveMoney));
    } else {
      parts.push('<div class="legend">'+TYPES.coffee.emoji+' Підвішену каву можна лишити лише біля АЗС</div>');
    }
    parts.push(trOptHtml('hello', TYPES.hello.emoji+' '+TYPES.hello.label, false));
    elList.innerHTML = parts.join('');

    var opts = elList.querySelectorAll('.trOpt');
    for(var i=0;i<opts.length;i++){
      (function(btn){
        btn.addEventListener('click', function(){
          var k=btn.getAttribute('data-k');
          if(k==='hello'){
            playHorn();
            var ok=createTrace('hello','');
            if(ok) toastSafe('📣 Привіт передано сусідам!');
            closeMenu();
          } else {
            renderPhrases(k);
          }
        });
      })(opts[i]);
    }
  }

  function renderPhrases(type){
    _menuView=type;
    var def=TYPES[type];
    if(!elList || !def) return;
    var parts=['<button class="cta sec" id="trBack" style="margin-top:0;">← Назад</button>'];
    for(var i=0;i<def.phrases.length;i++){
      parts.push('<button class="cta sec trPh" data-i="'+i+'" style="margin-top:8px;">'+def.phrases[i]+'</button>');
    }
    elList.innerHTML = parts.join('');

    var back=document.getElementById('trBack');
    if(back) back.addEventListener('click', renderRoot);

    var phBtns = elList.querySelectorAll('.trPh');
    for(var j=0;j<phBtns.length;j++){
      (function(btn){
        btn.addEventListener('click', function(){
          var idx=parseInt(btn.getAttribute('data-i'),10);
          var msg=def.phrases[idx];
          var ok=createTrace(type, msg);
          if(ok) toastSafe(def.emoji+' Слід залишено: «'+msg+'»');
          closeMenu();
        });
      })(phBtns[j]);
    }
  }

  function openMenu(){
    try{
      if(!window.TRACES.enabled || mqttUnavailable){ toastSafe('🐾 Сліди сусідів зараз недоступні'); return; }
      ensureDom();
      renderRoot();
      if(elMenu) elMenu.classList.remove('hidden');
    }catch(e){}
  }
  function closeMenu(){
    try{ if(elMenu) elMenu.classList.add('hidden'); }catch(e){}
  }

  // ================= увімк/вимк =================
  function applyEnabledVisual(){
    try{
      if(elBtn) elBtn.style.display = (window.TRACES.enabled && !mqttUnavailable) ? '' : 'none';
      if(!window.TRACES.enabled){
        closeMenu();
        if(elClaim) elClaim.style.display='none';
        try{ if(layer) map.removeLayer(layer); }catch(e){}
      } else {
        try{ if(layer && !map.hasLayer(layer)) layer.addTo(map); }catch(e){}
      }
    }catch(e){}
  }

  // ================= публічний контракт =================
  window.TRACES = window.TRACES || {};
  window.TRACES.enabled = true;

  window.TRACES.init = function(){
    try{
      if(window.__tracesInited) return;
      window.__tracesInited = true;

      var onPref = null;
      try{ onPref = localStorage.getItem(LS_ON); }catch(e){}
      window.TRACES.enabled = (onPref===null) ? true : (onPref==='1' || onPref==='true');

      mineMap = loadMine();
      claimedSet = loadClaimed();

      ensureDom();
      applyEnabledVisual();
    }catch(e){}
  };

  window.TRACES.step = function(dt){
    try{
      ensureConnected();
      if(!window.TRACES.enabled){ if(elClaim) elClaim.style.display='none'; return; }
      if(typeof state.phase==='undefined' || state.phase!=='play'){ if(elClaim) elClaim.style.display='none'; return; }
      var d = (typeof dt==='number' && dt>0 && dt<1) ? dt : 0.016;
      proxAccum += d;
      if(proxAccum >= PROX_EVERY_S){
        proxAccum = 0;
        checkProximity();
        pruneOwnExpired();
        pruneForeignExpired();
      }
    }catch(e){}
  };

  window.TRACES.setEnabled = function(v){
    try{
      var val = !!v;
      window.TRACES.enabled = val;
      try{ localStorage.setItem(LS_ON, val ? '1' : '0'); }catch(e){}
      if(!val){
        closeMenu();
        disconnectMqtt();
      } else {
        mqttUnavailable=false; // дає тумблеру відновити фічу після мережевого збою
      }
      applyEnabledVisual();
      if(val) ensureConnected();
    }catch(e){}
  };

  window.TRACES.leaveMenu = function(){ closeMenu(); };
})();
