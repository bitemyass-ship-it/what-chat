# Backend Specification: Chat and Message Persistence

## 1. Цель

Нужно реализовать backend-слой, который на основе уже существующей SQLite базы:

1. продолжает сохранять canonical chats для каждого employee
2. начинает сохранять messages в отдельную таблицу
3. делает это безопасно для production-данных
4. поддерживает как live ingest, так и future polling/backfill

Эта спецификация предназначена для backend engineer, который будет вносить изменения в существующий код и схему БД.

## 2. Текущее состояние

Сейчас в проекте уже есть:

- таблица `employees`
- таблица `chats`
- таблица `chat_aliases`
- `ChatsRepository`
- `message-handler`, который при live message event делает только `chat upsert`

Сейчас в проекте нет:

- таблицы `messages`
- `MessagesRepository`
- persistence логики для messages
- расширенного WhatsApp message payload с полями, нужными для stable deduplication

Текущее поведение:

- chat сохраняется в SQLite при входящем или исходящем message event
- само сообщение в базу не записывается

## 3. Scope

В scope задачи входит:

- расширение database schema
- добавление persistence для messages
- расширение live ingestion flow
- подготовка модели под future polling
- обновление database/bootstrap logic
- обновление unit/integration tests

Вне scope:

- frontend UI
- cron scheduler
- manual admin endpoints для sync
- analytics dashboards
- outbound sending

## 4. Требования к архитектуре

### 4.1 Canonical chat model остается существующей

Не нужно заменять текущую модель `chats + chat_aliases`.

Нужно сохранить следующие правила:

- один logical contact на одного employee хранится как один canonical row в `chats`
- все raw WhatsApp ids хранятся через `chat_aliases`
- сообщения всегда привязываются к `chat_record_id`, а не напрямую к raw `chat_id`

### 4.2 Message deduplication должна строиться на внешнем WhatsApp message id

Основной dedupe key:

- `message.id._serialized`

Нельзя строить dedupe на:

- `timestamp`
- `body`
- `from/to`

### 4.3 Persistence flow должен быть idempotent

Повторная обработка одного и того же message event или одного и того же polling batch:

- не должна создавать duplicate rows
- не должна ломать canonical chat mapping

## 5. Database Work

### 5.1 Existing tables

Текущие таблицы:

- `employees`
- `chats`
- `chat_aliases`

их нужно сохранить.

### 5.2 Chats upgrade

`chats` нужно расширить metadata columns, но не пересоздавать без необходимости.

Минимально нужно добавить:

- `display_name TEXT`
- `chat_kind TEXT NOT NULL DEFAULT 'direct'`
- `is_archived INTEGER NOT NULL DEFAULT 0`
- `is_pinned INTEGER NOT NULL DEFAULT 0`
- `unread_count INTEGER NOT NULL DEFAULT 0`
- `last_message_id TEXT`
- `last_message_preview TEXT`
- `last_polled_at TEXT`
- `last_messages_synced_at TEXT`

Существующие поля:

- `id`
- `employee_id`
- `contact_key`
- `chat_id`
- `phone_number`
- `last_message_timestamp`
- `created_at`
- `updated_at`

должны остаться.

### 5.3 New messages table

Нужно добавить `messages` table.

Целевая структура:

```sql
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  chat_record_id INTEGER NOT NULL,

  external_message_id TEXT NOT NULL,
  source_chat_id TEXT NOT NULL,

  direction TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'chat',
  timestamp INTEGER,

  from_jid TEXT,
  to_jid TEXT,
  author_jid TEXT,

  ack INTEGER,
  has_media INTEGER NOT NULL DEFAULT 0,
  is_forwarded INTEGER NOT NULL DEFAULT 0,
  forwarding_score INTEGER NOT NULL DEFAULT 0,
  has_quoted_msg INTEGER NOT NULL DEFAULT 0,
  quoted_message_external_id TEXT,

  ingest_source TEXT NOT NULL DEFAULT 'live',
  raw_payload_json TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(employee_id, external_message_id),

  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_record_id) REFERENCES chats(id) ON DELETE CASCADE,

  CHECK(direction IN ('incoming', 'outgoing', 'system')),
  CHECK(ingest_source IN ('live', 'poll'))
);
```

### 5.4 Required indexes

Для `chats`:

```sql
CREATE INDEX IF NOT EXISTS chats_employee_id_last_message_ts_idx
  ON chats (employee_id, last_message_timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS chats_employee_id_chat_kind_idx
  ON chats (employee_id, chat_kind);
```

Для `messages`:

```sql
CREATE INDEX IF NOT EXISTS messages_chat_record_id_timestamp_idx
  ON messages (chat_record_id, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS messages_employee_id_timestamp_idx
  ON messages (employee_id, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS messages_chat_record_id_direction_timestamp_idx
  ON messages (chat_record_id, direction, timestamp DESC, id DESC);
```

## 6. TypeScript Model Changes

### 6.1 `src/database/types.ts`

Нужно добавить:

- `MessageRecord`
- `UpsertMessageInput`
- `MessagesRepository`

Рекомендуемая форма:

```ts
export interface MessageRecord {
  id: number;
  employeeId: number;
  chatRecordId: number;
  externalMessageId: string;
  sourceChatId: string;
  direction: 'incoming' | 'outgoing' | 'system';
  body: string;
  messageType: string;
  timestamp: number | null;
  fromJid: string | null;
  toJid: string | null;
  authorJid: string | null;
  ack: number | null;
  hasMedia: boolean;
  isForwarded: boolean;
  forwardingScore: number;
  hasQuotedMsg: boolean;
  quotedMessageExternalId: string | null;
  ingestSource: 'live' | 'poll';
  rawPayloadJson: string | null;
  createdAt: string;
  updatedAt: string;
}
```

`Database` interface нужно расширить новым полем:

- `messages: MessagesRepository`

### 6.2 `src/types/whatsapp.ts`

Текущий `MessagePayload` слишком бедный для production persistence.

Нужно добавить поля:

- `messageId?: string`
- `author?: string`
- `type?: string`
- `ack?: number`
- `hasMedia?: boolean`
- `isForwarded?: boolean`
- `forwardingScore?: number`
- `quotedMessageId?: string | null`
- `rawPayload?: unknown`

Текущие поля:

- `body`
- `chatId`
- `from`
- `fromMe`
- `phoneNumber`
- `timestamp`
- `to`

должны остаться.

## 7. Repository Work

### 7.1 ChatsRepository

Нужно расширить `ChatsRepository`, чтобы он умел обновлять новые metadata-поля.

Минимальные требования:

- сохранять `display_name`
- сохранять `chat_kind`
- сохранять `is_archived`
- сохранять `is_pinned`
- сохранять `unread_count`
- сохранять `last_message_id`
- сохранять `last_message_preview`
- сохранять `last_message_timestamp`

Важно:

- current alias merge behavior должен сохраниться
- existing `contact_key` strategy ломать нельзя

### 7.2 MessagesRepository

Нужно добавить новый файл:

- `src/database/messages-repository.ts`

Минимальный API:

- `upsertByEmployeeCode(input: UpsertMessageInput): MessageRecord`
- `listByEmployeeCodeAndChatRecordId(employeeCode, chatRecordId, options?): MessageRecord[]`
- `countByEmployeeCodeAndChatRecordId(employeeCode, chatRecordId): number`

Дополнительно допустимо добавить:

- `findByEmployeeCodeAndExternalMessageId(...)`

### 7.3 Repository rules

`MessagesRepository.upsertByEmployeeCode(...)` должен:

1. resolve employee id
2. resolve canonical chat row
3. insert message if it does not exist
4. update mutable fields if same `external_message_id` пришел повторно с более полным payload

Upsert не должен:

- создавать новый canonical chat мимо `ChatsRepository`
- вставлять orphan message без valid `chat_record_id`

## 8. Database Bootstrap Work

### 8.1 `src/database/schema.ts`

Нужно:

- расширить `CHATS_SCHEMA_SQL`
- добавить `MESSAGES_SCHEMA_SQL`
- включить `MESSAGES_SCHEMA_SQL` в `DATABASE_SCHEMA_SQL`

### 8.2 `src/database/database.ts`

Текущий startup уже делает migration legacy `chats`.

Нужно поверх существующей логики:

1. сначала завершить старую canonical chat migration, если она требуется
2. затем выполнить additive `ALTER TABLE` для новых chat columns
3. затем создать `messages` table
4. затем создать новые indexes

Нельзя:

- удалять существующие `chats`
- терять `chat_aliases`
- сбрасывать existing data

### 8.3 Additive migration rules

Для `chats`:

- использовать `PRAGMA table_info(chats)`
- добавлять только missing columns

Для `messages`:

- `CREATE TABLE IF NOT EXISTS`

## 9. Live Ingestion Flow

### 9.1 Current state

Сейчас `message-handler` делает:

1. normalize body/chatId
2. resolve phone number
3. `chats.upsertByEmployeeCode(...)`
4. log message

### 9.2 Target state

Нужно изменить flow так:

1. normalize incoming WhatsApp message payload
2. upsert canonical chat
3. получить canonical chat record id
4. upsert message into `messages`
5. log success / log structured failure

### 9.3 Behavior for empty bodies

Пустой body не должен запрещать persistence.

Требование:

- если message event пришел, его metadata может быть важна для аналитики
- empty-body message можно warning-log-ить, но если у него есть stable id, его нужно сохранять

### 9.4 Direction mapping

- `fromMe = true` -> `outgoing`
- `fromMe = false` -> `incoming`
- системные/internal cases, если будут выявлены отдельно -> `system`

## 10. Polling Compatibility

Хотя эта задача не включает polling implementation, код должен быть готов к нему.

Это значит:

- `messages.ingest_source` уже нужен сейчас
- `source_chat_id` нужно сохранять сейчас
- `chat` и `message` model должны позволять повторный upsert из polling

При повторном ingest из polling уже существующий live message не должен дублироваться.

## 11. File-Level Implementation Plan

### 11.1 Files to update

- `src/database/schema.ts`
- `src/database/database.ts`
- `src/database/types.ts`
- `src/database/chats-repository.ts`
- `src/whatsapp/message-handler.ts`
- `src/types/whatsapp.ts`

### 11.2 Files to add

- `src/database/messages-repository.ts`

### 11.3 Optional helper updates

Если потребуется, допустимо добавить helper для mapping или normalization, например:

- `src/database/message-mapper.ts`
- `src/utils/message-direction.ts`

Но не нужно дробить задачу на лишние абстракции без реальной пользы.

## 12. Testing Requirements

Нужно добавить или обновить тесты для:

### 12.1 Database migration

- старая база с existing chats корректно мигрируется
- новые `chats` columns появляются автоматически
- `messages` table создается автоматически
- existing `chat_aliases` остаются валидными

### 12.2 Chats repository

- existing alias merge semantics сохраняются
- новые metadata fields корректно upsert-ятся

### 12.3 Messages repository

- insert одного message работает
- повторный upsert того же `external_message_id` не создает дубль
- message correctly links to canonical `chat_record_id`
- cascade delete employee removes messages

### 12.4 Message handler

- incoming message сохраняет chat и message
- outgoing message сохраняет chat и message
- empty-body message при наличии `messageId` тоже сохраняется
- handler логирует ошибки persistence отдельно для chat и message failures

## 13. Non-Goals

В этой задаче не нужно:

- сохранять binary media файлы
- скачивать вложения
- делать full-text search
- строить analytics endpoints
- строить scheduler

## 14. Acceptance Criteria

Задача считается завершенной, когда:

1. backend новой версии стартует на существующей production SQLite базе без ручных SQL шагов
2. existing `employees`, `chats`, `chat_aliases` остаются доступными
3. новая `messages` table создается автоматически
4. live message flow сохраняет не только chat, но и message
5. duplicate message events не создают duplicate rows
6. база данных готова к future polling/backfill, не требуя новой полной schema redesign
