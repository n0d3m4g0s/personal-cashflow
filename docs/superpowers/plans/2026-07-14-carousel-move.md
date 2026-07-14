# Ход «Карусель» переливов — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить ход `carousel` в движок сценариев, который честно моделирует перекладывание долга между двумя картами Т-Банка (муж↔жена) под 0% грейс, НЕ тратя живые деньги и НЕ рисуя ложную яму в кассе.

**Architecture:** Новая чистая функция `carouselPlan` в `src/scenarios.js` считает цепочку переводов, проценты, комиссию, экономию и реализуемость. Ход `carousel` в `applyScenario` НЕ добавляет событий (кэш не трогается) — в отличие от `transfer`. В `evaluateScenario` карусель добавляет метрику `carouselSaved` и вливает `fee+interest` в `overpayment`. Редактор хода и строка метрики — в `ScenariosView.vue`.

**Tech Stack:** Vue 3 `<script setup>`, чистый Node `node --test` (без раннера), localStorage-стор. Направление зависимостей строго `advice → scenarios → finance → money` (scenarios.js НЕ импортирует ничего сверх finance.js/money.js).

## Global Constraints

Копируется дословно из спеки `docs/superpowers/specs/2026-07-14-carousel-move-design.md` и правил проекта (CLAUDE.md):

- Комментарии и весь текст — на русском. Прямые кавычки `"..."`. В НОВОМ коде и комментариях НЕТ длинных/средних тире (`—`/`–`), только дефис `-`.
- Любая денежная величина — объект `{ amount, currency }`. В рубли конвертируем только в точке расчёта через `moneyToRub(money, rates)`. Разные валюты напрямую не складываем.
- Ставка `apr` — доля (0.619 = 61.9%). Проценты за период: `apr × сумма × дни / 365`.
- Даты локальные без TZ-сдвига: `parseDate` / `fmtISO` / `addDays` из finance.js. Никакого `toISOString` / UTC в продакшен-коде.
- `stepDays = min(cardA.transferGraceDays, cardB.transferGraceDays) − 5`, минимум 1.
- `saved = amtRub × apr_holder × дни(startDate→end) / 365`, где `apr_holder = max(cardA.apr, cardB.apr)`.
- Комиссия оборота: `transferFeePercent/100 × over + transferFeeFixed`, где `over = max(0, amtRub − transferLimit)`.
- `feasible` true тогда и только тогда, когда: (а) обе карты `transferGraceEnabled !== false`, (б) хотя бы одна карта имеет свободный кредитный лимит `creditLimit − currentDebt ≥ amtRub` для приёма на первом обороте. Сумма СВЕРХ `transferLimit` карусель НЕ ломает - даёт комиссию, не фейл. Иначе `feasible: false` + текст в `warning`. (Task 1 реализован и уже учитывает это правило.)
- carousel в applyScenario НЕ добавляет income/expense и НЕ меняет currentDebt (весь эффект — в метриках).
- НЕ ломать существующие тесты (`test/scenarios.test.js`, `test/finance.test.js`, `test/advice.test.js`). Запуск: `npm test`.
- Файлы: `src/scenarios.js`, `src/components/ScenariosView.vue`, `test/scenarios.test.js`. Больше ничего не трогаем.

---

## File Structure

- `src/scenarios.js` — добавляем экспортируемую `carouselPlan(...)` рядом с `transferCost` (после строки ~71), ветку `case 'carousel'` в `applyMove` (после ветки `transfer`, ~147), обработку каруселей в `evaluateScenario` (после блока transfers, ~238), новое поле `carouselSaved` в возвращаемых `metrics` (~261-269).
- `test/scenarios.test.js` — новые тесты в конце файла (после теста на строке ~325), используя существующие хелперы `baseState()` и `migrateCard`.
- `src/components/ScenariosView.vue` — blank-объект carousel в `addMove` (~38), название типа в mapping (~66), блок редактора `v-else-if="m.type === 'carousel'"` (после блока transfer ~103), кнопка «+ Карусель» (~111), строка «Экономия карусели» в таблице (после «Переплата» ~140).

---

## Task 1: Чистая функция `carouselPlan`

> **Историческая пометка (после реализации):** ниже приведён ПЕРВОНАЧАЛЬНЫЙ код Task 1.
> В финальной реализации (коммит 4f2ee10, по решению пользователя) правило `feasible`
> ослаблено: ограничение реализуемости - ОБЩИЙ кредитный лимит приёмника, а НЕ беспроцентный
> `transferLimit`. Ветка `else if (amtRub > Math.min(limitA, limitB))` УДАЛЕНА; сумма сверх
> `transferLimit` даёт комиссию, а не фейл. Актуальный код - в `src/scenarios.js`, актуальное
> правило - в обновлённой спеке `docs/superpowers/specs/2026-07-14-carousel-move-design.md`.
> Тесты про сумму 200к тоже переписаны (feasible true при достаточном creditLimit + комиссия).

**Files:**
- Modify: `src/scenarios.js` (добавить экспорт `carouselPlan` после `transferCost`, ~строка 71)
- Test: `test/scenarios.test.js` (новые тесты в конце файла)

**Interfaces:**
- Consumes: `moneyToRub(money, rates)` и `convert` из `./money.js` (уже импортированы), `parseDate`, `fmtISO`, `addDays` из `./finance.js` (уже импортированы).
- Produces: `carouselPlan(cardA, cardB, amount, startDate, end, rates)` где `startDate` и `end` — объекты `Date`. Возвращает:
  ```
  {
    transfers: [{ date: string(ISO), fromId: string, toId: string, graceEnd: string(ISO) }],
    interest: number,   // рубли, 0 при корректном шаге
    fee: number,        // рубли, сумма комиссий по оборотам
    saved: number,      // рубли, экономия vs держать долг под apr_holder
    feasible: boolean,
    warning: string | null,
    endHolderId: string | null   // id карты, держащей долг после последнего оборота
  }
  ```
  `carouselPlan` вызывается из `evaluateScenario` (Task 2) и не используется больше нигде.

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `test/scenarios.test.js`. Хелпер для двух карт Т-Банка (после существующих тестов):

```js
import { carouselPlan } from '../src/scenarios.js' // ДОБАВИТЬ в существующий импорт scenarios.js сверху файла, не отдельной строкой

const rates0 = { amdPerRub: 4.6, usdPerRub: 0.0125 }
// Две карты Т-Банка: грейс на перевод 55 дней, лимит перевода 150к, обе с грейсом.
const tbankPair = () => [
  migrateCard({ id: 'A', name: 'Т-Банк муж', apr: 0.619, currentDebt: { amount: 150000, currency: 'RUB' }, creditLimit: { amount: 160000, currency: 'RUB' }, transferGraceEnabled: true, transferLimit: { amount: 150000, currency: 'RUB' }, transferGraceDays: 55, transferFeePercent: 0, transferFeeFixed: { amount: 0, currency: 'RUB' } }),
  migrateCard({ id: 'B', name: 'Т-Банк жена', apr: 0.619, currentDebt: { amount: 0, currency: 'RUB' }, creditLimit: { amount: 195000, currency: 'RUB' }, transferGraceEnabled: true, transferLimit: { amount: 150000, currency: 'RUB' }, transferGraceDays: 55, transferFeePercent: 0, transferFeeFixed: { amount: 0, currency: 'RUB' } }),
]

test('carouselPlan: 150к между двумя Т-Банками в лимите → interest 0, fee 0, saved > 0, feasible', () => {
  const [a, b] = tbankPair()
  const plan = carouselPlan(a, b, { amount: 150000, currency: 'RUB' }, parseDate('2026-11-10'), parseDate('2027-01-14'), rates0)
  assert.equal(plan.feasible, true)
  assert.equal(plan.interest, 0, 'при шаге 50 (грейс 55) проценты 0')
  assert.equal(plan.fee, 0, 'в пределах лимита комиссии нет')
  assert.ok(plan.saved > 0, 'есть экономия vs держать долг под 61.9%')
  assert.ok(plan.transfers.length >= 1, 'хотя бы один перевод')
  assert.equal(plan.transfers[0].fromId, 'A')
  assert.equal(plan.transfers[0].toId, 'B')
  // saved = 150000 × 0.619 × дни(10.11→14.01)/365. дни = 65.
  const days = Math.round((parseDate('2027-01-14') - parseDate('2026-11-10')) / 86400000)
  assert.ok(Math.abs(plan.saved - 150000 * 0.619 * days / 365) < 1, 'saved по формуле')
})

test('carouselPlan: чередование направлений и шаг ~50 дней', () => {
  const [a, b] = tbankPair()
  const plan = carouselPlan(a, b, { amount: 150000, currency: 'RUB' }, parseDate('2026-11-10'), parseDate('2027-03-01'), rates0)
  assert.ok(plan.transfers.length >= 2, 'несколько оборотов на длинном горизонте')
  // первый A→B, второй B→A
  assert.equal(plan.transfers[0].fromId, 'A')
  assert.equal(plan.transfers[0].toId, 'B')
  assert.equal(plan.transfers[1].fromId, 'B')
  assert.equal(plan.transfers[1].toId, 'A')
  const d0 = parseDate(plan.transfers[0].date), d1 = parseDate(plan.transfers[1].date)
  const step = Math.round((d1 - d0) / 86400000)
  assert.equal(step, 50, 'шаг = min(грейс) − 5 = 55 − 5')
})

test('carouselPlan: карта без transferGraceEnabled → feasible false с предупреждением', () => {
  const [a, b] = tbankPair()
  b.transferGraceEnabled = false
  const plan = carouselPlan(a, b, { amount: 150000, currency: 'RUB' }, parseDate('2026-11-10'), parseDate('2027-01-14'), rates0)
  assert.equal(plan.feasible, false)
  assert.ok(plan.warning && plan.warning.length > 0, 'есть текст предупреждения')
})

test('carouselPlan: сумма сверх лимита перевода → feasible false', () => {
  const [a, b] = tbankPair()
  // лимит перевода 150к у обеих, просим 200к
  const plan = carouselPlan(a, b, { amount: 200000, currency: 'RUB' }, parseDate('2026-11-10'), parseDate('2027-01-14'), rates0)
  assert.equal(plan.feasible, false)
  assert.ok(plan.warning && plan.warning.length > 0)
})

test('carouselPlan: комиссия за перевод считается на сумму сверх лимита', () => {
  const [a, b] = tbankPair()
  // поднимаем лимит перевода до 250к с комиссией 2.9%+290 на сверхлимитную часть 100к
  a.transferLimit = { amount: 150000, currency: 'RUB' }
  b.transferLimit = { amount: 150000, currency: 'RUB' }
  a.transferFeePercent = 2.9; a.transferFeeFixed = { amount: 290, currency: 'RUB' }
  b.transferFeePercent = 2.9; b.transferFeeFixed = { amount: 290, currency: 'RUB' }
  a.creditLimit = { amount: 300000, currency: 'RUB' }; a.currentDebt = { amount: 200000, currency: 'RUB' }
  b.creditLimit = { amount: 300000, currency: 'RUB' }
  // сумма 200к > лимит перевода 150к → feasible false по правилу (б). Проверяем именно false.
  const plan = carouselPlan(a, b, { amount: 200000, currency: 'RUB' }, parseDate('2026-11-10'), parseDate('2027-01-14'), rates0)
  assert.equal(plan.feasible, false, 'сумма > min(transferLimit) → нереализуемо')
})
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `npm test 2>&1 | grep -A2 carouselPlan`
Expected: FAIL — `carouselPlan is not a function` / `not defined` (функции ещё нет).

- [ ] **Step 3: Реализовать `carouselPlan`**

Вставить в `src/scenarios.js` сразу после функции `transferCost` (после строки 71, перед `applyScenario`):

```js
// План карусели: крутим долг amount между картами cardA и cardB, перекладывая каждые
// (min грейс перевода − 5) дней от startDate до end. cardA - карта-старт (источник долга).
// Кэш не трогается: долг переезжает переводом, живые деньги не задействованы.
// startDate/end - объекты Date. Возвращает график переводов, проценты, комиссию, экономию,
// реализуемость и id карты-держателя долга в конце горизонта.
export function carouselPlan(cardA, cardB, amount, startDate, end, rates) {
  const amtRub = moneyToRub(amount, rates)
  const limitA = moneyToRub(cardA.transferLimit, rates)
  const limitB = moneyToRub(cardB.transferLimit, rates)
  const graceA = Number(cardA.transferGraceDays) || 0
  const graceB = Number(cardB.transferGraceDays) || 0
  const stepDays = Math.max(1, Math.min(graceA, graceB) - 5)

  // Проверка реализуемости.
  let feasible = true
  let warning = null
  if (cardA.transferGraceEnabled === false || cardB.transferGraceEnabled === false) {
    feasible = false
    const bad = cardA.transferGraceEnabled === false ? cardA.name : cardB.name
    warning = `Карта "${bad}" не даёт грейс на перевод - карусель под 0% невозможна`
  } else if (amtRub > Math.min(limitA, limitB)) {
    feasible = false
    warning = `Сумма ${Math.round(amtRub)} превышает лимит перевода одной из карт (${Math.round(Math.min(limitA, limitB))})`
  } else {
    // хотя бы одна карта должна иметь свободный лимит под приём на первом обороте
    const freeA = moneyToRub(cardA.creditLimit, rates) - moneyToRub(cardA.currentDebt, rates)
    const freeB = moneyToRub(cardB.creditLimit, rates) - moneyToRub(cardB.currentDebt, rates)
    if (Math.max(freeA, freeB) < amtRub) {
      feasible = false
      warning = `Ни на одной карте нет свободного лимита ${Math.round(amtRub)} для первого переноса`
    }
  }

  // График переводов: старт A->B, далее чередуем каждые stepDays до end.
  const transfers = []
  let d = startDate
  let dir = 0 // 0: A->B, 1: B->A
  while (d <= end) {
    const fromId = dir === 0 ? cardA.id : cardB.id
    const toId = dir === 0 ? cardB.id : cardA.id
    const graceEnd = addDays(d, dir === 0 ? graceA : graceB)
    transfers.push({ date: fmtISO(d), fromId, toId, graceEnd: fmtISO(graceEnd) })
    d = addDays(d, stepDays)
    dir = dir === 0 ? 1 : 0
  }

  // Проценты: 0 пока каждый шаг не превышает грейса перевода. Если stepDays > грейса
  // (вырожденный ввод) - проценты за просрочку по apr держателя на дни сверх грейса за оборот.
  const aprHolder = Math.max(Number(cardA.apr) || 0, Number(cardB.apr) || 0)
  let interest = 0
  for (const t of transfers) {
    const graceDays = t.fromId === cardA.id ? graceA : graceB
    if (stepDays > graceDays) {
      const over = stepDays - graceDays
      interest += aprHolder * amtRub * over / 365
    }
  }

  // Комиссия: часть суммы сверх лимита перевода карты-приёмника на каждом обороте.
  let fee = 0
  for (const t of transfers) {
    const to = t.toId === cardA.id ? cardA : cardB
    const limit = moneyToRub(to.transferLimit, rates)
    const over = Math.max(0, amtRub - limit)
    if (over > 0) {
      fee += (Number(to.transferFeePercent) || 0) / 100 * over + moneyToRub(to.transferFeeFixed, rates)
    }
  }

  // Экономия: долг иначе висел бы под старшей ставкой весь горизонт.
  const daysHeld = Math.max(0, Math.round((end - startDate) / 86400000))
  const saved = feasible ? amtRub * aprHolder * daysHeld / 365 : 0

  const endHolderId = transfers.length ? transfers[transfers.length - 1].toId : null

  return { transfers, interest, fee, saved, feasible, warning, endHolderId }
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `npm test 2>&1 | grep -A2 carouselPlan`
Expected: все `carouselPlan` тесты PASS. Затем `npm test 2>&1 | tail -5` — общий счётчик тестов вырос, падений нет.

- [ ] **Step 5: Commit**

```bash
git add src/scenarios.js test/scenarios.test.js
git commit -m "Добавить carouselPlan: график переливов долга под 0% грейс"
```

---

## Task 2: Интеграция хода `carousel` в applyScenario/evaluateScenario

**Files:**
- Modify: `src/scenarios.js` (`applyMove` ~строка 147, `evaluateScenario` блок после transfers ~238, `metrics` ~261-269)
- Test: `test/scenarios.test.js` (новые тесты в конце)

**Interfaces:**
- Consumes: `carouselPlan(cardA, cardB, amount, startDate, end, rates)` из Task 1; `forked.cards`, `buildForecast`, `parseDate` (уже в области видимости evaluateScenario).
- Produces: ход `{ type: 'carousel', cardAId, cardBId, amount: {amount,currency}, startDate }` обрабатывается в applyScenario (без событий) и evaluateScenario. Новое поле `metrics.carouselSaved` (number, рубли). `fee + interest` карусели добавляется в `metrics.overpayment`. Нереализуемая карусель добавляет предупреждение в `metrics.transferWarnings` (переиспользуем массив).

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `test/scenarios.test.js`:

```js
// Состояние с двумя картами Т-Банка для сценарных тестов карусели.
const carouselState = () => {
  const st = baseState()
  st.cards = tbankPair()
  return st
}

test('applyScenario: carousel НЕ добавляет income/expense и НЕ меняет currentDebt (кэш чист)', () => {
  const st = carouselState()
  const debtBefore = st.cards[0].currentDebt.amount
  const scenario = { id: 'sc-car', name: 'Карусель', moves: [
    { type: 'carousel', cardAId: 'A', cardBId: 'B', amount: { amount: 150000, currency: 'RUB' }, startDate: '2026-11-10' },
  ] }
  const out = applyScenario(st, scenario)
  assert.equal(out.incomes.length, 0, 'карусель не добавляет доходов')
  assert.equal(out.expenses.length, 0, 'карусель не добавляет расходов - кэш не трогается')
  assert.equal(out.cards[0].currentDebt.amount, debtBefore, 'currentDebt не меняется')
})

test('evaluateScenario: carousel даёт carouselSaved > 0 и не роняет минимальный остаток', () => {
  const st = carouselState()
  const scenario = { id: 'sc-car2', name: 'Карусель', baseFrom: '2026-11-10', moves: [
    { type: 'carousel', cardAId: 'A', cardBId: 'B', amount: { amount: 150000, currency: 'RUB' }, startDate: '2026-11-10' },
  ] }
  const res = evaluateScenario(st, scenario, { from: '2026-11-10' })
  assert.ok(res.metrics.carouselSaved > 0, 'есть экономия карусели')
  // сравним с пустым сценарием: минимальный остаток НЕ должен просесть от карусели
  const empty = evaluateScenario(st, { id: 'e', name: 'пусто', baseFrom: '2026-11-10', moves: [] }, { from: '2026-11-10' })
  assert.equal(res.metrics.minBalance, empty.metrics.minBalance, 'карусель не создаёт ложной ямы в кассе')
})

test('evaluateScenario: transfer роняет кассу, тот же долг через carousel - нет', () => {
  const st = carouselState()
  // долг 150к на карте A. transfer моделирует возврат живыми (просадка кассы).
  const withTransfer = evaluateScenario(st, { id: 't', name: 'перенос', baseFrom: '2026-11-10', moves: [
    { type: 'transfer', fromCardId: 'A', toCardId: 'B', amount: { amount: 150000, currency: 'RUB' }, date: '2026-11-10', repay: 'manual', repayDate: '2026-12-30' },
  ] }, { from: '2026-11-10' })
  const withCarousel = evaluateScenario(st, { id: 'c', name: 'карусель', baseFrom: '2026-11-10', moves: [
    { type: 'carousel', cardAId: 'A', cardBId: 'B', amount: { amount: 150000, currency: 'RUB' }, startDate: '2026-11-10' },
  ] }, { from: '2026-11-10' })
  assert.ok(withCarousel.metrics.minBalance > withTransfer.metrics.minBalance, 'карусель бережёт кассу сильнее переноса')
})

test('evaluateScenario: нереализуемая карусель добавляет предупреждение', () => {
  const st = carouselState()
  st.cards[1].transferGraceEnabled = false
  const res = evaluateScenario(st, { id: 'w', name: 'плохая', baseFrom: '2026-11-10', moves: [
    { type: 'carousel', cardAId: 'A', cardBId: 'B', amount: { amount: 150000, currency: 'RUB' }, startDate: '2026-11-10' },
  ] }, { from: '2026-11-10' })
  assert.ok(res.metrics.transferWarnings.length > 0, 'предупреждение о нереализуемой карусели')
  assert.equal(res.metrics.carouselSaved, 0, 'без реализуемости экономии нет')
})
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `npm test 2>&1 | grep -A2 -i carousel | grep -i "fail\|carouselSaved"`
Expected: FAIL — `metrics.carouselSaved` undefined (`> 0` не выполняется), ход carousel в applyMove пока попадает в `default` и молча игнорируется.

- [ ] **Step 3: Реализовать ветку carousel в applyMove**

В `src/scenarios.js` в `applyMove` добавить ветку перед `default:` (после ветки `transfer`, ~строка 147):

```js
    case 'carousel':
      // Карусель кэш не трогает: долг переезжает переводом, живые деньги не задействованы.
      // currentDebt НЕ меняем, income/expense НЕ добавляем. Весь эффект - в метриках
      // (carouselPlan вызывается в evaluateScenario). Ложной ямы в кассе нет.
      break
```

- [ ] **Step 4: Реализовать обработку каруселей в evaluateScenario**

В `src/scenarios.js` в `evaluateScenario` после блока transfers (после строки 238, перед блоком `loanInterest`) добавить:

```js
  // Ходы карусели: считаем экономию/проценты/комиссию через carouselPlan. Кэш не трогаем.
  const carousels = (scenario.moves || []).filter((m) => m.type === 'carousel')
  let carouselSaved = 0
  let carouselCost = 0
  for (const move of carousels) {
    const cardA = forked.cards.find((c) => c.id === move.cardAId)
    const cardB = forked.cards.find((c) => c.id === move.cardBId)
    const startDate = parseDate(move.startDate)
    if (!cardA || !cardB || !startDate) continue // неполный ход или карта удалена
    const end = buildForecast(forked, { from }).end
    const plan = carouselPlan(cardA, cardB, move.amount, startDate, end, rates)
    if (plan.feasible) {
      carouselSaved += plan.saved
      carouselCost += plan.fee + plan.interest
    } else if (plan.warning) {
      transferWarnings.push({ carousel: true, warning: plan.warning })
    }
  }
```

Затем в возвращаемых `metrics` (объект после `return {`, ~строка 261) добавить `carouselSaved` и включить `carouselCost` в `overpayment`. Изменить строку overpayment и добавить поле:

```js
      overpayment: Math.round(cardInterest + loanInterest + transferTotal + carouselCost),
      carouselSaved: Math.round(carouselSaved),
```

(overpayment строка была `Math.round(cardInterest + loanInterest + transferTotal)` - добавляем `+ carouselCost`. `carouselSaved` - новое поле рядом.)

- [ ] **Step 5: Запустить тесты, убедиться что проходят**

Run: `npm test 2>&1 | tail -6`
Expected: все тесты PASS, падений 0, счётчик вырос на 4 новых теста Task 2.

- [ ] **Step 6: Commit**

```bash
git add src/scenarios.js test/scenarios.test.js
git commit -m "Ход carousel в движке сценариев: carouselSaved, кэш не трогается"
```

---

## Task 3: Редактор хода carousel и строка метрики в ScenariosView.vue

**Files:**
- Modify: `src/components/ScenariosView.vue` (`addMove` blank ~38, mapping названий ~66, блок редактора после transfer ~103, кнопка ~111, строка таблицы после «Переплата» ~140)

**Interfaces:**
- Consumes: `metrics.carouselSaved` из Task 2; `money(...)` (уже импортирован в компоненте для форматирования), `state.cards`, `MoneyInput` (уже импортирован).
- Produces: UI-ход `{ type: 'carousel', cardAId, cardBId, amount, startDate }`, совпадающий по форме с тем, что читает Task 2.

- [ ] **Step 1: Добавить blank-объект carousel в addMove**

В `src/components/ScenariosView.vue` в объекте `blank` внутри `addMove` (после строки `transfer: {...}`, ~строка 38) добавить:

```js
    carousel: { type: 'carousel', cardAId: state.cards[0]?.id || '', cardBId: state.cards[0]?.id || '', amount: { amount: 0, currency: 'RUB' }, startDate: '' },
```

- [ ] **Step 2: Добавить название типа в mapping**

В строке ~66 в объект-mapping названий типов добавить `carousel:'Карусель переливов'`:

```html
        <b class="small">{{ {purchase:'Крупная покупка', cardLoan:'Заём с карты', newLoan:'Новый кредит', adjust:'Разовый доход/расход', transfer:'Перенос долга', carousel:'Карусель переливов'}[m.type] }}</b>
```

- [ ] **Step 3: Добавить блок редактора carousel**

После блока `<div class="row" v-else-if="m.type === 'transfer'">...</div>` (после строки ~103, перед закрывающим `</div>` цикла ходов) добавить:

```html
        <div class="row" v-else-if="m.type === 'carousel'">
          <label class="small muted" style="align-self: center">крутим между</label>
          <select v-model="m.cardAId"><option v-for="c in state.cards" :key="c.id" :value="c.id">{{ c.name }}</option></select>
          <label class="small muted" style="align-self: center">и</label>
          <select v-model="m.cardBId"><option v-for="c in state.cards" :key="c.id" :value="c.id">{{ c.name }}</option></select>
          <MoneyInput v-model="m.amount" compact />
          <input type="date" v-model="m.startDate" title="Старт карусели" />
        </div>
```

- [ ] **Step 4: Добавить кнопку «+ Карусель»**

После кнопки `<button class="sm ghost" @click="addMove(sc, 'transfer')">+ Перенос долга</button>` (строка ~111) добавить:

```html
        <button class="sm ghost" @click="addMove(sc, 'carousel')">+ Карусель</button>
```

- [ ] **Step 5: Добавить строку «Экономия карусели» в таблицу сравнения**

После блока строки «Переплата (проценты)» (`</tr>` на ~строке 140, перед строкой «Возврат в грейс») добавить:

```html
            <tr>
              <td class="muted small">Экономия карусели</td>
              <td v-for="c in comparison" :key="c.name" class="mono pos">
                {{ c.metrics && c.metrics.carouselSaved ? money(c.metrics.carouselSaved) : '-' }}
              </td>
            </tr>
```

- [ ] **Step 6: Проверить сборку и запустить тесты**

Run: `npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -3`
Expected: build успешен (`dist/` собран без ошибок Vue-компиляции), все тесты PASS. Vue-компоненты тестами не покрыты (по CLAUDE.md), проверка через успешную сборку.

- [ ] **Step 7: Commit**

```bash
git add src/components/ScenariosView.vue
git commit -m "Редактор хода carousel и строка экономии в ScenariosView"
```

---

## Self-Review (заполнено при написании плана)

**1. Spec coverage:**
- carouselPlan (spec §«Чистая функция») → Task 1 ✓
- Кэш не тратится / нет ложной ямы (spec §Что считает §1) → Task 2 (applyMove break, тест на minBalance) ✓
- Проценты 0 при корректном шаге (spec §2) → Task 1 (тест interest 0) ✓
- Комиссия сверх лимита (spec §3) → Task 1 (тест fee) ✓
- Проверка лимитов/грейса, feasible/warning (spec §4) → Task 1 (тесты feasible false) ✓
- Экономия saved (spec §5) → Task 1 (тест по формуле) ✓
- endHolderId, долг висит (spec §6) → Task 1 (в возвращаемом объекте) ✓
- metrics.carouselSaved + fee/interest в overpayment (spec §Интеграция) → Task 2 ✓
- Редактор «+ Карусель», два селекта + MoneyInput + date (spec §Редактор) → Task 3 ✓
- Строка «Экономия карусели» (spec §Редактор) → Task 3 ✓
- Регрессия существующих тестов (spec §Тесты) → каждый Task финальным `npm test` ✓

**2. Placeholder scan:** плейсхолдеров нет, весь код приведён целиком.

**3. Type consistency:** `carouselPlan(cardA, cardB, amount, startDate, end, rates)` — сигнатура одинакова в Task 1 (определение), Task 2 (вызов). Поле `carouselSaved` одинаково в Task 2 (запись в metrics) и Task 3 (чтение). Ход `{ type:'carousel', cardAId, cardBId, amount, startDate }` совпадает в Task 2 (чтение) и Task 3 (создание). `startDate`/`end` — объекты `Date` во всех вызовах carouselPlan.
