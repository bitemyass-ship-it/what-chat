# Backend Specification: WhatsApp Target Event Filter

## 1. Цель

Нужно добавить backend-фильтр WhatsApp событий, чтобы в дальнейшем система сохраняла только целевые события:

1. личные чаты между employee и одним внешним контактом
2. сообщения разных пользовательских типов внутри этих личных чатов
3. личные звонки и `call_log` события

Фильтр должен отсекать:

1. групповые сообщения
2. групповые звонки
3. системные WhatsApp уведомления
4. статусы, broadcast и channels/newsletters
5. любые события без надежного личного chat identity

Эта спецификация описывает только будущий ingest-фильтр. Она не описывает миграцию, очистку или пересчет существующих данных.

## 2. Product Decision

### 2.1 Фильтруем только будущий ingest

Существующая development SQLite база не должна изменяться этой задачей.

Нельзя:

- удалять старые rows из `chats`
- удалять старые rows из `messages`
- менять старые `chat_kind`
- пересчитывать старые `contact_key`
- писать data migration
- добавлять cleanup script как часть этой задачи
- выполнять SQL cleanup автоматически при старте приложения

Можно:

- добавить runtime-фильтр перед сохранением новых WhatsApp событий
- добавить unit/integration tests для фильтра
- вручную сбросить dev-базу отдельной операцией вне этой задачи, если это понадобится для локальной проверки

### 2.2 Основной критерий - отправитель/remote chat id и тип события

Фильтр должен принимать решение только по данным текущего WhatsApp event payload:

- remote chat id, вычисленный из `from`, `to`, `chatId`, `peerJid` или `id.remote`
- направлению события, например `fromMe`
- типу события, например `message.type`
- явным флагам payload, например `isGroup`, `isStatus`, `broadcast`

Фильтр не должен зависеть от уже сохраненных данных в SQLite.

### 2.3 Фильтр должен стоять до persistence

Фильтр должен срабатывать до:

- `chats.upsertByEmployeeCode`
- `messages.upsertByEmployeeCode`
- `messageHandler.handle`
- `callHandler.handle`
- `fetchMessages()` для нецелевых polling chats
- `resolvePhoneNumber()` и `getContactLidAndPhone()` для нецелевых events

Причина: если событие нецелевое, оно не должно создавать ни chat row, ни message row, ни лишнюю работу по resolution.

## 3. Scope

В scope:

- live event filter для `message`
- live event filter для `message_create`
- live event filter для `call`
- polling chat filter для `getChats()`
- polling message filter для `fetchMessages()` results
- фильтрация `call_log` message events как звонков
- unit tests на sender/type rules
- integration tests на отсутствие persistence для нецелевых events

Вне scope:

- изменение database schema
- миграции SQLite
- очистка existing dev data
- frontend-фильтрация
- изменение API response contract
- изменение canonical chat model
- изменение deduplication rules
- outbound sending
- аналитика по отфильтрованным событиям

## 4. Текущее состояние

Сейчас backend принимает WhatsApp events в `src/whatsapp/manager.ts`.

Текущие источники:

- `client.on('message')`
- `client.on('message_create')`
- `client.on('call')`
- `client.getChats()`
- `chat.fetchMessages()`

Текущее поведение:

- live incoming messages почти сразу проходят в `messageHandler`
- live outgoing messages проходят через `message_create`, если `fromMe = true`
- `call_log` messages маршрутизируются в `callHandler`
- polling проходит по всем чатам из `getChats()`
- `fetchMessages()` вызывается до надежной фильтрации chat kind

Проблема: система может сохранить групповые чаты, групповые сообщения, системные уведомления, statuses, broadcasts и channels.

## 5. Термины

### 5.1 Remote chat id

`remote chat id` - это WhatsApp JID чата, в котором произошло событие.

Для message events:

- если `message.chatId` есть, использовать его
- иначе если `message.fromMe = true`, использовать `message.to`
- иначе использовать `message.from`
- если доступен `message.id.remote`, он может использоваться как fallback или validation source

Для call events:

- если `call.chatId` есть, использовать его
- иначе если `call.peerJid` есть, использовать его
- иначе если `call.fromMe = true`, использовать `call.to`
- иначе использовать `call.from`
- если direction неизвестен, использовать первый direct JID из `peerJid`, `from`, `to`

### 5.2 Direct personal chat

Direct personal chat - это чат с одним внешним контактом.

Допустимые JID формы:

```txt
<digits>@c.us
<digits>@s.whatsapp.net
<digits>@lid
```

Примеры целевых chat ids:

```txt
995555000111@c.us
995555000111@s.whatsapp.net
123456789012345@lid
```

### 5.3 Non-target chat

Нецелевые chat ids:

```txt
<anything>@g.us
status@broadcast
<anything>@broadcast
<anything>@newsletter
unknown
empty string
non-string value
malformed jid
```

Примеры:

```txt
120363000000000000@g.us
status@broadcast
123456789@broadcast
123456789@newsletter
```

## 6. Sender Rules

### 6.1 Incoming message

Для incoming `message` event:

- `fromMe` обычно `false`
- remote chat id должен вычисляться из `chatId`, затем `from`, затем `id.remote`
- если remote chat id не direct personal chat, событие должно быть отброшено

Пример целевого incoming event:

```ts
{
  from: '995555000111@c.us',
  fromMe: false,
  type: 'chat'
}
```

Пример нецелевого incoming event:

```ts
{
  from: '120363000000000000@g.us',
  author: '995555000111@c.us',
  fromMe: false,
  type: 'chat'
}
```

Важно: `author` в группе может быть личным JID, но это не делает событие целевым. Решение принимается по remote chat id, а не по `author`.

### 6.2 Outgoing message

Для outgoing `message_create` event:

- обрабатывать только `fromMe = true`
- remote chat id должен вычисляться из `chatId`, затем `to`, затем `id.remote`
- если remote chat id не direct personal chat, событие должно быть отброшено

Пример целевого outgoing event:

```ts
{
  from: 'employee@c.us',
  to: '995555000111@c.us',
  fromMe: true,
  type: 'chat'
}
```

Пример нецелевого outgoing event:

```ts
{
  from: 'employee@c.us',
  to: '120363000000000000@g.us',
  fromMe: true,
  type: 'chat'
}
```

### 6.3 Status and broadcast

Любой message event должен быть отброшен, если:

- `isStatus = true`
- `broadcast = true`
- remote chat id равен `status@broadcast`
- remote chat id заканчивается на `@broadcast`

Это правило имеет приоритет над message type.

### 6.4 Channels/newsletters

Любой event должен быть отброшен, если remote chat id заканчивается на:

```txt
@newsletter
```

Если payload содержит `isChannel = true`, событие также должно быть отброшено.

### 6.5 Groups

Любой event должен быть отброшен, если:

- remote chat id заканчивается на `@g.us`
- payload содержит `isGroup = true`

Для message events `isGroup` может отсутствовать, поэтому suffix `@g.us` является обязательным guard.

## 7. Type Rules

### 7.1 Message type denylist

Фильтр должен отбрасывать системные WhatsApp message types:

```txt
broadcast_notification
debug
e2e_notification
gp2
group_notification
newsletter_notification
notification
notification_template
protocol
```

Если событие имеет один из этих типов, оно не должно попадать в `messageHandler` или `callHandler`.

### 7.2 User message types

Фильтр не должен строиться на жестком allowlist всех пользовательских типов.

Причина: `whatsapp-web.js` и WhatsApp Web могут добавлять новые пользовательские типы. Если remote chat id является direct personal chat и тип не находится в system denylist, событие можно считать целевым пользовательским сообщением.

Ожидаемые пользовательские типы, которые должны проходить:

```txt
album
audio
buttons_response
chat
ciphertext
document
groups_v4_invite
hsm
image
interactive
list
list_response
location
multi_vcard
native_flow
order
oversized
payment
poll_creation
product
ptt
reaction
revoked
scheduled_event_creation
sticker
template_button_reply
unknown
vcard
video
```

`revoked`, `unknown`, `ciphertext` и `oversized` не содержат обычный body, но они являются событиями личного чата. Они должны проходить, если product decision не требует скрывать их отдельно.

### 7.3 `call_log`

`call_log` - особый тип.

Если message event имеет:

```txt
type = call_log
```

то событие должно:

- пройти sender filter как direct personal chat
- не попасть в `messageHandler`
- попасть в call normalization flow
- сохраниться как `message_type = 'call'`, если call id стабилен

Если `call_log` относится к группе, broadcast, status или newsletter, оно должно быть отброшено.

### 7.4 Missing type

Если `type` отсутствует:

- событие можно пропустить, если remote chat id является direct personal chat
- persistence layer уже должен обработать missing/undefined `messageType` так же, как сейчас

Missing type сам по себе не является причиной для discard.

## 8. Call Rules

### 8.1 Live call event

Live `call` event должен сохраняться только если:

1. `isGroup !== true`
2. resolved remote chat id является direct personal chat
3. есть стабильный call id

Если `isGroup = true`, событие должно быть отброшено даже если `from` или `peerJid` выглядит как direct JID.

### 8.2 Call peer resolution

Remote chat id для call должен вычисляться из доступных полей в таком порядке:

1. `chatId`
2. `peerJid`
3. direction-aware `to` или `from`
4. первый direct JID из `from` и `to`, если direction неизвестен

### 8.3 Group call

Group call не должен создавать:

- chat row
- message row
- warning about missing stable call id, если событие уже отброшено как group call

### 8.4 Call without stable id

Direct personal call без стабильного call id не должен сохраняться.

Это существующее поведение сохраняется. Фильтр не должен заменять stable id validation.

## 9. Polling Rules

### 9.1 Chat-level polling filter

В `syncChatsInternal` после получения `chatId` нужно применить chat-level filter.

Если chat не direct personal chat:

- не вызывать `fetchMessages()`
- не вызывать `syncPolledMessage()`
- не делать `chats.upsertByEmployeeCode()`
- не увеличивать `syncedChatCount`

Это предотвращает сохранение групповых и системных чатов во время polling.

### 9.2 Runtime chat metadata

Если runtime chat имеет:

- `isGroup = true`
- `isChannel = true`
- id с suffix `@g.us`
- id с suffix `@broadcast`
- id с suffix `@newsletter`

он должен быть отброшен.

### 9.3 Message-level polling filter

Даже после chat-level filter нужно применить message-level filter к каждому `rawMessage`.

Причина: WhatsApp Web cache может содержать system events внутри direct chat.

Если polled message имеет system type из denylist, оно не должно попасть в persistence.

## 10. Architecture Requirements

### 10.1 Shared filter module

Логику фильтра нужно держать в одном месте.

Рекомендуемый файл:

```txt
src/whatsapp/ingest-filter.ts
```

Рекомендуемые функции:

```ts
type WhatsappEventFilterDecision = {
  shouldIngest: boolean;
  reason?: string;
  remoteChatId?: string;
};

isDirectPersonalChatId(chatId: unknown): boolean;

resolveMessageRemoteChatId(message: Record<string, unknown>): string | undefined;

resolveCallRemoteChatId(call: Record<string, unknown>): string | undefined;

isSystemMessageType(type: unknown): boolean;

shouldIngestMessageEvent(message: Record<string, unknown>): WhatsappEventFilterDecision;

shouldIngestCallEvent(call: Record<string, unknown>): WhatsappEventFilterDecision;

shouldPollRuntimeChat(chat: Record<string, unknown>): WhatsappEventFilterDecision;
```

Функции должны быть pure и не должны обращаться к базе данных, network, filesystem или WhatsApp client methods.

### 10.2 Manager integration

`manager.ts` должен использовать filter module в четырех местах:

1. live `message`
2. live `message_create`
3. live `call`
4. polling `getChats()` / `fetchMessages()`

### 10.3 Handler defensive guards

Основной фильтр должен быть в `manager.ts`.

Допустимо добавить легкие defensive guards в:

- `message-handler`
- `call-handler`

Но handler guards не должны быть единственной защитой, потому что к этому моменту система уже могла выполнить лишнюю normalization work.

### 10.4 Logging

Отфильтрованные события не должны логироваться как warning.

Рекомендуется:

- не логировать каждый skipped event на `info` или `warn`
- при необходимости использовать debug-level logger, если такой уровень появится
- для текущего `Logger` без debug лучше не писать per-event skip logs

Причина: цель задачи - убрать шум, а не перенести его из базы в логи.

Исключение: можно логировать агрегированную статистику polling sync, если она уже есть в коде и не создает per-event noise.

## 11. Expected Persistence Behavior

### 11.1 Target direct text message

Input:

```ts
{
  from: '995555000111@c.us',
  fromMe: false,
  id: { _serialized: 'msg-1', remote: '995555000111@c.us' },
  type: 'chat',
  body: 'hello'
}
```

Expected:

- `messageHandler.handle` is called
- chat is upserted
- message is upserted if stable message id exists

### 11.2 Target direct media message

Input:

```ts
{
  from: '995555000111@c.us',
  fromMe: false,
  id: { _serialized: 'msg-2', remote: '995555000111@c.us' },
  type: 'image',
  hasMedia: true
}
```

Expected:

- event is ingested
- body may be empty
- message type is preserved as `image`

### 11.3 Group message

Input:

```ts
{
  from: '120363000000000000@g.us',
  author: '995555000111@c.us',
  fromMe: false,
  id: { _serialized: 'msg-group-1', remote: '120363000000000000@g.us' },
  type: 'chat',
  body: 'hello group'
}
```

Expected:

- no chat upsert
- no message upsert
- no message handler call

### 11.4 Direct system notification

Input:

```ts
{
  from: '995555000111@c.us',
  fromMe: false,
  id: { _serialized: 'msg-system-1', remote: '995555000111@c.us' },
  type: 'notification_template'
}
```

Expected:

- event is discarded
- no chat upsert
- no message upsert

### 11.5 Status event

Input:

```ts
{
  from: 'status@broadcast',
  fromMe: false,
  isStatus: true,
  type: 'image'
}
```

Expected:

- event is discarded

### 11.6 Direct call

Input:

```ts
{
  id: 'call-1',
  peerJid: '995555000111@c.us',
  isGroup: false,
  isVideo: false,
  outgoing: false
}
```

Expected:

- call handler is called
- call is persisted as chat timeline row

### 11.7 Group call

Input:

```ts
{
  id: 'call-group-1',
  peerJid: '120363000000000000@g.us',
  isGroup: true,
  isVideo: false,
  outgoing: false
}
```

Expected:

- call is discarded
- no chat upsert
- no message upsert

## 12. Test Requirements

### 12.1 Unit tests for filter module

Add focused tests for:

- direct `@c.us` accepted
- direct `@s.whatsapp.net` accepted
- direct `@lid` accepted
- `@g.us` rejected
- `status@broadcast` rejected
- `@broadcast` rejected
- `@newsletter` rejected
- malformed ids rejected
- system message types rejected
- non-system direct message types accepted
- missing message type accepted for direct chat
- `call_log` accepted only for direct chat
- `isGroup = true` call rejected

### 12.2 Manager tests

Extend `tests/whatsapp/manager.test.ts` with cases:

- incoming direct message reaches `messageHandler`
- incoming group message does not reach `messageHandler`
- outgoing direct `message_create` reaches `messageHandler`
- outgoing group `message_create` does not reach `messageHandler`
- direct `notification_template` does not reach `messageHandler`
- direct `call_log` reaches `callHandler`
- group `call_log` does not reach `callHandler`
- direct live call reaches `callHandler`
- group live call does not reach `callHandler`
- polling skips `fetchMessages()` for group chat
- polling skips `fetchMessages()` for newsletter/broadcast chat
- polling direct chat still fetches and persists target messages
- polling direct chat ignores system messages in fetched results

### 12.3 Database persistence tests

Add integration coverage with in-memory SQLite:

- non-target message event creates no `chats` row
- non-target message event creates no `messages` row
- non-target call event creates no `messages` row
- target direct event continues to create expected rows

Tests must not depend on existing development database contents.

## 13. Acceptance Criteria

The implementation is complete when:

1. New live group messages are not persisted.
2. New live group outgoing messages are not persisted.
3. New live direct messages are still persisted.
4. New live direct media messages are still persisted.
5. New live system WhatsApp notifications are not persisted.
6. New live status/broadcast/channel events are not persisted.
7. New direct calls are still persisted in chat history.
8. New group calls are not persisted.
9. Polling does not call `fetchMessages()` for group, broadcast, status or newsletter chats.
10. Polling direct chats still sync target messages.
11. Polling direct chats skip system message types.
12. No migration or cleanup is added for existing database rows.
13. Existing API response shape remains unchanged.
14. Existing message and call deduplication behavior remains unchanged.

## 14. Explicit Non-Requirements

Do not implement:

- database cleanup
- schema migration
- endpoint for cleanup
- UI-only filtering as the primary solution
- allowlist-only message type filtering
- filtering based on message body
- filtering based on contact display name
- filtering based on employee code
- filtering based on saved `chat_kind`

Saved `chat_kind` may be useful for UI or analytics later, but it must not be required for deciding whether a new raw WhatsApp event is target.

## 15. Implementation Notes

Recommended order:

1. Add `ingest-filter.ts` with pure functions and unit tests.
2. Integrate filter into live `message` and `message_create`.
3. Integrate filter into live `call`.
4. Integrate filter into polling before `fetchMessages()`.
5. Add manager/in-memory persistence tests.
6. Run full backend tests.

The development database can remain dirty during implementation. Verification should rely on tests and new events, not on modifying old rows.
