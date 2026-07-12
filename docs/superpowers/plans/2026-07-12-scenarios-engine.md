# Движок сценариев + вкладка "Сценарии" - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Движок сценариев поверх готового прогноза: ходы (крупная покупка, заём с карты, новый кредит, разовый доход) транслируются в форк состояния, прогоняются через buildForecast, сравниваются в таблице метрик - чтобы дать прямой ответ по билетам.

**Architecture:** Новое чистое ядро `src/scenarios.js` (тестируется отдельно, `finance.js` не меняется). `applyScenario(state, scenario) → state'` превращает ходы в обычные записи incomes/expenses/loans/cards. `evaluateScenario` прогоняет `applyScenario` + существующий `buildForecast` и считает метрики. Компонент `ScenariosView.vue` тонкий: зовёт ядро, рисует редактор ходов и таблицу сравнения.

**Tech Stack:** Vue 3 (`<script setup>`), Vite, чистый Node для тестов (`node --test`), localStorage.

## Global Constraints

- Комментарии и весь UI-текст на русском. Прямые кавычки `"..."`, без длинных тире.
- Даты локальные без TZ: только `new Date(y,m,d)` / `parseDate` / `fmtISO` / `addMonths` / `addDays` из finance.js, никакого UTC-парсинга ISO или `toISOString` в продакшен-коде.
- Денежные величины как `{ amount, currency }`; в рубли через `moneyToRub(money, rates)` только в точке расчёта. Разные валюты не складывать напрямую.
- Ставки apr - доля (0.619 = 61.9%). Проценты: `apr × сумма × дни/365`.
- Ядро сценариев - чистые функции в `src/scenarios.js` + тесты в `test/scenarios.test.js`.
- Не мутировать исходный `state` в `applyScenario` (глубокая копия).
- Запуск тестов: `npm test`. Работаем в ветке `scenarios-engine`. Коммитим часто.

---

## Файловая структура

- `src/scenarios.js` - ядро: `applyScenario`, `evaluateScenario`, `cardLoanInterest`, `annuityInterest`. Одна ответственность: превратить сценарий в оценённый результат.
- `src/store.js` - `migrate` добивает `state.scenarios = []`.
- `src/seed.js` - сид-сценарий "Билеты".
- `src/App.vue` - вкладка "Сценарии" (одна запись в tabs + импорт).
- `src/components/ScenariosView.vue` - список сценариев, редактор ходов, таблица сравнения.
- `test/scenarios.test.js` - тесты ядра.

Порядок задач: сначала ядро (Task 1-5, чистые функции с тестами), затем стор/сид (Task 6), затем UI (Task 7-8).

---

### Task 1: Скелет `scenarios.js` и `applyScenario` для purchase/adjust

**Files:**
- Create: `src/scenarios.js`
- Test: `test/scenarios.test.js` (создать)

**Interfaces:**
- Consumes: `parseDate`, `fmtISO` из `./finance.js`; `moneyToRub` из `./money.js`.
- Produces: `applyScenario(state, scenario) → state'`. Глубокая копия state. Обрабатывает ходы `purchase` (→ разовый expense) и `adjust` (→ разовый income при sign>0, иначе expense). Возвращает новое состояние, исходное не мутирует. Неизвестные типы ходов игнорирует (задел под Task 2-3).

- [ ] **Step 1: Написать падающий тест**

Создать `test/scenarios.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyScenario } from '../src/scenarios.js'

const baseState = () => ({
  settings: { rates: { amdPerRub: 4.6, usdPerRub: 0.0125 }, startingCash: { amount: 100000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 6 },
  incomes: [], expenses: [], loans: [], cards: [], goals: [], scenarios: [],
})

test('applyScenario: purchase добавляет разовый расход, не мутируя исходник', () => {
  const st = baseState()
  const scenario = { id: 's1', name: 'Билеты', moves: [
    { type: 'purchase', title: 'Билеты', amount: { amount: 300000, currency: 'RUB' }, date: '2026-07-18' },
  ] }
  const out = applyScenario(st, scenario)
  assert.equal(st.expenses.length, 0, 'исходник не мутирован')
  assert.equal(out.expenses.length, 1)
  assert.equal(out.expenses[0].amount, 300000)
  assert.equal(out.expenses[0].schedule.frequency, 'once')
  assert.equal(out.expenses[0].schedule.startDate, '2026-07-18')
})

test('applyScenario: adjust sign -1 → разовый расход, sign +1 → разовый доход', () => {
  const st = baseState()
  const scenario = { id: 's2', name: 'Стресс', moves: [
    { type: 'adjust', title: 'Рома не вернёт', amount: { amount: 58000, currency: 'RUB' }, sign: -1, date: '2026-07-30' },
    { type: 'adjust', title: 'Бонус', amount: { amount: 20000, currency: 'RUB' }, sign: 1, date: '2026-08-01' },
  ] }
  const out = applyScenario(st, scenario)
  assert.equal(out.expenses.length, 1)
  assert.equal(out.incomes.length, 1)
  assert.equal(out.incomes[0].amount, 20000)
})
```

- [ ] **Step 2: Запустить - убедиться, что падает**

Run: `node --test test/scenarios.test.js 2>&1 | tail -20`
Expected: FAIL - `applyScenario` не найдена / модуль не существует.

- [ ] **Step 3: Реализовать скелет и purchase/adjust**

Создать `src/scenarios.js`:

```js
// Движок сценариев: ход (move) → форк состояния → готовый buildForecast.
// Чистые функции, тестируется отдельно. finance.js не трогаем.
import { parseDate, fmtISO, addDays, addMonths } from './finance.js'
import { moneyToRub } from './money.js'

let _sid = 0
const sid = (p = 'sc') => `${p}_${++_sid}`

const onceSchedule = (date) => ({ frequency: 'once', interval: 1, startDate: date, endDate: null })

// Применяет сценарий к состоянию, возвращая НОВОЕ состояние (исходник не мутируется).
export function applyScenario(state, scenario) {
  const s = JSON.parse(JSON.stringify(state))
  s.incomes = s.incomes || []
  s.expenses = s.expenses || []
  s.loans = s.loans || []
  s.cards = s.cards || []
  for (const move of (scenario.moves || [])) {
    applyMove(s, move)
  }
  return s
}

function applyMove(s, move) {
  switch (move.type) {
    case 'purchase':
      s.expenses.push({
        id: sid('sc_exp'), name: move.title || 'Покупка',
        amount: move.amount.amount, currency: move.amount.currency,
        category: 'Сценарий', owner: 'family', schedule: onceSchedule(move.date),
      })
      break
    case 'adjust':
      if ((move.sign || 1) >= 0) {
        s.incomes.push({
          id: sid('sc_inc'), name: move.title || 'Доход',
          amount: move.amount.amount, currency: move.amount.currency,
          type: 'other', schedule: onceSchedule(move.date),
        })
      } else {
        s.expenses.push({
          id: sid('sc_exp'), name: move.title || 'Расход',
          amount: move.amount.amount, currency: move.amount.currency,
          category: 'Сценарий', owner: 'family', schedule: onceSchedule(move.date),
        })
      }
      break
    // cardLoan, newLoan - Task 2, 3
    default:
      break
  }
}
```

- [ ] **Step 4: Запустить - проходят**

Run: `node --test test/scenarios.test.js 2>&1 | tail -20`
Expected: PASS (2 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/scenarios.js test/scenarios.test.js
git commit -m "scenarios: скелет applyScenario, ходы purchase и adjust"
```

---

### Task 2: Ход `newLoan` + расчёт процентов аннуитета

**Files:**
- Modify: `src/scenarios.js` (applyMove: case 'newLoan'; функция `annuityInterest`)
- Test: `test/scenarios.test.js`

**Interfaces:**
- Produces: `annuityInterest(principal, apr, termMonths) → number` - суммарные проценты по помесячному графику (остаток × apr/12 за каждый месяц при аннуитетном платеже). `applyMove` case 'newLoan' → добавляет запись в `s.loans` с ежемесячным аннуитетным платежом, `remainingBalance = principal`, `paymentDay` из startDate.

- [ ] **Step 1: Написать падающий тест**

```js
import { annuityInterest } from '../src/scenarios.js'

test('annuityInterest: проценты по помесячному графику положительны и разумны', () => {
  // 90000 под 25% на 12 мес: суммарные проценты ≈ 12000-13000 руб
  const i = annuityInterest(90000, 0.25, 12)
  assert.ok(i > 10000 && i < 14000, `ожидали ~12k, получили ${i}`)
})

test('annuityInterest: 0% годовых → 0 процентов', () => {
  assert.equal(annuityInterest(90000, 0, 12), 0)
})

test('applyScenario: newLoan добавляет кредит с ежемесячным платежом', () => {
  const st = baseState()
  const scenario = { id: 's3', name: 'Кредит', moves: [
    { type: 'newLoan', title: 'Потреб 90к', amount: { amount: 90000, currency: 'RUB' }, apr: 0.25, termMonths: 12, startDate: '2026-07-20' },
  ] }
  const out = applyScenario(st, scenario)
  assert.equal(out.loans.length, 1)
  assert.equal(out.loans[0].remainingBalance.amount, 90000)
  assert.ok(out.loans[0].amount > 0, 'месячный платёж положителен')
  assert.equal(out.loans[0].paymentDay, 20)
})
```

- [ ] **Step 2: Запустить - падает**

Run: `node --test test/scenarios.test.js 2>&1 | tail -20`
Expected: FAIL (`annuityInterest` не найдена; newLoan не обрабатывается).

- [ ] **Step 3: Реализовать**

Добавить в `src/scenarios.js`:

```js
// Аннуитетный месячный платёж.
function annuityPayment(principal, apr, termMonths) {
  const r = apr / 12
  if (r === 0) return principal / termMonths
  return principal * r / (1 - Math.pow(1 + r, -termMonths))
}

// Суммарные проценты по помесячному графику (остаток × apr/12 за месяц).
export function annuityInterest(principal, apr, termMonths) {
  if (apr === 0) return 0
  const pay = annuityPayment(principal, apr, termMonths)
  const r = apr / 12
  let balance = principal
  let interest = 0
  for (let m = 0; m < termMonths; m++) {
    const monthInterest = balance * r
    interest += monthInterest
    balance = balance + monthInterest - pay
    if (balance < 0) balance = 0
  }
  return interest
}
```

В `applyMove` добавить case перед `default`:

```js
    case 'newLoan': {
      const day = parseDate(move.startDate).getDate()
      s.loans.push({
        id: sid('sc_loan'), name: move.title || 'Кредит',
        owner: 'family',
        amount: Math.round(annuityPayment(move.amount.amount, move.apr, move.termMonths)),
        currency: move.amount.currency,
        paymentDay: day,
        remainingBalance: { amount: move.amount.amount, currency: move.amount.currency },
        apr: move.apr,
      })
      break
    }
```

- [ ] **Step 4: Запустить - проходят**

Run: `node --test test/scenarios.test.js 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/scenarios.js test/scenarios.test.js
git commit -m "scenarios: ход newLoan и annuityInterest"
```

---

### Task 3: Ход `cardLoan` (трансляция) + `cardLoanInterest`

**Files:**
- Modify: `src/scenarios.js` (applyMove: case 'cardLoan'; функция `cardLoanInterest`)
- Test: `test/scenarios.test.js`

**Interfaces:**
- Produces:
  - `cardLoanInterest(card, amount, loanDate, repayDate, rates) → number` - переплата по займу с карты. `free = min(amount, transferLimit)`, `over = max(0, amount − transferLimit)` (обе в рублях через `moneyToRub`). Конец грейса перевода = `loanDate + transferGraceDays` (дней). Проценты(over) = `apr × over × дни(loanDate→repayDate)/365`. Проценты(free) = 0, если `repayDate ≤ graceEnd`, иначе `apr × free × дни(graceEnd→repayDate)/365`. Итого сумма.
  - `applyMove` case 'cardLoan' → (а) разовый income `+amount` на `date`; (б) на карте `cardId`: `currentDebt.amount += amount.amount` (та же валюта - карты RUB; если валюты разные, конвертируем amount в валюту карты через convert). Возврат обрабатывается в `evaluateScenario` (Task 4), не здесь.

- [ ] **Step 1: Написать падающий тест**

```js
import { cardLoanInterest } from '../src/scenarios.js'
import { parseDate } from '../src/finance.js'

const wifeCard = () => ({
  id: 'card_9', name: 'Т-Банк (жена)', currency: 'RUB',
  currentDebt: { amount: 0, currency: 'RUB' },
  transferLimit: { amount: 150000, currency: 'RUB' }, transferGraceDays: 55,
  apr: 0.619,
})

test('cardLoanInterest: возврат в грейс, сумма в пределах лимита → 0', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const i = cardLoanInterest(wifeCard(), { amount: 150000, currency: 'RUB' },
    parseDate('2026-07-18'), parseDate('2026-09-01'), rates) // 45 дней < 55
  assert.equal(i, 0)
})

test('cardLoanInterest: возврат после грейса → проценты за дни сверх на лимитную часть', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  // грейс до 2026-09-11 (18.07+55). Возврат 2026-09-21 → 10 дней сверх на 150000.
  const i = cardLoanInterest(wifeCard(), { amount: 150000, currency: 'RUB' },
    parseDate('2026-07-18'), parseDate('2026-09-21'), rates)
  const expected = 0.619 * 150000 * 10 / 365
  assert.ok(Math.abs(i - expected) < 1, `ожидали ${expected}, получили ${i}`)
})

test('cardLoanInterest: сумма сверх лимита → проценты на превышение с первого дня', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  // заём 200000: over=50000. Возврат в грейс (45 дней) → free 0 процентов, over под проценты 45 дней.
  const i = cardLoanInterest(wifeCard(), { amount: 200000, currency: 'RUB' },
    parseDate('2026-07-18'), parseDate('2026-09-01'), rates)
  const expected = 0.619 * 50000 * 45 / 365
  assert.ok(Math.abs(i - expected) < 1, `ожидали ${expected}, получили ${i}`)
})

test('applyScenario: cardLoan даёт наличные, долг карты НЕ трогает (модель A)', () => {
  const st = baseState()
  st.cards = [wifeCard()]
  const scenario = { id: 's4', name: 'Заём', moves: [
    { type: 'cardLoan', cardId: 'card_9', amount: { amount: 150000, currency: 'RUB' }, date: '2026-07-18', repay: 'auto' },
  ] }
  const out = applyScenario(st, scenario)
  assert.equal(out.incomes.length, 1)
  assert.equal(out.incomes[0].amount, 150000)
  // Модель A: заём чисто кассовый (пара +/- в evaluateScenario). currentDebt не растёт,
  // иначе карта в buildForecast создаст второе гашение долга → двойной вычет cash.
  assert.equal(out.cards[0].currentDebt.amount, 0)
})
```

- [ ] **Step 2: Запустить - падает**

Run: `node --test test/scenarios.test.js 2>&1 | tail -20`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

Добавить импорт `convert` в шапку scenarios.js: `import { moneyToRub, convert } from './money.js'`.

Добавить функцию:

```js
// Переплата по займу с карты (в рублях). free - в пределах беспроцентного лимита
// перевода, over - сверх лимита (проценты с первого дня). loanDate/repayDate - Date.
export function cardLoanInterest(card, amount, loanDate, repayDate, rates) {
  const amt = moneyToRub(amount, rates)
  const limit = moneyToRub(card.transferLimit, rates)
  const apr = Number(card.apr) || 0
  const free = Math.min(amt, limit)
  const over = Math.max(0, amt - limit)
  const graceEnd = addDays(loanDate, Number(card.transferGraceDays) || 0)
  const daysTotal = Math.max(0, Math.round((repayDate - loanDate) / 86400000))
  const overInterest = apr * over * daysTotal / 365
  let freeInterest = 0
  if (repayDate > graceEnd) {
    const daysOver = Math.round((repayDate - graceEnd) / 86400000)
    freeInterest = apr * free * daysOver / 365
  }
  return overInterest + freeInterest
}
```

В `applyMove` добавить case (МОДЕЛЬ A: заём чисто кассовый, долг карты НЕ трогаем -
возврат моделируется парным событием-расходом в `evaluateScenario`, а проценты считаются
отдельно через `cardLoanInterest`; рост `currentDebt` привёл бы к двойному вычету cash,
т.к. карта в `buildForecast` сама гасит долг на дату выписки):

```js
    case 'cardLoan': {
      s.incomes.push({
        id: sid('sc_inc'), name: `Заём с карты (${move.cardId})`,
        amount: move.amount.amount, currency: move.amount.currency,
        type: 'other', schedule: onceSchedule(move.date),
      })
      // currentDebt карты не меняем (модель A). Возврат - событие-расход в evaluateScenario.
      break
    }
```

Импорт `convert` в шапке больше не нужен для cardLoan (модель A не конвертирует долг карты).
Если `convert` нигде больше не используется - убрать из импорта money.js.

- [ ] **Step 4: Запустить - проходят**

Run: `node --test test/scenarios.test.js 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/scenarios.js test/scenarios.test.js
git commit -m "scenarios: ход cardLoan и cardLoanInterest (грейс перевода, сверхлимит)"
```

---

### Task 4: `evaluateScenario` - авто/ручной возврат займа + прогон прогноза

**Files:**
- Modify: `src/scenarios.js` (`evaluateScenario`, вспомогательные)
- Test: `test/scenarios.test.js`

**Interfaces:**
- Consumes: `buildForecast`, `parseDate`, `addMonths`, `fmtISO` из finance.js; `applyScenario`, `cardLoanInterest`.
- Produces: `evaluateScenario(state, scenario, opts?) → { forecast, metrics }`.
  - Сначала `applyScenario`. Для каждого `cardLoan`: определить дату возврата. Если `repay==='auto'` - прогнать `buildForecast` на форке, найти первый день ПОСЛЕ даты займа с `balance ≥ startingCash + amountRub`; если нет - `repaid:false`, дата = конец горизонта. Если `repay==={date}` - эта дата. Добавить в форк разовый expense `−amount` (возврат) на дату возврата и уменьшить `currentDebt` карты. Затем финальный `buildForecast`.
  - `metrics = { minBalance, minBalanceDate, overpayment, graceOk: [...], breakEvenDate, risk }`. `overpayment` = Σ `cardLoanInterest` + Σ `annuityInterest` по newLoan. `breakEvenDate` - первый день, где balance ≥ startingCash. `risk` - по minBalance vs safetyBuffer.

- [ ] **Step 1: Написать падающий тест**

```js
import { evaluateScenario } from '../src/scenarios.js'

test('evaluateScenario: билеты с займом карты жены, авто-возврат в грейс → overpayment 0', () => {
  const st = baseState()
  st.settings.startingCash = { amount: 238500, currency: 'RUB' }
  st.incomes = [{ name: 'ЗП', amount: 300000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-10' } }]
  st.cards = [wifeCard()]
  const scenario = { id: 'sb', name: 'Билеты', baseFrom: '2026-07-18', moves: [
    { type: 'purchase', title: 'Билеты', amount: { amount: 240000, currency: 'RUB' }, date: '2026-07-18' },
    { type: 'cardLoan', cardId: 'card_9', amount: { amount: 150000, currency: 'RUB' }, date: '2026-07-18', repay: 'auto' },
  ] }
  const { metrics } = evaluateScenario(st, scenario, { from: '2026-07-18' })
  assert.equal(typeof metrics.minBalance, 'number')
  assert.equal(metrics.graceOk[0], true, 'возврат уложился в грейс')
  assert.equal(metrics.overpayment, 0, 'при возврате в грейс переплата 0')
  assert.ok(['низкий', 'средний', 'высокий'].includes(metrics.risk))
})

test('evaluateScenario: базовый сценарий без ходов не падает', () => {
  const st = baseState()
  st.incomes = [{ name: 'ЗП', amount: 300000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-10' } }]
  const { metrics } = evaluateScenario(st, { id: 'base', name: 'Как есть', moves: [] }, { from: '2026-07-18' })
  assert.equal(metrics.overpayment, 0)
  assert.deepEqual(metrics.graceOk, [])
})
```

- [ ] **Step 2: Запустить - падает**

Run: `node --test test/scenarios.test.js 2>&1 | tail -20`
Expected: FAIL (`evaluateScenario` не найдена).

- [ ] **Step 3: Реализовать**

Добавить импорт: `import { buildForecast, parseDate, fmtISO, addDays, addMonths } from './finance.js'` (дополнить существующий импорт finance.js - убедиться, что `buildForecast` в списке).

```js
// Оценивает сценарий: применяет ходы, разруливает возврат займов, строит прогноз,
// считает метрики для таблицы сравнения.
export function evaluateScenario(state, scenario, opts = {}) {
  const rates = state.settings.rates
  const from = opts.from || scenario.baseFrom || fmtISO(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()))
  const startingCash = moneyToRub(state.settings.startingCash, rates)
  const buffer = moneyToRub(state.settings.safetyBuffer, rates)

  const forked = applyScenario(state, scenario)
  const cardLoans = (scenario.moves || []).filter((m) => m.type === 'cardLoan')

  const graceOk = []
  let cardInterest = 0
  for (const move of cardLoans) {
    const card = forked.cards.find((c) => c.id === move.cardId)
    const amtRub = moneyToRub(move.amount, rates)
    const loanDate = parseDate(move.date)
    let repayDate
    // Ручной возврат: режим 'manual' + отдельное поле repayDate (формат UI-редактора),
    // либо объект { date } (совместимость). Иначе — авто-возврат по порогу ниже.
    const manualDate = move.repayDate || (move.repay && move.repay.date)
    if (move.repay !== 'auto' && manualDate) {
      repayDate = parseDate(manualDate)
    } else {
      // авто: первый день ПОСЛЕ займа, когда на счету есть сумма займа сверх подушки
      // безопасности (balance >= amtRub + buffer) - "вернуть, оставив подушку".
      // НЕ требуем восстановить весь стартовый кэш (это уводило бы возврат за грейс
      // при любой крупной покупке и делало инструмент бесполезно пессимистичным).
      const probe = buildForecast(forked, { from })
      repayDate = null
      for (const day of probe.days) {
        if (day.date > loanDate && day.balance >= amtRub + buffer) { repayDate = day.date; break }
      }
      if (!repayDate) repayDate = probe.end // не закрыт до конца горизонта
    }
    // Модель A: заём чисто кассовый. cardLoan дал +amount (income), здесь ставим парный
    // возврат −amount на repayDate. Нетто по cash = 0 (взял+вернул). currentDebt карты
    // не рос (модель A), поэтому карта не создаёт лишнего гашения - двойного счёта нет.
    forked.expenses.push({
      id: sid('sc_repay'), name: `Возврат займа (${move.cardId})`,
      amount: move.amount.amount, currency: move.amount.currency,
      category: 'Сценарий', owner: 'family',
      schedule: { frequency: 'once', interval: 1, startDate: fmtISO(repayDate), endDate: null },
    })
    const graceEnd = addDays(loanDate, Number(card?.transferGraceDays) || 0)
    graceOk.push(repayDate <= graceEnd)
    cardInterest += cardLoanInterest(card, move.amount, loanDate, repayDate, rates)
  }

  // проценты по новым кредитам (сумму конвертируем в рубли - overpayment в рублях)
  let loanInterest = 0
  for (const m of (scenario.moves || [])) {
    if (m.type === 'newLoan') loanInterest += annuityInterest(moneyToRub(m.amount, rates), m.apr, m.termMonths)
  }

  const forecast = buildForecast(forked, { from })

  let breakEvenDate = null
  for (const day of forecast.days) {
    if (day.balance >= startingCash) { breakEvenDate = day.date; break }
  }

  const minBalance = forecast.minBalance
  let risk = 'низкий'
  if (minBalance < 0) risk = 'высокий'
  else if (minBalance < buffer) risk = 'средний'

  return {
    forecast,
    metrics: {
      minBalance,
      minBalanceDate: forecast.minBalanceDate,
      overpayment: Math.round(cardInterest + loanInterest),
      graceOk,
      breakEvenDate,
      risk,
    },
  }
}
```

- [ ] **Step 4: Запустить весь файл**

Run: `node --test test/scenarios.test.js 2>&1 | tail -20`
Expected: PASS (все).

- [ ] **Step 5: Коммит**

```bash
git add src/scenarios.js test/scenarios.test.js
git commit -m "scenarios: evaluateScenario с авто/ручным возвратом и метриками"
```

---

### Task 5: Сквозной тест сценария билетов на реалистичных числах

**Files:**
- Modify: `test/scenarios.test.js`

**Interfaces:** нет нового кода; проверка интеграции на данных, близких к реальным.

- [ ] **Step 1: Написать тест (сначала может выявить баг в Task 1-4)**

```js
// Реалистичное семейное состояние для сквозных проверок.
function familyState() {
  const st = baseState()
  st.settings.startingCash = { amount: 238500, currency: 'RUB' }
  st.settings.horizonMonths = 6
  st.incomes = [{ name: 'ЗП', amount: 300000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-10' } }]
  st.expenses = [{ name: 'Жизнь', amount: 92000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-01' } }]
  st.loans = [
    { name: 'Ипотека', amount: 117750, currency: 'RUB', paymentDay: 25, remainingBalance: { amount: 11152000, currency: 'RUB' } },
    { name: 'Потреб', amount: 27600, currency: 'RUB', paymentDay: 30, remainingBalance: { amount: 742000, currency: 'RUB' } },
  ]
  st.cards = [wifeCard()]
  return st
}

test('сквозной: заём с карты чисто кассовый - endBalance равен варианту без займа (нет двойного счёта)', () => {
  const st = familyState()
  const withoutLoan = { id: 'a', name: 'Только наличка', baseFrom: '2026-07-18', moves: [
    { type: 'purchase', title: 'Билеты', amount: { amount: 300000, currency: 'RUB' }, date: '2026-07-18' },
  ] }
  const withLoan = { id: 'b', name: 'Плюс заём', baseFrom: '2026-07-18', moves: [
    { type: 'purchase', title: 'Билеты', amount: { amount: 300000, currency: 'RUB' }, date: '2026-07-18' },
    { type: 'cardLoan', cardId: 'card_9', amount: { amount: 150000, currency: 'RUB' }, date: '2026-07-18', repay: 'auto' },
  ] }
  const a = evaluateScenario(st, withoutLoan, { from: '2026-07-18' })
  const b = evaluateScenario(st, withLoan, { from: '2026-07-18' })
  // Ключевая регрессия на двойной счёт: заём взял+вернул = нетто 0 по конечному балансу.
  assert.ok(Math.abs(a.metrics ? a.forecast.endBalance - b.forecast.endBalance : 0) < 1,
    `endBalance должен совпадать: без займа ${a.forecast.endBalance}, с займом ${b.forecast.endBalance}`)
  // Заём поднимает минимальный остаток (закрывает часть просадки на время).
  assert.ok(b.metrics.minBalance > a.metrics.minBalance,
    `заём должен улучшать мин.остаток: без ${a.metrics.minBalance}, с ${b.metrics.minBalance}`)
})

test('сквозной: небольшой заём 150k под покупку 150k укладывается в грейс, переплата 0', () => {
  const st = familyState()
  const scenario = { id: 'c', name: 'Малая покупка', baseFrom: '2026-07-18', moves: [
    { type: 'purchase', title: 'Покупка', amount: { amount: 150000, currency: 'RUB' }, date: '2026-07-18' },
    { type: 'cardLoan', cardId: 'card_9', amount: { amount: 150000, currency: 'RUB' }, date: '2026-07-18', repay: 'auto' },
  ] }
  const { metrics } = evaluateScenario(st, scenario, { from: '2026-07-18' })
  // Покупка 150k покрыта займом 150k, наличка не проседает → возврат быстро, в грейс.
  assert.equal(metrics.graceOk[0], true, 'возврат должен уложиться в грейс')
  assert.equal(metrics.overpayment, 0, 'при возврате в грейс переплата 0')
})
```

- [ ] **Step 2: Запустить**

Run: `node --test test/scenarios.test.js 2>&1 | tail -25`
Expected: PASS. Первый тест - регрессия на двойной счёт (endBalance с займом = без займа). Если
FAIL на первом - двойной счёт не устранён (модель A нарушена). Если FAIL на втором (grace) -
проверить порог авто-возврата. Чинить в scenarios.js, не в тесте (тесты логически верны:
проверены прямым прогоном движка).

- [ ] **Step 3: Коммит**

```bash
git add test/scenarios.test.js
git commit -m "scenarios: сквозной тест сценария билетов"
```

---

### Task 6: `migrate` + сид-сценарий "Билеты"

**Files:**
- Modify: `src/store.js` (migrate: `state.scenarios`)
- Modify: `src/seed.js` (сид-сценарий)
- Test: ручная проверка (сид/стор не покрыты юнитами)

**Interfaces:**
- Produces: `state.scenarios` - массив; `migrate` гарантирует его наличие. Сид даёт один сценарий "Билеты" с ходами purchase 300k + cardLoan 150k (карта жены card_9, repay:'auto').

- [ ] **Step 1: Добавить scenarios в migrate**

В `src/store.js`, в `migrate(s)`, в цикле по коллекциям заменить строку с массивами:

```js
  for (const k of ['incomes', 'expenses', 'loans', 'cards', 'goals', 'scenarios']) {
    if (!Array.isArray(s[k])) s[k] = []
  }
```

Также в `collectionFor` (CRUD) при желании добавить `scenario: state.scenarios` - но CRUD сценариев можно вести локально в компоненте, так что это опционально.

- [ ] **Step 2: Добавить сид-сценарий в seed.js**

В `makeSeed()`, в возвращаемый объект добавить поле `scenarios` (после `goals`):

```js
    scenarios: [
      {
        id: id('scenario'), name: 'Билеты (заём с карты жены)',
        baseFrom: dayThisMonth(18),
        moves: [
          { type: 'purchase', title: 'Авиабилеты', amount: { amount: 300000, currency: 'RUB' }, date: dayThisMonth(18) },
          { type: 'cardLoan', cardId: 'card_9', amount: { amount: 150000, currency: 'RUB' }, date: dayThisMonth(18), repay: 'auto' },
        ],
      },
    ],
```

Примечание: `cardId: 'card_9'` в сиде может не совпасть с реальными id (сид генерит свои). Для сида это плейсхолдер-демо; в реальных данных пользователь укажет свою карту. Допустимо: если карта не найдена, cardLoan просто добавит наличные без роста конкретной карты (проверка `if (card)`).

- [ ] **Step 3: Проверить build и тесты**

Run: `npm run build 2>&1 | tail -6 && npm test 2>&1 | tail -6`
Expected: build ок, все тесты (finance + scenarios) PASS.

- [ ] **Step 4: Коммит**

```bash
git add src/store.js src/seed.js
git commit -m "store/seed: scenarios в состоянии и сид-сценарий Билеты"
```

---

### Task 7: `ScenariosView.vue` - список и редактор ходов

**Files:**
- Create: `src/components/ScenariosView.vue`
- Modify: `src/App.vue` (вкладка)
- Test: ручная проверка в браузере

**Interfaces:**
- Consumes: `state`, `evaluateScenario`, `formatMoney`/`moneyToRub`, `fmtHuman`.
- Produces: компонент с списком сценариев из `state.scenarios`, кнопкой добавления сценария, редактором ходов (добавить/убрать ход каждого из 4 типов с MoneyInput и датами).

- [ ] **Step 1: Создать компонент (список + редактор ходов)**

Создать `src/components/ScenariosView.vue`:

```vue
<script setup>
import { ref, computed } from 'vue'
import { state } from '../store.js'
import { evaluateScenario } from '../scenarios.js'
import { formatMoney, moneyToRub } from '../money.js'
import { fmtHuman, parseDate } from '../finance.js'
import MoneyInput from './MoneyInput.vue'

const rates = computed(() => state.settings.rates)
function money(rub) { return formatMoney(rub, 'RUB') }

function newScenario() {
  state.scenarios.push({ id: 'scenario_' + Date.now().toString(36), name: 'Новый сценарий', baseFrom: '', moves: [] })
}
function removeScenario(id) {
  const i = state.scenarios.findIndex((s) => s.id === id)
  if (i >= 0) state.scenarios.splice(i, 1)
}
function addMove(sc, type) {
  const blank = {
    purchase: { type: 'purchase', title: 'Покупка', amount: { amount: 0, currency: 'RUB' }, date: '' },
    cardLoan: { type: 'cardLoan', cardId: state.cards[0]?.id || '', amount: { amount: 0, currency: 'RUB' }, date: '', repay: 'auto', repayDate: '' },
    newLoan: { type: 'newLoan', title: 'Кредит', amount: { amount: 0, currency: 'RUB' }, apr: 0.25, termMonths: 12, startDate: '' },
    adjust: { type: 'adjust', title: 'Корректировка', amount: { amount: 0, currency: 'RUB' }, sign: -1, date: '' },
  }[type]
  sc.moves.push(JSON.parse(JSON.stringify(blank)))
}
function removeMove(sc, i) { sc.moves.splice(i, 1) }
</script>

<template>
  <div class="grid" style="gap: 14px">
    <div class="spread">
      <div>
        <h2 style="margin: 0">Сценарии</h2>
        <div class="small muted">Играем цифрами: крупная покупка, заём с карты, кредит. Сравните способы в таблице ниже.</div>
      </div>
      <button class="primary" @click="newScenario">+ Новый сценарий</button>
    </div>

    <div v-for="sc in state.scenarios" :key="sc.id" class="card grid" style="gap: 10px">
      <div class="spread">
        <input v-model="sc.name" style="flex: 1; font-weight: 600" />
        <button class="sm danger" @click="removeScenario(sc.id)">Удл.</button>
      </div>
      <div class="row">
        <div><label>Дата отсчёта</label><input type="date" v-model="sc.baseFrom" /></div>
      </div>

      <div v-for="(m, i) in sc.moves" :key="i" class="card" style="padding: 10px">
        <div class="spread">
          <b class="small">{{ {purchase:'Крупная покупка', cardLoan:'Заём с карты', newLoan:'Новый кредит', adjust:'Разовый доход/расход'}[m.type] }}</b>
          <button class="sm ghost" @click="removeMove(sc, i)">✕</button>
        </div>
        <div class="row" v-if="m.type === 'purchase'">
          <input v-model="m.title" placeholder="Название" />
          <MoneyInput v-model="m.amount" compact />
          <input type="date" v-model="m.date" />
        </div>
        <div class="row" v-else-if="m.type === 'cardLoan'">
          <select v-model="m.cardId"><option v-for="c in state.cards" :key="c.id" :value="c.id">{{ c.name }}</option></select>
          <MoneyInput v-model="m.amount" compact />
          <input type="date" v-model="m.date" title="Дата займа" />
          <select v-model="m.repay"><option value="auto">возврат авто</option><option value="manual">возврат вручную</option></select>
          <input v-if="m.repay === 'manual'" type="date" v-model="m.repayDate" />
        </div>
        <div class="row" v-else-if="m.type === 'newLoan'">
          <input v-model="m.title" placeholder="Название" />
          <MoneyInput v-model="m.amount" compact />
          <input type="number" step="0.1" :value="m.apr * 100" @input="m.apr = (parseFloat($event.target.value) || 0) / 100" title="Ставка % годовых" style="width: 80px" />
          <input type="number" v-model.number="m.termMonths" title="Срок, мес" style="width: 70px" />
          <input type="date" v-model="m.startDate" />
        </div>
        <div class="row" v-else-if="m.type === 'adjust'">
          <input v-model="m.title" placeholder="Название" />
          <MoneyInput v-model="m.amount" compact />
          <select v-model.number="m.sign"><option :value="1">доход +</option><option :value="-1">расход −</option></select>
          <input type="date" v-model="m.date" />
        </div>
      </div>

      <div class="row" style="gap: 6px">
        <button class="sm ghost" @click="addMove(sc, 'purchase')">+ Покупка</button>
        <button class="sm ghost" @click="addMove(sc, 'cardLoan')">+ Заём с карты</button>
        <button class="sm ghost" @click="addMove(sc, 'newLoan')">+ Кредит</button>
        <button class="sm ghost" @click="addMove(sc, 'adjust')">+ Доход/расход</button>
      </div>
    </div>

    <p v-if="!state.scenarios.length" class="card muted">Сценариев пока нет. Создайте первый, чтобы проиграть варианты.</p>
  </div>
</template>
```

- [ ] **Step 2: Добавить вкладку в App.vue**

В `src/App.vue`: импорт `import ScenariosView from './components/ScenariosView.vue'` и запись в `tabs` (после goals):

```js
  { key: 'scenarios', label: 'Сценарии', icon: '🎲', comp: ScenariosView },
```

- [ ] **Step 3: Проверить build**

Run: `npm run build 2>&1 | tail -6`
Expected: build ок (валидный Vue-template).

- [ ] **Step 4: Ручная проверка**

`npm run dev`, открыть вкладку "Сценарии": создать сценарий, добавить ходы каждого типа, поля редактируются, ничего не падает в консоли.

- [ ] **Step 5: Коммит**

```bash
git add src/components/ScenariosView.vue src/App.vue
git commit -m "ScenariosView: вкладка, список сценариев и редактор ходов"
```

---

### Task 8: Таблица сравнения сценариев с метриками

**Files:**
- Modify: `src/components/ScenariosView.vue` (добавить таблицу сравнения)
- Test: ручная проверка

**Interfaces:**
- Consumes: `evaluateScenario` для каждого сценария + базового "Как есть".
- Produces: таблица, где колонки - базовый сценарий и все `state.scenarios`, строки - метрики (мин. остаток, дата просадки, переплата, возврат в грейс, в плюс с, риск).

- [ ] **Step 1: Добавить вычисляемое сравнение и таблицу**

В `<script setup>` ScenariosView.vue добавить:

```js
const baseScenario = { id: '__base', name: 'Как есть', moves: [] }
const comparison = computed(() => {
  const list = [baseScenario, ...state.scenarios]
  return list.map((sc) => {
    try {
      const { metrics } = evaluateScenario(state, sc, sc.baseFrom ? { from: sc.baseFrom } : {})
      return { name: sc.name, metrics, error: null }
    } catch (e) {
      return { name: sc.name, metrics: null, error: String(e.message || e) }
    }
  })
})
function riskClass(r) { return r === 'высокий' ? 'neg' : (r === 'средний' ? 'warn' : 'pos') }
```

В `<template>` после списка сценариев добавить таблицу:

```html
    <div v-if="state.scenarios.length" class="card">
      <h3 style="margin-top: 0">Сравнение</h3>
      <div style="overflow-x: auto">
        <table>
          <thead>
            <tr><th>Метрика</th><th v-for="c in comparison" :key="c.name">{{ c.name }}</th></tr>
          </thead>
          <tbody>
            <tr>
              <td class="muted small">Мин. остаток</td>
              <td v-for="c in comparison" :key="c.name" class="mono" :class="c.metrics && c.metrics.minBalance < 0 ? 'neg' : ''">
                {{ c.metrics ? money(c.metrics.minBalance) : '-' }}
              </td>
            </tr>
            <tr>
              <td class="muted small">Дата просадки</td>
              <td v-for="c in comparison" :key="c.name" class="small">{{ c.metrics ? fmtHuman(c.metrics.minBalanceDate) : '-' }}</td>
            </tr>
            <tr>
              <td class="muted small">Переплата (проценты)</td>
              <td v-for="c in comparison" :key="c.name" class="mono" :class="c.metrics && c.metrics.overpayment > 0 ? 'warn' : 'pos'">
                {{ c.metrics ? money(c.metrics.overpayment) : '-' }}
              </td>
            </tr>
            <tr>
              <td class="muted small">Возврат в грейс</td>
              <td v-for="c in comparison" :key="c.name" class="small">
                {{ c.metrics ? (c.metrics.graceOk.length ? c.metrics.graceOk.map(g => g ? '✓' : '✗').join(' ') : '-') : '-' }}
              </td>
            </tr>
            <tr>
              <td class="muted small">В плюс с</td>
              <td v-for="c in comparison" :key="c.name" class="small">{{ c.metrics && c.metrics.breakEvenDate ? fmtHuman(c.metrics.breakEvenDate) : '-' }}</td>
            </tr>
            <tr>
              <td class="muted small">Риск</td>
              <td v-for="c in comparison" :key="c.name" :class="c.metrics ? riskClass(c.metrics.risk) : ''">{{ c.metrics ? c.metrics.risk : c.error }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
```

- [ ] **Step 2: Проверить build**

Run: `npm run build 2>&1 | tail -6`
Expected: build ок.

- [ ] **Step 3: Ручная проверка**

`npm run dev`, вкладка "Сценарии": таблица показывает базовый "Как есть" + сид-сценарий "Билеты" с метриками (мин. остаток, переплата 0 при возврате в грейс, риск). Меняя суммы/даты в ходах, значения в таблице пересчитываются.

- [ ] **Step 4: Коммит**

```bash
git add src/components/ScenariosView.vue
git commit -m "ScenariosView: таблица сравнения сценариев с метриками"
```

---

## Self-Review

**1. Spec coverage:**
- `applyScenario` + 4 типа ходов (purchase/adjust Task 1, newLoan Task 2, cardLoan Task 3) ✓
- `cardLoanInterest` (грейс перевода, сверхлимит) Task 3 ✓
- `annuityInterest` (помесячный график) Task 2 ✓
- `evaluateScenario` + авто/ручной возврат + метрики Task 4 ✓
- Определение авто-возврата через balance ≥ startingCash + amount Task 4 ✓
- Сквозной тест билетов Task 5 ✓
- `migrate` + scenarios + сид Task 6 ✓
- Вкладка + редактор ходов Task 7 ✓
- Таблица сравнения с метриками (мин.остаток, дата, переплата, грейс, в плюс, риск) Task 8 ✓
- Границы (переливы/автоплатежи - этап 3) не включены ✓

**2. Placeholder scan:** код показан во всех шагах; формулы конкретны; нет TBD.

**3. Type consistency:**
- `applyScenario(state, scenario) → state'` - Task 1/4.
- `cardLoanInterest(card, amount, loanDate, repayDate, rates) → number` - Task 3/4.
- `annuityInterest(principal, apr, termMonths) → number` - Task 2/4.
- `evaluateScenario(state, scenario, opts) → { forecast, metrics }`, `metrics = { minBalance, minBalanceDate, overpayment, graceOk[], breakEvenDate, risk }` - Task 4/8.
- Ходы: поля `type`, `amount:{amount,currency}`, `date`/`startDate`, `cardId`, `repay`, `apr`, `termMonths`, `sign`, `title` - консистентны Task 1-3/7.
- Тонкое место (для ревью): моделирование займа/возврата в cash-балансе. `cardLoan` даёт +amount (income) и растит `currentDebt`. Возврат - событие-расход −amount на дату возврата. `currentDebt` при возврате НЕ уменьшается намеренно (иначе карта потеряет обязательство в прогнозе, а cash задвоит вычет). Проценты считаются отдельно через `cardLoanInterest`, не из `currentDebt`. Итог для cash: +amount в дату займа, −amount в дату возврата - нетто 0, что корректно (заём это временный кассовый разрыв, а не доход).

Примечание для ревью: авто-возврат делает два прохода `buildForecast` (probe + финальный) на форке. Для горизонта 6-24 мес это дёшево (события в днях). Не оптимизируем преждевременно.
