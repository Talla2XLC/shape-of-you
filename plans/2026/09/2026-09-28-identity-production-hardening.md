# Identity — подготовка production hardening

Статус: signing-key architecture принята; single-VM recovery ADR и
production operations ещё не утверждены.

## Цель

Закрыть подтверждённые production blockers Identity без повторной реализации
работающих OAuth, WebAuthn и API-owned Person authorization контрактов.
Этот план описывает следующий ограниченный этап; он не разрешает изменение
приложения, инфраструктуры или доступ к production до отдельного утверждения
архитектуры и соответствующих операций.

## Подтверждённое исходное состояние

- `apps/identity` реализует authorization code + S256 PKCE, exact redirect
  allowlist, десятиминутные ES256 access tokens, refresh rotation/reuse,
  WebAuthn/passkey, ограниченное TOTP recovery и типизированный security audit.
- API отдельно проверяет issuer, audience, scope и активный `PersonAccessGrant`.
- Локально прошли 48 Identity unit, 28 Identity integration и 16 целевых
  API/MCP unit tests; canonical documentation validation прошла.
- Staging API и Identity logical backups от 2026-09-28 восстановлены в
  изолированных PostgreSQL 17 instances. Они находятся на той же VM; это не
  защита от потери VM. Оператор временно принимает риск её полной потери;
  прежние предложенные RPO ≤ 1 час и RTO ≤ 4 часа для этого сценария сняты.
- В коде есть key-ring parsing, локально проверенные предварительная
  публикация нового `kid` в JWKS и переключение active signer с сохранением
  предыдущего ключа. Интервал перекрытия, retirement и аварийный runbook не
  подтверждены.
- `/live`, `/ready`, edge per-IP limits, структурированные ошибки и security
  events есть; production SLO/alerting и доказательство выбранного
  OpenID/OAuth conformance profile отсутствуют.

## Архитектурные решения до реализации

1. Принято временное исключение для host-managed signing-key ring на одной VM.
   До production реализовать его retirement, emergency deny на обоих API
   путях Identity JWT, защищённый runtime handoff и измеренный rotation
   runbook. Внешний Vault/KMS-grade provider отложен до отдельного решения.
2. Утвердить временную single-VM backup policy: расписание для обеих баз,
   максимальный возраст проверенной пары, retention, alert и владельца
   восстановления. Для полной потери VM нет гарантированных RPO/RTO.
   Off-host backup и независимая копия Recovery journal остаются будущим
   улучшением после появления внешнего хранилища.
3. Утвердить production hostname/RP ID и TLS ownership без переноса
   signing-key lifecycle в edge.
4. Утвердить минимальные security signals, SLO и владельца реакции на alert.

Проекты двух canonical ADR отделяют lifecycle signing keys от восстановления:
[signing keys](../../../docs/adr/20260928-temporarily-use-host-managed-identity-signing-keys.md)
и [backup/restore](../../../docs/adr/20260928-accept-single-vm-identity-recovery-risk.md).
Signing-key ADR принят; recovery ADR остаётся `proposed`. Реализация и
изменение остальных current-state Wiki страниц возможны только после
соответствующих архитектурных и quality gates.

## Минимальная последовательность после архитектурного утверждения

1. Сделать production OAuth/TOTP configuration fail closed: отсутствие
   обязательного профиля не должно давать успешную Identity readiness.
2. Реализовать и проверить публикацию нового `kid` до его активации, смену
   signer, bounded verification overlap, retirement и emergency replacement.
   Проверить совместимость с кэшем JWKS у API и уже выданными JWT.
3. Автоматизировать owner-controlled same-host logical backups обеих
   service-owned БД, проверку свежести пары, retention и alert.
   Восстановить пару в изолированную среду; проверить роли/ACL, миграционные
   журналы, синтетические read/write, Identity/API binding и обязательный
   Recovery erasure journal replay до открытия трафика. Измерить возраст
   backup и время локального восстановления, не заявляя VM-loss RPO/RTO.
4. Добавить только нужные метрики/alerts: OAuth/passkey failures, refresh
   reuse, readiness/JWKS errors, backup age/failure и restore-drill failure.
   События и логи не содержат токенов, TOTP seeds и Person-данных.
5. Выполнить независимый Security Review сценариев login/recovery, consent,
   redirect, revocation, token leakage, rate limits и incident response.
6. Запустить выбранный OpenID/OAuth conformance profile на работающем HTTP и
   interaction flow; зафиксировать версию, конфигурацию, результат и
   исправления. Повторить целевые Identity/API/MCP тесты и dependency review.
7. Провести independent Quality и Architecture Review, затем обновить
   каноническую Wiki по фактически принятому состоянию.

## Локальный прогресс без операций со средой

- Identity отказывает в production startup без полного OAuth profile и TOTP
  encryption key ring.
- Новый signing `kid` сначала сохраняется как `staged`, появляется в JWKS при
  старом active signer и только после отдельной reconciliation может стать
  active. Прямая активация неизвестного ключа отклоняется.
- ID token lifetime задан явно как 600 секунд; OAuth provider error logging
  не выводит исходное сообщение исключения.
- Identity unit 49/49 и integration 28/28 прошли, как и lint, typecheck,
  build и canonical docs validation. Один промежуточный integration run был
  прерван таймаутом старта тестового PostgreSQL container до запуска migration
  tests; целевой и последующий полный повтор прошли.
- Release `d79666aa12ead4cf4fd3b84f69d7b2e135440a21` опубликован и
  доставлен в staging: Identity migration journal был current, Identity/API/edge
  стали healthy, внешние staging smoke checks прошли. Write smoke не запускался.

Это не завершает production gate: retirement, emergency deny, backup policy,
monitoring, Security Review и conformance остаются открытыми. Принятие риска
потери VM не закрывает остальные gates.

## Критерии готовности к production

- Принятые ADR задают signing-key boundary, двухфазную ротацию, аварийную
  замену, временный single-VM recovery contract, backup retention, restore
  boundary, hostname/RP ID и владельцев наблюдаемости.
- Старый JWT остаётся проверяемым в заданном overlap; новый `kid` доступен
  через JWKS до первой подписи; компрометация имеет проверенный emergency path.
- Проверенная пара same-host backup свежа по утверждённому порогу; изолированный
  restore с Recovery erasure replay и отрицательными сценариями прошёл.
  Риск полной потери VM явно принят; RPO/RTO для него не заявляются.
- Production readiness не зелёная при отсутствующем обязательном OAuth или
  TOTP key configuration. Security alerts проверены без утечки credentials.
- Security Review и выбранный conformance profile приняты с сохранённым
  воспроизводимым evidence; API-owned Person authorization остаётся отдельной
  обязательной проверкой.
- `node scripts/validate-docs.mjs`, соответствующие тесты и независимые
  Quality/Architecture Review прошли.

## Вне scope текущего подготовительного шага

- Изменение кода, миграций, runtime-конфигурации или секретов;
- production/staging доступ, backup jobs, restore, deployment и smoke;
- staging, commit, push, release или изменение пользовательских незакоммиченных
  планов и ADR.

## Architecture Review проекта решения

1. Лишняя сложность: proposed ADR разделены по двум различным lifecycle и
   владельцам. Для наблюдаемости и conformance достаточно acceptance gates в
   плане; отдельные сервисы или ADR для них сейчас не нужны.
2. Преждевременные deployable boundaries: не добавляются. Identity, API и
   PostgreSQL сохраняют действующее владение.
3. DDD и модель: `PersonAccessGrant` остаётся в API; Identity не получает
   доступ к Person-данным или API database.
4. Дублирование authority: план описывает исполнение, proposed ADR — будущие
   решения, текущая Wiki остаётся описанием принятого состояния. Recovery
   erasure journal не переопределяется; production ADR ссылается на его
   действующий fail-closed контракт.
5. Упрощение без потери масштабируемости: текущая VM и service-owned базы
   сохраняются. Same-host logical backups полезны для локального restore,
   но не становятся disaster recovery и не имеют общего атомарного момента.
   При появлении off-host storage можно добавить независимые копии без
   изменения модели владения базами и Recovery replay.

Вывод review: временное single-VM решение соответствует доступной
инфраструктуре. Signing-key boundary принята; интервалы ротации, локальные
пороги backup и owner-operated storage должны быть проверены до production.

## Отдельные operator gates

- утверждение архитектурного ADR и плана реализации;
- доступ к секретам, БД и named environment;
- backup/restore drill в named environment;
- staging, commit, push, deployment и production release.

## Связанные материалы

- [Исходный план](../08/2026-08-02-identity-service-and-chatgpt-mcp-access.md)
- [Identity ADR](../../../docs/adr/20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Identity Wiki](../../../docs/wiki/architecture/identity-and-external-tool-access.md)
- [PostgreSQL backup and restore](../../../docs/wiki/operations/postgresql-backup-and-restore.md)
