# Structured File Logging Specification

## 1. Goal

Add production logging that writes structured JSON lines into separate files by category, so the operator can browse each log type independently without parsing a single combined stream.

The implementation must not introduce external logging libraries. The existing `Logger` interface and PM2 stdout/stderr capture remain intact. File logging is an additional output channel, not a replacement.

## 2. Current State

The backend logger (`src/utils/logger.ts`) wraps `console.info`, `console.warn`, and `console.error`. All output goes to stdout/stderr. PM2 captures this into:

- `~/.pm2/logs/whatsapp-monitor-backend-out.log`
- `~/.pm2/logs/whatsapp-monitor-backend-error.log`

There is no:

- structured JSON output format
- HTTP request/response logging
- error middleware for unhandled route errors
- process health or memory logging
- separation of log streams by category

## 3. Scope

This specification includes:

- a structured JSON line format for all log output
- four separate log files by category
- an HTTP request logging middleware
- an error handling middleware
- periodic process health snapshots
- a configurable log directory with a production path contract
- log rotation strategy

This specification does not include:

- replacing the `Logger` interface
- adding Winston, Pino, Bunyan, or any other logging library
- centralized log aggregation or shipping
- frontend process logging (frontend logs remain PM2-only)

## 4. Log Categories And Files

All log files live in a single configurable directory. Each category gets its own file.

| Category | File name | What goes in it |
|---|---|---|
| **http** | `http.log` | One line per HTTP request/response: method, url, status, duration, IP |
| **error** | `error.log` | Application errors, unhandled route errors, uncaught exceptions, unhandled rejections |
| **app** | `app.log` | Business logic: session lifecycle, database events, sync scheduler, auth failures, bootstrap events |
| **health** | `health.log` | Periodic process snapshots: RSS memory, heap used/total, uptime, active session count |

### 4.1 Routing Rules

Every log entry goes to exactly one file based on its category:

- HTTP request middleware always writes to `http.log`
- `logger.error(...)` calls write to both `error.log` and `app.log`
- `logger.info(...)` and `logger.warn(...)` calls write to `app.log`
- The periodic health timer writes to `health.log`
- Uncaught exceptions and unhandled promise rejections write to `error.log`

### 4.2 Console Output

All entries are also written to `console.*` as they are today, so PM2 combined logs continue to work. The console output switches to the same JSON line format as the files.

## 5. Log Line Format

Every line in every file is a self-contained JSON object followed by a newline (`\n`). No multi-line entries.

### 5.1 Common Fields

Every log line must include:

```json
{
  "timestamp": "2026-04-15T14:30:00.123Z",
  "level": "info",
  "category": "app",
  "pid": 12345,
  "message": "Human-readable summary"
}
```

| Field | Type | Description |
|---|---|---|
| `timestamp` | string | ISO 8601 UTC, millisecond precision |
| `level` | string | `"info"`, `"warn"`, or `"error"` |
| `category` | string | `"http"`, `"error"`, `"app"`, or `"health"` |
| `pid` | number | `process.pid` |
| `message` | string | Short human-readable description |

### 5.2 HTTP Log Fields

Additional fields for `http.log`:

```json
{
  "timestamp": "2026-04-15T14:30:00.123Z",
  "level": "info",
  "category": "http",
  "pid": 12345,
  "message": "GET /employees 200 45ms",
  "method": "GET",
  "url": "/employees",
  "status": 200,
  "durationMs": 45,
  "ip": "127.0.0.1",
  "contentLength": 1234,
  "userAgent": "Mozilla/5.0..."
}
```

Requests that result in 4xx/5xx are logged at the same level (`"info"`) in `http.log`. The error details go to `error.log` via the error middleware, not duplicated in the HTTP log.

### 5.3 Error Log Fields

Additional fields for `error.log`:

```json
{
  "timestamp": "2026-04-15T14:30:00.123Z",
  "level": "error",
  "category": "error",
  "pid": 12345,
  "message": "WhatsApp session restore failed",
  "error": "ECONNREFUSED",
  "stack": "Error: ECONNREFUSED\n    at ...",
  "context": {
    "employeeCode": "anna"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `error` | string | Error message string |
| `stack` | string or null | Stack trace when available. Single string with `\n` separators, not an array. |
| `context` | object or null | Structured metadata passed from the call site |

### 5.4 App Log Fields

`app.log` entries carry the same `meta` object that existing `logger.info/warn/error` calls already pass:

```json
{
  "timestamp": "2026-04-15T14:30:00.123Z",
  "level": "info",
  "category": "app",
  "pid": 12345,
  "message": "Session activity sync pass finished",
  "event": "session_activity_sync_finished",
  "durationMs": 320,
  "trigger": "interval"
}
```

The existing `meta` object is spread into the log line as top-level fields. No nesting under a `meta` key.

### 5.5 Health Log Fields

```json
{
  "timestamp": "2026-04-15T14:30:00.123Z",
  "level": "info",
  "category": "health",
  "pid": 12345,
  "message": "Process health snapshot",
  "uptimeSeconds": 3600,
  "memory": {
    "rss": 157286400,
    "heapUsed": 45678912,
    "heapTotal": 67108864,
    "external": 1234567
  },
  "memoryMb": {
    "rss": 150.0,
    "heapUsed": 43.6,
    "heapTotal": 64.0
  }
}
```

The `memoryMb` object provides pre-computed megabyte values for quick human scanning. The `memory` object provides exact byte values for programmatic consumption.

## 6. Log Directory Configuration

### 6.1 Environment Variable

```
LOG_DIR=<path>
```

### 6.2 Resolution Rules

| Environment | `LOG_DIR` value | Resolved path |
|---|---|---|
| development | not set | `<projectRoot>/logs` |
| development | relative path | `<projectRoot>/<LOG_DIR>` |
| development | absolute path | `<LOG_DIR>` |
| production | not set | Error: `LOG_DIR is required for production` |
| production | relative path | Error: `LOG_DIR must be an absolute path for production` |
| production | absolute path | `<LOG_DIR>` |

The resolution follows the same pattern as `WHATSAPP_DATABASE_PATH` and `WHATSAPP_SESSION_DIR`.

### 6.3 Directory Creation

The logger must create the log directory on startup if it does not exist (`fs.mkdirSync(logDir, { recursive: true })`).

### 6.4 Ecosystem Config

`ecosystem.config.cjs` must include `LOG_DIR` in the backend production environment:

```js
LOG_DIR: requirePersistentBackendPath('LOG_DIR'),
```

### 6.5 Deploy Env

`.deploy.env` must include:

```env
LOG_DIR=/opt/whatsapp-monitor/logs
```

## 7. HTTP Request Logging Middleware

### 7.1 Placement

The HTTP logging middleware must be the first middleware in the Express stack, before auth, before `express.json()`, before any route handlers.

```
httpRequestLogger  <-- new
  /health
  /ready
  authRouter
  authMiddleware
  express.json()
  employeesRouter
  handleJsonParseError
  errorLogger      <-- new
```

### 7.2 Implementation Contract

The middleware must:

1. Record `Date.now()` at the start of the request
2. Hook `response.on('finish', ...)` to capture the final status code
3. Compute `durationMs = Date.now() - startTime`
4. Write one JSON line to `http.log`

The middleware must not:

- Buffer or delay the response
- Modify the request or response objects
- Throw errors that interrupt the request pipeline

### 7.3 Filtering

All requests are logged, including `/health` and `/ready`. If health check noise becomes a problem, a future change can add a filter. For the first release, log everything.

## 8. Error Handling Middleware

### 8.1 Placement

The error middleware must be the last middleware in the Express stack, after all route handlers and after `handleJsonParseError`.

### 8.2 Implementation Contract

Express error middleware signature: `(error, request, response, next)`.

The middleware must:

1. Log the error to `error.log` with stack trace and request context (method, url, IP)
2. If the response headers have not been sent, respond with `500 Internal Server Error`
3. If the response headers have already been sent, delegate to Express default error handler via `next(error)`

### 8.3 Sensitive Data

The error middleware must not log:

- Request bodies (may contain passwords or personal data)
- The `X-User-Password` header value
- Full query strings if they may contain tokens

It must log:

- `request.method`
- `request.originalUrl` (path only, without query string if filtering is needed)
- `request.ip`
- Error message and stack trace

## 9. Process Health Logging

### 9.1 Contract

A periodic timer must log a process health snapshot to `health.log` at a fixed interval.

### 9.2 Configuration

```
LOG_HEALTH_INTERVAL_MS=<positive integer>
```

Default: `60000` (1 minute).

### 9.3 Data Sources

Each snapshot must collect:

- `process.memoryUsage()` — rss, heapUsed, heapTotal, external
- `process.uptime()` — seconds since process start

### 9.4 Lifecycle

- The health timer starts after the database is ready and the HTTP server is listening
- The health timer stops during graceful shutdown (clear the interval before closing other resources)
- The first snapshot is emitted immediately on start, then every `LOG_HEALTH_INTERVAL_MS`

### 9.5 Shutdown Integration

The health timer must be stopped as part of the graceful shutdown sequence, before the database and session teardown. Add it to `shutdownResources` in `server.ts`.

## 10. File Write Strategy

### 10.1 Write Mechanism

Each log category uses a dedicated `fs.createWriteStream` opened in append mode (`flags: 'a'`).

```ts
fs.createWriteStream(path.join(logDir, 'http.log'), { flags: 'a' });
```

Write streams are opened once at logger initialization and closed during graceful shutdown.

### 10.2 Encoding

UTF-8. Each entry is `JSON.stringify(entry) + '\n'`.

### 10.3 Error Handling

If a file write fails (disk full, permission error), the logger must:

- Print the failure to stderr (so PM2 captures it)
- Not crash the process
- Not retry the failed write
- Continue writing subsequent entries (the disk may recover)

### 10.4 Graceful Close

During shutdown, all write streams must be closed after flushing (`stream.end()`). The close should happen after all other shutdown steps complete, because shutdown itself produces log entries.

Order:

1. Stop health timer
2. Stop chat-sync scheduler
3. Stop session-activity loop
4. Close HTTP server
5. Shutdown WhatsApp sessions
6. Close database
7. Close log write streams

## 11. Log Rotation

### 11.1 PM2 Logs

Install the `pm2-logrotate` module for PM2's own stdout/stderr log files:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### 11.2 Application Log Files

For the four application log files, use the system `logrotate` utility. Create `/etc/logrotate.d/whatsapp-monitor`:

```
/opt/whatsapp-monitor/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
}
```

`copytruncate` is required because the application holds open file descriptors. It copies the current log, then truncates the original in place. No signal or restart needed.

### 11.3 No In-App Rotation

The application must not implement its own log rotation. System `logrotate` is the standard tool and the operator already knows how to configure it.

## 12. Logger Interface Changes

### 12.1 Current Interface

```ts
interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

### 12.2 Extended Interface

```ts
interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  http(entry: HttpLogEntry): void;
  health(entry: HealthLogEntry): void;
  close(): void;
}
```

New methods:

| Method | Purpose |
|---|---|
| `http(entry)` | Write to `http.log`. Called only by the HTTP request middleware. |
| `health(entry)` | Write to `health.log`. Called only by the health timer. |
| `close()` | Flush and close all write streams. Called during graceful shutdown. |

Existing `info`, `warn`, `error` methods continue to write to `app.log` (and `error` also to `error.log`). Their call sites do not change.

### 12.3 Factory Signature

```ts
interface CreateLoggerOptions {
  logDir?: string;
  env?: NodeJS.ProcessEnv;
}

const createLogger = (options?: CreateLoggerOptions): Logger;
```

When `logDir` is not resolvable (e.g., in tests where no directory is needed), the logger falls back to console-only mode with no file output.

## 13. Integration Points

### 13.1 `app.ts`

```ts
// Add httpRequestLogger as the first middleware
app.use(httpRequestLogger({ logger }));

// ... existing middleware ...

// Add errorLogger as the last middleware
app.use(errorLogger({ logger }));
```

### 13.2 `server.ts` bootstrap

```ts
const logger = createLogger({
  logDir: process.env.LOG_DIR
});

// ... existing bootstrap ...

// Start health timer after server is listening
const healthTimer = startHealthLogger({
  intervalMs: parsePositiveInteger(
    process.env.LOG_HEALTH_INTERVAL_MS,
    60000
  ),
  logger
});

// Add to graceful shutdown
const shutdown = createGracefulShutdown({
  // ... existing options ...
  healthTimer,
  logger  // logger.close() called last
});
```

### 13.3 `ecosystem.config.cjs`

Add to `backendProductionEnv`:

```js
LOG_DIR: requirePersistentBackendPath('LOG_DIR'),
LOG_HEALTH_INTERVAL_MS: process.env.LOG_HEALTH_INTERVAL_MS,
```

## 14. File Layout On Disk

After deployment with `LOG_DIR=/opt/whatsapp-monitor/logs`:

```
/opt/whatsapp-monitor/logs/
  http.log        # HTTP request log
  error.log       # Errors only
  app.log         # Application events
  health.log      # Periodic process snapshots
```

Each file grows independently. The operator can:

```bash
# Watch HTTP traffic in real time
tail -f /opt/whatsapp-monitor/logs/http.log

# Search for errors
grep '"level":"error"' /opt/whatsapp-monitor/logs/error.log

# Check memory trend
tail -20 /opt/whatsapp-monitor/logs/health.log | jq '.memoryMb.rss'

# Find slow requests
cat /opt/whatsapp-monitor/logs/http.log | jq 'select(.durationMs > 1000)'
```

## 15. Acceptance Criteria

1. The logger writes to four separate files: `http.log`, `error.log`, `app.log`, `health.log`
2. Every line in every file is valid JSON parseable by `jq`
3. Every line includes `timestamp`, `level`, `category`, `pid`, and `message`
4. All existing `logger.info/warn/error` calls write to `app.log` without call-site changes
5. `logger.error` calls write to both `app.log` and `error.log`
6. HTTP request middleware logs every request to `http.log` with method, url, status, and duration
7. Error middleware logs unhandled route errors to `error.log` with stack trace
8. Health timer writes memory and uptime snapshots to `health.log` at the configured interval
9. `LOG_DIR` is required as an absolute path in production
10. Log directory is created automatically on startup if it does not exist
11. All write streams are flushed and closed during graceful shutdown
12. Console output continues to work (PM2 combined logs are unaffected)
13. No new npm dependencies are added
14. `logrotate` config is documented for the four log files

## 16. Delivery Order

1. Extend `createLogger` with JSON line format, file write streams, and `close()` method.
2. Add `http()` and `health()` methods to the logger.
3. Create `httpRequestLogger` middleware.
4. Create `errorLogger` middleware.
5. Wire both middleware into `app.ts`.
6. Create `startHealthLogger` and wire into `server.ts` bootstrap and shutdown.
7. Add `LOG_DIR` to `ecosystem.config.cjs` and `.deploy.env` template.
8. Document `logrotate` config in the deployment guide.
