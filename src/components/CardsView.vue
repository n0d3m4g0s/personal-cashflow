<script setup>
import { computed, ref } from 'vue'
import { state, addItem, removeItem } from '../store.js'
import { cardCycle, cardMinPayment, cardDebt, fmtHuman } from '../finance.js'
import { formatMoney, moneyToRub } from '../money.js'
import MoneyInput from './MoneyInput.vue'

const rates = computed(() => state.settings.rates)
function money(rub) { return formatMoney(rub, 'RUB') }

const OWNERS = [
  { value: 'husband', label: 'Муж' },
  { value: 'wife', label: 'Жена' },
]

const editing = ref(null)
function blank() {
  return {
    name: '', bank: '', owner: 'husband',
    creditLimit: { amount: 0, currency: 'RUB' },
    statementDate: '', dueDate: '', graceEndDate: '', statementCycleDays: 30,
    minPaymentPercent: 5,
    minPaymentFixed: { amount: 0, currency: 'RUB' }, minPaymentPlusInterest: false, apr: 0,
    currentDebt: { amount: 0, currency: 'RUB' },
    statementBalance: { amount: 0, currency: 'RUB' },
    transferLimit: { amount: 0, currency: 'RUB' }, transferGraceDays: 0,
    payStrategy: 'full', disabled: false, note: '',
  }
}
function openNew() { editing.value = blank() }
function openEdit(c) { editing.value = JSON.parse(JSON.stringify(c)) }
function save() {
  const c = editing.value
  if (!c.name.trim()) c.name = 'Карта'
  if (c.id) {
    const i = state.cards.findIndex((x) => x.id === c.id)
    if (i >= 0) state.cards[i] = c
  } else addItem('card', c)
  editing.value = null
}
function del(id) { if (confirm('Удалить карту?')) removeItem('card', id) }

function info(card) {
  const { statement, due, graceEnd } = cardCycle(card)
  const debt = cardDebt(card, rates.value)
  return { statement, due, graceEnd, debt, min: cardMinPayment(card, rates.value) }
}
function ownerTag(o) { return o === 'husband' ? 'tag-husband' : 'tag-wife' }
function ownerLabel(o) { return OWNERS.find((x) => x.value === o)?.label || o }
</script>

<template>
  <div class="grid" style="gap: 14px">
    <div class="spread">
      <div>
        <h2 style="margin: 0">Кредитные карты</h2>
        <div class="small muted">Долг «снимок»: укажите текущий долг и сумму последней выписки — прогноз посчитает ближайший платёж.</div>
      </div>
      <button class="primary" @click="openNew">+ Добавить карту</button>
    </div>

    <div class="grid cards-grid">
      <div v-for="c in state.cards" :key="c.id" class="card cc" :class="{ off: c.disabled }">
        <div class="spread">
          <div>
            <h3 style="margin: 0">{{ c.name }} <span class="pill" :class="ownerTag(c.owner)">{{ ownerLabel(c.owner) }}</span></h3>
            <div class="small muted">{{ c.bank }} · лимит {{ money(moneyToRub(c.creditLimit, rates)) }} · льготный до {{ fmtHuman(info(c).graceEnd) }}</div>
          </div>
          <div class="row">
            <button class="sm ghost" @click="openEdit(c)">Изм.</button>
            <button class="sm danger" @click="del(c.id)">Удл.</button>
          </div>
        </div>

        <div v-if="c.disabled" class="pill" style="margin-top: 8px">выключена (не в прогнозе)</div>
        <div v-else class="cc-facts grid">
          <div><div class="muted small">Долг / выписка</div><div class="mono">{{ money(info(c).debt) }}</div></div>
          <div><div class="muted small">Выписка</div><div class="mono">{{ fmtHuman(info(c).statement) }}</div></div>
          <div><div class="muted small">Платёж до</div><div class="mono">{{ fmtHuman(info(c).due) }}</div></div>
          <div>
            <div class="muted small">Стратегия</div>
            <div class="mono">{{ c.payStrategy === 'minimum' ? 'минимум ' + money(info(c).min) : 'полное ' + money(info(c).debt) }}</div>
          </div>
        </div>
        <div v-if="!c.disabled && info(c).debt > 0" class="small muted" style="margin-top: 8px">
          💡 Мин. платёж ≈ {{ money(info(c).min) }} до {{ fmtHuman(info(c).due) }}, чтобы не уйти в просрочку.
          Полное погашение {{ money(info(c).debt) }} до {{ fmtHuman(info(c).graceEnd) }} сохранит льготный период (без процентов).
        </div>
        <div v-if="c.note && !c.disabled" class="small warn" style="margin-top: 6px">⚠️ {{ c.note }}</div>
      </div>
    </div>

    <p v-if="!state.cards.length" class="card muted">Карт пока нет.</p>

    <!-- Модалка -->
    <div v-if="editing" class="overlay" @click.self="editing = null">
      <div class="modal grid" style="gap: 12px">
        <h2 style="margin: 0">{{ editing.id ? 'Изменить карту' : 'Новая карта' }}</h2>
        <div class="row">
          <div style="flex: 2"><label>Название</label><input v-model="editing.name" placeholder="Т-Банк (муж)" /></div>
          <div style="flex: 1"><label>Банк</label><input v-model="editing.bank" placeholder="Т-Банк" /></div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Владелец</label>
            <select v-model="editing.owner"><option v-for="o in OWNERS" :key="o.value" :value="o.value">{{ o.label }}</option></select>
          </div>
          <div style="flex: 1"><label>Кредитный лимит</label><MoneyInput v-model="editing.creditLimit" compact /></div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Дата выписки</label><input type="date" v-model="editing.statementDate" /></div>
          <div style="flex: 1"><label>Платёж до</label><input type="date" v-model="editing.dueDate" /></div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Конец льготного</label><input type="date" v-model="editing.graceEndDate" /></div>
          <div style="flex: 1"><label>Длина цикла (дней)</label><input type="number" min="1" v-model.number="editing.statementCycleDays" /></div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Текущий долг</label><MoneyInput v-model="editing.currentDebt" compact /></div>
          <div style="flex: 1"><label>Сумма выписки (к оплате)</label><MoneyInput v-model="editing.statementBalance" compact /></div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Мин. платёж, %</label><input type="number" min="0" step="0.5" v-model.number="editing.minPaymentPercent" /></div>
          <div style="flex: 1"><label>Мин. платёж, не менее</label><MoneyInput v-model="editing.minPaymentFixed" compact /></div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Ставка, % годовых</label><input type="number" min="0" step="0.1" :value="(editing.apr * 100)" @input="editing.apr = (parseFloat($event.target.value) || 0) / 100" /></div>
          <div style="flex: 1; display: flex; align-items: flex-end">
            <label style="margin: 0"><input type="checkbox" style="width: auto" v-model="editing.minPaymentPlusInterest" /> +проценты в минплатёж</label>
          </div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Стратегия платежа в прогнозе</label>
            <select v-model="editing.payStrategy">
              <option value="full">Полное погашение (без процентов)</option>
              <option value="minimum">Только минимум</option>
            </select>
          </div>
          <div style="flex: 1; display: flex; align-items: flex-end; gap: 8px">
            <label style="margin: 0"><input type="checkbox" style="width: auto" v-model="editing.disabled" /> выключить</label>
          </div>
        </div>
        <div class="field"><label>Заметка</label><input v-model="editing.note" /></div>
        <div class="row" style="justify-content: flex-end">
          <button class="ghost" @click="editing = null">Отмена</button>
          <button class="primary" @click="save">Сохранить</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cards-grid { grid-template-columns: 1fr 1fr; }
.cc.off { opacity: 0.55; }
.cc-facts { grid-template-columns: repeat(4, 1fr); margin-top: 10px; gap: 8px; }
@media (max-width: 820px) { .cards-grid { grid-template-columns: 1fr; } }
</style>
