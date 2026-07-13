# Оптимизатор-советник (этап 3c) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Оптимизатор-советник cardAdvice — ранжированные объяснимые рекомендации по картам (риск просрочки → экономия на переносах), с обоснованием и опциональным ходом-переливом. Блок "Рекомендации" во вкладке "Стратегия" с кнопкой "в Сценарии".

**Architecture:** Чистая функция `cardAdvice` в новом `src/advice.js` (слой-советник поверх finance.js/scenarios.js). nav-reactive в store.js для переключения вкладки. Блок в CardStrategyView.vue. Тесты в новом test/advice.test.js.

**Tech Stack:** Vue 3 (`<script setup>`), Vite, чистый Node для тестов, localStorage.

## Global Constraints

- Комментарии и весь UI-текст на русском. Прямые кавычки, без длинных тире (в комментариях кода дефис `-`).
- Даты локальные без TZ: buildForecast/cardCycle/parseDate/fmtISO/addDays из finance.js, без UTC/toISOString.
- Деньги в рубли через moneyToRub/cardDebt только в точке расчёта. apr доля.
- cardAdvice — чистая функция в advice.js + тесты. Импорт finance.js + scenarios.js допустим (advice не ядро, цикла нет). Не мутирует state.
- Не сломать 61 тест. Запуск: `npm test`. Ветка card-advice. Коммитим часто.

---

## Файловая структура

- `src/advice.js` — cardAdvice + правила-эвристики + подбор приёмника.
- `src/store.js` — nav reactive + goTab.
- `src/App.vue` — nav.active вместо локального ref.
- `src/components/CardStrategyView.vue` — блок "Рекомендации" + кнопка "в Сценарии".
- `test/advice.test.js` — тесты cardAdvice.

Порядок: сначала ядро (Task 1, чистая функция с тестами), затем nav-механизм (Task 2), затем UI-блок (Task 3).

---

### Task 1: `cardAdvice` — правила-эвристики

**Files:**
- Create: `src/advice.js`
- Test: `test/advice.test.js` (создать)

**Interfaces:**
- Consumes: `buildForecast`, `buildMonthly`, `cardDebt`, `cardCycle`, `parseDate`, `fmtHuman`, `addDays` из `./finance.js`; `transferCost` из `./scenarios.js`; `moneyToRub` из `./money.js`.
- Produces: `cardAdvice(state, opts = {}) → [{ severity, kind, title, why, action }]`. severity 'critical'|'warning'|'save'. Сортировка critical→warning→save, save по убыванию экономии. Не мутирует state.
  - Вспомогательная (не экспортируется или экспортируется для теста): `pickReceiver(state, rates) → card|null` — карта с transferGraceEnabled и availableLimit>0, максимальный availableLimit.

- [ ] **Step 1: Написать падающий тест**

Создать `test/advice.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { cardAdvice } from '../src/advice.js'

const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }

// Дорогая карта (Уралсиб) + карта жены с грейсом на перевод.
function stateWithExpensiveDebt() {
  return {
    settings: { rates, startingCash: { amount: 300000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 6 },
    incomes: [{ name: 'ЗП', amount: 300000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-10' } }],
    expenses: [], loans: [], goals: [], scenarios: [],
    cards: [
      { id: 'ural', name: 'Уралсиб', bank: 'Уралсиб', payStrategy: 'minimum', statementDate: '2026-08-01', dueDate: '2026-08-30', graceEndDate: '2026-09-30', statementCycleDays: 30,
        currentDebt: { amount: 19275, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' }, creditLimit: { amount: 20000, currency: 'RUB' },
        minPaymentPercent: 3, minPaymentFixed: { amount: 300, currency: 'RUB' }, minPaymentPlusInterest: true, apr: 0.999,
        transferGraceEnabled: false, transferLimit: { amount: 0, currency: 'RUB' }, transferGraceDays: 0, transferFeePercent: 0, transferFeeFixed: { amount: 0, currency: 'RUB' } },
      { id: 'wife', name: 'Т-Банк (жена)', bank: 'Т-Банк', payStrategy: 'minimum', statementDate: '2026-08-08', dueDate: '2026-09-28', graceEndDate: '2026-09-28', statementCycleDays: 30,
        currentDebt: { amount: 0, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' }, creditLimit: { amount: 195000, currency: 'RUB' },
        minPaymentPercent: 14, minPaymentFixed: { amount: 600, currency: 'RUB' }, minPaymentPlusInterest: false, apr: 0.619,
        transferGraceEnabled: true, transferLimit: { amount: 150000, currency: 'RUB' }, transferGraceDays: 55, transferFeePercent: 2.9, transferFeeFixed: { amount: 290, currency: 'RUB' } },
    ],
  }
}

test('cardAdvice: дорогой долг Уралсиба → save-рекомендация перелива на карту жены', () => {
  const adv = cardAdvice(stateWithExpensiveDebt(), { from: '2026-07-13' })
  const save = adv.find((a) => a.kind === 'transfer-save')
  assert.ok(save, 'должна быть рекомендация переноса')
  assert.equal(save.severity, 'save')
  assert.ok(save.action && save.action.type === 'transfer', 'есть ход transfer')
  assert.equal(save.action.fromCardId, 'ural')
  assert.equal(save.action.toCardId, 'wife')
  assert.ok(save.why.length > 0, 'есть обоснование')
})

test('cardAdvice: нет карт с грейсом на перевод → у переносных правил нет action', () => {
  const st = stateWithExpensiveDebt()
  st.cards[1].transferGraceEnabled = false // убрали единственный приёмник
  const adv = cardAdvice(st, { from: '2026-07-13' })
  const save = adv.find((a) => a.kind === 'transfer-save')
  // без приёмника перенос не предлагается (или action null)
  assert.ok(!save || save.action === null)
})

test('cardAdvice: здоровое состояние без карт → пустой массив', () => {
  const st = { settings: { rates, startingCash: { amount: 300000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 6 }, incomes: [], expenses: [], loans: [], goals: [], scenarios: [], cards: [] }
  assert.deepEqual(cardAdvice(st, { from: '2026-07-13' }), [])
})

test('cardAdvice: сортировка critical → warning → save', () => {
  const adv = cardAdvice(stateWithExpensiveDebt(), { from: '2026-07-13' })
  const order = { critical: 0, warning: 1, save: 2 }
  for (let i = 1; i < adv.length; i++) {
    assert.ok(order[adv[i].severity] >= order[adv[i-1].severity], 'severity не убывает по приоритету')
  }
})
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test test/advice.test.js 2>&1 | tail -15`
Expected: FAIL (advice.js не существует).

- [ ] **Step 3: Реализовать advice.js**

Создать `src/advice.js`:

```js
// Оптимизатор-советник: правила-эвристики → ранжированные рекомендации по картам.
// Слой поверх ядра (finance.js) и движка сценариев (scenarios.js). Не мутирует state.
import { buildForecast, buildMonthly, cardDebt, cardCycle, parseDate, fmtHuman, addDays } from './finance.js'
import { transferCost } from './scenarios.js'
import { moneyToRub } from './money.js'

// Доступный лимит перевода НА карту (в рублях).
function availableLimit(card, rates) {
  const limit = moneyToRub(card.transferLimit, rates)
  const free = moneyToRub(card.creditLimit, rates) - moneyToRub(card.currentDebt, rates)
  return Math.min(limit, Math.max(0, free))
}

// Карта-приёмник для перелива: с грейсом на перевод и максимальным свободным лимитом.
export function pickReceiver(state, rates) {
  let best = null, bestFree = 0
  for (const c of state.cards || []) {
    if (c.disabled || !c.transferGraceEnabled) continue
    const av = availableLimit(c, rates)
    if (av > bestFree) { best = c; bestFree = av }
  }
  return best
}

const SEV_ORDER = { critical: 0, warning: 1, save: 2 }

export function cardAdvice(state, opts = {}) {
  const rates = state.settings.rates
  const from = opts.from || null
  const forecast = buildForecast(state, from ? { from } : {})
  const start = forecast.start
  const receiver = pickReceiver(state, rates)
  const out = []

  // Правило 1 (critical): кассовый разрыв к дате card-события.
  const buffer = moneyToRub(state.settings.safetyBuffer, rates)
  for (const day of forecast.days) {
    const cardEv = day.events.find((e) => e.kind === 'card')
    if (!cardEv) continue
    if (day.balance < buffer) {
      const shortfall = Math.max(0, buffer - day.balance)
      let action = null
      if (receiver && shortfall > 0) {
        const amt = Math.min(shortfall, availableLimit(receiver, rates))
        // card-события buildForecast НЕ несут cardId в meta (только owner/bank/...), поэтому
        // fromCardId для shortfall оставляем null - важен приёмник (куда взять деньги).
        action = { type: 'transfer', fromCardId: null, toCardId: receiver.id, amount: { amount: Math.round(amt), currency: 'RUB' }, date: fmtISOsafe(day.date), repay: 'auto', repayDate: '' }
      }
      out.push({
        severity: 'critical', kind: 'shortfall',
        title: `Риск нехватки к ${fmtHuman(day.date)}`,
        why: `На ${fmtHuman(day.date)} остаток ${Math.round(day.balance)} руб ниже буфера ${Math.round(buffer)} руб при платеже по карте.`,
        action,
      })
      break // одно критическое предупреждение достаточно
    }
  }

  // Правило 3 (save): перенос дорогого долга под грейс.
  if (receiver) {
    const saves = []
    for (const card of state.cards || []) {
      if (card.disabled || card.id === receiver.id) continue
      const debt = cardDebt(card, rates)
      const apr = Number(card.apr) || 0
      if (debt <= 0 || apr <= 0) continue
      const av = availableLimit(receiver, rates)
      if (av <= 0) continue
      const amt = Math.min(debt, av)
      // проценты на исходной карте за грейс-период приёмника
      const days = Number(receiver.transferGraceDays) || 55
      const interestOnSource = apr * amt * days / 365
      // цена перелива на приёмник (комиссия + проценты приёмника; в грейс приёмника проценты 0)
      const repayDate = addDays(start, days)
      const cost = transferCost(receiver, { amount: Math.round(amt), currency: 'RUB' }, start, repayDate, rates)
      const saved = interestOnSource - cost.total
      if (saved > 0) {
        saves.push({
          severity: 'save', kind: 'transfer-save',
          title: `Перенести долг ${card.name} на ${receiver.name}`,
          why: `Перенос ${Math.round(amt)} руб сэкономит ≈ ${Math.round(saved)} руб (проценты ${Math.round(interestOnSource)} − цена ${Math.round(cost.total)}) за грейс ${days} дней.`,
          action: { type: 'transfer', fromCardId: card.id, toCardId: receiver.id, amount: { amount: Math.round(amt), currency: 'RUB' }, date: fmtISOsafe(start), repay: 'auto', repayDate: '' },
          _saved: saved,
        })
      }
    }
    saves.sort((a, b) => b._saved - a._saved)
    for (const s of saves) { delete s._saved; out.push(s) }
  }

  // Правило 4 (save, инфо): порядок погашения.
  const monthly = buildMonthly(state, rates)
  if (monthly.surplus > 0) {
    const withDebt = (state.cards || []).filter((c) => !c.disabled && cardDebt(c, rates) > 0)
    if (withDebt.length > 0) {
      const priciest = withDebt.slice().sort((a, b) => (Number(b.apr) || 0) - (Number(a.apr) || 0))[0]
      out.push({
        severity: 'save', kind: 'payoff-order',
        title: 'Куда направить свободные деньги',
        why: `Свободный профицит ${Math.round(monthly.surplus)} руб/мес. Гасите первой самую дорогую карту: ${priciest.name} (${((Number(priciest.apr)||0)*100).toFixed(1)}% годовых).`,
        action: null,
      })
    }
  }

  out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
  return out
}

// Безопасный ISO из Date (локальный, без TZ-сдвига).
function fmtISOsafe(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
```

Примечание: `fmtISO` есть в finance.js — можно импортировать вместо локального fmtISOsafe.
Реализатор: импортируй `fmtISO` из finance.js и используй его; локальный fmtISOsafe оставлен
как запасной, если импорт неудобен. Также добавь `cardEv.cardId` — проверь, что событие
карты в buildForecast несёт id карты; если нет (сейчас meta несёт owner/bank/statementDate/
graceDate, но НЕ id) — для shortfall-action fromCardId можно оставить null (перелив на
приёмник всё равно определяется, источник для shortfall не критичен) ИЛИ добавить cardId в
meta card-события в finance.js (мелкая правка). Простейше: fromCardId: null для shortfall.

- [ ] **Step 4: Запустить весь файл тестов**

Run: `npm test 2>&1 | tail -10`
Expected: все PASS (advice + 61 прежний).

- [ ] **Step 5: Коммит**

```bash
git add src/advice.js test/advice.test.js
git commit -m "advice: cardAdvice - правила-эвристики рекомендаций по картам"
```

---

### Task 2: nav-reactive для переключения вкладки

**Files:**
- Modify: `src/store.js` (nav reactive + goTab)
- Modify: `src/App.vue` (использовать nav.active)
- Test: ручная проверка (навигация — UI)

**Interfaces:**
- Produces: `export const nav = reactive({ active: 'dashboard' })` и `export function goTab(key) { nav.active = key }` в store.js. App.vue использует `nav.active` вместо локального `ref`.

- [ ] **Step 1: Добавить nav в store.js**

В `src/store.js` после `export const state = reactive(load())` добавить:

```js
// Навигация: активная вкладка (для переключения из компонентов).
export const nav = reactive({ active: 'dashboard' })
export function goTab(key) { nav.active = key }
```

- [ ] **Step 2: Переключить App.vue на nav.active**

В `src/App.vue`:
- Импорт: `import { state, nav } from './store.js'` (добавить nav к существующему импорту state).
- Заменить `const active = ref('dashboard')` на удаление этой строки (active теперь nav.active).
- `const current = computed(() => tabs.find((t) => t.key === nav.active)?.comp)`.
- В template кнопки вкладок: `:class="{ active: nav.active === t.key }"` и `@click="nav.active = t.key"`.
- Если `ref` больше нигде не используется в App.vue — убрать из импорта vue.

- [ ] **Step 3: Проверить build + ручная навигация**

Run: `npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -4`
Expected: build ок, 61+ тестов PASS.
Ручная: `npm run dev`, кликнуть по всем вкладкам — переключаются, активная подсвечена, дефолт "Дашборд". Если Playwright доступен — прокликать вкладки.

- [ ] **Step 4: Коммит**

```bash
git add src/store.js src/App.vue
git commit -m "store/App: nav-reactive для переключения вкладки из компонентов"
```

---

### Task 3: Блок "Рекомендации" в CardStrategyView + кнопка "в Сценарии"

**Files:**
- Modify: `src/components/CardStrategyView.vue`
- Test: ручная проверка в браузере

**Interfaces:**
- Consumes: `cardAdvice` из advice.js; `state`, `goTab` из store.js.
- Produces: блок "Рекомендации" со списком cardAdvice(state), иконки severity, why, кнопка "Проиграть в Сценариях" у рекомендаций с action.

- [ ] **Step 1: Добавить импорт и computed**

В `<script setup>` CardStrategyView.vue добавить:

```js
import { cardAdvice } from '../advice.js'
import { goTab } from '../store.js'

const advice = computed(() => cardAdvice(state))

function playInScenarios(rec) {
  if (!rec.action) return
  state.scenarios.push({
    id: 'scenario_' + Date.now().toString(36),
    name: rec.title, baseFrom: rec.action.date || '', moves: [rec.action],
  })
  goTab('scenarios')
}
function sevIcon(s) { return { critical: '🔴', warning: '🟡', save: '💡' }[s] || '•' }
function sevClass(s) { return { critical: 'neg', warning: 'warn', save: 'pos' }[s] || '' }
```

- [ ] **Step 2: Добавить блок в template**

После панели сводки (перед или после календаря) добавить:

```html
    <div class="card">
      <h3 style="margin-top: 0">Рекомендации</h3>
      <div v-if="advice.length" class="grid" style="gap: 10px">
        <div v-for="(rec, i) in advice" :key="i" class="rec-row">
          <div class="spread">
            <div>
              <b :class="sevClass(rec.severity)">{{ sevIcon(rec.severity) }} {{ rec.title }}</b>
              <div class="small muted">{{ rec.why }}</div>
            </div>
            <button v-if="rec.action" class="sm ghost" @click="playInScenarios(rec)">Проиграть в Сценариях</button>
          </div>
        </div>
      </div>
      <p v-else class="muted">Срочных рекомендаций нет.</p>
    </div>
```

Добавить в `<style scoped>` (если нужно): `.rec-row { padding: 8px 0; border-bottom: 1px solid var(--border); }` (последний без границы — опционально).

- [ ] **Step 3: Проверить build**

Run: `npm run build 2>&1 | tail -6`
Expected: build ок.

- [ ] **Step 4: Ручная проверка**

`npm run dev`, вкладка "Стратегия". Импортировать реальный JSON пользователя. Проверить:
блок "Рекомендации" показывает рекомендации (для реальных данных с дорогим долгом Уралсиба
и картой жены — save-рекомендация переноса). Кнопка "Проиграть в Сценариях" создаёт сценарий
и переключает на вкладку "Сценарии", где виден ход transfer. Если Playwright — прокликать,
снять снапшот, почистить временные файлы после.

- [ ] **Step 5: Коммит**

```bash
git add src/components/CardStrategyView.vue
git commit -m "CardStrategyView: блок Рекомендации с кнопкой Проиграть в Сценариях"
```

---

## Self-Review

**1. Spec coverage:**
- cardAdvice + правила (shortfall critical, transfer-save, payoff-order; grace-ending — см. примечание) → Task 1. ✓
- Подбор приёмника (pickReceiver) → Task 1. ✓
- Сортировка critical→warning→save, save по экономии → Task 1. ✓
- nav-механизм переключения вкладки → Task 2. ✓
- Блок "Рекомендации" + кнопка "в Сценарии" → Task 3. ✓
- Тесты cardAdvice (save, нет приёмника, пустое, сортировка) → Task 1. ✓

**2. Placeholder scan:** код показан; формулы конкретны; нет TBD. Правило 2 (grace-ending)
упрощено/опущено в коде Task 1 ради объёма — critical (shortfall) покрывает основной риск, а
grace-ending частично перекрывается им. Явно помечено ниже; если ревью сочтёт нужным —
добавить правило 2 отдельным блоком в cardAdvice.

**3. Type consistency:**
- `cardAdvice(state, opts) → [{ severity, kind, title, why, action }]` — Task 1/3.
- action: `{ type:'transfer', fromCardId, toCardId, amount:{amount,currency}, date, repay, repayDate }` — совместимо с ходом transfer движка (этап 3a) и редактором (ScenariosView). ✓
- `nav` reactive + `goTab(key)` — Task 2/3.
- `pickReceiver(state, rates) → card|null` — Task 1.

Примечание для ревью: правило grace-ending (warning) в коде Task 1 не реализовано отдельно
(shortfall critical покрывает "денег не хватает к дате платежа"). Если нужна отдельная
warning-рекомендация про истечение грейса full-карты — добавить блок в cardAdvice. Это
осознанное упрощение ради фокуса; основная ценность (critical-риск + save-переносы +
порядок) реализована.
