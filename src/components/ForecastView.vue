<script setup>
import { computed, ref } from 'vue'
import { state } from '../store.js'
import { buildForecast, forecastByCurrency, fmtHuman, fmtMonthYear } from '../finance.js'
import { formatMoney, formatAllFromRub, convert } from '../money.js'

const rates = computed(() => state.settings.rates)
const forecast = computed(() => buildForecast(state))
const selected = ref('all') // 'all' | account.id

// Мультивалютный таймлайн режима "Все счета" (чистая функция ядра): движения в родной
// валюте, остатки раздельно по валютам счетов. day: { date, events, balances, danger }.
const allView = computed(() => forecastByCurrency(state))

// активная дорожка одиночного счёта (режим "Все счета" обрабатывается через allView)
const view = computed(() => {
  if (selected.value === 'all') return { isAll: true }
  const pa = forecast.value.perAccount.find((a) => a.account.id === selected.value)
  if (!pa) return { currency: 'RUB', days: [], startingBalance: 0, endBalance: 0, buffer: 0, isAll: false }
  return { currency: pa.currency, days: pa.days, startingBalance: pa.startingBalance,
    endBalance: pa.endBalance, buffer: pa.buffer, isAll: false }
})

function money(v) { return formatMoney(v, view.value.currency) }
function eq(rub) { return formatAllFromRub(rub, rates.value, { skip: ['RUB'] }) }
function sign(a) { return (a >= 0 ? '+' : '-') + formatMoney(Math.abs(a), view.value.currency) }
function kindIcon(k) { return { income: '💰', expense: '🧾', loan: '🏦', card: '💳' }[k] || '•' }

// Строка суммы движения в его РОДНОЙ валюте (native), знак по e.amount.
function evNative(e) {
  const nativeAmt = e.native ? (Number(e.native.amount) || 0) : Math.abs(e.amount)
  const nativeCur = e.native ? (e.native.currency || 'RUB') : 'RUB'
  return (e.amount >= 0 ? '+' : '-') + formatMoney(nativeAmt, nativeCur)
}

// Сумма движения в валюте выбранного счёта (режим одиночного счёта).
function evInAccount(e) {
  const nativeAmt = e.native ? (Number(e.native.amount) || 0) : Math.abs(e.amount)
  const nativeCur = e.native ? (e.native.currency || 'RUB') : 'RUB'
  const inAcc = convert(nativeAmt, nativeCur, view.value.currency, rates.value)
  const signed = e.amount >= 0 ? inAcc : -inAcc
  return (signed >= 0 ? '+' : '-') + formatMoney(Math.abs(signed), view.value.currency)
}

// Итог по концу периода в режиме "Все счета": по валютам + сведённый в рубли.
const allEnd = computed(() => {
  const byCur = allView.value.currencies.map((c) => ({ currency: c, amount: allView.value.endByCur[c] ?? (allView.value.startByCur[c] || 0) }))
  const rub = byCur.reduce((s, b) => s + convert(b.amount, b.currency, 'RUB', rates.value), 0)
  return { byCur, rub }
})
const allStart = computed(() => {
  const byCur = allView.value.currencies.map((c) => ({ currency: c, amount: allView.value.startByCur[c] || 0 }))
  const rub = byCur.reduce((s, b) => s + convert(b.amount, b.currency, 'RUB', rates.value), 0)
  return { byCur, rub }
})
function fmtByCur(list) { return list.map((b) => formatMoney(b.amount, b.currency)).join(' · ') }

// группировка по месяцам - режим одиночного счёта (view.days) ИЛИ мультивалютный (allView.days)
const grouped = computed(() => {
  const src = view.value.isAll ? allView.value.days : view.value.days
  const out = []
  let curKey = null
  for (const day of src) {
    const key = day.date.getFullYear() + '-' + day.date.getMonth()
    if (key !== curKey) { out.push({ month: fmtMonthYear(day.date), days: [] }); curKey = key }
    out[out.length - 1].days.push(day)
  }
  return out
})

function setHorizon(e) { state.settings.horizonMonths = +e.target.value }
</script>

<template>
  <div class="grid" style="gap: 14px">
    <div class="card spread">
      <div>
        <h2 style="margin: 0">Прогноз денежного потока</h2>
        <div v-if="view.isAll" class="small muted">
          Итог к концу периода: <span class="mono">{{ fmtByCur(allEnd.byCur) }}</span>
          · сведено: <span class="mono" :class="allEnd.rub >= 0 ? 'pos' : 'warn'">{{ formatMoney(allEnd.rub, 'RUB') }}</span>
          <br />Старт: <span class="mono">{{ fmtByCur(allStart.byCur) }}</span> · сведено {{ formatMoney(allStart.rub, 'RUB') }}
        </div>
        <div v-else class="small muted">
          Старт: {{ money(view.startingBalance) }} · итог к концу периода:
          <span class="mono" :class="view.endBalance >= view.buffer ? 'pos' : 'warn'">{{ money(view.endBalance) }}</span>
        </div>
      </div>
      <div class="row" style="gap: 10px">
        <div style="min-width: 160px">
          <label>Счёт</label>
          <select v-model="selected">
            <option value="all">Все счета</option>
            <option v-for="a in state.accounts" :key="a.id" :value="a.id">{{ a.name }} ({{ a.currency }})</option>
          </select>
        </div>
        <div style="min-width: 150px">
          <label>Горизонт</label>
          <select :value="state.settings.horizonMonths" @change="setHorizon">
            <option :value="3">3 месяца</option><option :value="6">6 месяцев</option>
            <option :value="12">12 месяцев</option><option :value="24">24 месяца</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Режим "Все счета": движения в родной валюте, остатки раздельно по валютам счетов -->
    <template v-if="view.isAll">
    <div v-for="grp in grouped" :key="'all-' + grp.month" class="card">
      <h3 style="text-transform: capitalize">{{ grp.month }}</h3>
      <table>
        <thead>
          <tr><th>Дата</th><th>Движения</th><th style="text-align: right">Остаток по валютам</th></tr>
        </thead>
        <tbody>
          <tr v-for="(day, i) in grp.days" :key="i" :class="{ danger: day.danger }">
            <td class="nowrap muted small">{{ fmtHuman(day.date) }}</td>
            <td>
              <div v-for="(e, j) in day.events" :key="j" class="ev">
                {{ kindIcon(e.kind) }} {{ e.title }}
                <span class="mono small" :class="e.amount >= 0 ? 'pos' : 'neg'">{{ evNative(e) }}</span>
              </div>
            </td>
            <td class="mono nowrap" style="text-align: right">
              <div v-for="c in allView.currencies" :key="c" :class="day.balances[c] < 0 ? 'neg' : (day.balances[c] < (allView.buffers[c] || 0) ? 'warn' : '')">
                {{ formatMoney(day.balances[c], c) }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    </template>

    <!-- Режим одиночного счёта: всё в валюте счёта -->
    <template v-else>
    <div v-for="grp in grouped" :key="'one-' + grp.month" class="card">
      <h3 style="text-transform: capitalize">{{ grp.month }}</h3>
      <table>
        <thead>
          <tr><th>Дата</th><th>Движения</th><th style="text-align: right">За день</th><th style="text-align: right">Остаток</th></tr>
        </thead>
        <tbody>
          <tr v-for="(day, i) in grp.days" :key="i" :class="{ danger: day.balance < view.buffer }">
            <td class="nowrap muted small">{{ fmtHuman(day.date) }}</td>
            <td>
              <div v-for="(e, j) in day.events" :key="j" class="ev">
                {{ kindIcon(e.kind) }} {{ e.title }}
                <span class="mono small" :class="e.amount >= 0 ? 'pos' : 'neg'">{{ evInAccount(e) }}</span>
              </div>
            </td>
            <td class="mono nowrap" :class="day.dayTotal >= 0 ? 'pos' : 'neg'" style="text-align: right">{{ sign(day.dayTotal) }}</td>
            <td class="mono nowrap" :class="day.balance < 0 ? 'neg' : (day.balance < view.buffer ? 'warn' : '')" style="text-align: right">
              {{ money(day.balance) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    </template>

    <p v-if="!grouped.length" class="card muted">
      Нет запланированных движений в выбранном горизонте.
    </p>
  </div>
</template>

<style scoped>
.ev { padding: 1px 0; }
tr.danger td { background: rgba(248, 113, 113, 0.06); }
</style>
