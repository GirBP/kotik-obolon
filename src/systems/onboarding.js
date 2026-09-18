import { esc, toast } from '../core/dom.js';
import { state } from '../core/state.js';


// Туторіал першого запуску: порада ПДР на стартовому екрані + короткі
// toast-підказки в першій поїздці. Вставляється інлайн у той самий <script>,
// що й гра (index.html), поруч із SIGNS/TRACES/SETTINGS/PEDS — читає й мутує
// спільні глобалі (phase, toast, esc, localStorage), нічого не переоголошує.
//
// Поради — з data/pdr_tips.json (фетч у init()); якщо файл відсутній чи
// невалідний, модуль лишається на вбудованому TIPS_FALLBACK. Номери пунктів
// ПДР у фолбеку ті самі, що в POLICE-модулі й data/pdr_rules.json.
//
// Контракт: window.ONBOARDING = { init, enterPlay }.
// init() — одноразово при завантаженні, поруч з іншими *.init() у боот-
// ланцюжку. enterPlay() — викликати одразу після встановлення phase='play'
// у startGame()/finishSequence(); безпечно викликати з обох місць — init
// ідемпотентний, а enterPlay спрацьовує лише раз за сесію.
(function(){
  'use strict';

  var LS_ONBOARDED   = 'kotik_onboarded';
  var TIPS_URL        = 'data/pdr_tips.json';
  var TIP_ROTATE_MS   = 8000;   // throttle: як часто міняти пораду на старті
  var ONBOARD_GAP_MS  = 4000;   // пауза між toast-підказками першого запуску
  var ONBOARD_FIRST_DELAY_MS = 3800; // щоб не збити власний "🚗 Поїхали!" toast гри

  // Номери пунктів ПДР тут ті самі, що в data/pdr_rules.json і POLICE-модулі.
  var TIPS_FALLBACK = [
    { text: 'Червоне світло — це привід зупинитись перед стоп-лінією, а не проскочити. Зелене нікуди не дінеться.', rule: 'ПДР 8.7.3 “е”; 8.10' },
    { text: 'У місті не поспішай вище 50 км/год — і дорога, і бак пального скажуть тобі дякую.', rule: 'ПДР 12.4' },
    { text: 'Бачиш пішохода біля переходу — притримайся і дай пройти. Хороший котик завжди дає дорогу.', rule: 'ПДР 18.1' },
    { text: 'Ремінь — це «клац» на початку кожної поїздки. Маленький ритуал, який береже.', rule: 'ПДР 2.3 “в”' },
    { text: 'Побачив знак «Стоп» — зупинись повністю, навіть на секунду. Потім спокійно їдь далі.', rule: 'ПДР Додаток 1, знак 2.2' }
  ];

  var ONBOARD_MESSAGES = [
    '🛣️ Тримайся смуги — тап ◀▶ змінює смугу',
    '⛽ Стеж за пальним — заправся на будь-якій АЗС',
    '🌙 Вночі вмикай фари й тримай дистанцію'
  ];

  var booted = false;          // init() ідемпотентність
  var tips = TIPS_FALLBACK.slice();
  var tipTimer = null;         // throttle-таймер ротації порад на старті
  var onboardTimers = [];      // ids setTimeout для toast-послідовності
  var introduced = false;      // внутрішній guard: enterPlay() вже відпрацював у цій сесії

  // ---------- безпечні обгортки навколо глобалів гри ----------
  function toastSafe(msg){ try{ if(typeof toast==='function') toast(msg); }catch(e){} }
  function escSafe(s){
    try{ return (typeof esc==='function') ? esc(String(s)) : String(s).replace(/[<>&"']/g,''); }
    catch(e){ return ''; }
  }

  // ---------- порада: вибір / рендер ----------
  function pickRandomTip(){
    try{
      if(!tips || !tips.length) return null;
      return tips[Math.floor(Math.random() * tips.length)];
    }catch(e){ return null; }
  }

  function ensureTipEl(){
    try{
      var el = document.getElementById('pdrTip');
      if(el) return el;
      var card = document.querySelector('#startScreen .card');
      if(!card) return null;
      el = document.createElement('div');
      el.id = 'pdrTip';
      el.className = 'legend';
      el.style.marginTop = '8px';
      var loadNote = document.getElementById('loadNote');
      // ставимо після #loadNote, щоб не заважати статусу завантаження карти над ним
      if(loadNote && loadNote.parentNode === card && loadNote.nextSibling){
        card.insertBefore(el, loadNote.nextSibling);
      } else {
        card.appendChild(el);
      }
      return el;
    }catch(e){ return null; }
  }

  function showRandomTip(){
    try{
      var el = ensureTipEl();
      if(!el) return;
      var t = pickRandomTip();
      if(!t || !t.text) return;
      var html = '💡 Порада: ' + escSafe(t.text);
      if(t.rule) html += ' <small style="opacity:.65">(' + escSafe(t.rule) + ')</small>';
      el.innerHTML = html;
    }catch(e){}
  }

  function startTipRotation(){
    try{
      stopTipRotation();
      showRandomTip();
      tipTimer = setInterval(function(){
        try{
          // самозахист: якщо гру вже почали, а явний enterPlay() з
          // якоїсь причини не зачепили — таймер сам себе гасить
          // не пізніше наступного тіку, а не «тікає» весь матч.
          if(typeof state.phase !== 'undefined' && state.phase !== 'menu'){ stopTipRotation(); return; }
          showRandomTip();
        }catch(e){ stopTipRotation(); }
      }, TIP_ROTATE_MS);
    }catch(e){}
  }

  function stopTipRotation(){
    try{ if(tipTimer){ clearInterval(tipTimer); tipTimer = null; } }catch(e){}
  }

  // ---------- контент: data/pdr_tips.json з тихим фолбеком ----------
  function loadTips(){
    try{
      fetch(TIPS_URL).then(function(r){
        if(!r.ok) throw new Error('pdr_tips http ' + r.status);
        return r.json();
      }).then(function(data){
        try{
          if(data && Array.isArray(data.tips)){
            var cleaned = data.tips.filter(function(t){
              return t && typeof t.text === 'string' && t.text.trim().length > 0;
            }).map(function(t){
              return { text: String(t.text), rule: (typeof t.rule === 'string' ? t.rule : '') };
            });
            if(cleaned.length) tips = cleaned;
          }
        }catch(e){ /* лишаємось на тому, що вже мали (фолбек або попередній фетч) */ }
      }).catch(function(){ /* мережа/файл недоступні — тихо лишаємось на фолбеку */ });
    }catch(e){ /* fetch недоступний у цьому середовищі — фолбек і так уже активний */ }
  }

  // ---------- перший вхід у play: 2–3 дружні toast-підказки ----------
  function clearOnboardTimers(){
    try{ onboardTimers.forEach(function(id){ clearTimeout(id); }); }catch(e){}
    onboardTimers = [];
  }

  function maybeRunFirstRideTutorial(){
    try{
      var already = null;
      try{ already = localStorage.getItem(LS_ONBOARDED); }catch(e){ already = 'unknown'; }
      // 'unknown' (localStorage недоступний, напр. приватний режим) — не
      // показуємо повторно щоразу, вважаємо онбординг уже показаним.
      if(already) return;

      // прапорець ставимо одразу, до показу підказок — щоб дубль-виклик
      // enterPlay() (з startGame() і з finishSequence()) не запустив другу хвилю
      try{ localStorage.setItem(LS_ONBOARDED, '1'); }catch(e){}

      clearOnboardTimers();
      ONBOARD_MESSAGES.forEach(function(msg, i){
        var id = setTimeout(function(){
          toastSafe(msg);
        }, ONBOARD_FIRST_DELAY_MS + i * ONBOARD_GAP_MS);
        onboardTimers.push(id);
      });
    }catch(e){}
  }

  // ---------- публічний хук: викликати з startGame()/finishSequence() ----------
  function enterPlay(){
    try{
      stopTipRotation(); // на старті гри порада на завантажувальному екрані більше не потрібна
      if(introduced) return; // цю ігрову сесію туторіал уже запускали — не дублюємо
      introduced = true;
      maybeRunFirstRideTutorial();
    }catch(e){}
  }

  // ---------- init ----------
  function init(){
    try{
      if(booted) return; // ідемпотентність
      booted = true;
      loadTips();
      startTipRotation();
    }catch(e){}
  }

  window.ONBOARDING = { init: init, enterPlay: enterPlay };
})();
