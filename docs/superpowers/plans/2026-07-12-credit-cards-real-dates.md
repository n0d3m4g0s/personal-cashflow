# Кредитки с реальными датами грейса — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить абстрактное "число месяца" на явные даты цикла карты (выписка/платёж/конец грейса) с автопродлением, добавить авторасчёт обязательного платежа по формулам банков и включить карты в прогноз и месячную картину как единый организм.

**Architecture:** Вся финансовая логика — чистыми функциями в `src/finance.js` (тестируется через `node --test`). Стор (`src/store.js`) мигрирует старые данные. Компонент `CardsView.vue` остаётся тонким: редактирует новые поля и отображает результат чистых функций. Три слоя проекта (ядро → стор → компоненты) не меняются.

**Tech Stack:** Vue 3 (Composition API, `<script setup>`), Vite, чистый Node для тестов (`node --test`, без раннера), localStorage.

## Global Constraints

- Комментарии и весь UI-текст на русском.
- Даты — локальные без сдвигов TZ: только `new Date(y, m, d)` / `parseDate` / `fmtISO` / `addMonths`, никакого UTC-парсинга ISO-строк.
- Любая денежная величина хранится как `{ amount, currency }` в нативной валюте; в рубли конвертируется только в точке расчёта через `moneyToRub(money, rates)`.
- Новая финансовая логика — чистой функцией в `src/finance.js` + тест в `test/finance.test.js`, не внутри компонента.
- Запуск тестов: `npm test`. Отдельный тест: `node --test --test-name-pattern '<pattern>'`.
- Ставки в модели карты хранятся как доля (0.619 = 61,9% годовых). Проценты: `apr × сумма × дни/365`.
- Работаем в ветке `cards-real-dates`. Коммитим часто, каждая задача заканчивается зелёными тестами.

---

## Файловая структура

- `src/finance.js` — новые/изменённые чистые функции: `cardCycle`, `cardNextDue` (обёртка), `cardMinPayment` (обобщённая), правки в `buildForecast` и `buildMonthly`.
- `src/store.js` — `migrate()` дополняет карты новыми полями.
- `src/seed.js` — фабрика `card()` создаёт карты с новыми полями.
- `src/components/CardsView.vue` — форма ввода трёх дат вместо чисел; отображение цикла и минплатежа.
- `test/finance.test.js` — тесты для всех новых функций и регрессия на баг "карты не в прогнозе".

---

### Task 1: `cardCycle()` — актуальный цикл карты с автопродлением

**Files:**
- Modify: `src/finance.js` (добавить `cardCycle` рядом с `cardNextDue`, ~строка 176)
- Test: `test/finance.test.js`

**Interfaces:**
- Consumes: `parseDate`, `addDays`, `diffDays`, `addMonths`, `clampDayToMonth`, `today` (уже есть в finance.js).
- Produces: `cardCycle(card, from = today()) → { statement: Date, due: Date, graceEnd: Date }`. Карта имеет поля `statementDate`, `dueDate`, `graceEndDate` (ISO-строки) и `statementCycleDays` (число, дефолт 30). Функция катит цикл вперёд помесячно (шаг = round(statementCycleDays/30) месяцев, минимум 1), сохраняя якорный день выписки и постоянные смещения `due − statement` и `graceEnd − statement` в днях, пока `due < from`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `test/finance.test.js` импорт `cardCycle` в существующий блок импорта из `../src/finance.js` и тесты:

```js
test('cardCycle: возвращает сохранённый цикл, если он ещё актуален', () => {
  const card = {
    statementDate: '2026-07-26', dueDate: '2026-08-19',
    graceEndDate: '2026-08-19', statementCycleDays: 30,
  }
  const { statement, due, graceEnd } = cardCycle(card, parseDate('2026-07-12'))
  assert.equal(fmtISO(statement), '2026-07-26')
  assert.equal(fmtISO(due), '2026-08-19')
  assert.equal(fmtISO(graceEnd), '2026-08-19')
})

test('cardCycle: катит цикл вперёд, если он в прошлом', () => {
  const card = {
    statementDate: '2026-07-26', dueDate: '2026-08-19',
    graceEndDate: '2026-08-19', statementCycleDays: 30,
  }
  // from после due первого цикла → ожидаем следующий цикл (выписка 26 августа)
  const { statement, due } = cardCycle(card, parseDate('2026-08-20'))
  assert.equal(statement.getMonth(), 7) // август (0-based)
  assert.equal(statement.getDate(), 26)
  assert.ok(due >= parseDate('2026-08-20'))
})

test('cardCycle: сохраняет смещение due и graceEnd от выписки', () => {
  const card = {
    statementDate: '2026-07-26', dueDate: '2026-08-19', // +24 дня
    graceEndDate: '2026-09-08', statementCycleDays: 30, // +44 дня
  }
  const { statement, due, graceEnd } = cardCycle(card, parseDate('2026-09-01'))
  assert.equal(diffDays(due, statement), 24)
  assert.equal(diffDays(graceEnd, statement), 44)
})

test('cardCycle: якорный день клампится к концу короткого месяца', () => {
  const card = {
    statementDate: '2026-01-31', dueDate: '2026-02-20',
    graceEndDate: '2026-02-20', statementCycleDays: 30,
  }
  // прокрутка в февраль: 31 → 28
  const { statement } = cardCycle(card, parseDate('2026-02-27'))
  assert.equal(statement.getMonth(), 1) // февраль
  assert.equal(statement.getDate(), 28)
})
```

Добавить `fmtISO` в импорт теста, если его там нет (сейчас импортируются `expandSchedule, parseDate, monthlyFactor, addMonths, cardNextDue, buildForecast, computeGoals` — добавить `fmtISO`, `diffDays`, `cardCycle`).

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test --test-name-pattern 'cardCycle' 2>&1 | tail -20`
Expected: FAIL — `cardCycle is not a function` / не определена.

- [ ] **Step 3: Реализовать `cardCycle`**

Вставить в `src/finance.js` перед `cardNextDue` (около строки 175):

```js
// Актуальный на дату `from` цикл карты: { statement, due, graceEnd }.
// Хранимые даты — ISO ближайшего/последнего цикла; если он в прошлом, катим вперёд,
// сохраняя якорный день выписки и постоянные смещения due/graceEnd (в днях).
export function cardCycle(card, from = today()) {
  const stmt0 = parseDate(card.statementDate)
  const due0 = parseDate(card.dueDate) || stmt0
  const grace0 = parseDate(card.graceEndDate) || due0
  if (!stmt0) {
    // нет данных — деградируем к сегодняшнему дню
    return { statement: from, due: from, graceEnd: from }
  }
  const dueOffset = diffDays(due0, stmt0)     // дней от выписки до платежа
  const graceOffset = diffDays(grace0, stmt0) // дней от выписки до конца грейса
  const anchorDay = stmt0.getDate()
  const stepMonths = Math.max(1, Math.round((Number(card.statementCycleDays) || 30) / 30))

  let statement = stmt0
  let due = due0
  let guard = 0
  while (due < from && guard < 600) {
    guard++
    statement = addMonths(stmt0, guard * stepMonths, anchorDay)
    due = addDays(statement, dueOffset)
  }
  const graceEnd = addDays(statement, graceOffset)
  return { statement, due, graceEnd }
}
```

- [ ] **Step 4: Запустить тесты — убедиться, что проходят**

Run: `node --test --test-name-pattern 'cardCycle' 2>&1 | tail -20`
Expected: PASS (4 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/finance.js test/finance.test.js
git commit -m "Добавить cardCycle: актуальный цикл карты с автопродлением"
```

---

### Task 2: `cardNextDue()` — тонкая обёртка над `cardCycle`

**Files:**
- Modify: `src/finance.js:176-190` (тело `cardNextDue`)
- Test: `test/finance.test.js` (существующий тест `cardNextDue` + новый на даты)

**Interfaces:**
- Consumes: `cardCycle` из Task 1.
- Produces: `cardNextDue(card, from = today()) → { statement: Date, due: Date }` — теперь работает и со старой моделью (`statementDay`/`dueDay`), и с новой (`statementDate`/`dueDate`). Если у карты есть `statementDate`, делегирует в `cardCycle`; иначе — старая логика по числам (для обратной совместимости до миграции).

- [ ] **Step 1: Написать падающий тест**

Добавить в `test/finance.test.js`:

```js
test('cardNextDue: работает с явными датами через cardCycle', () => {
  const card = {
    statementDate: '2026-07-26', dueDate: '2026-08-19',
    graceEndDate: '2026-08-19', statementCycleDays: 30,
  }
  const { statement, due } = cardNextDue(card, parseDate('2026-07-12'))
  assert.equal(fmtISO(statement), '2026-07-26')
  assert.equal(fmtISO(due), '2026-08-19')
})
```

(Существующий тест `cardNextDue: due после выписки, не в прошлом` со старой моделью `{ statementDay, dueDay }` должен продолжать проходить.)

- [ ] **Step 2: Запустить — убедиться, что новый падает**

Run: `node --test --test-name-pattern 'cardNextDue' 2>&1 | tail -20`
Expected: новый тест FAIL (старая реализация игнорирует `statementDate`), старый — PASS.

- [ ] **Step 3: Переписать `cardNextDue`**

Заменить тело функции (строки ~176-190) на:

```js
// Дата ближайшего платежа по карте. Новая модель — явные даты (через cardCycle);
// старая модель (statementDay/dueDay) — для обратной совместимости до миграции.
export function cardNextDue(card, from = today()) {
  if (card.statementDate) {
    const { statement, due } = cardCycle(card, from)
    return { statement, due }
  }
  const stmtDay = Number(card.statementDay) || 1
  const dueDay = Number(card.dueDay) || stmtDay
  for (let offset = -1; offset < 14; offset++) {
    const base = addMonths(from, offset, 1)
    const stmt = clampDayToMonth(base.getFullYear(), base.getMonth(), stmtDay)
    let due = clampDayToMonth(stmt.getFullYear(), stmt.getMonth(), dueDay)
    if (due <= stmt) due = clampDayToMonth(stmt.getFullYear(), stmt.getMonth() + 1, dueDay)
    if (due >= from) return { statement: stmt, due }
  }
  return { statement: from, due: from }
}
```

- [ ] **Step 4: Запустить — оба теста проходят**

Run: `node --test --test-name-pattern 'cardNextDue' 2>&1 | tail -20`
Expected: PASS (2 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/finance.js test/finance.test.js
git commit -m "cardNextDue: делегировать в cardCycle при явных датах"
```

---

### Task 3: `cardMinPayment()` — формулы минплатежа по банкам

**Files:**
- Modify: `src/finance.js:165-173` (тело `cardMinPayment`)
- Test: `test/finance.test.js`

**Interfaces:**
- Consumes: `moneyToRub`, `cardCycle` (для длины периода при процентах).
- Produces: `cardMinPayment(card, rates) → number` (рубли). Учитывает поля: `minPaymentPercent`, `minPaymentBase` (`'statement'` | `'currentDebt'`, дефолт `'currentDebt'`), `minPaymentFixed` (money), `minPaymentPlusInterest` (bool), `apr` (доля), `statementCycleDays`. Формула: `min( max(база×%, fixed) + (plusInterest ? apr×долг×cycleDays/365 : 0), долг )`. База: если `minPaymentBase === 'statement'` → `statementBalance`, иначе `currentDebt`. Долг для процентов и кламп-потолка = `statementBalance || currentDebt` (как в текущем движке).

- [ ] **Step 1: Написать падающий тест**

```js
test('cardMinPayment: Т-Банк 14% от долга, минимум 600', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    currentDebt: { amount: 231684, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 14, minPaymentBase: 'currentDebt',
    minPaymentFixed: { amount: 600, currency: 'RUB' },
    minPaymentPlusInterest: false, apr: 0.619, statementCycleDays: 30,
  }
  // 231684 × 0.14 = 32435.76, проценты не добавляются
  assert.ok(Math.abs(cardMinPayment(card, rates) - 32435.76) < 0.5)
})

test('cardMinPayment: минимум-фикс срабатывает на малом долге', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    currentDebt: { amount: 1000, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 14, minPaymentBase: 'currentDebt',
    minPaymentFixed: { amount: 600, currency: 'RUB' },
    minPaymentPlusInterest: false, apr: 0.619, statementCycleDays: 30,
  }
  // max(140, 600) = 600
  assert.equal(cardMinPayment(card, rates), 600)
})

test('cardMinPayment: Озон 4% + проценты, минимум 400', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    currentDebt: { amount: 39400, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 4, minPaymentBase: 'currentDebt',
    minPaymentFixed: { amount: 400, currency: 'RUB' },
    minPaymentPlusInterest: true, apr: 0.624, statementCycleDays: 30,
  }
  // core = max(1576, 400) = 1576; проценты = 39400×0.624×30/365 ≈ 2020.6; итого ≈ 3596.6
  const interest = 39400 * 0.624 * 30 / 365
  assert.ok(Math.abs(cardMinPayment(card, rates) - (1576 + interest)) < 1)
})

test('cardMinPayment: не больше долга', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    currentDebt: { amount: 500, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 14, minPaymentBase: 'currentDebt',
    minPaymentFixed: { amount: 600, currency: 'RUB' },
    minPaymentPlusInterest: false, apr: 0.619, statementCycleDays: 30,
  }
  // max(70, 600) = 600, но долг 500 → кламп до 500
  assert.equal(cardMinPayment(card, rates), 500)
})
```

Добавить `cardMinPayment` в импорт теста.

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test --test-name-pattern 'cardMinPayment' 2>&1 | tail -30`
Expected: FAIL (текущая реализация не знает про `minPaymentBase`/`plusInterest`/`apr`).

- [ ] **Step 3: Переписать `cardMinPayment`**

Заменить тело (строки ~165-173) на:

```js
// Обязательный (минимальный) платёж по карте (в рублях) по формуле банка:
// max(база×%, fixed) + (plusInterest ? проценты : 0), но не больше долга.
export function cardMinPayment(card, rates) {
  const debt = moneyToRub(card.statementBalance || card.currentDebt, rates)
  const base = card.minPaymentBase === 'statement'
    ? moneyToRub(card.statementBalance, rates)
    : moneyToRub(card.currentDebt, rates)
  const pct = (Number(card.minPaymentPercent) || 0) / 100
  const byPct = base * pct
  const fixed = moneyToRub(card.minPaymentFixed, rates)
  const core = Math.max(byPct, fixed)
  let interest = 0
  if (card.minPaymentPlusInterest) {
    const apr = Number(card.apr) || 0
    const days = Number(card.statementCycleDays) || 30
    interest = debt * apr * days / 365
  }
  return Math.min(core + interest, debt)
}
```

- [ ] **Step 4: Запустить — все проходят**

Run: `node --test --test-name-pattern 'cardMinPayment' 2>&1 | tail -20`
Expected: PASS (4 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/finance.js test/finance.test.js
git commit -m "cardMinPayment: формулы минплатежа по банкам (процент+проценты+фикс)"
```

---

### Task 4: Хелпер `cardDebt` + карты в `buildForecast` через явные даты + регрессия

**Контекст правки (важно):** Ревью Task 3 выявило корневую причину бага "кредитки не в
прогнозе". Выражение `card.statementBalance || card.currentDebt` берёт объект
`{amount:0}` как truthy → долг 0 → карта отсеивается (`if (debt <= 0) continue`). В проде
`statementBalance` всегда объект (даже пустой), поэтому баг стабильно проявляется на
картах без активной выписки (как в реальном JSON пользователя). Task 3 обошёл это внутри
`cardMinPayment` дублирующей проверкой `amount > 0`. Здесь вводим единый хелпер `cardDebt`
и применяем его во всех местах (DRY, one source of truth).

**Files:**
- Modify: `src/finance.js` — новый `cardDebt`, рефактор `cardMinPayment` (использовать
  `cardDebt`), блок карт в `buildForecast` (использовать `cardDebt` + `cardCycle`).
- Test: `test/finance.test.js`

**Interfaces:**
- Produces: `cardDebt(card, rates) → number` (рубли) — актуальный долг карты: сумма
  выписки, если она > 0, иначе текущий долг. Формула:
  `moneyToRub((statementBalance.amount>0 ? statementBalance : currentDebt), rates)`.
- Consumes: `cardCycle`, `cardMinPayment`, `cardDebt`.
- Produces: событие карты (`kind: 'card'`) на `due` из `cardCycle(card, start)`, с
  `meta.graceDate = graceEnd`. payStrategy (`full` → весь долг, `minimum` →
  `cardMinPayment`) сохраняется. Долг берётся через `cardDebt`.

- [ ] **Step 1: Написать падающий тест на `cardDebt` + усиленную регрессию**

```js
test('cardDebt: statementBalance=0 → берёт currentDebt (корень бага прогноза)', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    statementBalance: { amount: 0, currency: 'RUB' },
    currentDebt: { amount: 39400, currency: 'RUB' },
  }
  assert.equal(cardDebt(card, rates), 39400)
})

test('cardDebt: statementBalance>0 → берёт его (приоритет выписки)', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    statementBalance: { amount: 20000, currency: 'RUB' },
    currentDebt: { amount: 39400, currency: 'RUB' },
  }
  assert.equal(cardDebt(card, rates), 20000)
})

test('buildForecast: карта с нулевой выпиской и долгом попадает в события (регрессия бага)', () => {
  const state = {
    settings: { rates: { amdPerRub: 4.6, usdPerRub: 0.0125 }, startingCash: { amount: 100000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 6 },
    incomes: [], expenses: [], loans: [], goals: [],
    cards: [{
      name: 'Озон', bank: 'Озон', owner: 'husband', payStrategy: 'minimum',
      statementDate: '2026-08-08', dueDate: '2026-08-24', graceEndDate: '2026-09-08', statementCycleDays: 30,
      currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
      minPaymentPercent: 4, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 400, currency: 'RUB' },
      minPaymentPlusInterest: true, apr: 0.624,
    }],
  }
  const f = buildForecast(state, { from: '2026-07-12' })
  const cardEvents = f.events.filter((e) => e.kind === 'card')
  assert.ok(cardEvents.length >= 1, 'карта с нулевой выпиской, но ненулевым долгом должна попасть в прогноз')
  assert.equal(fmtISO(cardEvents[0].date), '2026-08-24')
  assert.ok(cardEvents[0].graceDate, 'событие карты должно нести дату конца грейса')
})
```

Добавить `cardDebt` в импорт теста.

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test --test-name-pattern 'cardDebt|регрессия бага' 2>&1 | tail -20`
Expected: `cardDebt` тесты FAIL (функция не определена). Регресс-тест buildForecast может
падать на `graceDate` (его ещё нет в событии).

- [ ] **Step 3: Ввести `cardDebt`, отрефакторить `cardMinPayment`, обновить блок карт**

В `src/finance.js` добавить хелпер перед `cardMinPayment` (около строки 165):

```js
// Актуальный долг карты (в рублях): сумма выписки, если она > 0, иначе текущий долг.
// statementBalance в проде — всегда объект (в т.ч. {amount:0}), поэтому нельзя писать
// `statementBalance || currentDebt` — пустой объект truthy и дал бы долг 0.
export function cardDebt(card, rates) {
  const sb = card.statementBalance
  const hasStatement = sb && (Number(sb.amount) || 0) > 0
  return moneyToRub(hasStatement ? sb : card.currentDebt, rates)
}
```

Отрефакторить начало `cardMinPayment` — заменить строки с `hasStatement`/`debt` на:

```js
export function cardMinPayment(card, rates) {
  const debt = cardDebt(card, rates)
  const base = card.minPaymentBase === 'statement'
    ? moneyToRub(card.statementBalance, rates)
    : moneyToRub(card.currentDebt, rates)
  // ... остальное без изменений
```

Заменить блок карт в `buildForecast` (использовать `cardDebt` и `cardCycle`):

```js
  // Кредитки (−) — ОДНО ближайшее обязательство на карту (снимок текущего долга).
  for (const card of state.cards || []) {
    if (card.disabled) continue
    const debt = cardDebt(card, rates)
    if (debt <= 0) continue
    const { statement, due, graceEnd } = cardCycle(card, start)
    const full = card.payStrategy !== 'minimum'
    const amount = full ? debt : cardMinPayment(card, rates)
    add(due, -amount, 'card', `${card.name} (${full ? 'полное' : 'минимум'})`, {
      owner: card.owner,
      bank: card.bank,
      statementDate: statement,
      graceDate: graceEnd,
      strategy: full ? 'full' : 'minimum',
      minPayment: cardMinPayment(card, rates),
      fullPayment: debt,
    })
  }
```

- [ ] **Step 4: Запустить весь файл тестов**

Run: `npm test 2>&1 | tail -25`
Expected: все тесты PASS (существующие тесты cardMinPayment из Task 3 остаются зелёными —
`cardDebt` даёт ту же логику).

- [ ] **Step 5: Коммит**

```bash
git add src/finance.js test/finance.test.js
git commit -m "Ввести cardDebt, починить выпадение карт из прогноза, добавить graceDate"
```

---

### Task 5: Карты в `buildMonthly` (месячная картина как единый организм)

**Files:**
- Modify: `src/finance.js:307-331` (`buildMonthly`)
- Test: `test/finance.test.js`

**Interfaces:**
- Consumes: `cardMinPayment`, `cardDebt` (из Task 4).
- Produces: `buildMonthly` теперь включает поле `card` (сумма минимальных платежей активных карт с долгом, в рублях/мес) и добавляет его в `obligatory`. `surplus = income − obligatory`. Существующие поля (`income`, `expense`, `loan`, `obligatory`, `surplus`) сохраняются.

- [ ] **Step 1: Написать падающий тест**

```js
test('buildMonthly: минимальные платежи карт входят в обязательства', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const state = {
    settings: { rates },
    incomes: [{ name: 'ЗП', amount: 300000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-10' } }],
    expenses: [],
    loans: [],
    cards: [{
      name: 'Т', owner: 'husband', payStrategy: 'minimum',
      statementDate: '2026-07-26', dueDate: '2026-08-19', graceEndDate: '2026-08-19', statementCycleDays: 30,
      currentDebt: { amount: 100000, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
      minPaymentPercent: 14, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 600, currency: 'RUB' },
      minPaymentPlusInterest: false, apr: 0.619,
    }],
    goals: [],
  }
  const m = buildMonthly(state, rates)
  // минплатёж = 100000 × 0.14 = 14000
  assert.ok(Math.abs(m.card - 14000) < 1)
  assert.ok(Math.abs(m.obligatory - 14000) < 1) // нет expenses/loans
  assert.ok(Math.abs(m.surplus - (300000 - 14000)) < 1)
})
```

Добавить `buildMonthly` в импорт теста.

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test --test-name-pattern 'buildMonthly: минимальные' 2>&1 | tail -20`
Expected: FAIL (`m.card` undefined, `obligatory` не включает карты).

- [ ] **Step 3: Обновить `buildMonthly`**

В `buildMonthly` после блока `loanM` (перед `const obligatory`) добавить:

```js
  let cardM = 0
  for (const card of state.cards || []) {
    if (card.disabled) continue
    if (cardDebt(card, rates) <= 0) continue
    cardM += cardMinPayment(card, rates)
  }
```

И заменить возврат:

```js
  const obligatory = expenseM + loanM + cardM
  return {
    income: incomeM,
    expense: expenseM,
    loan: loanM,
    card: cardM,
    obligatory,
    surplus: incomeM - obligatory,
  }
```

- [ ] **Step 4: Запустить весь файл — всё зелёное**

Run: `npm test 2>&1 | tail -25`
Expected: все PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/finance.js test/finance.test.js
git commit -m "buildMonthly: включить минимальные платежи карт в обязательства"
```

---

### Task 6: Миграция старых карт в `store.js`

**Files:**
- Modify: `src/store.js:24-35` (`migrate`)
- Test: `test/finance.test.js` (тест на чистую хелпер-функцию миграции карты)

**Interfaces:**
- Produces: экспортируемая чистая функция `migrateCard(card, from) → card` в `src/store.js`, которая при отсутствии `statementDate` синтезирует `statementDate`/`dueDate`/`graceEndDate` из старых `statementDay`/`dueDay`/`gracePeriodDays` на ближайший цикл от `from`, и проставляет дефолты новых полей (`minPaymentBase: 'currentDebt'`, `minPaymentPlusInterest: false`, `apr: 0`, `statementCycleDays: 30`, `transferLimit: {amount:0,currency:'RUB'}`, `transferGraceDays: gracePeriodDays || 0`). `migrate(state)` вызывает `migrateCard` для каждой карты. Идемпотентна: карта с уже заданным `statementDate` не меняет даты.

- [ ] **Step 1: Написать падающий тест**

В `test/finance.test.js` добавить импорт и тесты (импорт из `../src/store.js` — новый):

```js
import { migrateCard } from '../src/store.js'

test('migrateCard: синтезирует даты из старой модели', () => {
  const old = {
    name: 'Старая', statementDay: 5, dueDay: 25, gracePeriodDays: 55,
    currentDebt: { amount: 10000, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
  }
  const c = migrateCard(old, parseDate('2026-07-12'))
  assert.ok(c.statementDate, 'должна появиться дата выписки')
  assert.ok(c.dueDate, 'должна появиться дата платежа')
  assert.ok(c.graceEndDate)
  assert.equal(c.statementCycleDays, 30)
  assert.equal(c.minPaymentBase, 'currentDebt')
  // dueDate строго после statementDate
  assert.ok(parseDate(c.dueDate) > parseDate(c.statementDate))
})

test('migrateCard: идемпотентна для новой модели', () => {
  const nw = {
    name: 'Новая', statementDate: '2026-07-26', dueDate: '2026-08-19',
    graceEndDate: '2026-08-19', statementCycleDays: 30,
    currentDebt: { amount: 0, currency: 'RUB' },
  }
  const c = migrateCard(nw, parseDate('2026-07-12'))
  assert.equal(c.statementDate, '2026-07-26')
  assert.equal(c.dueDate, '2026-08-19')
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test --test-name-pattern 'migrateCard' 2>&1 | tail -20`
Expected: FAIL (`migrateCard` не экспортируется).

- [ ] **Step 3: Реализовать `migrateCard` и вызвать из `migrate`**

В `src/store.js` добавить импорты вверху (рядом с существующими):

```js
import { cardNextDue, fmtISO, addDays, today, parseDate } from './finance.js'
```

Добавить экспортируемую функцию (перед `function migrate`):

```js
// Приводит карту к новой модели: явные даты цикла + дефолты новых полей.
// Идемпотентна: если statementDate уже есть, даты не трогает.
export function migrateCard(card, from = today()) {
  const c = { ...card }
  if (!c.statementDate) {
    // синтез из старых statementDay/dueDay на ближайший цикл
    const { statement, due } = cardNextDue(
      { statementDay: c.statementDay, dueDay: c.dueDay },
      from,
    )
    c.statementDate = fmtISO(statement)
    c.dueDate = fmtISO(due)
    const grace = Number(c.gracePeriodDays) || 0
    c.graceEndDate = grace > 0 ? fmtISO(addDays(statement, grace)) : c.dueDate
  }
  if (c.statementCycleDays == null) c.statementCycleDays = 30
  if (c.minPaymentBase == null) c.minPaymentBase = 'currentDebt'
  if (c.minPaymentPlusInterest == null) c.minPaymentPlusInterest = false
  if (c.apr == null) c.apr = 0
  if (c.minPaymentFixed == null) c.minPaymentFixed = { amount: 0, currency: 'RUB' }
  if (c.transferLimit == null) c.transferLimit = { amount: 0, currency: 'RUB' }
  if (c.transferGraceDays == null) c.transferGraceDays = Number(c.gracePeriodDays) || 0
  return c
}
```

В `migrate(s)`, в цикле по коллекциям (после блока `for (const k of [...])`), добавить:

```js
  s.cards = (s.cards || []).map((c) => migrateCard(c))
```

- [ ] **Step 4: Запустить весь файл — всё зелёное**

Run: `npm test 2>&1 | tail -25`
Expected: все PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/store.js test/finance.test.js
git commit -m "store: migrateCard — синтез дат цикла и дефолтов новых полей"
```

---

### Task 7: Обновить `seed.js` под новую модель карты

**Files:**
- Modify: `src/seed.js:65-72` (список карт) и `src/seed.js:114-129` (фабрика `card()`)
- Test: ручная проверка сборки (seed не покрыт юнит-тестами по архитектуре проекта)

**Interfaces:**
- Consumes: ничего нового.
- Produces: фабрика `card()` принимает объект с полями `statementDate`, `dueDate`, `graceEndDate`, `statementCycleDays`, `minPaymentPercent`, `minPaymentBase`, `minPaymentFixed`, `minPaymentPlusInterest`, `apr`, `transferLimit`, `transferGraceDays` и создаёт карту новой модели (без `statementDay`/`dueDay`).

- [ ] **Step 1: Переписать фабрику `card()`**

Заменить функцию `card` (строки ~114-129) на:

```js
function card(name, bank, owner, o) {
  return {
    id: id('card'), name, bank, owner,
    creditLimit: { amount: o.limit, currency: 'RUB' },
    statementDate: o.statementDate,
    dueDate: o.dueDate,
    graceEndDate: o.graceEndDate || o.dueDate,
    statementCycleDays: o.statementCycleDays || 30,
    gracePeriodDays: o.grace || 0,
    minPaymentPercent: o.minPaymentPercent ?? 5,
    minPaymentBase: o.minPaymentBase || 'currentDebt',
    minPaymentFixed: { amount: o.minPaymentFixed || 0, currency: 'RUB' },
    minPaymentPlusInterest: o.minPaymentPlusInterest || false,
    apr: o.apr || 0,
    currentDebt: { amount: 0, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    transferLimit: { amount: o.transferLimit || 0, currency: 'RUB' },
    transferGraceDays: o.transferGraceDays || o.grace || 0,
    payStrategy: 'full',
    disabled: o.disabled || false,
    note: o.note || 'Заполните текущий долг и сумму выписки, проверьте даты и льготный период',
  }
}
```

- [ ] **Step 2: Обновить вызовы `card(...)`**

Заменить блок карт (строки ~65-72) на явные даты (примерные ближайшие циклы; пользователь всё равно правит под себя):

```js
    cards: [
      card('Т-Банк (муж)', 'Т-Банк', 'husband', {
        limit: 238000, statementDate: dayThisMonth(26), dueDate: nextMonthDay(19),
        graceEndDate: nextMonthDay(19), grace: 55, statementCycleDays: 30,
        minPaymentPercent: 14, minPaymentFixed: 600, apr: 0.619,
      }),
      card('Озон Банк', 'Озон Банк', 'husband', {
        limit: 49000, statementDate: nextMonthDay(8), dueDate: nextMonthDay(24),
        graceEndDate: monthsAheadDay(2, 8), grace: 120, statementCycleDays: 30,
        minPaymentPercent: 4, minPaymentFixed: 400, minPaymentPlusInterest: true, apr: 0.624,
      }),
      card('Уралсиб', 'Уралсиб', 'husband', {
        limit: 20000, statementDate: nextMonthDay(1), dueDate: nextMonthDay(30),
        graceEndDate: monthsAheadDay(2, 30), grace: 120, statementCycleDays: 30,
        minPaymentPercent: 3, minPaymentFixed: 300, minPaymentPlusInterest: true, apr: 0.999,
      }),
      card('Сбербанк', 'Сбербанк', 'husband', {
        limit: 20000, statementDate: dayThisMonth(15), dueDate: nextMonthDay(5),
        graceEndDate: nextMonthDay(5), grace: 120, statementCycleDays: 30,
        minPaymentPercent: 5, minPaymentFixed: 0, apr: 0,
      }),
      card('Т-Банк (жена)', 'Т-Банк', 'wife', {
        limit: 195000, statementDate: nextMonthDay(8), dueDate: monthsAheadDay(1, 28),
        graceEndDate: monthsAheadDay(1, 28), grace: 55, statementCycleDays: 30,
        minPaymentPercent: 14, minPaymentFixed: 600, apr: 0.619,
        transferLimit: 150000, transferGraceDays: 55,
      }),
    ],
```

Добавить хелперы дат рядом с `dayThisMonth` (строка ~11):

```js
function nextMonthDay(day) {
  const n = new Date()
  const d = new Date(n.getFullYear(), n.getMonth() + 1, day)
  return fmtLocalISO(d)
}
function monthsAheadDay(months, day) {
  const n = new Date()
  const d = new Date(n.getFullYear(), n.getMonth() + months, day)
  return fmtLocalISO(d)
}
function fmtLocalISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
```

И переписать `dayThisMonth` через `fmtLocalISO`:

```js
function dayThisMonth(day) {
  const n = new Date()
  return fmtLocalISO(new Date(n.getFullYear(), n.getMonth(), day))
}
```

- [ ] **Step 3: Проверить сборку и тесты**

Run: `npm run build 2>&1 | tail -15 && npm test 2>&1 | tail -10`
Expected: build успешен, тесты PASS.

- [ ] **Step 4: Коммит**

```bash
git add src/seed.js
git commit -m "seed: карты в новой модели с явными датами цикла"
```

---

### Task 8: Форма карты в `CardsView.vue` — даты вместо чисел

**Files:**
- Modify: `src/components/CardsView.vue` (blank(), модалка строки ~107-119, отображение фактов строки ~74-86)
- Test: ручная проверка в браузере (компоненты не покрыты юнит-тестами)

**Interfaces:**
- Consumes: `cardCycle`, `cardMinPayment`, `fmtHuman` из finance.js.
- Produces: форма редактирует `statementDate`/`dueDate`/`graceEndDate` (input type=date), `statementCycleDays`, `minPaymentPercent`, `minPaymentBase`, `minPaymentFixed`, `minPaymentPlusInterest`, `apr`. Карточка показывает даты из `cardCycle`.

- [ ] **Step 1: Обновить `blank()` и импорт**

В `src/components/CardsView.vue` заменить импорт finance:

```js
import { cardCycle, cardNextDue, cardMinPayment, fmtHuman } from '../finance.js'
```

Заменить `blank()`:

```js
function blank() {
  return {
    name: '', bank: '', owner: 'husband',
    creditLimit: { amount: 0, currency: 'RUB' },
    statementDate: '', dueDate: '', graceEndDate: '', statementCycleDays: 30,
    minPaymentPercent: 5, minPaymentBase: 'currentDebt',
    minPaymentFixed: { amount: 0, currency: 'RUB' }, minPaymentPlusInterest: false, apr: 0,
    currentDebt: { amount: 0, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    transferLimit: { amount: 0, currency: 'RUB' }, transferGraceDays: 0,
    payStrategy: 'full', disabled: false, note: '',
  }
}
```

Обновить `info(card)` использовать `cardCycle`:

```js
function info(card) {
  const { statement, due, graceEnd } = cardCycle(card)
  const debt = moneyToRub(card.statementBalance || card.currentDebt, rates.value)
  return { statement, due, graceEnd, debt, min: cardMinPayment(card, rates.value) }
}
```

- [ ] **Step 2: Обновить модалку — блок дат**

Заменить строку дат в модалке (было "День выписки / День платежа / Льготный (дней)", строки ~107-111) на:

```html
        <div class="row">
          <div style="flex: 1"><label>Дата выписки</label><input type="date" v-model="editing.statementDate" /></div>
          <div style="flex: 1"><label>Платёж до</label><input type="date" v-model="editing.dueDate" /></div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Конец льготного</label><input type="date" v-model="editing.graceEndDate" /></div>
          <div style="flex: 1"><label>Длина цикла (дней)</label><input type="number" min="1" v-model.number="editing.statementCycleDays" /></div>
        </div>
```

После блока "Мин. платёж, % / не менее" добавить строку с базой, процентами и ставкой:

```html
        <div class="row">
          <div style="flex: 1"><label>Считать % от</label>
            <select v-model="editing.minPaymentBase">
              <option value="currentDebt">текущего долга</option>
              <option value="statement">суммы выписки</option>
            </select>
          </div>
          <div style="flex: 1"><label>Ставка, % годовых</label><input type="number" min="0" step="0.1" :value="(editing.apr * 100)" @input="editing.apr = (parseFloat($event.target.value) || 0) / 100" /></div>
          <div style="flex: 1; display: flex; align-items: flex-end">
            <label style="margin: 0"><input type="checkbox" style="width: auto" v-model="editing.minPaymentPlusInterest" /> +проценты в минплатёж</label>
          </div>
        </div>
```

- [ ] **Step 3: Обновить отображение фактов карточки**

Заменить блок фактов (строки ~74-86), чтобы "Выписка" показывала дату, а не число:

```html
        <div v-else class="cc-facts grid">
          <div><div class="muted small">Долг / выписка</div><div class="mono">{{ money(info(c).debt) }}</div></div>
          <div><div class="muted small">Выписка</div><div class="mono">{{ fmtHuman(info(c).statement) }}</div></div>
          <div><div class="muted small">Платёж до</div><div class="mono">{{ fmtHuman(info(c).due) }}</div></div>
          <div>
            <div class="muted small">Стратегия</div>
            <div class="mono">{{ c.payStrategy === 'minimum' ? 'минимум ' + money(info(c).min) : 'полное ' + money(info(c).debt) }}</div>
          </div>
        </div>
        <div v-if="!c.disabled && info(c).debt > 0" class="small muted" style="margin-top: 8px">
          💡 Мин. платёж ≈ {{ money(info(c).min) }} до {{ fmtHuman(info(c).due) }}, чтобы не уйти в просрочку.
          Полное погашение {{ money(info(c).debt) }} до {{ fmtHuman(info(c).graceEnd) }} сохранит льготный период (без процентов).
        </div>
```

- [ ] **Step 4: Проверить в браузере**

Run: `npm run dev` (в фоне), открыть http://localhost:5173, вкладка "Кредитки".
Проверить вручную: создание карты с датами сохраняется; на карточке показываются даты выписки/платежа/грейса; минплатёж считается. Импортировать реальный JSON (следующая задача) и убедиться, что карты видны в "Прогнозе".

- [ ] **Step 5: Коммит**

```bash
git add src/components/CardsView.vue
git commit -m "CardsView: ввод дат цикла вместо чисел, показ грейса и минплатежа"
```

---

### Task 9: Привести реальный экспортный JSON к документам

**Files:**
- Modify: `/Users/n0d3/Documents/Кредитки/family-finance-2026-07-11 (2).json` (вне репозитория — рабочие данные пользователя)

**Interfaces:** нет кода; правка данных под таблицу из спека.

- [ ] **Step 1: Обновить карты в JSON**

Привести массив `cards` к фактам (значения из спека, раздел "Данные"):

- **Т-Банк (муж)** `card_5`: `currentDebt.amount: 231684`; удалить `statementDay`/`dueDay`; добавить `statementDate: "2026-07-26"`, `dueDate: "2026-08-19"`, `graceEndDate: "2026-08-19"`, `statementCycleDays: 30`, `minPaymentPercent: 14`, `minPaymentBase: "currentDebt"`, `minPaymentFixed: {amount:600,currency:"RUB"}`, `minPaymentPlusInterest: false`, `apr: 0.619`.
- **Озон** `card_6`: `currentDebt.amount: 39400`; `statementDate: "2026-08-08"`, `dueDate: "2026-08-24"`, `graceEndDate: "2026-09-08"`, `statementCycleDays: 30`, `minPaymentPercent: 4`, `minPaymentFixed: {amount:400,...}`, `minPaymentPlusInterest: true`, `apr: 0.624`.
- **Уралсиб** `card_7`: `currentDebt.amount: 19275`; `statementDate: "2026-08-01"`, `dueDate: "2026-08-30"`, `graceEndDate: "2026-09-30"`, `statementCycleDays: 30`, `minPaymentPercent: 3`, `minPaymentFixed: {amount:300,...}`, `minPaymentPlusInterest: true`, `apr: 0.999`.
- **Сбербанк** `card_8`: даты-заглушки на ближайший цикл, `apr: 0` (долг 0 — в прогноз не попадёт).
- **Т-Банк (жена)** `card_9`: `statementDate`/`dueDate`/`graceEndDate` на ближайший цикл (выписка 8-е), `minPaymentPercent: 14`, `minPaymentFixed: 600`, `apr: 0.619`, `transferLimit: {amount:150000,currency:"RUB"}`, `transferGraceDays: 55`.

Выполнять через Read всего файла + прицельные Edit по каждой карте (файл валидный JSON, не через sed).

- [ ] **Step 2: Проверить валидность JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('/Users/n0d3/Documents/Кредитки/family-finance-2026-07-11 (2).json','utf8')); console.log('valid')"`
Expected: `valid`.

- [ ] **Step 3: Импортировать в приложение и проверить прогноз**

Вручную: `npm run dev`, Настройки → Импорт JSON → выбрать файл. Открыть "Прогноз" — убедиться, что события карт (Т-Банк муж, Озон, Уралсиб) присутствуют на своих датах платежа с корректными суммами (минимум/полное). Открыть "Кредитки" — даты и минплатежи совпадают с документами.

- [ ] **Step 4: Коммит (только если что-то в репозитории менялось; JSON вне репо — не коммитим)**

JSON вне git — коммитить нечего. Зафиксировать факт проверки в чате.

---

## Self-Review

**1. Spec coverage:**
- Модель карты с 3 датами + автопродление → Task 1, 8, 9. ✓
- Ввод всех 3 дат явно → Task 8. ✓
- `cardCycle` автопродление + тесты (граница месяца, прошлый цикл, смещения) → Task 1. ✓
- `cardNextDue` обёртка → Task 2. ✓
- `cardMinPayment` три формулы + кламп → Task 3. ✓
- Карты в `buildForecast` через явные даты + регрессия на баг → Task 4. ✓
- Карты в `buildMonthly`/obligatory → Task 5. ✓
- `migrate()` старых карт + тест → Task 6. ✓
- `seed.js` новые поля → Task 7. ✓
- Правка данных под документы (Т-Банк 14%/600/0.619, Озон 4%+%/400/0.624, Уралсиб 3%+%/300/0.999) → Task 9. ✓
- Диагностика бага воспроизведением → Task 4 Step 2 (проверяем, PASS/FAIL, подтверждаем причину). ✓
- Границы (сценарии/переливы вне этапа 1) → в план не включены. ✓

**2. Placeholder scan:** код показан во всех шагах; ставки и проценты — конкретные числа; нет TBD/TODO. ✓

**3. Type consistency:** `cardCycle → {statement, due, graceEnd}` используется единообразно в Task 1/2/4/8. `cardMinPayment(card, rates) → number` — Task 3/4/5/8. `migrateCard(card, from) → card` — Task 6. Поля карты (`statementDate`, `dueDate`, `graceEndDate`, `statementCycleDays`, `minPaymentBase`, `minPaymentPlusInterest`, `apr`, `transferLimit`, `transferGraceDays`) названы одинаково во всех задачах. ✓

Примечание: Task 4 Step 2 может показать PASS до фикса — это ожидаемо и подтверждает диагностику (событие уже формируется, добавляем только `graceDate`). Регрессия-тест остаётся ценным как защита от будущих поломок.
