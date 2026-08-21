import { CFG } from '../core/config.js';
import { toast } from '../core/dom.js';
import { state } from '../core/state.js';
import { updateHUD } from '../ui/hud.js';



// старт живих підсистем (Оболонь FM + Київський час)

// ================= 💾 SAVE + 🐾 СЛІДИ СУСІДІВ + ⚙️ НАЛАШТУВАННЯ (v0.6) =================
// ============================================================
// 💾 ЗБЕРЕЖЕННЯ ПРОГРЕСУ (SAVE)
// Для «Котик за кермом» (Оболонь). Вставляється ІНЛАЙН у той самий
// класичний <script>, що й основна гра — бачить її глобали
// (money, fuel, fuelType, selectedMode, handedMode, roadsOnly, cruiseSet,
// CFG, car, phase, toast, updateHUD, applyHanded) і нічого з них не
// перевизначає. Присвоєння глобалам тут (money=…, fuel=…) міняють саме
// ту `let`-змінну, що й решта гри, бо модуль живе в тому самому <script>.
//
// Контракт: window.SAVE = { load, applyRestore, save, addKm, addEarned,
//           stats, wipe }
//
// Усе в try/catch: localStorage може кидати у приватному режимі —
// тоді граємо без збереження, гра ніколи не падає через це.
// ============================================================
(function(){
  'use strict';

  var SAVE_KEY       = 'kotik_save_v1';
  var SAVE_VERSION   = 1;
  var SAVE_THROTTLE  = 2000;   // мс — не частіше ~1 раз/2с пишемо в localStorage
  var AUTOSAVE_EVERY = 15000;  // мс — періодичне автозбереження

  var FUEL_TYPES = { A95:1, LPG:1 };
  var MODES      = { auto:1, manual:1 };
  var HANDS      = { two:1, one:1 };

  var saved       = null;   // внутрішній стан: { v, money, fuel, fuelType, selectedMode,
                             //   handedMode, roadsOnly, cruiseSet, totalKm, totalEarned, sessions }
  var hasSave     = false;  // чи існувало ВАЛІДНЕ збереження до load() (розрізняє «перший запуск»)
  var lastSaveAt  = 0;      // мітка часу останнього фактичного запису в localStorage
  var pendingSave = null;   // setTimeout id відкладеного запису (throttle)

  function now(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function isNum(v){ return typeof v==='number' && isFinite(v); }

  // ---- валідація: битий/чужорідний JSON → null, ігноруємо, не падаємо ----
  function validate(obj){
    try{
      if(!obj || typeof obj!=='object') return null;
      if(obj.v!==SAVE_VERSION) return null;
      if(!isNum(obj.money) || obj.money<0) return null;
      if(!isNum(obj.fuel) || obj.fuel<0) return null;
      if(typeof obj.fuelType!=='string' || !FUEL_TYPES[obj.fuelType]) return null;
      if(typeof obj.selectedMode!=='string' || !MODES[obj.selectedMode]) return null;
      if(typeof obj.handedMode!=='string' || !HANDS[obj.handedMode]) return null;
      if(typeof obj.roadsOnly!=='boolean') return null;
      if(!isNum(obj.cruiseSet) || obj.cruiseSet<=0) return null;
      if(!isNum(obj.totalKm) || obj.totalKm<0) return null;
      if(!isNum(obj.totalEarned) || obj.totalEarned<0) return null;
      if(!isNum(obj.sessions) || obj.sessions<0) return null;
      return {
        v:SAVE_VERSION, money:obj.money, fuel:obj.fuel, fuelType:obj.fuelType,
        selectedMode:obj.selectedMode, handedMode:obj.handedMode, roadsOnly:obj.roadsOnly,
        cruiseSet:obj.cruiseSet, totalKm:obj.totalKm, totalEarned:obj.totalEarned,
        sessions:obj.sessions
      };
    }catch(_){ return null; }
  }

  function readRaw(){
    try{
      var raw = localStorage.getItem(SAVE_KEY);
      if(!raw) return null;
      return validate(JSON.parse(raw));
    }catch(_){ return null; } // битий JSON / localStorage недоступний → як «нема збереження»
  }
  function writeRaw(obj){
    try{ localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); return true; }
    catch(_){ return false; } // приватний режим і т.п. → мовчки не зберігаємо
  }

  // ---- зібрати поточний стан гри + вже накопичену статистику ----
  function collectCurrent(){
    var stat = saved || {};
    return {
      v:SAVE_VERSION,
      money: isNum(state.money) ? state.money : CFG.startMoney,
      fuel: isNum(state.fuel) ? state.fuel : CFG.startFuel,
      fuelType: (state.fuelType==='LPG') ? 'LPG' : 'A95',
      selectedMode: (state.selectedMode==='manual') ? 'manual' : 'auto',
      handedMode: (state.handedMode==='one') ? 'one' : 'two',
      roadsOnly: !!state.roadsOnly,
      cruiseSet: isNum(state.cruiseSet) ? state.cruiseSet : 40,
      totalKm: isNum(stat.totalKm) ? stat.totalKm : 0,
      totalEarned: isNum(stat.totalEarned) ? stat.totalEarned : 0,
      sessions: isNum(stat.sessions) ? stat.sessions : 0
    };
  }

  // негайний фактичний запис (без throttle) — для autosave-подій, де відкладати не варто
  function saveNow(){
    try{
      var obj = collectCurrent();
      if(writeRaw(obj)) saved = obj;
      lastSaveAt = now();
    }catch(_){ }
  }

  // публічний save(): throttle ~1 раз/2с, щоб часті виклики (кожен кадр із addKm) не гальмували
  function save(){
    try{
      clearTimeout(pendingSave);
      var elapsed = now() - lastSaveAt;
      if(elapsed >= SAVE_THROTTLE){ saveNow(); }
      else { pendingSave = setTimeout(saveNow, SAVE_THROTTLE - elapsed); }
    }catch(_){ }
  }

  // ---- завантаження (виклик один раз, до старту гри) ----
  function load(){
    try{
      var existing = readRaw();
      hasSave = !!existing;
      saved = existing || {
        v:SAVE_VERSION, money:CFG.startMoney, fuel:CFG.startFuel, fuelType:'A95',
        selectedMode:'auto', handedMode:'two', roadsOnly:true, cruiseSet:40,
        totalKm:0, totalEarned:0, sessions:0
      };
      saved.sessions = (isNum(saved.sessions) ? saved.sessions : 0) + 1;
      writeRaw(saved);
      lastSaveAt = now();
    }catch(_){ }
  }

  // ---- застосувати збережений прогрес до глобалів гри ----
  function applyRestore(){
    try{
      if(!hasSave || !saved) return; // нема збереження → перший запуск, лишаємо дефолти initGame()
      state.money = isNum(saved.money) ? saved.money : state.money;
      state.fuel = isNum(saved.fuel) ? saved.fuel : state.fuel;
      if(state.fuel > CFG.tank) state.fuel = CFG.tank;     // захист від битих/старих значень понад бак
      if(state.fuel < 2) state.fuel = 2;                    // захист від застрягання: завжди можна доїхати до АЗС
      state.fuelType = (saved.fuelType==='LPG') ? 'LPG' : 'A95';
      state.selectedMode = (saved.selectedMode==='manual') ? 'manual' : 'auto';
      state.handedMode = (saved.handedMode==='one') ? 'one' : 'two';
      state.roadsOnly = !!saved.roadsOnly;
      state.cruiseSet = isNum(saved.cruiseSet) ? saved.cruiseSet : state.cruiseSet;
      if(typeof updateHUD==='function') updateHUD();
    }catch(_){ }
  }

  // ---- накопичувальна статистика ----
  function addKm(km){
    try{
      if(!isNum(km) || km<=0) return;
      if(!saved) saved = collectCurrent();
      saved.totalKm = (isNum(saved.totalKm) ? saved.totalKm : 0) + km;
      save();
    }catch(_){ }
  }
  function addEarned(grn){
    try{
      if(!isNum(grn) || grn<=0) return;
      if(!saved) saved = collectCurrent();
      saved.totalEarned = (isNum(saved.totalEarned) ? saved.totalEarned : 0) + grn;
      save();
    }catch(_){ }
  }

  // ---- для панелі налаштувань ----
  function stats(){
    try{
      var s = saved || {};
      return {
        totalKm: isNum(s.totalKm) ? s.totalKm : 0,
        totalEarned: isNum(s.totalEarned) ? s.totalEarned : 0,
        sessions: isNum(s.sessions) ? s.sessions : 0,
        money: isNum(state.money) ? Math.round(state.money) : 0
      };
    }catch(_){ return { totalKm:0, totalEarned:0, sessions:0, money:0 }; }
  }

  // ---- «почати заново»: стерти збереження, скинути економіку до дефолтів CFG ----
  function wipe(){
    try{
      try{ localStorage.removeItem(SAVE_KEY); }catch(_){ }
      state.money = CFG.startMoney; state.fuel = CFG.startFuel; state.fuelType = 'A95';
      saved = null; hasSave = false;
      saveNow(); // одразу пишемо чисте збереження (нульова статистика), щоб стара не ожила
      if(typeof updateHUD==='function') updateHUD();
      if(typeof toast==='function') toast('Прогрес скинуто');
    }catch(_){ }
  }

  // ---- автозбереження: не покладаємось лише на явні виклики з ігрових подій ----
  try{
    document.addEventListener('visibilitychange', function(){
      try{ if(document.visibilityState==='hidden') saveNow(); }catch(_){ }
    });
  }catch(_){ }
  try{
    addEventListener('pagehide', function(){ try{ saveNow(); }catch(_){ } });
  }catch(_){ }
  try{
    setInterval(function(){ try{ saveNow(); }catch(_){ } }, AUTOSAVE_EVERY);
  }catch(_){ }

  window.SAVE = { load:load, applyRestore:applyRestore, save:save, addKm:addKm,
                  addEarned:addEarned, stats:stats, wipe:wipe };
})();
