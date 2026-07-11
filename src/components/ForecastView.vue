<script setup>
import { computed } from 'vue'
import { state } from '../store.js'
import { buildForecast, fmtHuman, fmtMonthYear } from '../finance.js'
import { formatMoney, formatAllFromRub } from '../money.js'

const rates = computed(() => state.settings.rates)
const forecast = computed(() => buildForecast(state))

function money(rub) { return formatMoney(rub, 'RUB') }
function eq(rub) { return formatAllFromRub(rub, rates.value, { skip: ['RUB'] }) }
function sign(a) { return (a >= 0 ? '+' : '−') + money(Math.abs(a)) }
function kindIcon(k) { return { income: '💰', expense: '🧾', loan: '🏦', card: '💳' }[k] || '•' }

// группировка дней по месяцам для заголовков
const grouped = computed(() => {
  const out = []
  let curKey = null
  for (const day of forecast.value.days) {
    const key = day.date.getFullYear() + '-' + day.date.getMonth()
    if (key !== curKey) {
      out.push({ month: fmtMonthYear(day.date), days: [] })
      curKey = key
    }
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
        <div class="small muted">
          Старт: {{ money(forecast.startingCash) }} · итог к концу периода:
          <span class="mono" :class="forecast.endBalance >= forecast.buffer ? 'pos' : 'warn'">{{ money(forecast.endBalance) }}</span>
        </div>
      </div>
      <div style="min-width: 180px">
        <label>Горизонт прогноза</label>
        <select :value="state.settings.horizonMonths" @change="setHorizon">
          <option :value="3">3 месяца</option>
          <option :value="6">6 месяцев</option>
          <option :value="12">12 месяцев</option>
          <option :value="24">24 месяца</option>
        </select>
      </div>
    </div>

    <div v-for="grp in grouped" :key="grp.month" class="card">
      <h3 style="text-transform: capitalize">{{ grp.month }}</h3>
      <table>
        <thead>
          <tr><th>Дата</th><th>Движения</th><th style="text-align: right">За день</th><th style="text-align: right">Остаток</th></tr>
        </thead>
        <tbody>
          <tr v-for="(day, i) in grp.days" :key="i" :class="{ danger: day.balance < forecast.buffer }">
            <td class="nowrap muted small">{{ fmtHuman(day.date) }}</td>
            <td>
              <div v-for="(e, j) in day.events" :key="j" class="ev">
                {{ kindIcon(e.kind) }} {{ e.title }}
                <span class="mono small" :class="e.amount >= 0 ? 'pos' : 'neg'">{{ sign(e.amount) }}</span>
              </div>
            </td>
            <td class="mono nowrap" :class="day.dayTotal >= 0 ? 'pos' : 'neg'" style="text-align: right">{{ sign(day.dayTotal) }}</td>
            <td class="mono nowrap" :class="day.balance < 0 ? 'neg' : (day.balance < forecast.buffer ? 'warn' : '')" style="text-align: right">
              {{ money(day.balance) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="!forecast.days.length" class="card muted">
      Нет запланированных движений в выбранном горизонте. Проверьте даты доходов/расходов и остатки по картам/кредитам.
    </p>
  </div>
</template>

<style scoped>
.ev { padding: 1px 0; }
tr.danger td { background: rgba(248, 113, 113, 0.06); }
</style>
