# Deployment Readiness Specification: PM2 + First Mode

## 1. Goal

Prepare the application for its first production deployment under `pm2`.

For this specification, "first mode" means:

- the backend runs as a long-lived process
- the backend owns WhatsApp runtime sessions
- the backend runs an internal scheduled sync loop for available employee sessions
- the frontend runs as a separate process and reads data only through the backend API

The goal is not only to "run it with `pm2`". The goal is to make the first deployment safe enough that:

- process restarts do not wipe operational state
- SQLite data and WhatsApp session artifacts survive releases
- the backend restores only the sessions that should be restored
- a single broken session does not take the whole service down

## 2. Current State

The repository already has a good base for this deployment model:

- the backend builds to `dist/server.js`
- the frontend builds as a Next.js production app
- the backend already handles `SIGINT` and `SIGTERM`
- the SQLite path and WhatsApp session directory are configurable via environment variables
- the frontend already requires `EMPLOYEES_API_BASE_URL` in production
- the backend already exposes `GET /health`

The main gaps are:

- there is no committed `pm2` process spec
- there is no production deployment contract for environment variables and persistent directories
- bootstrap does not currently restore runtime sessions
- runtime activation through `POST /employees/:code/whatsapp-session` is not durable across restart
- the restore boundary is not explicitly tied to employee lifecycle state
- the first-mode global scheduler is not yet defined as a production-owned loop
- `GET /health` is not sufficient as a readiness contract

## 3. Scope

This specification includes:

- the production process model for `pm2`
- backend and frontend environment contracts
- persistent storage requirements
- restore semantics for runtime WhatsApp sessions
- scheduler requirements for first mode
- health, readiness, shutdown, and logging requirements
- deployment acceptance criteria

This specification does not include:

- multi-host deployment
- horizontal scaling
- `pm2` cluster mode
- reverse proxy implementation details
- distributed locking
- bot or outbound messaging features

## 4. Operating Assumptions

The first production rollout is intentionally simple:

- one server
- one backend process
- one frontend process
- one SQLite database
- one shared local filesystem for `LocalAuth`

This is important because the current architecture uses:

- SQLite as a local single-writer database
- `whatsapp-web.js` plus Puppeteer
- WhatsApp session persistence on the local filesystem

As a result:

- the backend must run in `fork` mode
- the backend must run with `instances: 1`
- the first release must not run multiple backend instances against the same database and session directory

## 5. Target Runtime Topology

Two `pm2` apps must exist.

### 5.1 Backend App

- process name: `whatsapp-monitor-backend`
- cwd: repository root
- runtime entrypoint: compiled backend server
- responsibilities:
  - SQLite connection
  - WhatsApp runtime sessions
  - internal scheduled sync loop
  - protected business API

### 5.2 Frontend App

- process name: `whatsapp-monitor-frontend`
- cwd: `frontend`
- runtime entrypoint: `next start`
- responsibilities:
  - SSR and UI rendering
  - same-origin auth routes
  - proxying requests to the backend

### 5.3 Topology Rules

- backend and frontend are separate `pm2` apps
- both apps run with `exec_mode: "fork"`
- both apps run with `instances: 1`
- the scheduler exists only inside the backend
- the frontend never talks to SQLite or WhatsApp directly

## 6. Persistent Storage Requirements

Production state must not live inside ephemeral release artifacts.

The following paths must be persistent:

- the SQLite database file
- SQLite `-wal` and `-shm` sidecar files
- the WhatsApp session directory

Minimum requirement:

- the backend process must receive an absolute `WHATSAPP_DATABASE_PATH`
- the backend process must receive an absolute `WHATSAPP_SESSION_DIR`
- both resolved paths must point outside the repository checkout

Deployment wrappers may accept relative values from `.env.ci`, but they must
resolve those values relative to the repo checkout before passing them to the
backend process. Both resolved paths must reside outside the repo checkout.
This prevents release cleanup, checkout replacement, or accidental `git clean
-fd` from deleting the database and WhatsApp session artifacts.

Example `.env.ci` values for a checkout whose parent directory is persistent:

```env
WHATSAPP_DATABASE_PATH=../data/whatsapp-monitor.sqlite
WHATSAPP_SESSION_DIR=../data/sessions
```

The deployment flow must not:

- delete those directories during release
- recreate them with different ownership unexpectedly
- switch to a new path without an explicit migration plan

## 7. Production Environment Contract

### 7.1 Required Backend Environment

- `NODE_ENV=production`
- `PORT=3050`
- `AUTH_PASSWORD=<non-empty>`
- `WHATSAPP_DATABASE_PATH=<absolute path>`
- `WHATSAPP_SESSION_DIR=<absolute path>`

### 7.2 First-Mode Backend Environment

The first-mode chat-sync scheduler requires its own environment contract:

- `WHATSAPP_CHAT_SYNC_ENABLED=true`
- `WHATSAPP_CHAT_SYNC_INTERVAL_MS=<positive integer>`
- `WHATSAPP_CHAT_SYNC_INITIAL_DELAY_MS=<positive integer>`
- `WHATSAPP_CHAT_SYNC_EMPLOYEE_CONCURRENCY=<positive integer>`

The existing session-activity reconciliation loop remains a separate background loop with its own configuration:

- `WHATSAPP_SESSION_ACTIVITY_SYNC_INTERVAL_MS=<positive integer>`

`WHATSAPP_CHAT_SYNC_ENABLED=false` may exist as a non-production or non-first-mode diagnostic setting, but it is outside the contract of this specification.

### 7.3 Required Frontend Environment

- `NODE_ENV=production`
- `PORT=3051`
- `EMPLOYEES_API_BASE_URL=http://127.0.0.1:3050`

The frontend must not rely on the development fallback API base URL in production.

## 8. Session Restore Contract

This section is critical.

First-mode scheduled polling is only useful if the backend restores the correct sessions after a process restart.

The restore contract must not conflict with the product's existing lifecycle model.

The current product already treats `employee.isActive` as a meaningful lifecycle signal:

- new employees are created with `isActive = false`
- changing the phone number forces `isActive = false`
- update and delete flows already use `isActive` when deciding session-related behavior

For the first release, the restore predicate must therefore include `employee.isActive`.

### 8.1 Restore Boundary

On bootstrap, the backend must consider only employees that satisfy all of the following:

- the employee exists in the database
- `employee.isActive === true`
- persisted WhatsApp session artifacts exist on disk for that employee

The backend must not restore a session when any of these is false.

This explicitly prevents a disabled employee from becoming active again after restart just because old session files still exist on disk.

Session artifacts without a matching employee record are orphaned artifacts and must be ignored.

Session artifacts for an existing employee with `isActive = false` must also be ignored.

### 8.2 Canonical Session Location Algorithm

The specification must define one canonical algorithm for locating persisted WhatsApp session storage.

That algorithm must be shared by all of the following flows:

- runtime startup
- bootstrap restore
- explicit session reset
- employee delete cleanup

The backend must not allow each flow to guess the path differently.

The canonical algorithm is:

1. If `employee.sessionDir` is a non-empty string after trimming, the canonical persisted session storage path is exactly `employee.sessionDir.trim()`.
2. Otherwise, compute `sessionKey = normalizePhoneDigits(employee.phoneNumber)`.
3. If `sessionKey` is empty, the employee has no resolvable persisted session location.
4. Otherwise, the canonical persisted session storage path is `resolveSessionStoragePath({ sessionKey })`, which resolves to `<session-base-path>/session-<sessionKey>`.

This makes `employee.sessionDir` the explicit override and normalized phone digits the default key.

The backend must implement this algorithm in one shared helper and reuse it everywhere.

The backend must not:

- derive the restore path from `employee.code`
- use one algorithm for delete and a different algorithm for start or restore
- scan the session directory with a different naming rule

The backend should also expose a shared helper for the runtime startup inputs derived from the same employee record:

- canonical persisted session storage path
- canonical default `sessionKey` when `employee.sessionDir` is not set

If `employee.sessionDir` is set, runtime startup and restore must still target that exact persisted location rather than silently falling back to the phone-based default path.

### 8.3 Runtime Activation Contract

`POST /employees/:code/whatsapp-session` must be durable across restart.

For the first release, the simplest correct contract is:

1. validate that the employee exists and is eligible for WhatsApp activation
2. persist `employee.isActive = true`
3. resolve the session location using the canonical session location algorithm
4. start or continue the runtime session against that canonical location
5. allow `LocalAuth` to persist session artifacts on disk
6. rely on the bootstrap restore predicate on the next restart

The important point is not whether the runtime start succeeds immediately. The important point is that the persisted lifecycle state says this employee is enabled for session restore and that all flows target the same persisted location.

### 8.4 Runtime Deactivation Contract

Any explicit deactivation flow must make the restore predicate false.

At minimum, it must:

- stop the runtime session if one exists
- persist `employee.isActive = false` when the employee should no longer restore
- delete persisted session files when the product intends a full reset

This applies to:

- explicit deactivation
- employee deletion
- phone-number change flows that invalidate the existing session

Cleanup and reset flows must resolve the persisted storage path through the same canonical session location algorithm.

### 8.5 Bootstrap Restore Flow

On backend startup:

1. open the database and run migrations
2. construct the HTTP app
3. start the HTTP server
4. load employees from the database
5. for each employee, evaluate the restore predicate:
   - employee exists
   - `employee.isActive === true`
   - the canonical persisted session storage path is resolvable
   - persisted session storage exists at that canonical path
6. call `startSession(employee.code)` only for employees that match the predicate, and make sure `startSession` resolves the same canonical session location
7. skip all other employees without starting a QR-driven fresh session
8. continue boot even if some restore attempts fail

Practical bootstrap loop:

1. `employees.listAll()`
2. compute the canonical session storage path for each employee using the shared resolver
3. if `employee.isActive` is `false`, log and skip
4. if the canonical path is not resolvable, log and skip
5. if the canonical path does not exist, log and skip
6. if all conditions pass, call `startSession(employee.code)`
7. collect partial failures and keep the backend process alive

Requirements:

- restore starts automatically during bootstrap
- restore depends on database state, not on a disk scan alone
- restore uses the same canonical session location algorithm as start and delete flows
- restore does not rely on legacy `WHATSAPP_EMPLOYEE_IDS`
- restore does not create a new session only because an employee exists in the database
- one failed employee restore must not terminate the whole backend process

### 8.6 Bootstrap And Manual Activation Concurrency Contract

Because the HTTP server starts before the restore pass completes, the specification must explicitly prevent a race between:

- bootstrap restore calling `startSession(employee.code)`
- manual activation through `POST /employees/:code/whatsapp-session`

The first release must solve this with an idempotent, concurrency-safe `startSession` implementation.

Required contract:

- `startSession(employee.code)` must be safe to call concurrently for the same employee
- if a start for the same employee is already in progress, additional callers must join the in-flight operation or return the same pending result instead of launching a second client initialization
- the concurrency guard must live inside the session manager, not only in the HTTP controller

Minimum implementation shape:

- a per-employee mutex, or
- a per-employee in-flight promise registry

The session manager must treat this as a core invariant, because controller-level prechecks such as `getSessionHealth()` are not sufficient to prevent races.

If the runtime model later needs it, the same guard may also expand to cover session-key conflicts, but the minimum first-release requirement is employee-level serialization of `startSession`.

This means the spec does not require:

- moving restore before `listen()`, or
- temporarily blocking session-mutating routes until restore completes

Those are valid alternatives, but they are not the chosen contract for the first release.

### 8.7 Future Option

If the product later needs to separate "employee is active in the product" from "employee session should restore on boot", then a dedicated persisted session-enabled flag can be introduced later.

That separation is not required for the first release. For the first release, `employee.isActive` is the restore lifecycle signal.

## 9. Background Loop Requirements For First Mode

The first-mode backend runs two separate periodic background loops.

They are not the same loop and must not be specified as if they were interchangeable.

### 9.1 Two-Loop Model

The backend has:

- a session-activity reconciliation loop
- a chat-sync scheduler

The session-activity reconciliation loop is the existing low-priority maintenance loop that reconciles persisted employee activity from runtime session state.

The chat-sync scheduler is the new first-mode loop that performs periodic chat ingestion and backfill work.

These loops have different responsibilities, different pacing, and different operational impact.

### 9.2 Ownership

Both loops live inside the single backend process.

As a result:

- backend instance count must remain `1`
- if the product later needs multiple backend instances, singleton background work must move to a dedicated worker model

### 9.3 Session-Activity Reconciliation Loop Contract

The session-activity reconciliation loop remains a distinct low-priority loop.

Its contract is:

- purpose: reconcile persisted employee activity from runtime WhatsApp session state
- configuration: `WHATSAPP_SESSION_ACTIVITY_SYNC_INTERVAL_MS`
- startup: initialize after the HTTP server starts
- overlap policy: never run more than one reconciliation pass at a time
- failure policy: log and continue on the next interval
- shutdown: stop scheduling new passes during graceful shutdown

This loop is not a substitute for the chat-sync scheduler.

### 9.4 Chat-Sync Scheduler Contract

The chat-sync scheduler is a separate loop with its own contract.

Its contract is:

- purpose: perform first-mode periodic chat sync and backfill
- configuration:
  - `WHATSAPP_CHAT_SYNC_ENABLED=true`
  - `WHATSAPP_CHAT_SYNC_INTERVAL_MS`
  - `WHATSAPP_CHAT_SYNC_INITIAL_DELAY_MS`
  - `WHATSAPP_CHAT_SYNC_EMPLOYEE_CONCURRENCY`
- startup: initialize only after database initialization succeeds, the HTTP server starts, and the initial restore pass has been attempted
- first tick: wait for `WHATSAPP_CHAT_SYNC_INITIAL_DELAY_MS`
- overlap policy: never run more than one chat-sync batch at a time
- failure policy: one employee failure must not fail the whole batch
- shutdown: stop scheduling new batches during graceful shutdown and allow the in-flight batch to finish or abort it with a bounded timeout

### 9.5 Chat-Sync Tick Behavior

Each chat-sync tick must:

1. select employees with active runtime sessions
2. run sync only for those employees
3. use bounded concurrency
4. keep running when one employee fails
5. emit a summary log with duration and result counts

### 9.6 No-Overlap Rules

Each loop must have its own no-overlap guard.

Specifically:

- the session-activity reconciliation loop must not start a second pass while one is already running
- the chat-sync scheduler must not start a second batch while one is already running

For the first release, `skip with warning` is sufficient for overlapping chat-sync ticks.

### 9.7 Shutdown Behavior

On `SIGTERM` or `SIGINT`, the backend must:

- stop scheduling new session-activity reconciliation passes
- stop scheduling new chat-sync batches
- allow the current chat-sync batch to finish or abort it with a bounded timeout
- then stop WhatsApp sessions and close the database

## 10. Health And Readiness Contract

### 10.1 Liveness

`GET /health` may remain the cheap liveness probe.

It must:

- return `200` when the process is alive and responsive
- avoid depending on per-session WhatsApp readiness

### 10.2 Readiness

A new endpoint is required:

- `GET /ready`

It should return `200` only when:

- the database is open
- the HTTP app is initialized
- the session-activity reconciliation loop is initialized
- the chat-sync scheduler is initialized
- the initial restore pass has completed

`/ready` must not wait for every restored session to become fully ready.

Otherwise one slow QR flow can block deployment readiness unnecessarily.

Because this specification is specifically for first-mode production, `WHATSAPP_CHAT_SYNC_ENABLED=true` is part of the readiness contract.

If an implementation supports `WHATSAPP_CHAT_SYNC_ENABLED=false` for local diagnostics or other non-first-mode scenarios, that state is outside the scope of this specification and must not be treated as "first-mode ready".

### 10.3 Readiness Payload

Minimum payload:

```json
{
  "status": "ok",
  "databaseReady": true,
  "sessionActivityLoopReady": true,
  "chatSyncSchedulerReady": true,
  "chatSyncSchedulerEnabled": true,
  "sessionRestoreCompleted": true
}
```

Useful degraded-state fields:

- session-activity loop status
- chat-sync scheduler enabled or disabled
- active runtime session count
- failed restore count

## 11. Logging Requirements

Backend logs must consistently include:

- process start
- database path
- session directory path
- restore start and restore finish
- per-employee restore failure
- session-activity loop start and finish
- session-activity loop errors
- chat-sync tick start and finish
- chat-sync tick duration
- skipped overlapping ticks
- graceful shutdown start and finish

For restore and sync logs, the backend should consistently log:

- `employeeCode`
- `runtimeStatus`
- `durationMs`
- `error`

Structured JSON logging is preferred but not required for the first release. The key requirement is consistency and machine-readability.

## 12. PM2 Requirements

### 12.1 Ecosystem File

The repository must include a committed `pm2` config file, for example:

- `ecosystem.config.cjs`

It must define both production processes.

### 12.2 Backend PM2 Config

The backend app should define at least:

- `name: "whatsapp-monitor-backend"`
- `script: "dist/server.js"`
- `cwd: <repo-root>`
- `exec_mode: "fork"`
- `instances: 1`
- `autorestart: true`
- `restart_delay`
- `kill_timeout` large enough for graceful shutdown
- `time: true`

### 12.3 Frontend PM2 Config

The frontend app should define at least:

- `name: "whatsapp-monitor-frontend"`
- `cwd: <repo-root>/frontend`
- runtime command for `next start`
- `exec_mode: "fork"`
- `instances: 1`
- `autorestart: true`
- production environment including `EMPLOYEES_API_BASE_URL`

### 12.4 Explicit Non-Requirement

The first release must not use:

- backend cluster mode
- multiple backend instances
- a shared scheduler across several Node processes

## 13. Deployment Flow Requirements

Production deployment should be two-phase.

### 13.1 Build Phase

1. install backend dependencies
2. install frontend dependencies
3. build the backend
4. build the frontend
5. validate that required environment variables are present

### 13.2 Runtime Phase

1. ensure persistent directories exist
2. ensure the deploy user has read and write access
3. start or reload `pm2` processes
4. verify backend `/health`
5. verify backend `/ready`
6. verify frontend startup and backend connectivity

`pm2` must not perform the build step on every restart.

## 14. Backup And Recovery Requirements

The first production rollout must explicitly recognize that state lives in more than SQLite.

Backups must include:

- the SQLite database file
- SQLite `-wal` and `-shm` files when backing up a live process
- the WhatsApp session directory

Without a backup of the session directory, a crash or host loss will likely force QR login again.

## 15. Acceptance Criteria

The application is ready for the first mode only if all of the following are true:

1. backend and frontend run as separate `pm2` processes
2. backend restart does not delete SQLite data or session files
3. start, restore, reset, and delete flows all use the same canonical session location algorithm: `employee.sessionDir` override first, otherwise normalized phone digits through `resolveSessionStoragePath({ sessionKey })`
4. `startSession` is concurrency-safe per employee, so bootstrap restore and manual activation cannot initialize the same employee session twice in parallel
5. after `pm2 restart whatsapp-monitor-backend`, bootstrap evaluates all employees from the database and restores sessions only when the employee exists, `employee.isActive` is `true`, and persisted session artifacts exist at that canonical path
6. one failed restore does not stop the HTTP server or block other restores
7. the session-activity reconciliation loop and the chat-sync scheduler are explicitly separate loops with separate contracts
8. the chat-sync scheduler runs only in the single backend process
9. neither loop creates overlapping runs
10. `GET /health` responds during normal process operation
11. `GET /ready` indicates that bootstrap initialization is complete and that both background loops are initialized
12. the frontend runs in production only with an explicit `EMPLOYEES_API_BASE_URL`
13. graceful shutdown completes correctly on `SIGTERM`

## 16. Suggested Delivery Order

1. Extract one shared session-location resolver from the employee record contract.
2. Make start, restore, reset, and delete flows use that same canonical resolver.
3. Add per-employee `startSession` serialization with a mutex or in-flight promise registry inside the session manager.
4. Add a bootstrap restore loop that iterates over employees from the database.
5. Make the restore predicate explicit: employee exists, `employee.isActive === true`, and persisted session storage exists at the canonical path.
6. Update WhatsApp activation so the persisted lifecycle state supports restore after restart.
7. Ensure partial restore failures do not terminate backend startup.
8. Define the two-loop runtime model explicitly: session-activity reconciliation remains separate from chat-sync scheduling.
9. Add the first-mode chat-sync scheduler with bounded concurrency and overlap protection.
10. Add `/ready` and improve production logging for both loops.
11. Add `ecosystem.config.cjs`.
12. Update the deployment documentation with exact startup instructions.

## 17. Known First-Release Limits

Even after this specification is implemented, the first release still has clear limits:

- single-host architecture
- dependence on `whatsapp-web.js` and Puppeteer
- no distributed locking
- shared-password auth remains an MVP security model

Those constraints are acceptable for the first production mode, but they must remain explicit.
