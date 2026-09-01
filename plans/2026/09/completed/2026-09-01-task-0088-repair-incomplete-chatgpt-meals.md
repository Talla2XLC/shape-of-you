# TASK-0088 — Восстановление неполных ChatGPT Meal-записей

## Gate

- Начать staging reads только после успешной доставки TASK-0086.
- Перед передачей персональных fitness/health данных в ChatGPT через браузер
  получить action-time подтверждение.
- Оператор уже поручил исправить прошлые битые записи, но точный repair set
  должен быть сформирован read-before-write.

## Scope

1. Через typed Meal reads перечислить недавние ChatGPT-created записи, где
   calories/protein/fat/carbs отсутствуют полностью или частично.
2. Не считать скриншоты или память authoritative inventory.
3. Для понятных описаний подготовить conservative best-effort amounts и четыре
   nutrients с method/confidence.
4. Применить существующий append-only `correct_meal` без прямого SQL.
5. После каждой коррекции выполнить `list_meals(localDate)` и проверить новый
   authoritative record.
6. Не изменять imported legacy records, Google Sheets, production, OAuth,
   schema или migrations.

## Acceptance criteria

1. Repair set содержит точные Meal ids, даты и исходные descriptions из typed
   staging reads.
2. Каждая исправленная запись сохраняет исходный смысл еды и получает
   приблизительные calories/protein/fat/carbs.
3. Неясные записи остаются без изменения и явно перечислены отдельно.
4. Каждая запись подтверждена typed read-back.
5. Quality и Architecture Reviews дают `ACCEPT`.

## Результат

- После успешного staging deployment TASK-0087 typed `list_meals` выявил шесть
  недавних manual Meal-записей без КБЖУ за 2026-08-30—2026-09-01.
- Все шесть записей исправлены существующим append-only `correct_meal` с
  консервативной приблизительной оценкой calories/protein/fat/carbs.
- Date-scoped `list_meals(localDate)` подтвердил новые current records и
  корректные `supersedesId`; все шесть записей имеют полные nutrition totals.
- Imported legacy records, Google Sheets, production, OAuth, schema и migrations
  не изменялись.
- Quality Review и Architecture Review: `ACCEPT`.
