// Движок сценариев: ход (move) → форк состояния → готовый buildForecast.
// Чистые функции, тестируется отдельно. finance.js не трогаем.
import { parseDate, fmtISO, addDays, addMonths, buildForecast } from './finance.js'
import { moneyToRub, convert } from './money.js'

let _sid = 0
const sid = (p = 'sc') => `${p}_${++_sid}`

const onceSchedule = (date) => ({ frequency: 'once', interval: 1, startDate: date, endDate: null })

// Аннуитетный месячный платёж.
function annuityPayment(principal, apr, termMonths) {
  const r = apr / 12
  if (r === 0) return principal / termMonths
  return principal * r / (1 - Math.pow(1 + r, -termMonths))
}

// Суммарные проценты по помесячному графику (остаток × apr/12 за месяц).
export function annuityInterest(principal, apr, termMonths) {
  if (apr === 0) return 0
  const pay = annuityPayment(principal, apr, termMonths)
  const r = apr / 12
  let balance = principal
  let interest = 0
  for (let m = 0; m < termMonths; m++) {
    const monthInterest = balance * r
    interest += monthInterest
    balance = balance + monthInterest - pay
    if (balance < 0) balance = 0
  }
  return interest
}

// Переплата по займу с карты (в рублях). free - в пределах беспроцентного лимита
// перевода, over - сверх лимита (проценты с первого дня). loanDate/repayDate - Date.
export function cardLoanInterest(card, amount, loanDate, repayDate, rates) {
  const amt = moneyToRub(amount, rates)
  const limit = moneyToRub(card.transferLimit, rates)
  const apr = Number(card.apr) || 0
  const free = Math.min(amt, limit)
  const over = Math.max(0, amt - limit)
  const graceEnd = addDays(loanDate, Number(card.transferGraceDays) || 0)
  const daysTotal = Math.max(0, Math.round((repayDate - loanDate) / 86400000))
  const overInterest = apr * over * daysTotal / 365
  let freeInterest = 0
  if (repayDate > graceEnd) {
    const daysOver = Math.round((repayDate - graceEnd) / 86400000)
    freeInterest = apr * free * daysOver / 365
  }
  return overInterest + freeInterest
}

// Применяет сценарий к состоянию, возвращая НОВОЕ состояние (исходник не мутируется).
export function applyScenario(state, scenario) {
  const s = JSON.parse(JSON.stringify(state))
  s.incomes = s.incomes || []
  s.expenses = s.expenses || []
  s.loans = s.loans || []
  s.cards = s.cards || []
  for (const move of (scenario.moves || [])) {
    applyMove(s, move)
  }
  return s
}

function applyMove(s, move) {
  switch (move.type) {
    case 'purchase':
      s.expenses.push({
        id: sid('sc_exp'), name: move.title || 'Покупка',
        amount: move.amount.amount, currency: move.amount.currency,
        category: 'Сценарий', owner: 'family', schedule: onceSchedule(move.date),
      })
      break
    case 'adjust':
      if ((move.sign || 1) >= 0) {
        s.incomes.push({
          id: sid('sc_inc'), name: move.title || 'Доход',
          amount: move.amount.amount, currency: move.amount.currency,
          type: 'other', schedule: onceSchedule(move.date),
        })
      } else {
        s.expenses.push({
          id: sid('sc_exp'), name: move.title || 'Расход',
          amount: move.amount.amount, currency: move.amount.currency,
          category: 'Сценарий', owner: 'family', schedule: onceSchedule(move.date),
        })
      }
      break
    case 'newLoan': {
      const day = parseDate(move.startDate).getDate()
      s.loans.push({
        id: sid('sc_loan'), name: move.title || 'Кредит',
        owner: 'family',
        amount: Math.round(annuityPayment(move.amount.amount, move.apr, move.termMonths)),
        currency: move.amount.currency,
        paymentDay: day,
        remainingBalance: { amount: move.amount.amount, currency: move.amount.currency },
        apr: move.apr,
      })
      break
    }
    case 'cardLoan': {
      s.incomes.push({
        id: sid('sc_inc'), name: `Заём с карты (${move.cardId})`,
        amount: move.amount.amount, currency: move.amount.currency,
        type: 'other', schedule: onceSchedule(move.date),
      })
      const card = s.cards.find((c) => c.id === move.cardId)
      if (card) {
        const inCardCurrency = convert(move.amount.amount, move.amount.currency, card.currentDebt.currency, s.settings.rates)
        card.currentDebt.amount += inCardCurrency
      }
      break
    }
    default:
      break
  }
}

// Оценивает сценарий: применяет ходы, разруливает возврат займов, строит прогноз,
// считает метрики для таблицы сравнения.
export function evaluateScenario(state, scenario, opts = {}) {
  const rates = state.settings.rates
  const from = opts.from || scenario.baseFrom || fmtISO(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()))
  const startingCash = moneyToRub(state.settings.startingCash, rates)

  const forked = applyScenario(state, scenario)
  const cardLoans = (scenario.moves || []).filter((m) => m.type === 'cardLoan')

  const graceOk = []
  let cardInterest = 0
  for (const move of cardLoans) {
    const card = forked.cards.find((c) => c.id === move.cardId)
    const amtRub = moneyToRub(move.amount, rates)
    const loanDate = parseDate(move.date)
    let repayDate
    if (move.repay && move.repay !== 'auto' && move.repay.date) {
      repayDate = parseDate(move.repay.date)
    } else {
      // авто: первый день после займа с balance >= startingCash + amtRub
      const probe = buildForecast(forked, { from })
      repayDate = null
      for (const day of probe.days) {
        if (day.date > loanDate && day.balance >= startingCash + amtRub) { repayDate = day.date; break }
      }
      if (!repayDate) repayDate = probe.end // не закрыт до конца горизонта
    }
    // Возврат моделируется ТОЛЬКО событием-расходом (отток кэша на гашение карты).
    // currentDebt карты НЕ уменьшаем: прирост долга от cardLoan остаётся, чтобы карта
    // сохраняла обязательство в прогнозе; двойного вычета из cash быть не должно -
    // событие-расход единственное движение кэша по возврату.
    forked.expenses.push({
      id: sid('sc_repay'), name: `Возврат займа (${move.cardId})`,
      amount: move.amount.amount, currency: move.amount.currency,
      category: 'Сценарий', owner: 'family',
      schedule: { frequency: 'once', interval: 1, startDate: fmtISO(repayDate), endDate: null },
    })
    const graceEnd = addDays(loanDate, Number(card?.transferGraceDays) || 0)
    graceOk.push(repayDate <= graceEnd)
    cardInterest += cardLoanInterest(card, move.amount, loanDate, repayDate, rates)
  }

  // проценты по новым кредитам
  let loanInterest = 0
  for (const m of (scenario.moves || [])) {
    if (m.type === 'newLoan') loanInterest += annuityInterest(m.amount.amount, m.apr, m.termMonths)
  }

  const forecast = buildForecast(forked, { from })
  const buffer = moneyToRub(state.settings.safetyBuffer, rates)

  let breakEvenDate = null
  for (const day of forecast.days) {
    if (day.balance >= startingCash) { breakEvenDate = day.date; break }
  }

  const minBalance = forecast.minBalance
  let risk = 'низкий'
  if (minBalance < 0) risk = 'высокий'
  else if (minBalance < buffer) risk = 'средний'

  return {
    forecast,
    metrics: {
      minBalance,
      minBalanceDate: forecast.minBalanceDate,
      overpayment: Math.round(cardInterest + loanInterest),
      graceOk,
      breakEvenDate,
      risk,
    },
  }
}
