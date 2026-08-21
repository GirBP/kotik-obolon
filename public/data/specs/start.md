# Послідовність «Вихід з дому → рушання авто»: дизайн для web-гри

## 1. Загальна логічна схема кроків

| # | Крок | Тип | Тривалість (анімація) | Чому саме так |
|---|------|-----|------------------------|----------------|
| 1 | Вихід з під'їзду | Автоматичний (анімація) | 1200 мс | Просто вступний рух, не несе ігрового рішення |
| 2 | Ходьба до авто | Автоматичний (waypoint-рух персонажа) | 1500–2500 мс залежно від відстані | Рух по заданій траєкторії/шляху (NavMesh або лінійний тween) |
| 3 | Відмикання авто (клік по замку/бріпк фар) | **Інтерактивна міні-дія** (тап) | миттєво + 400 мс анімація миготіння фар/звук «біп» | Дає гравцю відчуття контролю на вході в сцену |
| 4 | Відкриття дверей і посадка | Автоматичний | 900 мс | Суто анімаційна зв'язка |
| 5 | Зачинення дверей | Автоматичний (або легкий тап, якщо хочете тактильності) | 400 мс + звук «грюк» | Можна лишити автоматичним — не несе навчального сенсу |
| 6 | **Пристібання ременя** | **Інтерактивна міні-дія** (тап/свайп по ременю) | 600 мс на анімацію + чутний «клац» | КЛЮЧОВИЙ навчальний момент ПДР — має бути явним рішенням гравця |
| 7 | Заведення двигуна (тап на замок запалювання/кнопку Start) | **Інтерактивна міні-дія** (тап, утримання 0.5–1с) | 800 мс (звук стартера → рівний гул) | Друга явна дія — привчає до реального порядку дій |
| 8 | Зняття з ручника (свайп/тап важеля) | **Інтерактивна міні-дія** (свайп вниз або тап) | 500 мс | Класичний навчальний момент — забутий ручник = типова помилка новачків |
| 9 | Перемикання на D/1 передачу (тап/свайп важеля) | **Інтерактивна міні-дія** | 500 мс | Завершує підготовчий цикл перед рухом |
| 10 | Увімкнення поворотника (тап важеля повороту, з відповідного боку) | **Інтерактивна міні-дія** | 300 мс блимання починається і триває (циклічно, поки не рушить/не завершить маневр) | ПДР: обов'язковий сигнал перед початком руху від узбіччя/стоянки |
| 11 | Перевірка дзеркал/озирання (опційно, як міні-QTE) | **Інтерактивна міні-дія** (тап по дзеркалу лівому/правому + плечу) | 400 мс кожен | Підсилює навчальний ефект «перевір перед рухом», можна зробити необов'язковим бонус-кроком |
| 12 | Рушання | Автоматичний (плавний старт руху камери/машини) | 1000 мс розгін | Нагорода-результат усіх попередніх дій |

**Правило дизайну**: інтерактивними робимо тільки ті дії, які прямо регламентовані ПДР і типово порушуються новачками або забуваються (ремінь, ручник, передача, поворотник, запалювання). Ходьба, відкриття/закриття дверей — суто "зв'язки" сцени, їх інтерактивність тільки сповільнює гравця без навчальної цінності.

---

## 2. Скінченний автомат станів (JS)

```js
// ==== СТАНИ ====
const States = Object.freeze({
  EXIT_BUILDING:   'EXIT_BUILDING',
  WALK_TO_CAR:     'WALK_TO_CAR',
  UNLOCK_CAR:      'UNLOCK_CAR',
  ENTER_CAR:       'ENTER_CAR',
  CLOSE_DOOR:      'CLOSE_DOOR',
  FASTEN_BELT:     'FASTEN_BELT',      // інтерактивний
  START_ENGINE:    'START_ENGINE',     // інтерактивний
  RELEASE_HANDBRAKE:'RELEASE_HANDBRAKE', // інтерактивний
  SHIFT_GEAR:      'SHIFT_GEAR',       // інтерактивний
  TURN_SIGNAL:     'TURN_SIGNAL',      // інтерактивний
  CHECK_MIRRORS:   'CHECK_MIRRORS',    // інтерактивний, опційний
  DEPARTING:       'DEPARTING',
  DRIVING:         'DRIVING',
  BLOCKED_NO_BELT: 'BLOCKED_NO_BELT'   // спеціальний "штрафний" стан
});

// ==== КОНФІГ ПЕРЕХОДІВ ====
// кожен стан описує: чи інтерактивний, тривалість авто-анімації,
// подію, яка потрібна для переходу, і наступний стан
const StateMachineConfig = {
  [States.EXIT_BUILDING]: {
    interactive: false,
    duration: 1200,
    next: States.WALK_TO_CAR,
  },
  [States.WALK_TO_CAR]: {
    interactive: false,
    duration: 2000, // масштабується під реальну дистанцію waypoint'ів
    next: States.UNLOCK_CAR,
  },
  [States.UNLOCK_CAR]: {
    interactive: true,
    prompt: 'Тапни на авто, щоб відімкнути',
    onEnter: (ctx) => ctx.ui.showHint('unlock_car'),
    onAction: (ctx) => {
      ctx.audio.play('car_beep_unlock');
      ctx.fx.play('headlights_blink');
    },
    duration: 400, // тривалість фідбек-анімації ПІСЛЯ тапу
    next: States.ENTER_CAR,
  },
  [States.ENTER_CAR]: {
    interactive: false,
    duration: 900,
    next: States.CLOSE_DOOR,
  },
  [States.CLOSE_DOOR]: {
    interactive: false,
    duration: 400,
    onEnter: (ctx) => ctx.audio.play('door_slam'),
    next: States.FASTEN_BELT,
  },
  [States.FASTEN_BELT]: {
    interactive: true,
    prompt: 'Пристебни ремінь безпеки',
    onEnter: (ctx) => {
      ctx.ui.showHint('fasten_belt');
      ctx.flags.beltFastened = false;
    },
    onAction: (ctx) => {
      ctx.flags.beltFastened = true;
      ctx.audio.play('seatbelt_click'); // чутний "клац"
      ctx.fx.play('belt_strap_animation');
      ctx.ui.hideHint();
    },
    duration: 600,
    next: States.START_ENGINE,
  },
  [States.START_ENGINE]: {
    interactive: true,
    prompt: 'Заведи двигун (утримуй)',
    holdDurationMs: 700, // якщо реалізуєте як "затиснути кнопку"
    onEnter: (ctx) => ctx.ui.showHint('start_engine'),
    onAction: (ctx) => {
      ctx.audio.play('engine_start');
      ctx.fx.play('dashboard_lights_on');
    },
    duration: 800,
    next: States.RELEASE_HANDBRAKE,
  },
  [States.RELEASE_HANDBRAKE]: {
    interactive: true,
    prompt: 'Зніми з ручника',
    onEnter: (ctx) => ctx.ui.showHint('handbrake'),
    onAction: (ctx) => ctx.audio.play('handbrake_release'),
    duration: 500,
    next: States.SHIFT_GEAR,
  },
  [States.SHIFT_GEAR]: {
    interactive: true,
    prompt: 'Увімкни передачу D',
    onEnter: (ctx) => ctx.ui.showHint('shift_gear'),
    onAction: (ctx) => ctx.audio.play('gear_shift'),
    duration: 500,
    next: States.TURN_SIGNAL,
  },
  [States.TURN_SIGNAL]: {
    interactive: true,
    prompt: 'Увімкни поворотник',
    onEnter: (ctx) => ctx.ui.showHint('turn_signal'),
    onAction: (ctx) => {
      ctx.audio.playLoop('turn_signal_tick');
      ctx.fx.playLoop('turn_signal_blink');
    },
    duration: 300,
    next: States.CHECK_MIRRORS,
  },
  [States.CHECK_MIRRORS]: {
    interactive: true,
    optional: true, // можна дозволити skip/timeout
    prompt: 'Перевір дзеркала (тап)',
    onEnter: (ctx) => ctx.ui.showHint('check_mirrors'),
    timeoutMs: 2500, // якщо гравець не робить дії — переходимо далі без бонусу
    duration: 400,
    next: States.DEPARTING,
  },
  [States.DEPARTING]: {
    interactive: false,
    duration: 1000,
    // ГОЛОВНА ПЕРЕВІРКА ПЕРЕД РУШАННЯМ
    onEnter: (ctx) => {
      if (!ctx.flags.beltFastened) {
        ctx.machine.transitionTo(States.BLOCKED_NO_BELT);
        return;
      }
      ctx.audio.playLoop('engine_drive');
    },
    next: States.DRIVING,
  },
  [States.BLOCKED_NO_BELT]: {
    interactive: true,
    prompt: '⚠️ Пристебни ремінь! Керування без ременя заборонене (ст. 121 КУпАП)',
    onEnter: (ctx) => {
      ctx.ui.showWarning('no_belt_penalty');
      ctx.penalty.apply('no_seatbelt'); // штрафні бали/очки в грі
    },
    onAction: (ctx) => {
      // гравець таки пристібається — повертаємось у нормальний потік
      ctx.flags.beltFastened = true;
      ctx.audio.play('seatbelt_click');
    },
    next: States.DEPARTING, // після пристібання — повторна спроба рушити
  },
  [States.DRIVING]: {
    interactive: false,
    next: null, // кінець послідовності, старт основного геймплею водіння
  },
};
```

### Мінімальний "рушій" (driver) автомата

```js
class SequenceStateMachine {
  constructor(config, ctx) {
    this.config = config;
    this.ctx = { ...ctx, flags: {}, machine: this };
    this.current = null;
  }

  transitionTo(stateName) {
    const state = this.config[stateName];
    this.current = stateName;
    state.onEnter?.(this.ctx);

    if (!state.interactive) {
      // автоматичний крок — просто чекаємо duration і йдемо далі
      setTimeout(() => {
        if (state.next) this.transitionTo(state.next);
      }, state.duration);
    } else {
      // чекаємо дію гравця (клік/тап/свайп), опційно з таймаутом
      if (state.timeoutMs) {
        this._timeout = setTimeout(() => {
          if (state.next) this.transitionTo(state.next);
        }, state.timeoutMs);
      }
    }
  }

  // викликається обробником input (onClick/onTap/onSwipe у UI-шарі)
  handlePlayerAction() {
    const state = this.config[this.current];
    if (!state.interactive) return; // ігнор кліків поза інтерактивним кроком

    clearTimeout(this._timeout);
    state.onAction?.(this.ctx);

    setTimeout(() => {
      if (state.next) this.transitionTo(state.next);
    }, state.duration);
  }

  start() {
    this.transitionTo(States.EXIT_BUILDING);
  }
}
```

---

## 3. Таймінг у секундах (зведена шкала для аніматора)

```
0.0 ──── 1.2 ─── 3.2 ──── 3.6 ──── 4.5 ──── 4.9 ──── 5.5 ──── 6.3 ──── 6.8 ──── 7.3 ──── 7.6 ──── 8.0 ──── 9.0с
 вихід    ходьба  клік    посадка  зачин.   [РЕМІНЬ] [СТАРТ]  [ручник] [D]     [поворот][дзеркала] рушання
                  замок                     клац!    двигун
```

Ключове: **пристібання ременя і заведення двигуна поставлені поруч**, як у реальному житті (спочатку ремінь — це і навчально правильно, і фізично логічно: перед запуском авто).

---

## 4. Показ підказок гравцю

Рекомендована UI-механіка (проста і не нав'язлива):

1. **Пульсуюча іконка-хотспот** над інтерактивним об'єктом (ремінь, ключ, важіль) — CSS `animation: pulse 1s infinite`, з'являється через 300 мс після входу у стан, щоб не перекривати попередню анімацію.
2. **Короткий текстовий тултип** знизу екрана (1 рядок, великий шрифт): «Пристебни ремінь» — зникає одразу після дії.
3. **Прогресивна підказка**: якщо гравець не діє впродовж ~3 секунд — іконка починає світитись яскравіше / персонаж робить легкий жест рукою до об'єкта (edge-case для новачків).
4. **Звукова відповідність**: кожен клік дає одразу аудіо-фідбек (клац, гудок, шелест) — це критично для відчуття «реальності» дії, а не просто "прогрес-бар".
5. Для мобільної версії — область тапу робити суттєво більшою за візуальний об'єкт (мінімум 44×44 px), щоб не було промахів по дрібному ремню/важелю.

---

## 5. Штраф за непристебнутий ремінь (по ПДР України)

Логіка вже закладена в станах `DEPARTING` → `BLOCKED_NO_BELT`:

- Якщо гравець намагається рушити (стан `DEPARTING`) без `flags.beltFastened === true`, автомат **не пускає далі**, а перекидає в `BLOCKED_NO_BELT`.
- У цьому стані:
  - показується попередження з посиланням на реальну норму (п. 2.4 Правил дорожнього руху України — обов'язковість пристібання ременів; відповідальність за ст. 121 КУпАП — штраф);
  - нараховується ігровий штраф (`ctx.penalty.apply('no_seatbelt')`) — це може бути втрата очок/часу/грошей у грі;
  - гравцю дається другий шанс пристебнутися, після чого потік повертається у `DEPARTING`.
- **Альтернативний, м'якший варіант** (якщо не хочете жорсткого блоку): дозволити рушити, але:
  - весь час руху на панелі приладів блимає індикатор ременя + звуковий сигнал-нагадувач (як у реальних авто);
  - у разі "аварії"/перевірки патрульним у грі — автоматичний штраф збільшується.

Раджу саме **жорсткий блок** (варіант вище, `BLOCKED_NO_BELT`) для навчальної гри — це прямо демонструє причинно-наслідковий зв'язок «не пристебнувся → не поїдеш», що сильніше закріплює звичку, ніж просто штрафні бали в фоні.

---

## Підсумок: що інтерактивне, що автоматичне

**Інтерактивні міні-дії (тап/свайп гравця):**
відмикання авто, пристібання ременя, заведення двигуна, зняття з ручника, перемикання передачі, поворотник, (опційно) перевірка дзеркал.

**Автоматичні/анімовані:**
вихід з під'їзду, ходьба до авто, посадка в салон, зачинення дверей, фінальне рушання з місця.

Файли/артефакти цієї відповіді не створювались — це проєктний дизайн-документ у чистому тексті з готовим до вставки JS-кодом стейт-машини.