import test from 'node:test'
import assert from 'node:assert/strict'
import { applyScenario, annuityInterest, cardLoanInterest } from '../src/scenarios.js'
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

test('applyScenario: cardLoan даёт наличные и растит долг карты', () => {
  const st = baseState()
  st.cards = [wifeCard()]
  const scenario = { id: 's4', name: 'Заём', moves: [
    { type: 'cardLoan', cardId: 'card_9', amount: { amount: 150000, currency: 'RUB' }, date: '2026-07-18', repay: 'auto' },
  ] }
  const out = applyScenario(st, scenario)
  assert.equal(out.incomes.length, 1)
  assert.equal(out.incomes[0].amount, 150000)
  assert.equal(out.cards[0].currentDebt.amount, 150000)
})
