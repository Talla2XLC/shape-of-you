# TASK-0090 — Обязательные оценки питания в Coach Meal writes

## Проблема

Даже после TASK-0086 понятное фото и описание еды могут быть успешно сохранены
без калорий и БЖУ. Текстовые инструкции требуют оценки, но connector schema
принимает один `label`, а адаптер нормализует отсутствующие nutrients в `null`.

## Цель

Сделать уже принятое правило TASK-0086 исполняемым: обычный Coach Meal write
для распознанной еды не проходит без разумной оценки порции, калорий, белков,
жиров и углеводов.

## Scope

- Ужесточить только MCP connector schema для `record_meal` и `correct_meal`.
- Добавить runtime-защиту до вызова `NutritionService`.
- При неполном вызове потребовать один тихий повтор по уже имеющимся фото и
  тексту, без вопроса пользователю и без технических подробностей.
- Закрепить регрессией сценарий: курица терияки с рисом, огурцами и помидорами.

## Не входит

- Изменение REST/domain Meal contract и legacy/import semantics.
- Новая модель оценки питания, сервис, база, миграция или OAuth client.
- Запись в staging, Google Sheets, production, deploy, commit или push.

## Критерии приёмки

1. MCP не вызывает `NutritionService`, если хотя бы у одного Meal item нет
   числовых calories/protein/fat/carbs.
2. MCP не принимает `amountKind = unknown` для routine Coach Meal write.
3. Полная best-effort оценка по фото проходит существующий domain contract.
4. Ошибка направляет клиента на тихий повтор из текущего контекста и не
   предлагает пользователю техническое состояние `partial`.
5. Полный API test suite, typecheck, lint, build и docs validation проходят.

## Архитектурное соответствие

Используется существующая граница MCP → NutritionService и уже принятая модель
estimated amount evidence. Persisted partial Meals сохраняются для legacy и
действительно неоднозначных источников; новые сущности и границы не появляются.
