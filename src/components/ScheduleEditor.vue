<script setup>
// Редактор регулярности: частота + интервал (для custom) + дата начала и окончания.
import { computed } from 'vue'
import { FREQUENCIES } from '../finance.js'

const props = defineProps({
  modelValue: { type: Object, default: () => ({ frequency: 'monthly', interval: 1, startDate: '', endDate: null }) },
})
const emit = defineEmits(['update:modelValue'])

const s = computed(() => props.modelValue || {})

function patch(p) {
  emit('update:modelValue', { ...s.value, ...p })
}
</script>

<template>
  <div class="sched grid">
    <div class="row">
      <div style="flex: 1 1 160px">
        <label>Частота</label>
        <select :value="s.frequency" @change="patch({ frequency: $event.target.value })">
          <option v-for="f in FREQUENCIES" :key="f.value" :value="f.value">{{ f.label }}</option>
        </select>
      </div>
      <div v-if="s.frequency === 'custom'" style="flex: 0 0 90px">
        <label>Каждые</label>
        <input type="number" min="1" :value="s.interval || 1" @input="patch({ interval: +$event.target.value })" />
      </div>
      <div v-if="s.frequency === 'custom'" style="flex: 0 0 130px">
        <label>Единица</label>
        <select :value="s.customUnit || 'months'" @change="patch({ customUnit: $event.target.value })">
          <option value="days">дней</option>
          <option value="weeks">недель</option>
          <option value="months">месяцев</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div style="flex: 1 1 150px">
        <label>Дата начала</label>
        <input type="date" :value="s.startDate || ''" @input="patch({ startDate: $event.target.value })" />
      </div>
      <div style="flex: 1 1 150px">
        <label>Дата окончания <span class="muted small">(опц.)</span></label>
        <input type="date" :value="s.endDate || ''" @input="patch({ endDate: $event.target.value || null })" />
      </div>
    </div>
    <p v-if="s.frequency === 'once'" class="small muted" style="margin: 0">
      Разовый платёж — сработает один раз в «дату начала».
    </p>
  </div>
</template>

<style scoped>
.sched { gap: 10px; }
</style>
