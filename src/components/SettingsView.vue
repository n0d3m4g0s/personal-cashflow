<script setup>
import { computed, ref } from 'vue'
import { state, exportJSON, importJSON, resetToSeed, clearAll } from '../store.js'
import { CURRENCIES, CURRENCY_META, formatMoney, fromRub } from '../money.js'
import MoneyInput from './MoneyInput.vue'

const rates = computed(() => state.settings.rates)
const importText = ref('')
const msg = ref('')

function flash(t) { msg.value = t; setTimeout(() => (msg.value = ''), 2500) }

function download() {
  const blob = new Blob([exportJSON()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  a.href = url
  a.download = `family-finance-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`
  a.click()
  URL.revokeObjectURL(url)
  flash('Файл выгружен')
}

function onFile(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { doImport(String(reader.result)) }
  reader.readAsText(file)
}
function doImport(text) {
  try { importJSON(text); flash('Данные импортированы'); importText.value = '' }
  catch (err) { flash('Ошибка импорта: ' + err.message) }
}
function reset() { if (confirm('Заменить все данные демонстрационным префиллом? Текущие данные будут потеряны.')) { resetToSeed(); flash('Сброшено к префиллу') } }
function wipe() { if (confirm('Удалить ВСЕ данные и начать с пустого листа?')) { clearAll(); flash('Всё очищено') } }

// Наглядные курсы: сколько рублей за 1 единицу валюты
const rubPerAmd = computed({
  get: () => rates.value.amdPerRub ? (1 / rates.value.amdPerRub) : 0,
  set: (v) => { rates.value.amdPerRub = v > 0 ? 1 / v : 0 },
})
const rubPerUsd = computed({
  get: () => rates.value.usdPerRub ? (1 / rates.value.usdPerRub) : 0,
  set: (v) => { rates.value.usdPerRub = v > 0 ? 1 / v : 0 },
})
</script>

<template>
  <div class="grid" style="gap: 14px">
    <div v-if="msg" class="card" style="border-color: var(--green); color: var(--green)">{{ msg }}</div>

    <section class="card grid" style="gap: 14px">
      <h2 style="margin: 0">Параметры прогноза</h2>
      <div class="row">
        <div style="flex: 1 1 220px"><label>Текущий остаток денег (старт прогноза)</label><MoneyInput v-model="state.settings.startingCash" /></div>
        <div style="flex: 1 1 220px"><label>Безопасный буфер (не опускаться ниже)</label><MoneyInput v-model="state.settings.safetyBuffer" /></div>
      </div>
      <div style="max-width: 240px">
        <label>Горизонт прогноза (мес.)</label>
        <select v-model.number="state.settings.horizonMonths">
          <option :value="3">3</option><option :value="6">6</option><option :value="12">12</option><option :value="24">24</option>
        </select>
      </div>
    </section>

    <section class="card grid" style="gap: 12px">
      <h2 style="margin: 0">Курсы валют</h2>
      <p class="small muted" style="margin: -6px 0 0">Базовая валюта — рубль. Задайте, сколько рублей стоит 1 драм и 1 доллар. Всё пересчитывается автоматически.</p>
      <div class="row">
        <div style="flex: 1 1 200px"><label>1 ֏ (драм) = ₽</label><input type="number" step="0.01" v-model.number="rubPerAmd" /></div>
        <div style="flex: 1 1 200px"><label>1 $ (доллар) = ₽</label><input type="number" step="0.1" v-model.number="rubPerUsd" /></div>
      </div>
      <div class="small muted mono">
        Проверка: 100 000 ₽ = {{ formatMoney(fromRub(100000, 'AMD', rates), 'AMD') }} = {{ formatMoney(fromRub(100000, 'USD', rates), 'USD') }}
      </div>
    </section>

    <section class="card grid" style="gap: 12px">
      <h2 style="margin: 0">Данные · бэкап</h2>
      <p class="small muted" style="margin: -6px 0 0">
        Всё хранится только в этом браузере. Экспортируйте JSON для бэкапа или переноса на другое устройство.
      </p>
      <div class="row">
        <button class="primary" @click="download">⬇️ Экспорт в файл</button>
        <label class="filebtn">
          ⬆️ Импорт из файла
          <input type="file" accept="application/json,.json" @change="onFile" hidden />
        </label>
        <button class="ghost" @click="reset">Сбросить к префиллу</button>
        <button class="danger" @click="wipe">Очистить всё</button>
      </div>
      <details>
        <summary class="small muted" style="cursor: pointer">Импорт из текста (вставить JSON)</summary>
        <textarea v-model="importText" rows="5" style="width: 100%; margin-top: 8px" placeholder='{"version":1,...}'></textarea>
        <button class="sm" style="margin-top: 8px" @click="doImport(importText)" :disabled="!importText.trim()">Импортировать текст</button>
      </details>
    </section>
  </div>
</template>

<style scoped>
textarea {
  font-family: ui-monospace, monospace; background: #0d1526; color: var(--text);
  border: 1px solid var(--border); border-radius: 8px; padding: 8px;
}
.filebtn {
  display: inline-block; border: 1px solid var(--border); background: var(--panel-2);
  padding: 8px 14px; border-radius: 9px; cursor: pointer; margin: 0; color: var(--text);
}
.filebtn:hover { border-color: var(--accent); }
</style>
