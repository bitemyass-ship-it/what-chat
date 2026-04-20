# WhatsApp Monitor

Минимальный backend-сервис на Node.js + TypeScript для подключения к WhatsApp через `whatsapp-web.js`.

Что умеет сервис:

- поднимать Express server
- подключать несколько WhatsApp-сессий одновременно
- показывать QR-код в терминале для логина
- хранить сотрудников в SQLite
- сохранять чаты в SQLite с привязкой к сотруднику
- сохранять сессии через `LocalAuth`
- читать входящие сообщения и писать их в логи
- корректно завершать HTTP и WhatsApp-сессии при остановке процесса

## Требования

- Node.js `>= 18.18.0`
- npm
- доступ к WhatsApp на телефоне для сканирования QR

## Установка

```bash
npm install
```

## Переменные окружения

- `WHATSAPP_DATABASE_PATH`  
  Необязательная переменная. Путь к SQLite-файлу.  
  Если не указать, будет использоваться `<project-root>/data/whatsapp-monitor.sqlite`.

- `AUTH_PASSWORD`
  Обязательная переменная. Общий пароль для защищенных backend routes.
  Его нужно передавать в заголовке `X-User-Password`.

- `WHATSAPP_SESSION_DIR`  
  Необязательная переменная. Путь к директории, где хранятся WhatsApp-сессии.  
  Если не указать, будет использоваться `<project-root>/sessions`.

- `PORT`  
  Необязательная переменная. Порт Express-сервера.  
  По умолчанию: `3050`

## Быстрый старт

Запуск в development-режиме:

```bash
npm run dev
```

В проекте уже подготовлен локальный [.env](/Users/yaroslavkravets/Desktop/LastChance/WhatsApp%20Monitor/.env), поэтому для первого запуска достаточно одной команды.  
По умолчанию сервис стартует на `3050` порту. Сотрудники не создаются из переменных окружения: их нужно добавить через UI или backend API.

Если нужно поменять конфиг для разработки, редактируйте:

- [.env](/Users/yaroslavkravets/Desktop/LastChance/WhatsApp%20Monitor/.env)
- [.env.example](/Users/yaroslavkravets/Desktop/LastChance/WhatsApp%20Monitor/.env.example)

Минимальный dev-конфиг:

```env
PORT=3050
WHATSAPP_DATABASE_PATH=data/whatsapp-monitor.sqlite
AUTH_PASSWORD=0000
WHATSAPP_SESSION_DIR=sessions
```

Запуск production-сборки:

```bash
npm run build
npm start
```

## Как залогиниться в WhatsApp

1. Запустите сервис.
2. В терминале появится QR-код для активируемого сотрудника.
3. На телефоне откройте WhatsApp.
4. Перейдите в `Linked Devices` / `Связанные устройства`.
5. Нажмите `Link a Device` / `Привязать устройство`.
6. Отсканируйте QR-код из терминала.

После успешного логина сессия сохранится в директории сессий. При следующем запуске повторный логин обычно не нужен, если файлы сессии не удалены и WhatsApp не сбросил авторизацию.

## Как читать сообщения

Сервис не сохраняет сообщения в базу данных. Все входящие сообщения пишутся в консоль.

Пример лога:

```text
[anna]
FROM: 123456789
TEXT: hello
TIME: 171234567
```

Если timestamp недоступен, лог будет короче:

```text
[anna] 123456789: hello
```

Пустые сообщения логируются безопасно как предупреждение:

```text
[anna] 123456789: [empty message]
```

## Проверка состояния сервиса

Проверить, что HTTP-сервер запущен:

```bash
curl http://localhost:3050/health
```

Ответ:

```text
ok
```

## Frontend

В репозитории теперь есть отдельный frontend на `Next.js + React + Tailwind` в папке [frontend/package.json](/Users/yaroslavkravets/Desktop/LastChance/WhatsApp%20Monitor/frontend/package.json).

Главная страница читает список сотрудников из backend endpoint `GET /employees` и показывает их карточками.

Запуск frontend в development-режиме:

```bash
npm --prefix frontend install
npm run frontend:dev
```

Frontend по умолчанию стартует на `http://localhost:3051`, чтобы не конфликтовать с backend на `3050`.

В development-режиме, если `EMPLOYEES_API_BASE_URL` не задан, frontend использует fallback `http://localhost:3050`.

Если backend работает на другом адресе, скопируйте [frontend/.env.example](/Users/yaroslavkravets/Desktop/LastChance/WhatsApp%20Monitor/frontend/.env.example) в `frontend/.env.local` и укажите адрес там:

```env
EMPLOYEES_API_BASE_URL=http://localhost:3050
```

Для production-like запуска задавайте `EMPLOYEES_API_BASE_URL` через `frontend/.env.production` или через переменные окружения deployment-среды, иначе frontend покажет конфигурационную ошибку вместо списка сотрудников.

Сборка frontend:

```bash
npm run frontend:build
```

## Как работают несколько сотрудников

Сотрудники хранятся в таблице `employees` в SQLite и управляются через frontend или backend API. Переменные окружения не используются для создания или восстановления сотрудников.

Новый сотрудник создается неактивным. После создания задайте номер телефона, затем активируйте WhatsApp-сессию через UI или API:

```bash
curl -X POST http://localhost:3050/employees \
  -H 'Content-Type: application/json' \
  -H 'X-User-Password: 0000' \
  -d '{"displayName":"Anna"}'
```

```bash
curl -X PATCH http://localhost:3050/employees/anna \
  -H 'Content-Type: application/json' \
  -H 'X-User-Password: 0000' \
  -d '{"phoneNumber":"380991112233"}'
```

```bash
curl -X POST http://localhost:3050/employees/anna/whatsapp-session \
  -H 'X-User-Password: 0000'
```

Для каждого сотрудника используется отдельная WhatsApp-сессия с уникальным `clientId`. При рестарте runtime-сессии восстанавливаются только из SQLite `employees` и сохраненной session storage директории.

Пример обычного запуска:

```bash
npm run dev
```

Если в SQLite уже есть активные сотрудники `anna`, `bob` и `manager`, а их session storage сохранен на диске, сервис восстановит 3 независимые сессии:

- `anna`
- `bob`
- `manager`

Если одна сессия не смогла подняться, остальные продолжают работать.

## SQLite

При старте сервис автоматически создает SQLite-файл и таблицу `employees`, если их ещё нет.

Минимальная схема сотрудников:

```sql
CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT,
  phone_number TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  session_dir TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Схема чатов:

```sql
CREATE TABLE chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  phone_number TEXT,
  last_message_timestamp INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, chat_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);
```

У одного сотрудника может быть много чатов: `employees.id -> chats.employee_id`.

## Graceful Shutdown

При `SIGINT` или `SIGTERM` сервис:

- останавливает HTTP-сервер
- завершает активные WhatsApp-клиенты
- корректно освобождает ресурсы

Обычная остановка:

```bash
Ctrl+C
```

## Повторный логин

Если нужно заново привязать конкретную сессию, удалите ее файлы из директории сессий и перезапустите сервис. После этого QR-код будет показан снова.

## Тесты

```bash
npm test
```
