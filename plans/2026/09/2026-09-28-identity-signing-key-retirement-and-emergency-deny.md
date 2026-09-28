# Identity — завершить retirement signing keys и emergency deny

Статус: in progress; реализация одобрена оператором. Архитектура
host-managed key ring принята в
[ADR](../../../docs/adr/20260928-temporarily-use-host-managed-identity-signing-keys.md).

## Цель

Закрыть опасное окно после ротации или компрометации ES256 key: новый `kid`
публикуется до подписи, старый удаляется после доказанного overlap, а API
немедленно отвергает скомпрометированный `kid` независимо от JWKS cache.

## Исходное состояние на момент утверждения плана

- `OAuthSigningKeyStore.reconcile` реализует `staged` → `active` →
  `verifying` и не допускает исчезновения verification key из runtime ring.
  Переход `verifying` → `retired` отсутствует.
- `McpAuthorizer` и `BrowserAuth` вызывают `jwtVerify` с удалённым
  кэшируемым JWKS. Локальной deny policy для `kid` нет.
- Access и ID tokens живут 600 секунд; безопасная выдержка также зависит от
  измеренного JWKS cache lifetime и допустимого clock skew.
- Staging release `d79666aa12ead4cf4fd3b84f69d7b2e135440a21` прошёл
  миграции, readiness и внешний smoke. Это не проверяло retirement или
  compromised-`kid` incident.

## Реализация после утверждения плана

1. Зафиксировать верхние границы JWKS cache и clock skew для обоих API путей,
   записать обычный rotation checklist и тестируемые интервалы. Не активировать
   новый `kid` до истечения publication interval; не удалять старый до
   истечения срока ранее выданного access/ID token плюс skew.
2. Добавить явный, повторяемый переход `verifying` → `retired` при
   согласованном удалении старого key из runtime ring и JWKS. Startup
   отказывает при раннем удалении, повторном появлении retired key, подмене
   public material или rollback, который вернул бы retired key к подписи.
   При необходимости миграции сначала спроектировать новые поля и проверить
   PostgreSQL identifiers на 63 UTF-8 bytes.
3. Ввести локальную versioned `kid` deny policy в API. Её чтение и проверка
   выполняются в обоих текущих путях Identity JWT: MCP bearer и browser OAuth
   callback. Неправильная конфигурация отклоняется при startup; compromised
   `kid` отвергается и с холодным, и с тёплым JWKS cache.
4. Подготовить incident command/checklist: порядок deny в API, прекращения
   подписи в Identity, отзыва затронутых sessions/refresh families, публикации
   replacement key и проверки старых/новых JWT. Команда не должна печатать
   private material, токены или Person-данные.
5. Запустить независимый Security Review и целевые unit/integration tests.
   Обновить только затронутую current-state Wiki после принятой Quality review.

## Критерии приёмки

- Отдельная публикация нового `kid` видна в JWKS до первой подписи; warm и
  cold API clients принимают новый JWT после activation.
- Старый JWT работает в утверждённый overlap; после retirement старый `kid`
  отсутствует в JWKS, новый JWT им не подписывается, повторная публикация
  отклоняется.
- API отвергает compromised `kid` в MCP и browser callback даже при тёплом
  JWKS cache; неизвестный/отсутствующий `kid` не обходит deny policy.
- Неверные ring/metadata/deny settings отказывают до readiness; rollback не
  возвращает retired key или compromised `kid`.
- Incident drill подтверждает порядок deny, отзыв refresh authority и
  replacement без вывода credentials; документация отражает только проверенное.
- Identity/API tests, lint, typecheck, build и
  `node scripts/validate-docs.mjs` прошли; Quality и Architecture Review
  зафиксированы.

## Границы и отдельные approvals

Этот план не разрешает доступ к секретам или production, изменение VM,
ротацию реальных ключей, staging/production deployment, миграции среды,
commit или push. Такие операции требуют отдельного явного разрешения.
Backup policy, monitoring и OpenID/OAuth conformance остаются в
[общем плане](2026-09-28-identity-production-hardening.md).

## Принятый инцидентный порядок

Оператор одобрил остановку выдачи OAuth токенов вместо досрочной активации
replacement key. После локального deny скомпрометированного `kid` нужно
инвалидировать прежние API browser-session cookies заменой verification key
ring без старого ключа. Identity запускается с
`IDENTITY_OAUTH_ISSUANCE_DISABLED=true`: доступны только публичные metadata и
JWKS, `/ready` и все пути выдачи отвечают `503`. Отдельная операторская команда
с подтверждающим аргументом глобально отзывает Identity sessions, session
authorizations и refresh families в одной транзакции.

Новый `kid` публикуется в JWKS при выключенной выдаче. После внешней проверки
и выдержки не менее 660 секунд он активируется, а старый ещё остаётся в ring
как `verifying`. После следующих не менее 660 секунд старый key удаляется из
ring/JWKS и переводится в `retired`. Лишь после внешней проверки, что старый
`kid` отсутствует, можно снять режим остановки выдачи. API deny старого `kid`
сохраняется; rollback на image без deny запрещён. Все изменения среды,
секретов и реальные команды инцидента требуют отдельных разрешений.

Quality отклонил первую реализацию: штатный staging `Promote` не может принять
преднамеренный `/ready=503`, а rollback не учитывал deny capability. Оператор
разрешил исправление через отдельный
[maintenance path](../../../docs/adr/20260928-separate-identity-incident-maintenance-from-normal-staging-release.md).
Фазовая команда работает с root-owned кандидатами runtime env и текущими
digest-pinned images, проверяет внешний metadata/JWKS и ожидаемые HTTP статусы,
а active incident marker закрывает обычный deployment и rollback. После
`resume` нужен новый полный Identity release для согласования runtime env и
release manifest; API deny не снимается этим переходом. Локальный макет
четырёх фаз и проверка отказа неправильного порядка входят в CI.

Для operator drill подготовить полные root-owned `0600` файлы вне Git; их
содержимое не выводить. После установки API candidate операторская
команда запускает в работающем API container проверку фактической deny policy и
отклонения старого `kid`. API candidate содержит deny для старого
`kid` и новый `API_BROWSER_SESSION_KEYS` без прежних verification keys.
Identity candidates сохраняют оба rotation interval не меньше 660 секунд.
Первое успешное внешнее чтение пригодного JWKS фиксируется в incident marker;
`activate` запрещён до истечения publication interval от этого времени.
Локальный drill проверяет ложный JWKS и warm/cold JWT acceptance.
После третьего Quality review происхождение API image проверяется до SSH:
любой staging workflow, включая direct dispatch, сверяет digest с artifact
успешного publish run для точного `RELEASE_ID`. Только candidate с явной
отметкой проверенных MCP и browser deny путей разрешает incident stage;
старый candidate может служить recovery release, но не аварийной ротацией.
Проверка helper внутри контейнера остаётся дополнительным барьером.

| Фаза | Identity active/ring | Режим | Проверка |
| --- | --- | --- | --- |
| `stage` | старый active, старый+новый | JWKS-only | API deny/readiness, глобальный отзыв authority, metadata/JWKS, выдача `503` |
| `activate` | новый active, старый+новый | JWKS-only | минимум 660 секунд после внешней публикации, оба `kid` в JWKS |
| `retire` | новый active, только новый | JWKS-only | минимум 660 секунд после activation, старого `kid` нет в JWKS |
| `resume` | новый active, только новый | обычный | Identity `/ready=200`, API deny старого `kid` сохранён |

Фазовая команда: `sh deploy/staging/scripts/identity-incident-maintenance.sh`
с `stage <api-candidate> <identity-candidate> <old-kid> <new-kid>` или
`activate|retire|resume <identity-candidate>`. Её запускает только одобренный
оператор с root-доступом из проверенного control checkout на названной VM.
При ошибке фазы marker остаётся в `preparing-*`, а Identity останавливается;
повтор без расследования запрещён. После `resume` обычный полный Identity
deployment с тем же API deny устраняет runtime/manifest drift и удаляет marker.

## Architecture Review

1. Лишняя сложность: используются существующие lifecycle rows и два
   существующих API verifier; отдельный сервис для key management не нужен.
2. Преждевременные границы: Identity остаётся issuer, API — resource server
   и владельцем Person grant; общего database access нет.
3. DDD: `PersonAccessGrant` не переносится в Identity, deny policy относится
   только к криптографическому доверию JWT.
4. Дублирование authority: ADR задаёт инварианты, этот план — порядок работ,
   Wiki описывает только реализованное состояние.
5. Упрощение: локальная API deny policy достаточна для текущих двух путей и
   одной VM; внешняя control plane не вводится. При новом resource server тот
   же контракт придётся реализовать отдельно.

## Связанные материалы

- [Identity signing-key ADR](../../../docs/adr/20260928-temporarily-use-host-managed-identity-signing-keys.md)
- [Identity current state](../../../docs/wiki/architecture/identity-and-external-tool-access.md)
- [Production hardening plan](2026-09-28-identity-production-hardening.md)
- [Separated incident maintenance ADR](../../../docs/adr/20260928-separate-identity-incident-maintenance-from-normal-staging-release.md)
