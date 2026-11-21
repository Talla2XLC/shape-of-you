# TASK-0184 — Прямое подключение Garmin и исправление компоновки

Статус: локальная реализация принята; доставка выполняется отдельно.

## Согласованные границы

Удалить Intervals и переход из сайта. Сохранить данные и серверные operational
contracts. Решение: `docs/adr/20261121-retire-intervals-browser-management.md`.

## План

1. Удалить legacy browser component/adapters/copy и их устаревшие тесты.
2. Оставить Garmin flow и все его действия; оформить статус и даты синхронизации.
3. Исправить верхний отступ и промежутки локальными responsive styles.
4. Проверить новые/подключённые/ошибочные состояния, mobile и desktop screenshots.
5. Пройти независимые Quality и Architecture Review, обновить affected Wiki.
6. Завершить согласованную доставку: commit, полный pre-push, CI, staging promotion
   и smoke. Production не входит в scope.

## Результаты

Удалены legacy UI component/adapters/copy и устаревшие browser tests, при этом
API, contracts, история и настройки соединений не изменялись. Все действия
Garmin сохранены, включая CSRF и passkey-подтверждение удаления.

Web lint без предупреждений, typecheck, static build и 30 unit tests прошли.
Полный Web Playwright: 33/33; отдельно проверены отсутствие legacy-запросов и
текстов, active/degraded, один submit нового пользователя, polling races,
erasure и отсутствие browser persistence. Снимки 320/768/1440 px и экран
первого подключения просмотрены. Верхний отступ 32 px, между заголовком и
карточкой 28 px; действия получили primary/secondary/danger иерархию.

Независимые Quality и Architecture Review приняты и записаны в TASK-0184.
Affected canonical Wiki обновлена после приёмки. Полный pre-push, CI и
staging delivery должны пройти до сообщения о завершении доставки.
