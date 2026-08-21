import { state } from '../core/state.js';
import { stopRadio } from '../main.js';



// ============================================================
// ⚙️ НАЛАШТУВАННЯ + ПАУЗА (SETTINGS) — v0.6
// Вставляється ІНЛАЙН у той самий <script>, що й гра. Бачить глобали
// (phase, lastT, roadsOnly, toast, updateHUD) і модулі (window.FM/fmToggle,
// window.TRACES, window.SAVE). Нічого не переоголошує.
// Контракт: window.SETTINGS = { init, open, close, isPaused }
// Також вводить window.MUTED (гра сама перевіряє його у speakLines/bell).
// ============================================================
(function(){
  'use strict';

  var LS_MUTED = 'kotik_muted';
  var panel=null, body=null, prevPhase='play', paused=false, confirmWipe=false;

  function on(v){ return v ? ' on' : ''; }

  function setMuted(v){
    try{ window.MUTED = !!v; localStorage.setItem(LS_MUTED, v ? '1':'0');
      if(v){
        try{ if(typeof speechSynthesis!=='undefined') speechSynthesis.cancel(); }catch(e){}
        try{ if(typeof stopRadio==='function') stopRadio(); }catch(e){}
      }
    }catch(e){ window.MUTED = !!v; }
  }

  function render(){
    try{
      if(!body) return;
      var fmOn = !!(window.FM && window.FM.on);
      var trOn = !!(window.TRACES && window.TRACES.enabled);
      var muted = !!window.MUTED;
      var roads = (typeof state.roadsOnly!=='undefined') ? !!state.roadsOnly : true;
      var s = (window.SAVE && window.SAVE.stats) ? window.SAVE.stats() : {totalKm:0,totalEarned:0,sessions:0,money:0};
      var rows = [];
      rows.push('<button class="cta sec'+on(!muted)+'" data-a="sound">'+(muted?'🔇 Звук: вимкнено':'🔊 Звук: увімкнено')+'</button>');
      rows.push('<button class="cta sec'+on(fmOn)+'" data-a="fm">📻 Оболонь FM: '+(fmOn?'увімк':'вимк')+'</button>');
      rows.push('<button class="cta sec'+on(trOn)+'" data-a="traces">🐾 Сліди сусідів: '+(trOn?'увімк':'вимк')+'</button>');
      rows.push('<button class="cta sec'+on(roads)+'" data-a="roads">'+(roads?'🛣️ Рух: лише по дорогах':'🗺️ Рух: будь-де')+'</button>');
      rows.push('<div class="legend" style="margin-top:10px;">'+
        '<b>Твій район у цифрах</b><br>'+
        '💵 Гаманець: '+Math.round(s.money)+' грн<br>'+
        '🛞 Пробіг: '+(s.totalKm||0).toFixed(1)+' км<br>'+
        '📦 Усього зароблено: '+Math.round(s.totalEarned||0)+' грн<br>'+
        '🚗 Поїздок: '+(s.sessions||0)+'</div>');
      rows.push('<button class="cta sec" data-a="profile">🏅 Профіль водія</button>');
      if(confirmWipe){
        rows.push('<div class="legend" style="margin-top:10px;color:#a33;"><b>Точно почати заново?</b> Це зітре весь прогрес.</div>');
        rows.push('<div class="row"><button class="cta" data-a="wipeYes" style="background:#d93a34;color:#fff;">Так, стерти</button>'+
          '<button class="cta sec" data-a="wipeNo">Ні</button></div>');
      } else {
        rows.push('<button class="cta sec" data-a="wipe" style="margin-top:10px;color:#a33;">🗑 Почати заново</button>');
      }
      body.innerHTML = rows.join('');
      var btns = body.querySelectorAll('[data-a]');
      for(var i=0;i<btns.length;i++){ btns[i].addEventListener('click', onAction); }
    }catch(e){}
  }

  function onAction(e){
    try{
      var a = e.currentTarget.getAttribute('data-a');
      if(a==='sound'){ setMuted(!window.MUTED); }
      else if(a==='fm'){ if(window.FM&&window.FM.toggle) window.FM.toggle(); }
      else if(a==='traces'){ if(window.TRACES&&window.TRACES.setEnabled) window.TRACES.setEnabled(!window.TRACES.enabled); }
      else if(a==='roads'){ var b=document.getElementById('modeBtn'); if(b) b.click(); else if(typeof state.roadsOnly!=='undefined') state.roadsOnly=!state.roadsOnly; }
      else if(a==='profile'){ close(); if(window.PROGRESSION && window.PROGRESSION.openPanel) window.PROGRESSION.openPanel(); }
      else if(a==='wipe'){ confirmWipe=true; }
      else if(a==='wipeYes'){ confirmWipe=false; if(window.SAVE&&window.SAVE.wipe) window.SAVE.wipe(); }
      else if(a==='wipeNo'){ confirmWipe=false; }
      render();
    }catch(e2){}
  }

  function ensureDom(){
    try{
      var btn = document.getElementById('settingsBtn');
      if(!btn){
        btn = document.createElement('button');
        btn.className='act'; btn.id='settingsBtn'; btn.title='Налаштування';
        btn.innerHTML='⚙️<small>МЕНЮ</small>';
        var actions=document.getElementById('actions');
        if(actions) actions.appendChild(btn); else document.body.appendChild(btn);
        btn.addEventListener('click', open);
      }
      panel = document.getElementById('setPanel');
      if(!panel){
        panel = document.createElement('div');
        panel.id='setPanel'; panel.className='overlay hidden';
        panel.innerHTML =
          '<div class="card">'+
            '<div class="paw">⚙️</div>'+
            '<h1>Пауза й налаштування</h1>'+
            '<div id="setBody"></div>'+
            '<button class="cta" id="setResume" style="margin-top:12px;">▶ Продовжити</button>'+
          '</div>';
        document.body.appendChild(panel);
        panel.addEventListener('click', function(ev){ if(ev.target===panel) close(); });
        var r=document.getElementById('setResume'); if(r) r.addEventListener('click', close);
      }
      body = document.getElementById('setBody');
    }catch(e){}
  }

  function open(){
    try{
      ensureDom(); confirmWipe=false;
      if(typeof state.phase!=='undefined' && state.phase==='play'){ prevPhase='play'; state.phase='pause'; paused=true; }
      else { prevPhase = (typeof state.phase!=='undefined') ? state.phase : 'play'; }
      render();
      if(panel) panel.classList.remove('hidden');
    }catch(e){}
  }
  function close(){
    try{
      if(panel) panel.classList.add('hidden');
      if(paused && prevPhase==='play'){ state.phase='play'; try{ state.lastT = performance.now(); }catch(e){} }
      paused=false;
    }catch(e){}
  }

  function init(){
    try{
      var m=null; try{ m=localStorage.getItem(LS_MUTED); }catch(e){}
      window.MUTED = (m==='1');
      ensureDom();
    }catch(e){}
  }

  window.SETTINGS = { init:init, open:open, close:close, isPaused:function(){ return paused; } };
})();
