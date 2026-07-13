# Этап 3b-2: вкладка "Карты: стратегия"

Дата: 2026-07-13
Статус: согласован, готов к плану реализации
Предшествует: этапы 1, 2, 3a, 3b-1 — все в main.

## Контекст и цель

3b-2 — вкладка-советник "Карты: стратегия": сводка по всем картам (проценты за горизонт,
месячная нагрузка, общий долг, свободный лимит), календарь обязательств "что когда платить,
чтобы не просрочить", таблица по картам. Чисто UI поверх готового ядра (этапы 1-3b-1):
cardDebt, cardMinPayment, cardPaymentSchedule, cardCycle, buildForecast.

3c (контур) — оптимизатор-советник с авто-подсказками переливов; в 3b-2 НЕ входит.

## Чистая функция `cardsSummary` (`src/finance.js`)

```js
cardsSummary(state, opts) → {
  totalInterest,        // Σ процентов по всем картам за горизонт (из cardPaymentSchedule)
  monthlyMin,           // Σ cardMinPayment активных карт с долгом (месячная нагрузка)
  totalDebt,            // Σ cardDebt
  debtInGrace,          // долг в грейсе (full-стратегия, грейс не вышел)
  debtUnderInterest,    // долг под процентами (minimum, либо грейс прошёл)
  totalFreeLimit,       // Σ (creditLimit − currentDebt) по активным картам
  transferableFree,     // Σ min(transferLimit, creditLimit−currentDebt) по картам с
                        //   transferGraceEnabled (беспроцентно переводимо)
  perCard: [{ id, name, bank, debt, nextPayment, nextDate, graceEnd, freeLimit,
              transferableFree, apr, strategy }]
}
```

- `opts.from` / `opts.horizonMonths` — как в buildForecast (дефолты из state.settings).
- Считается из готовых функций finance.js. НЕ импортировать transferCost из scenarios.js
  (это создало бы цикл finance→scenarios; сейчас scenarios→finance). `availableLimit` для
  transferableFree считается прямой формулой `min(moneyToRub(transferLimit), max(0,
  moneyToRub(creditLimit) − moneyToRub(currentDebt)))` внутри cardsSummary.
- `totalInterest`: для каждой активной карты с долгом — сумма `interest` из
  `cardPaymentSchedule(card, rates, from, end)` (у full-карт в грейсе процентов нет → 0).
- `debtInGrace` vs `debtUnderInterest`: full-карта, у которой грейс (graceEndDate) не вышел
  на дату from → её долг в грейсе; minimum-карта или карта с прошедшим грейсом → под
  процентами.
- Пропускает disabled-карты и карты с долгом ≤ 0.

## Компонент `CardStrategyView.vue`

Тонкий: читает глобальный state, зовёт `cardsSummary(state)` и `buildForecast(state)`,
ничего не мутирует. Блоки сверху вниз:

1. **Панель сводки** (4 stat-плитки, стиль как Dashboard):
   - Проценты за горизонт (totalInterest).
   - Месячная нагрузка (monthlyMin).
   - Общий долг (totalDebt) с подписью-разбивкой "в грейсе X + под процентами Y".
   - Свободный лимит (totalFreeLimit) с подписью "беспроцентно переводимо Z".
2. **Календарь обязательств** — события карт из buildForecast (kind='card'),
   отсортированные по дате, ближайшие сверху. Строка: дата платежа, карта, сумма,
   стратегия (минимум/полное), конец грейса. Ближайшие/просроченные подсвечены (класс
   danger/warn как в ForecastView).
3. **Таблица по картам** (perCard): строка на карту — долг, ближайший платёж + дата, конец
   грейса, свободный лимит, ставка (apr×100 %), переводимо беспроцентно.
4. **Предупреждения о переносах** — если у сценариев есть transferWarnings (этап 3a,
   metrics.transferWarnings) — показать здесь строкой "перенос на карту X превышает
   свободный лимит (доступно Y)". Собирается прогоном evaluateScenario по state.scenarios;
   если сценариев нет — блок не показывается. (Опционально — минимально; основное это 1-3.)

Стиль — существующие классы (stat, card, table, danger/warn/pos). UI-текст на русском.

## Вкладка в `App.vue`

Импорт CardStrategyView + запись в tabs: `{ key: 'cardStrategy', label: 'Стратегия',
icon: '🧮', comp: CardStrategyView }` после 'cards' (Кредитки).

## Тесты (`test/finance.test.js`)

- `cardsSummary`: на состоянии с несколькими картами (Озон minimum с долгом, Сбер full 0,
  жена transferGraceEnabled) — totalDebt = Σ долгов; monthlyMin = Σ минимумов; totalInterest
  > 0 (есть minimum-карта с apr>0); totalFreeLimit корректен; transferableFree учитывает
  только карты с transferGraceEnabled. perCard содержит запись на каждую активную карту с
  корректными полями.
- Пустое состояние (нет карт / все disabled) → все агрегаты 0, perCard пустой.
- debtInGrace/debtUnderInterest: full-карта в грейсе → в грейсе; minimum-карта → под
  процентами.

## Границы 3b-2 (YAGNI)

НЕ входит: оптимизатор-советник с авто-подсказками переливов (3c). Новой финансовой логики,
кроме агрегатора cardsSummary, нет — всё остальное переиспользует ядро. Компонент не
юнит-тестируется (Vue), проверяется в браузере.

## Затрагиваемые файлы

- `src/finance.js` — `cardsSummary`.
- `src/components/CardStrategyView.vue` — новый компонент.
- `src/App.vue` — вкладка.
- `test/finance.test.js` — тесты cardsSummary.
