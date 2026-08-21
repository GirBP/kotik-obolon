// ================= ВЛАСНИЙ РЕНДЕР СВІТУ (basemap) =================
// Замість чужих тайлів малюємо Оболонь самі: зелень → вода → дороги → розмітка →
// будівлі (з тінню/об'ємом) → залізниця. Повний контроль над стилем.
//
// Реалізація: кастомний L.GridLayer із canvas-тайлами. Leaflet кешує намальовані
// тайли й перемальовує лише нові — тож панорамування щокадру (камера за авто)
// не коштує нічого, на відміну від тисяч DOM/vector-об'єктів.
//
// Кольори — у THEME (токени), щоб міняти художній напрям однією правкою.
import { THEME } from './theme.js';

let world = null; // { buildings:[{g,l}], water:[{g}], green:[{g}], rail:[{g}] }
let roadWays = null; // [{n,h,l,o,g}]
let layer = null;

// ---- індекс: bbox для кожного об'єкта, щоб швидко відкидати зайве ----
function bboxOf(g) {
  let s = 90,
    w = 180,
    n = -90,
    e = -180;
  for (const p of g) {
    if (p[0] < s) s = p[0];
    if (p[0] > n) n = p[0];
    if (p[1] < w) w = p[1];
    if (p[1] > e) e = p[1];
  }
  return [s, w, n, e];
}
function prep(list) {
  for (const o of list) o.bb = bboxOf(o.g);
  return list;
}
const hits = (bb, s, w, n, e) => !(bb[2] < s || bb[0] > n || bb[3] < w || bb[1] > e);

// ширина проїзної частини за класом дороги (метри)
const ROAD_W = {
  trunk: 14,
  primary: 13,
  secondary: 11,
  tertiary: 9,
  residential: 7,
  unclassified: 7,
  living_street: 6,
  service: 4.5,
};

export function sceneryLoaded() {
  return !!world;
}

/**
 * Створити й додати шар власного світу.
 * @param {L.Map} map
 * @param {object} w   вміст world.json
 * @param {Array}  ways  масив доріг із roads.json (roads[])
 */
export function addScenery(map, w, ways) {
  world = {
    buildings: prep(w.buildings || []),
    water: prep(w.water || []),
    green: prep(w.green || []),
    rail: prep(w.rail || []),
  };
  roadWays = prep((ways || []).map((r) => ({ ...r })));

  const Scenery = L.GridLayer.extend({
    createTile: function (coords) {
      const size = this.getTileSize();
      const tile = document.createElement('canvas');
      tile.width = size.x;
      tile.height = size.y;
      try {
        drawTile(tile.getContext('2d'), coords, size, map);
      } catch (_) {}
      return tile;
    },
  });

  layer = new Scenery({ tileSize: 256, keepBuffer: 3, updateWhenIdle: false, className: 'scenery' });
  layer.addTo(map);
  layer.setZIndex(0);
  return layer;
}

// ---- малювання одного тайла ----
function drawTile(ctx, coords, size, map) {
  const z = coords.z;
  // географічні межі тайла (+ запас, щоб об'єкти на межі не «обрізались» різко)
  const nwP = coords.scaleBy(size);
  const seP = nwP.add(size);
  const nw = map.unproject(nwP, z);
  const se = map.unproject(seP, z);
  const pad = (nw.lat - se.lat) * 0.25;
  const s = se.lat - pad,
    n = nw.lat + pad,
    wl = nw.lng - pad,
    e = se.lng + pad;

  // перетворення lat/lng → пікселі всередині тайла
  const ox = nwP.x,
    oy = nwP.y;
  const P = (lat, lng) => {
    const p = map.project([lat, lng], z);
    return [p.x - ox, p.y - oy];
  };
  // метри → пікселі (для ширини доріг)
  const mPerPx = 156543.03392 * Math.cos((nw.lat * Math.PI) / 180) / Math.pow(2, z);
  const m2px = (m) => m / mPerPx;

  // 0) підкладка
  ctx.fillStyle = THEME.ground;
  ctx.fillRect(0, 0, size.x, size.y);

  const poly = (g, fill, stroke, lw) => {
    ctx.beginPath();
    for (let i = 0; i < g.length; i++) {
      const [x, y] = P(g[i][0], g[i][1]);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw || 1;
      ctx.stroke();
    }
  };

  // 1) зелень
  for (const o of world.green) if (hits(o.bb, s, wl, n, e)) poly(o.g, THEME.green);
  // 2) вода
  for (const o of world.water) if (hits(o.bb, s, wl, n, e)) poly(o.g, THEME.water, THEME.waterEdge, 1.5);

  // 3) дороги: спершу «облямівка», потім проїзна частина
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of [0, 1]) {
    for (const r of roadWays) {
      if (!hits(r.bb, s, wl, n, e)) continue;
      const wm = ROAD_W[r.h] || 6;
      const wpx = m2px(wm);
      if (wpx < 0.6) continue;
      ctx.beginPath();
      for (let i = 0; i < r.g.length; i++) {
        const [x, y] = P(r.g[i][0], r.g[i][1]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      if (pass === 0) {
        ctx.strokeStyle = THEME.roadEdge;
        ctx.lineWidth = wpx + m2px(1.2);
      } else {
        ctx.strokeStyle = r.h === 'service' ? THEME.roadMinor : THEME.road;
        ctx.lineWidth = wpx;
      }
      ctx.stroke();
    }
  }

  // 4) залізниця
  for (const o of world.rail) {
    if (!hits(o.bb, s, wl, n, e)) continue;
    ctx.beginPath();
    for (let i = 0; i < o.g.length; i++) {
      const [x, y] = P(o.g[i][0], o.g[i][1]);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = THEME.rail;
    ctx.lineWidth = Math.max(1, m2px(3));
    ctx.setLineDash([m2px(4), m2px(4)]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 5) будівлі: тінь-зсув (псевдо-об'єм за поверховістю) + корпус + дах-контур
  const sh = THEME.buildingShadowDir; // напрям тіні в пікселях на поверх
  for (const o of world.buildings) {
    if (!hits(o.bb, s, wl, n, e)) continue;
    const lift = Math.min(14, 0.9 + o.l * THEME.buildingLift);
    // тінь/бік
    ctx.beginPath();
    for (let i = 0; i < o.g.length; i++) {
      const [x, y] = P(o.g[i][0], o.g[i][1]);
      i ? ctx.lineTo(x + sh[0] * lift, y + sh[1] * lift) : ctx.moveTo(x + sh[0] * lift, y + sh[1] * lift);
    }
    ctx.closePath();
    ctx.fillStyle = THEME.buildingSide;
    ctx.fill();
    // корпус
    poly(o.g, THEME.building, THEME.buildingEdge, 1);
  }
}

/** Перемалювати світ (після зміни теми). */
export function refreshScenery() {
  try {
    if (layer) layer.redraw();
  } catch (_) {}
}
