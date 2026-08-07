# Публикация OAuth-метаданных MCP через staging ingress

## Цель

Открыть на публичном origin MCP стандартный OAuth protected-resource metadata
endpoint, который уже реализован API, но пока не проксируется edge-nginx.

## Подтверждённое решение

- На `staging.shape-of-you.ru` добавить точный маршрут
  `/.well-known/oauth-protected-resource` к API.
- Не менять ACME challenge-маршрут, TLS-топологию, OAuth-контракт или
  доменные API.
- Закрепить маршрут статическим staging contract test.

## Реализация

1. [x] Подтвердить, что API обслуживает метаданные, а публичный ingress отдаёт
   `404`.
2. [x] Добавить точный reverse-proxy route в HTTPS server основного staging
   хоста.
3. [x] Дополнить контрактный тест ingress-конфигурации.
4. [x] Прогнать релевантные проверки, проверку документации и независимый
   review.
5. [x] После отдельного подтверждения подготовить commit и push; staging
   проверяется штатным GitHub Actions deployment.

## Границы

- Без изменений в Identity, OAuth signing keys, миграциях и секретах.
- Без ручных изменений на ВМ: обновление должно пройти через уже установленный
  versioned deployment controller.

## Результат

Commit `7f530c9` успешно прошёл quality, публикацию образов и автоматический
staging deployment. Публичный
`https://staging.shape-of-you.ru/.well-known/oauth-protected-resource`
отдаёт `200` и корректно объявляет MCP resource, Identity authorization server
и разрешённые scopes. Проверки `/api/health` и `identity.../live` также
вернули `200`.
