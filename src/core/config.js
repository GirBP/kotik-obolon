// ================= КОНФІГ (незмінні константи гри) =================

export const CFG = {
  zoom: 19,
  center: [50.5085, 30.503],
  tank: 50,
  startFuel: 5,
  startMoney: 900,
  consCity: 12.0, // л/100км (місто, ігровий темп)
  idleLh: 1.1, // л/год на холостому
  maxSpeed: 58,
  accel: 22,
  brake: 60,
  friction: 10,
  turn: 2.7,
  cruise: 42,
  jobBase: 40,
  jobPerKm: 20,
  churchBonus: 50,
  churchCooldownSec: 90,
  arrive: 22, // м — радіус «прибуття»
  laneW: 3.0, // ширина смуги, м
  radioR: 85, // радіус дії радіо біля POI, м (храми стоять у глибині кварталів)
  holdMs: 240, // тап (зміна смуги) vs утримання (кермо)
};

export const BRAND_PRICE = {
  WOG: 78.9,
  ОККО: 78.9,
  SOCAR: 77.9,
  KLO: 72.9,
  КЛО: 72.9,
  Народна: 71.0,
  Parallel: 73.0,
};
export const LPG_PRICE = 40.0;

// ===== КПП (реалістична модель) =====
export const GEARS_M = { '-1': -13.53, 0: 0, 1: 14.15, 2: 7.95, 3: 5.54, 4: 4.22, 5: 3.36 };
export const ENG = {
  idle: 800,
  redline: 6000,
  fuelcut: 6500,
  stall: 450,
  stallGrace: 0.35,
  revUp: 9,
  revDown: 6,
  mass: 1200,
  KFAC: 8.77,
  forceK: 300,
  dragA: 0.32,
  roll: 60,
  brakeN: 6500,
};

/** Крива крутного моменту двигуна (нормалізована 0..1) за обертами. Чиста функція. */
export function torqueCurve(rpm) {
  const p = [
    [800, 0.5],
    [2000, 0.78],
    [3500, 1.0],
    [4500, 0.97],
    [6000, 0.6],
    [6500, 0],
  ];
  if (rpm <= p[0][0]) return p[0][1];
  for (let i = 0; i < p.length - 1; i++) {
    if (rpm <= p[i + 1][0]) {
      const [x0, y0] = p[i],
        [x1, y1] = p[i + 1];
      return y0 + ((y1 - y0) * (rpm - x0)) / (x1 - x0);
    }
  }
  return 0;
}

// Орієнтири для замовлень (реальні місця Оболоні)
export const LANDMARKS = [
  { name: 'Метро «Оболонь»', lat: 50.5013, lng: 30.4983 },
  { name: 'Метро «Мінська»', lat: 50.5122, lng: 30.4985 },
  { name: 'Метро «Героїв Дніпра»', lat: 50.5223, lng: 30.499 },
  { name: 'ТРЦ Dream Town', lat: 50.5236, lng: 30.4972 },
  { name: 'Парк «Наталка»', lat: 50.5188, lng: 30.5192 },
  { name: 'Оболонська набережна', lat: 50.5115, lng: 30.516 },
  { name: 'Озеро Опечень', lat: 50.514, lng: 30.5065 },
  { name: 'Оболонський проспект', lat: 50.5065, lng: 30.4995 },
];

// Публічні MQTT-брокери для мультиплеєра/слідів (EMQX → HiveMQ фолбек)
export const MP_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];

// Розмір клітинки просторової сітки доріг (м)
export const GRID = 60;
