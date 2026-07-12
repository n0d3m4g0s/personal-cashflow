import test from 'node:test'
import assert from 'node:assert/strict'
import { applyScenario, annuityInterest, cardLoanInterest, evaluateScenario } from '../src/scenarios.js'
import { parseDate } from '../src/finance.js'

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
