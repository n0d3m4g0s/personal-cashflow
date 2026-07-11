// Стартовые данные (префилл). Известное из задачи + базовые бытовые статьи
// расходов и примеры целей. Суммы/даты, которых мы не знаем, — плейсхолдеры,
// помеченные полем note; легко правятся и удаляются в интерфейсе.

import { DEFAULT_RATES } from './money.js'

let _id = 0
const id = (p) => `${p}_${++_id}`

// ISO-дата дня `day` текущего месяца (для якорей регулярных платежей).
function dayThisMonth(day) {
  const n = new Date()
  const d = new Date(n.getFullYear(), n.getMonth(), day)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const monthly = (day) => ({ frequency: 'monthly', interval: 1, startDate: dayThisMonth(day), endDate: null })

export function makeSeed() {
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
    // statementDay — день выписки; dueDay — день платежа; gracePeriodDays — инфо;
    // payStrategy: 'full' (гасим выписку, без процентов) | 'minimum' (только минимум).
    cards: [
      card('Т-Банк (муж)', 'Т-Банк', 'husband', { limit: 300000, statementDay: 5, dueDay: 25, grace: 55 }),
      card('Озон Банк', 'Озон Банк', 'husband', { limit: 150000, statementDay: 10, dueDay: 30, grace: 120 }),
      card('Уралсиб', 'Уралсиб', 'husband', { limit: 120000, statementDay: 1, dueDay: 20, grace: 60 }),
      card('Сбербанк', 'Сбербанк', 'husband', { limit: 200000, statementDay: 15, dueDay: 5, grace: 120 }),
      card('Т-Банк (жена)', 'Т-Банк', 'wife', { limit: 100000, statementDay: 8, dueDay: 28, grace: 55 }),
      card('Альфа-Банк (жена)', 'Альфа-Банк', 'wife', { limit: 100000, statementDay: 12, dueDay: 2, grace: 100, disabled: true, note: 'Если карта есть — включите и заполните' }),
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
  }
}

function card(name, bank, owner, o) {
  return {
    id: id('card'), name, bank, owner,
    creditLimit: { amount: o.limit, currency: 'RUB' },
    statementDay: o.statementDay,
    dueDay: o.dueDay,
    gracePeriodDays: o.grace,
    minPaymentPercent: 5,
    minPaymentFixed: { amount: 0, currency: 'RUB' },
    currentDebt: { amount: 0, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    payStrategy: 'full',
    disabled: o.disabled || false,
    note: o.note || 'Заполните текущий долг и сумму выписки, проверьте даты и льготный период',
  }
}

function expense(name, amount, currency, category, schedule, extra = {}) {
  return { id: id('exp'), name, amount, currency, category, owner: 'family', schedule, ...extra }
}
