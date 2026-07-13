<script setup>
import { computed } from 'vue'
import { state, nav } from './store.js'
import { moneyToRub } from './money.js'
import Dashboard from './components/Dashboard.vue'
import ForecastView from './components/ForecastView.vue'
import GoalsView from './components/GoalsView.vue'
import CardsView from './components/CardsView.vue'
import CardStrategyView from './components/CardStrategyView.vue'
import LoansView from './components/LoansView.vue'
import IncomeView from './components/IncomeView.vue'
import ExpensesView from './components/ExpensesView.vue'
import SettingsView from './components/SettingsView.vue'
import ScenariosView from './components/ScenariosView.vue'

const tabs = [
  { key: 'dashboard', label: 'Дашборд', icon: '📊', comp: Dashboard },
  { key: 'forecast', label: 'Прогноз', icon: '📅', comp: ForecastView },
  { key: 'goals', label: 'Цели', icon: '🎯', comp: GoalsView },
  { key: 'scenarios', label: 'Сценарии', icon: '🎲', comp: ScenariosView },
  { key: 'cards', label: 'Кредитки', icon: '💳', comp: CardsView },
  { key: 'cardStrategy', label: 'Стратегия', icon: '🧮', comp: CardStrategyView },
  { key: 'loans', label: 'Кредиты', icon: '🏦', comp: LoansView },
  { key: 'income', label: 'Доходы', icon: '💰', comp: IncomeView },
  { key: 'expenses', label: 'Расходы', icon: '🧾', comp: ExpensesView },
  { key: 'settings', label: 'Настройки', icon: '⚙️', comp: SettingsView },
]

const current = computed(() => tabs.find((t) => t.key === nav.active)?.comp)
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="logo">🐾</span>
        <div>
          <div class="brand-title">Семейные финансы</div>
          <div class="brand-sub muted small">муж · жена · 2 мопса</div>
        </div>
      </div>
      <nav class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="tab"
          :class="{ active: nav.active === t.key }"
          @click="nav.active = t.key"
        >
          <span class="tab-icon">{{ t.icon }}</span>
          <span class="tab-label">{{ t.label }}</span>
        </button>
      </nav>
    </header>

    <main class="content">
      <component :is="current" />
    </main>

    <footer class="foot muted small">
      Данные хранятся только в этом браузере (localStorage). Делайте бэкап через «Настройки → Экспорт».
    </footer>
  </div>
</template>

<style scoped>
.app { max-width: 1080px; margin: 0 auto; padding: 16px; }
.topbar {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  padding: 4px 4px 14px;
}
.brand { display: flex; align-items: center; gap: 10px; }
.logo { font-size: 1.8rem; }
.brand-title { font-weight: 700; font-size: 1.05rem; }
.tabs {
  display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto;
}
.tab {
  display: flex; align-items: center; gap: 6px; padding: 7px 12px;
  background: transparent; border: 1px solid transparent; color: var(--muted);
}
.tab:hover { color: var(--text); border-color: var(--border); }
.tab.active { background: var(--panel); border-color: var(--accent); color: var(--text); }
.tab-icon { font-size: 1rem; }
.content { padding: 6px 0 30px; }
.foot { text-align: center; padding: 18px 0; border-top: 1px solid var(--border); }

@media (max-width: 720px) {
  .tabs { margin-left: 0; width: 100%; }
  .tab-label { display: none; }
  .tab { padding: 8px 12px; }
  .tab-icon { font-size: 1.2rem; }
}
</style>
