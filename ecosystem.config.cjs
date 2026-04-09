const path = require('node:path');

const repoRoot = __dirname;
const frontendRoot = path.join(repoRoot, 'frontend');

const isPathInsideDirectory = (candidatePath, directoryPath) => {
  const relativePath = path.relative(directoryPath, candidatePath);

  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
};

const requireNonEmptyEnv = (name) => {
  const value = process.env[name];

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required for pm2 production deployment`);
  }

  return value.trim();
};

const requirePersistentBackendPath = (name) => {
  const value = requireNonEmptyEnv(name);

  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path for pm2 production deployment`);
  }

  const normalizedPath = path.resolve(value);

  if (isPathInsideDirectory(normalizedPath, repoRoot)) {
    throw new Error(
      `${name} must point outside the repository checkout for pm2 production deployment`
    );
  }

  return normalizedPath;
};

const requireUrlEnv = (name) => {
  const value = requireNonEmptyEnv(name);

  try {
    return new URL(value).toString().replace(/\/+$/u, '');
  } catch (error) {
    throw new Error(
      `${name} must be a valid URL for pm2 production deployment: ${error.message}`
    );
  }
};

const pickDefined = (values) =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  );

const backendProductionEnv = pickDefined({
  NODE_ENV: 'production',
  PORT: '3050',
  AUTH_PASSWORD: requireNonEmptyEnv('AUTH_PASSWORD'),
  WHATSAPP_DATABASE_PATH: requirePersistentBackendPath('WHATSAPP_DATABASE_PATH'),
  WHATSAPP_SESSION_DIR: requirePersistentBackendPath('WHATSAPP_SESSION_DIR'),
  WHATSAPP_CHAT_SYNC_ENABLED: 'true',
  WHATSAPP_CHAT_SYNC_INTERVAL_MS: process.env.WHATSAPP_CHAT_SYNC_INTERVAL_MS,
  WHATSAPP_CHAT_SYNC_INITIAL_DELAY_MS:
    process.env.WHATSAPP_CHAT_SYNC_INITIAL_DELAY_MS,
  WHATSAPP_CHAT_SYNC_EMPLOYEE_CONCURRENCY:
    process.env.WHATSAPP_CHAT_SYNC_EMPLOYEE_CONCURRENCY,
  WHATSAPP_SESSION_ACTIVITY_SYNC_INTERVAL_MS:
    process.env.WHATSAPP_SESSION_ACTIVITY_SYNC_INTERVAL_MS
});

const frontendProductionEnv = pickDefined({
  NODE_ENV: 'production',
  PORT: '3051',
  EMPLOYEES_API_BASE_URL: requireUrlEnv('EMPLOYEES_API_BASE_URL')
});

module.exports = {
  apps: [
    {
      name: 'whatsapp-monitor-backend',
      cwd: repoRoot,
      script: 'dist/server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
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
      restart_delay: 5000,
      kill_timeout: 10000,
      time: true,
      env_production: frontendProductionEnv
    }
  ]
};
