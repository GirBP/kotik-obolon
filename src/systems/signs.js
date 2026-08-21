import { toast } from '../core/dom.js';
import { state } from '../core/state.js';
import { updateHUD } from '../ui/hud.js';
import { map } from '../world/map.js';



// ============================================================
// 🚸 ДОРОЖНІ ЗНАКИ — НАВЧАЛЬНИЙ ШАР (SIGNS) — v0.7
// Вставляється ІНЛАЙН у той самий <script>, що й гра «Котик за кермом»
// (index.html). Бачить глобали лексично (той самий <script>-блок, звичайний,
// не type=module): map (Leaflet), car, phase, toXY, fromXY, dist, toast,
// LANDMARKS, stations, churchMarks, money, updateHUD. НІЧОГО з цього не
// переоголошує — лише читає/мутує (money, phase — так само, як це вже
// роблять модулі TRACES/SETTINGS/fuel-панель у цьому файлі).
//
// Що робить: кладе на карту 8 маркерів-бейджів реальних дорожніх знаків
// ПДР України (коди й офіційні назви звірені з каталогом
// KotikPDR/Data/SignsData.swift — той самий каталог, який пройшов скіл
// pdr-sign-audit для застосунку «Котик ПДР»). Тап по бейджу → картка-оверлей
// (перевикористані класи .overlay/.card/.cta/.paw/.hidden з index.html)
// з назвою, кодом і поясненням. Перший тап на кожен ОКРЕМИЙ знак дає
// разовий бонус навчання (+10 грн, тост), повторний тап — лише картка,
// без бонуса. Прогрес «вивчених» знаків зберігається в
// localStorage['kotik_signs_seen'] (масив кодів) і переживає перезавантаження.
//
// ЧЕСНІСТЬ ЛОКАЦІЙ: там, де знак прив'язаний до конкретного реального
// об'єкта (метро, проспект, храм, АЗС) — координати взяті з наявних у грі
// LANDMARKS / data/pois.json (реальні точки Оболоні). Там, де знак означає
// загальний режим (житлова зона, заборона зупинки біля ТРЦ) — координата
// підібрана вручну в межах bbox Оболоні як ЛОГІЧНЕ, а не GPS-звірене місце
// встановлення конкретного стовпа. Точність, яка тут КРИТИЧНА і перевірена —
// це код знака, офіційна назва і зміст пункту ПДР, а не точна GPS-точка стовпа.
//
// Контракт: window.SIGNS = { init }
// ============================================================
(function(){
  'use strict';

  var LS_SEEN = 'kotik_signs_seen';
  var BONUS = 10;

  // ---- Каталог знаків (код/назва/зміст — за чинним ПДР України) ----
  // group керує лише кольором бейджа (не є частиною офіційних даних):
  //   warn=попереджувальні, prio=пріоритету, proh=заборонні,
  //   info=інформаційно-вказівні, serv=сервісу.
  var SIGN_DATA = [
    { code:'1.32', name:'Пішохідний перехід', group:'warn', shape:'tri', badge:'🚶',
      lat:50.50130, lng:30.49830, near:'біля метро «Оболонь»',
      text:'Попереджувальний знак: попереду — нерегульований пішохідний перехід. Скинь швидкість заздалегідь і будь готовий/готова пропустити пішоходів.' },
    { code:'5.38.1', name:'Пішохідний перехід', group:'info', shape:'circ', badge:'🚸',
      lat:50.51220, lng:30.49850, near:'біля метро «Мінська»',
      text:'Інформаційно-вказівний знак: позначає саме місце нерегульованого пішохідного переходу. Тут пішохід має перевагу — зупинись і дай пройти.' },
    { code:'3.29', name:'Обмеження максимальної швидкості', group:'proh', shape:'circ', badge:'50',
      lat:50.50650, lng:30.49950, near:'на Оболонському проспекті',
      text:'Заборонний знак: рухатися швидше за вказане число не можна. Тут — не більше 50 км/год, навіть якщо дорога здається порожньою.' },
    { code:'2.1', name:'Дати дорогу', group:'prio', shape:'triDown', badge:'▽',
      lat:50.51150, lng:30.51600, near:'на в’їзді до Оболонської набережної',
      text:'Знак пріоритету: перед перехрестям треба дати дорогу транспорту, що рухається дорогою, яку ти перетинаєш. Спочатку пропусти — потім їдь.' },
    { code:'2.3', name:'Головна дорога', group:'prio', shape:'diamond', badge:'◆',
      lat:50.51212, lng:30.51242, near:'біля Свято-Покровського храму',
      text:'Знак пріоритету: ти на головній дорозі — маєш перевагу проїзду на найближчих нерегульованих перехрестях.' },
    { code:'6.7.1', name:'Автозаправні станції', group:'serv', shape:'circ', badge:'⛽',
      lat:50.50700, lng:30.48300, near:'перед АЗС ОККО',
      text:'Знак сервісу: попереду — автозаправна станція. Гарний момент зазирнути, якщо бак підводить.' },
    { code:'5.34', name:'Житлова зона', group:'info', shape:'circ', badge:'🏠',
      lat:50.51000, lng:30.50800, near:'на типовому в’їзді у двір панельок',
      text:'Інформаційно-вказівний знак: тут діє особливий режим — не більше 20 км/год, і пішохід завжди головний. У дворі — повільно й ніжно.' },
    { code:'3.34', name:'Зупинку заборонено', group:'proh', shape:'circ', badge:'⛔',
      lat:50.52300, lng:30.49750, near:'біля ТРЦ Dream Town',
      text:'Заборонний знак: тут не можна ні зупинятись, ні стояти — навіть на хвилинку. Висади чи забери пасажира трохи далі.' }
  ];

  var markers = [];
  var seen = null;               // Set<string> кодів, що вже дали бонус
  var elOverlay=null, elPaw=null, elTitle=null, elCode=null, elText=null, elOk=null;
  var _prevPhase='play', pausedByUs=false;

  // ---- безпечні обгортки ----
  function toastSafe(msg){ try{ if(typeof toast==='function') toast(msg); }catch(e){} }
  function hudSafe(){ try{ if(typeof updateHUD==='function') updateHUD(); }catch(e){} }

  // ---- localStorage: «вивчені» знаки ----
  function loadSeen(){
    var out=new Set();
    try{
      var raw=localStorage.getItem(LS_SEEN);
      if(raw){ var arr=JSON.parse(raw); if(Array.isArray(arr)) arr.forEach(function(c){ out.add(String(c)); }); }
    }catch(e){}
    return out;
  }
  function saveSeen(){
    try{ localStorage.setItem(LS_SEEN, JSON.stringify(Array.from(seen))); }catch(e){}
  }
  function isSeen(code){ try{ return !!seen && seen.has(code); }catch(e){ return false; } }
  function markSeen(code){ try{ if(seen){ seen.add(code); saveSeen(); } }catch(e){} }

  // ---- стилі (інжектуються самим модулем, index.html не редагується) ----
  function injectStyles(){
    try{
      if(document.getElementById('signsStyles')) return;
      var css =
        '.sign-badge{width:26px;height:26px;display:flex;align-items:center;justify-content:center;'+
          'font-size:12px;font-weight:800;line-height:1;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.35);'+
          'border-radius:50%;background:#fff;}'+
        '.sign-badge.tri{border-radius:5px;clip-path:polygon(50% 6%,4% 96%,96% 96%);padding-top:6px;box-shadow:none;}'+
        '.sign-badge.triDown{border-radius:5px;clip-path:polygon(4% 4%,96% 4%,50% 94%);padding-bottom:6px;box-shadow:none;}'+
        '.sign-badge.diamond{border-radius:4px;transform:rotate(45deg);}'+
        '.sign-badge.diamond span{transform:rotate(-45deg);display:block;}'+
        '.sign-badge.g-warn{background:#fff8dc;border:2px solid #e8442e;color:#8a2110;}'+
        '.sign-badge.g-proh{background:#fff;border:2px solid #e8442e;color:#c0271f;}'+
        '.sign-badge.g-prio{background:#fff;border:2px solid #e0a112;color:#8a5c05;}'+
        '.sign-badge.g-info{background:#eaf2ff;border:2px solid #2b6fd4;color:#1c4e99;}'+
        '.sign-badge.g-serv{background:#eafff2;border:2px solid #1a7a4f;color:#0e5c39;}'+
        '.sign-badge.seen{opacity:.8;filter:saturate(.85);}';
      var styleEl=document.createElement('style');
      styleEl.id='signsStyles';
      styleEl.textContent=css;
      document.head.appendChild(styleEl);
    }catch(e){}
  }

  // ---- DOM картки-оверлея (створюється один раз, лінива ініціалізація) ----
  function ensureDom(){
    try{
      elOverlay=document.getElementById('signsOverlay');
      if(!elOverlay){
        elOverlay=document.createElement('div');
        elOverlay.id='signsOverlay';
        elOverlay.className='overlay hidden';
        elOverlay.innerHTML =
          '<div class="card">'+
            '<div class="paw" id="signsPaw">🚦</div>'+
            '<h1 id="signsTitle">—</h1>'+
            '<p id="signsCode" style="color:#999;font-size:12px;margin:-8px 0 8px;">—</p>'+
            '<p id="signsText">—</p>'+
            '<button class="cta" id="signsOk">Зрозуміло ✅</button>'+
          '</div>';
        document.body.appendChild(elOverlay);
        elOverlay.addEventListener('click', function(e){ if(e.target===elOverlay) closeCard(); });
      }
      elPaw=document.getElementById('signsPaw');
      elTitle=document.getElementById('signsTitle');
      elCode=document.getElementById('signsCode');
      elText=document.getElementById('signsText');
      elOk=document.getElementById('signsOk');
      if(elOk && !elOk.__wired){ elOk.__wired=true; elOk.addEventListener('click', closeCard); }
    }catch(e){}
  }

  // ---- відкрити/закрити картку ----
  function openCard(sign){
    try{
      ensureDom();
      if(elPaw) elPaw.textContent=sign.badge || '🚦';
      if(elTitle) elTitle.textContent=sign.name;
      if(elCode) elCode.textContent='Знак '+sign.code+' · '+sign.near;
      if(elText) elText.textContent=sign.text;

      var firstTime=!isSeen(sign.code);
      if(firstTime){
        markSeen(sign.code);
        try{ if(typeof state.money==='number'){ state.money+=BONUS; hudSafe(); } }catch(e){}
        try{ window.SFX&&window.SFX.play('cash'); }catch(e){}
        toastSafe('+'+BONUS+' грн за вивчений знак 🎓 '+sign.code);
        try{ window.PROGRESSION && window.PROGRESSION.event('sign_learned'); }catch(e){}
      }

      // ставимо гру на паузу на час читання картки (як фуел-панель/налаштування)
      try{
        if(typeof state.phase!=='undefined' && state.phase==='play'){ _prevPhase='play'; state.phase='signs'; pausedByUs=true; }
        else { pausedByUs=false; }
      }catch(e){ pausedByUs=false; }

      if(elOverlay) elOverlay.classList.remove('hidden');
    }catch(e){}
  }
  function closeCard(){
    try{
      if(elOverlay) elOverlay.classList.add('hidden');
      try{
        if(pausedByUs && typeof state.phase!=='undefined' && state.phase==='signs'){
          state.phase='play'; try{ state.lastT=performance.now(); }catch(e2){}
        }
      }catch(e){}
      pausedByUs=false;
    }catch(e){}
  }

  // ---- маркер-бейдж для одного знака ----
  function signIcon(sign){
    var cls='sign-badge g-'+sign.group+(sign.shape==='tri'?' tri':(sign.shape==='triDown'?' triDown':(sign.shape==='diamond'?' diamond':'')))+
             (isSeen(sign.code)?' seen':'');
    var html='<div class="'+cls+'" data-code="'+sign.code+'"><span>'+sign.badge+'</span></div>';
    return L.divIcon({ className:'', iconSize:[26,26], iconAnchor:[13,13], html:html });
  }

  function addMarkers(){
    try{
      if(typeof map==='undefined' || !map || typeof L==='undefined') return;
      SIGN_DATA.forEach(function(sign){
        try{
          var mk=L.marker([sign.lat,sign.lng], {icon:signIcon(sign), title:sign.code+' '+sign.name}).addTo(map);
          mk.on('click', function(){
            try{
              if(typeof state.phase!=='undefined' && state.phase!=='play') return; // не лізти поверх іншого оверлея
              openCard(sign);
            }catch(e){}
          });
          markers.push({sign:sign, mk:mk});
        }catch(e){}
      });
    }catch(e){}
  }

  // ---- публічний контракт ----
  window.SIGNS = window.SIGNS || {};
  window.SIGNS.init = function(){
    try{
      if(window.__signsInited) return;
      window.__signsInited=true;
      seen=loadSeen();
      injectStyles();
      ensureDom();
      addMarkers();
    }catch(e){}
  };
})();
