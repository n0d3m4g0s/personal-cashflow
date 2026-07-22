// Финансовое ядро: работа с датами, разворачивание регулярности (schedule),
// движок прогноза денежного потока и расчёт целей. Чистые функции — тестируемо.

import { moneyToRub, convert } from './money.js'

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

// Актуальный долг карты (в рублях): сумма выписки, если она > 0, иначе текущий долг.
// statementBalance в проде — всегда объект (в т.ч. {amount:0}), поэтому нельзя писать
// `statementBalance || currentDebt` — пустой объект truthy и дал бы долг 0.
export function cardDebt(card, rates) {
  const sb = card.statementBalance
  const hasStatement = sb && (Number(sb.amount) || 0) > 0
  return moneyToRub(hasStatement ? sb : card.currentDebt, rates)
}

// Тело минимального платежа БЕЗ процентов от произвольного остатка (в рублях):
// max(% от остатка, фикс), но не больше остатка. Проценты (для minPaymentPlusInterest)
// начисляются отдельно вызывающим кодом - здесь их нет, чтобы не задваивать в графике.
export function cardMinCore(card, balanceRub, rates) {
  const byPct = balanceRub * (Number(card.minPaymentPercent) || 0) / 100
  const fixed = moneyToRub(card.minPaymentFixed, rates)
  return Math.min(Math.max(byPct, fixed), Math.max(0, balanceRub))
}

// Обязательный (минимальный) платёж по карте (в рублях): тело (cardMinCore) + проценты,
// если minPaymentPlusInterest, но не больше долга.
export function cardMinPayment(card, rates) {
  const debt = cardDebt(card, rates)
  const core = cardMinCore(card, debt, rates)
  let interest = 0
  if (card.minPaymentPlusInterest) {
    const apr = Number(card.apr) || 0
    const days = Number(card.statementCycleDays) || 30
    interest = debt * apr * days / 365
  }
  return Math.min(core + interest, debt)
}

// Ряд событий погашения карты по стратегии minimum до закрытия долга или конца горизонта.
// Каждый месяц: проценты на остаток + тело (cardMinCore); остаток уменьшается на тело.
export function cardPaymentSchedule(card, rates, from, end) {
  let remaining = cardDebt(card, rates)
  if (remaining <= 0) return []
  const apr = Number(card.apr) || 0
  const days = Number(card.statementCycleDays) || 30
  const out = []
  // Первый due - актуальный цикл на дату from. Дальше катим монотонно помесячно от первого
  // due (addMonths с якорным днём), а не через cardCycle(from+k*days) - иначе при from, не
  // совпадающем с датой выписки, due для k=0 и k=1 совпал бы и платежи задвоились на одну дату.
  const first = cardCycle(card, from)
  const anchorDay = first.due.getDate()
  let due = first.due
  let k = 0
  let guard = 0
  while (remaining > 0 && guard < 600) {
    guard++
    if (due > end) break
    const interest = remaining * apr * days / 365
    const core = cardMinCore(card, remaining, rates)
    // платёж не больше остатка+проценты (последний платёж гасит всё)
    const pay = Math.min(core + interest, remaining + interest)
    const principalPaid = Math.max(0, pay - interest)
    remaining = Math.max(0, remaining - principalPaid)
    out.push({ date: due, amount: pay, remainingAfter: remaining, interest })
    k++
    due = addMonths(first.due, k, anchorDay)
    // защита: если тело не гасится (платёж <= проценты), прерываем, чтобы не зациклиться
    if (principalPaid <= 0) break
  }
  return out
}

// Актуальный на дату `from` цикл карты: { statement, due, graceEnd }.
// Хранимые даты — ISO ближайшего/последнего цикла; если он в прошлом, катим вперёд,
// сохраняя якорный день выписки и постоянные смещения due/graceEnd (в днях).
export function cardCycle(card, from = today()) {
  const stmt0 = parseDate(card.statementDate)
  const due0 = parseDate(card.dueDate) || stmt0
  const grace0 = parseDate(card.graceEndDate) || due0
  if (!stmt0) {
    // нет данных — деградируем к сегодняшнему дню
    return { statement: from, due: from, graceEnd: from }
  }
  const dueOffset = diffDays(due0, stmt0)     // дней от выписки до платежа
  const graceOffset = diffDays(grace0, stmt0) // дней от выписки до конца грейса
  const anchorDay = stmt0.getDate()
  const stepMonths = Math.max(1, Math.round((Number(card.statementCycleDays) || 30) / 30))

  let statement = stmt0
  let due = due0
  let guard = 0
  while (due < from && guard < 600) {
    guard++
    statement = addMonths(stmt0, guard * stepMonths, anchorDay)
    due = addDays(statement, dueOffset)
  }
  const graceEnd = addDays(statement, graceOffset)
  return { statement, due, graceEnd }
}

// Дата ближайшего платежа по карте. Новая модель — явные даты (через cardCycle);
// старая модель (statementDay/dueDay) — для обратной совместимости до миграции.
export function cardNextDue(card, from = today()) {
  if (card.statementDate) {
    const { statement, due } = cardCycle(card, from)
    return { statement, due }
  }
  const stmtDay = Number(card.statementDay) || 1
  const dueDay = Number(card.dueDay) || stmtDay
  for (let offset = -1; offset < 14; offset++) {
    const base = addMonths(from, offset, 1)
    const stmt = clampDayToMonth(base.getFullYear(), base.getMonth(), stmtDay)
    let due = clampDayToMonth(stmt.getFullYear(), stmt.getMonth(), dueDay)
    if (due <= stmt) due = clampDayToMonth(stmt.getFullYear(), stmt.getMonth() + 1, dueDay)
    if (due >= from) return { statement: stmt, due }
  }
  return { statement: from, due: from }
}

// Свободный лимит перевода на карту (в рублях): min(беспроцентный лимит, свободный лимит).
function cardTransferableFree(card, rates) {
  const limit = moneyToRub(card.transferLimit, rates)
  const free = moneyToRub(card.creditLimit, rates) - moneyToRub(card.currentDebt, rates)
  return Math.min(limit, Math.max(0, free))
}

// Сводка по всем картам: агрегаты для вкладки "Карты: стратегия".
export function cardsSummary(state, opts = {}) {
  const rates = state.settings.rates
  const start = opts.from ? parseDate(opts.from) : today()
  const horizonMonths = opts.horizonMonths ?? state.settings.horizonMonths ?? 6
  const end = addMonths(start, horizonMonths, start.getDate())

  let totalInterest = 0, monthlyMin = 0, totalDebt = 0
  let debtInGrace = 0, debtUnderInterest = 0
  let totalFreeLimit = 0, transferableFree = 0
  const perCard = []

  for (const card of state.cards || []) {
    if (card.disabled) continue
    // свободный лимит - по всем активным картам
    const free = Math.max(0, moneyToRub(card.creditLimit, rates) - moneyToRub(card.currentDebt, rates))
    totalFreeLimit += free
    if (card.transferGraceEnabled) transferableFree += cardTransferableFree(card, rates)

    const debt = cardDebt(card, rates)
    if (debt <= 0) continue
    totalDebt += debt
    monthlyMin += cardMinPayment(card, rates)

    const full = card.payStrategy !== 'minimum'
    if (full) {
      // full-карта: долг в грейсе, если grace не вышел; иначе под процентами
      const { graceEnd } = cardCycle(card, start)
      if (graceEnd >= start) debtInGrace += debt
      else debtUnderInterest += debt
    } else {
      // minimum: под процентами; проценты за горизонт из графика
      debtUnderInterest += debt
      const sched = cardPaymentSchedule(card, rates, start, end)
      for (const p of sched) totalInterest += p.interest
    }

    const { due, graceEnd } = cardCycle(card, start)
    perCard.push({
      id: card.id, name: card.name, bank: card.bank,
      debt, nextPayment: full ? debt : cardMinPayment(card, rates), nextDate: due, graceEnd,
      freeLimit: free, transferableFree: card.transferGraceEnabled ? cardTransferableFree(card, rates) : 0,
      apr: Number(card.apr) || 0, strategy: full ? 'full' : 'minimum',
    })
  }

  return { totalInterest, monthlyMin, totalDebt, debtInGrace, debtUnderInterest, totalFreeLimit, transferableFree, perCard }
}

// ---------- Счета ----------
// Источник истины для стартового капитала и буфера безопасности - state.accounts[].
// settings.startingCash/settings.safetyBuffer остались только для обратной совместимости
// (фолбэк, когда счетов ещё нет).

// Общий стартовый остаток (в рублях): сумма startingBalance по не-disabled счетам,
// сведённых в рубли. Фолбэк на settings.startingCash, если счетов нет.
export function accountsStartingCash(state, rates) {
  const accounts = (state.accounts || []).filter((a) => !a.disabled)
  if (accounts.length === 0) return moneyToRub(state.settings.startingCash, rates)
  return accounts.reduce(
    (s, a) => s + convert(Number(a.startingBalance) || 0, a.currency || 'RUB', 'RUB', rates), 0)
}

// Общий буфер безопасности (в рублях): сумма safetyBuffer по не-disabled счетам,
// сведённых в рубли. Фолбэк на settings.safetyBuffer, если счетов нет.
export function accountsBuffer(state, rates) {
  const accounts = (state.accounts || []).filter((a) => !a.disabled)
  if (accounts.length === 0) return moneyToRub(state.settings.safetyBuffer, rates)
  return accounts.reduce(
    (s, a) => s + convert(Number(a.safetyBuffer) || 0, a.currency || 'RUB', 'RUB', rates), 0)
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
      add(d, +rub, 'income', inc.name, { owner: inc.owner, accountId: inc.accountId ?? null, native: { amount: inc.amount, currency: inc.currency } })
    }
  }

  // Расходы (−)
  for (const ex of state.expenses || []) {
    if (ex.disabled) continue
    const rub = moneyToRub(ex, rates)
    for (const d of expandSchedule(ex.schedule, start, end)) {
      add(d, -rub, 'expense', ex.name, { owner: ex.owner, category: ex.category, accountId: ex.accountId ?? null, native: { amount: ex.amount, currency: ex.currency } })
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
      add(d, -pay, 'loan', loan.name, { owner: loan.owner, accountId: loan.accountId ?? null, native: { amount: loan.amount, currency: loan.currency } })
      n++
    }
  }

  // Кредитки (−). full: одно обязательство (весь долг в грейс). minimum: ряд платежей.
  for (const card of state.cards || []) {
    if (card.disabled) continue
    const debt = cardDebt(card, rates)
    if (debt <= 0) continue
    const { statement, due, graceEnd } = cardCycle(card, start)
    const full = card.payStrategy !== 'minimum'
    if (full) {
      add(due, -debt, 'card', `${card.name} (полное)`, {
        owner: card.owner, bank: card.bank, statementDate: statement, graceDate: graceEnd,
        strategy: 'full', minPayment: cardMinPayment(card, rates), fullPayment: debt, accountId: null,
      })
    } else {
      for (const p of cardPaymentSchedule(card, rates, start, end)) {
        add(p.date, -p.amount, 'card', `${card.name} (минимум)`, {
          owner: card.owner, bank: card.bank, statementDate: statement, graceDate: graceEnd,
          strategy: 'minimum', remainingAfter: p.remainingAfter, interest: p.interest, accountId: null,
        })
      }
    }
  }

  // Сортировка по дате
  events.sort((a, b) => a.date - b.date || (a.amount - b.amount))

  // Нарастающий остаток
  // Общий стартовый остаток - сумма стартовых остатков счетов, сведённых в рубли.
  const accounts = (state.accounts || []).filter((a) => !a.disabled)
  const startingCash = accountsStartingCash(state, rates)
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
  }

  // Раздельные дорожки по счетам (каждая в валюте своего счёта).
  const perAccount = accounts.map((account) => {
    const cur = account.currency || 'RUB'
    let bal = Number(account.startingBalance) || 0
    const accBuffer = Number(account.safetyBuffer) || 0
    const accDays = []
    const accAlerts = []
    let accMin = bal
    let accMinDate = start
    const accByDate = new Map()
    for (const e of events) {
      if (e.accountId !== account.id) continue
      const key = fmtISO(e.date)
      if (!accByDate.has(key)) accByDate.set(key, [])
      accByDate.get(key).push(e)
    }
    for (const [key, evs] of accByDate) {
      // конвертируем нативную сумму каждого события в валюту счёта, сохраняя знак
      const dayTotal = evs.reduce((s, e) => {
        const nativeAmt = e.native ? (Number(e.native.amount) || 0) : Math.abs(e.amount)
        const nativeCur = e.native ? (e.native.currency || 'RUB') : 'RUB'
        const inAcc = convert(nativeAmt, nativeCur, cur, rates)
        return s + (e.amount >= 0 ? inAcc : -inAcc)
      }, 0)
      bal += dayTotal
      const d = parseDate(key)
      accDays.push({ date: d, events: evs, dayTotal, balance: bal })
      if (bal < accMin) { accMin = bal; accMinDate = d }
      if (bal < accBuffer) {
        accAlerts.push({ date: d, balance: bal, shortfall: accBuffer - bal, belowZero: bal < 0,
          buffer: accBuffer, accountId: account.id, accountName: account.name, currency: cur })
      }
    }
    return { account, currency: cur, startingBalance: Number(account.startingBalance) || 0,
      days: accDays, alerts: accAlerts, minBalance: accMin, minBalanceDate: accMinDate,
      endBalance: bal, buffer: accBuffer }
  })

  for (const pa of perAccount) alerts.push(...pa.alerts)
  alerts.sort((a, b) => a.date - b.date)

  // Месячные сводки
  const monthly = buildMonthly(state, rates, start, horizonMonths)

  return {
    start, end, startingCash, buffer,
    events, days, alerts,
    minBalance, minBalanceDate,
    endBalance: balance,
    perAccount,
  }
}

// Мультивалютный таймлайн "по валютам счетов" (для режима "Все счета" в прогнозе).
// В отличие от perAccount (по каждому счёту, одна валюта), тут одна дорожка на КАЖДУЮ
// уникальную валюту счетов: остатки счетов одной валюты суммируются. Каждый day несёт
// { date, events, balances: {валюта: остаток}, danger }. События без accountId (карты)
// и события счетов, которых нет/выключены, относятся к рублёвой дорожке (как в общем балансе).
export function forecastByCurrency(state, opts = {}) {
  const rates = state.settings.rates
  const f = buildForecast(state, opts)
  const accounts = (state.accounts || []).filter((a) => !a.disabled)

  // валюты дорожек - уникальные валюты активных счетов (в порядке появления)
  const currencies = []
  for (const a of accounts) {
    const c = a.currency || 'RUB'
    if (!currencies.includes(c)) currencies.push(c)
  }
  if (!currencies.length) currencies.push('RUB')

  // старт и буфер по валютам - сумма по счетам этой валюты
  const startByCur = {}
  const buffers = {}
  for (const c of currencies) { startByCur[c] = 0; buffers[c] = 0 }
  for (const a of accounts) {
    const c = a.currency || 'RUB'
    startByCur[c] += Number(a.startingBalance) || 0
    buffers[c] += Number(a.safetyBuffer) || 0
  }

  // валюта дорожки для события: валюта его счёта, иначе рубли
  const accCurrency = (accountId) => {
    if (!accountId) return 'RUB'
    const a = (state.accounts || []).find((x) => x.id === accountId)
    return a ? (a.currency || 'RUB') : 'RUB'
  }

  const running = { ...startByCur }
  const days = []
  for (const day of f.days) {
    let danger = false
    for (const e of day.events) {
      const cur = accCurrency(e.accountId)
      if (!(cur in running)) { running[cur] = startByCur[cur] || 0; if (!(cur in buffers)) buffers[cur] = 0 }
      const nativeAmt = e.native ? (Number(e.native.amount) || 0) : Math.abs(e.amount)
      const nativeCur = e.native ? (e.native.currency || 'RUB') : 'RUB'
      const inCur = convert(nativeAmt, nativeCur, cur, rates)
      running[cur] += e.amount >= 0 ? inCur : -inCur
    }
    const balances = {}
    for (const c of Object.keys(running)) {
      balances[c] = running[c]
      if (running[c] < (buffers[c] || 0)) danger = true
    }
    days.push({ date: day.date, events: day.events, balances, danger })
  }

  const allCurrencies = Object.keys(running).length ? Object.keys(running) : currencies
  return { days, startByCur, buffers, currencies: allCurrencies, endByCur: { ...running } }
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
  let cardM = 0
  for (const card of state.cards || []) {
    if (card.disabled) continue
    if (cardDebt(card, rates) <= 0) continue
    cardM += cardMinPayment(card, rates)
  }
  const obligatory = expenseM + loanM + cardM
  return {
    income: incomeM,
    expense: expenseM,
    loan: loanM,
    card: cardM,
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
