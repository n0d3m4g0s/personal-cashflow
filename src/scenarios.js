// Движок сценариев: ход (move) → форк состояния → готовый buildForecast.
// Чистые функции, тестируется отдельно. finance.js не трогаем.
// parseDate/fmtISO/addMonths используются evaluateScenario (добавляется в Task 4 этапа 2).
import { parseDate, fmtISO, addDays, addMonths } from './finance.js'
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
