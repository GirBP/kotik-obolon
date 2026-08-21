# Рефакторинг до підтримуваної архітектури

Мета: розбити моноліт `index.html` (~5460 рядків інлайн-JS) на модульну структуру
зі збіркою, лінтером, тестами й CI — щоб гру можна було **довго розвивати й підтримувати**.
Головний принцип: **поведінка гри не змінюється** (перевіряється браузер-тестами + юнітами
на кожному кроці). Робота на гілці `refactor/modular`; `main` лишається живим до злиття.

## Рішення (обґрунтування)
- **Vite** — дев-сервер + оптимізована збірка. `base:'./'` (відносні шляхи, працює під будь-яким префіксом Pages).
- **ES-модулі** у `src/`. Зберігаємо рантайм-контракт `window.*` між системами (щоб не змінювати
  міжмодульні виклики), а спільне **ядро** виносимо в явні імпорти.
- **Мутований стан → об'єкт `state`** (примітиви money/fuel/phase…); об'єкти (car/map/segments) —
  імпортовані константи з мутацією на місці. Це прибирає проблему «не можна реассайнити імпорт» в ESM.
- **JS + JSDoc** зараз; **TypeScript** — окремою інкрементальною фазою потім (`checkJs`).
- **ESLint + Prettier + Vitest**; **GitHub Actions**: lint → test → build → deploy на Pages.
- Статика (`data/`, `icons/`, `manifest`) → `public/` (Vite віддає в корінь).

## Цільова структура
```
index.html            # чистий каркас: <head> + CDN + <script type=module src=/src/main.js>
public/               # статика as-is (data/*.json, icons/, manifest.webmanifest, assets/)
src/
  core/               # спільне ядро (імпортується системами)
    config.js         #   CFG, ENG, GEARS, LANDMARKS, MP_BROKERS, BRAND_PRICE (const)
    state.js          #   мутований стан гри (money, fuel, phase, car, job, …)
    geo.js            #   toXY, fromXY, dist, проєкція
    dom.js            #   esc, toast, дрібні DOM-хелпери
    audio.js          #   ac(), bell()
    loop.js           #   tick/step, requestAnimationFrame
  world/              # map, roads (segments+grid), pois, markers
  systems/            # 16 систем: live, fm, save, traces, settings, police, lights,
                      #   speed, peds, signs, engine-audio, sfx, progression,
                      #   passengers, fmquests, onboarding, multiplayer
  ui/                 # hud, controls, panels, sequence
  main.js             # бутстрап: імпортує все, ініціалізує, запускає цикл
test/                 # Vitest юніти чистої логіки (geo, drivetrain, economy, snapping…)
```

## Фази й статус
- [x] **P0. Каркас інструментів** — package.json, vite/eslint/prettier/vitest конфіги, CI, гілка.
- [x] **P1. Віндовий крок** — інлайн-`<script>` → `src/main.js` (один модуль, поведінка ідентична), статика → public/. Verify.
- [x] **P2. Ядро** — виділити core/{config,state,geo,dom,audio,loop}; примітиви → `state.x`. Verify.
- [x] **P3. Світ** — world/{map,roads,pois,markers}. Verify.
- [x] **P4. Системи** — 16 систем у окремі файли `src/systems/*`. Verify після кожної групи.
- [x] **P5. UI** (hud винесено; решта UI — у main-каркасі) — hud/controls/panels/sequence. Verify.
- [x] **P6. Тести** — Vitest юніти чистої логіки; браузер-смоук лишається.
- [x] **P7. CI** (lint --max-warnings 0 + 16 тестів зелені) — Actions збирає й деплоїть; Pages source → GitHub Actions.
- [x] **P8. Docs** — ARCHITECTURE.md, CONTRIBUTING.md, оновити README/AUDIT.
- [ ] **P9. Merge** — верифікувати еквівалентність, злити в main, задеплоїти.

## Критерій готовності кожної фази
`npm run build` без помилок · `npm test` зелений · браузер: 0 помилок консолі,
усі модулі присутні, перф ≤ базового (~1.2 мс/кадр), регресія-їзда чиста, наратив працює.
