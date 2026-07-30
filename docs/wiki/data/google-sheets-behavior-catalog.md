---
id: "data-google-sheets-behavior-catalog"
kind: data
title: "Каталог поведения Google Sheets"
status: draft
tags:
  - "behavior"
  - "data"
  - "dev-023"
  - "google-sheets"
---

# Каталог поведения Google Sheets

## Кратко

Read-only каталог значимого поведения workbook `Fitness Tracker` для
завершения DEV-023. Он отделяет исходные факты, business policy, workflow
state, projections и project governance. Персональные значения и исторические
fitness-данные в каталог не переносятся.

Каталог описывает наблюдаемую систему, но не предписывает будущую PostgreSQL
schema. Архитектурные предложения остаются в proposed-плане и требуют
отдельного утверждения.

## Содержание

### Наблюдаемые факты и справочники

| Листы | Наблюдаемая ответственность | Классификация |
| --- | --- | --- |
| `Weight`, `Body` | Измерения веса и тела по времени | Исходные facts Physical State; строка `Body` является одним measurement session |
| `Foods`, `Ingredients`, `Brands`, `Food_Ingredients` | Каталог питания и состав продуктов | Справочники Nutrition |
| `Meals` | Факты приёмов пищи с зафиксированными calories и macros | Исходные факты Nutrition с catalog reference и snapshot |
| `Training` | Выполненные тренировки, упражнения и session grouping | Исходные факты Training |
| `Program` | Текущие prescriptions и вычисленная следующая progression | Изменяемый plan и projection, не выполненный факт |
| `Personal Records` | Лучшие результаты по упражнению | Производная projection над Training |

Номер строки не является устойчивым identifier. Наблюдаемые `Food_ID`,
`Ingredient_ID`, `Brand_ID`, `Exercise_ID`, `Session_ID` и `Measurement_ID`
являются migration references, но их долговечность и uniqueness должны
проверяться отдельно.

### Configuration и policies

`Settings` содержит одновременно профиль пользователя, цели, ограничения,
параметры питания, правила тренировочной progression и safety guidance.
Численные цели и thresholds являются изменяемыми policy parameters, а не
вечными invariants.

`Rules` смешивает несколько разных классов:

- business и safety policy;
- правила неоднозначного natural-language intake;
- state machines очереди и repairs;
- правила построения insights и coaching;
- spreadsheet operations;
- project governance и устаревшие правила Managed Wiki.

Лист нельзя импортировать в runtime как готовый rules engine. В нём наблюдаются
как минимум duplicate rule identifier, одна строка со сдвинутыми полями,
несоответствие action ожидаемому смыслу и правила документации, конфликтующие
с текущим canonical Markdown workflow. Перед переносом каждое правило требует
классификации, стабильного identifier, owner и test vector.

### Daily projections

`Daily_Log` смешивает независимо принадлежащие факты и вычисляемые поля:

- `Weight` является authoritative журналом веса, а `Daily_Log.Weight` —
  проверяемым legacy mirror, не вторым fact channel;
- nutrition totals агрегируются из `Meals` по локальной дате;
- оставшиеся protein и calories вычисляются относительно текущей policy;
- calories target выбирается по типу дня;
- recovery status учитывает AI status и device evidence;
- next workout выводится из последней выполненной тренировки;
- progression permission зависит от recovery;
- readiness использует доступные objective indicators и AI modifier;
- readiness status, data quality и alert выводятся из score, полноты данных и
  safety signals;
- lifecycle ограничен controlled values open, closed и partial.

`Dashboard` вычисляет rolling trends веса, nutrition, recovery и training,
показывает последние derived statuses, следующую тренировку и narrative
recommendations, а также выполняет integrity comparison с `Meals`.

Следствие: `Daily_Log` и `Dashboard` являются cross-module read models. Они не
доказывают необходимость широкой таблицы или aggregate root `DayRecord`.

### Intake и execution workflow

#### `NL_Engine`

Natural-language input преобразуется в atomic events. Наблюдаемый контракт
содержит event identity, type, local date, source text, payload, confidence,
validation status, ambiguity reason и dedupe key. Один текст с несколькими
фактами разделяется на несколько событий. Неизвестные food или exercise и
другая неоднозначность требуют clarification; closed day защищён от скрытой
записи.

`target_sheet` и spreadsheet operation являются legacy routing details, а не
кандидатами в публичный backend contract.

#### `AI_Inbox`

Очередь использует переходы received, validated, processing, written и
терминальные или ожидающие состояния blocked, duplicate и failed. Запись
считается выполненной только после проверки результата и integrity.

#### `Self_Healing`

Repair workflow ограничен allowlist операций и требует eligibility check,
dry-run, snapshot, minimal apply, read-back, rollback и idempotency key.
Неоднозначные и closed-day изменения блокируются.

В PostgreSQL этот workflow не должен заменять обычные transactions и
constraints. Его переносимый смысл относится к reconciliation, import и
контролируемому исправлению уже сохранённых данных.

#### `AI_Timeline`

Timeline является append-only chronology с source references, causal parent,
severity, confidence, dedupe и status. Это audit/read model, а не доказательство
полного event sourcing.

### Analytics и coaching

#### `AI_Insights`

Insight содержит analysis window, sample size, effect, direction, confidence,
evidence, confounders, recommendation, lifecycle и expiration. Однодневные
наблюдения не считаются достаточным основанием, а correlation не объявляется
causation. Minimum sample и confidence thresholds являются versioned policy.

#### `Load_Risk`

Risk assessment использует многодневные окна, компонентные factors, hard stops
и data quality. Недостаток objective evidence ограничивает допустимую
уверенность. Результат должен быть воспроизводим по policy version и evidence.

#### `Weight_Autopilot`

Несмотря на имя листа, workflow относится к progression рабочей нагрузки, а
не к массе тела. Он выбирает hold, изменение repetitions, load или difficulty,
reduction либо calibration. По умолчанию результат является recommendation;
изменяется только один параметр, а progression требует повторного
подтверждения и прохождения safety gates.

#### `Coach_Planner`

Planner применяет порядок приоритетов: safety, recovery, nutrition floor,
существующая training program, progression и day closure. Он формирует одну
основную рекомендацию со ссылками на evidence, не создаёт выполненные факты и
не переписывает программу автоматически.

### Governance вне runtime

`Changelog`, `Roadmap`, `Ideas` и project-level часть `Decisions` и `Rules`
относятся к управлению проектом. Они не мигрируют в product database и не
становятся backend modules.

`Decisions` подтверждает intended capabilities и архитектурные ограничения
workbook, но актуальная authority архитектуры находится только в
`docs/adr/**/*.md`.

### Apps Script

До проверки связанный Apps Script отсутствовал: переход из workbook открыл
создание нового пустого проекта с default `myFunction`, а не существующий
проект с business logic. Код, triggers и deployments не обнаружены. Созданный
Google интерфейсом пустой проект не является частью исходного behavior
baseline; после явного разрешения оператора проект удалён без возможности
восстановления.

### Пробелы parity

- Исторические нарушения requiredness и controlled vocabularies не
  доказываются чтением ограниченных диапазонов.
- Conflict policy независимых будущих source channels остаётся открытой;
  подтверждённое зеркало `Weight`/`Daily_Log.Weight` разрешено отдельно.
- Не утверждены privacy, retention и deletion для source text, photos и
  wearable evidence.
- Не определён authoritative exercise catalog.
- Текущие policy parameters ещё не имеют стабильных identifiers, versions и
  effective periods.

## Основания

Metadata workbook, ограниченное чтение всех 26 листов, чтение формул
`Daily_Log` и `Dashboard`, validation `DayStatus`, явные contracts листов
`NL_Engine`, `AI_Inbox`, `Self_Healing`, `AI_Timeline`, `AI_Insights`,
`Load_Risk`, `Weight_Autopilot` и `Coach_Planner`, а также проверка отсутствия
предсуществующего связанного Apps Script.

## Решения

Каталог остаётся draft evidence до domain review. DEV-023 должен переносить
смысл business rules и workflows, а не sheet layout, formulas или project
governance. Behavior parity проверяется synthetic test vectors без копирования
персональных данных.

## Открытые вопросы

- Какой минимальный набор behavior должен быть реализован до DEV-024, а какой
  можно явно deferred без потери безопасного dual-run?
- Какие policies пользователь может менять самостоятельно, а какие требуют
  product release или экспертного review?
- Нужен ли отдельный explicit lifecycle `JournalDay`, если closed-day guard
  можно выразить узкой записью блокировки даты?

## Связанные материалы

- [Инвентаризация Google Sheets](google-sheets-inventory.md)
- [Source of truth и authority](source-of-truth-and-authority.md)
- [Целостность и lifecycle](integrity-and-lifecycle.md)
- [Карта извлечения домена](../domain/domain-extraction-map.md)
- [План завершения DEV-023](../../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
