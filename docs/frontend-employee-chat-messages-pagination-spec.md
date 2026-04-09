# Frontend Specification: Employee Chat Messages Table Pagination

## Scope

Implement pagination for the messages table on the chat detail page.

This document describes only the frontend behavior for the table of one concrete chat.

The pagination scope must:

1. show only 20 message rows per page
2. read paginated message data from backend
3. render pagination controls under the messages table
4. disable all client-side sorting
5. rely on backend order for timestamp-based row ordering

This specification does not redefine the whole chat detail page and does not cover the employee chats table.

## Related Backend Contract

The frontend depends on a paginated backend endpoint:

- `GET /employees/:code/chats/:chatRecordId/messages?page=1&pageSize=20`

Successful `200 OK` response shape must be:

```ts
interface GetEmployeeChatMessagesResponse {
  items: ChatMessageListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
```

Where:

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

Error responses follow the existing employee API style:

- `404` for unknown employee with JSON body containing `error`
- `404` for unknown chat with JSON body containing `error`
- `400` for invalid pagination params with JSON body containing `error`
- `5xx` for backend failures with JSON body containing `error`

## Current State

- The chat detail page already has a messages table.
- The current messages table expects a plain array response.
- The current table supports client-side sorting by timestamp.
- The current page has no pagination footer for messages.

## Goals

- Replace full-history loading with server-side pagination.
- Keep the existing chat detail page read-focused.
- Preserve the compact analytics table layout.
- Remove client-side sorting entirely.
- Keep long-message modal behavior compatible with paginated rows.

## Non-Goals

- No client-side sorting by any column.
- No page-size switcher.
- No search within messages.
- No filters by direction or type.
- No infinite scrolling.
- No redesign of the entire chat detail page.

## Functional Requirements

### Entry Point

The feature remains inside the existing chat detail page:

- `frontend/src/app/employees/[code]/chats/[chatRecordId]/page.tsx`

The messages table must stay inside the current messages section of that page.

### Data Loading

The frontend must request messages with pagination params:

- `page`
- `pageSize`

For this scope:

- `pageSize` is always `20`

Example request:

- `/api/employees/anna/chats/17/messages?page=2&pageSize=20`

### URL State

The selected messages page must be reflected in the chat detail page URL.

Recommended shape:

- `/employees/anna/chats/17?page=3`

Requirements:

- reloading the page keeps the selected message page
- browser back/forward preserves the selected message page
- direct navigation to a paginated URL opens the correct page of messages

### Rows Per Page

- The table must render at most `20` message rows per page.
- The table must never render more rows than the backend returned for the current page.

### Sorting Behavior

All client-side sorting must be removed.

This means:

- column headers are not clickable for sorting
- no sorting arrows
- no sorting state in component state
- no `getSortedRowModel()` usage for messages table behavior

The frontend must trust backend ordering as final.

### Pagination Footer

A pagination footer must be rendered under the messages table when needed.

It must show:

- `Total: N`
- `Page X of Y`
- page number buttons

Example:

- `Total: 94`
- `Page 2 of 5`
- `1 2 3 4 5`

Requirements:

- current page is visually highlighted
- current page button is disabled or non-interactive
- clicking another page button fetches that page

Optional:

- `Previous`
- `Next`

These controls are allowed but not required if numbered pagination is present and clear.

### Pagination Visibility Rules

If `totalPages <= 1`:

- the pagination footer may be hidden
- or shown in a passive single-page state

Hidden is preferred to reduce noise.

### Empty State

If `total = 0`:

- keep the current table shell
- show the current empty-state copy for a chat with no stored messages

If `total > 0` and `items = []` because the current page is out of range:

- keep the table shell
- show a neutral page-level empty state

Recommended copy:

- `No messages on this page`

### Loading State

The chat detail page must support loading on:

- initial load
- page change

Loading behavior should:

- preserve the messages card shell
- preserve the table layout
- avoid aggressive layout jumps

### Error State

If paginated messages fail to load:

- show a compact inline error inside the messages card
- do not break the entire chat detail page

## Long Message Modal Requirements

The existing truncated-message behavior remains required.

Pagination must not break the modal flow.

Requirements:

- long message preview logic still applies only to rows on the current page
- expanding a message opens the full body modal for that row
- closing the modal returns the user to the same paginated table state
- page change must close any currently open modal to avoid stale row context

## Data Contract For Frontend State

Recommended state shape for paginated messages:

```ts
interface EmployeeChatMessagesState {
  messages: ChatMessageListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  error: string | null;
  isLoading: boolean;
}
```

Default values:

```ts
page = 1
pageSize = 20
total = 0
totalPages = 1
```

## Frontend Helper Requirements

The frontend data helper for chat messages must stop expecting a plain array.

Instead it must validate:

- `items` as `ChatMessageListItem[]`
- `page` as positive integer
- `pageSize` as positive integer
- `total` as non-negative integer
- `totalPages` as positive integer

Recommended result shape:

```ts
interface EmployeeChatMessagesResult {
  messages: ChatMessageListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  error: string | null;
  notFound: boolean;
  unauthorized: boolean;
}
```

## Table Requirements

The table must keep these columns:

1. `Timestamp`
2. `Direction`
3. `Message`
4. `Type`

### Column Interactivity

All headers must be non-sortable.

This means:

- header labels render as plain text
- no button wrappers for sorting
- no sort indicators

### Row Order

The frontend must not re-order rows locally.

Rendered order must exactly match backend order.

### Timestamp Order

Messages arrive already ordered with newest messages first.

The frontend must render them as received and must not re-sort the current page.

## Chat Summary Coordination

This pagination work applies to the messages table only.

However, the chat detail page summary must not derive chat-wide metrics from only the current page of messages.

That means:

- first message date must not be recomputed from paginated `messages`
- last message date must not be recomputed from paginated `messages`
- total/incoming/outgoing counts must come from chat summary data, not current page rows

If the page currently infers summary values from the full messages array, that behavior must be removed when pagination is implemented.

## Proxy Requirements

The Next.js employee API proxy must forward query params unchanged.

For example:

- incoming: `/api/employees/anna/chats/17/messages?page=3&pageSize=20`
- forwarded backend request: `/employees/anna/chats/17/messages?page=3&pageSize=20`

Dropping query params is not acceptable because pagination would silently break.

## Acceptance Criteria

- The messages table shows at most 20 rows.
- The frontend requests paginated backend data instead of full chat history.
- The selected messages page is preserved in the URL.
- The table renders `Total`, current page, and total pages.
- Clicking a page number loads that page from the backend.
- The messages table has no client-side sorting behavior.
- The messages table headers are visually non-sortable.
- Long-message modal behavior continues to work on paginated rows.
- Existing empty, loading, and error states continue to work inside the current chat detail page shell.
