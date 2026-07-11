<script setup>
// Мультивалютный ввод суммы. Хранит { amount, currency } в нативной валюте.
// При смене валюты пересчитывает сумму, сохраняя рублёвый эквивалент.
// Под полем показывает эквиваленты в двух других валютах.
import { computed } from 'vue'
import { state } from '../store.js'
import { CURRENCIES, CURRENCY_META, convert, equivalentsFromRub, moneyToRub } from '../money.js'

const props = defineProps({
  modelValue: { type: Object, default: () => ({ amount: 0, currency: 'RUB' }) },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const val = computed(() => props.modelValue || { amount: 0, currency: 'RUB' })
const rates = computed(() => state.settings.rates)

function setAmount(e) {
  const amount = parseFloat(String(e.target.value).replace(',', '.')) || 0
  emit('update:modelValue', { amount, currency: val.value.currency })
}

function setCurrency(e) {
  const currency = e.target.value
  // Пересчитываем сумму, сохраняя рублёвый эквивалент.
  const converted = convert(Number(val.value.amount) || 0, val.value.currency, currency, rates.value)
  const rounded = currency === 'USD' ? Math.round(converted * 100) / 100 : Math.round(converted)
  emit('update:modelValue', { amount: rounded, currency })
}

const equivalents = computed(() => {
  const rub = moneyToRub(val.value, rates.value)
  return equivalentsFromRub(rub, rates.value, val.value.currency)
})
</script>

<template>
  <div class="money-input">
    <div class="mi-row">
      <input
        class="mi-amount mono"
        type="text"
        inputmode="decimal"
        :value="val.amount"
        @input="setAmount"
      />
      <select class="mi-cur" :value="val.currency" @change="setCurrency">
        <option v-for="c in CURRENCIES" :key="c" :value="c">
          {{ CURRENCY_META[c].symbol }} {{ c }}
        </option>
      </select>
    </div>
    <div v-if="!compact" class="mi-eq small muted mono">
      ≈ <span v-for="(e, i) in equivalents" :key="e.currency">{{ e.text }}<span v-if="i < equivalents.length - 1"> · </span></span>
    </div>
  </div>
</template>

<style scoped>
.money-input { width: 100%; }
.mi-row { display: flex; gap: 6px; }
.mi-amount { flex: 1; }
.mi-cur { width: auto; min-width: 92px; flex: 0 0 auto; }
.mi-eq { margin-top: 4px; }
</style>
