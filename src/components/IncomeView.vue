<script setup>
import { computed, ref } from 'vue'
import { state, addItem, removeItem } from '../store.js'
import { moneyToRub, formatMoney, formatAllFromRub } from '../money.js'
import { monthlyFactor, FREQUENCIES } from '../finance.js'
import MoneyInput from './MoneyInput.vue'
import ScheduleEditor from './ScheduleEditor.vue'

const rates = computed(() => state.settings.rates)
function money(rub) { return formatMoney(rub, 'RUB') }
function eq(rub) { return formatAllFromRub(rub, rates.value, { skip: ['RUB'] }) }
const OWNERS = [{ value: 'husband', label: 'Муж' }, { value: 'wife', label: 'Жена' }, { value: 'family', label: 'Семья' }]

function todayISO() {
  const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
const editing = ref(null)
function blank() {
  return { name: '', owner: 'husband', type: 'salary', amount: 0, currency: 'RUB', accountId: state.accounts[0]?.id ?? null,
    schedule: { frequency: 'monthly', interval: 1, startDate: todayISO(), endDate: null }, disabled: false, note: '' }
}
function openNew() { editing.value = blank() }
function openEdit(x) { editing.value = JSON.parse(JSON.stringify(x)) }
function save() {
  const x = editing.value
  if (!x.name.trim()) x.name = 'Доход'
  if (x.id) { const i = state.incomes.findIndex((y) => y.id === x.id); if (i >= 0) state.incomes[i] = x }
  else addItem('income', x)
  editing.value = null
}
function del(id) { if (confirm('Удалить доход?')) removeItem('income', id) }
function monthEquiv(x) { return moneyToRub(x, rates.value) * monthlyFactor(x.schedule) }
function freqLabel(s) { return FREQUENCIES.find((f) => f.value === s?.frequency)?.label || '—' }
const totalMonthly = computed(() => state.incomes.filter((x) => !x.disabled).reduce((s, x) => s + monthEquiv(x), 0))
</script>

<template>
  <div class="grid" style="gap: 14px">
    <div class="spread">
      <div>
        <h2 style="margin: 0">Доходы</h2>
        <div class="small muted">Всего в месяц (эквивалент): <b class="mono">{{ money(totalMonthly) }}</b> · <span class="mono">{{ eq(totalMonthly) }}</span></div>
      </div>
      <button class="primary" @click="openNew">+ Добавить доход</button>
    </div>

    <table class="card" style="display: table">
      <thead><tr><th>Название</th><th>Владелец</th><th>Сумма</th><th>Регулярность</th><th>≈ в месяц</th><th></th></tr></thead>
      <tbody>
        <tr v-for="x in state.incomes" :key="x.id" :class="{ off: x.disabled }">
          <td>{{ x.name }} <span v-if="x.disabled" class="pill">выкл.</span>
            <div v-if="x.note" class="small muted">{{ x.note }}</div>
          </td>
          <td>{{ OWNERS.find(o => o.value === x.owner)?.label }}</td>
          <td class="mono">{{ formatMoney(x.amount, x.currency) }}</td>
          <td class="small">{{ freqLabel(x.schedule) }}</td>
          <td class="mono pos">{{ money(monthEquiv(x)) }}</td>
          <td class="nowrap">
            <button class="sm ghost" @click="openEdit(x)">Изм.</button>
            <button class="sm danger" @click="del(x.id)">Удл.</button>
          </td>
        </tr>
        <tr v-if="!state.incomes.length"><td colspan="6" class="muted">Доходов нет</td></tr>
      </tbody>
    </table>

    <div v-if="editing" class="overlay" @click.self="editing = null">
      <div class="modal grid" style="gap: 12px">
        <h2 style="margin: 0">{{ editing.id ? 'Изменить доход' : 'Новый доход' }}</h2>
        <div class="field"><label>Название</label><input v-model="editing.name" placeholder="Зарплата / Фриланс" /></div>
        <div class="row">
          <div style="flex: 1"><label>Владелец</label>
            <select v-model="editing.owner"><option v-for="o in OWNERS" :key="o.value" :value="o.value">{{ o.label }}</option></select>
          </div>
          <div style="flex: 1"><label>Счёт</label>
            <select v-model="editing.accountId"><option v-for="a in state.accounts" :key="a.id" :value="a.id">{{ a.name }} ({{ a.currency }})</option></select>
          </div>
          <div style="flex: 1"><label>Тип</label>
            <select v-model="editing.type"><option value="salary">Зарплата</option><option value="freelance">Фриланс</option><option value="other">Другое</option></select>
          </div>
        </div>
        <div class="field"><label>Сумма</label>
          <MoneyInput :model-value="{ amount: editing.amount, currency: editing.currency }"
                      @update:model-value="v => { editing.amount = v.amount; editing.currency = v.currency }" />
        </div>
        <div class="field"><label>Регулярность</label><ScheduleEditor v-model="editing.schedule" /></div>
        <div class="field"><label><input type="checkbox" style="width: auto" v-model="editing.disabled" /> выключить</label></div>
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
