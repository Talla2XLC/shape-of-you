# TASK-0075 — Fresh ChatGPT chat и capability gates внешних providers

## Статус

- Product scope создан 2026-08-28.
- Официальные capability contracts исследованы read-only.
- Live fresh-chat probe завершён: plugin доступен без reconnect,
  `get_daily_projection` вызван первым, typed-read failure обработан fail closed.
- Independent Quality и Architecture Reviews дали `ACCEPT`.
- Отдельный defect: отсутствие либо сбой active TrainingProgram возвращается
  через `get_active_training_program` как `INVALID_ARGUMENT`.
- Implementation, OAuth registration, staging writes, commit, push и deployment
  не разрешены.

## Цель

Доказать, что новый ChatGPT conversation может независимо восстановить Daily
Coach state через существующий Shape of You MCP, и отделить это от
неподтверждённой поддержки внешних providers.

## Scope

1. Проверить доступность установленного Shape of You MCP в новом ChatGPT Chat
   или Work conversation.
2. Выполнить только read-only сценарий с `get_daily_projection` первым typed
   read и без reliance на permanent conversation history.
3. Зафиксировать OAuth/session behavior, но остановиться перед новым consent,
   reconnect или credential operation без отдельного approval.
4. Составить capability matrix для прямого DeepSeek Chat/API и DeepSeek model
   через внешний MCP-capable host.
5. Проверить fail-closed результат для unsupported provider.

## Non-goals

- provider OAuth client, callback, API key или secret;
- Web launcher/provider selector и conversation binding;
- собственный agent runtime, chat UI или deployable;
- staging или production write;
- Google Sheets fallback;
- cross-provider history sync.

## Текущая capability matrix

| Surface | Evidence | Предварительный результат |
| --- | --- | --- |
| Existing permanent ChatGPT conversation | Пройден TASK-0069 live read-only flow | Supported |
| Fresh ChatGPT conversation | Plugin выбран без install/reconnect; `get_daily_projection` успешно вызван первым | Supported; downstream Training read defect вынесен отдельно |
| DeepSeek consumer chat | Нет первичного evidence remote MCP, Shape of You OAuth и native write confirmation | Unsupported / fail closed |
| DeepSeek API directly | Официальный Responses guide: `mcp` игнорируется; доступны function tools и server-side web search | Does not conform |
| DeepSeek model через MCP-capable host | Официальные integrations показывают MCP через host вроде Codex/Copilot, а не через DeepSeek API | Candidate only; отдельный host/security/OAuth probe |

## Live verification

1. Оператор входит в ChatGPT в доступной browser session.
2. В новом conversation проверить наличие Shape of You capability без install,
   reconnect или OAuth mutation.
3. Перед отправкой запроса, который передаст health data в ChatGPT, получить
   отдельное action-time confirmation.
4. Запросить Person-local date/timezone и read-only Daily Coach state.
5. Подтвердить `get_daily_projection` first, отсутствие writes и отсутствие
   chat-history/Sheets fallback.
6. При OAuth prompt, missing tool или inconsistent result остановиться и
   зафиксировать fail-closed evidence.

## Проверка

- official OpenAI and DeepSeek primary documentation;
- live browser evidence только после operator login и confirmation;
- `node scripts/validate-docs.mjs`, если canonical docs будут изменены;
- `git diff --check` и `4dt-board validate`.
