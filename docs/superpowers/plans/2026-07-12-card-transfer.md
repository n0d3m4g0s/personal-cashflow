# Модель переводов + ход переноса долга (этап 3a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Честная модель переноса долга между картами: ход `transfer` (снять долг с одной карты, перенести на другую), с расчётом цены (комиссия + проценты по правилам карты-приёмника, учёт грейса на перевод и свободного лимита).

**Architecture:** Расширение движка сценариев `src/scenarios.js` (этап 2). Новая чистая функция `transferCost`, обобщение `cardLoanInterest` под флаг `transferGraceEnabled`, ход `transfer` в `applyScenario`/`evaluateScenario`. Новые поля карты в `store.js`/`seed.js`. Редактор хода в `ScenariosView.vue`. Всё тестируется в `test/scenarios.test.js`.

**Tech Stack:** Vue 3 (`<script setup>`), Vite, чистый Node для тестов (`node --test`), localStorage.

## Global Constraints

- Комментарии и весь UI-текст на русском. Прямые кавычки `"..."`, без длинных тире (в комментариях кода тоже — использовать дефис `-`).
- Даты локальные без TZ: `parseDate`/`fmtISO`/`addDays` из finance.js, без UTC-парсинга ISO или `toISOString`.
- Деньги `{ amount, currency }`, в рубли через `moneyToRub` только в точке расчёта. Разные валюты не складывать напрямую.
- apr и transferFeePercent: apr — доля (0.619); transferFeePercent — проценты (2.9 = 2.9%). Проценты за период: `apr × сумма × дни/365`.
- Терминология transfer: `fromCardId` — карта, С которой долг снимаем (гасится); `toCardId` — карта, НА которую долг переезжает (растёт, платит цену). transferCost считается по `toCard`.
- Модель A (этап 2): рост долга карты и его возврат моделируются парным событием в evaluateScenario, currentDebt карты-плательщика в applyScenario не растёт (иначе двойной счёт).
- Ядро сценариев — чистые функции в `src/scenarios.js` + тесты. applyScenario не мутирует исходный state.
- Запуск тестов: `npm test`. Ветка `card-transfer-strategy`. Коммитим часто.

---

## Файловая структура

- `src/scenarios.js` — `transferCost`, обобщённая `cardLoanInterest`, ход `transfer` в applyMove/evaluateScenario.
- `src/store.js` — `migrateCard` добивает transferGraceEnabled/transferFeePercent/transferFeeFixed.
- `src/seed.js` — новые поля в фабрике card() + значения сид-карт.
- `src/components/ScenariosView.vue` — редактор хода transfer + предупреждение exceedsLimit.
- `test/scenarios.test.js` — новые тесты.

---

### Task 1: Обобщить `cardLoanInterest` под флаг `transferGraceEnabled`

**Files:**
- Modify: `src/scenarios.js:36-51` (`cardLoanInterest`)
- Test: `test/scenarios.test.js`

**Interfaces:**
- Produces: `cardLoanInterest(card, amount, loanDate, repayDate, rates) → number`. Поведение: если `card.transferGraceEnabled === false` — проценты на ВСЮ сумму с первого дня (`apr × amount × дни/365`). Иначе (true ИЛИ поле отсутствует — обратная совместимость cardLoan этапа 2) — прежняя логика free/over с грейсом.

- [ ] **Step 1: Написать падающий тест**

```js
test('cardLoanInterest: transferGraceEnabled=false → проценты на всю сумму с первого дня', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    transferLimit: { amount: 150000, currency: 'RUB' }, transferGraceDays: 55,
    transferGraceEnabled: false, apr: 0.624,
  }
  // 100000 на 30 дней под 62.4%, грейса на перевод нет → проценты на всю сумму
  const i = cardLoanInterest(card, { amount: 100000, currency: 'RUB' },
    parseDate('2026-07-18'), parseDate('2026-08-17'), rates)
  const expected = 0.624 * 100000 * 30 / 365
  assert.ok(Math.abs(i - expected) < 1, `ожидали ${expected}, получили ${i}`)
})

test('cardLoanInterest: transferGraceEnabled отсутствует → прежнее поведение (совместимость)', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    transferLimit: { amount: 150000, currency: 'RUB' }, transferGraceDays: 55, apr: 0.619,
  }
  // 150000 в лимите, возврат в грейс (45 дней < 55) → 0 (как в этапе 2)
  const i = cardLoanInterest(card, { amount: 150000, currency: 'RUB' },
    parseDate('2026-07-18'), parseDate('2026-09-01'), rates)
  assert.equal(i, 0)
})
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test --test-name-pattern 'transferGraceEnabled' 2>&1 | tail -15`
Expected: первый тест FAIL (текущая реализация игнорирует флаг, применяет грейс всегда → даёт 0 вместо процентов).

- [ ] **Step 3: Обобщить `cardLoanInterest`**

Заменить тело (строки ~36-51) на:

```js
export function cardLoanInterest(card, amount, loanDate, repayDate, rates) {
  const amt = moneyToRub(amount, rates)
  const apr = Number(card.apr) || 0
  const daysTotal = Math.max(0, Math.round((repayDate - loanDate) / 86400000))
  // Грейс на перевод не действует (Озон/Уралсиб): проценты на всю сумму с первого дня.
  if (card.transferGraceEnabled === false) {
    return apr * amt * daysTotal / 365
  }
  // Грейс на перевод действует (Т-Банк) или поле не задано (совместимость с этапом 2).
  const limit = moneyToRub(card.transferLimit, rates)
  const free = Math.min(amt, limit)
  const over = Math.max(0, amt - limit)
  const graceEnd = addDays(loanDate, Number(card.transferGraceDays) || 0)
  const overInterest = apr * over * daysTotal / 365
  let freeInterest = 0
  if (repayDate > graceEnd) {
    const daysOver = Math.round((repayDate - graceEnd) / 86400000)
    freeInterest = apr * free * daysOver / 365
  }
  return overInterest + freeInterest
}
```

- [ ] **Step 4: Запустить весь файл**

Run: `npm test 2>&1 | tail -8`
Expected: все PASS (новые 2 + прежние cardLoan этапа 2 зелёные — у карты жены transferGraceEnabled true/отсутствует).

- [ ] **Step 5: Коммит**

```bash
git add src/scenarios.js test/scenarios.test.js
git commit -m "scenarios: cardLoanInterest учитывает флаг transferGraceEnabled"
```

---

### Task 2: `transferCost` — цена переноса (комиссия + проценты + лимит)

**Files:**
- Modify: `src/scenarios.js` (новая функция `transferCost` рядом с cardLoanInterest)
- Test: `test/scenarios.test.js`

**Interfaces:**
- Consumes: `moneyToRub`, `cardLoanInterest`.
- Produces: `transferCost(toCard, amount, transferDate, repayDate, rates) → { fee, interest, total, availableLimit, exceedsLimit }`. Все денежные — числа в рублях.
  - `availableLimit = min(moneyToRub(toCard.transferLimit), moneyToRub(toCard.creditLimit) − moneyToRub(toCard.currentDebt))`.
  - `exceedsLimit = amtRub > availableLimit`.
  - `fee = (toCard.transferFeePercent||0)/100 × amtRub + moneyToRub(toCard.transferFeeFixed)`.
  - `interest = cardLoanInterest(toCard, amount, transferDate, repayDate, rates)`.
  - `total = fee + interest`.

- [ ] **Step 1: Написать падающий тест**

```js
import { transferCost } from '../src/scenarios.js'

const wifeAsTo = () => ({
  id: 'card_9', creditLimit: { amount: 195000, currency: 'RUB' },
  currentDebt: { amount: 0, currency: 'RUB' },
  transferLimit: { amount: 150000, currency: 'RUB' }, transferGraceDays: 55,
  transferGraceEnabled: true, transferFeePercent: 2.9, transferFeeFixed: { amount: 290, currency: 'RUB' },
  apr: 0.619,
})

test('transferCost: перенос в лимит на карту жены, возврат в грейс → total = только комиссия', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const r = transferCost(wifeAsTo(), { amount: 100000, currency: 'RUB' },
    parseDate('2026-07-18'), parseDate('2026-09-01'), rates) // 45 дней < 55
  const fee = 0.029 * 100000 + 290
  assert.ok(Math.abs(r.fee - fee) < 1, `fee ${r.fee} vs ${fee}`)
  assert.equal(r.interest, 0)
  assert.ok(Math.abs(r.total - fee) < 1)
  assert.equal(r.exceedsLimit, false)
})

test('transferCost: сверх свободного лимита → exceedsLimit true', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = wifeAsTo()
  card.currentDebt = { amount: 100000, currency: 'RUB' } // свободно 95000, лимит перевода min(150000,95000)=95000
  const r = transferCost(card, { amount: 120000, currency: 'RUB' },
    parseDate('2026-07-18'), parseDate('2026-09-01'), rates)
  assert.equal(r.availableLimit, 95000)
  assert.equal(r.exceedsLimit, true)
})

test('transferCost: карта-приёмник без грейса на перевод (Озон) → проценты с первого дня', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const ozon = {
    creditLimit: { amount: 49000, currency: 'RUB' }, currentDebt: { amount: 0, currency: 'RUB' },
    transferLimit: { amount: 0, currency: 'RUB' }, transferGraceDays: 0,
    transferGraceEnabled: false, transferFeePercent: 0, transferFeeFixed: { amount: 0, currency: 'RUB' },
    apr: 0.624,
  }
  const r = transferCost(ozon, { amount: 30000, currency: 'RUB' },
    parseDate('2026-07-18'), parseDate('2026-08-17'), rates) // 30 дней
  assert.equal(r.fee, 0)
  const expected = 0.624 * 30000 * 30 / 365
  assert.ok(Math.abs(r.interest - expected) < 1, `interest ${r.interest} vs ${expected}`)
})
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test --test-name-pattern 'transferCost' 2>&1 | tail -20`
Expected: FAIL (`transferCost` не найдена).

- [ ] **Step 3: Реализовать `transferCost`**

Добавить в `src/scenarios.js` после `cardLoanInterest`:

```js
// Цена переноса долга НА карту toCard (в рублях): комиссия + проценты + сведения о лимите.
// toCard - карта, на которую переезжает долг (она платит). transferDate/repayDate - Date.
export function transferCost(toCard, amount, transferDate, repayDate, rates) {
  const amtRub = moneyToRub(amount, rates)
  const limit = moneyToRub(toCard.transferLimit, rates)
  const free = moneyToRub(toCard.creditLimit, rates) - moneyToRub(toCard.currentDebt, rates)
  const availableLimit = Math.min(limit, Math.max(0, free))
  const exceedsLimit = amtRub > availableLimit
  const fee = (Number(toCard.transferFeePercent) || 0) / 100 * amtRub + moneyToRub(toCard.transferFeeFixed, rates)
  const interest = cardLoanInterest(toCard, amount, transferDate, repayDate, rates)
  return { fee, interest, total: fee + interest, availableLimit, exceedsLimit }
}
```

- [ ] **Step 4: Запустить весь файл**

Run: `npm test 2>&1 | tail -8`
Expected: все PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/scenarios.js test/scenarios.test.js
git commit -m "scenarios: transferCost - цена переноса (комиссия, проценты, лимит)"
```

---

### Task 3: Ход `transfer` в `applyScenario` (гашение fromCardId)

**Files:**
- Modify: `src/scenarios.js` (applyMove: case 'transfer')
- Test: `test/scenarios.test.js`

**Interfaces:**
- Produces: applyMove case 'transfer' — уменьшает `currentDebt` карты `fromCardId` на `amount` (в валюте карты через convert; долг не меньше 0). Долг `toCardId` НЕ трогает (модель A — растёт и гасится в evaluateScenario). Наличные не добавляет. Неполный ход (нет даты / карта не найдена) — пропускает.

- [ ] **Step 1: Написать падающий тест**

```js
test('applyScenario: transfer уменьшает долг fromCardId, не трогает toCardId и наличные', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const st = {
    settings: { rates, startingCash: { amount: 100000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 6 },
    incomes: [], expenses: [], loans: [], goals: [], scenarios: [],
    cards: [
      { id: 'ozon', name: 'Озон', currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' } },
      { id: 'wife', name: 'Жена', currentDebt: { amount: 0, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' } },
    ],
  }
  const scenario = { id: 't', name: 'Перенос', moves: [
    { type: 'transfer', fromCardId: 'ozon', toCardId: 'wife', amount: { amount: 39400, currency: 'RUB' }, date: '2026-07-18', repay: 'auto' },
  ] }
  const out = applyScenario(st, scenario)
  assert.equal(out.cards.find(c => c.id === 'ozon').currentDebt.amount, 0, 'долг Озона погашен переносом')
  assert.equal(out.cards.find(c => c.id === 'wife').currentDebt.amount, 0, 'долг жены НЕ растёт в applyScenario (модель A)')
  assert.equal(out.incomes.length, 0, 'наличные не добавляются')
})

test('applyScenario: transfer с несуществующей fromCardId не падает', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const st = {
    settings: { rates, startingCash: { amount: 100000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 6 },
    incomes: [], expenses: [], loans: [], cards: [], goals: [], scenarios: [],
  }
  const scenario = { id: 't2', moves: [
    { type: 'transfer', fromCardId: 'нет', toCardId: 'нет2', amount: { amount: 1000, currency: 'RUB' }, date: '2026-07-18', repay: 'auto' },
  ] }
  const out = applyScenario(st, scenario) // не должно бросать
  assert.ok(out)
})
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test --test-name-pattern 'transfer уменьшает|несуществующей fromCardId' 2>&1 | tail -15`
Expected: FAIL (transfer не обрабатывается — долг Озона не меняется).

- [ ] **Step 3: Добавить case 'transfer' в applyMove**

В `src/scenarios.js`, в `applyMove`, добавить перед `default`:

```js
    case 'transfer': {
      if (!parseDate(move.date)) break // неполный ход (нет даты) - пропускаем
      // Гасим долг fromCardId (долг снят с этой карты этим переносом).
      const from = s.cards.find((c) => c.id === move.fromCardId)
      if (from) {
        const inFromCurrency = convert(move.amount.amount, move.amount.currency, from.currentDebt.currency, s.settings.rates)
        from.currentDebt.amount = Math.max(0, from.currentDebt.amount - inFromCurrency)
      }
      // toCardId (долг переезжает): currentDebt НЕ трогаем (модель A). Рост и возврат -
      // парным событием в evaluateScenario. Наличные не добавляем.
      break
    }
```

- [ ] **Step 4: Запустить весь файл**

Run: `npm test 2>&1 | tail -8`
Expected: все PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/scenarios.js test/scenarios.test.js
git commit -m "scenarios: ход transfer в applyScenario (гашение исходной карты)"
```

---

### Task 4: Ход `transfer` в `evaluateScenario` (возврат toCardId + цена)

**Files:**
- Modify: `src/scenarios.js` (`evaluateScenario` — цикл по transfer-ходам)
- Test: `test/scenarios.test.js`

**Interfaces:**
- Consumes: `transferCost`, `buildForecast`, `parseDate`, `fmtISO`, `addDays`.
- Produces: в `evaluateScenario` после цикла cardLoans добавляется обработка transfer-ходов: для каждого transfer определить дату возврата долга toCardId (авто по порогу `balance ≥ amtRub + buffer` или ручная repayDate); поставить событие-расход `−amount` на дату возврата (гасим новый долг toCardId деньгами); прибавить `transferCost(toCard,...).total` к overpayment; в `graceOk` добавить `repayDate ≤ грейс перевода toCard` (для toCard с grace enabled). exceedsLimit собирать в отдельный массив `transferWarnings` в metrics.

- [ ] **Step 1: Написать падающий тест**

```js
test('evaluateScenario: перенос долга Озона на карту жены, возврат в грейс → overpayment = комиссия', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const st = {
    settings: { rates, startingCash: { amount: 238500, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 6 },
    incomes: [{ name: 'ЗП', amount: 300000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-10' } }],
    expenses: [], loans: [], goals: [], scenarios: [],
    cards: [
      { id: 'ozon', name: 'Озон', payStrategy: 'minimum', statementDate: '2026-08-08', dueDate: '2026-08-24', graceEndDate: '2026-09-08', statementCycleDays: 30,
        currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
        minPaymentPercent: 4, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 400, currency: 'RUB' }, minPaymentPlusInterest: true, apr: 0.624,
        transferGraceEnabled: false, transferLimit: { amount: 0, currency: 'RUB' }, transferGraceDays: 0, transferFeePercent: 0, transferFeeFixed: { amount: 0, currency: 'RUB' }, creditLimit: { amount: 49000, currency: 'RUB' } },
      { id: 'wife', name: 'Жена', payStrategy: 'minimum', statementDate: '2026-08-08', dueDate: '2026-09-28', graceEndDate: '2026-09-28', statementCycleDays: 30,
        currentDebt: { amount: 0, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
        minPaymentPercent: 14, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 600, currency: 'RUB' }, minPaymentPlusInterest: false, apr: 0.619,
        transferGraceEnabled: true, transferLimit: { amount: 150000, currency: 'RUB' }, transferGraceDays: 55, transferFeePercent: 2.9, transferFeeFixed: { amount: 290, currency: 'RUB' }, creditLimit: { amount: 195000, currency: 'RUB' } },
    ],
  }
  const scenario = { id: 'tr', name: 'Перенос Озон→жена', baseFrom: '2026-07-18', moves: [
    { type: 'transfer', fromCardId: 'ozon', toCardId: 'wife', amount: { amount: 39400, currency: 'RUB' }, date: '2026-07-18', repay: 'auto' },
  ] }
  const { metrics } = evaluateScenario(st, scenario, { from: '2026-07-18' })
  // комиссия карты жены: 2.9% + 290 = 39400*0.029+290 ≈ 1432.6; проценты 0 (в грейс)
  const fee = 0.029 * 39400 + 290
  assert.ok(Math.abs(metrics.overpayment - Math.round(fee)) <= 1, `overpayment ${metrics.overpayment} vs ${Math.round(fee)}`)
})

test('evaluateScenario: transfer сверх лимита даёт предупреждение в metrics.transferWarnings', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const st = {
    settings: { rates, startingCash: { amount: 238500, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 6 },
    incomes: [{ name: 'ЗП', amount: 300000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-10' } }],
    expenses: [], loans: [], goals: [], scenarios: [],
    cards: [
      { id: 'ozon', name: 'Озон', payStrategy: 'minimum', statementDate: '2026-08-08', dueDate: '2026-08-24', graceEndDate: '2026-09-08', statementCycleDays: 30, currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' }, minPaymentPercent: 4, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 400, currency: 'RUB' }, apr: 0.624, transferGraceEnabled: false, transferLimit: { amount: 0, currency: 'RUB' }, transferGraceDays: 0, transferFeePercent: 0, transferFeeFixed: { amount: 0, currency: 'RUB' }, creditLimit: { amount: 49000, currency: 'RUB' } },
      { id: 'muzh', name: 'Муж', payStrategy: 'minimum', statementDate: '2026-07-26', dueDate: '2026-08-19', graceEndDate: '2026-08-19', statementCycleDays: 30, currentDebt: { amount: 231684, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' }, minPaymentPercent: 14, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 600, currency: 'RUB' }, apr: 0.619, transferGraceEnabled: true, transferLimit: { amount: 150000, currency: 'RUB' }, transferGraceDays: 55, transferFeePercent: 2.9, transferFeeFixed: { amount: 290, currency: 'RUB' }, creditLimit: { amount: 238000, currency: 'RUB' } },
    ],
  }
  // перенос 39400 на карту мужа, где свободно только 238000-231684=6316 → превышение
  const scenario = { id: 'tr2', name: 'Перенос на мужа', baseFrom: '2026-07-18', moves: [
    { type: 'transfer', fromCardId: 'ozon', toCardId: 'muzh', amount: { amount: 39400, currency: 'RUB' }, date: '2026-07-18', repay: 'auto' },
  ] }
  const { metrics } = evaluateScenario(st, scenario, { from: '2026-07-18' })
  assert.ok(Array.isArray(metrics.transferWarnings))
  assert.equal(metrics.transferWarnings.length, 1, 'перенос сверх свободного лимита мужа помечен')
})
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test --test-name-pattern 'перенос долга Озона|transfer сверх лимита' 2>&1 | tail -20`
Expected: FAIL (transfer в evaluateScenario не обрабатывается — overpayment 0, transferWarnings undefined).

- [ ] **Step 3: Добавить обработку transfer в evaluateScenario**

В `src/scenarios.js`, в `evaluateScenario`, ПОСЛЕ цикла `for (const move of cardLoans)` (transferCost — функция того же модуля из Task 2, импорт не нужен), добавить блок:

```js
  // Ходы переноса долга: возврат нового долга toCardId + цена перевода.
  const transfers = (scenario.moves || []).filter((m) => m.type === 'transfer')
  const transferWarnings = []
  let transferTotal = 0
  for (const move of transfers) {
    const toCard = forked.cards.find((c) => c.id === move.toCardId)
    const transferDate = parseDate(move.date)
    if (!transferDate || !toCard) continue // неполный ход или карта удалена
    const amtRub = moneyToRub(move.amount, rates)
    let repayDate
    const manualDate = move.repayDate || (move.repay && move.repay.date)
    if (move.repay !== 'auto' && manualDate) {
      repayDate = parseDate(manualDate)
    } else {
      const probe = buildForecast(forked, { from })
      repayDate = null
      for (const day of probe.days) {
        if (day.date > transferDate && day.balance >= amtRub + buffer) { repayDate = day.date; break }
      }
      if (!repayDate) repayDate = probe.end
    }
    // Возврат нового долга toCardId деньгами - событие-расход -amount.
    forked.expenses.push({
      id: sid('sc_transfer_repay'), name: `Возврат переноса (${move.toCardId})`,
      amount: move.amount.amount, currency: move.amount.currency,
      category: 'Сценарий', owner: 'family',
      schedule: { frequency: 'once', interval: 1, startDate: fmtISO(repayDate), endDate: null },
    })
    const cost = transferCost(toCard, move.amount, transferDate, repayDate, rates)
    transferTotal += cost.total
    const graceEnd = addDays(transferDate, Number(toCard.transferGraceDays) || 0)
    graceOk.push(toCard.transferGraceEnabled !== false ? repayDate <= graceEnd : false)
    if (cost.exceedsLimit) {
      transferWarnings.push({ toCardId: move.toCardId, amount: amtRub, availableLimit: cost.availableLimit })
    }
  }
```

Затем в return metrics (около строки 195) заменить:

```js
      overpayment: Math.round(cardInterest + loanInterest),
```

на:

```js
      overpayment: Math.round(cardInterest + loanInterest + transferTotal),
      transferWarnings,
```

- [ ] **Step 4: Запустить весь файл**

Run: `npm test 2>&1 | tail -10`
Expected: все PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/scenarios.js test/scenarios.test.js
git commit -m "scenarios: ход transfer в evaluateScenario (возврат, цена, предупреждение о лимите)"
```

---

### Task 5: Новые поля карты в `migrate` и `seed`

**Files:**
- Modify: `src/store.js` (`migrateCard`)
- Modify: `src/seed.js` (фабрика `card()` + значения сид-карт)
- Test: `test/scenarios.test.js` (тест migrateCard для новых полей)

**Interfaces:**
- Produces: `migrateCard` добивает `transferGraceEnabled` (дефолт false), `transferFeePercent` (0), `transferFeeFixed` ({amount:0,currency:'RUB'}). Идемпотентно (== null). Фабрика card() в seed принимает и проставляет эти поля.

- [ ] **Step 1: Написать падающий тест**

```js
test('migrateCard: добивает поля переводов с консервативными дефолтами', () => {
  const c = migrateCard({
    name: 'Старая', statementDate: '2026-07-26', dueDate: '2026-08-19', graceEndDate: '2026-08-19',
    currentDebt: { amount: 0, currency: 'RUB' },
  }, parseDate('2026-07-18'))
  assert.equal(c.transferGraceEnabled, false)
  assert.equal(c.transferFeePercent, 0)
  assert.deepEqual(c.transferFeeFixed, { amount: 0, currency: 'RUB' })
})

test('migrateCard: не перетирает заданные поля переводов', () => {
  const c = migrateCard({
    name: 'Жена', statementDate: '2026-08-08', dueDate: '2026-09-28', graceEndDate: '2026-09-28',
    currentDebt: { amount: 0, currency: 'RUB' },
    transferGraceEnabled: true, transferFeePercent: 2.9, transferFeeFixed: { amount: 290, currency: 'RUB' },
  }, parseDate('2026-07-18'))
  assert.equal(c.transferGraceEnabled, true)
  assert.equal(c.transferFeePercent, 2.9)
})
```

`migrateCard` уже импортируется в тесте (этап 1). Если нет — добавить импорт из `../src/store.js`.

- [ ] **Step 2: Запустить — падает**

Run: `node --test --test-name-pattern 'поля переводов' 2>&1 | tail -12`
Expected: FAIL (migrateCard не проставляет новые поля).

- [ ] **Step 3: Дополнить migrateCard**

В `src/store.js`, в `migrateCard`, рядом с существующими `== null` гвардами (где transferLimit/transferGraceDays), добавить:

```js
  if (c.transferGraceEnabled == null) c.transferGraceEnabled = false
  if (c.transferFeePercent == null) c.transferFeePercent = 0
  if (c.transferFeeFixed == null) c.transferFeeFixed = { amount: 0, currency: 'RUB' }
```

- [ ] **Step 4: Дополнить seed.js**

В `src/seed.js`, в фабрике `card()`, добавить в возвращаемый объект:

```js
    transferGraceEnabled: o.transferGraceEnabled || false,
    transferFeePercent: o.transferFeePercent || 0,
    transferFeeFixed: { amount: o.transferFeeFixed || 0, currency: 'RUB' },
```

И в вызовах card() проставить реальные значения:
- Т-Банк (муж) и Т-Банк (жена): `transferGraceEnabled: true, transferFeePercent: 2.9, transferFeeFixed: 290` (у жены уже есть transferLimit 150000).
- Озон, Уралсиб, Сбербанк: `transferGraceEnabled: false` (можно не указывать — дефолт false).

- [ ] **Step 5: Запустить тесты + build**

Run: `npm test 2>&1 | tail -8 && npm run build 2>&1 | tail -3`
Expected: все PASS, build ок.

- [ ] **Step 6: Коммит**

```bash
git add src/store.js src/seed.js test/scenarios.test.js
git commit -m "store/seed: поля переводов transferGraceEnabled/Fee для карт"
```

---

### Task 6: Редактор хода `transfer` в `ScenariosView.vue`

**Files:**
- Modify: `src/components/ScenariosView.vue` (blank-объект transfer, кнопка добавления, форма)
- Test: ручная проверка в браузере

**Interfaces:**
- Consumes: `state.cards` для выпадающих списков.
- Produces: новый тип хода transfer в редакторе — выбор fromCardId (с которой снимаем) и toCardId (на которую переносим), сумма (MoneyInput), дата, режим возврата (auto/manual + repayDate). Кнопка "+ Перенос долга".

- [ ] **Step 1: Добавить blank-объект и кнопку**

В `src/components/ScenariosView.vue`, в функции `addMove`, в объект blank добавить ключ:

```js
    transfer: { type: 'transfer', fromCardId: state.cards[0]?.id || '', toCardId: state.cards[0]?.id || '', amount: { amount: 0, currency: 'RUB' }, date: '', repay: 'auto', repayDate: '' },
```

В блок кнопок добавления ходов добавить кнопку:

```html
        <button class="sm ghost" @click="addMove(sc, 'transfer')">+ Перенос долга</button>
```

В строку с названием типа хода (`{purchase:..., cardLoan:..., ...}[m.type]`) добавить:

```js
{purchase:'Крупная покупка', cardLoan:'Заём с карты', newLoan:'Новый кредит', adjust:'Разовый доход/расход', transfer:'Перенос долга'}[m.type]
```

- [ ] **Step 2: Добавить форму редактора transfer**

После блока `v-else-if="m.type === 'adjust'"` добавить:

```html
        <div class="row" v-else-if="m.type === 'transfer'">
          <label class="small muted" style="align-self: center">с</label>
          <select v-model="m.fromCardId"><option v-for="c in state.cards" :key="c.id" :value="c.id">{{ c.name }}</option></select>
          <label class="small muted" style="align-self: center">на</label>
          <select v-model="m.toCardId"><option v-for="c in state.cards" :key="c.id" :value="c.id">{{ c.name }}</option></select>
          <MoneyInput v-model="m.amount" compact />
          <input type="date" v-model="m.date" title="Дата переноса" />
          <select v-model="m.repay"><option value="auto">возврат авто</option><option value="manual">возврат вручную</option></select>
          <input v-if="m.repay === 'manual'" type="date" v-model="m.repayDate" />
        </div>
```

- [ ] **Step 3: Проверить build**

Run: `npm run build 2>&1 | tail -6`
Expected: build ок (валидный Vue-template).

- [ ] **Step 4: Ручная проверка**

`npm run dev`, вкладка "Сценарии": создать сценарий, "+ Перенос долга", выбрать "с Озон на Жена", сумму, дату; в таблице сравнения переплата = комиссия карты жены, возврат в грейс. Изменить toCardId на карту мужа — увидеть, что перенос сверх лимита (в консоли/поведении).

- [ ] **Step 5: Коммит**

```bash
git add src/components/ScenariosView.vue
git commit -m "ScenariosView: редактор хода Перенос долга"
```

---

## Self-Review

**1. Spec coverage:**
- Модель полей (transferGraceEnabled/Fee) → Task 5. ✓
- Обобщённая cardLoanInterest под флаг → Task 1. ✓
- transferCost (комиссия/проценты/лимит) → Task 2. ✓
- Ход transfer applyScenario (гашение fromCardId) → Task 3. ✓
- Ход transfer evaluateScenario (возврат toCardId + цена + exceedsLimit) → Task 4. ✓
- Редактор хода → Task 6. ✓
- Тесты всех функций → Task 1-5. ✓
- Границы (3b/3c) не входят. ✓

**2. Placeholder scan:** код показан во всех шагах; значения конкретны; нет TBD.

**3. Type consistency:**
- `cardLoanInterest(card, amount, loanDate, repayDate, rates) → number` — Task 1/2.
- `transferCost(toCard, amount, transferDate, repayDate, rates) → { fee, interest, total, availableLimit, exceedsLimit }` — Task 2/4.
- Ход transfer: `{ type, fromCardId, toCardId, amount, date, repay, repayDate }` — Task 3/4/6.
- `migrateCard(card, from) → card` — Task 5.
- Терминология from/to консистентна: fromCardId гасим (applyScenario), toCardId платит цену (transferCost, evaluateScenario).
- `metrics.transferWarnings` — новое поле, Task 4; UI-отображение предупреждения — минимально в Task 6 (можно доработать в 3b).

Примечание для ревью: Task 4 добавляет transfer-ходы в graceOk теми же индексами, что cardLoan — в UI (этап 2) graceOk отображается как ✓/✗ по всем займам+переносам вместе; это приемлемо для 3a, детальную разбивку сделаем в 3b.
