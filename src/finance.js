// Финансовое ядро: работа с датами, разворачивание регулярности (schedule),
// движок прогноза денежного потока и расчёт целей. Чистые функции — тестируемо.

import { moneyToRub } from './money.js'

// ---------- Даты (локальные, без сдвигов TZ) ----------

export function parseDate(s) {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate())
  if (!s) return null
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function fmtISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function today() {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

export function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate()
}

// Прибавить n месяцев, сохранив «желаемый» день (anchor) с клампом к концу месяца.
export function addMonths(d, n, anchorDay) {
  const targetMonth = d.getMonth() + n
  const year = d.getFullYear() + Math.floor(targetMonth / 12)
  const monthIdx = ((targetMonth % 12) + 12) % 12
  const day = Math.min(anchorDay ?? d.getDate(), daysInMonth(year, monthIdx))
  return new Date(year, monthIdx, day)
}

export function clampDayToMonth(year, monthIdx, day) {
  return new Date(year, monthIdx, Math.min(day, daysInMonth(year, monthIdx)))
}

export function diffDays(a, b) {
  return Math.round((a - b) / 86400000)
}

export function isBetween(d, start, end) {
  if (start && d < start) return false
  if (end && d > end) return false
  return true
}

const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
export function fmtHuman(d) {
  if (!d) return '—'
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`
}
export function fmtMonthYear(d) {
  const full = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
  return `${full[d.getMonth()]} ${d.getFullYear()}`
}

// ---------- Регулярность (schedule) ----------
// schedule = { frequency, interval, customUnit, startDate, endDate }
// frequency: once | weekly | biweekly | monthly | quarterly | yearly | custom

export const FREQUENCIES = [
  { value: 'once', label: 'Разово' },
  { value: 'weekly', label: 'Еженедельно' },
  { value: 'biweekly', label: 'Раз в 2 недели' },
  { value: 'monthly', label: 'Ежемесячно' },
  { value: 'quarterly', label: 'Раз в квартал' },
  { value: 'yearly', label: 'Ежегодно' },
  { value: 'custom', label: 'Свой интервал' },
]

// Разворачивает schedule в конкретные даты в диапазоне [rangeStart, rangeEnd].
export function expandSchedule(schedule, rangeStart, rangeEnd) {
  if (!schedule) return []
  const start = parseDate(schedule.startDate) || rangeStart
  const end = schedule.endDate ? parseDate(schedule.endDate) : null
  const hardEnd = end && end < rangeEnd ? end : rangeEnd
  const out = []

  const push = (d) => {
    if (d >= rangeStart && d <= hardEnd && (!start || d >= start) && isBetween(d, null, end)) {
      out.push(d)
    }
  }

  const freq = schedule.frequency || 'monthly'

  if (freq === 'once') {
    push(start)
    return out
  }

  // Дневные шаги (weekly / biweekly / custom-days)
  let stepDays = 0
  let stepMonths = 0
  const interval = Math.max(1, Number(schedule.interval) || 1)

  if (freq === 'weekly') stepDays = 7
  else if (freq === 'biweekly') stepDays = 14
  else if (freq === 'monthly') stepMonths = 1
  else if (freq === 'quarterly') stepMonths = 3
  else if (freq === 'yearly') stepMonths = 12
  else if (freq === 'custom') {
    if (schedule.customUnit === 'weeks') stepDays = 7 * interval
    else if (schedule.customUnit === 'days') stepDays = interval
    else stepMonths = interval // months по умолчанию
  }

  const anchorDay = start.getDate()
  let guard = 0
  if (stepDays > 0) {
    let d = new Date(start)
    // догоняем до начала диапазона
    while (d < rangeStart && guard < 100000) { d = addDays(d, stepDays); guard++ }
    while (d <= hardEnd && guard < 100000) {
      push(d)
      d = addDays(d, stepDays)
      guard++
    }
  } else if (stepMonths > 0) {
    let k = 0
    let d = start
    while (d < rangeStart && guard < 100000) { k++; d = addMonths(start, k * stepMonths, anchorDay); guard++ }
    while (d <= hardEnd && guard < 100000) {
      push(d)
      k++
      d = addMonths(start, k * stepMonths, anchorDay)
      guard++
    }
  }
  return out
}

// Сколько раз в месяц срабатывает schedule (для месячных эквивалентов и сумм целей).
export function monthlyFactor(schedule) {
  const freq = schedule?.frequency || 'monthly'
  const interval = Math.max(1, Number(schedule?.interval) || 1)
  switch (freq) {
    case 'once': return 0
    case 'weekly': return 52 / 12
    case 'biweekly': return 26 / 12
    case 'monthly': return 1
    case 'quarterly': return 1 / 3
    case 'yearly': return 1 / 12
    case 'custom':
      if (schedule.customUnit === 'weeks') return (52 / 12) / interval
      if (schedule.customUnit === 'days') return 30 / interval
      return 1 / interval // months
    default: return 1
  }
}

// ---------- Кредитки ----------

// Минимальный платёж по карте (в рублях).
export function cardMinPayment(card, rates) {
  const base = moneyToRub(card.statementBalance || card.currentDebt, rates)
  const pct = (Number(card.minPaymentPercent) || 0) / 100
  const byPct = base * pct
  const fixed = moneyToRub(card.minPaymentFixed, rates)
  const min = Math.max(byPct, fixed)
  return Math.min(min, base) // не больше долга
}

// Дата ближайшего платежа по карте: первый день `dueDay` СТРОГО после выписки.
export function cardNextDue(card, from = today()) {
  const stmtDay = Number(card.statementDay) || 1
  const dueDay = Number(card.dueDay) || stmtDay
  // Находим последнюю прошедшую (или ближайшую) выписку и следующий dueDay после неё,
  // но не раньше сегодняшнего дня.
  for (let offset = -1; offset < 14; offset++) {
    const base = addMonths(from, offset, 1)
    const stmt = clampDayToMonth(base.getFullYear(), base.getMonth(), stmtDay)
    // следующий dueDay строго после выписки
    let due = clampDayToMonth(stmt.getFullYear(), stmt.getMonth(), dueDay)
    if (due <= stmt) due = clampDayToMonth(stmt.getFullYear(), stmt.getMonth() + 1, dueDay)
    if (due >= from) return { statement: stmt, due }
  }
  return { statement: from, due: from }
}

// ---------- Движок прогноза ----------
// Возвращает { events, days, alerts, monthly } — таймлайн с нарастающим остатком.

export function buildForecast(state, opts = {}) {
  const rates = state.settings.rates
  const start = opts.from ? parseDate(opts.from) : today()
  const horizonMonths = opts.horizonMonths ?? state.settings.horizonMonths ?? 6
  const end = addMonths(start, horizonMonths, start.getDate())
  const buffer = moneyToRub(state.settings.safetyBuffer, rates)

  const events = []
  const add = (date, amount, kind, title, meta = {}) => {
    if (!date || date < start || date > end) return
    events.push({ date, amount, kind, title, ...meta })
  }

  // Доходы (+)
  for (const inc of state.incomes || []) {
    if (inc.disabled) continue
    const rub = moneyToRub(inc, rates)
    for (const d of expandSchedule(inc.schedule, start, end)) {
      add(d, +rub, 'income', inc.name, { owner: inc.owner, native: { amount: inc.amount, currency: inc.currency } })
    }
  }

  // Расходы (−)
  for (const ex of state.expenses || []) {
    if (ex.disabled) continue
    const rub = moneyToRub(ex, rates)
    for (const d of expandSchedule(ex.schedule, start, end)) {
      add(d, -rub, 'expense', ex.name, { owner: ex.owner, category: ex.category, native: { amount: ex.amount, currency: ex.currency } })
    }
  }

  // Кредиты (−) — ежемесячно на paymentDay, ограничено остатком долга
  for (const loan of state.loans || []) {
    if (loan.disabled) continue
    const pay = moneyToRub(loan, rates)
    const remaining = moneyToRub(loan.remainingBalance, rates)
    const maxN = remaining > 0 ? Math.ceil(remaining / Math.max(pay, 1)) : Infinity
    let n = 0
    for (let m = 0; m <= horizonMonths + 1; m++) {
      const d = clampDayToMonth(start.getFullYear(), start.getMonth() + m, Number(loan.paymentDay) || 1)
      if (d < start || d > end) continue
      if (n >= maxN) break
      add(d, -pay, 'loan', loan.name, { owner: loan.owner })
      n++
    }
  }

  // Кредитки (−) — ОДНО ближайшее обязательство на карту (снимок текущего долга).
  for (const card of state.cards || []) {
    if (card.disabled) continue
    const debt = moneyToRub(card.statementBalance || card.currentDebt, rates)
    if (debt <= 0) continue
    const { statement, due } = cardNextDue(card, start)
    const full = card.payStrategy !== 'minimum'
    const amount = full ? debt : cardMinPayment(card, rates)
    add(due, -amount, 'card', `${card.name} (${full ? 'полное' : 'минимум'})`, {
      owner: card.owner,
      bank: card.bank,
      statementDate: statement,
      strategy: full ? 'full' : 'minimum',
      minPayment: cardMinPayment(card, rates),
      fullPayment: debt,
    })
  }

  // Сортировка по дате
  events.sort((a, b) => a.date - b.date || (a.amount - b.amount))

  // Нарастающий остаток
  const startingCash = moneyToRub(state.settings.startingCash, rates)
  let balance = startingCash
  const days = []
  const alerts = []
  let minBalance = balance
  let minBalanceDate = start

  // группируем по дате
  const byDate = new Map()
  for (const e of events) {
    const key = fmtISO(e.date)
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key).push(e)
  }
  for (const [key, evs] of byDate) {
    const dayTotal = evs.reduce((s, e) => s + e.amount, 0)
    balance += dayTotal
    const d = parseDate(key)
    days.push({ date: d, events: evs, dayTotal, balance })
    if (balance < minBalance) { minBalance = balance; minBalanceDate = d }
    if (balance < buffer) {
      alerts.push({
        date: d,
        balance,
        shortfall: buffer - balance,
        belowZero: balance < 0,
        buffer,
      })
    }
  }

  // Месячные сводки
  const monthly = buildMonthly(state, rates, start, horizonMonths)

  return {
    start, end, startingCash, buffer,
    events, days, alerts,
    minBalance, minBalanceDate,
    endBalance: balance,
  }
}

// Месячные эквиваленты доход/расход (устойчивая картина «в среднем за месяц»).
export function buildMonthly(state, rates, start = today(), horizonMonths = 6) {
  let incomeM = 0
  for (const inc of state.incomes || []) {
    if (inc.disabled) continue
    incomeM += moneyToRub(inc, rates) * monthlyFactor(inc.schedule)
  }
  let expenseM = 0
  for (const ex of state.expenses || []) {
    if (ex.disabled) continue
    expenseM += moneyToRub(ex, rates) * monthlyFactor(ex.schedule)
  }
  let loanM = 0
  for (const loan of state.loans || []) {
    if (loan.disabled) continue
    loanM += moneyToRub(loan, rates)
  }
  const obligatory = expenseM + loanM
  return {
    income: incomeM,
    expense: expenseM,
    loan: loanM,
    obligatory,
    surplus: incomeM - obligatory,
  }
}

// ---------- Цели ----------
// Свободный месячный профицит распределяется последовательно по приоритету
// на цели без собственного взноса; цели с ручным взносом считаются параллельно.

export function computeGoals(state, opts = {}) {
  const rates = state.settings.rates
  const monthly = buildMonthly(state, rates)
  // возможные what-if дельты
  const extraIncome = opts.extraIncome || 0
  const extraExpense = opts.extraExpense || 0
  const surplus = Math.max(0, monthly.surplus + extraIncome - extraExpense)

  const goals = (state.goals || [])
    .slice()
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))

  const now = today()
  let sharedStartMonth = 0 // для последовательных целей

  const results = []
  for (const g of goals) {
    const target = moneyToRub(g.targetAmount, rates)
    const saved = moneyToRub(g.currentSaved, rates)
    const remaining = Math.max(0, target - saved)
    const manual = moneyToRub(g.monthlyContribution, rates)

    let contribution
    let startMonth
    if (manual > 0) {
      contribution = manual
      startMonth = 0
    } else {
      contribution = surplus
      startMonth = sharedStartMonth
    }

    let monthsNeeded = null
    let etaDate = null
    let reachable = contribution > 0
    if (remaining <= 0) {
      monthsNeeded = 0
      etaDate = now
      reachable = true
    } else if (contribution > 0) {
      monthsNeeded = Math.ceil(remaining / contribution)
      etaDate = addMonths(now, startMonth + monthsNeeded, now.getDate())
    }

    // цели из общего профицита занимают его последовательно
    if (manual <= 0 && contribution > 0 && remaining > 0) {
      sharedStartMonth = startMonth + monthsNeeded
    }

    const progress = target > 0 ? Math.min(1, saved / target) : 0
    let onTrack = null
    let neededContribution = null
    if (g.targetDate) {
      const td = parseDate(g.targetDate)
      const monthsAvail = Math.max(0, monthsBetween(now, td))
      neededContribution = monthsAvail > 0 ? remaining / monthsAvail : remaining
      onTrack = etaDate && td ? etaDate <= td : false
      if (remaining <= 0) onTrack = true
    }

    results.push({
      goal: g,
      target, saved, remaining, progress,
      contribution, monthsNeeded, etaDate, reachable,
      onTrack, neededContribution,
      targetDate: g.targetDate ? parseDate(g.targetDate) : null,
    })
  }
  return { surplus, monthly, results }
}

export function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
    + (b.getDate() >= a.getDate() ? 0 : -1)
}
