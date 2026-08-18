# TASK-0042 — Доступное раскрытие объяснения passkeys

## Статус и граница разрешения

- Статус: completed 2026-08-18; implementation, независимый Quality Review,
  Architecture Review и post-quality documentation review завершены.
- Commit, push, deployment и любые staging-операции не входят в разрешение.
- Работа выполняется только в основном монорепозитории
  `/Users/MmM/WebstormProjects/shape-of-you`; старый desktop worktree не
  используется.

## Исходный запрос

Исправить UX элемента **Why passkeys?** на landing page. Текущий anchor ведёт к
уже видимому блоку и поэтому лишь смещает viewport. Вместо него нужен настоящий
доступный disclosure-контрол с очевидным раскрытием и скрытием объяснения,
`aria-expanded`, нативным keyboard behavior и пропорциональными unit/browser
E2E.

## Цель

Сделать объяснение выбора passkeys управляемой частью landing page: пользователь
видит обычную кнопку раскрытия, может открыть и закрыть текст мышью или
клавиатурой, а assistive technology получает точное состояние и связь с
контролируемой областью.

## Scope

### Входит

1. Замена `href="#privacy"` на семантическую кнопку disclosure в
   `apps/web/app/pages/index.vue`.
2. Явное начальное закрытое состояние, переключение раскрытия и скрытия,
   `aria-expanded` и `aria-controls`.
3. Нативное управление кнопкой через `Enter` и `Space`, без самописной обработки
   keyboard events.
4. Визуальный индикатор состояния и стили, сохраняющие visible focus,
   reduced-motion behavior и отсутствие horizontal overflow.
5. Малый presentation-only state transition helper и один unit test его
   начального и переключаемого состояния.
6. Browser E2E начального состояния, раскрытия, повторного скрытия,
   `aria-expanded`, keyboard behavior и mobile/desktop layout.
7. Проверки `apps/web` и monorepo/documentation gates, независимый Quality Review
   и Architecture Review.

### Не входит

- `/day`, `/progress`, графики, таблица дней и их responsive/empty-state UX.
- Выбор текущего или последнего заполненного дня, historical/latest weight и
  любой новый API read model.
- Изменения API, Identity, OAuth, passkey ceremony, session/CSRF contracts,
  Person mapping, schema, migrations, database или credentials.
- Новый frontend runtime, SSR/Nitro server, deployable, dependency или design
  system initiative.
- Canonical Wiki/ADR update без отдельного post-quality решения и разрешения.

## Архитектурная оценка

Новый ADR не требуется. Изменение локально для presentation state одной
существующей страницы, не меняет публичный HTTP contract, security boundary,
domain model, data ownership, deployable boundary или deployment topology.
Оно соответствует принятому
[`docs/adr/20260807-serve-static-nuxt-client-through-existing-edge.md`](../../../../docs/adr/20260807-serve-static-nuxt-client-through-existing-edge.md),
который уже относит public landing к ответственности статического Nuxt-клиента.
Решение обратимо внутри одного компонента и не создаёт дорогого долгосрочного
архитектурного обязательства.

### Рассмотренные варианты

1. **Нативная кнопка и малый presentation state helper — выбранный вариант.**
   Даёт author-controlled `aria-expanded`/`aria-controls`, нативные `Enter` и
   `Space`, явный визуальный индикатор и узкий unit seam без новой зависимости.
2. **Локальный `ref` прямо в странице.** Проще на несколько строк, но оставляет
   требуемую unit-проверку либо на уровне хрупкого source assertion, либо требует
   дополнительной component-test инфраструктуры. Не выбран.
3. **`details`/`summary`.** Даёт нативное disclosure behavior, но не обеспечивает
   требуемый авторский `aria-expanded` contract на существующем элементе и хуже
   согласуется с текущим button/link visual language. Не выбран.

## Затрагиваемые области

| Область | Ожидаемое изменение |
|---|---|
| `apps/web/app/pages/index.vue` | Disclosure button, controlled explanation и явная accessible связь |
| `apps/web/app/lib/` | Минимальный presentation-only state helper с concise English TSDoc |
| `apps/web/app/assets/css/main.css` | Button reset/indicator, expanded/collapsed presentation и responsive safety |
| `apps/web/test/` | Один unit test состояния disclosure |
| `apps/web/test/e2e/frontend.spec.ts` | Browser pin tests для мыши, клавиатуры, ARIA и viewport |
| TASK-0042 timeline | Developer evidence, Quality acceptance/rejection и Architecture Review summary |

## Этапы реализации

1. После утверждения плана записать approval в TASK-0042 timeline, завершить
   analytic handoff и перевести задачу в `developer/in_progress`.
2. Добавить минимальный disclosure state transition contract и unit test.
3. Заменить anchor на native button, связать его с explanation region через
   стабильный `id`, `aria-controls` и реактивный `aria-expanded`.
4. Скрывать explanation в начальном состоянии и явно показывать изменение
   состояния текстом/индикатором без viewport-only эффекта.
5. Добавить scoped CSS, проверить focus, reduced motion и responsive layout.
6. Расширить Playwright E2E: initial closed, click open/close, `Enter`, `Space`,
   ARIA state и отсутствие overflow на phone/desktop.
7. Выполнить локальные проверки и зафиксировать developer evidence.
8. Без паузы передать результат независимому Quality Review; quality не
   исправляет код и проверяет каждый критерий отдельно.
9. Выполнить Architecture Review и только после accepted quality отдельно
   решить, нужен ли Wiki/changelog update. Для локальной UX-коррекции ожидается
   `docs update not required`.

## Критерии приёмки

1. На landing page **Why passkeys?** является `button`, а не anchor, и не меняет
   URL/hash или viewport как основной эффект.
2. При первом render объяснение закрыто, контрол имеет
   `aria-expanded="false"` и корректный `aria-controls`.
3. Click раскрывает объяснение и меняет `aria-expanded` на `true`; повторный
   click скрывает его и возвращает `false`.
4. Сфокусированная кнопка выполняет те же переходы через `Enter` и `Space`
   благодаря нативному keyboard behavior.
5. Состояние раскрытия визуально очевидно по тексту и/или индикатору; focus
   остаётся видимым.
6. Скрытое объяснение недоступно для чтения и фокусировки; раскрытое объяснение
   видимо и связано с контролом стабильным `id`.
7. Landing не получает horizontal overflow и сохраняет читаемую композицию как
   минимум на phone 390×844 и desktop 1440×900; reduced motion остаётся
   безопасным.
8. Unit test покрывает начальное состояние и обе смены состояния; browser E2E
   отдельно покрывает mouse/keyboard/ARIA/responsive behavior.
9. Нет изменений `/day`, `/progress`, API, Identity, domain/data contracts,
   schema, migrations, dependencies, deployables, secrets или deployment.

## План проверки

- `pnpm --filter @shape-of-you/web lint`
- `pnpm --filter @shape-of-you/web typecheck`
- `pnpm --filter @shape-of-you/web test`
- `pnpm --filter @shape-of-you/web build`
- `pnpm --filter @shape-of-you/web test:e2e`
- при пропорциональном риске — root `pnpm lint`, `pnpm typecheck`, `pnpm test`
  и `pnpm build`, если package-level checks не подтверждают workspace contracts;
- `node scripts/validate-docs.mjs`
- `git diff --check`
- проверка generated static artifact на отсутствие runtime server и credential
  material по действующему `apps/web/AGENTS.md` contract;
- независимая acceptance matrix и scope/unrelated-diff review;
- Architecture Review по complexity, deployable boundaries, DDD, duplication и
  возможности упрощения.

## Architecture Review checklist

1. Малый state helper остаётся presentation-only и не превращается в общий
   framework без второго consumer.
2. Не появляются новый runtime, service, API, data owner или dependency.
3. Passkey/Identity policy не дублируется и не меняется; UI только раскрывает
   существующий текст.
4. Wiki, ADR, план и timeline не становятся конкурирующими источниками
   current-state architecture.
5. Решение нельзя упростить без потери требуемого unit seam,
   `aria-expanded` contract или нативного keyboard behavior.
