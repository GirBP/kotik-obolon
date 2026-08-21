import { esc, toast } from '../core/dom.js';
import { fromXY } from '../core/geo.js';
import { car, radio, state } from '../core/state.js';
import { speakLines } from '../core/tts.js';
import { updateHUD } from '../ui/hud.js';
import { dist, map } from '../world/map.js';
import { poiIcon } from '../world/markers.js';


// ================= 🎙️ ОБОЛОНЬ FM: КВЕСТИ Й ДЗВІНКИ В ЕФІР (FMQUESTS, v0.8) =================
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий класичний
// <script>, що й основна гра (ЩЕ ОДИН inline-модуль, той самий патерн, що й
// window.FM / window.PEDS / window.TRACES) — бачить її глобали й НІЧОГО з них
// не перевизначає:
//   map (Leaflet), car{x,y,heading,speed,...}, phase (let-змінна; 'play' під
//   час активної їзди — НЕ функція), money (let), toXY/fromXY, dist(aLat,aLng,
//   bLat,bLng)->метри, toast(msg), speakLines(lines[])->bool, poiIcon(cls,emoji),
//   esc(s), window.MUTED, window.FM{on,event}, window.SAVE{addEarned,save},
//   updateHUD().
//   Також захисно (typeof-перевіркою) читає `radio` — локальне радіо біля
//   Сенсу/церков: поки воно грає, FMQUESTS не накладає свій голос зверху
//   (щоб не було двох голосів одночасно), але сам об'єктив (маркер/оголошення)
//   це не блокує — просто TTS цього разу мовчить, є toast.
//
// Ідея: районна станція Оболонь FM (та сама, що й window.FM) час від часу
// оголошує КВЕСТ («на набережній потрібна допомога») або приймає ДЗВІНОК
// В ЕФІР від слухача («заїдь забери мене з Х, довези до Y»). Гравець нічого
// не приймає руками — щойно диджей оголосив, це вже активний об'єктив:
// один-єдиний маркер на карті. Доїхав ближче ~25м до цілі — готово.
//
// Дані: data/fm_quests.json -> { quests:[{id,title,dj_intro,type,target:
// {name,lat,lng},reward,dj_outro}], calls:[{caller,request,from:{name,lat,lng},
// to:{name,lat,lng},reward}] }. Якщо fetch не вдався або формат неочікуваний —
// мовчазний фолбек на вбудований FMQ_FALLBACK нижче (ті самі реальні точки
// Оболоні, що й LANDMARKS/pois.json — канон «справжність місця» не ламаємо).
//
// Контракт: window.FMQUESTS = { init, step }
//   init() — одноразово (ІДЕМПОТЕНТНО) при завантаженні: fetch даних,
//            підготовка стану, ін'єкція власного CSS-класу маркера.
//            Мережевий виклик, нічого не блокує.
//   step(dt) — виклик щокадру (як window.PEDS.step(dt)) з основного ігрового
//            циклу під час phase==='play'. Сам собі рано виходить, якщо
//            радіо вимкнено / гра не в грі.
//
// Надійність: усе в try/catch (збій цього модуля ніколи не ламає гру);
// throttle — акумулятор ігрового dt (НЕ setInterval, НЕ щокадру побічні
// ефекти); рівно ОДИН активний об'єктив і ОДИН маркер за раз — перш ніж
// оголосити новий, попередній обов'язково завершено чи прибрано; текст, що
// йде в innerHTML маркера, проходить esc(); нічого не росте колекціями —
// стан це щонайбільше один активний об'єктив-обʼєкт.
// ============================================================
window.FMQUESTS = (function(){
  'use strict';

  // ---------- налаштування ----------
  var ARRIVE_M    = 25;    // м — радіус «доїхав до цілі» (за ТЗ, не CFG.arrive)
  var GAP_MIN_S   = 75;    // c — розкид навколо цілі ~90с (не метроном)
  var GAP_MAX_S   = 105;
  var CALL_CHANCE = 0.5;   // якщо є і квести, і дзвінки — шанс обрати саме дзвінок

  // ---------- стан модуля (усі імена з префіксом fq, щоб не перетнутись з рештою гри) ----------
  var fqInited  = false;        // ідемпотентність init()
  var fqData    = null;         // { quests:[...], calls:[...] } — з fm_quests.json або фолбек
  var fqAcc     = 0;            // акумулятор часу до наступного оголошення, c
  var fqNextGap = 90;           // ціль накопичення поточного циклу, c (рандомиться)
  var fqActive  = null;         // { kind:'quest'|'call', data, stage } — ОДИН активний об'єктив
  var fqMarker  = null;         // Leaflet-маркер поточного об'єктиву — ОДИН

  // ---------- фолбек-контент: реальні точки Оболоні (канон «справжність місця») ----------
  var FMQ_FALLBACK = {
    quests: [
      { id:'q_sens', title:'Книжки для «Сенсу»', dj_intro:'Друзі, книгарні «Сенс» на Оболоні потрібна допомога — завезіть, будь ласка, коробку книжок!', type:'delivery', target:{ name:'Книгарня «Сенс»', lat:50.5232, lng:30.4978 }, reward:55, dj_outro:'Книжки доїхали! «Сенс» дякує — і ми дякуємо.' },
      { id:'q_naberezhna', title:'Вода для волонтерів', dj_intro:'На набережній волонтери прибирають берег — підвезіть, будь ласка, воду для команди.', type:'volunteer', target:{ name:'Оболонська набережна', lat:50.5115, lng:30.516 }, reward:45, dj_outro:'Воду довезли, спраглих не лишили. Дякуємо!' },
      { id:'q_opechen', title:'Корм для качок', dj_intro:'Біля озера Опечень порожня годівниця — хто підвезе корм для качок?', type:'care', target:{ name:'Озеро Опечень', lat:50.514, lng:30.5065 }, reward:40, dj_outro:'Качки на Опечені вже ситі. Гарна справа!' },
      { id:'q_dreamtown', title:'Загублена парасолька', dj_intro:'У Dream Town хтось загубив парасольку — довезіть до інфостійки, будь ласка.', type:'lostfound', target:{ name:'ТРЦ Dream Town', lat:50.5236, lng:30.4972 }, reward:35, dj_outro:'Парасолька повернулась до господаря. Оболонь FM це любить.' },
      { id:'q_park', title:'Горішки для білочок', dj_intro:'У парку «Наталка» просять привезти горішки для білочок — хто поруч?', type:'care', target:{ name:'Парк «Наталка»', lat:50.5188, lng:30.5192 }, reward:40, dj_outro:'Білочки в парку «Наталка» вже пригощаються. Дякуємо!' },
      { id:'q_pokrovsky', title:'Свічки для храму', dj_intro:'Свято-Покровському храму привезли свічки з майстерні — довезете востаннє до дверей?', type:'delivery', target:{ name:'Свято-Покровський храм', lat:50.51212, lng:30.51242 }, reward:50, dj_outro:'Свічки на місці. Гарної дороги зі спокійним серцем.' },
      { id:'q_wog', title:'Забутий термос', dj_intro:'На заправці WOG хтось забув термос за кермом — підвезіть господарю, він чекає там само.', type:'lostfound', target:{ name:'АЗС WOG', lat:50.52805, lng:30.48267 }, reward:30, dj_outro:'Термос знайшов господаря. Кава ще гаряча, кажуть.' }
    ],
    calls: [
      { caller:'Оксана з Мінської', request:'Ой, привіт в ефір! Заберіть мене від метро «Мінська» і довезіть до озера Опечень, будь ласка.', from:{ name:'Метро «Мінська»', lat:50.5122, lng:30.4985 }, to:{ name:'Озеро Опечень', lat:50.514, lng:30.5065 }, reward:60 },
      { caller:'Максим', request:'Слухайте, хто там на проспекті Івасюка — підкиньте мене до Dream Town, запізнююсь!', from:{ name:'Оболонський проспект', lat:50.5065, lng:30.4995 }, to:{ name:'ТРЦ Dream Town', lat:50.5236, lng:30.4972 }, reward:65 },
      { caller:'Бабуся Галина', request:'Синочку, забери мене від метро «Героїв Дніпра», довези до храму на набережній.', from:{ name:'Метро «Героїв Дніпра»', lat:50.5223, lng:30.499 }, to:{ name:'Свято-Покровський храм', lat:50.51212, lng:30.51242 }, reward:70 },
      { caller:'Тарас', request:'В ефір: мені треба від метро «Оболонь» до парку «Наталка», підвезете?', from:{ name:'Метро «Оболонь»', lat:50.5013, lng:30.4983 }, to:{ name:'Парк «Наталка»', lat:50.5188, lng:30.5192 }, reward:55 },
      { caller:'Ірина', request:'Доброго вечора! Стою біля озера Опечень, а мені на набережну — заберете?', from:{ name:'Озеро Опечень', lat:50.514, lng:30.5065 }, to:{ name:'Оболонська набережна', lat:50.5115, lng:30.516 }, reward:40 }
    ]
  };

  // ---------- дрібні хелпери ----------
  function fqRand(min, max){ return min + Math.random() * (max - min); }
  function fqEnsureData(){ if(!fqData) fqData = FMQ_FALLBACK; }

  function fqValidLoc(o){
    return !!(o && typeof o === 'object' &&
      typeof o.lat === 'number' && isFinite(o.lat) &&
      typeof o.lng === 'number' && isFinite(o.lng));
  }
  function fqValidQuest(q){
    try{ return !!(q && typeof q === 'object' && typeof q.reward === 'number' && q.reward > 0 && fqValidLoc(q.target)); }
    catch(e){ return false; }
  }
  function fqValidCall(c){
    try{ return !!(c && typeof c === 'object' && typeof c.reward === 'number' && c.reward > 0 && fqValidLoc(c.from) && fqValidLoc(c.to)); }
    catch(e){ return false; }
  }

  // ---------- дані: fetch з фолбеком (той самий патерн, що й fmLoadData/PEDS.init) ----------
  function fqNormalize(j){
    try{
      if(!j || typeof j !== 'object') return FMQ_FALLBACK;
      var quests = Array.isArray(j.quests) ? j.quests.filter(fqValidQuest) : [];
      var calls  = Array.isArray(j.calls)  ? j.calls.filter(fqValidCall)   : [];
      if(!quests.length) quests = FMQ_FALLBACK.quests;
      if(!calls.length)  calls  = FMQ_FALLBACK.calls;
      return { quests: quests, calls: calls };
    }catch(e){ return FMQ_FALLBACK; }
  }
  function fqLoad(){
    try{
      if(typeof fetch !== 'function'){ fqData = FMQ_FALLBACK; return; }
      fetch('data/fm_quests.json').then(function(r){
        if(!r || !r.ok) throw new Error('fm_quests.json http');
        return r.json();
      }).then(function(j){
        fqData = fqNormalize(j);
      }).catch(function(){
        if(!fqData) fqData = FMQ_FALLBACK; // fetch/parse не вдався — лишаємось на фолбеку
      });
    }catch(e){ if(!fqData) fqData = FMQ_FALLBACK; }
  }

  // ---------- власний вигляд маркера (окремий CSS-клас, id-guarded ін'єкція — як TRACES.injectStyles) ----------
  function fqInjectStyles(){
    try{
      if(document.getElementById('fmqStyles')) return;
      var css = '.poi.fmq{background:#c2255c;}';
      var styleEl = document.createElement('style');
      styleEl.id = 'fmqStyles';
      styleEl.textContent = css;
      document.head.appendChild(styleEl);
    }catch(e){}
  }
  // Мітка з назвою над піном — той самий патерн, що й ghostIcon (нік мультиплеєра):
  // текст користувацького походження (назва цілі/ім'я слухача з JSON) ОБОВ'ЯЗКОВО через esc().
  function fqIcon(label, emoji){
    try{
      var safeLabel = esc(String(label || ''));
      var safeEmoji = String(emoji || '📻');
      return L.divIcon({
        className: '', iconSize: [70, 44], iconAnchor: [35, 44],
        html: '<div style="text-align:center">' +
                '<div style="font-size:9px;font-weight:800;background:rgba(20,22,26,.85);color:#fff;' +
                'border-radius:6px;padding:1px 5px;margin-bottom:1px;white-space:nowrap;max-width:96px;' +
                'overflow:hidden;display:inline-block">' + safeLabel + '</div>' +
                '<div class="poi fmq" style="margin:0 auto"><span>' + safeEmoji + '</span></div>' +
              '</div>'
      });
    }catch(e){
      try{ return poiIcon('fmq', emoji); }catch(e2){ return null; }
    }
  }
  function fqSetMarker(loc, emoji){
    try{
      fqRemoveMarker(); // ОДИН маркер об'єктиву — перед новим завжди прибираємо старий
      var icon = fqIcon(loc && loc.name, emoji);
      if(!icon) return;
      fqMarker = L.marker([loc.lat, loc.lng], { icon: icon, interactive: false }).addTo(map);
    }catch(e){}
  }
  function fqRemoveMarker(){
    try{ if(fqMarker){ map.removeLayer(fqMarker); fqMarker = null; } }catch(e){}
  }

  // ---------- мовлення: лише коли можна (не MUTED, і локальне радіо зараз не грає) ----------
  function fqCanSpeak(){
    try{
      if(window.MUTED) return false;
      if(typeof radio !== 'undefined' && radio && radio.on) return false; // не накладаємо голос на локальне радіо
      return true;
    }catch(e){ return false; }
  }
  function fqSay(lines){
    try{
      if(!fqCanSpeak() || !lines || !lines.length) return;
      speakLines(lines);
    }catch(e){}
  }

  // ---------- оголошення нового об'єктиву ----------
  function fqPickKind(){
    try{
      fqEnsureData();
      var hasQ = !!(fqData.quests && fqData.quests.length);
      var hasC = !!(fqData.calls && fqData.calls.length);
      if(!hasQ && !hasC) return null;
      if(!hasQ) return 'call';
      if(!hasC) return 'quest';
      return (Math.random() < CALL_CHANCE) ? 'call' : 'quest';
    }catch(e){ return null; }
  }
  function fqAnnounce(){
    try{
      if(fqActive) return; // лише один активний об'єктив за раз — не плодимо
      var kind = fqPickKind();
      if(!kind) return;
      fqEnsureData();
      var pool = fqData[kind === 'call' ? 'calls' : 'quests'];
      if(!pool || !pool.length) return;
      var item = pool[Math.floor(Math.random() * pool.length)];

      if(kind === 'quest'){
        if(!fqValidQuest(item)) return;
        fqActive = { kind: 'quest', data: item, stage: 'target' };
        fqSetMarker(item.target, '🎯');
        var qTitle = item.title ? (item.title + ': ') : '';
        toast('📻 ' + qTitle + (item.dj_intro || 'Диджей оголошує квест!'));
        fqSay(item.dj_intro ? [item.dj_intro] : null);
      } else {
        if(!fqValidCall(item)) return;
        fqActive = { kind: 'call', data: item, stage: 'from' };
        fqSetMarker(item.from, '📍');
        var who = item.caller ? (item.caller + ': ') : '';
        toast('📻 ' + who + (item.request || 'Дзвінок в ефір!'));
        fqSay(item.request ? [(item.caller ? (item.caller + ' в ефірі. ') : '') + item.request] : null);
      }
    }catch(e){}
  }

  // ---------- завершення / прогрес активного об'єктиву ----------
  function fqReward(n){
    try{
      var r = (typeof n === 'number' && isFinite(n) && n > 0) ? n : 0;
      if(r > 0){
        state.money += r;
        try{ window.SAVE && window.SAVE.addEarned && window.SAVE.addEarned(r); }catch(e){}
        try{ window.SAVE && window.SAVE.save && window.SAVE.save(); }catch(e){}
        try{ updateHUD(); }catch(e){}
      }
      return r;
    }catch(e){ return 0; }
  }
  function fqCompleteQuest(){
    try{
      var r = fqReward(fqActive.data.reward);
      var outro = fqActive.data.dj_outro || 'Дякуємо, диджей задоволений!';
      toast('✅ ' + outro + (r ? (' +' + Math.round(r) + ' грн') : ''));
      fqSay([outro]);
      fqRemoveMarker();
      fqActive = null;
    }catch(e){ fqRemoveMarker(); fqActive = null; }
  }
  function fqCompleteCall(){
    try{
      var r = fqReward(fqActive.data.reward);
      var who = fqActive.data.caller || 'Слухач';
      toast('✅ ' + who + ' дякує за підвезення!' + (r ? (' +' + Math.round(r) + ' грн') : ''));
      fqSay(['Дякую, що підвезли! Оболонь FM цінує добрих сусідів.']);
      fqRemoveMarker();
      fqActive = null;
    }catch(e){ fqRemoveMarker(); fqActive = null; }
  }
  function fqCheckArrival(){
    try{
      if(!fqActive) return;
      if(typeof car === 'undefined') return;
      var p = fromXY(car.x, car.y);
      if(fqActive.kind === 'quest'){
        var t = fqActive.data.target;
        if(dist(p.lat, p.lng, t.lat, t.lng) < ARRIVE_M) fqCompleteQuest();
        return;
      }
      // call: спершу забрати (from), тоді довезти (to)
      if(fqActive.stage === 'from'){
        var f = fqActive.data.from;
        if(dist(p.lat, p.lng, f.lat, f.lng) < ARRIVE_M){
          fqActive.stage = 'to';
          fqSetMarker(fqActive.data.to, '🏁');
          toast('🙋 Забрали! Тепер до: ' + (fqActive.data.to && fqActive.data.to.name || 'мети'));
        }
      } else {
        var d = fqActive.data.to;
        if(dist(p.lat, p.lng, d.lat, d.lng) < ARRIVE_M) fqCompleteCall();
      }
    }catch(e){}
  }

  // ================= КОНТРАКТ (window.FMQUESTS) =================
  function init(){
    try{
      if(fqInited) return; // ідемпотентність — повторний виклик нічого не ламає
      fqInited = true;
      fqAcc = 0;
      fqNextGap = fqRand(GAP_MIN_S, GAP_MAX_S);
      fqInjectStyles();
      fqLoad();
    }catch(e){}
  }
  function step(dt){
    try{
      if(typeof state.phase === 'undefined' || state.phase !== 'play') return;
      if(typeof dt !== 'number' || dt <= 0) return;

      // активний об'єктив перевіряємо незалежно від стану FM/радіо — щоб гравець
      // завжди міг довезти вже прийняте й отримати нагороду, навіть вимкнувши FM.
      if(fqActive){ fqCheckArrival(); return; }

      if(!(window.FM && window.FM.on)){ fqAcc = 0; return; } // FM вимкнено — нові об'єктиви не оголошуємо
      fqEnsureData();

      fqAcc += dt;
      if(fqAcc >= fqNextGap){
        fqAcc = 0;
        fqNextGap = fqRand(GAP_MIN_S, GAP_MAX_S);
        fqAnnounce();
      }
    }catch(e){}
  }

  return { init: init, step: step };
})();
