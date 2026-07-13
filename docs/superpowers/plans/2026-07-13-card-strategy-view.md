# Вкладка "Карты: стратегия" (этап 3b-2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вкладка "Карты: стратегия" — сводка по картам (проценты за горизонт, месячная нагрузка, долг, свободный лимит), календарь обязательств "что когда платить", таблица по картам. Поверх готового ядра.

**Architecture:** Чистая функция `cardsSummary` в `src/finance.js` (агрегаты). Тонкий компонент `CardStrategyView.vue` (панель сводки, календарь из buildForecast, таблица perCard). Вкладка в App.vue.

**Tech Stack:** Vue 3 (`<script setup>`), Vite, чистый Node для тестов, localStorage.

## Global Constraints

- Комментарии и весь UI-текст на русском. Прямые кавычки, без длинных тире (в комментариях кода дефис `-`).
- Даты локальные без TZ: cardCycle/buildForecast/fmtHuman из finance.js, без UTC/toISOString.
- Деньги `{amount,currency}`, в рубли через moneyToRub/cardDebt только в точке расчёта.
- apr доля. cardsSummary НЕ импортирует transferCost из scenarios.js (цикл finance→scenarios) — свободный лимит считает прямой формулой.
- cardsSummary — чистая функция в finance.js + тесты. Компонент тонкий, не мутирует state.
- Не сломать 58 тестов. Запуск: `npm test`. Ветка card-strategy-view. Коммитим часто.

---

## Файловая структура

- `src/finance.js` — `cardsSummary` (агрегаты по картам).
- `src/components/CardStrategyView.vue` — новый компонент.
- `src/App.vue` — вкладка "Стратегия".
- `test/finance.test.js` — тесты cardsSummary.

---

### Task 1: `cardsSummary` — агрегаты по картам

**Files:**
- Modify: `src/finance.js` (новая функция cardsSummary, рядом с buildForecast/cardPaymentSchedule)
- Test: `test/finance.test.js`

**Interfaces:**
- Consumes: `cardDebt`, `cardMinPayment`, `cardPaymentSchedule`, `cardCycle`, `parseDate`, `addMonths`, `today`; `moneyToRub`.
- Produces: `cardsSummary(state, opts = {}) → { totalInterest, monthlyMin, totalDebt, debtInGrace, debtUnderInterest, totalFreeLimit, transferableFree, perCard: [...] }`. Все денежные — числа в рублях. `opts.from` (ISO) / `opts.horizonMonths` с дефолтами из state.settings. Пропускает disabled и долг ≤ 0.
  - `perCard` элемент: `{ id, name, bank, debt, nextPayment, nextDate, graceEnd, freeLimit, transferableFree, apr, strategy }`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `test/finance.test.js` (импорт: добавить `cardsSummary`):

```js
test('cardsSummary: агрегаты по нескольким картам', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const state = {
    settings: { rates, startingCash: { amount: 100000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 6 },
    incomes: [], expenses: [], loans: [], goals: [],
    cards: [
      { id: 'ozon', name: 'Озон', bank: 'Озон', payStrategy: 'minimum', statementDate: '2026-08-08', dueDate: '2026-08-24', graceEndDate: '2026-09-08', statementCycleDays: 30,
        currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' }, creditLimit: { amount: 49000, currency: 'RUB' },
        minPaymentPercent: 4, minPaymentFixed: { amount: 400, currency: 'RUB' }, minPaymentPlusInterest: true, apr: 0.624,
        transferGraceEnabled: false, transferLimit: { amount: 0, currency: 'RUB' }, transferGraceDays: 0 },
      { id: 'wife', name: 'Жена', bank: 'Т-Банк', payStrategy: 'minimum', statementDate: '2026-08-08', dueDate: '2026-09-28', graceEndDate: '2026-09-28', statementCycleDays: 30,
        currentDebt: { amount: 0, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' }, creditLimit: { amount: 195000, currency: 'RUB' },
        minPaymentPercent: 14, minPaymentFixed: { amount: 600, currency: 'RUB' }, minPaymentPlusInterest: false, apr: 0.619,
        transferGraceEnabled: true, transferLimit: { amount: 150000, currency: 'RUB' }, transferGraceDays: 55 },
    ],
  }
  const s = cardsSummary(state, { from: '2026-07-12' })
  // totalDebt = 39400 (у жены долг 0, пропущена)
  assert.equal(s.totalDebt, 39400)
  // monthlyMin > 0 (у Озона есть минимум)
  assert.ok(s.monthlyMin > 0)
  // totalInterest > 0 (Озон minimum под 62.4%)
  assert.ok(s.totalInterest > 0)
  // totalFreeLimit по всем активным картам: Озон 49000-39400=9600 + жена 195000-0=195000 = 204600.
  assert.equal(s.totalFreeLimit, 204600)
  // transferableFree: только карты с transferGraceEnabled - жена. min(150000, 195000-0)=150000.
  assert.equal(s.transferableFree, 150000)
  // perCard: только карты с долгом (Озон)
  assert.equal(s.perCard.length, 1)
  assert.equal(s.perCard[0].id, 'ozon')
  assert.equal(s.perCard[0].debt, 39400)
})

test('cardsSummary: пустое состояние → нули', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const state = { settings: { rates, horizonMonths: 6 }, incomes: [], expenses: [], loans: [], goals: [], cards: [] }
  const s = cardsSummary(state, { from: '2026-07-12' })
  assert.equal(s.totalDebt, 0)
  assert.equal(s.totalInterest, 0)
  assert.equal(s.monthlyMin, 0)
  assert.deepEqual(s.perCard, [])
})
```

Примечание к тесту: `transferableFree` и `totalFreeLimit` считаются по всем активным картам
(включая с нулевым долгом — свободный лимит есть и у них), а `perCard`/`totalDebt`/
`monthlyMin`/`totalInterest` — только по картам с долгом > 0. Это отражено в Step 3.

- [ ] **Step 2: Запустить — падает**

Run: `node --test --test-name-pattern 'cardsSummary' 2>&1 | tail -15`
Expected: FAIL (не найдена).

- [ ] **Step 3: Реализовать cardsSummary**

Добавить в `src/finance.js` после buildForecast (или рядом с cardPaymentSchedule):

```js
// Свободный лимит перевода на карту (в рублях): min(беспроцентный лимит, свободный лимит).
function cardTransferableFree(card, rates) {
  const limit = moneyToRub(card.transferLimit, rates)
  const free = moneyToRub(card.creditLimit, rates) - moneyToRub(card.currentDebt, rates)
  return Math.min(limit, Math.max(0, free))
}

// Сводка по всем картам: агрегаты для вкладки "Карты: стратегия".
export function cardsSummary(state, opts = {}) {
  const rates = state.settings.rates
  const start = opts.from ? parseDate(opts.from) : today()
  const horizonMonths = opts.horizonMonths ?? state.settings.horizonMonths ?? 6
  const end = addMonths(start, horizonMonths, start.getDate())

  let totalInterest = 0, monthlyMin = 0, totalDebt = 0
  let debtInGrace = 0, debtUnderInterest = 0
  let totalFreeLimit = 0, transferableFree = 0
  const perCard = []

  for (const card of state.cards || []) {
    if (card.disabled) continue
    // свободный лимит - по всем активным картам
    const free = Math.max(0, moneyToRub(card.creditLimit, rates) - moneyToRub(card.currentDebt, rates))
    totalFreeLimit += free
    if (card.transferGraceEnabled) transferableFree += cardTransferableFree(card, rates)

    const debt = cardDebt(card, rates)
    if (debt <= 0) continue
    totalDebt += debt
    monthlyMin += cardMinPayment(card, rates)

    const full = card.payStrategy !== 'minimum'
    if (full) {
      // full-карта: долг в грейсе, если grace не вышел; иначе под процентами
      const { graceEnd } = cardCycle(card, start)
      if (graceEnd >= start) debtInGrace += debt
      else debtUnderInterest += debt
    } else {
      // minimum: под процентами; проценты за горизонт из графика
      debtUnderInterest += debt
      const sched = cardPaymentSchedule(card, rates, start, end)
      for (const p of sched) totalInterest += p.interest
    }

    const { due, graceEnd } = cardCycle(card, start)
    perCard.push({
      id: card.id, name: card.name, bank: card.bank,
      debt, nextPayment: cardMinPayment(card, rates), nextDate: due, graceEnd,
      freeLimit: free, transferableFree: card.transferGraceEnabled ? cardTransferableFree(card, rates) : 0,
      apr: Number(card.apr) || 0, strategy: full ? 'full' : 'minimum',
    })
  }

  return { totalInterest, monthlyMin, totalDebt, debtInGrace, debtUnderInterest, totalFreeLimit, transferableFree, perCard }
}
```

- [ ] **Step 4: Запустить весь файл**

Run: `npm test 2>&1 | tail -8`
Expected: все PASS (новые + 58 прежних).

- [ ] **Step 5: Коммит**

```bash
git add src/finance.js test/finance.test.js
git commit -m "finance: cardsSummary - агрегаты по картам для вкладки стратегии"
```

---

### Task 2: Компонент `CardStrategyView.vue` + вкладка

**Files:**
- Create: `src/components/CardStrategyView.vue`
- Modify: `src/App.vue` (импорт + вкладка)
- Test: ручная проверка в браузере

**Interfaces:**
- Consumes: `state`, `cardsSummary`, `buildForecast`, `fmtHuman`; `formatMoney`, `moneyToRub`.
- Produces: компонент с панелью сводки (4 плитки), календарём обязательств (card-события buildForecast, ближайшие сверху), таблицей perCard. Вкладка `{ key: 'cardStrategy', label: 'Стратегия', icon: '🧮', comp: CardStrategyView }` после 'cards'.

- [ ] **Step 1: Создать компонент**

Создать `src/components/CardStrategyView.vue`:

```vue
<script setup>
import { computed } from 'vue'
import { state } from '../store.js'
import { cardsSummary, buildForecast, fmtHuman } from '../finance.js'
import { formatMoney } from '../money.js'

const summary = computed(() => cardsSummary(state))
const forecast = computed(() => buildForecast(state))

function money(rub) { return formatMoney(rub, 'RUB') }

// Календарь: только события карт, ближайшие сверху.
const cardEvents = computed(() =>
  forecast.value.events.filter((e) => e.kind === 'card').slice(0, 30)
)
function pct(apr) { return (apr * 100).toFixed(1) + '%' }
</script>

<template>
  <div class="grid" style="gap: 16px">
    <div>
      <h2 style="margin: 0">Карты: стратегия</h2>
      <div class="small muted">Сводка по всем картам, календарь платежей и цена обслуживания.</div>
    </div>

    <!-- Панель сводки -->
    <section class="grid summary" style="grid-template-columns: repeat(4, 1fr); gap: 12px">
      <div class="card stat">
        <div class="muted small">Проценты за горизонт</div>
        <div class="big neg mono">{{ money(summary.totalInterest) }}</div>
        <div class="small muted">по минимальным платежам</div>
      </div>
      <div class="card stat">
        <div class="muted small">Месячная нагрузка</div>
        <div class="big mono">{{ money(summary.monthlyMin) }}</div>
        <div class="small muted">минимальные платежи/мес</div>
      </div>
      <div class="card stat">
        <div class="muted small">Общий долг по картам</div>
        <div class="big mono">{{ money(summary.totalDebt) }}</div>
        <div class="small muted">в грейсе {{ money(summary.debtInGrace) }} + под % {{ money(summary.debtUnderInterest) }}</div>
      </div>
      <div class="card stat">
        <div class="muted small">Свободный лимит</div>
        <div class="big pos mono">{{ money(summary.totalFreeLimit) }}</div>
        <div class="small muted">беспроцентно переводимо {{ money(summary.transferableFree) }}</div>
      </div>
    </section>

    <!-- Календарь обязательств -->
    <div class="card">
      <h3 style="margin-top: 0">Календарь платежей (ближайшие сверху)</h3>
      <table v-if="cardEvents.length">
        <thead><tr><th>Дата</th><th>Карта</th><th style="text-align: right">Платёж</th><th>Конец грейса</th></tr></thead>
        <tbody>
          <tr v-for="(e, i) in cardEvents" :key="i">
            <td class="nowrap muted small">{{ fmtHuman(e.date) }}</td>
            <td>💳 {{ e.title }}</td>
            <td class="mono neg nowrap" style="text-align: right">−{{ money(Math.abs(e.amount)) }}</td>
            <td class="small muted">{{ e.graceDate ? fmtHuman(e.graceDate) : '-' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">Обязательств по картам в горизонте нет.</p>
    </div>

    <!-- Таблица по картам -->
    <div class="card">
      <h3 style="margin-top: 0">По картам</h3>
      <table v-if="summary.perCard.length">
        <thead><tr><th>Карта</th><th style="text-align: right">Долг</th><th style="text-align: right">Ближайший платёж</th><th>До</th><th>Грейс до</th><th style="text-align: right">Свободно</th><th style="text-align: right">Ставка</th></tr></thead>
        <tbody>
          <tr v-for="c in summary.perCard" :key="c.id">
            <td>{{ c.name }} <span class="small muted">{{ c.bank }}</span></td>
            <td class="mono nowrap" style="text-align: right">{{ money(c.debt) }}</td>
            <td class="mono nowrap" style="text-align: right">{{ money(c.nextPayment) }}</td>
            <td class="small muted nowrap">{{ fmtHuman(c.nextDate) }}</td>
            <td class="small muted nowrap">{{ fmtHuman(c.graceEnd) }}</td>
            <td class="mono nowrap" style="text-align: right">{{ money(c.freeLimit) }}<span v-if="c.transferableFree > 0" class="small pos"> ⇄{{ money(c.transferableFree) }}</span></td>
            <td class="mono small nowrap" style="text-align: right">{{ pct(c.apr) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">Карт с долгом нет.</p>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Добавить вкладку в App.vue**

В `src/App.vue`: импорт `import CardStrategyView from './components/CardStrategyView.vue'` и запись в tabs после 'cards':

```js
  { key: 'cardStrategy', label: 'Стратегия', icon: '🧮', comp: CardStrategyView },
```

- [ ] **Step 3: Проверить build**

Run: `npm run build 2>&1 | tail -6`
Expected: build ок (валидный Vue-template).

- [ ] **Step 4: Ручная проверка**

`npm run dev`, вкладка "Стратегия". Импортировать реальный JSON пользователя (Настройки → Импорт), проверить: панель сводки показывает 4 цифры; календарь — платежи карт по датам (ближайшие сверху); таблица — строку на карту с долгом, свободный лимит, ставку. Если Playwright доступен — снять снапшот, убедиться нет ошибок консоли. Почистить временные файлы после.

- [ ] **Step 5: Коммит**

```bash
git add src/components/CardStrategyView.vue src/App.vue
git commit -m "CardStrategyView: вкладка стратегии - сводка, календарь, таблица карт"
```

---

## Self-Review

**1. Spec coverage:**
- cardsSummary (4 агрегата + perCard, без цикла импорта) → Task 1. ✓
- totalInterest из cardPaymentSchedule, debtInGrace/debtUnderInterest, transferableFree → Task 1. ✓
- Компонент: панель сводки, календарь, таблица perCard → Task 2. ✓
- Вкладка в App.vue → Task 2. ✓
- Тесты cardsSummary (агрегаты + пустое состояние) → Task 1. ✓
- Границы (оптимизатор 3c, блок предупреждений о переносах опционален — в план не включён как отдельный шаг, компонент можно дорастить позже) → соблюдены. ✓

**2. Placeholder scan:** код показан во всех шагах; формулы конкретны; нет TBD.

**3. Type consistency:**
- `cardsSummary(state, opts) → { totalInterest, monthlyMin, totalDebt, debtInGrace, debtUnderInterest, totalFreeLimit, transferableFree, perCard[] }` — Task 1/2.
- perCard: `{ id, name, bank, debt, nextPayment, nextDate, graceEnd, freeLimit, transferableFree, apr, strategy }` — Task 1/2.
- Компонент читает summary.* и forecast.events (kind='card' несёт graceDate из этапа 3b-1) — согласовано.

Примечание для ревью: блок "Предупреждения о переносах" из спека (evaluateScenario по
state.scenarios) НЕ включён в план как отдельный шаг — он помечен опциональным. Основная
ценность (сводка + календарь + таблица) реализуется в Task 1-2. Предупреждения можно
добавить позже без переделки. Если ревью сочтёт нужным — добавить в Task 2 отдельным блоком.
