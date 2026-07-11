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
const OWNERS = [{ value: 'family', label: 'Семья' }, { value: 'husband', label: 'Муж' }, { value: 'wife', label: 'Жена' }]

function todayISO() {
  const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
const editing = ref(null)
function blank() {
  return { name: '', category: 'Прочее', owner: 'family', amount: 0, currency: 'RUB',
    schedule: { frequency: 'monthly', interval: 1, startDate: todayISO(), endDate: null }, disabled: false, note: '' }
}
function openNew() { editing.value = blank() }
function openEdit(x) { editing.value = JSON.parse(JSON.stringify(x)) }
function save() {
  const x = editing.value
  if (!x.name.trim()) x.name = 'Расход'
  if (x.id) { const i = state.expenses.findIndex((y) => y.id === x.id); if (i >= 0) state.expenses[i] = x }
  else addItem('expense', x)
  editing.value = null
}
function del(id) { if (confirm('Удалить расход?')) removeItem('expense', id) }
function monthEquiv(x) { return moneyToRub(x, rates.value) * monthlyFactor(x.schedule) }
function freqLabel(s) { return FREQUENCIES.find((f) => f.value === s?.frequency)?.label || '—' }

const totalMonthly = computed(() => state.expenses.filter((x) => !x.disabled).reduce((s, x) => s + monthEquiv(x), 0))

// группировка по категориям
const byCategory = computed(() => {
  const map = {}
  for (const x of state.expenses) {
    const c = x.category || 'Прочее'
    ;(map[c] = map[c] || []).push(x)
  }
  return Object.entries(map).map(([cat, items]) => ({
    cat, items,
    total: items.filter((i) => !i.disabled).reduce((s, i) => s + monthEquiv(i), 0),
  })).sort((a, b) => b.total - a.total)
})
const categories = computed(() => [...new Set(state.expenses.map((x) => x.category).filter(Boolean))])
</script>

<template>
  <div class="grid" style="gap: 14px">
    <div class="spread">
      <div>
        <h2 style="margin: 0">Расходы</h2>
        <div class="small muted">Всего в месяц (эквивалент): <b class="mono">{{ money(totalMonthly) }}</b> · <span class="mono">{{ eq(totalMonthly) }}</span></div>
      </div>
      <button class="primary" @click="openNew">+ Добавить расход</button>
    </div>

    <div v-for="grp in byCategory" :key="grp.cat" class="card">
      <div class="spread" style="margin-bottom: 4px">
        <h3 style="margin: 0">{{ grp.cat }}</h3>
        <span class="mono muted">{{ money(grp.total) }}/мес</span>
      </div>
      <table>
        <tbody>
          <tr v-for="x in grp.items" :key="x.id" :class="{ off: x.disabled }">
            <td>{{ x.name }} <span v-if="x.disabled" class="pill">выкл.</span>
              <div v-if="x.note" class="small muted">{{ x.note }}</div>
            </td>
            <td class="mono nowrap">{{ formatMoney(x.amount, x.currency) }}</td>
            <td class="small nowrap">{{ freqLabel(x.schedule) }}</td>
            <td class="mono neg nowrap">{{ money(monthEquiv(x)) }}</td>
            <td class="nowrap" style="text-align: right">
              <button class="sm ghost" @click="openEdit(x)">Изм.</button>
              <button class="sm danger" @click="del(x.id)">Удл.</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="!state.expenses.length" class="card muted">Расходов нет.</p>

    <div v-if="editing" class="overlay" @click.self="editing = null">
      <div class="modal grid" style="gap: 12px">
        <h2 style="margin: 0">{{ editing.id ? 'Изменить расход' : 'Новый расход' }}</h2>
        <div class="row">
          <div style="flex: 2"><label>Название</label><input v-model="editing.name" placeholder="Продукты / Аренда" /></div>
          <div style="flex: 1"><label>Категория</label>
            <input v-model="editing.category" list="cat-list" placeholder="Еда" />
            <datalist id="cat-list"><option v-for="c in categories" :key="c" :value="c" /></datalist>
          </div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Кто</label>
            <select v-model="editing.owner"><option v-for="o in OWNERS" :key="o.value" :value="o.value">{{ o.label }}</option></select>
          </div>
          <div style="flex: 2"><label>Сумма</label>
            <MoneyInput :model-value="{ amount: editing.amount, currency: editing.currency }"
                        @update:model-value="v => { editing.amount = v.amount; editing.currency = v.currency }" />
          </div>
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
