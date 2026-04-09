# Current Changes Review

Date: 2026-04-07

## What Changed

The current uncommitted work is a coherent feature set around stored employee chats and message history.

- Backend:
  - adds additive SQLite schema changes for richer `chats` metadata
  - introduces a new `messages` table and `messages` repository
  - persists live WhatsApp messages with stable external message IDs
  - exposes `GET /employees/:code/chats`
  - exposes `GET /employees/:code/chats/:chatRecordId/messages`
- Frontend:
  - replaces the employee chats placeholder with a real analytics table
  - adds proxy routes for employee chats and chat messages
  - adds a dedicated employee chat detail page with message history
- Dev tooling:
  - adds `scripts/reset-dev-data.ts`
  - adds `npm run dev:seed`
  - changes the Makefile startup flow

## Review Notes

### 1. Makefile regression

`make dev` is still documented as the normal startup command, but the actual recipe now lives under `up`.

Current effect:

- `make dev` succeeds with "Nothing to be done for 'dev'"
- backend and frontend do not start

Recommended follow-up:

- restore `dev` as the real startup target, or
- rename the public command everywhere consistently and remove the stale `dev` contract

### 2. Chat detail history is presented as complete when it is not guaranteed to be complete

The backend currently caps chat message reads at `10_000` rows. The frontend detail page then derives "First Message At" from the fetched message array and presents it as a chat-level summary metric.

Current effect:

- long chats may show only the newest slice of history
- "First Message At" can be incorrect for older conversations
- the UI does not warn that the message list may be truncated

Recommended follow-up:

- add pagination or cursoring for stored messages, or
- explicitly define the endpoint as "latest N messages"
- if the endpoint remains bounded, add truncation messaging in the UI
- move first/last-message summary metrics to server-side aggregates instead of deriving them from a partial page

## Overall Comment

The implementation direction is good: schema migration, repository layer, API, proxy routes, and UI line up with each other and the new tests cover the main paths well.

The main follow-up work is not about rethinking the feature. It is about:

- restoring the expected developer entrypoint
- making the chat-detail contract honest for long histories
