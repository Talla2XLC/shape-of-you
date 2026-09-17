# TASK-0115 — Активация personal baselines в daily-assessment-v2

## Статус и разрешение

Архитектура одобрена оператором командой «го» 2026-09-17 и зафиксирована в
[ADR активации](../../../../docs/adr/20260917-activate-balanced-personal-baselines-in-daily-assessment-v2.md).
План разрешает локальную реализацию, тесты, независимый Quality, Architecture
Review и Wiki. Он не разрешает commit, push, staging deploy или production.

Локальная реализация завершена и принята независимым Quality и Architecture
Review 2026-09-17. Каноническая Wiki обновлена; release gates ниже остаются
отдельными и не были выполнены.

## Пользовательский результат

Существующий `get_daily_assessment` и Coach должны возвращать реальную
`daily-assessment-v2`. Результат простыми словами объясняет, какие доступные
показатели изменились относительно личного обычного уровня, и выбирает одно
детерминированное действие. При недостаточной истории работает v1 fallback.

## Выбранная модель

- v1 absolute guardrails и hard stops остаются основой;
- personal overlay использует immutable `balanced` bundle;
- personal outcome может быть только таким же или более консервативным;
- HRV, resting heart rate, sleep и Body Battery используют owner-defined daily
  representatives;
- Training load участвует только при exact typed basis/version compatibility;
- нет medical diagnosis, readiness score, provider-specific domain branch или
  LLM authority.

## Этапы реализации

1. Добавить discriminated strict contracts для readable v1 и authoritative v2,
   включая qualitative comparisons, calculation detail и explanation reasons.
2. Вынести одну pure personal-overlay policy и переиспользовать её в live и
   retrospective paths.
3. Расширить bounded Recovery/Training history reads exact evidence IDs,
   exclusions и basis/version compatibility.
4. Добавить additive Training load semantics migration, adapter mapping и
   controlled backfill без provider-specific domain logic.
5. Собрать live v2 в `DailyAssessmentService`: v1 base, balanced comparisons,
   conservative overlay, exact checksum и immutable snapshot.
6. Добавить Coaching policy version 2 и hydrate persisted v1/v2 без hard-coded
   version.
7. Проверить correction, withdrawal, deletion, late import, erasure и old-v1
   readability.
8. Сериализовать snapshot creation со всеми assessment-relevant writers единым
   Person lock и проверить concurrent final-fence race в PostgreSQL.
9. Проверить exact HTTP/MCP/Coach output и plain-language explanation.
10. Выполнить полный local validation и передать frozen diff независимому
   Quality без паузы.
11. После Quality acceptance выполнить Architecture Review и Wiki update.

## Acceptance criteria

1. Live daily read возвращает `policyVersion = daily-assessment-v2` и exact
   balanced policy detail.
2. V2 никогда не ослабляет v1 status/action safety.
3. Каждый metric независимо сообщает usual direction или unavailable/unstable.
4. Объяснение называет только наблюдаемое изменение относительно личной нормы.
5. Training personal comparison требует exact typed load basis/version.
6. Старые v1 snapshots остаются валидными и читаемыми.
7. Evidence checksum воспроизводим и изменяется после релевантной correction,
   withdrawal, deletion или late import.
8. MCP/Coach передаёт exact API result без prompt-side calculation.
9. Нет provider-specific domain logic, LLM authority, mutable baseline row,
   scheduler, queue или нового deployable service.
10. Snapshot write атомарно fenced относительно timezone и всех
    assessment-relevant fact writers, включая Intake и import apply.

## Проверки

- focused pure policy and contract tests;
- Recovery/Training/DailyAssessment PostgreSQL integration tests;
- migration clean, upgrade and identifier-length checks;
- full API and workspace tests;
- typecheck, lint, build;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- independent Quality, Architecture Review and Wiki.

## Отдельные release gates

После принятой реализации оператор отдельно решает:

1. commit;
2. push;
3. автоматический staging deploy;
4. read-only и authenticated проверку реального Coach result;
5. любой production deploy.
