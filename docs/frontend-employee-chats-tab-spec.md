# Frontend Specification: Employee Chats Tab

## Scope

Implement the `Chats` tab inside the existing employee detail page.

This tab must:

1. show the employee's chats as an analytics-oriented table
2. use `@tanstack/react-table` as the table engine
3. keep the employee page lightweight and read-focused
4. open each chat detail page in a new browser tab via an `Open` action

This document describes only the frontend behavior, page composition, and frontend proxy/data requirements for the employee chats tab.

## Related Backend Contract

The frontend tab expects a backend endpoint that returns chats already stored in SQLite, not live WhatsApp data.

Required backend read contract:

- `GET /employees/:code/chats`

Backend integration for this tab depends on that endpoint existing.

For this frontend task, the backend `200 OK` response shape must be fixed as:

```ts
type GetEmployeeChatsResponse = EmployeeChatListItem[];
```

Error responses follow the existing employee API style:

- `404` for unknown employee with JSON body containing `error`
- `5xx` for backend failures with JSON body containing `error`

Expected usage:

- the frontend reads chats from the backend/API
- the tab does not directly talk to WhatsApp Web

Backend-side persistence and schema details are described separately in:

- `docs/backend-chat-message-database-upgrade-spec.md`
- `docs/backend-chat-message-persistence-spec.md`

## Current State

- The employee page route is `frontend/src/app/employees/[code]/page.tsx`.
- The employee page shell is rendered by `frontend/src/ui/Pages/Employee/Employee.tsx`.
- The tab switch is already present in `EmployeeEditor`.
- The `Chats` tab currently renders only `EmployeeChatsPlaceholder`.
- `@tanstack/react-table` is already installed in the frontend package.

## Goals

- Replace the placeholder chats tab with a real table.
- Keep the UI minimal and analytics-focused.
- Avoid messenger-like controls such as archived/pinned/unread actions.
- Use the chats tab only as a list/index.
- Move message reading and deeper analysis to a separate chat detail page.

## Non-Goals

- No chat composer.
- No reply/send actions.
- No WhatsApp-like message bubbles inside the chats tab.
- No recreation of the full messenger UI.
- No archived/pinned/unread management UX.

## Functional Requirements

### Entry Point

- The tab remains inside the existing employee detail page.
- The tab continues to be selected through the current `EmployeeTabs` UI.
- If the employee has no chats, the tab must still render a proper empty state instead of a placeholder-only message.

### Table Engine

- The chats list must be implemented with `@tanstack/react-table`.
- Do not build the table as a hand-written static `<table>` with manual sorting state.
- TanStack Table should own:
  - rows
  - columns
  - sorting state
  - empty-state rendering logic at the table layer

### Columns

The chats table must contain these columns:

1. `Chat`
2. `Last Message At`
3. `Last Message Preview`
4. `Total Messages`
5. `Incoming`
6. `Outgoing`
7. `Open`

#### `Chat`

- Primary value: `displayName`
- Fallback: `phoneNumber`
- Final fallback: raw chat label supplied by backend

Raw chat label means a backend-provided human-readable fallback such as:

- current canonical `chat_id`
- or another backend-selected label string suitable for UI display

The frontend must not derive this value itself from alias tables.

This cell should visually prioritize the human-readable contact label.

#### `Last Message At`

- Render formatted timestamp
- Should support descending default sort

#### `Last Message Preview`

- One-line text preview
- Truncate long content
- Empty fallback such as `No messages yet`

#### `Total Messages`

- Numeric count
- For this scope, `totalMessages` must equal `incomingMessages + outgoingMessages`
- `system` messages, if they exist in persistence, are excluded from all three counters in this list view

#### `Incoming`

- Numeric count of incoming messages

#### `Outgoing`

- Numeric count of outgoing messages

#### `Open`

- Render a text button labeled exactly `Open`
- Clicking `Open` must navigate to the chat detail page in a new browser tab
- Use `target="_blank"` and `rel="noreferrer"`

### Default Sorting

- Default sort: `Last Message At` descending
- Rows with `null` `Last Message At` sort after rows with timestamps
- Secondary stable ordering uses the rendered chat label ascending if timestamps are equal

### Empty State

If there are no chats:

- render the section header and table shell
- show a calm empty state such as `No chats available yet`
- if WhatsApp is not connected, the helper text may mention that chats appear after message ingestion

### Loading State

The tab must support a loading/skeleton state while data is being fetched.

Loading state should:

- preserve the card layout
- not shift the surrounding employee page layout aggressively

### Error State

If chat data fails to load:

- show a compact inline error inside the chats card
- do not break the entire employee page

## Data Contract For Frontend

Each row in the chats table should be backed by a shape equivalent to:

```ts
interface EmployeeChatListItem {
  chatRecordId: number;
  displayName: string | null;
  phoneNumber: string | null;
  rawChatLabel: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  totalMessages: number;
  incomingMessages: number;
  outgoingMessages: number;
}
```

Notes:

- `chatRecordId` is the route key for the detail page
- frontend should not need raw alias ids in the chats tab
- frontend should not need archived/pinned/unread fields for this scope
- `rawChatLabel` is required because the `Chat` column has a final backend fallback
- `lastMessageAt` must be an ISO 8601 UTC timestamp string, for example `2026-03-31T09:41:22.000Z`
- frontend should parse `lastMessageAt` as UTC and format it for display
- `totalMessages`, `incomingMessages`, and `outgoingMessages` must be finite non-negative integers
- `totalMessages` is defined as `incomingMessages + outgoingMessages` for this list endpoint

The frontend must not assume any additional fields for this tab.

## Routing Requirements

The chat detail route must be:

- `frontend/src/app/employees/[code]/chats/[chatRecordId]/page.tsx`

The `Open` button in the chats table must link to:

- `/employees/[code]/chats/[chatRecordId]`

and must open in a new tab.

For this chats-tab task, generating the correct `href`, `target="_blank"`, and `rel="noreferrer"` is required.
The actual chat detail page implementation is specified separately in `docs/frontend-chat-detail-page-spec.md` and may land in parallel.

## Proxy / Data Layer Requirements

Add a same-origin proxy route for the chats list:

- `frontend/src/app/api/employees/[code]/chats/route.ts`

Required behavior:

- forward `GET`
- preserve backend status
- preserve backend response body
- return `502` only on proxy/network failure

Add a frontend lib helper, for example:

- `frontend/src/lib/chats.ts`

Suggested helper:

- `getEmployeeChats(code: string)`

Suggested helper contract:

```ts
interface EmployeeChatsResult {
  chats: EmployeeChatListItem[];
  error: string | null;
  notFound: boolean;
}
```

Recommended behavior:

- on `200`, parse the body as `EmployeeChatListItem[]`
- on `404`, return `notFound: true`
- on malformed payload, return a compact frontend error state
- on transport/proxy failure, return a compact frontend error state
- do not throw for expected API error cases

## Suggested File Changes

- `frontend/src/ui/Pages/Employee/components/EmployeeChatsPlaceholder.tsx`
  this placeholder should be replaced or split into a real chats tab component
- new `frontend/src/ui/Pages/Employee/components/EmployeeChatsTable.tsx`
- new `frontend/src/lib/chats.ts`
- new `frontend/src/app/api/employees/[code]/chats/route.ts`
- optional small row/cell helper components under `frontend/src/ui/Pages/Employee/components/`

## UI Composition

The chats tab should remain visually consistent with the current employee page.

Recommended composition:

- existing rounded card shell
- small section label `Chats`
- heading such as `User chats`
- concise helper text
- table card body using TanStack Table

Do not turn this tab into a dense admin grid with excessive controls.

## Visual Requirements

- Keep the established employee page style and spacing.
- Use a proper table header row.
- Numeric columns should be visually scannable.
- The `Open` action should be compact and obvious.
- The table should remain usable on narrower laptop widths.

For small screens:

- horizontal overflow is acceptable
- do not collapse into unreadable stacked cards unless later required

## Test Plan

Add or update frontend tests for:

- the chats tab renders a real table instead of placeholder copy
- the table is built with the expected columns
- default sorting is by `Last Message At` descending
- rows with `null` `Last Message At` sort last
- empty state renders when there are no chats
- error state renders when the chats endpoint fails
- the `Chat` cell falls back from `displayName` to `phoneNumber` to `rawChatLabel`
- each row renders an `Open` action
- `Open` links to `/employees/[code]/chats/[chatRecordId]`
- `Open` uses new-tab semantics
- the proxy route forwards `GET /employees/:code/chats`
- the frontend helper rejects malformed chat payloads safely

## Acceptance Criteria

- The employee detail `Chats` tab renders a TanStack table.
- The table shows only the minimal analytics-focused columns.
- No messenger-management fields such as pinned/archived/unread are exposed in the tab UI.
- Each row includes an `Open` action.
- `Open` navigates to the chat detail route in a new tab.
- The tab handles loading, empty, and error states without breaking the employee page.
