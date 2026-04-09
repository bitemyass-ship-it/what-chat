# Frontend Specification: Employee Chats Table Pagination

## Scope

Implement pagination in the existing employee chats table.

This document describes only the frontend behavior for the employee chats table.

The pagination scope must:

1. show only 20 chat rows per page
2. read paginated data from backend
3. render pagination controls under the table
4. disable all client-side sorting
5. rely on backend order for date-based row ordering

This specification does not cover chat detail messages.

## Related Backend Contract

The frontend depends on a paginated backend endpoint:

- `GET /employees/:code/chats?page=1&pageSize=20`

Successful `200 OK` response shape must be:

```ts
interface GetEmployeeChatsResponse {
  items: EmployeeChatListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
```

Where:

```ts
interface EmployeeChatListItem {
  chatRecordId: number;
  displayName: string | null;
  phoneNumber: string | null;
  rawChatLabel: string;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  totalMessages: number;
  incomingMessages: number;
  outgoingMessages: number;
}
```

Error responses follow the existing employee API style:

- `404` for unknown employee with JSON body containing `error`
- `400` for invalid pagination params with JSON body containing `error`
- `5xx` for backend failures with JSON body containing `error`

## Current State

- The chats tab already exists in the employee page.
- The chats table already renders data via `@tanstack/react-table`.
- The current table expects a plain array response.
- The current table supports client-side sorting.
- The current table has no pagination footer.

## Goals

- Replace full-table loading with server-side pagination.
- Keep the existing analytics-oriented table design.
- Remove client-side sorting entirely.
- Show a clear, compact pagination footer.
- Keep the page read-focused and stable.

## Non-Goals

- No client-side sorting by any column.
- No page-size switcher.
- No filters.
- No search.
- No infinite scrolling.
- No chat detail message pagination in this scope.

## Functional Requirements

### Entry Point

- The feature remains inside the existing employee detail page `Chats` tab.
- The table must still render inside the current chats card.
- The feature must work for the existing employee page route.

### Data Loading

The frontend must request chats with pagination params:

- `page`
- `pageSize`

For this scope:

- `pageSize` is always `20`

Example request:

- `/api/employees/anna/chats?page=2&pageSize=20`

### URL State

The current chats page must be reflected in the page URL.

Recommended shape:

- `/employees/anna?page=3`

or another existing employee-page-compatible query param strategy if a tab-specific param is already preferred.

Requirements:

- reloading the page keeps the selected chats page
- browser back/forward preserves the selected chats page
- direct navigation to a paginated URL opens the correct chats page

### Table Rows Per Page

- The table must render at most `20` rows per page.
- The table must never render more rows than the backend returned for the current page.

### Sorting Behavior

All client-side sorting must be removed.

This means:

- column headers are not clickable for sorting
- no sorting arrows
- no sorting state in component state
- no `getSortedRowModel()` usage for chats table behavior

The frontend must trust backend ordering as final.

### Pagination Footer

A pagination footer must be rendered under the chats table when needed.

It must show:

- `Total: N`
- `Page X of Y`
- page number buttons

Example:

- `Total: 137`
- `Page 2 of 7`
- `1 2 3 4 5 6 7`

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

Either behavior is acceptable, but hidden is preferred to reduce noise.

### Empty State

If `total = 0`:

- keep the existing table shell
- show the current empty-state copy

If `total > 0` and `items = []` because the current page is out of range:

- keep the table shell
- show a neutral page-level empty state

Recommended copy:

- `No chats on this page`

### Loading State

The chats tab must support loading on:

- initial load
- page change

Loading behavior should:

- preserve the card shell
- preserve the table layout
- avoid aggressive layout jumps

The current skeleton approach can be reused.

### Error State

If paginated chats data fails to load:

- show a compact inline error inside the chats card
- do not break the entire employee page

## Data Contract For Frontend State

Recommended state shape:

```ts
interface EmployeeChatsState {
  chats: EmployeeChatListItem[];
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

The frontend data helper for chats must stop expecting a plain array.

Instead it must validate:

- `items` as `EmployeeChatListItem[]`
- `page` as positive integer
- `pageSize` as positive integer
- `total` as non-negative integer
- `totalPages` as positive integer

Recommended result shape:

```ts
interface EmployeeChatsResult {
  chats: EmployeeChatListItem[];
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

1. `Chat`
2. `Last Message At`
3. `Last Message Preview`
4. `Total Messages`
5. `Incoming`
6. `Outgoing`
7. `Open`

### Column Interactivity

All headers must be non-sortable.

This means:

- header labels render as plain text
- no button wrappers for sorting
- no sort indicators

### Row Order

The frontend must not re-order rows locally.

Rendered order must exactly match backend order.

### Open Action

The `Open` button behavior remains unchanged:

- label exactly `Open`
- navigates to `/employees/[code]/chats/[chatRecordId]`
- opens in a new tab
- uses `target="_blank"` and `rel="noreferrer"`

## Proxy Requirements

The Next.js employee API proxy must forward query params unchanged.

For example:

- incoming: `/api/employees/anna/chats?page=3&pageSize=20`
- forwarded backend request: `/employees/anna/chats?page=3&pageSize=20`

Dropping query params is not acceptable because pagination would silently break.

## Acceptance Criteria

- The chats table shows at most 20 rows.
- The frontend requests paginated backend data instead of a full list.
- The chats page number is preserved in the URL.
- The table renders `Total`, current page, and total pages.
- Clicking a page number loads that page from the backend.
- The chats table has no client-side sorting behavior.
- The chats table headers are visually non-sortable.
- Existing empty, loading, and error states continue to work inside the current employee page shell.
