// Лёгкие проверки чистых функций движка. Запуск: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  expandSchedule, parseDate, monthlyFactor, addMonths,
  cardNextDue, buildForecast, computeGoals,
} from '../src/finance.js'

test('expandSchedule: monthly уважает диапазон', () => {
  const s = { frequency: 'monthly', interval: 1, startDate: '2026-01-15', endDate: null }
  const dates = expandSchedule(s, parseDate('2026-03-01'), parseDate('2026-06-01'))
  assert.equal(dates.length, 3) // март, апрель, май (15-е)
  assert.equal(dates[0].getMonth(), 2)
})

test('expandSchedule: weekly шаг 7 дней', () => {
  const s = { frequency: 'weekly', startDate: '2026-01-01', endDate: null }
  const dates = expandSchedule(s, parseDate('2026-01-01'), parseDate('2026-01-29'))
  assert.equal(dates.length, 5) // 1,8,15,22,29
})

test('expandSchedule: endDate ограничивает', () => {
  const s = { frequency: 'monthly', startDate: '2026-01-10', endDate: '2026-03-10' }
  const dates = expandSchedule(s, parseDate('2026-01-01'), parseDate('2026-12-01'))
  assert.equal(dates.length, 3) // янв, фев, мар
})

test('expandSchedule: once один раз', () => {
  const s = { frequency: 'once', startDate: '2026-05-20' }
  const dates = expandSchedule(s, parseDate('2026-01-01'), parseDate('2026-12-31'))
  assert.equal(dates.length, 1)
  assert.equal(dates[0].getDate(), 20)
})

test('expandSchedule: yearly', () => {
  const s = { frequency: 'yearly', startDate: '2024-02-29' }
  const dates = expandSchedule(s, parseDate('2026-01-01'), parseDate('2027-12-31'))
  // 2026-02-28 (клампится) и 2027-02-28
  assert.equal(dates.length, 2)
})

test('monthlyFactor', () => {
  assert.equal(monthlyFactor({ frequency: 'monthly' }), 1)
  assert.equal(monthlyFactor({ frequency: 'yearly' }), 1 / 12)
  assert.equal(monthlyFactor({ frequency: 'once' }), 0)
  assert.ok(Math.abs(monthlyFactor({ frequency: 'weekly' }) - 52 / 12) < 1e-9)
})

test('addMonths клампит конец месяца', () => {
  const d = addMonths(parseDate('2026-01-31'), 1, 31)
  assert.equal(d.getMonth(), 1) // февраль
  assert.equal(d.getDate(), 28)
})

test('cardNextDue: due после выписки, не в прошлом', () => {
  const card = { statementDay: 5, dueDay: 25 }
  const { statement, due } = cardNextDue(card, parseDate('2026-07-11'))
  assert.ok(due >= parseDate('2026-07-11'))
  assert.ok(due > statement)
})

test('buildForecast: считает нарастающий остаток и алерты', () => {
  const state = {
    settings: { rates: { amdPerRub: 4.6, usdPerRub: 0.0118 }, startingCash: { amount: 100000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 3 },
    incomes: [{ name: 'ЗП', amount: 300000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-10' } }],
    expenses: [{ name: 'Аренда', amount: 75000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-01' } }],
    loans: [{ name: 'Ипотека', amount: 117000, currency: 'RUB', paymentDay: 15, remainingBalance: { amount: 0, currency: 'RUB' } }],
    cards: [],
    goals: [],
  }
  const f = buildForecast(state, { from: '2026-07-01' })
  assert.ok(f.events.length > 0)
  assert.equal(typeof f.endBalance, 'number')
})

test('computeGoals: ETA по профициту', () => {
  const state = {
    settings: { rates: { amdPerRub: 4.6, usdPerRub: 0.0118 } },
    incomes: [{ name: 'ЗП', amount: 300000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-10' } }],
    expenses: [{ name: 'Жизнь', amount: 200000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-01' } }],
    loans: [],
    cards: [],
    goals: [{ id: 'g1', name: 'Подушка', priority: 1, targetAmount: { amount: 300000, currency: 'RUB' }, currentSaved: { amount: 0, currency: 'RUB' }, monthlyContribution: { amount: 0, currency: 'RUB' } }],
  }
  const g = computeGoals(state)
  assert.equal(g.surplus, 100000)
  assert.equal(g.results[0].monthsNeeded, 3) // 300k / 100k
})
