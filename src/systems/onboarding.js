import { esc, toast } from '../core/dom.js';
import { state } from '../core/state.js';


// ============================================================
// 🎓 ONBOARDING — лагідний туторіал першого запуску + ПДР-поради
// на екрані завантаження (v0.8, «Котик за кермом»).
// Вставляється ІНЛАЙН у той самий <script>, що й гра
// (index.html), поруч із SIGNS/TRACES/SETTINGS/PEDS. Бачить
// глобали лексично (той самий <script>-блок) і НІЧОГО з них не
// переоголошує — лише читає/мутує (phase, toast, esc,
// localStorage — так само, як це вже роблять інші модулі тут).
//
// Що робить:
//  1) Поки гравець на стартовому екрані (#startScreen, phase
//     === 'menu') — показує ВИПАДКОВУ теплу ПДР-пораду у
//     невеликому блоці під стартовою карткою (#pdrTip,
//     створюється самим модулем — index.html не редагується) і
//     періодично її оновлює (throttle-таймер).
//  2) При першому вході в реальну поїздку (phase==='play' після
//     стартової послідовності) — якщо це перший запуск гри на
//     цьому пристрої (localStorage['kotik_onboarded'] ще не
//     стоїть) — показує 2–3 короткі дружні toast-підказки одну
//     за одною з паузами, і більше ніколи їх не повторює.
//
// Контент порад: data/pdr_tips.json → { tips:[{text, rule}] }.
// Фетчиться в init(); якщо файл відсутній/не завантажився/має
// невалідну форму — модуль тихо лишається на вбудованому
// фолбеку (TIPS_FALLBACK нижче) і працює так само коректно.
// Точні номери пунктів ПДР у фолбеку — ті самі, що вже звірені
// й використовуються в грі (POLICE-модуль, data/pdr_rules.json):
// нічого нового не вигадано.
//
// Надійність:
//  - усе в try/catch, модуль ніколи не має зламати гру;
//  - init() ідемпотентний (повторний виклик — no-op);
//  - текст поради вставляється в DOM ЛИШЕ через esc();
//  - throttle-таймер порад:
//      а) явно чиститься викликом window.ONBOARDING.enterPlay()
//         (його треба зачепити в startGame()/finishSequence()
//         одразу після phase='play' — див.
//         onboarding_integration.md);
//      б) про всяк випадок сам себе зупиняє, щойно на черговому
//         тіку бачить phase !== 'menu' — навіть якщо крок (а)
//         з якоїсь причини не зачепили, таймер не «тікає» довго;
//  - лише ОДИН setInterval за раз (для ротації порад), і він
//    завжди прибирається через clearInterval — жодних витоків;
//  - toast-підказки першого запуску — через chain setTimeout з
//    ids, які теж прибираються (clearOnboardTimers) при
//    повторному/неочікуваному виклику enterPlay();
//  - прапорець «онбординг показано» пишеться в localStorage
//    ДО того, як стартує послідовність toast'ів (не після) —
//    щоб дубль-виклик enterPlay() не показав тижо туторіал ще раз.
//
// Контракт: window.ONBOARDING = { init, enterPlay }
//   window.ONBOARDING.init()      — одноразово при завантаженні,
//                                    поруч з іншими *.init() у
//                                    боот-ланцюжку index.html.
//   window.ONBOARDING.enterPlay() — викликати ОДИН раз одразу
//                                    після встановлення phase='play'
//                                    у startGame()/finishSequence().
// ============================================================
(function(){
  'use strict';

  var LS_ONBOARDED   = 'kotik_onboarded';
  var TIPS_URL        = 'data/pdr_tips.json';
  var TIP_ROTATE_MS   = 8000;   // throttle: як часто міняти пораду на старті
  var ONBOARD_GAP_MS  = 4000;   // пауза між toast-підказками першого запуску
  var ONBOARD_FIRST_DELAY_MS = 3800; // щоб не збити власний "🚗 Поїхали!" toast гри

  // Фолбек-поради: номери пунктів ПДР — ті самі, що вже звірені
  // й живуть у data/pdr_rules.json / POLICE-модулі цієї гри.
  // Нових номерів тут не вигадано.
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
      // кладемо ПІСЛЯ #loadNote — теплий рядок у самому низу картки,
      // не заважає статусу завантаження карти над ним
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
      // 'unknown' (localStorage недоступний, напр. приватний режим) —
      // про всяк випадок НЕ показуємо повторно нав'язливо щоразу;
      // просто вважаємо, що онбординг уже "показано" цього разу.
      if(already) return;

      // ставимо прапорець ОДРАЗУ, до того як щось показали — щоб
      // дубль-виклик enterPlay() (напр. якщо його зачепили і в
      // startGame(), і в finishSequence()) не запустив другу хвилю.
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
