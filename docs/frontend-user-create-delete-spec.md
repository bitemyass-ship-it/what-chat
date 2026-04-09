# Frontend Specification: User Create/Delete

## Scope

Implement two frontend flows on the main dashboard:

1. create a new user from a single required name field
2. delete an existing user directly from the dashboard table

This document describes only the Next.js frontend, client interactions, and frontend proxy routes.

## Related Backend Contract

The frontend must use the existing backend employee API contract:

- `POST /employees`
- `DELETE /employees/:code`

Backend-side implementation details are described separately in:

- `docs/backend-employee-create-delete-spec.md`

## Current State

- The home page is rendered by `frontend/src/ui/Pages/Home/Home.tsx`.
- The main table is implemented in `frontend/src/ui/Pages/Home/components/UserTable.tsx`.
- Table rows are rendered by `frontend/src/ui/Pages/Home/components/UserItem.tsx`.
- The dashboard is currently read-only.
- The proxy route `frontend/src/app/api/employees/[code]/route.ts` supports `GET` and `PATCH`, but not `DELETE`.
- There is no `frontend/src/app/api/employees/route.ts` yet.
- The codebase already has a custom modal pattern in `EmployeeWhatsappSessionModal`, so this feature should reuse the same plain React/Tailwind approach instead of introducing a modal library.

## Goals

- Add a visible `Create user` action on the main page.
- Add a dedicated delete action column to the employee table.
- Use modal flows for both create and delete.
- Send same-origin requests through Next.js API routes.
- Keep the current visual language and avoid introducing new UI dependencies for icons or modals.

## Functional Requirements

### Create User

- Entry point: main dashboard page.
- Location: `UserTable` header area.
- Primary action label: `Create user`.
- Clicking the action opens a modal with one required field: `Name`.
- The form must submit only one field to the proxy:

```json
{
  "displayName": "Anna Petrova"
}
```

- Input should be trimmed before submit.
- Empty or whitespace-only values must be blocked on the client before the request is sent.
- Submit on Enter is allowed.
- While the request is in flight:
  - disable submit
  - disable close/cancel only if needed to prevent inconsistent state
  - prevent duplicate submissions
- On `201`, parse the returned employee payload and navigate to `/employees/[code]`.
- On backend validation error, keep the modal open and show the backend error message.
- On `500` or `502`, keep the modal open and show a stable generic error.
- If the success response payload is malformed and does not contain a valid employee, treat it as an error, not as success.
- The empty state on the main page must show the same `Create user` action instead of telling the user to create employees manually through the backend.

### Delete User

- Entry point: main dashboard table.
- Add one trailing action column to `UserTable`.
- Each row must render an icon-only delete button.
- The button should use a trash/bin icon.
- Do not add a new icon dependency just for this action; use inline SVG or a local icon component.
- The button must have an accessible label such as `Delete user anna`.
- Clicking the button opens a destructive confirmation modal.
- The modal must clearly state that deletion is irreversible.
- The modal must explicitly warn that the action removes:
  - the user
  - related chats
  - stored WhatsApp session data
- The modal must show the employee display name and immutable `code`.
- The operator must manually type `DELETE` before the destructive confirm button becomes enabled.
- Confirmation is case-insensitive:
  - `DELETE`
  - `delete`
  - `Delete`
  - any other letter-case variation
- Comparison should use trimmed input and case-insensitive matching.
- While the delete request is in flight:
  - disable confirm
  - prevent duplicate submissions
- On `204`, close the modal and refresh the dashboard list on `/`.
- On `404`, close the modal and refresh the dashboard list.
- On `500` or `502`, keep the modal open and show a stable generic error.
- Delete actions must not interfere with the existing row content, especially the `code` link to `/employees/[code]`.

## Proxy Layer

Add or update same-origin Next.js routes:

- add `frontend/src/app/api/employees/route.ts` with `POST`
- extend `frontend/src/app/api/employees/[code]/route.ts` with `DELETE`

Proxy behavior:

- forward JSON body as-is
- preserve backend status code
- preserve backend response body
- return `502` only for proxy/network failures

## Suggested File Changes

- `frontend/src/ui/Pages/Home/components/UserTable.tsx`
- `frontend/src/ui/Pages/Home/components/UserItem.tsx`
- new modal components under `frontend/src/ui/Pages/Home/components/`
- `frontend/src/app/api/employees/route.ts`
- `frontend/src/app/api/employees/[code]/route.ts`

## Implementation Notes

- Reuse the existing custom modal approach already used in `EmployeeWhatsappSessionModal`.
- Keep the current design language of the dashboard instead of introducing a visually unrelated modal or button style.
- The delete button should be compact and icon-only, but still keyboard accessible.
- Prefer local component state inside the home table flow for modal visibility and pending/error states.
- Use `router.push('/employees/[code]')` after successful create.
- Use `router.refresh()` after successful delete.
- The create and delete flows should not require a full page reload.

## UI Copy

- UI label: `Name`
- Stored field: `displayName`
- Internal ID label: `Code` or `User ID`
- The create form must never expose `code` as editable input.

## Error Handling

### Create

- Empty name: block on client and expect backend `400` as a fallback.
- Backend validation error: show exact backend message.
- Network/proxy failure: show stable generic message.
- Invalid success payload: show contract error and do not navigate.

### Delete

- Confirmation remains disabled until the typed value matches `DELETE` case-insensitively.
- Network/proxy failure: keep modal open and show stable generic message.
- Invalid success payload is not relevant for `204`, but any unexpected non-empty malformed success handling should still be treated as a failure, not success.
- Do not remove the row optimistically before a successful response.

## Test Plan

Add or update frontend tests for:

- main page renders a visible `Create user` action
- create button opens a modal
- create modal submits only `displayName`
- create success navigates to `/employees/[code]`
- create error keeps the modal open and shows backend text
- empty state still renders the create action
- employee table renders a dedicated delete action column
- each row renders an icon-only delete button with an accessible label
- clicking delete opens a destructive modal
- delete confirm stays disabled until `DELETE` is typed
- delete confirm accepts `DELETE` in any letter case
- successful delete refreshes the dashboard list
- failed delete keeps the modal open and shows an error
- `frontend/src/app/api/employees/route.ts` forwards `POST`
- `frontend/src/app/api/employees/[code]/route.ts` forwards `DELETE`

## Acceptance Criteria

- The main page shows a visible `Create user` button.
- Clicking `Create user` opens a modal with one required `Name` field.
- Successful create sends `POST /api/employees` and navigates to `/employees/[code]`.
- The employee table shows a dedicated delete icon column.
- Clicking the delete icon opens a destructive confirmation modal.
- Delete confirm stays disabled until the operator types `DELETE`.
- `DELETE` confirmation works in any letter case.
- Successful delete sends `DELETE /api/employees/[code]`, closes the modal, and refreshes the list.
- The frontend uses same-origin proxy routes for both create and delete.


 Отдельные комментарии от Бэкэнд разработчика.

 Для фронтенда

POST /employees
Тело запроса: { "displayName": "Anna Petrova" }
displayName обязателен, должен быть строкой и после trim() не может быть пустым.
Нельзя отправлять поля code, phoneNumber, isActive, sessionDir. На них backend вернет 400.
Успех: 201 и обычный employee object:
code генерируется на backend, isActive = false, phoneNumber = null, sessionDir = null.
Backend сам генерирует уникальный code: например anna, anna-2, anna-3.
Create больше не стартует WhatsApp session автоматически.
DELETE /employees/:code
Успех: 204 без body.
Если employee не найден: 404 { "error": "Employee not found: <code>" }
Если внутренняя ошибка удаления: 500 { "error": "Failed to delete employee" }
Delete теперь разрешен даже если у employee есть чаты: backend удалит employee, связанные chats, chat_aliases и session storage.