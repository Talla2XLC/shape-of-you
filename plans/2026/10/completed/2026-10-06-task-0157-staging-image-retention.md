# TASK-0157 — очистка staging и ограничение хранения образов

## Статус

Оператор одобрил точечную очистку, ADR и план сообщением «да». Live очистка
завершена; реализация retention принята независимой Quality.

## Факты и разовое действие

- На staging заполнены inode: 3 119 880 из 3 125 184; свободно около 7,6 GiB.
- Из 618 Docker images 610 относятся к четырём repositories Shape.
- Dry-run исключает 21 защищённый образ, включая образы всех контейнеров,
  четыре координаты previous и по три свежих образа каждого repository.
- 597 кандидатов, созданных с 2026-07-29 до 2026-09-29, перечислены в
  /private/tmp/shape-docker-cleanup-inventory.json. Сумма logical image sizes
  не является прогнозом освобождаемого места из-за общих слоёв.
- Перед удалением перепроверить current/previous links, все container references
  и exact IDs/repositories; при изменении inventory остановиться. Удалять только
  этот список без force; volumes, соседние приложения и журналы не трогать.
- Измерить bytes/inode и readiness текущих контейнеров. После достаточного
  освобождения места повторить уже разрешённый standard Promote TASK-0156
  exact31071c8116d84896c96eda390610dd0336f857c1 и проверить migrations/runtime/smoke.

## Постоянное исправление

После одобрения ADR реализовать scoped dry-run/cleanup в существующем deploy
controller под deployment lock, с защитой current/previous/candidate/containers
и трёх свежих образов на repository. Согласовать ресурсные пороги по данным
образов до включения guard. Не менять Docker daemon или размер диска.

## Проверки и границы

Изолированные pin tests и независимая Quality; Architecture Review, актуальная
Wiki и docs validator. Новые commits/pushes/deploy нового SHA требуют отдельных
разрешений. Профиль talking-to-ai доступен для Docker metadata, но sudo/root SSH
недоступны; не читать runtime env или обходить ограничения доступа.

## Одобрение

Оператор одобрил точечное удаление 597 image IDs, ADR и план.
Commit/push/deploy нового SHA этим не разрешены.


## Результат

- Удалены ровно 597 одобренных images; retained 21. Bytes: free около 27 GiB,
  inode use 10%; существующие Shape и соседние контейнеры healthy. Volumes и
  пользовательские данные не менялись.
- Retention helper использует Python standard library; существующий controller
  вызывает его до pull внутри root-managed lock. Защищены release/container
  coordinates, newest3 perrepo; неизвестные shared references исключены.
- Независимая Quality приняла 14 pins, включая реальный CLI/fakeDocker,
  timestamp nanoseconds, zero-resource/partial-failure cases; shell regression
  contracts и docs validator прошли. Architecture Review выполнен.
- Resource reserve tuning отложен; проверка zero bytes/inodes не гарантирует,
  что следующий image помещается. Python3.7+ уже имеется на обследованном хосте;
  новые пакеты/сервисы не устанавливались.
- Canonical runbook/topology согласованы с ADR, установка helper на staging
  не заявляется до отдельного commit/push/deploy.
- Standard Promote TASK-0156 run37380096566 повторён после устранения inode
  exhaustion; его доставка фиксируется отдельно в timeline TASK-0156.
