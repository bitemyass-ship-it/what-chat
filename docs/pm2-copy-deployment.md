# PM2 Copy Deployment

This repo is ready for the first-mode `pm2` deployment described in [pm2-first-mode-deployment-spec.md](/Users/yaroslavkravets/Desktop/WORK/Pet/WhatsApp%20Monitor/docs/pm2-first-mode-deployment-spec.md).

The committed process file is [ecosystem.config.cjs](/Users/yaroslavkravets/Desktop/WORK/Pet/WhatsApp%20Monitor/ecosystem.config.cjs). It starts exactly two forked processes:

- `whatsapp-monitor-backend`
- `whatsapp-monitor-frontend`

`WHATSAPP_CHAT_SYNC_ENABLED=true` is enforced in the backend process config. The remaining production values must be provided by the deploy environment.

If `AUTH_PASSWORD`, `WHATSAPP_DATABASE_PATH`, `WHATSAPP_SESSION_DIR`, or `EMPLOYEES_API_BASE_URL` are missing, or if the backend paths are relative or point inside the repo checkout, `pm2 start` and backend bootstrap will fail fast instead of falling back to checkout-local state.

## 1. Build

Choose one place to build.

Build locally before copying:

```bash
npm ci
npm --prefix frontend ci
npm run build
npm run frontend:build
```

Or copy the repo first and build on the server:

```bash
cd /opt/whatsapp-monitor
npm ci
npm --prefix frontend ci
npm run build
npm run frontend:build
```

## 2. Copy App

Example copy command:

```bash
rsync -a --exclude '.git' ./ user@server:/opt/whatsapp-monitor/
```

If you built locally, copy the built app as-is, including `dist`, `frontend/.next`, `node_modules`, and `frontend/node_modules`.

## 3. Create Persistent Data Dirs

The database and WhatsApp session storage must be on an absolute path. They can live inside the repo checkout or outside — both are supported.

Example inside the repo:

```bash
mkdir -p /opt/whatsapp-monitor/database
mkdir -p /opt/whatsapp-monitor/sessions
```

Example outside the repo:

```bash
sudo mkdir -p /var/lib/whatsapp-monitor/data
sudo mkdir -p /var/lib/whatsapp-monitor/sessions
sudo chown -R "$USER":"$USER" /var/lib/whatsapp-monitor
```

If you keep the data inside the repo checkout, avoid running `git clean -fd` as it will delete untracked files including the database and session artifacts.

## 4. Set Environment

Create a deploy env file on the server, for example `/opt/whatsapp-monitor/.deploy.env`:

```env
AUTH_PASSWORD=change-me-now
WHATSAPP_DATABASE_PATH=/opt/whatsapp-monitor/database/whatsapp-monitor.sqlite
WHATSAPP_SESSION_DIR=/opt/whatsapp-monitor/sessions
EMPLOYEES_API_BASE_URL=http://127.0.0.1:3050
```

Load it into the shell before starting or restarting `pm2`:

```bash
cd /opt/whatsapp-monitor
set -a
. ./.deploy.env
set +a
```

Optional tuning envs such as `WHATSAPP_CHAT_SYNC_INTERVAL_MS`, `WHATSAPP_CHAT_SYNC_INITIAL_DELAY_MS`, `WHATSAPP_CHAT_SYNC_EMPLOYEE_CONCURRENCY`, and `WHATSAPP_SESSION_ACTIVITY_SYNC_INTERVAL_MS` can also be exported here if you need to override the backend defaults.

## 5. Start Or Reload PM2

First deploy:

```bash
cd /opt/whatsapp-monitor
pm2 start ecosystem.config.cjs --env production
pm2 save
```

Next deploy after copying a new app version:

```bash
cd /opt/whatsapp-monitor
set -a
. ./.deploy.env
set +a
pm2 restart ecosystem.config.cjs --env production --update-env
```

## 6. Verify

Backend liveness:

```bash
curl -f http://127.0.0.1:3050/health
```

Backend readiness:

```bash
curl -f http://127.0.0.1:3050/ready
```

Frontend process:

```bash
curl -I http://127.0.0.1:3051
pm2 status
```

If `/ready` returns `503` immediately after restart, wait for the initial restore pass to finish and retry.
