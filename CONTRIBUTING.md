# Розробка

Гра — статичний Vite-застосунок. Потрібен Node ≥ 18.

## Команди

```bash
npm install        # встановити залежності (раз)
npm run dev        # дев-сервер із HMR → http://localhost:5173
npm run build      # прод-збірка у dist/
npm run preview    # переглянути прод-збірку локально
npm test           # Vitest (юніти чистої логіки)
npm run lint       # ESLint (0 попереджень)
npm run format     # Prettier (форматування src/)
```

## Робочий процес

1. `npm run dev`, розробляй; зміни підхоплюються миттєво (HMR).
2. Перед комітом: `npm run lint && npm test && npm run build` — усе має бути зелене.
3. Push у `main` → GitHub Actions автоматично: lint → test → build → деплой на Pages.

## Де що додавати

- **Нова система** (світлофори-2, погода, тощо): створи `src/systems/<name>.js`,
  зареєструй `window.<NAME> = { init, step, … }`, імпортуй потрібне з `core/`/`world/`/`ui/hud`,
  а інші системи клич через `window.X.method()`. У `main.js` додай `import './systems/<name>.js';`
  і виклики `init()`/`step(dt)` у бутстрапі/циклі (з `&&`-охороною).
- **Спільний хелпер/константа:** у відповідний `core/` модуль (не в систему).
- **Контент** (тексти, дані): `public/data/*.json` (вантажиться через `fetch` у рантаймі).

## Правила надійності (обов'язково — з аудиту)

Увесь код систем у `try/catch`; будь-який текст з мережі/інших гравців — через `esc()` перед DOM;
звук лише коли `!window.MUTED`; прибирай свої маркери; не плоди `setInterval`/маркери; діфінг
перед записом у DOM; активна логіка — лише `state.phase==='play'`. Деталі — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Тести

Юніти — для **чистої логіки** (гео, фізика, економіка, парсинг). Модулі, що тягнуть Leaflet
(`world/*`), у Node не імпортуються — їх перевіряємо браузер-смоуком через `window.__game`
(див. ARCHITECTURE). Додавай юніти в `test/*.test.js`.
