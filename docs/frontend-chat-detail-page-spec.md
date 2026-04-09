# Frontend Specification: Chat Detail Page

## Scope

Implement a dedicated chat detail page that shows message history for a single employee chat.

This page must:

1. have its own route
2. use `@tanstack/react-table` for the messages table
3. stay minimal and analytics-oriented
4. focus on reading message history, not on recreating a messenger UI

This document describes only the frontend behavior and data requirements for the chat detail page.

## Related Backend Contract

The page expects backend read endpoints that return persisted data from SQLite.

Required backend contracts:

- `GET /employees/:code/chats`
- `GET /employees/:code/chats/:chatRecordId/messages`

The frontend should treat these endpoints as read models over stored data, not as live WhatsApp fetches.

Backend-side schema and persistence details are described separately in:

- `docs/backend-chat-message-database-upgrade-spec.md`
- `docs/backend-chat-message-persistence-spec.md`

## Current State

- There is no chat detail page yet.
- The employee page currently stops at the chats tab placeholder.
- The frontend already has Next.js app routing and `@tanstack/react-table`.

## Goals

- Add a dedicated page for one chat.
- Make message history visually easy to read.
- Support future analytics expansion without redesigning the route structure.
- Avoid building a messenger clone.

## Non-Goals

- No reply box.
- No WhatsApp bubble layout requirement.
- No message actions such as forward, star, delete, or react.
- No pinned/archived/unread management UI.
- No separate page per message.

## Routing Requirements

Add a new page route:

- `frontend/src/app/employees/[code]/chats/[chatRecordId]/page.tsx`

This route must:

- render chat detail content for one employee chat
- support direct navigation/bookmarking
- show a proper not-found or error state when the chat is unavailable

## Page Composition

The page should contain three sections:

1. top navigation / return context
2. compact chat summary
3. messages table

### 1. Top navigation

Recommended elements:

- link back to `/employees/[code]`
- optional text indicating this chat belongs to the current employee

### 2. Chat summary

The summary block should show:

- chat label: `displayName`, else `phoneNumber`, else fallback label
- first message at
- last message at
- total messages
- incoming count
- outgoing count

These are analytics summary fields, not messenger controls.

### 3. Messages table

The main content of the page must be a TanStack table of messages.

## Table Engine

- The messages table must use `@tanstack/react-table`.
- TanStack Table should manage:
  - columns
  - sorting
  - row model
  - empty-state rendering behavior

## Required Message Columns

The page must render these columns:

1. `Timestamp`
2. `Direction`
3. `Message`
4. `Type`

### `Timestamp`

- formatted datetime
- default sort should be descending by timestamp

### `Direction`

- display `Incoming` or `Outgoing`
- should be visually scannable, for example with a compact badge or strong text style

### `Message`

- render textual content
- enforce a compact inline preview in the table
- empty text fallback such as `No text content`

#### Long message behavior

Long message bodies must not be allowed to stretch the table layout unpredictably.

Required behavior:

- introduce a frontend message preview limit of `35` characters
- if `body.length <= 35`, render the message inline without extra controls
- if `body.length > 35`, render only the preview slice in the table
- the preview should be visually marked as truncated with an ellipsis-style affordance
- a dedicated expand control must exist for truncated rows
- clicking the expand control must open a modal with the full message body

Preview rules:

- preserve the existing empty-text fallback for empty bodies
- the table cell should remain compact and width-bounded
- multiline content does not need to be fully rendered inside the table once truncation is introduced
- the modal is the source of truth for reading the full long message
- the full message view must stay inside the existing chat detail page flow
- do not add a dedicated route or standalone page for one message

Modal requirements:

- render as a focused read-only dialog
- include clear context such as `Full message`
- show the full original message body without the 35-character truncation
- preserve line breaks in the full message view
- allow explicit close action
- closing the modal must return the user to the same table state
- the modal opens on top of the existing chat detail page and does not navigate away

Interaction affordance:

- the trigger may use `...`, an ellipsis icon, or another minimal overflow action
- the trigger must appear only when the message is actually truncated
- the trigger must be keyboard accessible
- the trigger should have an accessible label such as `View full message`

### `Type`

- display a compact value such as `text`, `image`, `audio`, `document`, etc.
- if the backend uses raw WhatsApp types, the UI may normalize only for presentation

## Optional Conditional Columns

These columns should not be mandatory for the first frontend release, but the page layout should allow them later:

- `Author`
- `Has Media`

They are especially useful if group chats are introduced later, but are not required for the minimal analytics UI.

## Data Contract For Frontend

### Chat summary

The page needs a summary shape equivalent to:

```ts
interface ChatDetailSummary {
  chatRecordId: number;
  displayName: string | null;
  phoneNumber: string | null;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  totalMessages: number;
  incomingMessages: number;
  outgoingMessages: number;
}
```

### Message rows

The table needs rows equivalent to:

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

Notes:

- the page does not need raw WhatsApp payload fields rendered by default
- backend may include more fields, but the minimal UI should stay focused

## Proxy / Data Layer Requirements

Add same-origin proxy routes:

- `frontend/src/app/api/employees/[code]/chats/[chatRecordId]/messages/route.ts`

Required behavior:

- forward `GET`
- preserve backend status
- preserve backend response body
- return `502` only on proxy/network failure

Add frontend lib helpers, for example:

- `frontend/src/lib/chats.ts`

Suggested helpers:

- `getEmployeeChats(code: string)` for lookup/navigation context
- `getEmployeeChatMessages(code: string, chatRecordId: string)`

If the backend later returns a combined summary + messages payload, the helper may be split accordingly.

## Suggested File Changes

- new `frontend/src/app/employees/[code]/chats/[chatRecordId]/page.tsx`
- new `frontend/src/ui/Pages/EmployeeChat/EmployeeChat.tsx`
- new `frontend/src/ui/Pages/EmployeeChat/components/ChatMessagesTable.tsx`
- new `frontend/src/lib/chats.ts`
- new `frontend/src/app/api/employees/[code]/chats/[chatRecordId]/messages/route.ts`

## Visual Requirements

- Keep the page visually aligned with the existing employee page style.
- The summary should be compact, not a dashboard wall.
- The messages table must prioritize readability over decorative styling.
- Do not use speech bubbles as the primary layout.
- The page should feel like a structured conversation log.

For long message text:

- keep the table cell compact instead of letting very long messages dictate table width
- prefer a short preview plus explicit modal expansion over rendering the whole body inline
- preserve full readability in the modal view
- preserve line breaks in the modal body

For small screens:

- horizontal scroll is acceptable for the table
- the summary block should stack cleanly

## Sorting And Ordering

- Default order: newest messages first
- The table should support sorting at least on `Timestamp`

Client-side sorting through TanStack Table is acceptable for the first release if the message volume per page is bounded.

## Empty State

If the chat exists but has no messages yet:

- render the page shell
- render summary block
- show a table empty state such as `No messages available yet`

## Error State

If messages fail to load:

- render an inline error state inside the page
- keep navigation context visible

If the chat is not found:

- use a proper not-found handling strategy consistent with the rest of the frontend

## Test Plan

Add or update frontend tests for:

- the chat detail route renders successfully with valid data
- the page renders a summary block
- the messages table is built with TanStack columns
- the required columns are visible
- default order is newest first
- messages shorter than the `35`-character limit render inline without an expand control
- messages longer than the limit render a truncated preview
- the full-message trigger appears only for truncated messages
- the modal renders the full original message body
- multiline message text remains readable in the modal
- empty state renders when there are no messages
- error state renders when the messages endpoint fails
- the proxy route forwards `GET /employees/:code/chats/:chatRecordId/messages`

## Acceptance Criteria

- A dedicated route exists for one employee chat.
- The page renders a compact analytics summary for that chat.
- Message history is shown in a TanStack table.
- The table focuses only on analytics-relevant reading fields.
- Long message bodies are truncated in-table with an explicit affordance to open the full text in a modal.
- The page does not attempt to recreate the full WhatsApp UI.
