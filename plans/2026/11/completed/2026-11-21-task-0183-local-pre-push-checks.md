# TASK-0183 — Локальная проверка перед push

Статус: выполнено локально по прямому запросу оператора; независимая Quality принята.

## Цель

Устранить повторение push после неполного локального прогона. Использовать
существующие CI application checks: frozen install, lint, typecheck, build,
полный `pnpm test` со всеми PostgreSQL integration suites и docs validation.
Новые services, public contracts и deployment architecture не вводятся.

## План

1. Добавить `pnpm check:local` без fallback на выборочные тесты.
2. Подключить устанавливаемый в текущий clone pre-push hook; сохранить чужие hooks.
3. Проверять чистоту дерева и точный HEAD до и после тестов; не stash чужие правки.
4. Проверить реальное отклонение push при failed test в synthetic Git repository.
5. Выполнить полный локальный прогон на Docker, независимую Quality и обновить
   только affected canonical development guide после приёмки.

## Проверка

`pnpm check:local` завершён успешно: frozen install, lint, typecheck, build,
958 application tests (API 836, Identity 80, Web 42), 7 guard tests и docs validation.
Все PostgreSQL integration suites выполнены на Docker без пропусков и подмены.
Первый прогон выявил несовместимость random-port binding Testcontainers с локальным
Docker Desktop; минимальный pnpm patch исправляет только значение `HostPort`.
Версии зависимостей, assertions и readiness checks не ослаблены. Dockerfiles
получают patch до frozen install; реальная Docker-сборка API прошла успешно.

Hook установлен в текущем clone. Независимый synthetic push с failed full test
не изменил local bare remote. Проверены отказ при dirty tree, сохранение чужих
hooks, точного HEAD и fixed-port поведения. Независимая Quality и проверка
отсутствия новых архитектурных решений записаны в TASK-0183; canonical development
guide обновлён после приёмки. Browser/E2E и deployment CI остаются отдельными gates.

## Согласованная доставка

Оператор разрешил commit, push и доставку в staging, затем явно включил восемь
прежних правок переименования DreamTeam в тот же commit. Они объединены с
исправлением без изменения их содержания. Production не входит в разрешение.

Первый настоящий push был заблокирован: все 836 API tests прошли, но два suite
получили необработанные `57P01` при teardown. `pool.end()` завершался до событий
закрытия физических клиентов; остановка PostgreSQL опережала закрытие сокетов.
Две воспроизведённые фикстуры теперь отслеживают `connect`/`end` и перед остановкой
контейнера ждут клиентов с пределом пять секунд и явной ошибкой при timeout.
Обработчики ошибок и runtime не изменены. Три регрессионных теста и оба реальных
PostgreSQL suite прошли: 19/19. Следующий полный gate выявил тот же race в Coaching
при успешных 839 API assertions. Один и тот же helper подключён во всех 21 основных
API database fixtures и четырёх import fixtures с raw Pool; per-test migration
contexts и runtime не меняются. Убрано старое игнорирование teardown `57P01`
в Training/Recovery import: теперь любая pool error остаётся ошибкой тестов.
Повторный полный gate обязателен перед push.
