# User Create/Delete Specification

## Scope

Implement two product flows:

1. Create a new user from a single required name field.
2. Delete an existing user from the UI.

The codebase should keep the existing internal domain name `employee`. UI copy may continue to use `User`, but backend types, routes, and repositories should stay in the `employee` namespace to avoid a wide refactor.

## Current State

- Backend routing already exposes `POST /employees` and `DELETE /employees/:code`, and the whole system uses `code` as the stable identifier.
- `POST /employees` currently requires `code` in the request body and then starts a WhatsApp session if `isActive` is true.
- Repository defaults a newly created employee to `isActive = true` when the caller does not set it explicitly.
- The database schema already supports a partially configured employee: `display_name`, `phone_number`, and `session_dir` are nullable.
- The dashboard is read-only today. The employee detail page supports `PATCH` and WhatsApp session actions, but not delete.
- The Next.js proxy only supports `GET` and `PATCH` for `/api/employees/[code]`.

This means the current create flow is incompatible with "create by name only": without a phone number, automatic session startup would fail.

Detailed frontend implementation requirements are defined separately in:

- `docs/frontend-user-create-delete-spec.md`

## Goals

- The create flow must require only a name.
- The system must generate and persist an immutable internal `code`.
- A freshly created user must be safe to create without a phone number or WhatsApp session.
- Delete must be available from the frontend and must fully remove the user together with chats and session data.
- Existing edit and WhatsApp activation flows must keep working after the change.

## Non-Goals

- No schema rename from `employee` to `user`.
- No editable `code` field after creation.
- No bulk create or bulk delete.

## Functional Requirements

### Create User

- Entry point: dashboard page.
- User input: one required text field labeled `Name`.
- The submitted name maps to backend field `displayName`.
- The backend generates `code`; the user never types it.
- A newly created employee must be stored with:
  - `displayName = <submitted name>`
  - `code = <generated unique code>`
  - `phoneNumber = null`
  - `sessionDir = null`
  - `isActive = false`
- The backend must not start a WhatsApp session during create.
- After successful creation, the frontend should navigate to `/employees/[code]` so the operator can continue setup.

### Delete User

- Entry point: main dashboard table.
- The user must confirm deletion in a destructive confirmation step.
- Delete continues to use `DELETE /employees/:code`.
- If the employee has a runtime WhatsApp session, the backend must stop it before deleting the record.
- Delete must remove the employee record, all related chats, and stored WhatsApp session data.
- If deletion succeeds, the frontend stays on `/` and refreshes the list.

## API Contract

### Backend `POST /employees`

New request contract:

```json
{
  "displayName": "Anna Petrova"
}
```

Rules:

- `displayName` is required.
- `displayName` must be a string.
- After trimming, `displayName` must not be empty.
- MVP behavior should reject `code`, `phoneNumber`, `isActive`, and `sessionDir` in this route to keep the contract explicit. If backward compatibility is needed, accept them only temporarily and ignore them in the UI flow.

Success response:

- Status: `201`
- Body: existing serialized employee payload, including generated `code`

Validation errors:

- `400` with stable public error messages such as:
  - `displayName is required`
  - `displayName must be a string`

Server errors:

- `500 Failed to create employee`
- No create-time WhatsApp startup errors should be possible in the new flow because create no longer starts sessions.

### Backend `DELETE /employees/:code`

Request contract stays unchanged.

Success response:

- Status: `204`
- Empty body

Business error:

- `404 Employee not found: <code>`

Server error:

- `500 Failed to delete employee`

## Generated Code Rules

`code` remains the immutable primary key for routes, repository lookups, and session ownership. The create flow changes only who generates it.

### Normalization

Given `displayName`, build `code` using this algorithm:

1. Trim leading and trailing whitespace.
2. Collapse internal whitespace to single spaces.
3. Transliterate Cyrillic characters to Latin equivalents.
4. Lowercase the result.
5. Replace whitespace and punctuation runs with `-`.
6. Remove characters outside `[a-z0-9-]`.
7. Collapse repeated hyphens.
8. Trim hyphens from both ends.
9. If the result is empty, use fallback `user`.

Examples:

- `Anna` -> `anna`
- `Anna Petrova` -> `anna-petrova`
- `  Anna   Petrova  ` -> `anna-petrova`
- `Anna/Petrova` -> `anna-petrova`
- `Anna 2` -> `anna-2`
- `Anna-Petrova` -> `anna-petrova`
- `Anna_Petrova` -> `anna-petrova`
- `Anna (Sales)` -> `anna-sales`
- `Anna & Bob` -> `anna-bob`
- `!!!` -> `user`
- `Анна Петрова` -> `anna-petrova`

### Uniqueness

The generated code must be unique.

Allocation rule:

- First attempt: `<base>`
- Next attempts: `<base>-2`, `<base>-3`, `<base>-4`, ...

Examples:

- existing `anna`, create `Anna` -> `anna-2`
- existing `anna`, `anna-2`, create `Anna` -> `anna-3`

Race handling:

- The controller should still handle a repository unique-constraint failure as a concurrent create race.
- On unique conflict during create, regenerate the next available suffix and retry a small bounded number of times before returning `409` or `500`.

## Backend Implementation Plan

### Controller Changes

Update `src/controllers/employees-controller.ts`:

- Replace the current create payload parser with a create-by-name parser.
- Generate `code` on the server before calling `employees.create(...)`.
- Pass explicit create input:
  - `code`
  - `displayName`
  - `isActive: false`
  - `phoneNumber: null`
  - `sessionDir: null`
- Remove create-time `sessionManager.startSession(...)` from this route.
- Keep the existing serialized response shape.
- Remove the pre-delete chat conflict guard and let delete proceed for employees with chats.
- Keep stop-session and session-storage cleanup before deleting the employee row.

Recommended extraction:

- add a dedicated helper such as `src/utils/employee-code.ts`
- keep parsing/validation logic separate from code-generation logic

### Repository Changes

No schema migration is required.

Repository changes should stay minimal:

- Keep `findByCode(...)` and `create(...)`.
- Prefer implementing uniqueness resolution in the controller or a helper that can call `employees.findByCode(...)`.
- Do not rely on repository default `isActive = true` for UI-created employees; the create controller should always pass `isActive: false` explicitly.

### Delete Rollback Correction

While touching delete behavior, align rollback with runtime reality:

- current delete already checks `sessionManager.getSessionHealth(code)` and stops the runtime session when `hasRuntimeSession` is true
- current SQLite schema already has `ON DELETE CASCADE` from `employees` to `chats` and `chat_aliases`
- rollback currently restarts only when `existingEmployee.isActive` is true

That is too narrow because a runtime session may exist even when persisted `isActive` is false.

Required change:

- if delete stopped a runtime session and the employee record was not deleted, rollback should restart the session based on the pre-delete runtime state, not on persisted `isActive`

This keeps delete consistent with the existing session-health model and avoids leaving an inactive employee without the runtime session that existed just before the failed delete.

## Frontend Companion Spec

Detailed frontend requirements, proxy routes, UI interactions, and frontend tests are defined in:

- `docs/frontend-user-create-delete-spec.md`

## Test Plan

### Backend Unit/Controller Tests

Add tests for:

- create with `{ displayName: 'Anna' }` returns `201`, generated `code = 'anna'`, `isActive = false`
- create does not call `sessionManager.startSession`
- create trims whitespace in `displayName`
- create rejects missing or empty `displayName`
- create generates suffixes for duplicates: `anna`, `anna-2`, `anna-3`
- create transliterates Cyrillic names
- delete removes an employee even when chats exist
- delete removes related chats and aliases
- delete rollback restarts a previously running runtime session even when stored `isActive` was `false`

### App/Route Tests

Add tests for:

- mounted Express app accepts `POST /employees` with name-only payload
- mounted Express app returns created employee with generated code
- mounted app delete behavior returns `204`, `404`, and `500` correctly
- mounted app delete removes employees with existing chats

## Acceptance Criteria

- A user can be created from the dashboard with only a name.
- The backend generates a unique immutable `code`.
- Newly created users are inactive and have no phone/session data.
- Creating a user never starts WhatsApp automatically.
- A user can be deleted from the UI.
- Delete removes the user even when chats exist.
- Delete stops runtime WhatsApp sessions before deletion.
- Delete removes the user's chats and chat aliases from the database.
- Delete removes stored WhatsApp session data.
- Failed delete rollback restores the runtime session when one existed before the attempt.
- Existing employee edit and WhatsApp activation flows continue to work.
