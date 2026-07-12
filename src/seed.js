// Стартовые данные (префилл). Известное из задачи + базовые бытовые статьи
// расходов и примеры целей. Суммы/даты, которых мы не знаем, — плейсхолдеры,
// помеченные полем note; легко правятся и удаляются в интерфейсе.

import { DEFAULT_RATES } from './money.js'

let _id = 0
const id = (p) => `${p}_${++_id}`

// ISO-дата без сдвига TZ (локальный год/месяц/день, а не UTC).
function fmtLocalISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// ISO-дата дня `day` текущего месяца (для якорей регулярных платежей).
function dayThisMonth(day) {
  const n = new Date()
  return fmtLocalISO(new Date(n.getFullYear(), n.getMonth(), day))
}

// ISO-дата дня `day` следующего месяца.
function nextMonthDay(day) {
  const n = new Date()
  const d = new Date(n.getFullYear(), n.getMonth() + 1, day)
  return fmtLocalISO(d)
}

// ISO-дата дня `day` через `months` месяцев от текущего.
function monthsAheadDay(months, day) {
  const n = new Date()
  const d = new Date(n.getFullYear(), n.getMonth() + months, day)
  return fmtLocalISO(d)
}

const monthly = (day) => ({ frequency: 'monthly', interval: 1, startDate: dayThisMonth(day), endDate: null })

export function makeSeed() {
  // Карта жены создаётся заранее, чтобы её id можно было переиспользовать
  // в сид-сценарии (заём с карты жены) без хардкода.
  const wifeCard = card('Т-Банк (жена)', 'Т-Банк', 'wife', {
    limit: 195000, statementDate: nextMonthDay(8), dueDate: monthsAheadDay(1, 28),
    graceEndDate: monthsAheadDay(1, 28), grace: 55, statementCycleDays: 30,
    minPaymentPercent: 14, minPaymentFixed: 600, apr: 0.619,
    transferLimit: 150000, transferGraceDays: 55,
  })

  return {
    version: 1,
    settings: {
      startingCash: { amount: 150000, currency: 'RUB' },
      horizonMonths: 6,
      safetyBuffer: { amount: 50000, currency: 'RUB' },
      rates: { ...DEFAULT_RATES },
      baseCurrency: 'RUB',
    },

    // ---- Доходы ----
    incomes: [
      {
        id: id('inc'), name: 'Зарплата (муж, программист)', owner: 'husband',
        type: 'salary', amount: 300000, currency: 'RUB', schedule: monthly(10),
      },
      {
        id: id('inc'), name: 'Фриланс (опционально)', owner: 'husband',
        type: 'freelance', amount: 0, currency: 'RUB', schedule: monthly(20),
        disabled: true, note: 'Включите и укажите сумму, если есть доход от фриланса',
      },
    ],

    // ---- Кредиты ----
    loans: [
      {
        id: id('loan'), name: 'ИТ-ипотека', owner: 'husband',
        amount: 117000, currency: 'RUB', paymentDay: 15,
        remainingBalance: { amount: 0, currency: 'RUB' },
        note: 'Укажите остаток долга, чтобы прогноз знал, когда ипотека закроется (0 = бессрочно)',
      },
      {
        id: id('loan'), name: 'Потребительский кредит', owner: 'husband',
        amount: 27000, currency: 'RUB', paymentDay: 5,
        remainingBalance: { amount: 0, currency: 'RUB' },
        note: 'Укажите остаток долга по кредиту',
      },
    ],

    // ---- Кредитные карты ----
    // statementDate/dueDate/graceEndDate — явные даты ближайшего цикла (пользователь
    // подгоняет под себя); statementCycleDays — длина цикла выписки;
    // payStrategy: 'full' (гасим выписку, без процентов) | 'minimum' (только минимум).
    cards: [
      card('Т-Банк (муж)', 'Т-Банк', 'husband', {
        limit: 238000, statementDate: dayThisMonth(26), dueDate: nextMonthDay(19),
        graceEndDate: nextMonthDay(19), grace: 55, statementCycleDays: 30,
        minPaymentPercent: 14, minPaymentFixed: 600, apr: 0.619,
      }),
      card('Озон Банк', 'Озон Банк', 'husband', {
        limit: 49000, statementDate: nextMonthDay(8), dueDate: nextMonthDay(24),
        graceEndDate: monthsAheadDay(2, 8), grace: 120, statementCycleDays: 30,
        minPaymentPercent: 4, minPaymentFixed: 400, minPaymentPlusInterest: true, apr: 0.624,
      }),
      card('Уралсиб', 'Уралсиб', 'husband', {
        limit: 20000, statementDate: nextMonthDay(1), dueDate: nextMonthDay(30),
        graceEndDate: monthsAheadDay(2, 30), grace: 120, statementCycleDays: 30,
        minPaymentPercent: 3, minPaymentFixed: 300, minPaymentPlusInterest: true, apr: 0.999,
      }),
      card('Сбербанк', 'Сбербанк', 'husband', {
        limit: 20000, statementDate: dayThisMonth(15), dueDate: nextMonthDay(5),
        graceEndDate: nextMonthDay(5), grace: 120, statementCycleDays: 30,
        minPaymentPercent: 5, minPaymentFixed: 0, apr: 0,
      }),
      wifeCard,
    ],

    // ---- Расходы ----
    expenses: [
      // Известное из задачи
      expense('Аренда квартиры (Ереван)', 75000, 'RUB', 'Жильё', monthly(1), { note: 'Если платите в драмах — переключите валюту записи на AMD' }),
      expense('Расходы ИП (Армения)', 15000, 'RUB', 'ИП/Бизнес', monthly(25), { note: 'Уточните сумму: налоги/соцвзносы/бухгалтерия ИП' }),
      expense('Обслуживание счёта и карты (ИП)', 2000, 'RUB', 'ИП/Бизнес', monthly(25), { note: 'Комиссии банка за обслуживание' }),
      // Базовые бытовые статьи (плейсхолдеры — правьте под себя)
      expense('Продукты', 60000, 'RUB', 'Еда', monthly(1)),
      expense('Кафе и рестораны', 15000, 'RUB', 'Еда', monthly(1)),
      expense('Коммуналка, свет, вода', 10000, 'RUB', 'Жильё', monthly(10)),
      expense('Связь и интернет', 3000, 'RUB', 'Связь', monthly(10)),
      expense('Транспорт / такси / бензин', 12000, 'RUB', 'Транспорт', monthly(1)),
      expense('Здоровье и аптека', 8000, 'RUB', 'Здоровье', monthly(1)),
      expense('Ветеринар и корм (2 мопса)', 10000, 'RUB', 'Питомцы', monthly(1)),
      expense('Одежда и обувь', 8000, 'RUB', 'Одежда', monthly(1)),
      expense('Подписки (стриминг, сервисы)', 2500, 'RUB', 'Подписки', monthly(1)),
      expense('Развлечения и досуг', 10000, 'RUB', 'Досуг', monthly(1)),
      expense('Прочие / непредвиденные', 10000, 'RUB', 'Прочее', monthly(1)),
    ],

    // ---- Финансовые цели ----
    goals: [
      {
        id: id('goal'), name: 'Подушка безопасности', priority: 1,
        targetAmount: { amount: 600000, currency: 'RUB' },
        currentSaved: { amount: 150000, currency: 'RUB' },
        targetDate: null, monthlyContribution: { amount: 0, currency: 'RUB' },
        note: '≈ 3–4 месяца обязательных расходов',
      },
      {
        id: id('goal'), name: 'Досрочное погашение кредита 27к', priority: 2,
        targetAmount: { amount: 100000, currency: 'RUB' },
        currentSaved: { amount: 0, currency: 'RUB' },
        targetDate: null, monthlyContribution: { amount: 0, currency: 'RUB' },
        note: 'Укажите реальный остаток по кредиту как цель',
      },
    ],

    // ---- Сценарии "что если" ----
    scenarios: [
      {
        id: id('scenario'), name: 'Билеты (заём с карты жены)',
        baseFrom: dayThisMonth(18),
        moves: [
          { type: 'purchase', title: 'Авиабилеты', amount: { amount: 150000, currency: 'RUB' }, date: dayThisMonth(18) },
          { type: 'cardLoan', cardId: wifeCard.id, amount: { amount: 150000, currency: 'RUB' }, date: dayThisMonth(18), repay: 'auto' },
        ],
      },
    ],
  }
}

function card(name, bank, owner, o) {
  return {
    id: id('card'), name, bank, owner,
    creditLimit: { amount: o.limit, currency: 'RUB' },
    statementDate: o.statementDate,
    dueDate: o.dueDate,
    graceEndDate: o.graceEndDate || o.dueDate,
    statementCycleDays: o.statementCycleDays || 30,
    gracePeriodDays: o.grace || 0,
    minPaymentPercent: o.minPaymentPercent ?? 5,
    minPaymentBase: o.minPaymentBase || 'currentDebt',
    minPaymentFixed: { amount: o.minPaymentFixed || 0, currency: 'RUB' },
    minPaymentPlusInterest: o.minPaymentPlusInterest || false,
    apr: o.apr || 0,
    currentDebt: { amount: 0, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    transferLimit: { amount: o.transferLimit || 0, currency: 'RUB' },
    transferGraceDays: o.transferGraceDays || o.grace || 0,
    payStrategy: 'full',
    disabled: o.disabled || false,
    note: o.note || 'Заполните текущий долг и сумму выписки, проверьте даты и льготный период',
  }
}

function expense(name, amount, currency, category, schedule, extra = {}) {
  return { id: id('exp'), name, amount, currency, category, owner: 'family', schedule, ...extra }
}
