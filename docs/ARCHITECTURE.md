# Архітектура

Гра — статичний веб-застосунок (Vite + Leaflet), без бекенду. Уся логіка — ES-модулі
в `src/`, зібрані в один бандл; хоститься на GitHub Pages.

## Шари (згори вниз залежностей)

```
index.html            каркас: <head>, CDN (Leaflet, mqtt.js), <script type=module src=/src/main.js>
public/               статика as-is: data/*.json, icons/, manifest.webmanifest
src/
  core/               ← фундамент, ні від чого ігрового не залежить
    config.js           константи (CFG, ENG, GEARS_M, LANDMARKS, ціни, MP_BROKERS, GRID) + torqueCurve
    state.js            МУТОВАНИЙ стан: об'єкт state (money/fuel/phase/…) + car/input/segments/… (const-об'єкти)
    geo.js              toXY/fromXY (локальна пласка проєкція)
    dom.js              esc (екранування), toast (банер)
    audio.js            ac() (AudioContext), bell()
    tts.js              speakLines() (укр. TTS)
  world/              ← світ на карті (залежить від core)
    map.js              Leaflet-мапа (створюється раз), dist()
    markers.js          poiIcon()
    roads.js            buildRoads/nearestRoad (сегменти+сітка+розмітка, снапінг)
    pois.js             addPOIs (АЗС/храми/Сенс)
  ui/
    hud.js              updateHUD/rangeKm/setCtxBtn (діфінг DOM)
  systems/            ← 16 підсистем, кожна self-registers на window.X
    live, fm*, save, traces, settings, police, lights, speed, peds, signs,
    audio(двигун), sfx, progression, passengers, fmquests, onboarding
  main.js             ← ігрове ядро: фізика (updateDrivetrain), економіка/паливо, завдання,
                        цикл tick/step, ввід, послідовність старту, радіо*, мультиплеєр*, FM*, бутстрап
test/                 Vitest-юніти чистої логіки
```
\* FM, радіо і мультиплеєр поки лишаються в `main.js` (тісно сплетені з ядром); кандидати на
винесення в `systems/` за тим самим патерном.

## Ключові рішення

- **Стан.** Реассайнювані примітиви живуть у `state` (щоб їх можна було міняти з будь-якого
  модуля: `state.money -= cost`). Спільні об'єкти (`car`, `segments`, `input`, …) — експортовані
  константи, які мутуються на місці (`car.x = …`); авто скидається через `resetCar()`.
- **Міжсистемний зв'язок — через `window.X`.** Системи не імпортують одна одну; вони
  реєструються на `window.LIVE`/`window.FM`/… і викликають одна одну через `window.X.method()`
  (з `&&`-охороною). Це прибирає циклічні залежності й дозволяє незалежну розробку систем.
- **Ядро імпортується явно.** Усе з `core/`, `world/`, `ui/hud` — звичайні ES-імпорти.
- **Один напрям потоку в кадрі:** `tick(now) → step(dt)` (лише коли `state.phase==='play'`):
  ввід → фізика → снапінг до дороги → витрата пального → `map.setView` (камера за авто) →
  системи (`liveStep/fmStep/…`) → `updateHUD`. `AUDIO.step` (муркотіння) — у `tick` в обох гілках.
- **Фази (`state.phase`):** `menu | sequence | play | pause | fuel | signs | ride | progress`.
  Модальні оверлеї ставлять свою фазу, `step` завмирає, після закриття — назад у `play`.
- **Надійність (з аудиту):** увесь код систем у try/catch; будь-який текст з мережі — через `esc`;
  звук поважає `window.MUTED`; маркери прибираються; таймери чистяться; діфінг перед записом у DOM.

## Dev-міст
`window.__game` існує лише в DEV (Vite прибирає з прод-збірки) — для headless-тестів у браузері.

Повний план і статус рефакторингу — [REFACTOR.md](REFACTOR.md).
