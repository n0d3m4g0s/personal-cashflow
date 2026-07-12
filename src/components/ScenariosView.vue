<script setup>
import { ref, computed } from 'vue'
import { state } from '../store.js'
import { evaluateScenario } from '../scenarios.js'
import { fmtHuman } from '../finance.js'
import { formatMoney, moneyToRub } from '../money.js'
import MoneyInput from './MoneyInput.vue'

const rates = computed(() => state.settings.rates)
function money(rub) { return formatMoney(rub, 'RUB') }

const baseScenario = { id: '__base', name: 'Как есть', moves: [] }
const comparison = computed(() => {
  const list = [baseScenario, ...state.scenarios]
  return list.map((sc) => {
    try {
      const { metrics } = evaluateScenario(state, sc, sc.baseFrom ? { from: sc.baseFrom } : {})
      return { name: sc.name, metrics, error: null }
    } catch (e) {
      return { name: sc.name, metrics: null, error: String(e.message || e) }
    }
  })
})
function riskClass(r) { return r === 'высокий' ? 'neg' : (r === 'средний' ? 'warn' : 'pos') }

function newScenario() {
  state.scenarios.push({ id: 'scenario_' + Date.now().toString(36), name: 'Новый сценарий', baseFrom: '', moves: [] })
}
function removeScenario(id) {
  const i = state.scenarios.findIndex((s) => s.id === id)
  if (i >= 0) state.scenarios.splice(i, 1)
}
function addMove(sc, type) {
  const blank = {
    purchase: { type: 'purchase', title: 'Покупка', amount: { amount: 0, currency: 'RUB' }, date: '' },
    cardLoan: { type: 'cardLoan', cardId: state.cards[0]?.id || '', amount: { amount: 0, currency: 'RUB' }, date: '', repay: 'auto', repayDate: '' },
    newLoan: { type: 'newLoan', title: 'Кредит', amount: { amount: 0, currency: 'RUB' }, apr: 0.25, termMonths: 12, startDate: '' },
    adjust: { type: 'adjust', title: 'Корректировка', amount: { amount: 0, currency: 'RUB' }, sign: -1, date: '' },
  }[type]
  sc.moves.push(JSON.parse(JSON.stringify(blank)))
}
function removeMove(sc, i) { sc.moves.splice(i, 1) }
</script>

<template>
  <div class="grid" style="gap: 14px">
    <div class="spread">
      <div>
        <h2 style="margin: 0">Сценарии</h2>
        <div class="small muted">Играем цифрами: крупная покупка, заём с карты, кредит. Сравните способы в таблице ниже.</div>
      </div>
      <button class="primary" @click="newScenario">+ Новый сценарий</button>
    </div>

    <div v-for="sc in state.scenarios" :key="sc.id" class="card grid" style="gap: 10px">
      <div class="spread">
        <input v-model="sc.name" style="flex: 1; font-weight: 600" />
        <button class="sm danger" @click="removeScenario(sc.id)">Удл.</button>
      </div>
      <div class="row">
        <div><label>Дата отсчёта</label><input type="date" v-model="sc.baseFrom" /></div>
      </div>

      <div v-for="(m, i) in sc.moves" :key="i" class="card" style="padding: 10px">
        <div class="spread">
          <b class="small">{{ {purchase:'Крупная покупка', cardLoan:'Заём с карты', newLoan:'Новый кредит', adjust:'Разовый доход/расход'}[m.type] }}</b>
          <button class="sm ghost" @click="removeMove(sc, i)">✕</button>
        </div>
        <div class="row" v-if="m.type === 'purchase'">
          <input v-model="m.title" placeholder="Название" />
          <MoneyInput v-model="m.amount" compact />
          <input type="date" v-model="m.date" />
        </div>
        <div class="row" v-else-if="m.type === 'cardLoan'">
          <select v-model="m.cardId"><option v-for="c in state.cards" :key="c.id" :value="c.id">{{ c.name }}</option></select>
          <MoneyInput v-model="m.amount" compact />
          <input type="date" v-model="m.date" title="Дата займа" />
          <select v-model="m.repay"><option value="auto">возврат авто</option><option value="manual">возврат вручную</option></select>
          <input v-if="m.repay === 'manual'" type="date" v-model="m.repayDate" />
        </div>
        <div class="row" v-else-if="m.type === 'newLoan'">
          <input v-model="m.title" placeholder="Название" />
          <MoneyInput v-model="m.amount" compact />
          <input type="number" step="0.1" :value="m.apr * 100" @input="m.apr = (parseFloat($event.target.value) || 0) / 100" title="Ставка % годовых" style="width: 80px" />
          <input type="number" v-model.number="m.termMonths" title="Срок, мес" style="width: 70px" />
          <input type="date" v-model="m.startDate" />
        </div>
        <div class="row" v-else-if="m.type === 'adjust'">
          <input v-model="m.title" placeholder="Название" />
          <MoneyInput v-model="m.amount" compact />
          <select v-model.number="m.sign"><option :value="1">доход +</option><option :value="-1">расход −</option></select>
          <input type="date" v-model="m.date" />
        </div>
      </div>

      <div class="row" style="gap: 6px">
        <button class="sm ghost" @click="addMove(sc, 'purchase')">+ Покупка</button>
        <button class="sm ghost" @click="addMove(sc, 'cardLoan')">+ Заём с карты</button>
        <button class="sm ghost" @click="addMove(sc, 'newLoan')">+ Кредит</button>
        <button class="sm ghost" @click="addMove(sc, 'adjust')">+ Доход/расход</button>
      </div>
    </div>

    <p v-if="!state.scenarios.length" class="card muted">Сценариев пока нет. Создайте первый, чтобы проиграть варианты.</p>

    <div v-if="state.scenarios.length" class="card">
      <h3 style="margin-top: 0">Сравнение</h3>
      <div style="overflow-x: auto">
        <table>
          <thead>
            <tr><th>Метрика</th><th v-for="c in comparison" :key="c.name">{{ c.name }}</th></tr>
          </thead>
          <tbody>
            <tr>
              <td class="muted small">Мин. остаток</td>
              <td v-for="c in comparison" :key="c.name" class="mono" :class="c.metrics && c.metrics.minBalance < 0 ? 'neg' : ''">
                {{ c.metrics ? money(c.metrics.minBalance) : '-' }}
              </td>
            </tr>
            <tr>
              <td class="muted small">Дата просадки</td>
              <td v-for="c in comparison" :key="c.name" class="small">{{ c.metrics ? fmtHuman(c.metrics.minBalanceDate) : '-' }}</td>
            </tr>
            <tr>
              <td class="muted small">Переплата (проценты)</td>
              <td v-for="c in comparison" :key="c.name" class="mono" :class="c.metrics && c.metrics.overpayment > 0 ? 'warn' : 'pos'">
                {{ c.metrics ? money(c.metrics.overpayment) : '-' }}
              </td>
            </tr>
            <tr>
              <td class="muted small">Возврат в грейс</td>
              <td v-for="c in comparison" :key="c.name" class="small">
                {{ c.metrics ? (c.metrics.graceOk.length ? c.metrics.graceOk.map(g => g ? '✓' : '✗').join(' ') : '-') : '-' }}
              </td>
            </tr>
            <tr>
              <td class="muted small">В плюс с</td>
              <td v-for="c in comparison" :key="c.name" class="small">{{ c.metrics && c.metrics.breakEvenDate ? fmtHuman(c.metrics.breakEvenDate) : '-' }}</td>
            </tr>
            <tr>
              <td class="muted small">Риск</td>
              <td v-for="c in comparison" :key="c.name" :class="c.metrics ? riskClass(c.metrics.risk) : ''">{{ c.metrics ? c.metrics.risk : c.error }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
