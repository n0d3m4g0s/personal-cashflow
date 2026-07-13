# График погашения карты в ядре (этап 3b-1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Карта с payStrategy=minimum в buildForecast разворачивается в ряд ежемесячных платежей до закрытия долга (минимум + проценты на остаток), а не одно обязательство — чтобы прогноз честно отражал нагрузку карт.

**Architecture:** Правка чистого ядра `src/finance.js`. Рефактор cardMinPayment через cardMinCore (тело без процентов). Новая cardPaymentSchedule (ряд платежей). Интеграция в блок карт buildForecast. Всё под регрессией (51 тест этапов 1-3a).

**Tech Stack:** Чистый JS, тесты node --test.

## Global Constraints

- Комментарии на русском, прямые кавычки, без длинных тире (в комментариях кода дефис `-`).
- Даты локальные без TZ: cardCycle/addDays/clampDayToMonth из finance.js, без UTC/toISOString.
- Деньги в рубли через moneyToRub/cardDebt только в точке расчёта.
- apr доля. Проценты за цикл: apr × остаток × statementCycleDays/365.
- Чистые функции в finance.js + тесты в test/finance.test.js.
- КРИТИЧНО: не сломать существующие 51 тест (этапы 1-3a). Каждая задача заканчивается полным `npm test` зелёным.
- Запуск: `npm test`. Ветка card-payment-schedule. Коммитим часто.

---

## Файловая структура

- `src/finance.js` — cardMinCore (рефактор из cardMinPayment), cardPaymentSchedule (новая), правка блока карт в buildForecast.
- `test/finance.test.js` — тесты + регрессия.

---

### Task 1: Вынести `cardMinCore`, отрефакторить `cardMinPayment`

**Files:**
- Modify: `src/finance.js:176-192` (`cardMinPayment`)
- Test: `test/finance.test.js`

**Interfaces:**
- Produces: `cardMinCore(card, balanceRub, rates) → number` — тело минимума БЕЗ процентов: `min(max(balanceRub × minPaymentPercent/100, moneyToRub(minPaymentFixed, rates)), balanceRub)`. `cardMinPayment(card, rates)` рефакторится: `core = cardMinCore(card, cardDebt(card,rates), rates)`, плюс проценты если minPaymentPlusInterest, кламп до долга. Поведение cardMinPayment НЕ меняется.

- [ ] **Step 1: Написать падающий тест на cardMinCore + регрессию cardMinPayment**

Добавить в `test/finance.test.js` (импорт: добавить `cardMinCore` к существующему импорту из finance.js):

```js
test('cardMinCore: тело минимума без процентов от произвольного остатка', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = { minPaymentPercent: 4, minPaymentFixed: { amount: 400, currency: 'RUB' } }
  // 4% от 50000 = 2000 (> фикс 400) → 2000. Процентов НЕТ (это core).
  assert.equal(cardMinCore(card, 50000, rates), 2000)
  // 4% от 5000 = 200 (< фикс 400) → 400.
  assert.equal(cardMinCore(card, 5000, rates), 400)
  // кламп до остатка: 4% от 300 = 12, фикс 400, но остаток 300 → 300.
  assert.equal(cardMinCore(card, 300, rates), 300)
})

test('cardMinPayment: регрессия после рефактора — прежний результат (Озон 4%+проценты)', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 4, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 400, currency: 'RUB' },
    minPaymentPlusInterest: true, apr: 0.624, statementCycleDays: 30,
  }
  // core = max(1576, 400) = 1576; проценты = 39400×0.624×30/365 ≈ 2020.6; итого ≈ 3596.6
  const interest = 39400 * 0.624 * 30 / 365
  assert.ok(Math.abs(cardMinPayment(card, rates) - (1576 + interest)) < 1)
})
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test --test-name-pattern 'cardMinCore' 2>&1 | tail -12`
Expected: FAIL (`cardMinCore` не найдена). Регресс-тест cardMinPayment пройдёт (функция ещё старая).

- [ ] **Step 3: Ввести cardMinCore и отрефакторить cardMinPayment**

Заменить `cardMinPayment` (строки ~176-192) на:

```js
// Тело минимального платежа БЕЗ процентов от произвольного остатка (в рублях):
// max(% от остатка, фикс), но не больше остатка. Проценты (для minPaymentPlusInterest)
// начисляются отдельно вызывающим кодом - здесь их нет, чтобы не задваивать в графике.
export function cardMinCore(card, balanceRub, rates) {
  const byPct = balanceRub * (Number(card.minPaymentPercent) || 0) / 100
  const fixed = moneyToRub(card.minPaymentFixed, rates)
  return Math.min(Math.max(byPct, fixed), Math.max(0, balanceRub))
}

// Обязательный (минимальный) платёж по карте (в рублях): тело (cardMinCore) + проценты,
// если minPaymentPlusInterest, но не больше долга.
export function cardMinPayment(card, rates) {
  const debt = cardDebt(card, rates)
  const core = cardMinCore(card, debt, rates)
  let interest = 0
  if (card.minPaymentPlusInterest) {
    const apr = Number(card.apr) || 0
    const days = Number(card.statementCycleDays) || 30
    interest = debt * apr * days / 365
  }
  return Math.min(core + interest, debt)
}
```

Примечание: старая cardMinPayment учитывала minPaymentBase='statement' (база из
statementBalance). Новая cardMinCore берёт базу из переданного balanceRub, а cardMinPayment
передаёт cardDebt (= statementBalance если >0, иначе currentDebt). Для карт в тестах
(minPaymentBase='currentDebt', statementBalance=0) результат идентичен. Если регресс-тест
покажет расхождение для statement-базы — сообщить (в реальных данных minPaymentBase у всех
'currentDebt').

- [ ] **Step 4: Запустить весь файл — регрессия зелёная**

Run: `npm test 2>&1 | tail -8`
Expected: все PASS (новые cardMinCore + прежние тесты cardMinPayment этапа 1 не сломаны).

- [ ] **Step 5: Коммит**

```bash
git add src/finance.js test/finance.test.js
git commit -m "finance: вынести cardMinCore, отрефакторить cardMinPayment"
```

---

### Task 2: `cardPaymentSchedule` — ряд платежей до закрытия долга

**Files:**
- Modify: `src/finance.js` (новая функция после cardMinPayment/cardCycle)
- Test: `test/finance.test.js`

**Interfaces:**
- Consumes: `cardDebt`, `cardCycle`, `cardMinCore`, `addMonths`.
- Produces: `cardPaymentSchedule(card, rates, from, end) → [{ date, amount, remainingAfter, interest }]`. Ряд событий погашения minimum. Стартовый остаток = cardDebt. Первый due — из `cardCycle(card, from)`, дальше монотонно `addMonths(first.due, k, anchorDay)` (НЕ cardCycle(from+k*days) — иначе дубли дат). interest = apr×остаток×statementCycleDays/365; pay = min(cardMinCore(card, остаток, rates) + interest, остаток + interest); principalPaid = max(0, pay − interest); остаток −= principalPaid. Ровно одно событие на месячный цикл. Стоп: остаток ≤ 0 или due > end. Guard. Пустой массив при долге ≤ 0.

- [ ] **Step 1: Написать падающий тест**

```js
test('cardPaymentSchedule: minimum даёт ряд платежей, остаток убывает', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    payStrategy: 'minimum',
    statementDate: '2026-08-08', dueDate: '2026-08-24', graceEndDate: '2026-09-08', statementCycleDays: 30,
    currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 4, minPaymentFixed: { amount: 400, currency: 'RUB' }, minPaymentBase: 'currentDebt',
    minPaymentPlusInterest: true, apr: 0.624,
  }
  const sched = cardPaymentSchedule(card, rates, parseDate('2026-07-12'), parseDate('2027-07-12'))
  assert.ok(sched.length >= 2, 'несколько платежей')
  // остаток убывает монотонно
  for (let i = 1; i < sched.length; i++) {
    assert.ok(sched[i].remainingAfter <= sched[i-1].remainingAfter, 'остаток не растёт')
  }
  // ДАТЫ СТРОГО РАСТУТ — нет дублей (from не совпадает с датой выписки, но платежи не задваиваются)
  for (let i = 1; i < sched.length; i++) {
    assert.ok(sched[i].date > sched[i-1].date, `дата ${fmtISO(sched[i].date)} должна быть строго позже предыдущей`)
  }
  // проценты положительны (apr>0)
  assert.ok(sched[0].interest > 0)
})

test('cardPaymentSchedule: долг ≤ 0 → пустой массив', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = { payStrategy: 'minimum', currentDebt: { amount: 0, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
    statementDate: '2026-08-08', dueDate: '2026-08-24', graceEndDate: '2026-09-08', statementCycleDays: 30,
    minPaymentPercent: 4, minPaymentFixed: { amount: 400, currency: 'RUB' }, apr: 0.624 }
  assert.deepEqual(cardPaymentSchedule(card, rates, parseDate('2026-07-12'), parseDate('2027-07-12')), [])
})

test('cardPaymentSchedule: обрывается на конце горизонта (хвост остаётся)', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  // Уралсиб 3% минимум под 99.9% - долг тает крайне медленно, за короткий горизонт не закроется
  const card = {
    payStrategy: 'minimum', statementDate: '2026-08-01', dueDate: '2026-08-30', graceEndDate: '2026-09-30', statementCycleDays: 30,
    currentDebt: { amount: 19275, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 3, minPaymentFixed: { amount: 300, currency: 'RUB' }, minPaymentBase: 'currentDebt', minPaymentPlusInterest: true, apr: 0.999,
  }
  const sched = cardPaymentSchedule(card, rates, parseDate('2026-07-12'), parseDate('2026-10-12')) // 3 месяца
  // за 3 месяца долг не закроется, последний remainingAfter > 0
  assert.ok(sched.length >= 1 && sched.length <= 4)
  assert.ok(sched[sched.length-1].remainingAfter > 0, 'хвост долга остаётся')
})
```

Добавить `cardPaymentSchedule` в импорт теста.

- [ ] **Step 2: Запустить — падает**

Run: `node --test --test-name-pattern 'cardPaymentSchedule' 2>&1 | tail -15`
Expected: FAIL (не найдена).

- [ ] **Step 3: Реализовать `cardPaymentSchedule`**

Добавить в `src/finance.js` после `cardMinPayment` (или рядом с cardCycle):

```js
// Ряд событий погашения карты по стратегии minimum до закрытия долга или конца горизонта.
// Каждый месяц: проценты на остаток + тело (cardMinCore); остаток уменьшается на тело.
export function cardPaymentSchedule(card, rates, from, end) {
  let remaining = cardDebt(card, rates)
  if (remaining <= 0) return []
  const apr = Number(card.apr) || 0
  const days = Number(card.statementCycleDays) || 30
  const out = []
  // Первый due берём через cardCycle (актуальный цикл на дату from). Дальше катим МОНОТОННО
  // помесячно от первого due (addMonths с якорным днём), а НЕ через cardCycle(from + k*days) -
  // иначе при from, не совпадающем с датой выписки, cardCycle для k=0 и k=1 вернул бы один и
  // тот же due и платежи задвоились бы на одну дату.
  const first = cardCycle(card, from)
  const anchorDay = first.due.getDate()
  let due = first.due
  let k = 0
  let guard = 0
  while (remaining > 0 && guard < 600) {
    guard++
    if (due > end) break
    const interest = remaining * apr * days / 365
    const core = cardMinCore(card, remaining, rates)
    // платёж не больше остатка+проценты (последний платёж гасит всё)
    const pay = Math.min(core + interest, remaining + interest)
    const principalPaid = Math.max(0, pay - interest)
    remaining = Math.max(0, remaining - principalPaid)
    out.push({ date: due, amount: pay, remainingAfter: remaining, interest })
    k++
    due = addMonths(first.due, k, anchorDay) // следующий цикл: +k месяцев от первого due
    // защита: если тело не гасится (платёж <= проценты), прерываем, чтобы не зациклиться
    if (principalPaid <= 0) break
  }
  return out
}
```

Примечание: `due` монотонно растёт через `addMonths(first.due, k, anchorDay)` (календарный
месячный шаг с клампом дня к концу месяца), поэтому дублей дат нет - ровно один платёж на
месячный цикл. guard и break по principalPaid<=0 остаются страховкой.

- [ ] **Step 4: Запустить весь файл**

Run: `npm test 2>&1 | tail -8`
Expected: все PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/finance.js test/finance.test.js
git commit -m "finance: cardPaymentSchedule - ряд платежей карты до закрытия долга"
```

---

### Task 3: Интеграция графика в `buildForecast`

**Files:**
- Modify: `src/finance.js:291-308` (блок карт в buildForecast)
- Test: `test/finance.test.js`

**Interfaces:**
- Consumes: `cardPaymentSchedule`.
- Produces: блок карт для payStrategy=minimum добавляет КАЖДОЕ событие из cardPaymentSchedule (kind 'card', meta strategy 'minimum', remainingAfter, interest). Для full — одно событие (как сейчас). Событие минимума на дату из графика.

- [ ] **Step 1: Написать падающий/регресс-тест**

```js
test('buildForecast: карта minimum даёт несколько card-событий (график)', () => {
  const state = {
    settings: { rates: { amdPerRub: 4.6, usdPerRub: 0.0125 }, startingCash: { amount: 300000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 12 },
    incomes: [], expenses: [], loans: [], goals: [],
    cards: [{
      name: 'Озон', bank: 'Озон', owner: 'husband', payStrategy: 'minimum',
      statementDate: '2026-08-08', dueDate: '2026-08-24', graceEndDate: '2026-09-08', statementCycleDays: 30,
      currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
      minPaymentPercent: 4, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 400, currency: 'RUB' }, minPaymentPlusInterest: true, apr: 0.624,
    }],
  }
  const f = buildForecast(state, { from: '2026-07-12' })
  const cardEvents = f.events.filter((e) => e.kind === 'card')
  assert.ok(cardEvents.length >= 2, `ожидали несколько платежей, получили ${cardEvents.length}`)
})

test('buildForecast: карта full даёт одно событие (регрессия не сломана)', () => {
  const state = {
    settings: { rates: { amdPerRub: 4.6, usdPerRub: 0.0125 }, startingCash: { amount: 300000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 12 },
    incomes: [], expenses: [], loans: [], goals: [],
    cards: [{
      name: 'Сбер', bank: 'Сбер', owner: 'husband', payStrategy: 'full',
      statementDate: '2026-07-15', dueDate: '2026-08-05', graceEndDate: '2026-08-05', statementCycleDays: 30,
      currentDebt: { amount: 20000, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
      minPaymentPercent: 5, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 0, currency: 'RUB' }, apr: 0,
    }],
  }
  const f = buildForecast(state, { from: '2026-07-12' })
  const cardEvents = f.events.filter((e) => e.kind === 'card')
  assert.equal(cardEvents.length, 1, 'full - одно событие')
  assert.equal(cardEvents[0].amount, -20000)
})
```

- [ ] **Step 2: Запустить — проверить статус**

Run: `node --test --test-name-pattern 'несколько card-событий|full даёт одно' 2>&1 | tail -15`
Expected: первый тест FAIL (сейчас minimum даёт одно событие); второй PASS (full уже одно).

- [ ] **Step 3: Обновить блок карт в buildForecast**

Заменить блок (строки ~291-308) на:

```js
  // Кредитки (−). full: одно обязательство (весь долг в грейс). minimum: ряд платежей.
  for (const card of state.cards || []) {
    if (card.disabled) continue
    const debt = cardDebt(card, rates)
    if (debt <= 0) continue
    const { statement, due, graceEnd } = cardCycle(card, start)
    const full = card.payStrategy !== 'minimum'
    if (full) {
      add(due, -debt, 'card', `${card.name} (полное)`, {
        owner: card.owner, bank: card.bank, statementDate: statement, graceDate: graceEnd,
        strategy: 'full', minPayment: cardMinPayment(card, rates), fullPayment: debt,
      })
    } else {
      for (const p of cardPaymentSchedule(card, rates, start, end)) {
        add(p.date, -p.amount, 'card', `${card.name} (минимум)`, {
          owner: card.owner, bank: card.bank, statementDate: statement, graceDate: graceEnd,
          strategy: 'minimum', remainingAfter: p.remainingAfter, interest: p.interest,
        })
      }
    }
  }
```

- [ ] **Step 4: Запустить весь файл — всё зелёное**

Run: `npm test 2>&1 | tail -15`
Expected: все PASS (новые + прежние).

ВАЖНО про регрессию (карты minimum теперь дают больше платежей → меняется прогноз):
- Регресс-тест этапа 1 `buildForecast: карта с нулевой выпиской...` (test/finance.test.js:228-232) использует `cardEvents.length >= 1` и проверяет дату первого события (2026-08-24) + graceDate — остаётся валидным (первый платёж графика на той же due, graceDate сохранён в meta). Трогать не нужно.
- Тесты scenarios (этапы 2/3a) проверяют метрики (minBalance, overpayment, graceOk), НЕ число card-событий. НО их числовые значения могут измениться, т.к. карты minimum теперь генерируют больше платежей в прогнозе. ЕСЛИ упал scenarios-тест на изменившемся minBalance/endBalance:
  - НЕ подгоняй тест вслепую. Разберись: изменение ЗАКОННО (карта теперь честно платит несколько раз вместо одного), значит новое значение корректнее.
  - Проверь конкретный тест: если он про заём/перенос (cardLoan/transfer) и падает из-за того, что карта в сценарии теперь платит больше — это ожидаемое следствие честной модели. Обнови ожидание теста на новое значение, зафиксировав в отчёте ПОЧЕМУ (карта minimum развернулась в график).
  - Если сомневаешься, законно ли изменение — сообщи в concerns, НЕ коммить.
- Тест `buildMonthly: минимальные платежи карт` (использует cardMinPayment) — должен остаться зелёным (cardMinPayment рефакторен без изменения поведения). Если упал — рефактор Task 1 сломал cardMinPayment, вернись к Task 1.

- [ ] **Step 5: Коммит**

```bash
git add src/finance.js test/finance.test.js
git commit -m "buildForecast: карта minimum разворачивается в график платежей"
```

---

## Self-Review

**1. Spec coverage:**
- cardMinCore (тело без процентов) → Task 1. ✓
- cardMinPayment рефактор (поведение сохранено) → Task 1. ✓
- cardPaymentSchedule (ряд платежей, стоп по остатку/горизонту, хвост) → Task 2. ✓
- Интеграция minimum в buildForecast (несколько событий), full без изменений → Task 3. ✓
- Регрессия 51 теста → каждая задача Step 4. ✓
- Границы (вкладка 3b-2, оптимизатор 3c, buildMonthly не трогаем) не входят. ✓

**2. Placeholder scan:** код показан во всех шагах; формулы конкретны; нет TBD.

**3. Type consistency:**
- `cardMinCore(card, balanceRub, rates) → number` — Task 1/2.
- `cardMinPayment(card, rates) → number` — Task 1 (рефактор), используется в Task 3 для full-meta.
- `cardPaymentSchedule(card, rates, from, end) → [{date, amount, remainingAfter, interest}]` — Task 2/3.
- Событие карты minimum: meta теперь несёт remainingAfter/interest вместо minPayment/fullPayment — потребители (ForecastView) рендерят title/amount, не meta, так что не сломается.

Примечание для ревью: Task 3 меняет число card-событий для minimum. Регресс-тест этапа 1
(`buildForecast: карта с нулевой выпиской и долгом попадает в события`) проверял наличие
события и дату первого (2026-08-24) — остаётся валидным. Если он ассертит точное число
событий === 1, обновить на >= 1 (это регрессия ожидания, не бага).
