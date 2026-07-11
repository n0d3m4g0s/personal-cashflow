// Реактивный стор + сохранение в localStorage + экспорт/импорт JSON.
import { reactive, watch } from 'vue'
import { makeSeed } from './seed.js'
import { DEFAULT_RATES } from './money.js'

const STORAGE_KEY = 'family-finance:v1'

let _uid = Date.now()
export function newId(prefix = 'item') {
  return `${prefix}_${(_uid++).toString(36)}`
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return migrate(JSON.parse(raw))
  } catch (e) {
    console.warn('Не удалось прочитать сохранённые данные:', e)
  }
  return makeSeed()
}

// Гарантируем наличие ключевых полей (на случай старых сохранений).
function migrate(s) {
  s.settings = s.settings || {}
  s.settings.rates = { ...DEFAULT_RATES, ...(s.settings.rates || {}) }
  s.settings.startingCash = s.settings.startingCash || { amount: 0, currency: 'RUB' }
  s.settings.safetyBuffer = s.settings.safetyBuffer || { amount: 0, currency: 'RUB' }
  s.settings.horizonMonths = s.settings.horizonMonths || 6
  s.settings.baseCurrency = 'RUB'
  for (const k of ['incomes', 'expenses', 'loans', 'cards', 'goals']) {
    if (!Array.isArray(s[k])) s[k] = []
  }
  return s
}

export const state = reactive(load())

let saveTimer = null
watch(
  state,
  () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch (e) {
        console.warn('Не удалось сохранить данные:', e)
      }
    }, 200)
  },
  { deep: true },
)

// ---- CRUD-помощники ----
function collectionFor(kind) {
  return {
    income: state.incomes,
    expense: state.expenses,
    loan: state.loans,
    card: state.cards,
    goal: state.goals,
  }[kind]
}

export function addItem(kind, item) {
  const list = collectionFor(kind)
  const withId = { id: newId(kind), ...item }
  list.push(withId)
  return withId
}

export function removeItem(kind, id) {
  const list = collectionFor(kind)
  const i = list.findIndex((x) => x.id === id)
  if (i >= 0) list.splice(i, 1)
}

export function duplicateItem(kind, id) {
  const list = collectionFor(kind)
  const src = list.find((x) => x.id === id)
  if (src) {
    const copy = JSON.parse(JSON.stringify(src))
    copy.id = newId(kind)
    copy.name = `${copy.name} (копия)`
    list.push(copy)
  }
}

// ---- Экспорт / импорт / сброс ----
export function exportJSON() {
  return JSON.stringify(state, null, 2)
}

export function importJSON(text) {
  const parsed = migrate(JSON.parse(text))
  // заменяем содержимое реактивного объекта, сохраняя ссылку
  for (const key of Object.keys(state)) delete state[key]
  Object.assign(state, parsed)
  return true
}

export function resetToSeed() {
  const seed = makeSeed()
  for (const key of Object.keys(state)) delete state[key]
  Object.assign(state, seed)
}

export function clearAll() {
  const empty = {
    version: 1,
    settings: {
      startingCash: { amount: 0, currency: 'RUB' },
      horizonMonths: 6,
      safetyBuffer: { amount: 0, currency: 'RUB' },
      rates: { ...DEFAULT_RATES },
      baseCurrency: 'RUB',
    },
    incomes: [], expenses: [], loans: [], cards: [], goals: [],
  }
  for (const key of Object.keys(state)) delete state[key]
  Object.assign(state, empty)
}
