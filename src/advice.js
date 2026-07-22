// Оптимизатор-советник: правила-эвристики → ранжированные рекомендации по картам.
// Слой поверх ядра (finance.js) и движка сценариев (scenarios.js). Не мутирует state.
import { buildForecast, buildMonthly, cardDebt, fmtISO, fmtHuman, addDays, accountsBuffer } from './finance.js'
import { transferCost } from './scenarios.js'
import { moneyToRub } from './money.js'

// Доступный лимит перевода НА карту (в рублях): min(беспроцентный лимит, свободный лимит).
function availableLimit(card, rates) {
  const limit = moneyToRub(card.transferLimit, rates)
  const free = moneyToRub(card.creditLimit, rates) - moneyToRub(card.currentDebt, rates)
  return Math.min(limit, Math.max(0, free))
}

// Карта-приёмник для перелива: среди карт с грейсом на перевод (transferGraceEnabled)
// выбираем ту, у которой больше всего свободного лимита. Нет подходящих карт → null.
export function pickReceiver(state, rates) {
  let best = null
  let bestFree = 0
  for (const c of state.cards || []) {
    if (c.disabled || !c.transferGraceEnabled) continue
    const av = availableLimit(c, rates)
    if (av > bestFree) { best = c; bestFree = av }
  }
  return best
}

const SEV_ORDER = { critical: 0, warning: 1, save: 2 }

// Генерирует ранжированные рекомендации по картам: critical (кассовый разрыв к платежу
// карты), save (перенос дорогого долга под грейс, порядок погашения свободных денег).
// Не мутирует state. opts.from - ISO-дата начала прогноза (по умолчанию сегодня).
export function cardAdvice(state, opts = {}) {
  const rates = state.settings.rates
  const forecast = buildForecast(state, opts.from ? { from: opts.from } : {})
  const start = forecast.start
  const receiver = pickReceiver(state, rates)
  const out = []

  // Правило 1 (critical): кассовый разрыв к дате card-события (платёж по карте).
  const buffer = accountsBuffer(state, rates)
  for (const day of forecast.days) {
    const cardEv = day.events.find((e) => e.kind === 'card')
    if (!cardEv) continue
    if (day.balance < buffer) {
      const shortfall = Math.max(0, buffer - day.balance)
      let action = null
      if (receiver && shortfall > 0) {
        const amt = Math.min(shortfall, availableLimit(receiver, rates))
        if (amt > 0) {
          // card-события buildForecast не несут cardId в meta (только owner/bank/
          // statementDate/graceDate), поэтому fromCardId для кассового разрыва оставляем
          // null - важен приёмник (куда перевести деньги), а не конкретная карта-источник.
          action = {
            type: 'transfer', fromCardId: null, toCardId: receiver.id,
            amount: { amount: Math.round(amt), currency: 'RUB' },
            date: fmtISO(day.date), repay: 'auto', repayDate: '',
          }
        }
      }
      out.push({
        severity: 'critical', kind: 'shortfall',
        title: `Риск нехватки к ${fmtHuman(day.date)}`,
        why: `На ${fmtHuman(day.date)} остаток ${Math.round(day.balance)} руб ниже буфера ${Math.round(buffer)} руб при платеже по карте.`,
        action,
      })
      break // одного критического предупреждения достаточно
    }
  }

  // Правило 2 (save): перенос дорогого долга под грейс приёмника.
  if (receiver) {
    const saves = []
    for (const card of state.cards || []) {
      if (card.disabled || card.id === receiver.id) continue
      const debt = cardDebt(card, rates)
      const apr = Number(card.apr) || 0
      if (debt <= 0 || apr <= 0) continue
      const av = availableLimit(receiver, rates)
      if (av <= 0) continue
      const amt = Math.min(debt, av)
      // Проценты, которые набежали бы на исходной карте за грейс-период приёмника.
      const days = Number(receiver.transferGraceDays) || 55
      const interestOnSource = apr * amt * days / 365
      // Цена перелива на приёмника (комиссия + проценты приёмника вне его грейса).
      const repayDate = addDays(start, days)
      const cost = transferCost(receiver, { amount: Math.round(amt), currency: 'RUB' }, start, repayDate, rates)
      const saved = interestOnSource - cost.total
      if (saved > 0) {
        saves.push({
          severity: 'save', kind: 'transfer-save',
          title: `Перенести долг ${card.name} на ${receiver.name}`,
          why: `Перенос ${Math.round(amt)} руб сэкономит примерно ${Math.round(saved)} руб (проценты ${Math.round(interestOnSource)} минус цена переноса ${Math.round(cost.total)}) за грейс ${days} дней.`,
          action: {
            type: 'transfer', fromCardId: card.id, toCardId: receiver.id,
            amount: { amount: Math.round(amt), currency: 'RUB' },
            date: fmtISO(start), repay: 'auto', repayDate: '',
          },
          _saved: saved,
        })
      }
    }
    saves.sort((a, b) => b._saved - a._saved)
    for (const s of saves) { delete s._saved; out.push(s) }
  }

  // Правило 3 (save, информационное): куда направить свободный месячный профицит.
  const monthly = buildMonthly(state, rates, start, state.settings.horizonMonths ?? 6)
  if (monthly.surplus > 0) {
    const withDebt = (state.cards || []).filter((c) => !c.disabled && cardDebt(c, rates) > 0)
    if (withDebt.length > 0) {
      const priciest = withDebt.slice().sort((a, b) => (Number(b.apr) || 0) - (Number(a.apr) || 0))[0]
      out.push({
        severity: 'save', kind: 'payoff-order',
        title: 'Куда направить свободные деньги',
        why: `Свободный профицит ${Math.round(monthly.surplus)} руб/мес. Гасите первой самую дорогую карту: ${priciest.name} (${((Number(priciest.apr) || 0) * 100).toFixed(1)}% годовых).`,
        action: null,
      })
    }
  }

  out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
  return out
}
