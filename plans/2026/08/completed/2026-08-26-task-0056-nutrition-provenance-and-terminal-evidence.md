# TASK-0056 — Nutrition provenance и terminal catalog evidence

## Статус и разрешение

- Статус: completed.
- Оператор утвердил рекомендуемый вариант командой `ok go` 2026-08-26.
- Разрешены ADR, план, реализация, migrations, tests, bounded read-only Sheets
  capture, staging migration/apply/recheck, Quality и affected Wiki.
- Commit, push, cutover, authority transfer и Google Sheets writes не разрешены.

## Цель

Без ручного восстановления исправить три ошибочные Brand provenance identity,
импортировать семь доказуемых Foods как source-defined servings и сделать
неполные catalog dependencies terminal typed evidence вместо ложных conflicts.

## План реализации

1. [x] Восстановить workspace, проверить board/memory/docs/Git и выполнить
   bounded read-only диагностику точных причин.
2. [x] Сравнить архитектурные варианты и получить явное одобрение ADR.
3. [x] Добавить exact idempotent data migration для Brand source identities с
   сохранением старых source records.
4. [x] Нормализовать непустой textual `Default_portion` как одну serving и
   сохранять исходное значение в typed audit.
5. [x] Различать present-invalid dependency и absent/ambiguous dependency:
   первая становится terminal invalid, вторая остаётся conflict.
6. [x] Добавить unit, Nutrition integration и migration upgrade coverage.
7. [x] Пройти typecheck, lint, build, unit/integration и docs validation.
8. [x] Выполнить staging migration, bounded all-domain dry-run/apply/recheck без
   Sheets writes и удалить ephemeral artifacts.
9. [x] Провести independent Quality и Architecture Review.
10. [x] Обновить affected Wiki и перенести план в `completed`.

## Критерии приёмки

1. Brand/BrandVersion facts не дублируются и не меняют domain fields.
2. Correct source identity использует exact workbook и numeric Brands sheet ID;
   старый wrong-source record сохраняется.
3. Семь Foods импортируются как `1 serving` с полными source nutrients и exact
   `source_default_portion` в relational audit.
4. Missing Ingredient nutrients и composition quantities не подменяются.
5. Present-invalid dependency даёт terminal invalid; отсутствующий или
   неоднозначный ID остаётся conflict.
6. Повторный all-domain run возвращает `created=0`, `conflict=0`, не создаёт
   duplicates и не перезаписывает факты.
7. Google Sheets остаётся read-only authority; cutover не выполняется.

## Проверка

- `pnpm --filter @shape-of-you/api typecheck`
- `pnpm --filter @shape-of-you/api lint`
- `pnpm --filter @shape-of-you/api build`
- API unit и focused Nutrition/migration integration tests
- PostgreSQL identifier UTF-8 length validation
- `node scripts/validate-docs.mjs`
- `git diff --check`

## Architecture Review checklist

- Сохраняются один API, один Nutrition module и существующие domain boundaries.
- Data migration исправляет только exact provenance defect и не становится
  generic self-healing framework.
- Source-defined serving не утверждает неизвестный физический размер.
- Partial catalog schema и новые deployable boundaries не добавляются.
- Typed audit остаётся единственным terminal evidence; JSON не заменяет
  известную relational structure.
- Cutover/rollback gates не ослабляются.

## Результаты реализации

- Staging migration исправила provenance трёх Brand versions и сохранила три
  старых wrong-source records для аудита.
- До apply dry-run показал `created=7`, `unchanged=421`, `conflict=0`,
  `invalid=46`; после apply повторный dry-run показал `created=0`,
  `unchanged=428`, `conflict=0`, `invalid=46`.
- Все семь Foods импортированы идемпотентно; Google Sheets не изменялась,
  cutover не выполнялся.
- Временные snapshots, helper и SSH tunnel удалены после проверки.
