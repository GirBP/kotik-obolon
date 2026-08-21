// ================= СТАН ГРИ =================
// Єдине джерело правди для мутованого стану. Примітиви (money, fuel, phase…) —
// у об'єкті `state` (щоб їх можна було реассайнити з інших ES-модулів через state.X).
// Спільні об'єкти/колекції (car, segments, …) — експортовані константи, які
// мутуються на місці (не реассайняться), тож імпортуються за іменем.
import { CFG } from './config.js';

/** Мутовані примітиви стану гри. Реассайнюються як state.money = …, state.phase = … */
export const state = {
  phase: 'menu',
  roadsOnly: true,
  fuel: CFG.startFuel,
  money: CFG.startMoney,
  fuelType: 'A95',
  churchCd: 0,
  blessing: 0,
  job: null, // {from,to,stage:'pickup'|'deliver',distKm,fare}
  jobMarker: null,
  sensPoi: null,
  selectedMode: 'auto',
  handedMode: 'two',
  steerTarget: 0,
  steerActive: false,
  steerStartX: 0,
  cruiseSet: 40,
  curLanes: 1,
  lastRoadHit: null, // кеш nearestRoad() цього кадру (дедуп)
  lastT: 0,
  radioNearType: null,
  mpEnabled: false,
  ctxAction: null,
  lowShown: false,
  curStreet: '',
  seqIdx: 0,
  seqTimer: null,
};

// ---- спільні об'єкти/колекції (мутуються на місці) ----
export const car = { x: 0, y: 0, heading: 0, speed: 0 };
/** Скидання авто до заданого набору полів (замість реассайну const car). */
export function resetCar(fields) {
  for (const k in car) delete car[k];
  Object.assign(car, fields);
}

export const input = { left: false, right: false, gas: false, brake: false, clutch: false };

export const segments = []; // {ax,ay,dx,dy,len2,name,l,o,svc}
export const grid = new Map(); // просторова сітка: 'cx,cy' -> [індекси segments]
export const stations = [];
export const fuelMarks = [];
export const churchMarks = [];
export const radio = { on: false, type: null, audio: null };
export const hudCache = {}; // кеш останніх записаних значень DOM (діфінг)
