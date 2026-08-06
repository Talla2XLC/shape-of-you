# TASK-0029 — Управление passkeys, сессиями и TOTP-восстановлением

## Цель

Дать пользователю управление потерянными устройствами и удобное аварийное
восстановление через шестизначный код authenticator-приложения без паролей,
email, SMS и обязательного хранения текстовых recovery codes.

## Решение

- Обычный вход остаётся passkey-first.
- Пользователь управляет passkeys и активными browser/OAuth sessions.
- TOTP настраивается по QR только из активной сессии с Origin + CSRF.
- TOTP seed хранится только в зашифрованном виде; ключ остаётся вне БД.
- Recovery требует уникальный login handle и TOTP, ограничивает перебор и даёт
  одноразовое 15-минутное право зарегистрировать replacement-passkey.
- После recovery отзываются все старые sessions и refresh families.
- Старые passkeys удаляются пользователем явно.

## Этапы

1. [x] Согласовать recovery UX и архитектуру.
2. [x] Добавить типизированную модель и воспроизводимую миграцию.
3. [x] Реализовать шифрование TOTP и runtime-конфигурацию ключей.
4. [x] Реализовать управление login handle, passkeys и sessions.
5. [x] Реализовать TOTP enrollment и recovery-registration flow.
6. [x] Добавить unit, integration и migration tests.
7. [x] Обновить staging deployment contract и локальные env-примеры.
8. [x] Провести quality, Architecture Review и документационную проверку.

## Критерии завершения

- Потерянный passkey можно удалить из другой активной сессии.
- Последний способ восстановления нельзя удалить случайно.
- TOTP seed, recovery authority и browser credentials не хранятся открыто.
- Повтор TOTP step, перебор и повтор recovery authority отклоняются.
- Recovery завершается только новым passkey и отзывает старые сессии.
- Миграция полностью воспроизводима без ручного SQL.
