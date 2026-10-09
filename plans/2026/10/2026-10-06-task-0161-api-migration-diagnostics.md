# TASK-0161 — диагностика и восстановление staging delivery

## Статус

Оператор разрешил направление исправления staging и отдельно read-only SSH
на talking-to-ai. Ниже конкретный implementation plan для одобрения.
Retry/deploy, DDL, runtime configuration, restart, commit/push и production
этим планом не разрешаются.

## Факты и неизвестность

Exact Promote 37502919907 для 68789d1 остановился на API migration: runner
показал только outer Drizzle message о CREATE SCHEMA IF NOT EXISTS drizzle и
exit1. Этот commit не содержит миграций. Underlying exception не сохранён.
Read-only проверки позднее успешны: API/Identity connections, API role CREATE
и drizzle USAGE/CREATE, journal59, healthy containers и readiness. Эти текущие
результаты не объясняют historical failure и не доказывают readiness68789d1.
На VM остался предыдущий API image; нового rollout и smoke нет.

## Рекомендуемый узкий объём

1. Заменить вывод raw error.message в API migration entrypoint фиксированным
   безопасным событием: server-generated diagnostic ID, фиксированная фаза,
   категория и SQLSTATE/network code только из закрытого allowlist.
2. Читать ограниченную цепочку cause с защитой от циклов; исключить SQL,
   parameters, connection URL, identity, env, message, stack и произвольные
   поля. Не угадывать timeout из текста и не сериализовать exception.
3. Сохранить existing Drizzle runner, соединение, timeout, порядок миграций,
   exit semantics и cleanup. Не добавлять blind retry, новый DDL, readiness
   algorithm, обход журнала или повышение привилегий без отдельного решения.
4. Unit privacy tests и isolated PostgreSQL failure scenario должны показать
   реальный underlying code без раскрытия credentials/query/parameters.
5. API typecheck/build/lint, relevant tests, independent Quality, Architecture
   Review, affected operational Wiki после принятия и docs validation.

## Альтернативы

- Только повторить pipeline: может восстановить доставку при transient failure,
  но новая неудача останется без причины; требует отдельного deploy approval.
- Увеличить connection timeout или добавить retries сейчас: причина не доказана,
  изменение лишь скрывает возможный другой отказ. Не рекомендуется до evidence.
- Добавить безопасную диагностику и использовать стандартную доставку после
  её отдельного одобрения: рекомендуемый минимальный путь, без обещания, что
  historical runtime-причина устранена.

## Граница завершения

Локально можно завершить устранение диагностического пробела. Восстановление
staging подтверждает только exact успешный pipeline через migration,
runtime readiness и smoke. Actor GitHub Actions, environment staging.
При повторном отказе использовать новую безопасную корреляцию для
конкретного remedial plan; ручные миграции и guard bypass не допустимы.
