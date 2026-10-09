# TASK-0169 — Ожидание соединений при чтении контекста Coach

## Статус

Оператор утвердил архитектуру и этот план 2026-10-09; реализация завершена и
принята независимым Quality (`task-0169-quality-acceptance-20261009`).
Оператор закоммитил и запушил `d6c22e6b16560bf8205d1f8008519c0aaeb893eb`,
затем разрешил проверку и staging delivery. Публикация этого SHA завершилась
ошибкой CI; выкладка того SHA не началась. После отдельного разрешения исправление
тестов закоммичено и запушено как `634237ff855a674f9a6b7cd28ed1b5a7ba81792a`.
Реализация и staging delivery завершены; production/release tags не выполнялись.
[ADR](../../../../docs/adr/20261009-bound-api-database-connection-waits.md).

## Доказательства и пределы

Сохранённый failed daily-read имеет UUID и execution failure body; args {} валидны.
Original exception log утрачен после разрешённой замены контейнера. Его причина
не установлена. Отдельно подтверждён pool wait timeout: production max 10,
1000 ms budget, 1002 ms до Error без SQLSTATE при занятых соединениях.
Параллельная live пара после выкладки прошла. Не считать гипотезу о старом
отказе установленным диагнозом.

## Объём после утверждения

1. Existing API pool acquisition timeout 1000→5000 ms; max 10/4 сохранить.
2. Safe fixed `pool_acquisition_timeout` classification в bounded cause chain.
   Не раскрывать сообщения/SQL/values; technical authorization guards сохранить.
3. Real MCP→PG pin: временная очередь дольше старого budget успешно читается;
   длительная очередь возвращает bounded unknown failure с UUID и safe reason.
4. Проверить старые typed consistency/database классификации, auth/input distinction,
   Person scope и privacy. Не менять product eligibility или Training facts.
5. Relevant tests/typecheck/build/lint, independent Quality, five-point Architecture
   Review, canonical Wiki после приёмки; переместить план в completed.
6. Только отдельно разрешённая доставка exact commit с CI, migration step,
   readiness/smoke и live read. Персональные записи не создавать.

## Критерии приёмки

- Temporary contention между 1 и 5 секундами не вызывает старый секундный отказ.
- Pool maximum не увеличен. Длительное ожидание ограничено и диагностируется.
- Safe logs/public errors не содержат raw exceptions и чувствительные данные.
- Existing successful reads, scope, versions и consistency semantics сохранены.
- Исторический UUID не объявлен исправленным без доказательства его причины.

## Результат

API использует 5000 ms вместо 1000 ms при прежнем max 10/4. Классификация
ограничена четырьмя cause nodes: typed consistency → recognized SQLSTATE →
точная pg-pool Error → unclassified. Public error и Person scope сохранены.

Проверки разработчика: все 407 API unit tests; 11 DailyAssessment PostgreSQL
tests; 2 новых MCP→real services→isolated PostgreSQL сценария; typecheck, build,
lint, docs validator и diff check. Временная занятость pool на 1500 ms позволила
чтение после освобождения; exhaustion завершился примерно через 5 секунд с
безопасной диагностикой, повторное чтение после освобождения прошло.
Первый запуск нового теста выявил отсутствующую синтетическую Person в фикстуре;
фикстура исправлена, оба сценария прошли повторно.

Quality независимо проверил 32 unit tests и оба PostgreSQL сценария, а также
typecheck/lint/docs/diff. Architecture Review подтвердил отсутствие новых
сущностей/сервисов, сохранение DDD ownership, отсутствие дублирующей Wiki и
сохранение ограничения ресурсов. Новых migrations и SQL identifiers нет.

Canonical Wiki приведена к принятому коду:
[Backend runtime](../../../../docs/wiki/architecture/backend-runtime.md) и
[Coaching](../../../../docs/wiki/domain/coaching-and-decision-support.md).
Историческая причина UUID остаётся неизвестной. Production не менялся;
staging delivery описана ниже. Персональные записи не создавались.

## Доставка и исправление CI

[Publish 37912666866](https://github.com/Talla2XLC/shape-of-you/actions/runs/37912666866)
остановился до публикации образов: две матрицы unit tests по 12 последовательных
MCP-вызовов превысили default timeout 5000 ms на CI. Остальные 613 API tests
прошли, включая оба новых PostgreSQL сценария. Pipeline не дошёл до миграций,
readiness и smoke; staging не обновлялся этим запуском.

Матрица разделена на независимые параметризованные случаи: 40 tests вместо
18 в файле, те же cases/assertions и прежний timeout. Runtime не менялся.
Разработчик и независимый Quality проверили 54 read/write error tests, lint,
docs и diff; typecheck разработчика также прошёл.
Приёмка: `task-0169-ci-test-rework-quality-20261009`.
Canonical Wiki соответствует прежнему принятому runtime и не требует изменения.
Пятичастный Architecture Review остаётся применимым: изменение только тестовое.

## Результат staging delivery

Публикация push commit прошла в
[run 37915575967](https://github.com/Talla2XLC/shape-of-you/actions/runs/37915575967).
Первый [Promote 37916650458](https://github.com/Talla2XLC/shape-of-you/actions/runs/37916650458)
отказал до изменений из-за занятого deployment lock. Штатный повтор освободившийся
lock прошёл, но отказал из-за expected base `d6c22e6`, который не был выложен.
Защиты не обходились. Штатная manual full publication того же SHA включила
Identity и создала candidate без предположения о предыдущем deployed commit.

[Full Publish 37917078484](https://github.com/Talla2XLC/shape-of-you/actions/runs/37917078484)
и [Promote 37918246971](https://github.com/Talla2XLC/shape-of-you/actions/runs/37918246971)
успешны. Deployment pipeline на staging выполнил API migration step
`2026-10-09T10:33:38Z` и Identity migration step `10:33:45Z`; Identity journal
имеет result `current`, новых migrations задача не добавляла. Runtime-ready,
smoke и exact SHA deployment подтверждены завершением `10:34:41Z`.
Public API и Identity readiness — HTTP 200. После выкладки параллельные
authorized MCP Recovery и Daily Decision Context reads вернули `available`
за `2026-10-09`. Это проверяет текущую доступность, не устанавливает причину
утраченного UUID. Write smoke отключён, личные факты не записывались.
