# TASK-0092 — Обратная совместимость MCP Meal schema между деплоями

## Проблема

TASK-0090 сделала `amountKind` обязательным в существующих tools
`record_meal` и `correct_meal`. Уже открытый ChatGPT/Codex conversation
продолжает отправлять аргументы по ранее полученной schema. После deployment
сервер валидирует их по новой schema и отклоняет запрос до выполнения
`normalizeMealInput`, хотя старый payload содержит достаточно данных для
безопасной нормализации.

OpenAI documentation требует сохранять опубликованные tool names и schemas
backward compatible. Developer-mode metadata refresh является отдельным
ручным действием клиента и не может быть обязательной частью пользовательского
Coach-сценария.

## Цель

Существующий Coach conversation продолжает записывать полноценные Meal после
deployment без переоткрытия чата, reconnect OAuth или действий пользователя.
Новые клиенты при этом получают расширенную evidence schema.

## Архитектурные варианты

### Вариант A — Автоматизировать client metadata refresh

- Плюс: клиент сразу видит новую schema.
- Минусы: официальный flow для developer-mode connection требует открыть
  Plugins, нажать Refresh и заново прогнать conversation; server-side API для
  принудительного обновления существующих чатов не заявлен.
- Решение: отклонить как неконтролируемое и не пригодное для UX-гарантии.

### Вариант B — Версионировать tool names

- Оставить `record_meal`/`correct_meal` как v1 и добавить новые tools с новым
  именем или namespace.
- Плюс: строгая совместимость при действительно breaking change.
- Минусы: дублирование tools, рост каталога и необходимость долго поддерживать
  две модели одного действия.
- Решение: сохранить как правило для будущих несовместимых изменений, но не
  применять к текущему additive evidence contract.

### Вариант C — Additive schema и server-side normalization

- В connector-facing schema оставить `amountKind`, `amountDescription`,
  `estimateMethod` и `amountConfidence`, но не требовать новые evidence-поля от
  старого клиента до вызова handler.
- `normalizeMealInput` восстанавливает `amountKind` из уже известных
  `quantity`/`unit`, `amountDescription` или estimate metadata.
- Defense-in-depth guard после нормализации по-прежнему требует non-unknown
  amount evidence и все четыре числовых nutrient значения, поэтому incomplete
  Meal не записывается.
- Плюсы: текущие tool names, OAuth, service boundary и UX не меняются; старые и
  новые conversations работают одновременно.
- Минус: старый клиент не передаст новые optional metadata и для него сервер
  сохранит только evidence, которое можно безопасно вывести из старого payload.
- Решение: рекомендуемый минимальный вариант.

## Предлагаемое решение

1. Реализовать вариант C для `record_meal` и `correct_meal`.
2. Добавить regression fixture старой TASK-0086/TASK-0087 schema и доказать,
   что complete legacy payload проходит после нового deployment.
3. Сохранить тесты TASK-0090: null nutrients и genuinely unknown amount по-прежнему
   отклоняются до NutritionService.
4. Добавить release compatibility gate: существующий tool не может получить
   новое required input field или удалить/сузить старое поле без отдельной
   версии tool.
5. После deployment завершить TASK-0091 тем же уже открытым connector client и
   сделать typed read-back четырёх corrections.

## Acceptance criteria

1. Payload из уже открытого до TASK-0090 conversation с `label`, `quantity`,
   `unit` и полным `nutrients`, но без новых evidence fields, успешно
   нормализуется и записывается.
2. Payload без полного КБЖУ остаётся fail closed и не вызывает repository write.
3. Актуальная schema продолжает рекламировать evidence fields и принимает
   `estimated + photo/text + confidence`.
4. Автоматический compatibility test ловит будущие breaking required-field,
   enum-narrowing и field-removal изменения существующих MCP tools.
5. Не добавляются services, databases, OAuth clients, migrations, tools или
   deployable boundaries.
6. Staging E2E подтверждает работу старого conversation без reconnect и новый
   typed read-back.

## Документация и решение

После архитектурного одобрения нужен новый ADR о backward-compatible evolution
MCP tool schemas и точечное обновление Wiki по external tool access/deployment.
До одобрения implementation code не изменяется.

## Запрещено без отдельного подтверждения

- staging writes и deployment;
- commit и push;
- production, secrets и OAuth reconnect;
- Google Sheets writes, ACL, archive или delete.
