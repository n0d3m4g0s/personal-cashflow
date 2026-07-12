import test from 'node:test'
import assert from 'node:assert/strict'
import { applyScenario, annuityInterest } from '../src/scenarios.js'

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
