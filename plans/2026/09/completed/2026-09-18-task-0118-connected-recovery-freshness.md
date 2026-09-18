# TASK-0118 — Проверяемая свежесть подключённых Recovery-данных

## Статус и разрешение

План и связанный [ADR](../../../../docs/adr/20260918-expose-connected-recovery-freshness-to-coach.md)
одобрены оператором 2026-09-18. Реализация, независимый Quality, Architecture
Review и post-acceptance Wiki завершены. Commit, push, staging и production
остаются отдельными operator gates.

Quality и Architecture Review отклонили реконструкцию exact request window из
completion timestamp. Финальная принятая модель удаляет `no_record`: без прямой
normalized target-date записи delivery остаётся `unknown`. Это безопаснее и не
требует migration.

## Пользовательский результат

Если подключённый источник уже проверен, но ещё не передал показатели сна и
восстановления за сегодня, Coach говорит именно это простыми словами. Он не
утверждает, что Garmin «не синхронизировался», не придумывает причину и не
обещает самостоятельно вернуться к вопросу позже.

Пример: «Синхронизация прошла недавно, но показатели сегодняшнего сна и
восстановления источник пока не передал. При следующем вопросе я проверю их
снова». Если последняя попытка завершилась ошибкой или давно не выполнялась,
ответ явно отличается.

## Альтернативы

1. Только prompt guard — мало изменений, но у Coach по-прежнему нет фактов для
   различения причин пустого результата.
2. Provider-specific connection status — показывает состояние подключения, но
   не доказывает доставку записи за нужную дату и протаскивает Intervals в
   Coaching orchestration.
3. Force-refresh при каждом вопросе — повышает latency и rate-limit риск и не
   помогает, когда upstream уже вернул пустую запись.
4. Provider-neutral Recovery context — рекомендуемый вариант: один read для
   focused вопроса, точное состояние доставки, неизменная DailyAssessment
   authority и отсутствие нового deployable.

## Предлагаемая модель

- Новый application-layer `ConnectedRecoveryContext` компонует current-day
  Recovery observations и безопасный Integration delivery status.
- Две независимые оси:
  - `syncState`: `fresh_success`, `stale_success`, `failed`, `never_checked`,
    `not_connected`, `unavailable`;
  - `targetDateDelivery`: `supported_facts_present`,
    `record_without_supported_facts`, `unknown`.
- `connected-recovery-freshness-v1` считает successful sync свежим 15 минут,
  что равно трём текущим rolling intervals. Параметр принадлежит versioned
  policy, а не prompt.
- Без persisted exact request bounds отсутствие target-date записи возвращает
  `unknown`: completion timestamp не доказывает request window. Это намеренно
  теряет точность, но не требует migration и исключает ложное «день проверен».
- Новый read-only MCP tool `get_current_recovery_context` сам использует
  сохранённый Person timezone и принимает пустой input.
- `DailyAssessment` snapshots и decision checksum не получают volatile sync
  metadata. Для полного Daily Coach context читается дополнительно только если
  нужно объяснить отсутствующие Recovery evidence.
- Вопрос не инициирует provider refresh и не создаёт automation.

## Этапы реализации

1. Добавить provider-neutral contracts для двух осей состояния, policy version
   и current Recovery context; зафиксировать closed schemas и TSDoc.
2. Добавить Integration read projection, которая без raw payload и identifiers
   различает target-date normalized record, record with supported facts и
   отсутствие record, а также безопасно проецирует latest attempt outcome.
3. Реализовать pure freshness policy с параметром 15 минут, точной boundary
   семантикой и контролируемым clock input.
4. Добавить application composition, которая получает Person timezone,
   вычисляет current local date, читает Recovery observations и Integration
   projection и возвращает один typed context.
5. Опубликовать `get_current_recovery_context` под существующим read scope;
   запретить arguments, writes и provider selection.
6. Обновить MCP orchestration: focused current Recovery вопросы используют
   context; full Daily Coach сохраняет `get_daily_assessment` первым и читает
   context только для объяснения missing Recovery evidence.
7. Добавить deterministic wording rules и запреты на недоказуемую provider
   attribution, diagnosis, zero-from-absence и обещание фоновой перепроверки.
8. Доказать regression tests, что изменение sync metadata не меняет
   DailyAssessment V1/V2/V3 snapshots, checksum, status или action.
9. Провести локальные проверки, Developer → независимый Quality → Architecture
   Review → post-acceptance Wiki. Staging verification и release остаются
   отдельными operator gates.

## Acceptance criteria

1. Fresh successful sync с normalized empty target-date record детерминированно
   отличается от отсутствующей записи, failed sync и stale state.
2. Coach не говорит «Garmin не синхронизировался», если typed state доказывает
   успешную попытку, и не называет причину отсутствующих fields.
3. Focused current sleep/HRV/resting-HR/Body-Battery/steps вопрос получает
   observations и availability одним read-only tool call.
4. Новый tool определяет local date из сохранённого Person timezone, не
   принимает timezone/provider/person/connection identifiers и сохраняет Person
   isolation.
5. Missing field не создаёт zero observation, diagnosis, причинный вывод или
   recommendation change.
6. Full Daily Coach всё ещё использует `get_daily_assessment` как единственную
   decision authority; context только объясняет availability.
7. Polling timestamps и delivery state не изменяют DailyAssessment snapshot,
   checksum, status или action.
8. Read не вызывает provider refresh, write, automation или другой side effect.
9. Ответ не обещает самостоятельную будущую проверку без созданной automation.
10. Contracts и logs не содержат credentials, raw provider payload, external
    user id, connection id, checksums или personal metric values сверх уже
    разрешённых typed observations.
11. Provider-specific mapping остаётся в Integration adapter; freshness policy
    и Coaching behavior provider-neutral.

## Проверки

- contract schema/TSDoc tests;
- pure freshness policy matrix and clock-boundary tests;
- Integration PostgreSQL tests for populated, empty, absent, failed, stale,
  disconnected and consent-replaced states;
- Recovery context Person isolation and timezone/DST tests;
- MCP scope/schema/structured-content and instruction tests;
- DailyAssessment V1/V2/V3 snapshot/checksum regression tests;
- full workspace unit/integration tests, typecheck, lint and build;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- независимый Quality, Architecture Review и post-acceptance Wiki.

## Риски и ограничения

- 15 минут — presentation freshness policy, а не гарантия upstream latency; она
  должна быть явно versioned и не использоваться как health signal.
- Empty normalized record доказывает только отсутствие поддерживаемых полей в
  полученном ответе, но не объясняет причину внутри Garmin или Intervals.
- Дополнительный MCP tool увеличивает surface, но убирает двусмысленность одним
  focused read и не расширяет write privileges.
- Исторические Recovery вопросы не получают current sync semantics и продолжают
  использовать существующий date-scoped list.

## Отдельные operator gates

После одобрения архитектуры и плана отдельно контролируются:

1. implementation start;
2. commit;
3. push;
4. staging deploy/migrations, если они неожиданно понадобятся;
5. authenticated staging Coach verification;
6. production release или access.
