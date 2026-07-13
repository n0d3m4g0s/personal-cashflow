<script setup>
import { computed } from 'vue'
import { state, goTab } from '../store.js'
import { cardsSummary, buildForecast, fmtHuman } from '../finance.js'
import { formatMoney } from '../money.js'
import { cardAdvice } from '../advice.js'

const summary = computed(() => cardsSummary(state))
const forecast = computed(() => buildForecast(state))
const advice = computed(() => cardAdvice(state))

function money(rub) { return formatMoney(rub, 'RUB') }

// Календарь: только события карт, ближайшие сверху.
const cardEvents = computed(() =>
  forecast.value.events.filter((e) => e.kind === 'card').slice(0, 30)
)
function pct(apr) { return (apr * 100).toFixed(1) + '%' }

// Создаёт сценарий из хода рекомендации и переключает на вкладку "Сценарии".
function playInScenarios(rec) {
  if (!rec.action) return
  state.scenarios.push({
    id: 'scenario_' + Date.now().toString(36),
    name: rec.title, baseFrom: rec.action.date || '', moves: [rec.action],
  })
  goTab('scenarios')
}
function sevIcon(s) { return { critical: '🔴', warning: '🟡', save: '💡' }[s] || '•' }
function sevClass(s) { return { critical: 'neg', warning: 'warn', save: 'pos' }[s] || '' }
</script>

<template>
  <div class="grid" style="gap: 16px">
    <div>
      <h2 style="margin: 0">Карты: стратегия</h2>
      <div class="small muted">Сводка по всем картам, календарь платежей и цена обслуживания.</div>
    </div>

    <!-- Панель сводки -->
    <section class="grid summary" style="grid-template-columns: repeat(4, 1fr); gap: 12px">
      <div class="card stat">
        <div class="muted small">Проценты за горизонт</div>
        <div class="big neg mono">{{ money(summary.totalInterest) }}</div>
        <div class="small muted">по минимальным платежам</div>
      </div>
      <div class="card stat">
        <div class="muted small">Месячная нагрузка</div>
        <div class="big mono">{{ money(summary.monthlyMin) }}</div>
        <div class="small muted">минимальные платежи/мес</div>
      </div>
      <div class="card stat">
        <div class="muted small">Общий долг по картам</div>
        <div class="big mono">{{ money(summary.totalDebt) }}</div>
        <div class="small muted">в грейсе {{ money(summary.debtInGrace) }} + под % {{ money(summary.debtUnderInterest) }}</div>
      </div>
      <div class="card stat">
        <div class="muted small">Свободный лимит</div>
        <div class="big pos mono">{{ money(summary.totalFreeLimit) }}</div>
        <div class="small muted">беспроцентно переводимо {{ money(summary.transferableFree) }}</div>
      </div>
    </section>

    <!-- Рекомендации -->
    <div class="card">
      <h3 style="margin-top: 0">Рекомендации</h3>
      <div v-if="advice.length" class="grid" style="gap: 10px">
        <div v-for="(rec, i) in advice" :key="i" class="rec-row">
          <div class="spread">
            <div>
              <b :class="sevClass(rec.severity)">{{ sevIcon(rec.severity) }} {{ rec.title }}</b>
              <div class="small muted">{{ rec.why }}</div>
            </div>
            <button v-if="rec.action" class="sm ghost" @click="playInScenarios(rec)">Проиграть в Сценариях</button>
          </div>
        </div>
      </div>
      <p v-else class="muted">Срочных рекомендаций нет.</p>
    </div>

    <!-- Календарь обязательств -->
    <div class="card">
      <h3 style="margin-top: 0">Календарь платежей (ближайшие сверху)</h3>
      <table v-if="cardEvents.length">
        <thead><tr><th>Дата</th><th>Карта</th><th style="text-align: right">Платёж</th><th>Конец грейса</th></tr></thead>
        <tbody>
          <tr v-for="(e, i) in cardEvents" :key="i">
            <td class="nowrap muted small">{{ fmtHuman(e.date) }}</td>
            <td>💳 {{ e.title }}</td>
            <td class="mono neg nowrap" style="text-align: right">−{{ money(Math.abs(e.amount)) }}</td>
            <td class="small muted">{{ e.graceDate ? fmtHuman(e.graceDate) : '-' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">Обязательств по картам в горизонте нет.</p>
    </div>

    <!-- Таблица по картам -->
    <div class="card">
      <h3 style="margin-top: 0">По картам</h3>
      <table v-if="summary.perCard.length">
        <thead><tr><th>Карта</th><th style="text-align: right">Долг</th><th style="text-align: right">Ближайший платёж</th><th>До</th><th>Грейс до</th><th style="text-align: right">Свободно</th><th style="text-align: right">Ставка</th></tr></thead>
        <tbody>
          <tr v-for="c in summary.perCard" :key="c.id">
            <td>{{ c.name }} <span class="small muted">{{ c.bank }}</span></td>
            <td class="mono nowrap" style="text-align: right">{{ money(c.debt) }}</td>
            <td class="mono nowrap" style="text-align: right">{{ money(c.nextPayment) }}</td>
            <td class="small muted nowrap">{{ fmtHuman(c.nextDate) }}</td>
            <td class="small muted nowrap">{{ fmtHuman(c.graceEnd) }}</td>
            <td class="mono nowrap" style="text-align: right">{{ money(c.freeLimit) }}<span v-if="c.transferableFree > 0" class="small pos"> ⇄{{ money(c.transferableFree) }}</span></td>
            <td class="mono small nowrap" style="text-align: right">{{ pct(c.apr) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">Карт с долгом нет.</p>
    </div>
  </div>
</template>

<style scoped>
.rec-row { padding: 8px 0; border-bottom: 1px solid var(--border); }
.rec-row:last-child { border-bottom: none; }
</style>
