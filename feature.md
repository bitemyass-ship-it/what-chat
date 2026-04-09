# Chat Sync & Polling Feature

## 1. Goal

Нужно добавить отдельную feature-спецификацию для аналитического сценария, где система умеет:

1. по расписанию синхронизировать чаты и сообщения для всех сотрудников
2. по запросу синхронизировать список чатов для одного employee
3. по запросу синхронизировать сообщения для одного конкретного чата

Цель этой фичи не в создании бота и не в отправке сообщений. Цель в устойчивом ingestion-слое для аналитики, таблиц и отчетности.

## 2. Product Context

Сейчас проект уже умеет:

- поднимать runtime WhatsApp session для employee
- получать live events `message` и `message_create`
- сохранять canonical chats в SQLite

Сейчас проект не умеет:

- читать и сохранять историю сообщений в SQLite
- запускать scheduled polling/backfill
- вручную догружать чаты для одного employee
- вручную догружать сообщения для одного chat

## 3. Architecture Position

Для аналитики polling не должен быть единственным источником данных.

Рекомендуемая модель:

- live events используются как основной incremental ingest поток
- polling используется как backfill и reconciliation механизм
- UI и аналитика читают только из нашей базы данных

Причины:

- чтение из SQLite стабильнее и быстрее, чем прямое чтение из Puppeteer-backed WhatsApp session
- polling может закрывать пропуски после reconnect / downtime
- event ingestion уменьшает объем повторного чтения истории

## 4. Scope

В scope задачи входит:

- расширение WhatsApp client abstraction методами чтения chat history
- scheduled cron sync для всех employee
- on-demand sync чатов для одного employee
- on-demand sync сообщений для одного chat
- сохранение сообщений в SQLite
- idempotent deduplication при повторных polling run

Вне scope:

- отправка сообщений
- автоответы
- бот-логика
- semantic analytics / dashboards

## 5. Target Features

### 5.1 Scheduled Polling: All Chats

Система должна уметь по cron запускать фонового sync worker-а, который:

1. выбирает employees, для которых доступна runtime WhatsApp session
2. читает список chats через `client.getChats()`
3. upsert-ит canonical chats в SQLite
4. для каждого chat при необходимости запускает message sync

Этот режим нужен для:

- ночного backfill
- восстановления после пропуска live events
- постепенного пополнения history без ручного клика в UI

### 5.2 On-Demand Polling: Chats For Employee

Система должна уметь по запросу синхронизировать список chats для одного employee.

Типовой сценарий:

- оператор открывает employee page
- backend проверяет наличие runtime session
- backend вызывает `client.getChats()`
- найденные chats upsert-ятся в SQLite
- API возвращает обновленный список chats из базы

Этот режим нужен для:

- ручного refresh
- первичной загрузки chats в UI
- точечного sync без запуска глобального cron job

### 5.3 On-Demand Polling: Messages For Chat

Система должна уметь по запросу синхронизировать messages для одного chat.

Типовой сценарий:

- оператор выбирает chat в employee UI
- backend вызывает `client.getChatById(chatId)`
- при необходимости вызывает `chat.syncHistory()`
- далее вызывает `chat.fetchMessages(...)`
- новые messages сохраняются в SQLite
- API возвращает messages из базы

Этот режим нужен для:

- lazy-loading истории только по открытым чатам
- догрузки старых сообщений
- reconciliation по конкретному контакту

## 6. Backend Requirements

### 6.1 Database

Нужно добавить таблицу `messages`.

Минимальные поля:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `employee_id INTEGER NOT NULL`
- `chat_record_id INTEGER NOT NULL`
- `external_message_id TEXT NOT NULL`
- `direction TEXT NOT NULL`
- `body TEXT NOT NULL`
- `timestamp INTEGER`
- `from_jid TEXT`
- `to_jid TEXT`
- `author_jid TEXT`
- `message_type TEXT`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

Требования к ограничениям:

- `UNIQUE(employee_id, external_message_id)`
- `FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE`
- `FOREIGN KEY (chat_record_id) REFERENCES chats(id) ON DELETE CASCADE`

Минимальные индексы:

- `(chat_record_id, timestamp)`
- `(employee_id, timestamp)`

### 6.2 Repository Layer

Нужно добавить `messages-repository` с минимальным набором методов:

- `upsertByEmployeeCodeAndChatId(...)`
- `listByEmployeeCodeAndChatRecordId(...)`
- `countByEmployeeCodeAndChatRecordId(...)`

Нужно расширить WhatsApp payload mapping так, чтобы сохранялись:

- `message.id._serialized`
- `message.body`
- `message.timestamp`
- `message.from`
- `message.to`
- `message.author`
- `message.fromMe`
- `message.type`

### 6.3 Session Access

Текущий `WhatsappSessionClient` нужно расширить методами чтения:

- `getChats(): Promise<...>`
- `getChatById(chatId: string): Promise<...>`

Для chat abstraction нужен доступ как минимум к:

- `id`
- `name`
- `timestamp`
- `lastMessage`
- `fetchMessages(...)`
- `syncHistory()`

### 6.4 Polling Services

Нужно выделить отдельный сервис sync/backfill layer, например:

- `src/whatsapp/chat-sync-service.ts`

Минимальные методы сервиса:

- `syncChatsForEmployee(employeeCode)`
- `syncMessagesForChat(employeeCode, chatRecordId)`
- `syncAllEmployeesChats()`

Рекомендуемые правила:

- операции должны быть idempotent
- повторный запуск не должен создавать дубли
- partial failure одного employee не должен валить весь batch

## 7. API Requirements

### 7.1 Scheduled Sync Trigger

В MVP cron можно запускать без публичного HTTP endpoint, как internal scheduler.

Если нужен ручной административный trigger:

- `POST /employees/sync-chats`

Но лучше считать cron internal background job, а не user-facing API.

### 7.2 Sync Chats For Employee

Новый endpoint:

- `POST /employees/:code/chats/sync`

Поведение:

- проверяет employee existence
- проверяет наличие runtime WhatsApp session
- запускает `syncChatsForEmployee(code)`
- возвращает обновленный chat list

### 7.3 Read Chats For Employee

Новый endpoint:

- `GET /employees/:code/chats`

Поведение:

- читает chats из SQLite
- не ходит в WhatsApp напрямую

### 7.4 Sync Messages For Chat

Новый endpoint:

- `POST /employees/:code/chats/:chatRecordId/messages/sync`

Поведение:

- загружает canonical chat из SQLite
- запускает `syncMessagesForChat(code, chatRecordId)`
- возвращает messages из SQLite

### 7.5 Read Messages For Chat

Новый endpoint:

- `GET /employees/:code/chats/:chatRecordId/messages`

Поведение:

- читает messages из SQLite
- поддерживает limit / cursor / before timestamp pagination

## 8. Cron Requirements

Нужно добавить конфигурируемый scheduled polling job.

Минимальные env variables:

- `WHATSAPP_CHAT_SYNC_CRON_ENABLED=true|false`
- `WHATSAPP_CHAT_SYNC_INTERVAL_MS=<number>`

MVP может начать не с cron expression, а с interval-based scheduler внутри Node process.

Базовый цикл:

1. scheduler tick
2. выбрать активные runtime sessions
3. для каждого employee вызвать `syncChatsForEmployee`
4. опционально догрузить messages только для recently active chats
5. записать метрики и ошибки в лог

## 9. Deduplication & Incremental Sync

Polling нельзя строить как "каждый раз перечитать все и просто вставить".

Нужны правила:

- chat dedup идет по canonical chat record + alias handling
- message dedup идет по `external_message_id`
- если `external_message_id` недоступен, fallback по слабому ключу нежелателен и должен быть явно задокументирован

Для incremental sync желательно хранить:

- `last_polled_at` на chat или sync-state уровне
- `last_message_timestamp` уже есть на chat уровне, но его недостаточно как единственного cursor-а

Рекомендуется добавить отдельную sync-state таблицу позже, если polling станет основным backfill-каналом.

## 10. UI Expectations

Employee page должна получить два режима работы:

### Chats Tab

- показывает chats из SQLite
- имеет кнопку `Sync chats`

### Chat Detail

- по клику открывает messages table
- имеет кнопку `Sync messages`
- читает данные из SQLite

UI не должен напрямую зависеть от результата live fetch из WhatsApp Web. Любой sync должен сначала обновить БД, а затем UI читает уже сохраненные данные.

## 11. Risks

- `whatsapp-web.js` работает через неофициальный WhatsApp Web client, поэтому polling нельзя считать полностью безопасным или бесконечно масштабируемым
- aggressive full-history polling может быть тяжелым для Puppeteer session
- один большой global sync без ограничений может перегрузить CPU / memory

Поэтому recommended strategy:

- events as primary ingest
- polling as backfill
- lazy message sync per selected chat
- scheduled global sync with bounded concurrency

## 12. Suggested Delivery Order

1. Добавить `messages` schema и repository.
2. Расширить WhatsApp client abstraction под `getChats` / `getChatById`.
3. Реализовать `syncChatsForEmployee`.
4. Реализовать `syncMessagesForChat`.
5. Добавить `GET/POST` endpoints для chats и messages sync.
6. Добавить interval-based scheduler.
7. Подключить UI tabs и refresh actions.

## 13. MVP Recommendation

Если нужен прагматичный первый релиз, лучше делать не полный cron-first подход, а такой MVP:

1. live events сохраняют новые messages в БД
2. `POST /employees/:code/chats/sync` делает ручной sync чатов сотрудника
3. `POST /employees/:code/chats/:chatRecordId/messages/sync` делает ручной sync истории выбранного чата
4. global cron sync добавляется после этого как recovery / completeness layer

Такой порядок уменьшает риск и быстрее дает usable analytics UI.
