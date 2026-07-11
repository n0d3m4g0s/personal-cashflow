// Мультивалюта. Базовая валюта — рубль (RUB). Всегда работаем с 3 валютами.
// Денежная величина хранится как { currency, amount } в НАТИВНОЙ валюте записи.
// Курсы (rates) задают, сколько единиц валюты приходится на 1 ₽.

export const CURRENCIES = ['RUB', 'AMD', 'USD']

export const CURRENCY_META = {
  RUB: { symbol: '₽', label: 'Рубль', locale: 'ru-RU' },
  AMD: { symbol: '֏', label: 'Драм', locale: 'hy-AM' },
  USD: { symbol: '$', label: 'Доллар', locale: 'en-US' },
}

// Курсы по умолчанию: сколько валюты за 1 рубль (редактируются в Настройках).
// 1 ₽ ≈ 4.6 драма, 1 ₽ ≈ 0.0118 $ (≈ 85 ₽/$). Ориентировочно — правьте под факт.
export const DEFAULT_RATES = {
  amdPerRub: 4.6,
  usdPerRub: 0.0118,
}

// сколько единиц `currency` в одном рубле
function unitsPerRub(currency, rates) {
  switch (currency) {
    case 'RUB': return 1
    case 'AMD': return rates.amdPerRub || 0
    case 'USD': return rates.usdPerRub || 0
    default: return 1
  }
}

// Перевод нативной суммы в рубли (базовую валюту).
export function toRub(amount, currency, rates) {
  const u = unitsPerRub(currency, rates)
  if (!u) return 0
  return amount / u
}

// Перевод из рублей в указанную валюту.
export function fromRub(rub, currency, rates) {
  return rub * unitsPerRub(currency, rates)
}

// Конвертация между любыми валютами.
export function convert(amount, from, to, rates) {
  if (from === to) return amount
  return fromRub(toRub(amount, from, rates), to, rates)
}

// Money-объект { currency, amount } → рубли.
export function moneyToRub(money, rates) {
  if (!money) return 0
  return toRub(Number(money.amount) || 0, money.currency || 'RUB', rates)
}

export function money(amount, currency = 'RUB') {
  return { amount: Number(amount) || 0, currency }
}

// Форматирование суммы в конкретной валюте.
export function formatMoney(amount, currency = 'RUB', opts = {}) {
  const meta = CURRENCY_META[currency] || CURRENCY_META.RUB
  const maxFrac = opts.maxFrac ?? (currency === 'USD' ? 2 : 0)
  const num = new Intl.NumberFormat(meta.locale, {
    maximumFractionDigits: maxFrac,
    minimumFractionDigits: 0,
  }).format(Math.round((Number(amount) || 0) * 10 ** maxFrac) / 10 ** maxFrac)
  return `${num} ${meta.symbol}`
}

// Компактная строка «эквивалентов» во всех валютах, начиная с рублей.
// rub — сумма в рублях; возвращает, напр., "12 300 ₽ · 56 580 ֏ · 145 $".
export function formatAllFromRub(rub, rates, { skip = [] } = {}) {
  return CURRENCIES
    .filter((c) => !skip.includes(c))
    .map((c) => formatMoney(fromRub(rub, c, rates), c))
    .join(' · ')
}

// Эквиваленты в двух «неродных» валютах (для строки под основной суммой).
export function equivalentsFromRub(rub, rates, primary = 'RUB') {
  return CURRENCIES.filter((c) => c !== primary).map((c) => ({
    currency: c,
    amount: fromRub(rub, c, rates),
    text: formatMoney(fromRub(rub, c, rates), c),
  }))
}
