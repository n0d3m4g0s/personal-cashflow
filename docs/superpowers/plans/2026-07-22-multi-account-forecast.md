# Раздельные счета в прогнозе - план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ввести раздельные счета (каждый в своей валюте, со своим стартовым капиталом и буфером) так, чтобы прогноз показывал общий остаток И раздельные просадки по каждому счёту с посчётными алертами.

**Architecture:** Счета - первоклассная сущность в чистом ядре `finance.js`. `buildForecast` считает общий баланс (в RUB, как сейчас) плюс `perAccount[]` - отдельные дорожки в валюте каждого счёта. Записи (income/expense/loan) ссылаются на счёт через `accountId`. Vue-компоненты остаются тонкими. Миграция создаёт один RUB-счёт "Основной" и привязывает к нему старые записи.

**Tech Stack:** Vue 3 + Vite, чистый Node для тестов (`node --test`), без сторонних либ. Мультивалюта через `src/money.js`.

## Global Constraints

- Комментарии и весь UI-текст на русском. Прямые кавычки `"..."`, без длинных/средних тире (`-`/`-`) в НОВОМ коде - только дефис `-`.
- Даты локальные без сдвига TZ: `parseDate`/`fmtISO`/`addMonths`/`addDays`. Никакого `toISOString` в проде.
- Любую денежную величину записи держать как `{ amount, currency }`, конвертировать в рубли только в точке расчёта. Разные валюты не складывать напрямую.
- `startingBalance` и `safetyBuffer` СЧЁТА - это ЧИСЛА в валюте счёта (не `{amount,currency}`), т.к. валюта задана полем `account.currency`.
- Направление зависимостей: `advice.js -> scenarios.js -> finance.js -> money.js`. finance.js НЕ импортирует scenarios.js.
- Новая логика - чистой функцией в `finance.js` + тест в `test/finance.test.js`. Компоненты не тестируются.
- Ставки apr - доля. Проценты за период: `apr * сумма * дни/365`.
- Запуск тестов: `npm test`. Отдельный тест: `node --test --test-name-pattern '<pattern>'`.
- Курсы `rates` = сколько единиц валюты в 1 рубле (`amdPerRub`, `usdPerRub`). Конвертация между валютами - `convert(amount, from, to, rates)` из money.js.

---

## Файловая структура

- `src/finance.js` (Modify) - `buildForecast` учится считать `perAccount[]`; события получают `accountId`.
- `src/store.js` (Modify) - `migrate()` создаёт "Основной" счёт и проставляет `accountId`; CRUD получает `account`; удаление счёта обнуляет ссылки.
- `src/seed.js` (Modify) - префилл со счётом "Основной" и `accountId` у записей.
- `src/components/AccountsView.vue` (Create) - CRUD-вкладка счетов.
- `src/components/IncomeView.vue`, `ExpensesView.vue`, `LoansView.vue` (Modify) - селектор счёта в форме.
- `src/components/ForecastView.vue` (Modify) - переключатель "Все счета / <счёт>".
- `src/components/Dashboard.vue` (Modify) - карточки счетов + посчётные алерты.
- `src/components/SettingsView.vue` (Modify) - убрать общий остаток/буфер из параметров прогноза.
- `src/App.vue` (Modify) - регистрация вкладки "Счета".
- `test/finance.test.js` (Modify) - тесты `perAccount`, конвертации, алертов, регрессии миграции.

---

## Task 1: Движок - `buildForecast` считает `perAccount[]`

**Files:**
- Modify: `src/finance.js:337-450` (функция `buildForecast`)
- Modify: `src/finance.js:345-404` (генерация событий - добавить `accountId` в meta)
- Test: `test/finance.test.js`

**Interfaces:**
- Consumes: `moneyToRub`, `convert` из `money.js`; `parseDate`, `addMonths`, `today`, `fmtISO`, `expandSchedule` (уже в файле).
- Produces: `buildForecast(state, opts)` дополнительно возвращает `perAccount: Array<{ account, currency, startingBalance, days, alerts, minBalance, minBalanceDate, endBalance, buffer }>`. Каждое событие в `events` получает поле `accountId` (string | null). Общие поля (`days/alerts/minBalance/minBalanceDate/endBalance/start/end/events`) сохраняются.

Модель:
- Общий стартовый остаток = сумма по счетам `sum(account.startingBalance -> в RUB через convert(currency->RUB))`. Записи без счёта в общий старт не добавляют (у них нет своего стартового капитала - стартовый капитал только у счетов).
- Каждое событие несёт `accountId` из породившей записи (`inc.accountId` / `ex.accountId` / `loan.accountId`); карты дают `accountId: null`.
- `perAccount` строится по `state.accounts` (пропускаем `disabled`). Для счёта: старт = `account.startingBalance`; берём события с `e.accountId === account.id`; нативную сумму события конвертируем в валюту счёта; нарастающий остаток; алерт при `balance < account.safetyBuffer`, флаг `belowZero` при `balance < 0`.
- Общий `alerts` = объединение посчётных алертов (каждый с `accountId`, `accountName`, `shortfall` в валюте счёта, `currency`).

Важно: нативную сумму события нужно знать в per-account расчёте. Сейчас в `events` кладётся `native: { amount, currency }` только для income/expense. Добавить `native` также для loan и card, чтобы конвертация в валюту счёта работала единообразно. Для per-account используем `convert(e.native.amount, e.native.currency, account.currency, rates)` со знаком `e.amount` (знак берём по `Math.sign(e.amount)`; для дохода +, расхода/кредита/карты -).

- [ ] **Step 1: Написать падающий тест на perAccount в разных валютах**

Добавить в конец `test/finance.test.js`:

```javascript
test('buildForecast: perAccount раздельные остатки в своих валютах', () => {
  const state = {
    settings: { rates: { amdPerRub: 4, usdPerRub: 0.01 }, horizonMonths: 2 },
    accounts: [
      { id: 'acc_rub', name: 'Основной', currency: 'RUB', startingBalance: 100000, safetyBuffer: 0 },
      { id: 'acc_usd', name: 'Долларовый', currency: 'USD', startingBalance: 500, safetyBuffer: 0 },
    ],
    incomes: [],
    expenses: [
      { id: 'e1', name: 'Аренда USD', amount: 300, currency: 'USD', accountId: 'acc_usd',
        schedule: { frequency: 'once', startDate: '2026-07-25' } },
      { id: 'e2', name: 'Продукты RUB', amount: 10000, currency: 'RUB', accountId: 'acc_rub',
        schedule: { frequency: 'once', startDate: '2026-07-25' } },
    ],
    loans: [], cards: [], goals: [],
  }
  const f = buildForecast(state, { from: '2026-07-22' })
  const usd = f.perAccount.find((a) => a.account.id === 'acc_usd')
  const rub = f.perAccount.find((a) => a.account.id === 'acc_rub')
  assert.equal(usd.endBalance, 200)   // 500 - 300 в долларах
  assert.equal(usd.currency, 'USD')
  assert.equal(rub.endBalance, 90000) // 100000 - 10000 в рублях
})
```

- [ ] **Step 2: Запустить тест - убедиться, что падает**

Run: `node --test --test-name-pattern 'perAccount раздельные' test/finance.test.js`
Expected: FAIL (`f.perAccount` undefined -> `.find` бросает TypeError).

- [ ] **Step 3: Добавить accountId и native ко всем событиям**

В `src/finance.js` в `buildForecast` в блоках генерации событий добавить `accountId` и `native`:

Доходы (было `add(d, +rub, 'income', inc.name, { owner: inc.owner, native: {...} })`):
```javascript
      add(d, +rub, 'income', inc.name, { owner: inc.owner, accountId: inc.accountId ?? null, native: { amount: inc.amount, currency: inc.currency } })
```

Расходы:
```javascript
      add(d, -rub, 'expense', ex.name, { owner: ex.owner, category: ex.category, accountId: ex.accountId ?? null, native: { amount: ex.amount, currency: ex.currency } })
```

Кредиты (добавить accountId и native):
```javascript
      add(d, -pay, 'loan', loan.name, { owner: loan.owner, accountId: loan.accountId ?? null, native: { amount: loan.amount, currency: loan.currency } })
```

Карты - оба вызова `add(...)` (full и minimum) получают `accountId: null` в meta:
```javascript
      add(due, -debt, 'card', `${card.name} (полное)`, {
        owner: card.owner, bank: card.bank, statementDate: statement, graceDate: graceEnd,
        strategy: 'full', minPayment: cardMinPayment(card, rates), fullPayment: debt, accountId: null,
      })
```
```javascript
        add(p.date, -p.amount, 'card', `${card.name} (минимум)`, {
          owner: card.owner, bank: card.bank, statementDate: statement, graceDate: graceEnd,
          strategy: 'minimum', remainingAfter: p.remainingAfter, interest: p.interest, accountId: null,
        })
```

- [ ] **Step 4: Заменить стартовый остаток и добавить расчёт perAccount**

В `src/finance.js` в `buildForecast` заменить блок стартового остатка. Было:
```javascript
  const startingCash = moneyToRub(state.settings.startingCash, rates)
  let balance = startingCash
```
Стало (импорт `convert` уже есть? добавить в import из money.js):
```javascript
  // Общий стартовый остаток - сумма стартовых остатков счетов, сведённых в рубли.
  const accounts = (state.accounts || []).filter((a) => !a.disabled)
  const startingCash = accounts.reduce(
    (s, a) => s + convert(Number(a.startingBalance) || 0, a.currency || 'RUB', 'RUB', rates), 0)
  let balance = startingCash
```

В начале файла обновить импорт:
```javascript
import { moneyToRub, convert } from './money.js'
```

Перед `return { ... }` в конце `buildForecast` добавить расчёт per-account (до формирования monthly или после - неважно, но до return):
```javascript
  // Раздельные дорожки по счетам (каждая в валюте своего счёта).
  const perAccount = accounts.map((account) => {
    const cur = account.currency || 'RUB'
    let bal = Number(account.startingBalance) || 0
    const accBuffer = Number(account.safetyBuffer) || 0
    const accDays = []
    const accAlerts = []
    let accMin = bal
    let accMinDate = start
    const accByDate = new Map()
    for (const e of events) {
      if (e.accountId !== account.id) continue
      const key = fmtISO(e.date)
      if (!accByDate.has(key)) accByDate.set(key, [])
      accByDate.get(key).push(e)
    }
    for (const [key, evs] of accByDate) {
      // конвертируем нативную сумму каждого события в валюту счёта, сохраняя знак
      const dayTotal = evs.reduce((s, e) => {
        const nativeAmt = e.native ? (Number(e.native.amount) || 0) : Math.abs(e.amount)
        const nativeCur = e.native ? (e.native.currency || 'RUB') : 'RUB'
        const inAcc = convert(nativeAmt, nativeCur, cur, rates)
        return s + (e.amount >= 0 ? inAcc : -inAcc)
      }, 0)
      bal += dayTotal
      const d = parseDate(key)
      accDays.push({ date: d, events: evs, dayTotal, balance: bal })
      if (bal < accMin) { accMin = bal; accMinDate = d }
      if (bal < accBuffer) {
        accAlerts.push({ date: d, balance: bal, shortfall: accBuffer - bal, belowZero: bal < 0,
          buffer: accBuffer, accountId: account.id, accountName: account.name, currency: cur })
      }
    }
    return { account, currency: cur, startingBalance: Number(account.startingBalance) || 0,
      days: accDays, alerts: accAlerts, minBalance: accMin, minBalanceDate: accMinDate,
      endBalance: bal, buffer: accBuffer }
  })
```

Заменить старый общий `alerts` (по buffer из settings) на объединение посчётных. Найти блок формирования общих `alerts` внутри цикла `for (const [key, evs] of byDate)`:
```javascript
    if (balance < buffer) {
      alerts.push({ date: d, balance, shortfall: buffer - balance, belowZero: balance < 0, buffer })
    }
```
Удалить его (общий alerts теперь собирается из perAccount). После построения `perAccount` собрать:
```javascript
  for (const pa of perAccount) alerts.push(...pa.alerts)
  alerts.sort((a, b) => a.date - b.date)
```
Строку `const buffer = moneyToRub(state.settings.safetyBuffer, rates)` оставить (используется как поле в return для совместимости), но она больше не участвует в алертах.

Добавить `perAccount` в объект return:
```javascript
  return {
    start, end, startingCash, buffer,
    events, days, alerts,
    minBalance, minBalanceDate,
    endBalance: balance,
    perAccount,
  }
```

- [ ] **Step 5: Запустить тест - убедиться, что проходит**

Run: `node --test --test-name-pattern 'perAccount раздельные' test/finance.test.js`
Expected: PASS

- [ ] **Step 6: Написать тест конвертации (расход в USD с рублёвого счёта)**

Добавить в `test/finance.test.js`:
```javascript
test('buildForecast: расход в USD списан с RUB-счёта конвертируется в рубли', () => {
  const state = {
    settings: { rates: { amdPerRub: 4, usdPerRub: 0.01 }, horizonMonths: 1 },
    accounts: [{ id: 'acc_rub', name: 'Основной', currency: 'RUB', startingBalance: 100000, safetyBuffer: 0 }],
    incomes: [],
    expenses: [
      { id: 'e1', name: 'iCloud USD', amount: 10, currency: 'USD', accountId: 'acc_rub',
        schedule: { frequency: 'once', startDate: '2026-07-25' } },
    ],
    loans: [], cards: [], goals: [],
  }
  const f = buildForecast(state, { from: '2026-07-22' })
  const rub = f.perAccount.find((a) => a.account.id === 'acc_rub')
  // 10 USD при usdPerRub=0.01 -> 1000 руб; 100000 - 1000 = 99000
  assert.equal(rub.endBalance, 99000)
})
```

- [ ] **Step 7: Запустить - должен пройти (логика уже есть)**

Run: `node --test --test-name-pattern 'расход в USD списан' test/finance.test.js`
Expected: PASS

- [ ] **Step 8: Написать тест посчётного алерта (минус при плюсовом общем)**

```javascript
test('buildForecast: посчётный алерт на минус долларового при плюсовом общем', () => {
  const state = {
    settings: { rates: { amdPerRub: 4, usdPerRub: 0.01 }, horizonMonths: 1 },
    accounts: [
      { id: 'acc_rub', name: 'Основной', currency: 'RUB', startingBalance: 500000, safetyBuffer: 0 },
      { id: 'acc_usd', name: 'Долларовый', currency: 'USD', startingBalance: 100, safetyBuffer: 0 },
    ],
    incomes: [],
    expenses: [
      { id: 'e1', name: 'Аренда USD', amount: 300, currency: 'USD', accountId: 'acc_usd',
        schedule: { frequency: 'once', startDate: '2026-07-25' } },
    ],
    loans: [], cards: [], goals: [],
  }
  const f = buildForecast(state, { from: '2026-07-22' })
  // общий остаток плюсовой: 500000 + 100/0.01(=10000) - 300/0.01(=30000) = 480000
  assert.ok(f.endBalance > 0)
  // но долларовый ушёл в минус -> есть алерт с belowZero и accountId
  const usdAlert = f.alerts.find((a) => a.accountId === 'acc_usd')
  assert.ok(usdAlert)
  assert.equal(usdAlert.belowZero, true)
  assert.equal(usdAlert.currency, 'USD')
})
```

- [ ] **Step 9: Запустить - должен пройти**

Run: `node --test --test-name-pattern 'посчётный алерт' test/finance.test.js`
Expected: PASS

- [ ] **Step 10: Прогнать весь набор тестов (регрессия)**

Run: `npm test`
Expected: все PASS. Если старые тесты `buildForecast`/`computeGoals` падают из-за отсутствия `accounts`/`startingCash` - это ожидаемо только если они полагались на `settings.startingCash`. Проверить и при необходимости в этих тестах добавить `accounts: [{ id:'a', currency:'RUB', startingBalance:<прежний startingCash>, safetyBuffer:<прежний buffer> }]` и проставить `accountId:'a'` записям. НЕ менять смысл теста, только источник стартового капитала.

- [ ] **Step 11: Commit**

```bash
git add src/finance.js test/finance.test.js
git commit -m "Движок прогноза: perAccount дорожки и посчётные алерты"
```

---

## Task 2: Стор - миграция, CRUD, seed

**Files:**
- Modify: `src/store.js:52-64` (`migrate`), `src/store.js:89-97` (`collectionFor`), `src/store.js:106-110` (`removeItem`), `src/store.js:142-156` (`clearAll`)
- Modify: `src/seed.js:40-168`
- Test: `test/finance.test.js`

**Interfaces:**
- Consumes: `newId` (в store.js), `buildForecast` из finance (для теста).
- Produces: `migrate(s)` гарантирует непустой `s.accounts` (минимум счёт "Основной" RUB) и проставляет `accountId` записям income/expense/loan. `collectionFor('account')` -> `state.accounts`. `removeItem('account', id)` обнуляет `accountId` у ссылающихся записей. `makeSeed()` возвращает state с `accounts` и `accountId` у записей.

- [ ] **Step 1: Написать падающий тест миграции**

Добавить в `test/finance.test.js` (импорт `migrateCard` уже есть; добавить импорт `migrate` не нужен - он не экспортируется; тестируем через отдельный экспорт). Сначала сделать `migrate` экспортируемым: в этом шаге пишем тест, ожидая экспорт.

```javascript
test('migrate: создаёт Основной счёт и проставляет accountId', async () => {
  const { migrate } = await import('../src/store.js')
  const s = migrate({
    settings: { startingCash: { amount: 622500, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' } },
    incomes: [{ id: 'i1', name: 'ЗП', amount: 100, currency: 'RUB', schedule: { frequency: 'once', startDate: '2026-07-25' } }],
    expenses: [{ id: 'e1', name: 'Еда', amount: 50, currency: 'RUB', schedule: { frequency: 'once', startDate: '2026-07-25' } }],
    loans: [{ id: 'l1', name: 'Кредит', amount: 10, currency: 'RUB', paymentDay: 10, remainingBalance: { amount: 0, currency: 'RUB' } }],
    cards: [], goals: [], scenarios: [],
  })
  assert.ok(Array.isArray(s.accounts) && s.accounts.length >= 1)
  const main = s.accounts[0]
  assert.equal(main.currency, 'RUB')
  assert.equal(main.startingBalance, 622500)
  assert.equal(main.safetyBuffer, 50000)
  assert.equal(s.incomes[0].accountId, main.id)
  assert.equal(s.expenses[0].accountId, main.id)
  assert.equal(s.loans[0].accountId, main.id)
})
```

- [ ] **Step 2: Запустить - убедиться, что падает**

Run: `node --test --test-name-pattern 'создаёт Основной счёт' test/finance.test.js`
Expected: FAIL (`migrate` не экспортирован / `s.accounts` undefined).

- [ ] **Step 3: Реализовать миграцию счетов в store.js**

В `src/store.js` сделать `migrate` экспортируемой и добавить блок счетов. Заменить сигнатуру `function migrate(s) {` на `export function migrate(s) {`. Внутри, после цикла инициализации массивов (после `s.cards = (s.cards || []).map((c) => migrateCard(c))`), добавить перед `return s`:

```javascript
  // Счета: гарантируем минимум один "Основной" RUB со стартовым капиталом из settings.
  if (!Array.isArray(s.accounts)) s.accounts = []
  if (s.accounts.length === 0) {
    const startAmt = Number(s.settings.startingCash?.amount) || 0
    const bufAmt = Number(s.settings.safetyBuffer?.amount) || 0
    s.accounts.push({
      id: newId('acc'), name: 'Основной', currency: 'RUB',
      startingBalance: startAmt, safetyBuffer: bufAmt, note: '', disabled: false,
    })
  }
  // нормализация полей счёта (на случай частичных данных)
  s.accounts = s.accounts.map((a) => ({
    id: a.id || newId('acc'),
    name: a.name || 'Счёт',
    currency: a.currency || 'RUB',
    startingBalance: Number(a.startingBalance) || 0,
    safetyBuffer: Number(a.safetyBuffer) || 0,
    note: a.note || '',
    disabled: !!a.disabled,
  }))
  // Записи без accountId привязываем к первому счёту.
  const mainId = s.accounts[0].id
  for (const k of ['incomes', 'expenses', 'loans']) {
    for (const rec of s[k]) {
      if (rec.accountId == null) rec.accountId = mainId
    }
  }
```

- [ ] **Step 4: Добавить account в CRUD и очистку**

В `src/store.js` в `collectionFor` добавить строку:
```javascript
    account: state.accounts,
```
(внутри возвращаемого объекта, рядом с `goal: state.goals,`).

В `removeItem` добавить обнуление ссылок ПЕРЕД splice. Заменить тело `removeItem`:
```javascript
export function removeItem(kind, id) {
  const list = collectionFor(kind)
  const i = list.findIndex((x) => x.id === id)
  if (i >= 0) list.splice(i, 1)
  if (kind === 'account') {
    // записи, ссылавшиеся на удалённый счёт, становятся "без счёта"
    for (const k of ['incomes', 'expenses', 'loans']) {
      for (const rec of state[k]) if (rec.accountId === id) rec.accountId = null
    }
  }
}
```

В `clearAll` в объект `empty` добавить `accounts: []`:
```javascript
    incomes: [], expenses: [], loans: [], cards: [], goals: [], scenarios: [], accounts: [],
```

- [ ] **Step 5: Запустить тест миграции - должен пройти**

Run: `node --test --test-name-pattern 'создаёт Основной счёт' test/finance.test.js`
Expected: PASS

- [ ] **Step 6: Обновить seed.js - счёт и accountId у записей**

В `src/seed.js` в `makeSeed()` добавить создание счёта и проставить `accountId`. В начале функции (после создания `wifeCard`) добавить:
```javascript
  const mainAccountId = id('acc')
```
В возвращаемом объекте добавить массив `accounts` (например перед `incomes`):
```javascript
    accounts: [
      { id: mainAccountId, name: 'Основной', currency: 'RUB', startingBalance: 150000, safetyBuffer: 50000, note: '', disabled: false },
    ],
```
Проставить `accountId: mainAccountId` в хелперах `expense`, во всех объектах incomes/loans. Проще: в хелперах и объектах добавить поле. В функции `expense` (низ файла) добавить `accountId: mainAccountId` - но у неё нет доступа к переменной. Решение: после сборки объекта seed, перед return, проставить массово:
```javascript
  // единый дефолтный счёт для всех сид-записей
  // (делается тут, чтобы не тащить mainAccountId в каждый хелпер)
```
Вместо ручной правки каждого объекта, добавить перед `return {` невозможно (return первый). Поэтому: собрать результат в переменную `const seed = { ... }`, затем прогнать:
```javascript
  for (const k of ['incomes', 'expenses', 'loans']) {
    for (const rec of seed[k]) rec.accountId = mainAccountId
  }
  return seed
```
То есть: заменить `return {` на `const seed = {`, добавить `accounts` в объект, после объекта - цикл проставления и `return seed`.

- [ ] **Step 7: Написать тест - seed согласован (все записи имеют accountId существующего счёта)**

```javascript
test('makeSeed: все записи привязаны к существующему счёту', async () => {
  const { makeSeed } = await import('../src/seed.js')
  const s = makeSeed()
  assert.ok(s.accounts.length >= 1)
  const ids = new Set(s.accounts.map((a) => a.id))
  for (const k of ['incomes', 'expenses', 'loans']) {
    for (const rec of s[k]) assert.ok(ids.has(rec.accountId), `${k} ${rec.id} без счёта`)
  }
})
```

- [ ] **Step 8: Запустить - должен пройти**

Run: `node --test --test-name-pattern 'все записи привязаны' test/finance.test.js`
Expected: PASS

- [ ] **Step 9: Прогнать весь набор**

Run: `npm test`
Expected: все PASS.

- [ ] **Step 10: Commit**

```bash
git add src/store.js src/seed.js test/finance.test.js
git commit -m "Стор: миграция на счета, CRUD account, seed со счётом"
```

---

## Task 3: Вкладка "Счета" (AccountsView) + регистрация в App

**Files:**
- Create: `src/components/AccountsView.vue`
- Modify: `src/App.vue:5-14` (импорт), `src/App.vue:16-27` (tabs)
- Test: ручная проверка `npm run dev`

**Interfaces:**
- Consumes: `state`, `addItem`, `removeItem` из store.js; `CURRENCIES`, `CURRENCY_META`, `formatMoney` из money.js.
- Produces: компонент вкладки; регистрируется в `App.vue` под ключом `accounts`.

- [ ] **Step 1: Создать AccountsView.vue**

Создать `src/components/AccountsView.vue`:
```vue
<script setup>
import { ref } from 'vue'
import { state, addItem, removeItem } from '../store.js'
import { CURRENCIES, CURRENCY_META, formatMoney } from '../money.js'

const editing = ref(null)
function blank() {
  return { name: '', currency: 'RUB', startingBalance: 0, safetyBuffer: 0, note: '', disabled: false }
}
function openNew() { editing.value = blank() }
function openEdit(x) { editing.value = JSON.parse(JSON.stringify(x)) }
function save() {
  const x = editing.value
  if (!x.name.trim()) x.name = 'Счёт'
  x.startingBalance = Number(x.startingBalance) || 0
  x.safetyBuffer = Number(x.safetyBuffer) || 0
  if (x.id) { const i = state.accounts.findIndex((y) => y.id === x.id); if (i >= 0) state.accounts[i] = x }
  else addItem('account', x)
  editing.value = null
}
function del(id) {
  if (confirm('Удалить счёт? Записи, привязанные к нему, станут "без счёта".')) removeItem('account', id)
}
function sym(cur) { return CURRENCY_META[cur]?.symbol || cur }
</script>

<template>
  <div class="grid" style="gap: 14px">
    <div class="spread">
      <div>
        <h2 style="margin: 0">Счета</h2>
        <div class="small muted">Каждый счёт в своей валюте, со своим стартовым остатком и буфером. Прогноз считает раздельные просадки.</div>
      </div>
      <button class="primary" @click="openNew">+ Добавить счёт</button>
    </div>

    <table class="card" style="display: table">
      <thead><tr><th>Название</th><th>Валюта</th><th>Стартовый остаток</th><th>Буфер</th><th></th></tr></thead>
      <tbody>
        <tr v-for="a in state.accounts" :key="a.id" :class="{ off: a.disabled }">
          <td>{{ a.name }} <span v-if="a.disabled" class="pill">выкл.</span>
            <div v-if="a.note" class="small muted">{{ a.note }}</div>
          </td>
          <td>{{ sym(a.currency) }} {{ a.currency }}</td>
          <td class="mono">{{ formatMoney(a.startingBalance, a.currency) }}</td>
          <td class="mono">{{ formatMoney(a.safetyBuffer, a.currency) }}</td>
          <td class="nowrap">
            <button class="sm ghost" @click="openEdit(a)">Изм.</button>
            <button class="sm danger" @click="del(a.id)">Удл.</button>
          </td>
        </tr>
        <tr v-if="!state.accounts.length"><td colspan="5" class="muted">Счетов нет</td></tr>
      </tbody>
    </table>

    <div v-if="editing" class="overlay" @click.self="editing = null">
      <div class="modal grid" style="gap: 12px">
        <h2 style="margin: 0">{{ editing.id ? 'Изменить счёт' : 'Новый счёт' }}</h2>
        <div class="field"><label>Название</label><input v-model="editing.name" placeholder="Основной / Долларовый" /></div>
        <div class="row">
          <div style="flex: 1"><label>Валюта</label>
            <select v-model="editing.currency"><option v-for="c in CURRENCIES" :key="c" :value="c">{{ sym(c) }} {{ c }}</option></select>
          </div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Стартовый остаток ({{ sym(editing.currency) }})</label>
            <input type="number" step="0.01" v-model.number="editing.startingBalance" />
          </div>
          <div style="flex: 1"><label>Буфер ({{ sym(editing.currency) }})</label>
            <input type="number" step="0.01" v-model.number="editing.safetyBuffer" />
          </div>
        </div>
        <div class="field"><label><input type="checkbox" style="width: auto" v-model="editing.disabled" /> выключить</label></div>
        <div class="field"><label>Заметка</label><input v-model="editing.note" /></div>
        <div class="row" style="justify-content: flex-end">
          <button class="ghost" @click="editing = null">Отмена</button>
          <button class="primary" @click="save">Сохранить</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
tr.off { opacity: 0.5; }
</style>
```

- [ ] **Step 2: Зарегистрировать вкладку в App.vue**

В `src/App.vue` добавить импорт после строки 12 (`import ExpensesView...`):
```javascript
import AccountsView from './components/AccountsView.vue'
```
В массив `tabs` добавить запись сразу после `settings` НЕ подходит по смыслу - вставить перед `income` (счета логически рядом с деньгами). Добавить между строкой `loans` (23) и `income` (24):
```javascript
  { key: 'accounts', label: 'Счета', icon: '🏦', comp: AccountsView },
```
(иконку кредитов `loans` при желании поменять, но не обязательно - дубль иконки некритичен; чтобы избежать дубля, для accounts использовать '👛').
Итог - строка: `  { key: 'accounts', label: 'Счета', icon: '👛', comp: AccountsView },`

- [ ] **Step 3: Проверить сборку**

Run: `npm run build`
Expected: сборка без ошибок (dist создан).

- [ ] **Step 4: Ручная проверка dev**

Run: `npm run dev` (в фоне), открыть http://localhost:5173, вкладка "Счета": добавить USD-счёт, сохранить, отредактировать, удалить. Убедиться, что таблица обновляется.

- [ ] **Step 5: Commit**

```bash
git add src/components/AccountsView.vue src/App.vue
git commit -m "UI: вкладка Счета (CRUD) и регистрация в навигации"
```

---

## Task 4: Селектор счёта в формах доходов/расходов/кредитов

**Files:**
- Modify: `src/components/IncomeView.vue:18-21` (blank), форма (~72-78)
- Modify: `src/components/ExpensesView.vue:18` (blank), форма (~97-101)
- Modify: `src/components/LoansView.vue:12-14` (blank), форма (~68-72)
- Test: ручная проверка

**Interfaces:**
- Consumes: `state.accounts`.
- Produces: формы записывают `editing.accountId`. В `blank()` дефолт - id первого счёта.

- [ ] **Step 1: IncomeView - дефолт accountId в blank и селектор в форме**

В `src/components/IncomeView.vue` в `blank()` добавить `accountId`:
```javascript
function blank() {
  return { name: '', owner: 'husband', type: 'salary', amount: 0, currency: 'RUB', accountId: state.accounts[0]?.id ?? null,
    schedule: { frequency: 'monthly', interval: 1, startDate: todayISO(), endDate: null }, disabled: false, note: '' }
}
```
В форме, в блоке `<div class="row">` с "Владелец"/"Тип" (строки ~71-78), добавить третий селектор счёта. Заменить весь этот `<div class="row">...</div>` на:
```html
        <div class="row">
          <div style="flex: 1"><label>Владелец</label>
            <select v-model="editing.owner"><option v-for="o in OWNERS" :key="o.value" :value="o.value">{{ o.label }}</option></select>
          </div>
          <div style="flex: 1"><label>Счёт</label>
            <select v-model="editing.accountId"><option v-for="a in state.accounts" :key="a.id" :value="a.id">{{ a.name }} ({{ a.currency }})</option></select>
          </div>
          <div style="flex: 1"><label>Тип</label>
            <select v-model="editing.type"><option value="salary">Зарплата</option><option value="freelance">Фриланс</option><option value="other">Другое</option></select>
          </div>
        </div>
```

- [ ] **Step 2: ExpensesView - дефолт accountId и селектор**

В `src/components/ExpensesView.vue` в `blank()` добавить `accountId: state.accounts[0]?.id ?? null,` (в тот же объект, где `owner`).
В форме найти `<div class="row">` с селектором "Владелец" (строка ~99 - `<select v-model="editing.owner">`). Добавить рядом селектор счёта. Обернуть/дополнить так, чтобы в строке владельца появился второй `<div style="flex: 1">`:
```html
          <div style="flex: 1"><label>Счёт</label>
            <select v-model="editing.accountId"><option v-for="a in state.accounts" :key="a.id" :value="a.id">{{ a.name }} ({{ a.currency }})</option></select>
          </div>
```
Вставить сразу после закрывающего `</div>` блока владельца, внутри того же `<div class="row">`. (Открыть файл, найти точное место селектора owner и вставить блок счёта следом.)

- [ ] **Step 3: LoansView - дефолт accountId и селектор**

В `src/components/LoansView.vue` в `blank()` (строка 13) добавить `accountId`:
```javascript
  return { name: '', owner: 'husband', accountId: state.accounts[0]?.id ?? null, amount: 0, currency: 'RUB', paymentDay: 10, remainingBalance: { amount: 0, currency: 'RUB' }, disabled: false, note: '' }
```
В форме (строка ~70 - селектор owner) добавить селектор счёта в тот же ряд:
```html
          <div style="flex: 1"><label>Счёт списания</label>
            <select v-model="editing.accountId"><option v-for="a in state.accounts" :key="a.id" :value="a.id">{{ a.name }} ({{ a.currency }})</option></select>
          </div>
```
Вставить внутри `<div class="row">` после блока владельца.

- [ ] **Step 4: Проверить сборку**

Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 5: Ручная проверка**

Run: `npm run dev`. Создать доход/расход/кредит, выбрать счёт в форме, сохранить. Убедиться, что `accountId` сохраняется (экспорт JSON в Настройках -> проверить поле).

- [ ] **Step 6: Commit**

```bash
git add src/components/IncomeView.vue src/components/ExpensesView.vue src/components/LoansView.vue
git commit -m "UI: селектор счёта в формах доходов, расходов, кредитов"
```

---

## Task 5: ForecastView - переключатель счетов

**Files:**
- Modify: `src/components/ForecastView.vue` (весь `<script setup>` и `<template>`)
- Test: ручная проверка

**Interfaces:**
- Consumes: `buildForecast(state).perAccount`, `state.accounts`.
- Produces: реактив `selectedAccount` ('all' | account.id); при выборе счёта таблица берёт `days` из соответствующего `perAccount` и форматирует в валюте счёта.

- [ ] **Step 1: Переписать ForecastView с переключателем**

Заменить `<script setup>` в `src/components/ForecastView.vue`:
```javascript
import { computed, ref } from 'vue'
import { state } from '../store.js'
import { buildForecast, fmtHuman, fmtMonthYear } from '../finance.js'
import { formatMoney, formatAllFromRub } from '../money.js'

const rates = computed(() => state.settings.rates)
const forecast = computed(() => buildForecast(state))
const selected = ref('all') // 'all' | account.id

// активная дорожка: 'all' -> общий (RUB), иначе perAccount выбранного счёта
const view = computed(() => {
  if (selected.value === 'all') {
    return { currency: 'RUB', days: forecast.value.days, startingBalance: forecast.value.startingCash,
      endBalance: forecast.value.endBalance, buffer: forecast.value.buffer, isAll: true }
  }
  const pa = forecast.value.perAccount.find((a) => a.account.id === selected.value)
  if (!pa) return { currency: 'RUB', days: [], startingBalance: 0, endBalance: 0, buffer: 0, isAll: false }
  return { currency: pa.currency, days: pa.days, startingBalance: pa.startingBalance,
    endBalance: pa.endBalance, buffer: pa.buffer, isAll: false }
})

function money(v) { return formatMoney(v, view.value.currency) }
function eq(rub) { return formatAllFromRub(rub, rates.value, { skip: ['RUB'] }) }
function sign(a) { return (a >= 0 ? '+' : '-') + formatMoney(Math.abs(a), view.value.currency) }
function kindIcon(k) { return { income: '💰', expense: '🧾', loan: '🏦', card: '💳' }[k] || '•' }

const grouped = computed(() => {
  const out = []
  let curKey = null
  for (const day of view.value.days) {
    const key = day.date.getFullYear() + '-' + day.date.getMonth()
    if (key !== curKey) { out.push({ month: fmtMonthYear(day.date), days: [] }); curKey = key }
    out[out.length - 1].days.push(day)
  }
  return out
})

function setHorizon(e) { state.settings.horizonMonths = +e.target.value }
```

Заменить `<template>`:
```html
  <div class="grid" style="gap: 14px">
    <div class="card spread">
      <div>
        <h2 style="margin: 0">Прогноз денежного потока</h2>
        <div class="small muted">
          Старт: {{ money(view.startingBalance) }} · итог к концу периода:
          <span class="mono" :class="view.endBalance >= view.buffer ? 'pos' : 'warn'">{{ money(view.endBalance) }}</span>
        </div>
      </div>
      <div class="row" style="gap: 10px">
        <div style="min-width: 160px">
          <label>Счёт</label>
          <select v-model="selected">
            <option value="all">Все счета (₽)</option>
            <option v-for="a in state.accounts" :key="a.id" :value="a.id">{{ a.name }} ({{ a.currency }})</option>
          </select>
        </div>
        <div style="min-width: 150px">
          <label>Горизонт</label>
          <select :value="state.settings.horizonMonths" @change="setHorizon">
            <option :value="3">3 месяца</option><option :value="6">6 месяцев</option>
            <option :value="12">12 месяцев</option><option :value="24">24 месяца</option>
          </select>
        </div>
      </div>
    </div>

    <div v-for="grp in grouped" :key="grp.month" class="card">
      <h3 style="text-transform: capitalize">{{ grp.month }}</h3>
      <table>
        <thead>
          <tr><th>Дата</th><th>Движения</th><th style="text-align: right">За день</th><th style="text-align: right">Остаток</th></tr>
        </thead>
        <tbody>
          <tr v-for="(day, i) in grp.days" :key="i" :class="{ danger: day.balance < view.buffer }">
            <td class="nowrap muted small">{{ fmtHuman(day.date) }}</td>
            <td>
              <div v-for="(e, j) in day.events" :key="j" class="ev">
                {{ kindIcon(e.kind) }} {{ e.title }}
                <span class="mono small" :class="e.amount >= 0 ? 'pos' : 'neg'">{{ sign(e.amount) }}</span>
              </div>
            </td>
            <td class="mono nowrap" :class="day.dayTotal >= 0 ? 'pos' : 'neg'" style="text-align: right">{{ sign(day.dayTotal) }}</td>
            <td class="mono nowrap" :class="day.balance < 0 ? 'neg' : (day.balance < view.buffer ? 'warn' : '')" style="text-align: right">
              {{ money(day.balance) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="!view.days.length" class="card muted">
      Нет запланированных движений в выбранном горизонте по этому счёту.
    </p>
  </div>
```

Примечание: в режиме "Все счета" `day.dayTotal`/`day.balance`/`e.amount` уже в рублях (общий уровень), `view.currency='RUB'` - форматирование корректно. В режиме счёта `perAccount.days` содержат `dayTotal`/`balance` уже в валюте счёта, а `e.amount` в событии - в рублях (общий знак), НО для отображения per-day суммы движения в валюте счёта нужен корректный `sign(e.amount)`. Поскольку `e.amount` в рублях, а `view.currency` - валюта счёта, строка движения покажет рублёвую сумму с символом чужой валюты. Чтобы это не вводило в заблуждение: в per-account режиме для строки события считать сумму в валюте счёта. Добавить в script функцию и использовать её в шаблоне вместо `sign(e.amount)`:

```javascript
import { convert } from '../money.js'
function evSign(e) {
  if (view.value.isAll) return sign(e.amount)
  const nativeAmt = e.native ? (Number(e.native.amount) || 0) : Math.abs(e.amount)
  const nativeCur = e.native ? (e.native.currency || 'RUB') : 'RUB'
  const inAcc = convert(nativeAmt, nativeCur, view.value.currency, rates.value)
  const signed = e.amount >= 0 ? inAcc : -inAcc
  return (signed >= 0 ? '+' : '-') + formatMoney(Math.abs(signed), view.value.currency)
}
```
В шаблоне заменить `{{ sign(e.amount) }}` на `{{ evSign(e) }}` и класс `e.amount >= 0 ? 'pos' : 'neg'` оставить (знак совпадает).

- [ ] **Step 2: Проверить сборку**

Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 3: Ручная проверка**

Run: `npm run dev`. На вкладке "Прогноз" переключить "Все счета" -> USD-счёт: таблица показывает движения и остаток в долларах, дни просадки видны. Вернуть "Все счета" - общий вид в рублях.

- [ ] **Step 4: Commit**

```bash
git add src/components/ForecastView.vue
git commit -m "UI: переключатель счетов в прогнозе, остаток в валюте счёта"
```

---

## Task 6: Dashboard - карточки счетов и посчётные алерты

**Files:**
- Modify: `src/components/Dashboard.vue` (`<script setup>` + шаблон карточек и алертов)
- Test: ручная проверка

**Interfaces:**
- Consumes: `forecast.perAccount`, `forecast.alerts` (теперь с `accountName`/`currency`/`shortfall` в валюте счёта).
- Produces: ряд карточек по счетам; блок "Кассовые разрывы" показывает имя счёта и валюту.

- [ ] **Step 1: Dashboard - карточки счетов**

В `src/components/Dashboard.vue` в `<script setup>` добавить после `const goals = ...`:
```javascript
const perAccount = computed(() => forecast.value.perAccount || [])
function moneyIn(v, cur) { return formatMoney(v, cur) }
```
(`formatMoney` уже импортирован.)

В шаблоне после `<section class="grid summary">...</section>` (закрытие блока сводки, ~строка 50) добавить блок карточек счетов:
```html
    <section v-if="perAccount.length" class="grid summary">
      <div v-for="pa in perAccount" :key="pa.account.id" class="card stat">
        <div class="muted small">{{ pa.account.name }} ({{ pa.currency }})</div>
        <div class="big mono" :class="pa.minBalance < pa.buffer ? 'warn' : 'pos'">{{ moneyIn(pa.endBalance, pa.currency) }}</div>
        <div class="small muted">
          минимум {{ moneyIn(pa.minBalance, pa.currency) }} · {{ fmtHuman(pa.minBalanceDate) }}
        </div>
      </div>
    </section>
```

- [ ] **Step 2: Dashboard - посчётные алерты**

В `src/components/Dashboard.vue` в блоке `⚠️ Кассовые разрывы` заменить таблицу, чтобы показывать счёт и валюту. Заменить `<thead>` и `<tbody>` внутри `.alert-box`:
```html
      <table>
        <thead><tr><th>Дата</th><th>Счёт</th><th>Остаток</th><th>Не хватает</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(a, i) in alerts" :key="i">
            <td class="nowrap">{{ fmtHuman(a.date) }}</td>
            <td class="small">{{ a.accountName }} ({{ a.currency }})</td>
            <td class="mono" :class="a.belowZero ? 'neg' : 'warn'">{{ moneyIn(a.balance, a.currency) }}</td>
            <td class="mono warn">{{ moneyIn(a.shortfall, a.currency) }}</td>
            <td>
              <span v-if="a.belowZero" class="pill" style="color: var(--red); border-color: #5b2b32">минус на счету</span>
              <span v-else class="pill warn">ниже буфера</span>
            </td>
          </tr>
        </tbody>
      </table>
```
Текст под заголовком блока оставить. Блок `v-else` ("кассовых разрывов нет") - заменить упоминание общего буфера на нейтральное:
```html
    <section v-else class="card ok-box">
      ✅ На горизонте прогноза кассовых разрывов нет - ни один счёт не опускается ниже своего буфера.
    </section>
```

- [ ] **Step 3: Проверить сборку**

Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 4: Ручная проверка**

Run: `npm run dev`. Дашборд: видны карточки счетов (каждая в своей валюте). Если долларовый счёт уходит в минус - в "Кассовых разрывах" строка с именем счёта и суммой в долларах.

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard.vue
git commit -m "UI: карточки счетов и посчётные алерты на дашборде"
```

---

## Task 7: SettingsView - убрать общий остаток/буфер из параметров прогноза

**Files:**
- Modify: `src/components/SettingsView.vue:54-66` (секция "Параметры прогноза")
- Test: ручная проверка

**Interfaces:**
- Consumes: `state.settings.horizonMonths`.
- Produces: секция без полей startingCash/safetyBuffer (они теперь на вкладке "Счета"); горизонт и курсы остаются.

- [ ] **Step 1: Заменить секцию "Параметры прогноза"**

В `src/components/SettingsView.vue` заменить `<section>` "Параметры прогноза" (строки 54-66) на:
```html
    <section class="card grid" style="gap: 14px">
      <h2 style="margin: 0">Параметры прогноза</h2>
      <p class="small muted" style="margin: -6px 0 0">
        Стартовый остаток и буфер теперь задаются по каждому счёту на вкладке "Счета".
      </p>
      <div style="max-width: 240px">
        <label>Горизонт прогноза (мес.)</label>
        <select v-model.number="state.settings.horizonMonths">
          <option :value="3">3</option><option :value="6">6</option><option :value="12">12</option><option :value="24">24</option>
        </select>
      </div>
    </section>
```
Неиспользуемый импорт `MoneyInput` в SettingsView удалить, если он больше нигде не нужен в файле (проверить: если MoneyInput не используется в остальном шаблоне - удалить строку `import MoneyInput from './MoneyInput.vue'`). `CURRENCIES`, `CURRENCY_META`, `formatMoney`, `fromRub` - проверить использование в блоке курсов (formatMoney, fromRub используются - оставить).

- [ ] **Step 2: Проверить сборку (нет неиспользуемых импортов, ломающих lint/build)**

Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 3: Ручная проверка**

Run: `npm run dev`. Настройки: секция "Параметры прогноза" содержит только горизонт + подсказку; курсы валют и бэкап на месте.

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsView.vue
git commit -m "UI: убрать общий остаток и буфер из настроек (переехали в Счета)"
```

---

## Task 8: Финальная проверка и правка пользовательского JSON

**Files:**
- Modify: `/Users/n0d3/Downloads/family-finance-2026-07-22.json`
- Test: импорт файла в приложение, визуальная проверка

**Interfaces:**
- Consumes: готовая модель со счетами.
- Produces: обновлённый JSON с массивом `accounts` (Основной RUB + USD-счёт + AMD-счёт) и `accountId` у всех записей; долларовые/драмовые записи привязаны к валютным счетам.

- [ ] **Step 1: Прогнать полный набор тестов**

Run: `npm test`
Expected: все PASS.

- [ ] **Step 2: Собрать проект**

Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 3: Уточнить у пользователя стартовые остатки валютных счетов**

Спросить: сколько реально лежит на долларовом и драмовом счетах (startingBalance для USD- и AMD-счёта). Без этого разбивка неточна. НЕ выдумывать значения.

- [ ] **Step 4: Отредактировать JSON**

В `/Users/n0d3/Downloads/family-finance-2026-07-22.json`:
- Добавить массив `accounts` с тремя счетами: Основной (RUB, startingBalance=622500, safetyBuffer=50000), Долларовый (USD, остаток из шага 3, буфер по договорённости), Драмовый (AMD, остаток из шага 3).
- Проставить `accountId` каждому income/expense/loan: записи в USD (`iCloud`, `Аренда Парагвай Асунсьон`, `Аренда Парагвай Облигадо`, `Парагвай такси Облигадо`, `Мебель с техникой Парагвай`) -> USD-счёт; записи в AMD (`Связь и интернет`) -> AMD-счёт; все остальные (RUB) -> Основной.
- Сохранить существующие суммы/валюты записей без изменений (валюта записи независима).

- [ ] **Step 5: Проверить импортом**

Импортировать отредактированный JSON в приложение (Настройки -> Импорт из файла). Проверить: вкладка "Счета" показывает 3 счёта; "Прогноз" -> USD-счёт показывает долларовые просадки; дашборд - карточки трёх счетов.

- [ ] **Step 6: Финальный коммит (только код проекта; пользовательский JSON вне репозитория)**

```bash
git add -A
git commit -m "Раздельные счета: завершение (проверка сборки и тестов)"
```
(Пользовательский файл в ~/Downloads не коммитится - он вне репозитория.)

---

## Self-Review

Проверка плана против спека:

1. **Покрытие спека:**
   - Модель `account` -> Task 2 (migrate/seed нормализация), Task 3 (форма создаёт поля). ✓
   - `accountId` у income/expense/loan -> Task 1 (события), Task 2 (миграция), Task 4 (формы). ✓
   - `buildForecast` два уровня + `perAccount` -> Task 1. ✓
   - Конвертация валюты записи в валюту счёта -> Task 1 (Step 4, 6). ✓
   - Посчётные алерты -> Task 1 (Step 8), Task 6 (UI). ✓
   - Общий `alerts` = объединение посчётных -> Task 1 (Step 4). ✓
   - Миграция "Основной" + settings оставить -> Task 2. ✓
   - CRUD account, удаление обнуляет ссылки -> Task 2. ✓
   - seed со счётом -> Task 2. ✓
   - Вкладка "Счета" -> Task 3. ✓
   - Селектор счёта в формах -> Task 4. ✓
   - ForecastView переключатель -> Task 5. ✓
   - Dashboard карточки + алерты -> Task 6. ✓
   - SettingsView убрать остаток/буфер -> Task 7. ✓
   - Тесты (perAccount, конвертация, алерт, регрессия) -> Task 1 + Task 2. ✓
   - Правка JSON -> Task 8. ✓
   - Вне scope (переводы, карты к счетам, мультивалютный счёт, разбивка monthly) - не включено. ✓

2. **Плейсхолдеры:** код показан в каждом шаге; тесты с реальными assert; команды с ожидаемым выводом. Нет "TODO/TBD". ✓

3. **Согласованность типов:** `account.startingBalance`/`safetyBuffer` - числа во всех задачах (Task 1 расчёт, Task 2 нормализация, Task 3 форма). `perAccount[]` поля (`account, currency, startingBalance, days, alerts, minBalance, minBalanceDate, endBalance, buffer`) - одинаковы в Task 1 (produce) и Task 5/6 (consume). Событие: `accountId`, `native:{amount,currency}` - Task 1 produce, Task 5 `evSign` consume. Алерт: `accountId, accountName, shortfall, currency, belowZero, balance, buffer` - Task 1 produce, Task 6 consume. ✓
