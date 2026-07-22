<script setup>
import { ref } from 'vue'
import { state, addItem, removeItem } from '../store.js'
import { CURRENCIES, CURRENCY_META, formatMoney } from '../money.js'

const editing = ref(null)
function blank() {
  return { name: '', currency: 'RUB', startingBalance: 0, safetyBuffer: 0, note: '', disabled: false }
}
function openNew() { editing.value = blank() }
function openEdit(x) { editing.value = JSON.parse(JSON.stringify(x)) }
function save() {
  const x = editing.value
  if (!x.name.trim()) x.name = 'Счёт'
  x.startingBalance = Number(x.startingBalance) || 0
  x.safetyBuffer = Number(x.safetyBuffer) || 0
  if (x.id) { const i = state.accounts.findIndex((y) => y.id === x.id); if (i >= 0) state.accounts[i] = x }
  else addItem('account', x)
  editing.value = null
}
function del(id) {
  if (confirm('Удалить счёт? Записи, привязанные к нему, станут "без счёта".')) removeItem('account', id)
}
function sym(cur) { return CURRENCY_META[cur]?.symbol || cur }
</script>

<template>
  <div class="grid" style="gap: 14px">
    <div class="spread">
      <div>
        <h2 style="margin: 0">Счета</h2>
        <div class="small muted">Каждый счёт в своей валюте, со своим стартовым остатком и буфером. Прогноз считает раздельные просадки.</div>
      </div>
      <button class="primary" @click="openNew">+ Добавить счёт</button>
    </div>

    <table class="card" style="display: table">
      <thead><tr><th>Название</th><th>Валюта</th><th>Стартовый остаток</th><th>Буфер</th><th></th></tr></thead>
      <tbody>
        <tr v-for="a in state.accounts" :key="a.id" :class="{ off: a.disabled }">
          <td>{{ a.name }} <span v-if="a.disabled" class="pill">выкл.</span>
            <div v-if="a.note" class="small muted">{{ a.note }}</div>
          </td>
          <td>{{ sym(a.currency) }} {{ a.currency }}</td>
          <td class="mono">{{ formatMoney(a.startingBalance, a.currency) }}</td>
          <td class="mono">{{ formatMoney(a.safetyBuffer, a.currency) }}</td>
          <td class="nowrap">
            <button class="sm ghost" @click="openEdit(a)">Изм.</button>
            <button class="sm danger" @click="del(a.id)">Удл.</button>
          </td>
        </tr>
        <tr v-if="!state.accounts.length"><td colspan="5" class="muted">Счетов нет</td></tr>
      </tbody>
    </table>

    <div v-if="editing" class="overlay" @click.self="editing = null">
      <div class="modal grid" style="gap: 12px">
        <h2 style="margin: 0">{{ editing.id ? 'Изменить счёт' : 'Новый счёт' }}</h2>
        <div class="field"><label>Название</label><input v-model="editing.name" placeholder="Основной / Долларовый" /></div>
        <div class="row">
          <div style="flex: 1"><label>Валюта</label>
            <select v-model="editing.currency"><option v-for="c in CURRENCIES" :key="c" :value="c">{{ sym(c) }} {{ c }}</option></select>
          </div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Стартовый остаток ({{ sym(editing.currency) }})</label>
            <input type="number" step="0.01" v-model.number="editing.startingBalance" />
          </div>
          <div style="flex: 1"><label>Буфер ({{ sym(editing.currency) }})</label>
            <input type="number" step="0.01" v-model.number="editing.safetyBuffer" />
          </div>
        </div>
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
