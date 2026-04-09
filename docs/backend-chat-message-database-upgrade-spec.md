# Backend Specification: Chat/Message Database Upgrade

## 1. Цель

Нужно обновить SQLite schema проекта так, чтобы production-система поддерживала:

1. хранение canonical chat records для каждого employee
2. хранение message history для аналитики
3. совместимость с live event ingestion
4. совместимость с future polling/backfill через `whatsapp-web.js`

Эта спецификация описывает только database layer и миграционные требования. API, UI и scheduler здесь упоминаются только как потребители новой схемы.

## 2. Контекст текущей реализации

Сейчас backend уже хранит:

- `employees`
- `chats`
- `chat_aliases`

Текущая схема чатов уже решает важную задачу canonical identity:

- один logical contact может приходить как `@c.us`, `@s.whatsapp.net` или `@lid`
- project уже нормализует это через `contact_key`
- дополнительные raw chat ids хранятся в `chat_aliases`

Это хорошая база, и ее не нужно ломать.

Но текущая схема не покрывает production-требования для аналитики:

- нет таблицы `messages`
- `chats` хранят слишком мало metadata для list/detail views и polling
- нет места для message deduplication по external WhatsApp message id
- нет sync-related полей, которые помогают future backfill workflows

## 3. Scope

В scope задачи входит:

- расширение schema `chats`
- сохранение текущей таблицы `chat_aliases`
- добавление новой таблицы `messages`
- additive migration без потери существующих data
- обновление database bootstrap logic
- обновление database tests

Вне scope:

- отправка сообщений
- bot logic
- UI implementation
- cron/scheduler implementation
- semantic analytics layer

## 4. Product Requirements

Новая schema должна обеспечивать:

- быстрый список чатов на employee detail page
- быстрый список messages для выбранного chat
- устойчивую deduplication при повторном polling
- сохранение всех live messages без потери связи с canonical chat
- обратную совместимость с существующей production базой

## 5. Architectural Principles

### 5.1 Canonical chat identity stays unchanged

`chats` и `chat_aliases` остаются основой chat identity model.

Ключевые правила:

- UI и analytics работают по internal `chat_record_id`
- raw WhatsApp identifiers не должны использоваться как основной внешний PK в нашей БД
- aliases продолжают связывать разные WhatsApp chat ids с одним canonical contact

### 5.2 Message identity is external-message-id first

Для message deduplication главным источником истины должен быть WhatsApp message id:

- `message.id._serialized`

Нельзя строить основную deduplication только на:

- `timestamp`
- `body`
- `from/to`

Такие комбинации допустимы только как debug fallback, но не как production unique key.

### 5.3 Additive migration only

Продукт уже рабочий, поэтому database upgrade должен быть:

- additive
- idempotent
- resumable
- без destructive table reset

Если новая схема может быть введена через `ALTER TABLE ... ADD COLUMN`, нужно предпочесть именно такой путь.

Полный rebuild существующей `chats` таблицы допустим только если появится строго необходимое ограничение, которое нельзя ввести иначе.

## 6. Target Schema

## 6.1 Employees

`employees` не меняется.

## 6.2 Chats

Текущая `chats` таблица должна быть расширена, но не заменена новой моделью.

### Target columns

```sql
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  contact_key TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  phone_number TEXT,
  display_name TEXT,
  chat_kind TEXT NOT NULL DEFAULT 'direct',
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_id TEXT,
  last_message_preview TEXT,
  last_message_timestamp INTEGER,
  last_polled_at TEXT,
  last_messages_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, contact_key),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);
```

### Column semantics

- `chat_id`
  хранит primary/raw WhatsApp chat id, который считается текущим preferred id для этого canonical chat

- `phone_number`
  хранит reliable normalized digits только когда project может доказать, что номер real и не является weak `@lid` placeholder

- `display_name`
  имя из WhatsApp chat/contact metadata; nullable, потому что для некоторых chats name может быть пустым или нестабильным

- `chat_kind`
  одно из:
  - `direct`
  - `group`
  - `broadcast`
  - `channel`
  - `unknown`

- `is_archived`
  флаг archived state из WhatsApp chat

- `is_pinned`
  флаг pinned state из WhatsApp chat

- `unread_count`
  unread count из WhatsApp chat metadata

- `last_message_id`
  внешний id последнего известного message в чате, если библиотека его отдала

- `last_message_preview`
  короткий preview/body последнего известного message для list views

- `last_message_timestamp`
  timestamp последнего известного message или последней активности чата

- `last_polled_at`
  когда backend в последний раз successfully refreshed chat metadata через polling/read API

- `last_messages_synced_at`
  когда backend в последний раз successfully completed messages sync для этого чата

### Required indexes

```sql
CREATE INDEX IF NOT EXISTS chats_employee_id_contact_key_idx
  ON chats (employee_id, contact_key);

CREATE INDEX IF NOT EXISTS chats_employee_id_phone_number_idx
  ON chats (employee_id, phone_number);

CREATE INDEX IF NOT EXISTS chats_employee_id_last_message_ts_idx
  ON chats (employee_id, last_message_timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS chats_employee_id_chat_kind_idx
  ON chats (employee_id, chat_kind);
```

## 6.3 Chat Aliases

`chat_aliases` таблица сохраняется как есть.

Target shape:

```sql
CREATE TABLE IF NOT EXISTS chat_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_record_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  alias_chat_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, alias_chat_id),
  FOREIGN KEY (chat_record_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);
```

### Required indexes

```sql
CREATE INDEX IF NOT EXISTS chat_aliases_chat_record_id_idx
  ON chat_aliases (chat_record_id);
```

## 6.4 Messages

Нужно добавить новую production table `messages`.

### Target schema

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

### Column semantics

- `employee_id`
  denormalized ownership field for faster filtering and safer uniqueness boundaries

- `chat_record_id`
  canonical link to our internal chat record

- `external_message_id`
  WhatsApp message id, expected source: `message.id._serialized`

- `source_chat_id`
  raw WhatsApp chat id from которого был прочитан message; useful for diagnostics and alias transitions

- `direction`
  one of:
  - `incoming`
  - `outgoing`
  - `system`

- `body`
  normalized textual body; empty string допустима для media/system cases

- `message_type`
  raw or normalized WhatsApp message type, например `chat`, `image`, `audio`, `document`, `revoked`, etc.

- `timestamp`
  WhatsApp event timestamp, не равен `created_at`

- `from_jid`
  raw sender JID

- `to_jid`
  raw receiver JID

- `author_jid`
  author внутри group context; nullable для direct chat

- `ack`
  delivery/ack state, если библиотека это поле предоставляет

- `has_media`
  boolean-like integer

- `is_forwarded`
  boolean-like integer

- `forwarding_score`
  numeric forwarding score из WhatsApp model

- `has_quoted_msg`
  boolean-like integer

- `quoted_message_external_id`
  id quoted/original message, если доступен

- `ingest_source`
  `live` или `poll`

- `raw_payload_json`
  optional compact serialized raw payload для forensic/debug scenarios и будущих schema extensions

### Required indexes

```sql
CREATE INDEX IF NOT EXISTS messages_chat_record_id_timestamp_idx
  ON messages (chat_record_id, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS messages_employee_id_timestamp_idx
  ON messages (employee_id, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS messages_chat_record_id_direction_timestamp_idx
  ON messages (chat_record_id, direction, timestamp DESC, id DESC);
```

## 7. Mapping From `whatsapp-web.js`

Schema должна прямо соответствовать полям, которые реально доступны в library.

### Chat mapping

- `chat.id._serialized` -> `chats.chat_id`
- `chat.name` -> `chats.display_name`
- `chat.timestamp` или `chat.lastMessage.timestamp` -> `chats.last_message_timestamp`
- `chat.lastMessage.id._serialized` -> `chats.last_message_id`
- `chat.lastMessage.body` -> `chats.last_message_preview`
- `chat.archived` -> `chats.is_archived`
- `chat.pinned` -> `chats.is_pinned`
- `chat.unreadCount` -> `chats.unread_count`

### Message mapping

- `message.id._serialized` -> `messages.external_message_id`
- `message.body` -> `messages.body`
- `message.timestamp` -> `messages.timestamp`
- `message.from` -> `messages.from_jid`
- `message.to` -> `messages.to_jid`
- `message.author` -> `messages.author_jid`
- `message.fromMe` -> `messages.direction`
- `message.type` -> `messages.message_type`
- `message.ack` -> `messages.ack`
- `message.hasMedia` -> `messages.has_media`
- `message.isForwarded` -> `messages.is_forwarded`
- `message.forwardingScore` -> `messages.forwarding_score`
- current ingestion mode -> `messages.ingest_source`

## 8. Migration Strategy

## 8.1 General Requirements

Migration must be:

- automatic at backend startup
- idempotent
- safe to rerun after partial failure
- non-destructive for existing `employees`, `chats`, and `chat_aliases`

## 8.2 Chats migration

Для существующей `chats` таблицы нужно использовать `ALTER TABLE ... ADD COLUMN` для каждого нового nullable/default-backed column, если его еще нет.

Порядок:

1. проверить наличие `chats`
2. получить список columns через `PRAGMA table_info(chats)`
3. для каждого missing column выполнить `ALTER TABLE chats ADD COLUMN ...`
4. создать новые indexes через `CREATE INDEX IF NOT EXISTS`

Backfill rules:

- `display_name` initially `NULL`
- `chat_kind` initial value `direct` для существующих rows
- `is_archived`, `is_pinned`, `unread_count` initial value `0`
- `last_message_id`, `last_message_preview`, `last_polled_at`, `last_messages_synced_at` initial `NULL`

## 8.3 Messages migration

Для `messages` таблицы достаточно:

1. `CREATE TABLE IF NOT EXISTS messages (...)`
2. `CREATE INDEX IF NOT EXISTS ...`

Так как table новая, rebuild existing tables не нужен.

## 8.4 Existing legacy migration support

Текущий bootstrap уже умеет мигрировать старый `chats` schema к canonical identity model.

Новое database upgrade поведение не должно ломать эту логику.

Требование:

- сначала завершить существующий legacy migration flow, если он нужен
- только после этого применять additive migration новых `chats` columns и `messages` table

## 9. Data Integrity Rules

### 9.1 Chat rules

- у одного employee должен быть ровно один canonical chat row на `contact_key`
- все raw WhatsApp chat ids должны сохраняться в `chat_aliases`
- `chat_id` в `chats` должен обновляться до current preferred/raw id, но не должен уничтожать aliases

### 9.2 Message rules

- у одного employee не должно быть двух rows с одинаковым `external_message_id`
- каждый message обязан ссылаться на canonical `chat_record_id`
- message cannot exist without employee
- удаление employee должно каскадно удалять:
  - chats
  - chat_aliases
  - messages

### 9.3 Timestamp rules

Нужно различать:

- `timestamp` — WhatsApp event time
- `created_at` — time when row first inserted into SQLite
- `updated_at` — time when row updated in SQLite

Нельзя подменять одно другим.

## 10. Query Patterns To Support

Новая schema должна эффективно поддерживать:

### 10.1 Employee chat list

Запросы вида:

- все chats employee
- chats ordered by last activity
- chats filtered by `chat_kind`

### 10.2 Chat message list

Запросы вида:

- messages for one `chat_record_id`
- messages ordered by newest first
- pagination by `(timestamp, id)`

### 10.3 Employee analytics

Запросы вида:

- message count by employee
- incoming vs outgoing split
- activity over time

## 11. Database Bootstrap Changes

Нужно обновить database bootstrap так, чтобы `ensureSchema()`:

1. как и сейчас, создавал `employees`
2. как и сейчас, завершал legacy migration старой `chats` схемы, если это требуется
3. затем применял additive migration для новых `chats` columns
4. создавал `messages`
5. создавал все required indexes

Для чистой базы `DATABASE_SCHEMA_SQL` должен описывать уже полную target schema.

Для существующей базы startup flow должен уметь прийти в ту же target schema без ручных SQL steps.

## 12. Testing Requirements

Нужно добавить database-level tests, которые покрывают:

- migration со старой production schema на новую без потери `chats`
- сохранение существующих `chat_aliases`
- автоматическое создание `messages`
- cascade delete `employee -> messages`
- deduplication по `external_message_id`
- повторный upsert одного и того же message без duplicate rows
- list messages by chat ordered by `(timestamp DESC, id DESC)`

Отдельно нужны integration tests для startup bootstrap:

- новая пустая база создается сразу в target schema
- partially migrated база корректно догоняется до target schema

## 13. Rollout Requirements

Так как продукт уже работает, rollout должен быть безопасным:

- backend новой версии должен уметь стартовать на старой SQLite базе
- migration должна происходить автоматически на startup
- после migration existing chat data должна остаться доступной
- новая схема не должна требовать ручного data export/import

## 14. Non-Goals

В этой миграции не требуется:

- media file storage
- full-text search engine
- отдельная `chat_sync_state` table
- schema для outbound sending queue
- data warehouse / OLAP structure

Эти вещи могут быть добавлены позже, но они не должны блокировать эту database upgrade задачу.

## 15. Acceptance Criteria

Задача считается завершенной, когда:

1. production startup автоматически приводит старую SQLite базу к новой schema
2. текущие `employees`, `chats`, `chat_aliases` остаются валидными
3. новая `messages` table создана и готова к live/poll ingestion
4. `chats` расширена metadata-полями для list and sync workflows
5. database tests покрывают migration, deduplication и cascade behavior
