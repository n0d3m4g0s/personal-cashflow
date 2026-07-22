// Лёгкие проверки чистых функций движка. Запуск: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  expandSchedule, parseDate, monthlyFactor, addMonths,
  cardNextDue, buildForecast, computeGoals, fmtISO, diffDays, cardCycle, cardMinPayment, cardMinCore, cardDebt, buildMonthly,
  cardPaymentSchedule, cardsSummary, accountsStartingCash, accountsBuffer,
} from '../src/finance.js'
import { migrateCard } from '../src/store.js'

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

test('cardMinPayment: Т-Банк 14% от долга, минимум 600', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    currentDebt: { amount: 231684, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 14, minPaymentBase: 'currentDebt',
    minPaymentFixed: { amount: 600, currency: 'RUB' },
    minPaymentPlusInterest: false, apr: 0.619, statementCycleDays: 30,
  }
  // 231684 × 0.14 = 32435.76, проценты не добавляются
  assert.ok(Math.abs(cardMinPayment(card, rates) - 32435.76) < 0.5)
})

test('cardMinPayment: минимум-фикс срабатывает на малом долге', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    currentDebt: { amount: 1000, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 14, minPaymentBase: 'currentDebt',
    minPaymentFixed: { amount: 600, currency: 'RUB' },
    minPaymentPlusInterest: false, apr: 0.619, statementCycleDays: 30,
  }
  // max(140, 600) = 600
  assert.equal(cardMinPayment(card, rates), 600)
})

test('cardMinPayment: Озон 4% + проценты, минимум 400', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    currentDebt: { amount: 39400, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 4, minPaymentBase: 'currentDebt',
    minPaymentFixed: { amount: 400, currency: 'RUB' },
    minPaymentPlusInterest: true, apr: 0.624, statementCycleDays: 30,
  }
  // core = max(1576, 400) = 1576; проценты = 39400×0.624×30/365 ≈ 2020.6; итого ≈ 3596.6
  const interest = 39400 * 0.624 * 30 / 365
  assert.ok(Math.abs(cardMinPayment(card, rates) - (1576 + interest)) < 1)
})

test('cardMinPayment: не больше долга', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    currentDebt: { amount: 500, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 14, minPaymentBase: 'currentDebt',
    minPaymentFixed: { amount: 600, currency: 'RUB' },
    minPaymentPlusInterest: false, apr: 0.619, statementCycleDays: 30,
  }
  // max(70, 600) = 600, но долг 500 → кламп до 500
  assert.equal(cardMinPayment(card, rates), 500)
})

test('cardMinCore: тело минимума без процентов от произвольного остатка', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = { minPaymentPercent: 4, minPaymentFixed: { amount: 400, currency: 'RUB' } }
  // 4% от 50000 = 2000 (> фикс 400) → 2000. Процентов НЕТ (это core).
  assert.equal(cardMinCore(card, 50000, rates), 2000)
  // 4% от 5000 = 200 (< фикс 400) → 400.
  assert.equal(cardMinCore(card, 5000, rates), 400)
  // кламп до остатка: 4% от 300 = 12, фикс 400, но остаток 300 → 300.
  assert.equal(cardMinCore(card, 300, rates), 300)
})

test('cardMinPayment: регрессия после рефактора, прежний результат (Озон 4%+проценты)', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 4, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 400, currency: 'RUB' },
    minPaymentPlusInterest: true, apr: 0.624, statementCycleDays: 30,
  }
  // core = max(1576, 400) = 1576; проценты = 39400×0.624×30/365 ≈ 2020.6; итого ≈ 3596.6
  const interest = 39400 * 0.624 * 30 / 365
  assert.ok(Math.abs(cardMinPayment(card, rates) - (1576 + interest)) < 1)
})

test('cardDebt: statementBalance=0 → берёт currentDebt (корень бага прогноза)', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    statementBalance: { amount: 0, currency: 'RUB' },
    currentDebt: { amount: 39400, currency: 'RUB' },
  }
  assert.equal(cardDebt(card, rates), 39400)
})

test('cardDebt: statementBalance>0 → берёт его (приоритет выписки)', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    statementBalance: { amount: 20000, currency: 'RUB' },
    currentDebt: { amount: 39400, currency: 'RUB' },
  }
  assert.equal(cardDebt(card, rates), 20000)
})

test('buildForecast: карта с нулевой выпиской и долгом попадает в события (регрессия бага)', () => {
  const state = {
    settings: { rates: { amdPerRub: 4.6, usdPerRub: 0.0125 }, startingCash: { amount: 100000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 6 },
    incomes: [], expenses: [], loans: [], goals: [],
    cards: [{
      name: 'Озон', bank: 'Озон', owner: 'husband', payStrategy: 'minimum',
      statementDate: '2026-08-08', dueDate: '2026-08-24', graceEndDate: '2026-09-08', statementCycleDays: 30,
      currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
      minPaymentPercent: 4, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 400, currency: 'RUB' },
      minPaymentPlusInterest: true, apr: 0.624,
    }],
  }
  const f = buildForecast(state, { from: '2026-07-12' })
  const cardEvents = f.events.filter((e) => e.kind === 'card')
  assert.ok(cardEvents.length >= 1, 'карта с нулевой выпиской, но ненулевым долгом должна попасть в прогноз')
  assert.equal(fmtISO(cardEvents[0].date), '2026-08-24')
  assert.ok(cardEvents[0].graceDate, 'событие карты должно нести дату конца грейса')
})

test('buildMonthly: минимальные платежи карт входят в обязательства', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const state = {
    settings: { rates },
    incomes: [{ name: 'ЗП', amount: 300000, currency: 'RUB', schedule: { frequency: 'monthly', startDate: '2026-07-10' } }],
    expenses: [],
    loans: [],
    cards: [{
      name: 'Т', owner: 'husband', payStrategy: 'minimum',
      statementDate: '2026-07-26', dueDate: '2026-08-19', graceEndDate: '2026-08-19', statementCycleDays: 30,
      currentDebt: { amount: 100000, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
      minPaymentPercent: 14, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 600, currency: 'RUB' },
      minPaymentPlusInterest: false, apr: 0.619,
    }],
    goals: [],
  }
  const m = buildMonthly(state, rates)
  // минплатёж = 100000 × 0.14 = 14000
  assert.ok(Math.abs(m.card - 14000) < 1)
  assert.ok(Math.abs(m.obligatory - 14000) < 1) // нет expenses/loans
  assert.ok(Math.abs(m.surplus - (300000 - 14000)) < 1)
})

test('migrateCard: синтезирует даты из старой модели', () => {
  const old = {
    name: 'Старая', statementDay: 5, dueDay: 25, gracePeriodDays: 55,
    currentDebt: { amount: 10000, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
  }
  const c = migrateCard(old, parseDate('2026-07-12'))
  assert.ok(c.statementDate, 'должна появиться дата выписки')
  assert.ok(c.dueDate, 'должна появиться дата платежа')
  assert.ok(c.graceEndDate)
  assert.equal(c.statementCycleDays, 30)
  // dueDate строго после statementDate
  assert.ok(parseDate(c.dueDate) > parseDate(c.statementDate))
})

test('migrateCard: идемпотентна для новой модели', () => {
  const nw = {
    name: 'Новая', statementDate: '2026-07-26', dueDate: '2026-08-19',
    graceEndDate: '2026-08-19', statementCycleDays: 30,
    currentDebt: { amount: 0, currency: 'RUB' },
  }
  const c = migrateCard(nw, parseDate('2026-07-12'))
  assert.equal(c.statementDate, '2026-07-26')
  assert.equal(c.dueDate, '2026-08-19')
})

test('cardPaymentSchedule: minimum даёт ряд платежей, остаток убывает', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = {
    payStrategy: 'minimum',
    statementDate: '2026-08-08', dueDate: '2026-08-24', graceEndDate: '2026-09-08', statementCycleDays: 30,
    currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 4, minPaymentFixed: { amount: 400, currency: 'RUB' }, minPaymentBase: 'currentDebt',
    minPaymentPlusInterest: true, apr: 0.624,
  }
  const sched = cardPaymentSchedule(card, rates, parseDate('2026-07-12'), parseDate('2027-07-12'))
  assert.ok(sched.length >= 2, 'несколько платежей')
  // остаток убывает монотонно
  for (let i = 1; i < sched.length; i++) {
    assert.ok(sched[i].remainingAfter <= sched[i-1].remainingAfter, 'остаток не растёт')
  }
  // проценты положительны (apr>0)
  assert.ok(sched[0].interest > 0)
  // ДАТЫ СТРОГО РАСТУТ - нет дублей
  for (let i = 1; i < sched.length; i++) {
    assert.ok(sched[i].date > sched[i-1].date, `дата ${fmtISO(sched[i].date)} должна быть строго позже предыдущей`)
  }
})

test('cardPaymentSchedule: долг ≤ 0 → пустой массив', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const card = { payStrategy: 'minimum', currentDebt: { amount: 0, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
    statementDate: '2026-08-08', dueDate: '2026-08-24', graceEndDate: '2026-09-08', statementCycleDays: 30,
    minPaymentPercent: 4, minPaymentFixed: { amount: 400, currency: 'RUB' }, apr: 0.624 }
  assert.deepEqual(cardPaymentSchedule(card, rates, parseDate('2026-07-12'), parseDate('2027-07-12')), [])
})

test('cardPaymentSchedule: обрывается на конце горизонта (хвост остаётся)', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  // Уралсиб 3% минимум под 99.9% - долг тает крайне медленно, за короткий горизонт не закроется
  const card = {
    payStrategy: 'minimum', statementDate: '2026-08-01', dueDate: '2026-08-30', graceEndDate: '2026-09-30', statementCycleDays: 30,
    currentDebt: { amount: 19275, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
    minPaymentPercent: 3, minPaymentFixed: { amount: 300, currency: 'RUB' }, minPaymentBase: 'currentDebt', minPaymentPlusInterest: true, apr: 0.999,
  }
  const sched = cardPaymentSchedule(card, rates, parseDate('2026-07-12'), parseDate('2026-10-12')) // 3 месяца
  // за 3 месяца долг не закроется, последний remainingAfter > 0
  assert.ok(sched.length >= 1 && sched.length <= 4)
  assert.ok(sched[sched.length-1].remainingAfter > 0, 'хвост долга остаётся')
})

test('buildForecast: карта minimum даёт несколько card-событий (график)', () => {
  const state = {
    settings: { rates: { amdPerRub: 4.6, usdPerRub: 0.0125 }, startingCash: { amount: 300000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 12 },
    incomes: [], expenses: [], loans: [], goals: [],
    cards: [{
      name: 'Озон', bank: 'Озон', owner: 'husband', payStrategy: 'minimum',
      statementDate: '2026-08-08', dueDate: '2026-08-24', graceEndDate: '2026-09-08', statementCycleDays: 30,
      currentDebt: { amount: 39400, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
      minPaymentPercent: 4, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 400, currency: 'RUB' }, minPaymentPlusInterest: true, apr: 0.624,
    }],
  }
  const f = buildForecast(state, { from: '2026-07-12' })
  const cardEvents = f.events.filter((e) => e.kind === 'card')
  assert.ok(cardEvents.length >= 2, `ожидали несколько платежей, получили ${cardEvents.length}`)
})

test('buildForecast: карта full даёт одно событие (регрессия не сломана)', () => {
  const state = {
    settings: { rates: { amdPerRub: 4.6, usdPerRub: 0.0125 }, startingCash: { amount: 300000, currency: 'RUB' }, safetyBuffer: { amount: 50000, currency: 'RUB' }, horizonMonths: 12 },
    incomes: [], expenses: [], loans: [], goals: [],
    cards: [{
      name: 'Сбер', bank: 'Сбер', owner: 'husband', payStrategy: 'full',
      statementDate: '2026-07-15', dueDate: '2026-08-05', graceEndDate: '2026-08-05', statementCycleDays: 30,
      currentDebt: { amount: 20000, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' },
      minPaymentPercent: 5, minPaymentBase: 'currentDebt', minPaymentFixed: { amount: 0, currency: 'RUB' }, apr: 0,
    }],
  }
  const f = buildForecast(state, { from: '2026-07-12' })
  const cardEvents = f.events.filter((e) => e.kind === 'card')
  assert.equal(cardEvents.length, 1, 'full - одно событие')
  assert.equal(cardEvents[0].amount, -20000)
})

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

test('cardsSummary: full-карта в perCard показывает весь долг как ближайший платёж', () => {
  const rates = { amdPerRub: 4.6, usdPerRub: 0.0125 }
  const state = {
    settings: { rates, horizonMonths: 6 }, incomes: [], expenses: [], loans: [], goals: [],
    cards: [
      { id: 'sber', name: 'Сбер', bank: 'Сбер', payStrategy: 'full', statementDate: '2026-07-15', dueDate: '2026-08-05', graceEndDate: '2026-08-05', statementCycleDays: 30,
        currentDebt: { amount: 20000, currency: 'RUB' }, statementBalance: { amount: 0, currency: 'RUB' }, creditLimit: { amount: 20000, currency: 'RUB' },
        minPaymentPercent: 5, minPaymentFixed: { amount: 0, currency: 'RUB' }, apr: 0 },
    ],
  }
  const s = cardsSummary(state, { from: '2026-07-12' })
  // full-карта гасится целиком в грейс → nextPayment = весь долг, а не минимум
  assert.equal(s.perCard[0].nextPayment, 20000)
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
  assert.equal(usdAlert.accountName, 'Долларовый')
  // остаток -200 USD при buffer=0 -> shortfall = buffer - balance = 0 - (-200) = 200
  assert.equal(usdAlert.buffer, 0)
  assert.equal(usdAlert.shortfall, 200)
})

test('accountsStartingCash: сумма стартовых остатков нескольких счетов в рублях', () => {
  const rates = { amdPerRub: 4, usdPerRub: 0.01 }
  const state = {
    settings: { rates },
    accounts: [
      { id: 'a1', currency: 'RUB', startingBalance: 100000, safetyBuffer: 0 },
      { id: 'a2', currency: 'USD', startingBalance: 500, safetyBuffer: 0 }, // 500/0.01 = 50000 руб
    ],
  }
  assert.equal(accountsStartingCash(state, rates), 150000)
})

test('accountsStartingCash: disabled-счета не участвуют в сумме', () => {
  const rates = { amdPerRub: 4, usdPerRub: 0.01 }
  const state = {
    settings: { rates },
    accounts: [
      { id: 'a1', currency: 'RUB', startingBalance: 100000, safetyBuffer: 0 },
      { id: 'a2', currency: 'RUB', startingBalance: 999999, safetyBuffer: 0, disabled: true },
    ],
  }
  assert.equal(accountsStartingCash(state, rates), 100000)
})

test('accountsStartingCash: без счетов - фолбэк на settings.startingCash', () => {
  const rates = { amdPerRub: 4, usdPerRub: 0.01 }
  const state = {
    settings: { rates, startingCash: { amount: 500000, currency: 'RUB' } },
    accounts: [],
  }
  assert.equal(accountsStartingCash(state, rates), 500000)
})

test('accountsStartingCash: accounts отсутствует (undefined) - тоже фолбэк', () => {
  const rates = { amdPerRub: 4, usdPerRub: 0.01 }
  const state = { settings: { rates, startingCash: { amount: 500000, currency: 'RUB' } } }
  assert.equal(accountsStartingCash(state, rates), 500000)
})

test('accountsBuffer: сумма буферов нескольких счетов в рублях', () => {
  const rates = { amdPerRub: 4, usdPerRub: 0.01 }
  const state = {
    settings: { rates },
    accounts: [
      { id: 'a1', currency: 'RUB', startingBalance: 0, safetyBuffer: 30000 },
      { id: 'a2', currency: 'RUB', startingBalance: 0, safetyBuffer: 20000 },
    ],
  }
  assert.equal(accountsBuffer(state, rates), 50000)
})

test('accountsBuffer: без счетов - фолбэк на settings.safetyBuffer', () => {
  const rates = { amdPerRub: 4, usdPerRub: 0.01 }
  const state = {
    settings: { rates, safetyBuffer: { amount: 50000, currency: 'RUB' } },
    accounts: [],
  }
  assert.equal(accountsBuffer(state, rates), 50000)
})

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

test('makeSeed: все записи привязаны к существующему счёту', async () => {
  const { makeSeed } = await import('../src/seed.js')
  const s = makeSeed()
  assert.ok(s.accounts.length >= 1)
  const ids = new Set(s.accounts.map((a) => a.id))
  for (const k of ['incomes', 'expenses', 'loans']) {
    for (const rec of s[k]) assert.ok(ids.has(rec.accountId), `${k} ${rec.id} без счёта`)
  }
})
