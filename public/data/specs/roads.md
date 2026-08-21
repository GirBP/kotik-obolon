# Технічний спец: масштаб і рух «лише по дорогах» для 2D Leaflet-гри (вигляд згори)

## 1. Масштаб: метри на піксель і розмір спрайта авто

### Формула

```
mpp(zoom, lat) = 156543.03392 * cos(lat_rad) / 2^zoom
```

Це стандартна роздільна здатність Web Mercator (156543.03392 м/px — довжина екватора / 256 на zoom=0), помножена на `cos(широта)`, бо на північних широтах масштаб Меркатора «стискається» по довготі.

### Розрахунок для широти 50.51° (Оболонь, Київ)

`cos(50.51°) ≈ 0.6359`
`156543.03392 × 0.6359 ≈ 99 551` (константа-чисельник для цієї широти)

| zoom | mpp (м/px) | довжина авто 4.5м → px | ширина авто 1.8м → px |
|---|---|---|---|
| 16 | 1.519 | **2.96 px** | 1.19 px |
| 17 | 0.760 | **5.92 px** | 2.37 px |
| 18 | 0.380 | 11.85 px | 4.74 px |
| 19 | 0.190 | 23.70 px | 9.48 px |
| 20 | 0.0949 | 47.39 px | 18.96 px |
| 21 | 0.0475 | 94.79 px | 37.91 px |

### Висновок і рекомендація zoom

На z16–z17 (які ти назвав) авто в реальному масштабі — це **3–6 пікселів**, тобто по суті невидима крапка. Для відчуття «як реальне водіння» (авто читається як об'єкт, видно капот/корму, є простір для маневру між смугами) потрібен спрайт ~25–50 px по довжині, а це:

- **zoom 19** → авто ~24×9 px — мінімально прийнятно, ще «дрібнувато»;
- **zoom 20** → авто ~47×19 px — оптимально, «як реальне водіння»;
- **zoom 21** → авто ~95×38 px — дуже наближено, підійде для «аркадного» відчуття вулиці.

**Важливий нюанс:** стандартні OSM-тайли (raster, наприклад `tile.openstreetmap.org`) зазвичай мають нативний максимум **zoom 19**. На z20–21 Leaflet буде або растягувати (`maxNativeZoom`) вже наявні тайли (розмите зображення), або запит впаде в 404, якщо провайдер не віддає такий zoom. Тому практичні варіанти:

1. `maxZoom: 20-21` + `maxNativeZoom: 19` (Leaflet сам масштабує останній нативний тайл) — карта трохи розмита, зате авто виглядає нормально.
2. Лишити карту на z18-19 (чіткі тайли), а **спрайт авто намалювати з навмисним перебільшенням** (1.5–2.5× від «чесного» розміру) — так роблять у більшості топ-даун автосимуляторів на реальних картах (авто все одно ніколи не «чесного» масштабу відносно доріг, бо реальні смуги ~3м = ~16px на z19, а машина 1.8м впритул не влізе між розміткою при чесному масштабуванні спрайта з художньою деталізацією).

Рекомендація: **zoom 19** як базовий (баланс чіткості тайлів і видимості авто) з коефіцієнтом візуального перебільшення спрайта ×1.5–2, або **zoom 20 з `maxNativeZoom:19`**, якщо потрібен саме «чесний» метричний розмір.

---

## 2. Режим «лише по дорогах»

### Крок 0 — локальна проєкція lat/lng → метри

Оболонь — невелика ділянка (кілька км), тому рівновіддалена (equirectangular) проєкція відносно опорної точки достатньо точна (похибка — сантиметри):

```js
const REF_LAT = 50.51;
const M_PER_DEG_LAT = 111320;                                   // м/градус, майже стала
const M_PER_DEG_LNG = 111320 * Math.cos(REF_LAT * Math.PI / 180);

function toXY([lat, lng], origin) {
  return {
    x: (lng - origin.lng) * M_PER_DEG_LNG,
    y: (lat - origin.lat) * M_PER_DEG_LAT
  };
}
function fromXY(x, y, origin) {
  return {
    lat: origin.lat + y / M_PER_DEG_LAT,
    lng: origin.lng + x / M_PER_DEG_LNG
  };
}
```

Робота з рухом іде в метрах (XY), рендер на карту — конвертація назад у lat/lng.

### Крок 1 — сегменти доріг + граф перехресть

417 полілиній розбиваються на окремі відрізки (пара сусідніх точок):

```js
const origin = { lat: 50.51, lng: 30.50 };
const segments = []; // { idx, ax, ay, bx, by, dx, dy, len2, roadId, nodeA, nodeB }

roads.forEach((line, roadId) => {
  for (let i = 0; i < line.length - 1; i++) {
    const A = toXY(line[i], origin);
    const B = toXY(line[i + 1], origin);
    const dx = B.x - A.x, dy = B.y - A.y;
    segments.push({
      idx: segments.length,
      ax: A.x, ay: A.y, bx: B.x, by: B.y,
      dx, dy, len2: dx * dx + dy * dy,
      roadId
    });
  }
});
```

**Граф вузлів (перехресть)** — кінці сегментів, що збігаються з допуском (epsilon у метрах, бо дороги OSM часто мають спільні кінцеві точки саме в місцях перетину):

```js
const NODE_EPS = 1.0; // м
const nodeIndex = new Map();
const nodes = []; // { x, y, segments: [{segIdx, end}] }

function nodeKey(x, y) {
  return Math.round(x / NODE_EPS) + ',' + Math.round(y / NODE_EPS);
}
function getOrCreateNode(x, y) {
  const k = nodeKey(x, y);
  if (!nodeIndex.has(k)) { nodeIndex.set(k, nodes.length); nodes.push({ x, y, segments: [] }); }
  return nodeIndex.get(k);
}

segments.forEach(s => {
  s.nodeA = getOrCreateNode(s.ax, s.ay);
  s.nodeB = getOrCreateNode(s.bx, s.by);
  nodes[s.nodeA].segments.push({ segIdx: s.idx, end: 'A' });
  nodes[s.nodeB].segments.push({ segIdx: s.idx, end: 'B' });
});

const roadGraph = {
  getConnected(segIdx) {
    const s = segments[segIdx];
    const ids = [...nodes[s.nodeA].segments, ...nodes[s.nodeB].segments].map(e => e.segIdx);
    return [...new Set(ids)].filter(i => i !== segIdx);
  }
};
```

Якщо реальні дані не гарантують точного збігу координат на перехрестях (буває в OSM-експортах) — збільшити `NODE_EPS` до 2–3 м, або попередньо «зшити» кінці, які близькі, але не ідентичні.

### Крок 2 — просторова сітка (grid) для 417 сегментів

```js
const CELL = 60; // м — приблизно довжина типового відрізка
const grid = new Map(); // "cx,cy" -> [segIdx, ...]

function cellKey(cx, cy) { return cx + ',' + cy; }

segments.forEach(s => {
  const minX = Math.min(s.ax, s.bx), maxX = Math.max(s.ax, s.bx);
  const minY = Math.min(s.ay, s.by), maxY = Math.max(s.ay, s.by);
  const cx0 = Math.floor(minX / CELL), cx1 = Math.floor(maxX / CELL);
  const cy0 = Math.floor(minY / CELL), cy1 = Math.floor(maxY / CELL);
  for (let cx = cx0; cx <= cx1; cx++)
    for (let cy = cy0; cy <= cy1; cy++) {
      const k = cellKey(cx, cy);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(s.idx);
    }
});
```

Довгий сегмент вставляється у всі клітинки свого bounding box (проста і достатня апроксимація для доріг такої довжини; для дуже довгих діагональних відрізків можна замінити на растеризацію лінії, але для міських кварталів bbox-варіант ефективний).

**Про продуктивність:** 417 сегментів — це настільки мало, що навіть брутфорс (перебір усіх 417 на кожен кадр для однієї машини) займає долі мілісекунди в JS. Grid тут не критичний для одного авто, але корисний якщо буде кілька NPC-машин або частий пошук — тоді типовий запит повертає 5–15 кандидатів замість 417.

### Крок 3 — проекція точка→відрізок (базова формула)

```
t = clamp( ((P - A) · (B - A)) / |B - A|^2 , 0, 1 )
proj = A + t * (B - A)
dist = |P - proj|
```

```js
function projectPointToSegment(px, py, s) {
  let t = 0;
  if (s.len2 > 0) {
    t = ((px - s.ax) * s.dx + (py - s.ay) * s.dy) / s.len2;
    t = Math.max(0, Math.min(1, t));
  }
  const projX = s.ax + t * s.dx, projY = s.ay + t * s.dy;
  const dx = px - projX, dy = py - projY;
  return { t, x: projX, y: projY, dist: Math.sqrt(dx * dx + dy * dy) };
}
```

### Крок 4 — пошук найближчого сегмента через grid (fallback)

```js
function findNearestSegment(px, py) {
  const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
  let best = null;
  for (let r = 1; r <= 6 && !best; r++) {
    const seen = new Set();
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) {
        const bucket = grid.get(cellKey(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const segIdx of bucket) {
          if (seen.has(segIdx)) continue;
          seen.add(segIdx);
          const proj = projectPointToSegment(px, py, segments[segIdx]);
          if (!best || proj.dist < best.dist) best = { segIdx, ...proj };
        }
      }
  }
  return best;
}
```

### Крок 5 — утримання на дорозі: «липкий» поточний сегмент + гістерезис

Ключова ідея проти «зіскакування»: **не шукати найближчий сегмент з нуля щокадру** — спершу перевіряти поточний сегмент і його сусідів по графу (тільки ті, що з'єднані у вузлах), і міняти активний сегмент лише якщо новий кандидат помітно кращий (гістерезис-маржа). Повний grid-пошук — лише fallback, коли авто «злетіло» задалеко (перший кадр, телепорт, увімкнення режиму).

```js
let carState = { x: 0, y: 0, heading: 0, segIdx: null, t: 0, onRoadOnly: true };

const STICK_RADIUS = 2.0;   // м — лишаємось на сегменті, поки в межах
const SWITCH_MARGIN = 0.3;  // м — новий сегмент має бути ближчим щонайменше на стільки

function updateRoadProjection(desiredX, desiredY) {
  let candidate = null;

  if (carState.segIdx !== null) {
    const cur = segments[carState.segIdx];
    const curProj = projectPointToSegment(desiredX, desiredY, cur);

    if (curProj.dist < STICK_RADIUS) {
      candidate = { segIdx: carState.segIdx, ...curProj };
    } else {
      let localBest = null;
      for (const nIdx of roadGraph.getConnected(carState.segIdx)) {
        const proj = projectPointToSegment(desiredX, desiredY, segments[nIdx]);
        if (!localBest || proj.dist < localBest.dist) localBest = { segIdx: nIdx, ...proj };
      }
      if (localBest && localBest.dist < curProj.dist + SWITCH_MARGIN) candidate = localBest;
    }
  }

  return candidate || findNearestSegment(desiredX, desiredY);
}
```

### Крок 6 — поведінка на перехрестях/поворотах

Ідея: коли `t` сегмента близько до 0 або 1 (авто біля вузла), heading вирівнюється за **бажаним керуванням гравця** (вільний поворот), а не за напрямом старого сегмента; на прямій ділянці (t в середині) heading плавно (lerp) підтягується до напряму дороги — це і дає ефект «утримання в смузі» без різких ривків при незначних відхиленнях керма.

```js
function lerpAngle(a, b, k) {
  let diff = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + diff * k;
}

function updateCar(dt, input) {
  const speed = computeSpeed(input, dt);
  const desiredHeading = computeHeading(carState.heading, input, dt);
  const desiredX = carState.x + Math.cos(carState.heading) * speed * dt;
  const desiredY = carState.y + Math.sin(carState.heading) * speed * dt;

  if (carState.onRoadOnly) {
    const proj = updateRoadProjection(desiredX, desiredY);
    carState.segIdx = proj.segIdx;
    carState.t = proj.t;
    carState.x = proj.x;
    carState.y = proj.y;

    const s = segments[proj.segIdx];
    const roadHeading = Math.atan2(s.dy, s.dx);
    const nearNode = proj.t < 0.08 || proj.t > 0.92;

    carState.heading = nearNode
      ? desiredHeading                                   // біля перехрестя — вільний поворот
      : lerpAngle(carState.heading, roadHeading, 0.25);   // на прямій — м'яко тримає в напрямі дороги
  } else {
    carState.x = desiredX;
    carState.y = desiredY;
    carState.heading = desiredHeading;
  }

  const latlng = fromXY(carState.x, carState.y, origin);
  marker.setLatLng(latlng);
}
```

**Вибір напряму на Т-подібному/хрестоподібному перехресті:** серед `roadGraph.getConnected()` кандидатів обирати не просто мінімальну відстань, а зважувати на кут між `desiredHeading` (куди повертає гравець) і напрямом виходу кожного сегмента з вузла — так авто «слухається керма» на розвилці, а не завжди їде по найкоротшій проекції. Проста реалізація: серед сегментів у радіусі вузла (~3-5м) обрати той, чий кут із desiredHeading мінімальний, і лише якщо жоден не в «конусі» ±100° — падати на чисту мінімальну відстань.

### Крок 7 — анти-«зіскакування» (підсумок механізмів)

1. **Гістерезис** (`SWITCH_MARGIN`) — не перемикати сегмент через шум/дрібні коливання.
2. **Обмеження пошуку сусідами по графу**, а не всім масивом — авто фізично не може «телепортнутись» на паралельну вулицю за 100м.
3. **Clamp t ∈ [0,1]** у проекції — позиція завжди на відрізку, не за його межами.
4. **near-node зона** для вільного повороту — запобігає «застряганню» під кутом на в'їзді в перехрестя.
5. Fallback (`findNearestSegment` через grid) — тільки коли `curProj.dist` перевищує розумний поріг (авто «злетіло» — старт гри, дебаг-телепорт, разова похибка).

### Крок 8 — перемикач «лише дороги ↔ будь-де»

```js
function setOnRoadOnly(value) {
  carState.onRoadOnly = value;
  if (value) {
    // при увімкненні — одразу "прилипнути" до найближчої дороги, без ривка на екрані
    const proj = findNearestSegment(carState.x, carState.y);
    carState.segIdx = proj.segIdx;
    carState.t = proj.t;
    carState.x = proj.x;
    carState.y = proj.y;
  }
  // при вимкненні (value=false) нічого конвертувати не треба —
  // carState.x/y вже валідні світові координати, просто перестають клемпитись
}
```

---

## Підсумок

- **Масштаб:** формула `156543.03392·cos(lat)/2^zoom`; на широті 50.51° z16→1.52 м/px (авто ~3px), z17→0.76 м/px (авто ~6px) — обидва задорого «дрібні» для відчуття водіння. Рекомендація: **zoom 19–20**, за потреби з `maxNativeZoom:19` або з художнім перебільшенням спрайта ×1.5–2.
- **Рух по дорогах:** локальна метрична проєкція → сегменти + граф вузлів-перехресть → grid-індекс (60м комірка) для швидкого fallback-пошуку → щокадру спершу перевіряється поточний сегмент і сусіди по графу (липкість + гістерезис) → clamp позиції по t∈[0,1] відрізка → heading вільний біля вузлів, підтягується до дороги на прямій → перемикач просто вмикає/вимикає клемпінг, з одноразовим «прилипанням» при активації.

Готовий приклад показує повний робочий пайплайн (структури даних + псевдокод), який можна напряму адаптувати під конкретний формат вхідних 417 полілиній Оболоні.