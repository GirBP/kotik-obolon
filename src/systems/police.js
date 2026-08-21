import { toast } from '../core/dom.js';
import { state } from '../core/state.js';
import { speakLines } from '../core/tts.js';
import { updateHUD } from '../ui/hud.js';




// ================= 🚦 ПДР-ЯДРО v0.7 (POLICE/LIGHTS/SPEED/PEDS/SIGNS/AUDIO) =================

// ============================================================
// 🐕‍🦺 ПАТРУЛЬ + ШТРАФИ (POLICE) — v0.7
// Вставляється ІНЛАЙН у той самий <script>, що й гра (index.html).
// Бачить глобали (money, phase, toast, speakLines, updateHUD) і модулі
// (window.MUTED, window.SAVE.save(), window.FM.event()) — і НІЧОГО з
// них не перевизначає. Присвоєння money=… тут міняє саме ту `let
// money`, що й решта гри, бо модуль живе в тому самому <script>.
//
// Викликають цей модуль майбутні механіки (світлофори/швидкість/
// пішоходи): window.POLICE.fine('red_light') тощо.
//
// Контракт: window.POLICE = { init, fine, total }
// (+ bare fine/POLICE: window.fine === POLICE.fine, а бare `POLICE` —
//  звичайна властивість глобального об'єкта, тому доступна і без
//  префікса `window.` з будь-якого іншого top-level коду сторінки.)
//
// Тон світу (docs/UNIVERSE.md, §2 і §8): інспектор — ВВІЧЛИВИЙ пес.
// Він не соромить і не карає заради кари — цитує пункт ПДР і зичить
// гарної дороги. «Дорога — це повага», а не покарання.
//
// Дані: data/pdr_rules.json, схема { ruleId: {no,text,fine} }.
// init() робить fetch; якщо він не вдався (offline/404/старий
// браузер) — працює інлайн-фолбек нижче (FALLBACK_RULES), гра
// ніколи не падає і завжди має що показати. Фолбек підмінюється
// «на льоту»: щойно fetch довантажить дані, наступні виклики fine()
// вже читають актуальний текст/суму з файлу (по кожному ruleId
// окремо — часткові дані теж ок).
//
// Усе в try/catch. Без зовнішніх бібліотек.
// ============================================================
(function(){
  'use strict';

  var RULES_URL   = 'data/pdr_rules.json';
  var LS_KEY       = 'kotik_fines';   // {count, sum} — статистика штрафів
  var COOLDOWN_MS  = 8000;             // не частіше ніж раз на ~8с той самий ruleId

  // ---------- інлайн-фолбек (кілька правил, щоб працювало завжди) ----------
  // Синхронізовано з data/pdr_rules.json (той самий текст/суми), щоб
  // офлайн-гравець і той, у кого fetch спрацював, бачили однакове —
  // це саме фолбек на випадок відсутньої мережі, а не окремий контент.
  var FALLBACK_RULES = {
    red_light:  { no:'8.7.3 “е”; 8.10',       text:'Червоний сигнал світлофора забороняє рух — водій має зупинитися перед стоп-лінією чи знаком, а не їхати далі.', fine:350 },
    speeding:   { no:'12.4',                   text:'У населеному пункті дозволена швидкість — не більше 50 км/год, перевищувати не можна.',                       fine:250 },
    pedestrian: { no:'18.1',                   text:'Наближаючись до нерегульованого пішохідного переходу з пішоходами, водій повинен знизити швидкість або зупинитися й дати їм дорогу.', fine:300 },
    seatbelt:   { no:'2.3 “в”',                text:'Водій зобов’язаний бути пристебнутим ременем безпеки і не возити пасажирів, які не пристебнуті.',             fine:150 },
    stop_sign:  { no:'Додаток 1, знак 2.2',    text:'Знак «Проїзд без зупинки заборонено» вимагає зупинитися перед стоп-лінією (або самим знаком) і пропустити транспорт на перетинній дорозі.', fine:200 }
  };

  var rules = null;        // {ruleId:{no,text,fine}} з fetch (може бути частковим/відсутнім)
  var lastFineAt = {};     // ruleId -> timestamp останнього штрафу (кулдаун)
  var stats = { count:0, sum:0 };

  // ---------- localStorage: лічильник штрафів (для панелі статистики) ----------
  function loadStats(){
    try{
      var raw = localStorage.getItem(LS_KEY);
      if(!raw) return;
      var obj = JSON.parse(raw);
      if(obj && typeof obj.count === 'number' && typeof obj.sum === 'number'){
        stats.count = obj.count; stats.sum = obj.sum;
      }
    }catch(e){ /* приватний режим / битий JSON — просто граємо з нуля */ }
  }
  function saveStats(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(stats)); }catch(e){}
  }

  // ---------- дані правил ----------
  function loadRules(){
    try{
      fetch(RULES_URL).then(function(r){
        if(!r || !r.ok) throw new Error('http '+(r&&r.status));
        return r.json();
      }).then(function(json){
        if(json && typeof json === 'object') rules = json;
      }).catch(function(){ /* лишаємось на FALLBACK_RULES */ });
    }catch(e){ /* fetch недоступний узагалі — фолбек і без цього спрацює */ }
  }

  function ruleFor(ruleId){
    if(rules && rules[ruleId]) return rules[ruleId];
    return FALLBACK_RULES[ruleId] || null;
  }

  // ---------- головна точка входу ----------
  // window.POLICE.fine(ruleId, key) — викликають модулі світлофорів/швидкості/
  // пішоходів при порушенні. key (необов'язковий) робить кулдаун per-instance —
  // напр. окремий світлофор чи перехід, щоб два різних реальних порушення
  // того самого типу за COOLDOWN_MS не гасили одне одного. Повертає true,
  // якщо штраф застосовано, false — якщо ruleId невідомий або спрацював кулдаун.
  function fine(ruleId, key){
    try{
      if(!ruleId) return false;
      // під час паузи/меню/заправки штрафи не нараховуємо (як fmStep)
      if(typeof state.phase !== 'undefined' && state.phase !== 'play') return false;

      var rule = ruleFor(ruleId);
      if(!rule) return false; // невідомий ruleId — тихо ігноруємо, гра не падає

      var cdKey = ruleId + (key!=null ? (':'+key) : '');
      var now = Date.now();
      var last = lastFineAt[cdKey] || 0;
      if(now - last < COOLDOWN_MS) return false; // кулдаун — не спамимо тим самим штрафом
      lastFineAt[cdKey] = now;

      var amount = Math.max(0, Number(rule.fine) || 0);
      try{
        if(typeof state.money === 'number'){ state.money = Math.max(0, state.money - amount); }
      }catch(e){}

      stats.count += 1; stats.sum += amount;
      saveStats();

      var msg = '🐕‍🦺 Інспектор: '+rule.text+' (ПДР '+rule.no+'). Штраф −'+amount+' грн. Гарної дороги!';
      try{ if(typeof toast === 'function') toast(msg); }catch(e){}

      try{ window.SFX && window.SFX.play('siren'); }catch(e){}

      try{
        if(!window.MUTED && typeof speakLines === 'function'){
          speakLines(['Інспектор дорожнього руху.', rule.text+'.', 'Штраф '+amount+' гривень.', 'Гарної дороги!']);
        }
      }catch(e){}

      try{ window.SAVE && window.SAVE.save && window.SAVE.save(); }catch(e){}
      try{ if(typeof updateHUD === 'function') updateHUD(); }catch(e){}
      try{ window.FM && window.FM.event && window.FM.event('fine'); }catch(e){}
      try{ window.PROGRESSION && window.PROGRESSION.event && window.PROGRESSION.event('fine'); }catch(e){}

      return true;
    }catch(e){ return false; }
  }

  // window.POLICE.total() -> {count, sum} — для панелі статистики
  function total(){
    return { count: stats.count, sum: stats.sum };
  }

  function init(){
    try{ loadStats(); }catch(e){}
    try{ loadRules(); }catch(e){}
  }

  window.POLICE = { init:init, fine:fine, total:total };
  window.fine = fine; // bare-контракт: зручний виклик з модулів світлофорів/швидкості/пішоходів
})();
