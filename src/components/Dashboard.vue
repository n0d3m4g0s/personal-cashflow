<script setup>
import { computed } from 'vue'
import { state } from '../store.js'
import { buildForecast, buildMonthly, computeGoals, fmtHuman, today } from '../finance.js'
import { formatMoney, formatAllFromRub, moneyToRub } from '../money.js'

const rates = computed(() => state.settings.rates)
const monthly = computed(() => buildMonthly(state, rates.value))
const forecast = computed(() => buildForecast(state))
const goals = computed(() => computeGoals(state))

const upcoming = computed(() => forecast.value.events.slice(0, 12))
const alerts = computed(() => forecast.value.alerts.slice(0, 6))

function money(rub) { return formatMoney(rub, 'RUB') }
function eq(rub) { return formatAllFromRub(rub, rates.value, { skip: ['RUB'] }) }
function kindIcon(k) {
  return { income: '💰', expense: '🧾', loan: '🏦', card: '💳' }[k] || '•'
}
function kindClass(a) { return a >= 0 ? 'pos' : 'neg' }
function sign(a) { return (a >= 0 ? '+' : '−') + money(Math.abs(a)) }
</script>

<template>
  <div class="grid" style="gap: 16px">
    <!-- Сводка за месяц -->
    <section class="grid summary">
      <div class="card stat">
        <div class="muted small">Доход в месяц</div>
        <div class="big pos mono">{{ money(monthly.income) }}</div>
        <div class="small muted mono">{{ eq(monthly.income) }}</div>
      </div>
      <div class="card stat">
        <div class="muted small">Обязательные расходы</div>
        <div class="big neg mono">{{ money(monthly.obligatory) }}</div>
        <div class="small muted">расходы {{ money(monthly.expense) }} + кредиты {{ money(monthly.loan) }}</div>
      </div>
      <div class="card stat">
        <div class="muted small">Остаётся в месяц</div>
        <div class="big mono" :class="monthly.surplus >= 0 ? 'pos' : 'neg'">{{ sign(monthly.surplus) }}</div>
        <div class="small muted mono">{{ eq(Math.abs(monthly.surplus)) }}</div>
      </div>
      <div class="card stat">
        <div class="muted small">Прогноз: минимум остатка</div>
        <div class="big mono" :class="forecast.minBalance < forecast.buffer ? 'warn' : 'pos'">
          {{ money(forecast.minBalance) }}
        </div>
        <div class="small muted">{{ fmtHuman(forecast.minBalanceDate) }} · буфер {{ money(forecast.buffer) }}</div>
      </div>
    </section>

    <!-- Алерты -->
    <section v-if="alerts.length" class="card alert-box">
      <h2>⚠️ Кассовые разрывы</h2>
      <p class="small muted" style="margin-top: -6px">
        В эти даты остаток опустится ниже безопасного буфера — надо накопить заранее или занять на время.
      </p>
      <table>
        <thead><tr><th>Дата</th><th>Остаток</th><th>Не хватает до буфера</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(a, i) in alerts" :key="i">
            <td class="nowrap">{{ fmtHuman(a.date) }}</td>
            <td class="mono" :class="a.belowZero ? 'neg' : 'warn'">{{ money(a.balance) }}</td>
            <td class="mono warn">{{ money(a.shortfall) }}</td>
            <td>
              <span v-if="a.belowZero" class="pill" style="color: var(--red); border-color: #5b2b32">минус на счету</span>
              <span v-else class="pill warn">ниже буфера</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <section v-else class="card ok-box">
      ✅ На горизонте прогноза кассовых разрывов нет — остаток не опускается ниже буфера
      ({{ money(forecast.buffer) }}).
    </section>

    <div class="grid two">
      <!-- Ближайшие платежи -->
      <section class="card">
        <h2>Ближайшие движения</h2>
        <table>
          <tbody>
            <tr v-for="(e, i) in upcoming" :key="i">
              <td class="nowrap muted small">{{ fmtHuman(e.date) }}</td>
              <td>{{ kindIcon(e.kind) }} {{ e.title }}</td>
              <td class="mono nowrap" :class="kindClass(e.amount)" style="text-align: right">{{ sign(e.amount) }}</td>
            </tr>
            <tr v-if="!upcoming.length"><td class="muted">Нет запланированных движений</td></tr>
          </tbody>
        </table>
      </section>

      <!-- Цели -->
      <section class="card">
        <h2>Цели</h2>
        <div v-for="r in goals.results" :key="r.goal.id" class="goal-mini">
          <div class="spread">
            <span>{{ r.goal.name }}</span>
            <span class="small muted mono">{{ Math.round(r.progress * 100) }}%</span>
          </div>
          <div class="bar"><div class="bar-fill" :style="{ width: (r.progress * 100) + '%' }"></div></div>
          <div class="small muted">
            осталось {{ money(r.remaining) }} ·
            <template v-if="r.etaDate">закроется ~ {{ fmtHuman(r.etaDate) }}</template>
            <template v-else>нужен профицит для накопления</template>
          </div>
        </div>
        <p v-if="!goals.results.length" class="muted small">Целей пока нет — добавьте во вкладке «Цели».</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.summary { grid-template-columns: repeat(4, 1fr); }
.two { grid-template-columns: 1fr 1fr; }
.stat .big { font-size: 1.5rem; font-weight: 700; margin: 2px 0; }
.alert-box { border-color: #7c5410; background: linear-gradient(180deg, #2a2010, var(--panel)); }
.ok-box { border-color: #1f5745; color: var(--green); }
.goal-mini { padding: 8px 0; border-bottom: 1px solid var(--border); }
.goal-mini:last-child { border-bottom: none; }
.bar { height: 7px; background: #0d1526; border-radius: 999px; margin: 5px 0; overflow: hidden; }
.bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
@media (max-width: 860px) {
  .summary { grid-template-columns: 1fr 1fr; }
  .two { grid-template-columns: 1fr; }
}
</style>
