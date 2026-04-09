# Frontend Specification: Call Events In Chat History

## 1. Goal

Update the frontend so that persisted call events are displayed correctly in the existing employee chat UI.

The frontend must treat call rows as part of the normal chat timeline, not as a separate feature area.

After this change, the frontend must:

1. display call rows in the existing chat detail messages table
2. show the normalized backend body for calls:
   - `Incoming call`
   - `Outgoing call`
   - `Missed call`
3. show a readable type label for call rows in the `Type` column
4. show call previews in the employee chats list when a call is the latest chat event

This document describes only frontend behavior and frontend test expectations.

## 2. Related Backend Contract

The frontend depends on the existing backend read model described in:

- `docs/call-events-as-chat-messages-spec.md`

The relevant backend contract is:

- route remains `GET /employees/:code/chats/:chatRecordId/messages`
- call rows are returned inside the normal mixed timeline
- call rows use:
  - `messageType = 'call'`
  - `body = 'Incoming call' | 'Outgoing call' | 'Missed call'`

The frontend must consume that contract as-is.

No frontend work in this task should require backend API changes.

## 3. Scope

In scope:

- message-type labeling for call rows
- rendering call rows in the existing chat detail page
- rendering call previews in the employee chats list
- frontend tests for call rows

Out of scope:

- any backend changes
- call filtering
- separate call tabs or pages
- custom call icons or rich call cards
- call actions such as redial or callback

## 4. Current State

Current frontend behavior already supports a generic mixed timeline shape:

- chat detail reads `ChatMessageListItem`
- the messages table renders `Timestamp`, `Direction`, `Message`, and `Type`
- `body` is shown as text
- `messageType` is normalized only lightly for presentation

Current gap:

- the frontend does not yet define a specific presentation contract for `messageType = 'call'`
- the call-specific UX is not documented

## 5. Product Behavior

### 5.1 Chat detail timeline

Call rows must appear in the existing chat detail table together with normal text messages.

No separate section is allowed.

The existing table route remains:

- `frontend/src/app/employees/[code]/chats/[chatRecordId]/page.tsx`

The existing table component remains:

- `frontend/src/ui/Pages/EmployeeChat/components/ChatMessagesTable.tsx`

### 5.2 Message column behavior

For call rows, the `Message` column must display the backend-provided normalized `body` as-is:

- `Incoming call`
- `Outgoing call`
- `Missed call`

No frontend remapping is required for those strings.

The frontend must treat them as already normalized product text.

### 5.3 Type column behavior

For call rows, the `Type` column must display a readable type label derived from `messageType = 'call'`.

Recommended label:

- `call`

Requirements:

- the label must be deterministic
- it must not render as `unknown`
- it must not reuse the `text` label reserved for `chat`

### 5.4 Direction column behavior

The frontend must continue to use the existing `direction` field exactly as it comes from the backend.

This means:

- `Outgoing call` rows will show `Outgoing`
- `Incoming call` rows will show `Incoming`
- `Missed call` rows will also show `Incoming`

The frontend must not try to infer missed state from `direction`.

Missed state is conveyed by `body`, not by a special frontend-only direction rule.

### 5.5 Long-body and modal behavior

Call rows must continue to use the same table-body rendering pipeline as normal messages.

That means:

- if the normalized call body fits inside the preview limit, it renders inline
- if a future call label is longer than the preview limit, it follows the same truncation and modal rules as any other message row

No call-specific modal behavior is required.

### 5.6 Employee chats list behavior

If a call is the latest event in a chat, the employee chats table must display the backend-provided `lastMessagePreview` as-is.

Examples:

- `Incoming call`
- `Outgoing call`
- `Missed call`

The chats list must not replace these values with `No messages yet` or any call-specific placeholder.

## 6. Data Contract For Frontend

The existing frontend message row shape remains valid:

```ts
interface ChatMessageListItem {
  messageId: number;
  externalMessageId: string;
  timestamp: string | null;
  direction: 'incoming' | 'outgoing' | 'system';
  body: string;
  messageType: string;
}
```

No new frontend API fields are required for the first implementation.

The frontend must rely only on:

- `messageType`
- `body`
- `direction`
- `timestamp`

## 7. Implementation Requirements

### 7.1 Frontend label normalization

Update the message-type label helper in:

- `frontend/src/lib/chats.ts`

It should include an explicit branch for:

- `call -> call`

Recommended behavior:

- `chat -> text`
- `call -> call`
- empty value -> `unknown`
- any other value -> render the normalized raw type

### 7.2 Display body helper

The existing body-display helper should continue to work for call rows without special fallback logic.

Call bodies are already non-empty normalized strings from the backend.

The frontend must not replace:

- `Incoming call`
- `Outgoing call`
- `Missed call`

with `No text content`.

### 7.3 Chats list preview rendering

The existing preview rendering in:

- `frontend/src/ui/Pages/Employee/components/EmployeeChatsTable.tsx`

must continue to show `lastMessagePreview` as-is.

No extra transformation is needed for call previews.

## 8. Testing Requirements

At minimum, add or update frontend tests for the following cases.

### 8.1 Chat detail message table

- renders a row with `messageType = 'call'`
- shows `call` in the `Type` column
- shows `Incoming call` in the `Message` column
- shows `Outgoing call` in the `Message` column
- shows `Missed call` in the `Message` column

### 8.2 Message type helper

- `getChatMessageTypeLabel('chat')` returns `text`
- `getChatMessageTypeLabel('call')` returns `call`

### 8.3 Chats list preview

- when `lastMessagePreview = 'Incoming call'`, the chats list shows that text
- when `lastMessagePreview = 'Outgoing call'`, the chats list shows that text
- when `lastMessagePreview = 'Missed call'`, the chats list shows that text

### 8.4 Mixed timeline

- a page with both text messages and call rows renders all rows correctly
- call rows do not break pagination behavior
- call rows do not break the full-message modal behavior for long non-call messages

## 9. Acceptance Criteria

The task is complete when all of the following are true.

1. Call rows returned by the backend are visible on the existing chat detail page.
2. The `Message` column displays the backend-provided call body exactly as returned.
3. The `Type` column displays `call` for `messageType = 'call'`.
4. The employee chats list shows call-based `lastMessagePreview` values without replacing them with placeholders.
5. Existing text-message behavior remains unchanged.
6. Frontend tests cover call rows in both the chats list and the chat detail table.

## 10. Recommended Implementation Order

1. Update the message type label helper in `frontend/src/lib/chats.ts`.
2. Verify the existing chat-detail table renders call bodies correctly without extra branching.
3. Add or update tests for the chat-detail table and chats list preview.
4. Confirm that the mixed timeline still behaves correctly for pagination and message expansion.
