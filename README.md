# Space

Монорепозиторий десктопного приложения с отдельным runtime-процессом.

## Что внутри

```text
apps/
  desktop/     Electron, React 19, Vite+, Tailwind, Base UI, Zustand
  runtime/     Node 24, Effect, Effect SQL, SQLite, node-pty
packages/
  protocol/    общие Effect Schema контракты для HTTP и WebSocket
```

Desktop показывает рабочее поле на React Flow и терминал xterm.js. Runtime принимает команды по HTTP, отправляет события и терминальный поток через WebSocket, а состояние хранит в SQLite.

В dev-режиме runtime запускается системным Node 24. Упакованное приложение запускает его отдельным дочерним процессом через Electron с `ELECTRON_RUN_AS_NODE=1`. Electron 43 включает Node 24.

## Требования

- Vite+ CLI
- системные инструменты сборки для нативных модулей `node-pty` и `better-sqlite3`

## Запуск

```bash
curl -fsSL https://vite.plus | bash
vp install
vp run dev
```

Vite+ читает Node 24 из `.node-version` и использует pnpm 11.10.0 из `packageManager`.

Runtime слушает только `127.0.0.1:4310`. Путь к базе можно задать через `SPACE_DATABASE_PATH`, порт через `SPACE_RUNTIME_PORT`, а адрес runtime в renderer через `VITE_RUNTIME_URL`.

## Проверки

```bash
vp check
vp test
vp run test:e2e
vp run build
```

## Упаковка

```bash
vp run package
```

`electron-builder` создаёт артефакты в `apps/desktop/release`. Для локальной проверки без DMG или установщика можно выполнить `vp run @space/desktop#package:dir` после `vp run build`.

## Протокол

- `GET /health` проверяет доступность runtime.
- `POST /commands/sessions` создаёт PTY-сессию.
- `WS /events` передаёт события runtime и терминальные данные в обе стороны.

Схемы лежат в `packages/protocol`. Сейчас HTTP и WebSocket доступны любому локальному процессу. Перед добавлением опасных команд нужен токен сессии и проверка `Origin`.
