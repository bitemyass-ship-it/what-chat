# Backend Specification: Calls As Chat Messages

## 1. Goal

Implement backend support for WhatsApp calls so that they appear in a chat history as regular timeline entries.

After this change, the backend must:

1. persist calls in the same chat timeline that already stores messages
2. avoid introducing a separate `calls` table in the first release
3. persist calls with `message_type = 'call'`
4. persist a normalized `body` value for calls:
   - `Incoming call`
   - `Outgoing call`
   - `Missed call`
5. return these rows through the existing chat-history endpoint

This document describes only backend ingest, backend storage, backend read models, and seed/test data requirements.

## 2. Product Decision

### 2.1 Calls are timeline entries

A call must be stored as a chat timeline event, not as a separate backend entity.

Do not:

- add a dedicated calls list endpoint
- add a new `calls` table in the first release
- create a separate read model just for calls

### 2.2 Calls reuse the existing messages pipeline

For the first implementation, calls must be stored in the `messages` table.

Reasons:

- the project already has a chat timeline model
- the chat history endpoint already exists
- this avoids extra migrations and duplicated read-model logic

### 2.3 Persisted text must be normalized

The backend must not persist raw WhatsApp payload values or technical labels as the user-facing `body`.

For call rows, the backend must persist:

- `messageType = 'call'`
- `body` as one of:
  - `Incoming call`
  - `Outgoing call`
  - `Missed call`

## 3. Scope

In scope:

- live ingest of WhatsApp call events
- persistence of calls into the existing chat timeline model
- backend normalization of call state
- updating `lastMessagePreview` when a call is the latest chat event
- adding calls to application seed data
- updating backend unit and integration tests

Out of scope:

- frontend UI changes
- a dedicated calls dashboard
- full call analytics
- call duration
- callback actions
- call filtering
- exporting calls

## 4. Current State

Current project state:

- the session manager listens only to `message` and `message_create`
- there is no dedicated call handler
- calls are not persisted to the database
- the chat history endpoint returns only persisted messages

Result: calls do not appear in SQLite or in the API.

## 5. Backend Read Model Requirements

### 5.1 Chat timeline behavior

If a WhatsApp call occurs between an employee and a contact, that call must appear in the corresponding chat history as a single timeline row.

The row must:

- participate in the standard timestamp ordering
- be returned by the existing chat history endpoint
- live in the same read model as normal messages

### 5.2 Persisted type behavior

For call rows, the backend must persist:

- `message_type = 'call'`

All other message types must continue to behave as they do today.

### 5.3 Persisted body behavior

For call rows, the backend must persist canonical text:

- `Incoming call`
- `Outgoing call`
- `Missed call`

The following are not allowed:

- empty `body`
- `body = 'call'`
- `body = 'unknown'`

### 5.4 Direction behavior

The `direction` field must remain meaningful for call rows.

Rules:

- `Outgoing call` -> `direction = 'outgoing'`
- `Incoming call` -> `direction = 'incoming'`
- `Missed call` -> `direction = 'incoming'`

A missed call is therefore still an incoming event by direction, but it has a different normalized body.

### 5.5 Chat preview behavior

If a call is the latest event in a chat, `lastMessagePreview` must be stored as the same normalized text:

- `Incoming call`
- `Outgoing call`
- `Missed call`

## 6. Data Model Decision

### 6.1 No separate `calls` table in the first release

The first implementation must not add a `calls` table.

Calls must be stored in `messages`.

### 6.2 Messages row shape for calls

A call entry must be stored as a normal `messages` row with a dedicated type:

- `message_type = 'call'`
- `direction = 'incoming' | 'outgoing'`
- `body = normalized call text`

Minimum expected shape:

```ts
interface CallTimelineMessage {
  externalMessageId: string;
  sourceChatId: string;
  direction: 'incoming' | 'outgoing';
  body: 'Incoming call' | 'Outgoing call' | 'Missed call';
  messageType: 'call';
  timestamp: number | null;
}
```

### 6.3 Additive metadata columns

To avoid encoding all business logic only in `body`, the `messages` table should be extended with additive nullable columns:

- `call_status TEXT`
- `call_media_type TEXT`

Where:

- `call_status IN ('incoming', 'outgoing', 'missed')`
- `call_media_type IN ('voice', 'video')`

`body` remains a denormalized readable field for the chat history API.

`call_status` is useful for:

- deterministic body normalization
- future analytics
- recomputing persisted display text safely

### 6.4 Proposed schema change

Recommended additive schema extension:

```sql
ALTER TABLE messages ADD COLUMN call_status TEXT;
ALTER TABLE messages ADD COLUMN call_media_type TEXT;
```

And constraints:

```sql
CHECK(call_status IN ('incoming', 'outgoing', 'missed') OR call_status IS NULL)
CHECK(call_media_type IN ('voice', 'video') OR call_media_type IS NULL)
```

Important:

- existing rows must remain valid
- the migration must be additive
- recreating the table is not allowed

## 7. Source Events And Normalization

### 7.1 Event sources

Call support must consider two classes of sources:

1. `client.on('call')`
2. message events with `message.type === 'call_log'`, if such rows are actually emitted by the current `whatsapp-web.js` version

The implementation must not rely on only one source without explicit justification.

### 7.2 Canonical storage rule

The database must end up with one timeline row per real call event.

Do not:

- create duplicate rows from both `call` and `call_log`
- create one row for call start and a second row for the same call unless there is an explicit product requirement

If the system receives multiple representations of the same call, they must collapse into one canonical row.

### 7.3 Stable identity for calls

Introduce a stable deduplication key for calls.

Priority:

1. an explicit WhatsApp call/message id, if the payload provides a stable id
2. a fallback synthetic key based on the call id from the payload

Recommended fallback format:

- `call:<rawCallId>`

If a more canonical source arrives later, the existing row must be updated rather than duplicated.

### 7.4 Chat identity resolution

Each call row must attach to the same canonical chat model used for messages.

Rules:

- use `peerJid`, `from`, or `to` as the source chat identity
- resolve phone numbers through the existing chat identity helpers
- upsert the chat before upserting the message row

Calls must not be stored outside the existing canonical chat model.

### 7.5 Call status normalization

The system must expose exactly three product-level call statuses:

- `incoming`
- `outgoing`
- `missed`

Normalization table:

| callStatus | direction | body |
| --- | --- | --- |
| `incoming` | `incoming` | `Incoming call` |
| `outgoing` | `outgoing` | `Outgoing call` |
| `missed` | `incoming` | `Missed call` |

### 7.6 Missed call detection

`Missed call` must not be inferred using loose heuristics such as "not from me" or `fromMe = false`.

Missed status must come only from a reliable source:

- an explicit payload field
- a reliable WhatsApp call-log state
- a deterministic parser over raw call-log payload, if the library exposes the state only indirectly

If there is no reliable missed-call signal, the implementation must not guess.

In that case, the fallback must be:

- `incoming`

## 8. Backend Changes

### 8.1 New handler

Add a dedicated handler, for example:

- `src/whatsapp/call-handler.ts`

It must:

- accept a normalized call payload
- upsert the canonical chat
- upsert the call row into `messages`
- log structured call-ingest information

`message-handler` should not absorb mixed message and call responsibilities without explicit refactoring.

### 8.2 Session manager changes

`src/whatsapp/manager.ts` must subscribe to:

- `call`

And forward that event to the call handler.

If the current library version emits usable `call_log` rows through the normal message pipeline, those must also be handled in the overall ingest flow without causing duplicate persistence.

### 8.3 Payload types

Add a dedicated TypeScript type, for example:

```ts
export interface CallPayload {
  callId: string;
  chatId?: string;
  from?: string;
  to?: string;
  fromMe?: boolean;
  timestamp?: number;
  isVideo?: boolean;
  status: 'incoming' | 'outgoing' | 'missed';
  rawPayload?: unknown;
}
```

If `status` cannot be determined at the earliest ingest step, an internal intermediate state is acceptable, but the persisted row must end up as one of:

- `incoming`
- `outgoing`
- `missed`

### 8.4 Repository changes

`MessagesRepository` must support persisting call metadata.

Minimum required support:

- `messageType = 'call'`
- `callStatus`
- `callMediaType`
- idempotent upsert by stable external id

### 8.5 Chat summary updates

When a call is persisted, the backend must update chat metadata in the same way it updates for normal messages:

- `last_message_id`
- `last_message_preview`
- `last_message_timestamp`

But only if the incoming event is actually newer than the already persisted last event.

### 8.6 Analytics counters

Current chat counters:

- `incomingMessages`
- `outgoingMessages`
- `totalMessages`

must not automatically include call rows if those fields are intended to count only messages.

Rule for the first implementation:

- rows with `message_type = 'call'` must appear in the timeline
- rows with `message_type = 'call'` must not increase `incomingMessages`, `outgoingMessages`, or `totalMessages`

### 8.7 API contract

The route path does not change:

- `GET /employees/:code/chats/:chatRecordId/messages`

But the endpoint must now return a mixed timeline:

- text messages
- call rows

The response shape must remain backward-compatible.

Example call row:

```json
{
  "messageId": 501,
  "externalMessageId": "call:ABCD-1234",
  "timestamp": "2026-04-09T08:15:00.000Z",
  "direction": "incoming",
  "body": "Missed call",
  "messageType": "call"
}
```

## 9. Error Handling And Fallback Rules

### 9.1 Unknown call status

If the payload does not allow reliable call-status detection, the backend must not persist a raw unknown label.

Acceptable behavior:

1. fall back to `incoming` for a non-outgoing call event
2. skip the event with a warning log if even canonical direction or chat identity cannot be determined safely

The following are not allowed:

- `body = ''`
- `body = 'call'`
- `body = 'unknown'`

### 9.2 Missing chat identity

If chat identity cannot be resolved:

- the row must not be persisted
- a warning or error log must include enough raw context for debugging

### 9.3 Duplicate event arrival

Repeated arrival of the same call:

- must not create a second row
- must result in an idempotent upsert

## 10. Testing Requirements

At minimum, cover the following cases.

### 10.1 Session manager

- registers a `call` listener
- forwards a normalized payload to the call handler

### 10.2 Call handler

- persists an outgoing call with `message_type = 'call'`
- persists an incoming call with `message_type = 'call'`
- persists a missed call with `message_type = 'call'`
- writes the correct `body` for each status
- updates chat preview and last timestamp
- does not create duplicate rows on repeated ingest

### 10.3 Repository / database

- additive migration does not break an existing database
- `call_status` and `call_media_type` can be written and read correctly
- mixed timeline rows are returned in correct timestamp order

### 10.4 Chat analytics

- call rows do not increase `incomingMessages`
- call rows do not increase `outgoingMessages`
- call rows do not increase `totalMessages`

### 10.5 Seed / demo data

- `scripts/reset-dev-data.ts` or the equivalent seed script creates call rows
- after seeding, the dataset contains at least one incoming, one outgoing, and one missed call
- at least one seeded chat has a call as its latest event

## 11. Acceptance Criteria

The task is complete when all of the following are true.

1. After a WhatsApp call event, a new row appears in the history of the corresponding chat.
2. That row is returned by the existing endpoint `GET /employees/:code/chats/:chatRecordId/messages`.
3. The row has `messageType = 'call'`.
4. The row `body` is one of:
   - `Incoming call`
   - `Outgoing call`
   - `Missed call`
5. If the call is the latest event in the chat, `lastMessagePreview` also stores the normalized call label.
6. Re-ingesting the same call does not create a duplicate row.
7. Message counters do not start counting calls as normal messages.
8. After a seed/dev-data reset, the dataset contains test calls of all three types: incoming, outgoing, and missed.

## 12. Recommended Implementation Order

1. Extend schema and repository logic for call metadata.
2. Add `CallPayload` and a dedicated `call-handler`.
3. Subscribe the session manager to `call`.
4. Implement status normalization and deduplication.
5. Update chat read models.
6. Update seed/test-data scripts and fixtures.
7. Add backend tests.
