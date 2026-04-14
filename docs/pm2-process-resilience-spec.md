# PM2 Process Resilience Specification

## 1. Goal

Ensure that pm2-managed processes survive server reboots, daemon restarts, and transient crash loops without manual intervention.

The current deployment has three gaps that make the production setup fragile:

- pm2 process list is not persisted across daemon restarts
- there is no memory ceiling, so a Puppeteer memory leak can trigger an OOM kill with no recovery
- there is no restart-loop protection, so a process that crashes on startup will restart every 5 seconds indefinitely

This specification addresses all three gaps as a single cohesive change.

## 2. Current State

The committed `ecosystem.config.cjs` defines two apps with:

```js
autorestart: true,
restart_delay: 5000,
kill_timeout: 20000, // backend
kill_timeout: 10000, // frontend
```

The deployment guide (`pm2-copy-deployment.md`) documents `pm2 save` after first start, but does not mention `pm2 startup`.

The `Makefile` `ci-run` target runs `pm2 save` only on fresh deploy, not on restart.

There are no configured values for `max_memory_restart`, `max_restarts`, or `exp_backoff_restart_delay`.

### 2.1 Observed Failure Mode

The production failure sequence observed in practice:

1. The backend process consumes increasing memory over time due to Puppeteer (headless Chrome) instances held by `whatsapp-web.js` sessions.
2. The operating system OOM killer terminates the Node process or the pm2 daemon itself.
3. pm2 daemon restarts, but finds an empty process list because `pm2 startup` was never configured.
4. No processes are restored. The application is down with no automatic recovery.
5. Manual restart fails because environment variables from `.deploy.env` are not present in the new daemon's shell environment.

## 3. Scope

This specification includes:

- pm2 system-level process persistence via `pm2 startup`
- memory-bounded process restart via `max_memory_restart`
- restart-loop protection via `max_restarts` and `exp_backoff_restart_delay`
- required changes to `ecosystem.config.cjs`
- required changes to the deployment guide and `Makefile`

This specification does not include:

- Puppeteer memory leak root-cause fix (that is a separate investigation)
- SQLite WAL checkpoint scheduling
- dependency version pinning
- monitoring or alerting infrastructure

## 4. PM2 Process Persistence

### 4.1 Problem

`pm2 save` writes the current process list to `~/.pm2/dump.pm2.json`. On its own, this file is never read again unless someone manually runs `pm2 resurrect`.

`pm2 startup` generates a platform-specific init script (systemd, upstart, launchd) that:

1. starts the pm2 daemon on boot
2. automatically calls `pm2 resurrect` to restore the saved process list

Without `pm2 startup`, a server reboot or daemon crash means zero running processes until a human intervenes.

### 4.2 Contract

The deployment must configure pm2 system-level persistence so that the saved process list is automatically restored after:

- server reboot
- pm2 daemon crash
- pm2 daemon upgrade that triggers a restart

### 4.3 Required Deployment Steps

After the first successful `pm2 start`:

```bash
pm2 startup
# pm2 prints a command with sudo — execute that command exactly
pm2 save
```

`pm2 save` must also be called after every intentional topology change:

- adding or removing an app
- changing environment variables via `--update-env`
- running `pm2 delete`

### 4.4 Makefile Changes

The `ci-run` target must call `pm2 save` on every invocation, not only on first deploy:

```makefile
ci-run:
	@if [ ! -f $(DEPLOY_ENV_FILE) ]; then \
		printf "Error: %s not found. Run 'make ci-build' first.\n" "$(DEPLOY_ENV_FILE)"; \
		exit 1; \
	fi
	set -a && . ./$(DEPLOY_ENV_FILE) && set +a && \
	if pm2 id whatsapp-monitor-backend | grep -q '[0-9]'; then \
		pm2 restart ecosystem.config.cjs --env production --update-env; \
	else \
		pm2 start ecosystem.config.cjs --env production; \
	fi
	pm2 save
```

The `ci-build` target must print a reminder about `pm2 startup` when creating a fresh deployment environment.

### 4.5 Deployment Guide Changes

The deployment guide (`pm2-copy-deployment.md`) must add a section between "Start Or Reload PM2" and "Verify" that covers `pm2 startup`.

The section must explain:

- what `pm2 startup` does
- that it only needs to run once per server
- that the output includes a command that must be copy-pasted and executed
- that `pm2 save` must follow every process list change

## 5. Memory-Bounded Restart

### 5.1 Problem

The backend process runs one or more Puppeteer (headless Chrome) instances. Each WhatsApp session holds a Chrome process in memory. Over time, memory usage grows due to:

- DOM node accumulation in long-lived Chrome pages
- Node.js heap growth from buffered message processing
- unreleased references in `whatsapp-web.js` event handlers

Without a memory ceiling, the process grows until the OS OOM killer terminates it. An OOM kill is uncontrolled — `SIGKILL` bypasses the graceful shutdown handler, so:

- `database.close()` is not called
- SQLite WAL checkpoint does not run
- WhatsApp sessions are not cleanly disconnected
- pm2 may record an abnormal exit but cannot prevent the damage

### 5.2 Contract

pm2 must proactively restart the backend process when its memory usage exceeds a configured threshold, before the operating system intervenes.

A pm2-initiated memory restart sends `SIGINT` first, waits for `kill_timeout` milliseconds, then sends `SIGKILL`. This allows the graceful shutdown handler to run in most cases.

The frontend process should also have a memory ceiling, though its risk is lower because it does not run Puppeteer.

### 5.3 Threshold Selection

The threshold must balance two concerns:

- low enough to prevent OOM kills
- high enough to avoid unnecessary restarts during normal operation

Recommended starting values:

| App | `max_memory_restart` | Rationale |
|---|---|---|
| backend | `400M` | Headless Chrome baseline is ~150-200MB per session. 400MB allows 1-2 sessions with headroom before triggering restart. Adjust based on observed usage. |
| frontend | `300M` | Next.js SSR typically stays under 200MB. 300MB provides headroom for request spikes. |

These values assume a VPS with 1-2GB total RAM. If the server has more RAM, the thresholds may be raised proportionally.

### 5.4 Ecosystem Config Changes

```js
// backend
{
  max_memory_restart: '400M',
  // ... existing fields
}

// frontend
{
  max_memory_restart: '300M',
  // ... existing fields
}
```

### 5.5 Tuning

The initial thresholds are conservative defaults. After deployment, the operator should:

1. Monitor actual memory usage with `pm2 monit` or `pm2 describe <app>`
2. Check pm2 logs for frequent memory-triggered restarts
3. Adjust thresholds upward if legitimate workloads are being interrupted
4. Adjust thresholds downward if OOM kills still occur before pm2 intervenes

If the backend consistently hits the memory ceiling within minutes of startup, the root cause is a memory leak that should be investigated separately. The memory ceiling is a safety net, not a fix.

## 6. Restart-Loop Protection

### 6.1 Problem

The current config has `autorestart: true` with a fixed `restart_delay: 5000`. If a process crashes on startup — for example because an environment variable is missing — pm2 restarts it every 5 seconds indefinitely.

This produces:

- rapid log growth (crash stack trace every 5 seconds)
- sustained CPU usage from repeated process initialization
- noise that obscures the actual root cause in logs

### 6.2 Contract

pm2 must limit how many times it will restart a process and must increase the delay between restarts when a process fails repeatedly.

After exhausting the restart budget, pm2 must stop the process and leave it in a `stopped` or `errored` state so the operator can investigate.

### 6.3 Strategy: Exponential Backoff With Restart Cap

pm2 supports two complementary mechanisms:

**`exp_backoff_restart_delay`**: When set, pm2 doubles the restart delay after each consecutive crash, starting from the configured value. The delay resets to the base value after the process runs successfully for 30 seconds. Maximum backoff is capped at 15 minutes by pm2 internally.

**`max_restarts`**: The maximum number of consecutive restarts before pm2 stops trying. The counter resets when the process stays up for at least `min_uptime` (default: 1000ms).

Using both together gives progressive backoff for transient failures and a hard stop for persistent failures.

### 6.4 Recommended Values

| Parameter | Backend | Frontend | Rationale |
|---|---|---|---|
| `exp_backoff_restart_delay` | `1000` | `1000` | Start at 1s, double on each crash (1s, 2s, 4s, 8s, ..., max 15min). Fast recovery for transient failures, slow escalation for persistent ones. |
| `max_restarts` | `15` | `15` | At exponential backoff rates, 15 restarts spans roughly 5-10 minutes of attempts before giving up. Enough for transient issues (port conflict, brief network blip) but stops before filling the disk with crash logs. |
| `min_uptime` | `10000` | `10000` | A process must run for at least 10 seconds to be considered "successfully started". This prevents the restart counter from resetting when a process crashes shortly after initialization. |

### 6.5 Interaction With `restart_delay`

When `exp_backoff_restart_delay` is set, it replaces the fixed `restart_delay` for crash-triggered restarts. The existing `restart_delay: 5000` should be removed to avoid confusion about which delay is active.

For manual restarts (`pm2 restart`), the backoff does not apply — the process starts immediately.

### 6.6 Ecosystem Config Changes

```js
// backend
{
  autorestart: true,
  exp_backoff_restart_delay: 1000,
  max_restarts: 15,
  min_uptime: 10000,
  kill_timeout: 20000,
  // remove: restart_delay: 5000,
  // ... existing fields
}

// frontend
{
  autorestart: true,
  exp_backoff_restart_delay: 1000,
  max_restarts: 15,
  min_uptime: 10000,
  kill_timeout: 10000,
  // remove: restart_delay: 5000,
  // ... existing fields
}
```

### 6.7 Operator Recovery

When a process reaches the `max_restarts` limit:

1. pm2 marks the process as `errored` or `stopped`
2. `pm2 status` shows the process is not running
3. the operator must:
   - check logs: `pm2 logs whatsapp-monitor-backend --lines 100`
   - fix the root cause (missing env var, broken dependency, corrupted state)
   - restart manually: `pm2 restart whatsapp-monitor-backend`

The restart counter resets on a successful manual restart.

## 7. Combined Ecosystem Config

After applying all three changes, the full `ecosystem.config.cjs` apps section becomes:

```js
apps: [
  {
    name: 'whatsapp-monitor-backend',
    cwd: repoRoot,
    script: 'dist/src/server.js',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    exp_backoff_restart_delay: 1000,
    max_restarts: 15,
    min_uptime: 10000,
    max_memory_restart: '400M',
    kill_timeout: 20000,
    time: true,
    env_production: backendProductionEnv
  },
  {
    name: 'whatsapp-monitor-frontend',
    cwd: frontendRoot,
    script: './node_modules/next/dist/bin/next',
    args: 'start --port 3051',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    exp_backoff_restart_delay: 1000,
    max_restarts: 15,
    min_uptime: 10000,
    max_memory_restart: '300M',
    kill_timeout: 10000,
    time: true,
    env_production: frontendProductionEnv
  }
]
```

## 8. Acceptance Criteria

The implementation is complete when all of the following are true:

1. `pm2 startup` is documented as a required one-time step in the deployment guide
2. `pm2 save` is called after every process list mutation in the `Makefile` `ci-run` target
3. `ecosystem.config.cjs` includes `max_memory_restart` for both apps
4. `ecosystem.config.cjs` includes `exp_backoff_restart_delay`, `max_restarts`, and `min_uptime` for both apps
5. the fixed `restart_delay` is removed from both apps
6. after a simulated server reboot, pm2 automatically restores both processes without manual intervention
7. when the backend exceeds the memory threshold, pm2 restarts it with `SIGINT` before OOM
8. when the backend crashes on startup 15 consecutive times, pm2 stops restarting it and leaves it in an errored state
9. after a transient crash, the restart delay increases exponentially (1s, 2s, 4s, ...) instead of staying fixed at 5s
10. `pm2-copy-deployment.md` is updated with the `pm2 startup` section

## 9. Delivery Order

1. Update `ecosystem.config.cjs` with the resilience parameters.
2. Update `Makefile` `ci-run` to always call `pm2 save`.
3. Update `pm2-copy-deployment.md` with the `pm2 startup` section.
4. Deploy and run `pm2 startup` on the server.
5. Verify with `pm2 save` followed by `sudo reboot`.
