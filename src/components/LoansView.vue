<script setup>
import { computed, ref } from 'vue'
import { state, addItem, removeItem } from '../store.js'
import { moneyToRub, formatMoney } from '../money.js'
import MoneyInput from './MoneyInput.vue'

const rates = computed(() => state.settings.rates)
function money(rub) { return formatMoney(rub, 'RUB') }
const OWNERS = [{ value: 'husband', label: 'Муж' }, { value: 'wife', label: 'Жена' }, { value: 'family', label: 'Семья' }]

const editing = ref(null)
function blank() {
  return { name: '', owner: 'husband', accountId: state.accounts[0]?.id ?? null, amount: 0, currency: 'RUB', paymentDay: 10, remainingBalance: { amount: 0, currency: 'RUB' }, disabled: false, note: '' }
}
function openNew() { editing.value = blank() }
function openEdit(l) { editing.value = JSON.parse(JSON.stringify(l)) }
function save() {
  const l = editing.value
  if (!l.name.trim()) l.name = 'Кредит'
  if (l.id) { const i = state.loans.findIndex((x) => x.id === l.id); if (i >= 0) state.loans[i] = l }
  else addItem('loan', l)
  editing.value = null
}
function del(id) { if (confirm('Удалить кредит?')) removeItem('loan', id) }

function monthsLeft(l) {
  const rem = moneyToRub(l.remainingBalance, rates.value)
  const pay = moneyToRub(l, rates.value)
  if (rem <= 0 || pay <= 0) return null
  return Math.ceil(rem / pay)
}
const totalMonthly = computed(() => state.loans.filter((l) => !l.disabled).reduce((s, l) => s + moneyToRub(l, rates.value), 0))
</script>

<template>
  <div class="grid" style="gap: 14px">
    <div class="spread">
      <div>
        <h2 style="margin: 0">Кредиты</h2>
        <div class="small muted">Ежемесячно в бюджете: <b class="mono">{{ money(totalMonthly) }}</b></div>
      </div>
      <button class="primary" @click="openNew">+ Добавить кредит</button>
    </div>

    <table class="card" style="display: table">
      <thead><tr><th>Название</th><th>Владелец</th><th>Платёж/мес</th><th>День</th><th>Остаток долга</th><th>Осталось</th><th></th></tr></thead>
      <tbody>
        <tr v-for="l in state.loans" :key="l.id" :class="{ off: l.disabled }">
          <td>{{ l.name }} <span v-if="l.disabled" class="pill">выкл.</span></td>
          <td>{{ OWNERS.find(o => o.value === l.owner)?.label }}</td>
          <td class="mono">{{ money(moneyToRub(l, rates)) }}</td>
          <td class="mono">{{ l.paymentDay }}</td>
          <td class="mono">{{ moneyToRub(l.remainingBalance, rates) > 0 ? money(moneyToRub(l.remainingBalance, rates)) : '—' }}</td>
          <td class="mono">{{ monthsLeft(l) != null ? monthsLeft(l) + ' мес.' : 'бессрочно' }}</td>
          <td class="nowrap">
            <button class="sm ghost" @click="openEdit(l)">Изм.</button>
            <button class="sm danger" @click="del(l.id)">Удл.</button>
          </td>
        </tr>
        <tr v-if="!state.loans.length"><td colspan="7" class="muted">Кредитов нет</td></tr>
      </tbody>
    </table>

    <div v-if="editing" class="overlay" @click.self="editing = null">
      <div class="modal grid" style="gap: 12px">
        <h2 style="margin: 0">{{ editing.id ? 'Изменить кредит' : 'Новый кредит' }}</h2>
        <div class="field"><label>Название</label><input v-model="editing.name" placeholder="ИТ-ипотека / Потреб. кредит" /></div>
        <div class="row">
          <div style="flex: 1"><label>Владелец</label>
            <select v-model="editing.owner"><option v-for="o in OWNERS" :key="o.value" :value="o.value">{{ o.label }}</option></select>
          </div>
          <div style="flex: 1"><label>Счёт списания</label>
            <select v-model="editing.accountId"><option v-for="a in state.accounts" :key="a.id" :value="a.id">{{ a.name }} ({{ a.currency }})</option></select>
          </div>
          <div style="flex: 1"><label>День платежа</label><input type="number" min="1" max="31" v-model.number="editing.paymentDay" /></div>
        </div>
        <div class="field"><label>Ежемесячный платёж</label>
          <MoneyInput :model-value="{ amount: editing.amount, currency: editing.currency }"
                      @update:model-value="v => { editing.amount = v.amount; editing.currency = v.currency }" />
        </div>
        <div class="field"><label>Остаток долга <span class="muted small">(0 = бессрочно / неизвестно)</span></label>
          <MoneyInput v-model="editing.remainingBalance" />
        </div>
        <div class="field"><label><input type="checkbox" style="width: auto" v-model="editing.disabled" /> выключить (не учитывать в прогнозе)</label></div>
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
tr.off { opacity: 0.5; }
</style>
