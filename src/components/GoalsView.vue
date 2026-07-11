<script setup>
import { computed, ref, reactive } from 'vue'
import { state, addItem, removeItem } from '../store.js'
import { computeGoals, fmtHuman } from '../finance.js'
import { formatMoney, formatAllFromRub } from '../money.js'
import MoneyInput from './MoneyInput.vue'

const rates = computed(() => state.settings.rates)

// what-if дельты (не сохраняются)
const whatif = reactive({ extraIncome: 0, extraExpense: 0 })
const base = computed(() => computeGoals(state))
const projected = computed(() => computeGoals(state, whatif))

function money(rub) { return formatMoney(rub, 'RUB') }
function eq(rub) { return formatAllFromRub(rub, rates.value, { skip: ['RUB'] }) }
function resetWhatif() { whatif.extraIncome = 0; whatif.extraExpense = 0 }
const active = computed(() => (whatif.extraIncome || whatif.extraExpense) ? projected.value : base.value)

// редактирование
const editing = ref(null)
function blankGoal() {
  return {
    name: '', priority: (state.goals.length || 0) + 1,
    targetAmount: { amount: 0, currency: 'RUB' },
    currentSaved: { amount: 0, currency: 'RUB' },
    targetDate: '', monthlyContribution: { amount: 0, currency: 'RUB' },
    note: '',
  }
}
function openNew() { editing.value = blankGoal() }
function openEdit(g) { editing.value = JSON.parse(JSON.stringify(g)) }
function save() {
  const g = editing.value
  if (!g.name.trim()) { g.name = 'Без названия' }
  g.targetDate = g.targetDate || null
  if (g.id) {
    const idx = state.goals.findIndex((x) => x.id === g.id)
    if (idx >= 0) state.goals[idx] = g
  } else {
    addItem('goal', g)
  }
  editing.value = null
}
function del(id) { if (confirm('Удалить цель?')) removeItem('goal', id) }

function resultFor(id) { return active.value.results.find((r) => r.goal.id === id) }
</script>

<template>
  <div class="grid" style="gap: 14px">
    <!-- What-if -->
    <section class="card whatif">
      <div class="spread">
        <h2 style="margin: 0">🎛️ Играем цифрами</h2>
        <button class="sm ghost" @click="resetWhatif">Сбросить</button>
      </div>
      <p class="small muted" style="margin-top: -4px">
        Меняйте гипотетические доход/расходы и смотрите, как сдвигаются даты закрытия целей.
        Это не сохраняется — только прикидка.
      </p>
      <div class="row">
        <div style="flex: 1 1 220px">
          <label>+ дополнительный доход в месяц (₽)</label>
          <input type="range" min="0" max="200000" step="5000" v-model.number="whatif.extraIncome" />
          <input type="number" v-model.number="whatif.extraIncome" />
        </div>
        <div style="flex: 1 1 220px">
          <label>+ дополнительные расходы в месяц (₽)</label>
          <input type="range" min="0" max="200000" step="5000" v-model.number="whatif.extraExpense" />
          <input type="number" v-model.number="whatif.extraExpense" />
        </div>
      </div>
      <div class="row" style="margin-top: 8px">
        <div class="pill">Базовый профицит: <b class="mono">{{ money(base.surplus) }}/мес</b></div>
        <div class="pill" :class="active.surplus >= base.surplus ? 'tag-family' : ''">
          С учётом правок: <b class="mono">{{ money(active.surplus) }}/мес</b>
        </div>
      </div>
    </section>

    <div class="spread">
      <h2 style="margin: 0">Цели</h2>
      <button class="primary" @click="openNew">+ Добавить цель</button>
    </div>

    <section v-for="r in active.results" :key="r.goal.id" class="card goal">
      <div class="spread">
        <div>
          <h3 style="margin: 0">{{ r.goal.name }} <span class="pill">приоритет {{ r.goal.priority }}</span></h3>
          <div class="small muted" v-if="r.goal.note">{{ r.goal.note }}</div>
        </div>
        <div class="row">
          <button class="sm ghost" @click="openEdit(r.goal)">Изм.</button>
          <button class="sm danger" @click="del(r.goal.id)">Удл.</button>
        </div>
      </div>

      <div class="bar"><div class="bar-fill" :style="{ width: (r.progress * 100) + '%' }"></div></div>
      <div class="spread small">
        <span class="mono">{{ money(r.saved) }} из {{ money(r.target) }}</span>
        <span class="muted">{{ Math.round(r.progress * 100) }}%</span>
      </div>

      <div class="grid goal-facts">
        <div>
          <div class="muted small">Осталось накопить</div>
          <div class="mono">{{ money(r.remaining) }}</div>
          <div class="muted small mono">{{ eq(r.remaining) }}</div>
        </div>
        <div>
          <div class="muted small">Взнос в месяц</div>
          <div class="mono">{{ money(r.contribution) }}</div>
          <div class="muted small">{{ r.goal.monthlyContribution && r.goal.monthlyContribution.amount > 0 ? 'фиксированный' : 'из общего профицита' }}</div>
        </div>
        <div>
          <div class="muted small">Прогноз закрытия</div>
          <div class="mono" :class="r.etaDate ? '' : 'warn'">
            {{ r.etaDate ? fmtHuman(r.etaDate) : 'нужен профицит' }}
          </div>
          <div class="muted small" v-if="r.monthsNeeded != null">≈ {{ r.monthsNeeded }} мес.</div>
        </div>
        <div v-if="r.targetDate">
          <div class="muted small">Дедлайн</div>
          <div class="mono">{{ fmtHuman(r.targetDate) }}</div>
          <div class="small" :class="r.onTrack ? 'pos' : 'neg'">
            {{ r.onTrack ? '✅ успеваем' : '⚠️ не успеваем' }}
          </div>
          <div class="small muted" v-if="!r.onTrack">нужно {{ money(r.neededContribution) }}/мес</div>
        </div>
      </div>
    </section>

    <p v-if="!active.results.length" class="card muted">Целей пока нет. Нажмите «Добавить цель».</p>

    <!-- Модалка редактирования -->
    <div v-if="editing" class="overlay" @click.self="editing = null">
      <div class="modal grid" style="gap: 12px">
        <h2 style="margin: 0">{{ editing.id ? 'Изменить цель' : 'Новая цель' }}</h2>
        <div class="field"><label>Название</label><input v-model="editing.name" placeholder="Напр. Отпуск / Подушка" /></div>
        <div class="row">
          <div style="flex: 1"><label>Цель (сумма)</label><MoneyInput v-model="editing.targetAmount" /></div>
          <div style="flex: 1"><label>Уже накоплено</label><MoneyInput v-model="editing.currentSaved" /></div>
        </div>
        <div class="row">
          <div style="flex: 1"><label>Приоритет</label><input type="number" min="1" v-model.number="editing.priority" /></div>
          <div style="flex: 1"><label>Дедлайн <span class="muted small">(опц.)</span></label><input type="date" v-model="editing.targetDate" /></div>
        </div>
        <div class="field">
          <label>Фиксированный взнос в месяц <span class="muted small">(опц. — иначе из общего профицита)</span></label>
          <MoneyInput v-model="editing.monthlyContribution" />
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
.whatif { border-color: #2c4a63; }
.goal .bar { height: 9px; background: #0d1526; border-radius: 999px; margin: 10px 0 4px; overflow: hidden; }
.goal .bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
.goal-facts { grid-template-columns: repeat(4, 1fr); margin-top: 12px; }
input[type=range] { padding: 0; margin: 4px 0; }
@media (max-width: 720px) { .goal-facts { grid-template-columns: 1fr 1fr; } }
</style>
