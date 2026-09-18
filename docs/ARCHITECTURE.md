# Архітектура

Гра — статичний веб-застосунок (Vite + Leaflet), без бекенду. Уся логіка — ES-модулі
в `src/`, зібрані в одну збірку; хоститься на GitHub Pages.

## Шари (згори вниз залежностей)

```
index.html            каркас: <head>, CDN (Leaflet, mqtt.js), <script type=module src=/src/main.js>
public/               статика as-is: data/*.json, icons/, manifest.webmanifest
src/
  core/               ← фундамент, ні від чого ігрового не залежить
    config.js           константи (CFG, ENG, GEARS_M, LANDMARKS, ціни, MP_BROKERS, GRID) + torqueCurve
    state.js            МУТОВАНИЙ стан: об'єкт state (money/fuel/phase/…) + car/input/segments/… (const-об'єкти)
    geo.js              toXY/fromXY (локальна пласка проєкція)
    dom.js               esc (екранування), toast (банер)
    audio.js             ac() (AudioContext), bell()
    tts.js               speakLines() (укр. TTS)
    drivetrain.js        чиста фізика КПП (без DOM/звуку) — updateDrivetrainPure/shiftGearPure/startEnginePure
  world/              ← світ на карті (залежить від core)
    map.js              Leaflet-мапа (створюється раз), dist()
    markers.js          poiIcon()
    roads.js            buildRoads/nearestRoad (сегменти+сітка+розмітка, снапінг)
    pois.js             addPOIs (АЗС/храми/Сенс)
  ui/
    hud.js              updateHUD/rangeKm/setCtxBtn (діфінг DOM)
  systems/            ← 24 підсистеми; 6 нових (fm, radio, jobs, onboarding-sequence,
                        input, drivetrain) зв'язані з main.js звичайним ES import/export,
                        решта 18 self-registers на window.X (див. нижче)
    live, fm, radio, save, traces, settings, police, lights, speed, peds, signs,
    audio(двигун), sfx, passengers, progression, fmquests, onboarding, multiplayer,
    postcard, catrig, jobs, onboarding-sequence, input, drivetrain
  main.js             ← бутстрап: імпорт систем, цикл tick/step, економіка/паливо, контекстна
                        кнопка (АЗС/храм/завести двигун), завантаження ігрових даних
test/                 Vitest-юніти чистої логіки (geo, config, state, interp, drivetrain)
```

## Ключові рішення

- **Стан.** Реассайнювані примітиви живуть у `state` (щоб їх можна було міняти з будь-якого
  модуля: `state.money -= cost`). Спільні об'єкти (`car`, `segments`, `input`, …) — експортовані
  константи, які мутуються на місці (`car.x = …`); авто скидається через `resetCar()`.
- **Ядро імпортується явно.** Усе з `core/`, `world/`, `ui/hud` — звичайні ES-імпорти. Нові
  модулі (`systems/fm.js`, `radio.js`, `jobs.js`, `onboarding-sequence.js`, `input.js`,
  `drivetrain.js`) так само зв'язані між собою явними `import`/`export`.
- **Відоме обмеження: 18 систем на `window.X`.** Решта підсистем (police, lights, speed, peds,
  signs, audio, sfx, passengers, progression, fmquests, onboarding, multiplayer, postcard, catrig,
  traces, save, settings, live) не імпортують одна одну — кожна реєструється на `window.X`
  (`window.SFX`, `window.PROGRESSION`, …) і викликається як `window.X.method()` з `&&`-охороною;
  цей патерн задокументовано в CONTRIBUTING.md як спосіб додавання нової системи. Компілятор й
  лінтер не ловлять виклик неіснуючого `window.X`, залежності між системами не видно з import-
  рядків. Заміна на явні імпорти по одній системі за раз — окрема велика робота, не зроблена тут.
- **Один напрям потоку в кадрі:** `tick(now) → step(dt)` (лише коли `state.phase==='play'`):
  ввід → фізика → снапінг до дороги → витрата пального → `map.setView` (камера за авто) →
  системи (`liveStep/fmStep/…`) → `updateHUD`. `AUDIO.step` (муркотіння) — у `tick` в обох гілках.
- **Фази (`state.phase`):** `menu | sequence | play | pause | fuel | signs | ride | progress`.
  Модальні оверлеї ставлять свою фазу, `step` завмирає, після закриття — назад у `play`.
- **Надійність.** Увесь код систем у try/catch; будь-який текст з мережі — через `esc`;
  звук поважає `window.MUTED`; маркери прибираються; таймери чистяться; діфінг перед записом у DOM.

## Dev-міст
`window.__game` існує лише в DEV (Vite прибирає з прод-збірки) — для headless-тестів у браузері.
