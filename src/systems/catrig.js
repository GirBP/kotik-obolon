import { car, input, state } from '../core/state.js';

// Оживлення котика: замінює статичний inline-SVG #car (26×40 CSS-px, тільки
// rotate()) на деталізованіший силует і додає йому дрібні живі рухи щокадру.
// Авто лишається помаранчевим, з вушками над дахом і хвостом-антеною.
//
// Бачить глобалі гри й нічого з них не перевизначає:
//   car.speed, car.heading, car.lane, car.engineRunning — з core/state.js
//   input.left/right/gas/brake — з core/state.js
//   state.phase, state.curLanes — з core/state.js
//   window.LIVE.isNight — night/day (systems/live.js), необов'язковий
//
// Головний цикл сам обертає #car (`carEl.style.transform = rotate(...)`,
// main.js:333) — CATRIG цього не чіпає, працює лише з внутрішніми <g>.
//
// Продуктивність: жодних DOM-перестворень щокадру. Усі під-елементи
// беруться один раз у init(). Щокадру міняється лише style.transform /
// style.opacity / setAttribute('fill'), і лише коли значення реально
// змінилось (діф-кеш last{...}, як у ui/hud.js). Ніяких filter/blur.
//
// Контракт: window.CATRIG = { init, step } + іменовані ES-експорти.

// ---- нове наповнення #car (viewBox трохи вищий за оригінальний
// 44×64 — знизу додано хвіст-антену) ----
const CAR_VIEWBOX = '0 0 44 74';
const CAR_SVG = `
  <ellipse cx="16" cy="24" rx="5" ry="14" fill="#ffffff" opacity="0.16" transform="rotate(-12 16 24)"></ellipse>

  <g id="crEarL">
    <path d="M9 16 L4 3 L17 11 Z" fill="#d98a1e"></path>
    <path d="M10 14 L7 6 L15 11 Z" fill="#f7b8c0"></path>
  </g>
  <g id="crEarR">
    <path d="M35 16 L40 3 L27 11 Z" fill="#d98a1e"></path>
    <path d="M34 14 L37 6 L29 11 Z" fill="#f7b8c0"></path>
  </g>

  <g id="crTail">
    <path d="M22 60 L21.2 68" stroke="#d98a1e" stroke-width="2.2" stroke-linecap="round" fill="none"></path>
    <circle cx="21" cy="69.2" r="2" fill="#d98a1e"></circle>
  </g>

  <g id="crBody">
    <rect x="6" y="10" width="32" height="50" rx="13" fill="#F5A623"></rect>
    <rect x="11" y="15" width="22" height="12" rx="5" fill="#bfe0f2"></rect>

    <rect id="crTurnL" x="7" y="9" width="5" height="4" rx="2" fill="#FFC94D" opacity="0.18"></rect>
    <rect id="crTurnR" x="32" y="9" width="5" height="4" rx="2" fill="#FFC94D" opacity="0.18"></rect>

    <circle id="crHaloL" cx="12" cy="13" r="4.4" fill="#FFF6C2" opacity="0"></circle>
    <circle id="crHaloR" cx="32" cy="13" r="4.4" fill="#FFF6C2" opacity="0"></circle>
    <circle id="crHeadL" cx="12" cy="13" r="2.2" fill="#f2dca0"></circle>
    <circle id="crHeadR" cx="32" cy="13" r="2.2" fill="#f2dca0"></circle>

    <g id="crEyes">
      <circle cx="17" cy="21" r="2.4" fill="#1a1c20"></circle>
      <circle cx="27" cy="21" r="2.4" fill="#1a1c20"></circle>
    </g>

    <rect id="crStopL" x="9" y="57" width="6" height="4" rx="2" fill="#7a2c28" opacity="0.5"></rect>
    <rect id="crStopR" x="29" y="57" width="6" height="4" rx="2" fill="#7a2c28" opacity="0.5"></rect>

    <rect x="3" y="20" width="4" height="12" rx="2" fill="#222"></rect>
    <rect x="37" y="20" width="4" height="12" rx="2" fill="#222"></rect>
    <rect x="3" y="40" width="4" height="12" rx="2" fill="#222"></rect>
    <rect x="37" y="40" width="4" height="12" rx="2" fill="#222"></rect>
  </g>
`;

// ---- кешовані посилання на під-елементи (заповнюються в init) ----
const els = {};

// ---- анімаційний стан (пружини/таймери), окремо від імпортованого `state` ----
const rig = {
  ready: false,
  // вушка: легка "пружна" (spring-like) реакція на кермо, ±5°
  ear: { pos: 0, vel: 0 },
  // хвіст: явна spring-damper фізика, ціль — бічне прискорення, ліміт ±35°
  tail: { pos: 0, vel: 0 },
  lastHeading: 0,
  // моргання очей раз на 3–6с, ~90мс
  blinkPhase: 0,       // >0 поки триває моргання
  blinkCooldown: 3 + Math.random() * 3,
  // squash/stretch кузова на різкій зміні швидкості
  squash: { pos: 0, vel: 0 },
  lastSpeed: 0,
  // поворотники: миготіння 2Гц + пам'ять зміни смуги
  blinkClock: 0,
  lastLane: 0,
  laneSignalDir: 0,    // -1 ліворуч / +1 праворуч / 0 нема
  laneSignalT: 0,
};

const last = {}; // діф-кеш останніх записаних DOM-значень

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Демпфована пружина (semi-implicit Euler): pos прямує до target.
// k — жорсткість, damping — коефіцієнт затухання (≈1 = критичне).
function stepSpring(s, target, k, damping, dt) {
  const c = 2 * Math.sqrt(k) * damping;
  const accel = -k * (s.pos - target) - c * s.vel;
  s.vel += accel * dt;
  s.pos += s.vel * dt;
  // снеп у спокій, щоб діф-кеш реально переставав писати в DOM
  if (Math.abs(s.pos - target) < 0.01 && Math.abs(s.vel) < 0.01) {
    s.pos = target; s.vel = 0;
  }
  return s.pos;
}

function setTf(el, key, tf) {
  if (!el) return;
  if (last[key] !== tf) { last[key] = tf; el.style.transform = tf; }
}
function setOp(el, key, op) {
  if (!el) return;
  const v = (Math.round(op * 1000) / 1000);
  if (last[key] !== v) { last[key] = v; el.style.opacity = String(v); }
}
function setFill(el, key, color) {
  if (!el) return;
  if (last[key] !== color) { last[key] = color; el.setAttribute('fill', color); }
}

function rotateAround(cx, cy, deg) {
  return `translate(${cx}px,${cy}px) rotate(${deg.toFixed(2)}deg) translate(${-cx}px,${-cy}px)`;
}
function scaleYAround(cx, cy, sy) {
  return `translate(${cx}px,${cy}px) scale(1,${sy.toFixed(4)}) translate(${-cx}px,${-cy}px)`;
}

export function init() {
  try {
    const carEl = document.getElementById('car');
    if (!carEl) return;

    // власний <style> — збільшує #car (деталі мають читатися);
    // додається пізніше за базовий <style> в <head>, тож перебиває
    // однакову за специфічністю декларацію width/height/margin.
    if (!document.getElementById('catrigStyle')) {
      const st = document.createElement('style');
      st.id = 'catrigStyle';
      st.textContent = '#car{width:40px;height:62px;margin:-31px 0 0 -20px;}';
      document.head.appendChild(st);
    }

    carEl.setAttribute('viewBox', CAR_VIEWBOX);
    carEl.innerHTML = CAR_SVG;

    els.earL = carEl.querySelector('#crEarL');
    els.earR = carEl.querySelector('#crEarR');
    els.tail = carEl.querySelector('#crTail');
    els.body = carEl.querySelector('#crBody');
    els.eyes = carEl.querySelector('#crEyes');
    els.turnL = carEl.querySelector('#crTurnL');
    els.turnR = carEl.querySelector('#crTurnR');
    els.stopL = carEl.querySelector('#crStopL');
    els.stopR = carEl.querySelector('#crStopR');
    els.headL = carEl.querySelector('#crHeadL');
    els.headR = carEl.querySelector('#crHeadR');
    els.haloL = carEl.querySelector('#crHaloL');
    els.haloR = carEl.querySelector('#crHaloR');

    rig.lastHeading = car.heading || 0;
    rig.lastSpeed = car.speed || 0;
    rig.lastLane = car.lane || 0;

    rig.ready = true;
  } catch (e) { /* CATRIG ніколи не має зламати основний ігровий цикл */ }
}

export function step(dt) {
  if (!rig.ready) return;
  try {
    dt = clamp(Number(dt) || 0, 0, 0.1);
    if (dt <= 0) return;

    // ---------- вушка: нахил у бік повороту, ±5°, пружно ----------
    const earTarget = (input.right ? 5 : 0) - (input.left ? 5 : 0);
    const earPos = stepSpring(rig.ear, earTarget, 16, 0.55, dt);
    setTf(els.earL, 'earL', rotateAround(10.5, 11, earPos));
    setTf(els.earR, 'earR', rotateAround(33.5, 11, earPos));

    // ---------- хвіст: spring-damper, ціль — бічне прискорення ----------
    const yawRate = (car.heading - rig.lastHeading) / dt; // рад/с
    rig.lastHeading = car.heading;
    const lateral = (car.speed || 0) * yawRate; // проксі бічного прискорення
    const tailTarget = clamp(-lateral * 0.6, -35, 35);
    const tailPos = clamp(stepSpring(rig.tail, tailTarget, 8, 0.85, dt), -35, 35);
    setTf(els.tail, 'tail', rotateAround(22, 60, tailPos));

    // ---------- моргання очей: раз на 3–6с, scaleY≈0.1 на 90мс ----------
    const BLINK_DUR = 0.09;
    if (rig.blinkPhase > 0) {
      rig.blinkPhase -= dt;
      if (rig.blinkPhase <= 0) { rig.blinkPhase = 0; rig.blinkCooldown = 3 + Math.random() * 3; }
    } else {
      rig.blinkCooldown -= dt;
      if (rig.blinkCooldown <= 0) rig.blinkPhase = BLINK_DUR;
    }
    let eyeScaleY = 1;
    if (rig.blinkPhase > 0) {
      const p = 1 - rig.blinkPhase / BLINK_DUR; // 0→1 за час моргання
      const closedness = 1 - Math.abs(p * 2 - 1); // 0..1..0
      eyeScaleY = 1 - closedness * 0.9; // 1 → ~0.1 → 1
    }
    setTf(els.eyes, 'eyes', scaleYAround(22, 21, eyeScaleY));

    // ---------- squash/stretch кузова на різкій зміні швидкості ----------
    const speed = car.speed || 0;
    const speedAccel = (speed - rig.lastSpeed) / dt; // км/год за секунду
    rig.lastSpeed = speed;
    if (Math.abs(speedAccel) > 40) {
      rig.squash.vel += -Math.sign(speedAccel) * 0.9;
    }
    const squashPos = stepSpring(rig.squash, 0, 280, 0.45, dt);
    const scaleY = clamp(1 + squashPos, 0.97, 1.03);
    setTf(els.body, 'body', scaleYAround(22, 35, scaleY));

    // ---------- поворотники: 2Гц, при повороті або зміні смуги ----------
    rig.blinkClock = (rig.blinkClock + dt) % 0.5; // період 0.5с = 2Гц
    const blinkOn = rig.blinkClock < 0.25;

    // clamp до поточної кількості смуг (main.js вже клампає car.lane при
    // зміні дороги, тут — захисна копія на випадок стрибка кадру)
    const maxLane = Math.max(0, (state.curLanes || 1) - 1);
    const lane = clamp((typeof car.lane === 'number') ? car.lane : rig.lastLane, 0, maxLane);
    if (lane !== rig.lastLane) {
      rig.laneSignalDir = (lane > rig.lastLane) ? 1 : -1;
      rig.laneSignalT = 1.0;
      rig.lastLane = lane;
    }
    if (rig.laneSignalT > 0) { rig.laneSignalT -= dt; if (rig.laneSignalT < 0) rig.laneSignalT = 0; }

    const leftOn = !!input.left || (rig.laneSignalDir < 0 && rig.laneSignalT > 0);
    const rightOn = !!input.right || (rig.laneSignalDir > 0 && rig.laneSignalT > 0);
    setOp(els.turnL, 'turnL', leftOn ? (blinkOn ? 1 : 0.18) : 0.18);
    setOp(els.turnR, 'turnR', rightOn ? (blinkOn ? 1 : 0.18) : 0.18);

    // ---------- стоп-сигнали: гальмування ----------
    const braking = !!input.brake;
    setFill(els.stopL, 'stopLFill', braking ? '#FF5A4E' : '#7a2c28');
    setFill(els.stopR, 'stopRFill', braking ? '#FF5A4E' : '#7a2c28');
    setOp(els.stopL, 'stopLOp', braking ? 1 : 0.5);
    setOp(els.stopR, 'stopROp', braking ? 1 : 0.5);

    // ---------- фари: вночі яскравіші ----------
    const isNight = !!(window.LIVE && window.LIVE.isNight);
    setFill(els.headL, 'headLFill', isNight ? '#FFF6C2' : '#f2dca0');
    setFill(els.headR, 'headRFill', isNight ? '#FFF6C2' : '#f2dca0');
    setOp(els.haloL, 'haloLOp', isNight ? 0.55 : 0);
    setOp(els.haloR, 'haloROp', isNight ? 0.55 : 0);
  } catch (e) { /* CATRIG ніколи не має зламати основний ігровий цикл */ }
}

if (typeof window !== 'undefined') {
  window.CATRIG = { init, step };
}
