// Лёгкие проверки чистых функций движка. Запуск: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  expandSchedule, parseDate, monthlyFactor, addMonths,
  cardNextDue, buildForecast, computeGoals, fmtISO, diffDays, cardCycle,
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

test('cardNextDue: работает с явными датами через cardCycle', () => {
  const card = {
    statementDate: '2026-07-26', dueDate: '2026-08-19',
    graceEndDate: '2026-08-19', statementCycleDays: 30,
  }
  const { statement, due } = cardNextDue(card, parseDate('2026-07-12'))
  assert.equal(fmtISO(statement), '2026-07-26')
  assert.equal(fmtISO(due), '2026-08-19')
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

test('cardCycle: возвращает сохранённый цикл, если он ещё актуален', () => {
  const card = {
    statementDate: '2026-07-26', dueDate: '2026-08-19',
    graceEndDate: '2026-08-19', statementCycleDays: 30,
  }
  const { statement, due, graceEnd } = cardCycle(card, parseDate('2026-07-12'))
  assert.equal(fmtISO(statement), '2026-07-26')
  assert.equal(fmtISO(due), '2026-08-19')
  assert.equal(fmtISO(graceEnd), '2026-08-19')
})

test('cardCycle: катит цикл вперёд, если он в прошлом', () => {
  const card = {
    statementDate: '2026-07-26', dueDate: '2026-08-19',
    graceEndDate: '2026-08-19', statementCycleDays: 30,
  }
  // from после due первого цикла → ожидаем следующий цикл (выписка 26 августа)
  const { statement, due } = cardCycle(card, parseDate('2026-08-20'))
  assert.equal(statement.getMonth(), 7) // август (0-based)
  assert.equal(statement.getDate(), 26)
  assert.ok(due >= parseDate('2026-08-20'))
})

test('cardCycle: сохраняет смещение due и graceEnd от выписки', () => {
  const card = {
    statementDate: '2026-07-26', dueDate: '2026-08-19', // +24 дня
    graceEndDate: '2026-09-08', statementCycleDays: 30, // +44 дня
  }
  const { statement, due, graceEnd } = cardCycle(card, parseDate('2026-09-01'))
  assert.equal(diffDays(due, statement), 24)
  assert.equal(diffDays(graceEnd, statement), 44)
})

test('cardCycle: якорный день клампится к концу короткого месяца', () => {
  const card = {
    statementDate: '2026-01-31', dueDate: '2026-02-20',
    graceEndDate: '2026-02-20', statementCycleDays: 30,
  }
  // прокрутка в февраль: 31 → 28
  const { statement } = cardCycle(card, parseDate('2026-02-27'))
  assert.equal(statement.getMonth(), 1) // февраль
  assert.equal(statement.getDate(), 28)
})
