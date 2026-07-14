import test from 'node:test'
import assert from 'node:assert/strict'
import { applyScenario, annuityInterest, cardLoanInterest, evaluateScenario, transferCost, carouselPlan } from '../src/scenarios.js'
import { parseDate } from '../src/finance.js'
import { migrateCard } from '../src/store.js'

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

const wifeCard = () => ({
  id: 'card_9', name: 'Т-Банк (жена)', currency: 'RUB',
  currentDebt: { amount: 0, currency: 'RUB' },
  transferLimit: { amount: 150000, currency: 'RUB' }, transferGraceDays: 55,
  apr: 0.619,
})

const familyState = () => {
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

test('evaluateScenario: ручной возврат использует repayDate (формат UI), не авто', () => {
  const st = baseState()
  st.incomes = [{ name: 'ЗП', amount: 300000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-10' } }]
  st.cards = [wifeCard()]
  const scenario = { id: 'm', name: 'Ручной', baseFrom: '2026-07-18', moves: [
    { type: 'cardLoan', cardId: 'card_9', amount: { amount: 150000, currency: 'RUB' }, date: '2026-07-18', repay: 'manual', repayDate: '2026-10-01' },
  ] }
  const { metrics } = evaluateScenario(st, scenario, { from: '2026-07-18' })
  // возврат 01.10 позже грейса (11.09) → graceOk false, overpayment > 0
  assert.equal(metrics.graceOk[0], false)
  assert.ok(metrics.overpayment > 0, 'ручной возврат за грейсом даёт проценты')
})

test('evaluateScenario: ход с пустой датой не роняет, деградирует мягко', () => {
  const st = baseState()
  st.cards = [wifeCard()]
  const scenario = { id: 'x', name: 'Кривой', moves: [
    { type: 'newLoan', title: 'Без даты', amount: { amount: 90000, currency: 'RUB' }, apr: 0.25, termMonths: 12, startDate: '' },
    { type: 'cardLoan', cardId: 'card_9', amount: { amount: 150000, currency: 'RUB' }, date: '', repay: 'auto' },
  ] }
  // не должно бросать
  const { metrics } = evaluateScenario(st, scenario, { from: '2026-07-18' })
  assert.equal(typeof metrics.minBalance, 'number')
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
  assert.equal(step, 50, 'шаг = min(грейс) - 5 = 55 - 5')
})

test('carouselPlan: карта без transferGraceEnabled → feasible false с предупреждением', () => {
  const [a, b] = tbankPair()
  b.transferGraceEnabled = false
  const plan = carouselPlan(a, b, { amount: 150000, currency: 'RUB' }, parseDate('2026-11-10'), parseDate('2027-01-14'), rates0)
  assert.equal(plan.feasible, false)
  assert.ok(plan.warning && plan.warning.length > 0, 'есть текст предупреждения')
})

test('carouselPlan: сумма сверх лимита перевода, но в кредитном лимите → feasible true с комиссией', () => {
  const [a, b] = tbankPair()
  // лимит перевода 150к у обеих, кредитный лимит поднимаем, чтобы 200к влезли по кредиту
  a.creditLimit = { amount: 300000, currency: 'RUB' }
  b.creditLimit = { amount: 300000, currency: 'RUB' }
  a.transferFeePercent = 2.9; a.transferFeeFixed = { amount: 290, currency: 'RUB' }
  b.transferFeePercent = 2.9; b.transferFeeFixed = { amount: 290, currency: 'RUB' }
  const plan = carouselPlan(a, b, { amount: 200000, currency: 'RUB' }, parseDate('2026-11-10'), parseDate('2027-01-14'), rates0)
  assert.equal(plan.feasible, true, 'сумма сверх лимита перевода не ломает карусель, если хватает кредитного лимита')
  assert.ok(plan.fee > 0, 'на превышение над лимитом перевода есть комиссия')
})

test('carouselPlan: сумма сверх кредитного лимита обеих карт → feasible false', () => {
  const [a, b] = tbankPair()
  // просим 400к при кредитных лимитах 160к/195к - ни на одной не влезет
  const plan = carouselPlan(a, b, { amount: 400000, currency: 'RUB' }, parseDate('2026-11-10'), parseDate('2027-01-14'), rates0)
  assert.equal(plan.feasible, false)
  assert.ok(plan.warning && plan.warning.length > 0)
})

test('carouselPlan: комиссия считается по формуле на каждом обороте (over × %/100 + fixed)', () => {
  const [a, b] = tbankPair()
  // лимит перевода 150к, комиссия 2.9% + 290 на превышение. Кредитный лимит с запасом.
  a.creditLimit = { amount: 300000, currency: 'RUB' }
  b.creditLimit = { amount: 300000, currency: 'RUB' }
  a.transferFeePercent = 2.9; a.transferFeeFixed = { amount: 290, currency: 'RUB' }
  b.transferFeePercent = 2.9; b.transferFeeFixed = { amount: 290, currency: 'RUB' }
  // короткий горизонт → ровно 1 оборот, чтобы проверить комиссию за один перевод
  const plan = carouselPlan(a, b, { amount: 200000, currency: 'RUB' }, parseDate('2026-11-10'), parseDate('2026-11-20'), rates0)
  assert.equal(plan.feasible, true)
  assert.equal(plan.transfers.length, 1, 'на коротком горизонте один оборот')
  // over = 200000 - 150000 = 50000; комиссия = 0.029 × 50000 + 290 = 1740
  const over = 50000
  const expected = 0.029 * over + 290
  assert.ok(Math.abs(plan.fee - expected) < 1, `комиссия за оборот = ${expected}`)
})
