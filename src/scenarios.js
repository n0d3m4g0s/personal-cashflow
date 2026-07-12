// Движок сценариев: ход (move) → форк состояния → готовый buildForecast.
// Чистые функции, тестируется отдельно. finance.js не трогаем.
import { parseDate, fmtISO, addDays, buildForecast } from './finance.js'
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
// Если у карты грейс на перевод не действует (transferGraceEnabled === false, как у
// Озон/Уралсиб) - проценты на всю сумму с первого дня. Иначе (true или поле не задано -
// совместимость с этапом 2, где у карты жены грейс на перевод есть) - прежняя логика
// free/over с грейсом.
export function cardLoanInterest(card, amount, loanDate, repayDate, rates) {
  const amt = moneyToRub(amount, rates)
  const apr = Number(card.apr) || 0
  const daysTotal = Math.max(0, Math.round((repayDate - loanDate) / 86400000))
  if (card.transferGraceEnabled === false) {
    return apr * amt * daysTotal / 365
  }
  const limit = moneyToRub(card.transferLimit, rates)
  const free = Math.min(amt, limit)
  const over = Math.max(0, amt - limit)
  const graceEnd = addDays(loanDate, Number(card.transferGraceDays) || 0)
  const overInterest = apr * over * daysTotal / 365
  let freeInterest = 0
  if (repayDate > graceEnd) {
    const daysOver = Math.round((repayDate - graceEnd) / 86400000)
    freeInterest = apr * free * daysOver / 365
  }
  return overInterest + freeInterest
}

// Цена переноса долга НА карту toCard (в рублях): комиссия + проценты + сведения о лимите.
// toCard - карта, на которую переезжает долг (она платит). transferDate/repayDate - Date.
export function transferCost(toCard, amount, transferDate, repayDate, rates) {
  const amtRub = moneyToRub(amount, rates)
  const limit = moneyToRub(toCard.transferLimit, rates)
  const free = moneyToRub(toCard.creditLimit, rates) - moneyToRub(toCard.currentDebt, rates)
  const availableLimit = Math.min(limit, Math.max(0, free))
  const exceedsLimit = amtRub > availableLimit
  const fee = (Number(toCard.transferFeePercent) || 0) / 100 * amtRub + moneyToRub(toCard.transferFeeFixed, rates)
  const interest = cardLoanInterest(toCard, amount, transferDate, repayDate, rates)
  return { fee, interest, total: fee + interest, availableLimit, exceedsLimit }
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
      if (!parseDate(move.date)) break // неполный ход (нет даты) - пропускаем
      s.expenses.push({
        id: sid('sc_exp'), name: move.title || 'Покупка',
        amount: move.amount.amount, currency: move.amount.currency,
        category: 'Сценарий', owner: 'family', schedule: onceSchedule(move.date),
      })
      break
    case 'adjust':
      if (!parseDate(move.date)) break // неполный ход (нет даты) - пропускаем
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
      const start = parseDate(move.startDate)
      if (!start) break // неполный ход (нет даты) - пропускаем
      const day = start.getDate()
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
      // currentDebt карты не меняем (модель A). Возврат - событие-расход в evaluateScenario.
      break
    }
    case 'transfer': {
      if (!parseDate(move.date)) break // неполный ход (нет даты) - пропускаем
      // Гасим долг fromCardId (долг снят с этой карты этим переносом).
      const from = s.cards.find((c) => c.id === move.fromCardId)
      if (from && from.currentDebt) {
        const inFromCurrency = convert(move.amount.amount, move.amount.currency, from.currentDebt.currency, s.settings.rates)
        from.currentDebt.amount = Math.max(0, from.currentDebt.amount - inFromCurrency)
      }
      // toCardId (долг переезжает): currentDebt НЕ трогаем (модель A). Рост и возврат -
      // парным событием в evaluateScenario. Наличные не добавляем.
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
  const buffer = moneyToRub(state.settings.safetyBuffer, rates)

  const forked = applyScenario(state, scenario)
  const cardLoans = (scenario.moves || []).filter((m) => m.type === 'cardLoan')

  const graceOk = []
  let cardInterest = 0
  for (const move of cardLoans) {
    const card = forked.cards.find((c) => c.id === move.cardId)
    const loanDate = parseDate(move.date)
    if (!loanDate || !card) continue // неполный ход или карта удалена - не считаем заём
    const amtRub = moneyToRub(move.amount, rates)
    let repayDate
    // Ручной возврат: режим 'manual' + отдельное поле repayDate (формат UI-редактора),
    // либо объект { date } (совместимость). Иначе - авто-возврат по порогу ниже.
    const manualDate = move.repayDate || (move.repay && move.repay.date)
    if (move.repay !== 'auto' && manualDate) {
      repayDate = parseDate(manualDate)
    } else {
      // авто: первый день ПОСЛЕ займа, когда на счету есть сумма займа сверх подушки
      // безопасности (balance >= amtRub + buffer) - "вернуть, оставив подушку".
      // НЕ требуем восстановить весь стартовый кэш (это уводило бы возврат за грейс
      // при любой крупной покупке и делало инструмент бесполезно пессимистичным).
      const probe = buildForecast(forked, { from })
      repayDate = null
      for (const day of probe.days) {
        if (day.date > loanDate && day.balance >= amtRub + buffer) { repayDate = day.date; break }
      }
      if (!repayDate) repayDate = probe.end // не закрыт до конца горизонта
    }
    // Модель A: заём чисто кассовый. cardLoan дал +amount (income), здесь ставим парный
    // возврат -amount на repayDate. Нетто по cash = 0 (взял+вернул). currentDebt карты
    // не рос (модель A), поэтому карта не создаёт лишнего гашения - двойного счёта нет.
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

  // Ходы переноса долга: возврат нового долга toCardId + цена перевода.
  const transfers = (scenario.moves || []).filter((m) => m.type === 'transfer')
  const transferWarnings = []
  let transferTotal = 0
  for (const move of transfers) {
    const toCard = forked.cards.find((c) => c.id === move.toCardId)
    const transferDate = parseDate(move.date)
    if (!transferDate || !toCard) continue // неполный ход или карта удалена
    const amtRub = moneyToRub(move.amount, rates)
    let repayDate
    const manualDate = move.repayDate || (move.repay && move.repay.date)
    if (move.repay !== 'auto' && manualDate) {
      repayDate = parseDate(manualDate)
    } else {
      const probe = buildForecast(forked, { from })
      repayDate = null
      for (const day of probe.days) {
        if (day.date > transferDate && day.balance >= amtRub + buffer) { repayDate = day.date; break }
      }
      if (!repayDate) repayDate = probe.end
    }
    // Возврат нового долга toCardId деньгами - событие-расход -amount.
    forked.expenses.push({
      id: sid('sc_transfer_repay'), name: `Возврат переноса (${move.toCardId})`,
      amount: move.amount.amount, currency: move.amount.currency,
      category: 'Сценарий', owner: 'family',
      schedule: { frequency: 'once', interval: 1, startDate: fmtISO(repayDate), endDate: null },
    })
    const cost = transferCost(toCard, move.amount, transferDate, repayDate, rates)
    transferTotal += cost.total
    const graceEnd = addDays(transferDate, Number(toCard.transferGraceDays) || 0)
    graceOk.push(toCard.transferGraceEnabled !== false ? repayDate <= graceEnd : false)
    if (cost.exceedsLimit) {
      transferWarnings.push({ toCardId: move.toCardId, amount: amtRub, availableLimit: cost.availableLimit })
    }
  }

  // проценты по новым кредитам (сумму конвертируем в рубли - overpayment в рублях).
  // Неполные ходы (без валидной даты) пропускаем, как и в applyScenario/цикле займов.
  let loanInterest = 0
  for (const m of (scenario.moves || [])) {
    if (m.type === 'newLoan' && parseDate(m.startDate)) loanInterest += annuityInterest(moneyToRub(m.amount, rates), m.apr, m.termMonths)
  }

  const forecast = buildForecast(forked, { from })

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
      overpayment: Math.round(cardInterest + loanInterest + transferTotal),
      transferWarnings,
      graceOk,
      breakEvenDate,
      risk,
    },
  }
}
