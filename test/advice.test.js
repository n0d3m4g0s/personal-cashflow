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

test('cardAdvice: critical реально появляется и идёт перед save при кассовом разрыве', () => {
  const st = stateWithExpensiveDebt()
  // Гарантированный кассовый разрыв: мало денег И нет дохода, чтобы баланс не восстановился
  // к дате платежа по карте (иначе доход перекрыл бы дефицит и critical не сработал).
  st.settings.startingCash = { amount: 10000, currency: 'RUB' }
  st.settings.safetyBuffer = { amount: 50000, currency: 'RUB' }
  st.incomes = []
  const adv = cardAdvice(st, { from: '2026-07-13' })
  const sevs = adv.map(a => a.severity)
  // critical ДОЛЖЕН появиться (остаток уходит ниже буфера к платежу карты) - проверка неусловна
  assert.ok(sevs.includes('critical'), 'при кассовом разрыве должна быть critical-рекомендация')
  assert.ok(sevs.includes('save'), 'дорогой долг Уралсиба даёт save-рекомендацию')
  // critical идёт перед первой save (сортировка critical -> warning -> save)
  assert.ok(sevs.indexOf('critical') < sevs.indexOf('save'), 'critical должен идти перед save')
})
