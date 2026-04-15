import fs from 'node:fs/promises';
import http, { type Server as HttpServer } from 'node:http';
import qrcode from 'qrcode-terminal';
import {
  createApp,
  type AppReadinessReporter,
  type AppReadinessStatus
} from './app';
import { createDatabase } from './database/database';
import type { Database, EmployeesRepository } from './database/types';
import type { Logger, SessionManager } from './types/whatsapp';
import {
  loadEnvironment,
  requireAuthPassword,
  requirePersistentProductionPath
} from './utils/env';
import {
  startHealthLogger,
  type HealthLogger
} from './utils/health-logger';
import { createLogger } from './utils/logger';
import { createWhatsappClientFactory } from './whatsapp/client';
import { createCallHandler } from './whatsapp/call-handler';
import { createMessageHandler } from './whatsapp/message-handler';
import { createSessionManager } from './whatsapp/manager';
import { resolveEmployeeSessionLocation } from './whatsapp/session-location';

const DEFAULT_PORT = 3050;
const DEFAULT_SESSION_ACTIVITY_SYNC_INTERVAL_MS = 60_000;
const DEFAULT_CHAT_SYNC_INTERVAL_MS = 70_000;
const DEFAULT_CHAT_SYNC_INITIAL_DELAY_MS = 80_000;
const DEFAULT_CHAT_SYNC_EMPLOYEE_CONCURRENCY = 1;
const DEFAULT_CHAT_SYNC_SHUTDOWN_TIMEOUT_MS = 15_000;

const createAbortError = (message = 'WhatsApp chat sync aborted'): Error => {
  const error = new Error(message);

  error.name = 'AbortError';
  return error;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const createDefaultReadinessStatus = (): AppReadinessStatus => ({
  activeRuntimeSessionCount: 0,
  chatSyncSchedulerEnabled: false,
  chatSyncSchedulerReady: false,
  databaseReady: false,
  failedRestoreCount: 0,
  httpAppReady: false,
  sessionActivityLoopReady: false,
  sessionRestoreCompleted: false
});

const isTruthyProductionFlag = (value: string | undefined): boolean =>
  value?.trim().toLowerCase() === 'true';

const parsePositiveInteger = (
  value: string | undefined,
  fallbackValue: number
): number => {
  if (value === undefined) {
    return fallbackValue;
  }

  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallbackValue;
};

const validateFirstModeProductionContract = ({
  chatSyncEnabled,
  env = process.env
}: {
  chatSyncEnabled: boolean;
  env?: NodeJS.ProcessEnv;
}): void => {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  if (!chatSyncEnabled) {
    throw new Error(
      'WHATSAPP_CHAT_SYNC_ENABLED=true is required for first-mode production'
    );
  }

  env.WHATSAPP_DATABASE_PATH = requirePersistentProductionPath({
    env,
    pathValue: env.WHATSAPP_DATABASE_PATH,
    variableName: 'WHATSAPP_DATABASE_PATH'
  });
  env.WHATSAPP_SESSION_DIR = requirePersistentProductionPath({
    env,
    pathValue: env.WHATSAPP_SESSION_DIR,
    variableName: 'WHATSAPP_SESSION_DIR'
  });
};

const withShutdownTimeout = async (
  operation: Promise<void> | null,
  timeoutMs: number
): Promise<boolean> => {
  if (!operation) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(false);
    }, timeoutMs);

    void operation.finally(() => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      resolve(true);
    });
  });
};

const runWithConcurrency = async <T>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<void>,
  options?: {
    signal?: AbortSignal;
  }
): Promise<void> => {
  if (values.length === 0) {
    return;
  }

  const normalizedConcurrency = Math.max(1, Math.min(concurrency, values.length));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: normalizedConcurrency }, async () => {
      while (nextIndex < values.length) {
        if (options?.signal?.aborted) {
          return;
        }

        const currentIndex = nextIndex;

        nextIndex += 1;
        await worker(values[currentIndex] as T);
      }
    })
  );
};

export interface RuntimeReadinessState extends AppReadinessReporter {
  markChatSyncSchedulerState(options: {
    enabled: boolean;
    ready: boolean;
  }): void;
  markDatabaseReady(): void;
  markHttpAppReady(): void;
  markRestoreCompleted(summary: SessionRestoreSummary): void;
  markSessionActivityLoopReady(): void;
  setActiveRuntimeSessionCount(count: number): void;
}

export const createRuntimeReadinessState = (): RuntimeReadinessState => {
  let status = createDefaultReadinessStatus();

  return {
    getStatus(): AppReadinessStatus {
      return { ...status };
    },

    markChatSyncSchedulerState({
      enabled,
      ready
    }: {
      enabled: boolean;
      ready: boolean;
    }): void {
      status = {
        ...status,
        chatSyncSchedulerEnabled: enabled,
        chatSyncSchedulerReady: ready
      };
    },

    markDatabaseReady(): void {
      status = {
        ...status,
        databaseReady: true
      };
    },

    markHttpAppReady(): void {
      status = {
        ...status,
        httpAppReady: true
      };
    },

    markRestoreCompleted(summary: SessionRestoreSummary): void {
      status = {
        ...status,
        activeRuntimeSessionCount: summary.restoredEmployeeCodes.length,
        failedRestoreCount: summary.failedEmployeeCodes.length,
        sessionRestoreCompleted: true
      };
    },

    markSessionActivityLoopReady(): void {
      status = {
        ...status,
        sessionActivityLoopReady: true
      };
    },

    setActiveRuntimeSessionCount(count: number): void {
      status = {
        ...status,
        activeRuntimeSessionCount: count
      };
    }
  };
};

export const parseEmployeeIds = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const loadEmployeeIds = (
  database: Database,
  legacyEmployeeIdsValue: string | undefined,
  logger: Logger
): string[] => {
  if (database.employees.count() === 0) {
    const legacyEmployeeIds = parseEmployeeIds(legacyEmployeeIdsValue);

    if (legacyEmployeeIds.length > 0) {
      database.employees.seedCodes(legacyEmployeeIds);
      logger.info('Seeded employees from legacy environment variable', {
        employeeIds: legacyEmployeeIds
      });
    }
  }

  return database.employees.listActive().map((employee) => employee.code);
};

export const startHttpServer = async (
  app: ReturnType<typeof createApp>,
  port: number,
  logger: Logger
): Promise<HttpServer> =>
  new Promise((resolve, reject) => {
    const server = http.createServer(app);

    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      logger.info('Express server listening', { port });
      resolve(server);
    });
  });

export const closeHttpServer = async (server: HttpServer): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

export const startWhatsappSessions = async (
  employeeIds: string[],
  sessionManager: SessionManager,
  logger: Logger
): Promise<void> => {
  if (employeeIds.length === 0) {
    logger.warn('No WhatsApp employee sessions configured');
    return;
  }

  await sessionManager.startAll(employeeIds);
};

const sessionStorageExists = async (
  sessionStoragePath: string
): Promise<boolean> => {
  try {
    await fs.access(sessionStoragePath);
    return true;
  } catch {
    return false;
  }
};

export interface SessionRestoreSummary {
  attemptedEmployeeCodes: string[];
  failedEmployeeCodes: string[];
  restoredEmployeeCodes: string[];
  skippedEmployeeCodes: string[];
}

export const restorePersistedSessions = async ({
  employees,
  logger,
  sessionManager,
  storageExists = sessionStorageExists
}: {
  employees: EmployeesRepository;
  logger: Logger;
  sessionManager: SessionManager;
  storageExists?: (sessionStoragePath: string) => Promise<boolean>;
}): Promise<SessionRestoreSummary> => {
  const employeeRecords = employees.listAll();
  const employeeCodesToRestore: string[] = [];
  const skippedEmployeeCodes: string[] = [];
  const startedAt = Date.now();

  logger.info('Starting WhatsApp session restore', {
    event: 'session_restore_started',
    employeeCount: employeeRecords.length
  });

  for (const employee of employeeRecords) {
    if (!employee.isActive) {
      logger.info('Session restore skipped', {
        event: 'session_restore_skipped',
        employeeCode: employee.code,
        reason: 'employee_inactive'
      });
      skippedEmployeeCodes.push(employee.code);
      continue;
    }

    const { sessionStoragePath } = resolveEmployeeSessionLocation(employee);

    if (!sessionStoragePath) {
      logger.info('Session restore skipped', {
        event: 'session_restore_skipped',
        employeeCode: employee.code,
        reason: 'session_path_unresolvable'
      });
      skippedEmployeeCodes.push(employee.code);
      continue;
    }

    if (!(await storageExists(sessionStoragePath))) {
      logger.info('Session restore skipped', {
        event: 'session_restore_skipped',
        employeeCode: employee.code,
        reason: 'session_storage_not_found',
        sessionStoragePath
      });
      skippedEmployeeCodes.push(employee.code);
      continue;
    }

    employeeCodesToRestore.push(employee.code);
  }

  const results = await Promise.allSettled(
    employeeCodesToRestore.map(async (employeeCode) => {
      await sessionManager.startSession(employeeCode);
      return employeeCode;
    })
  );
  const restoredEmployeeCodes: string[] = [];
  const failedEmployeeCodes: string[] = [];

  results.forEach((result, index) => {
    const employeeCode = employeeCodesToRestore[index];

    if (!employeeCode) {
      return;
    }

    if (result.status === 'fulfilled') {
      restoredEmployeeCodes.push(employeeCode);
      return;
    }

    failedEmployeeCodes.push(employeeCode);
    logger.error('WhatsApp session restore failed', {
      employeeCode,
      error:
        result.reason instanceof Error ? result.reason.message : 'Unknown error'
    });
  });

  logger.info('Finished WhatsApp session restore', {
    attemptedEmployeeCount: employeeCodesToRestore.length,
    durationMs: Date.now() - startedAt,
    event: 'session_restore_finished',
    failedEmployeeCount: failedEmployeeCodes.length,
    restoredEmployeeCount: restoredEmployeeCodes.length,
    skippedEmployeeCount: skippedEmployeeCodes.length
  });

  return {
    attemptedEmployeeCodes: employeeCodesToRestore,
    failedEmployeeCodes,
    restoredEmployeeCodes,
    skippedEmployeeCodes
  };
};

export interface ShutdownFailure {
  error: string;
  operation:
    | 'chat-sync-scheduler'
    | 'database'
    | 'health-timer'
    | 'http-server'
    | 'logger'
    | 'session-activity-sync'
    | 'whatsapp-sessions';
}

export interface SessionActivitySyncLoop {
  stop(): Promise<void>;
}

export interface ChatSyncScheduler {
  stop(): Promise<void>;
}

export const reconcileEmployeeActivityFromSessions = async ({
  database,
  logger,
  sessionManager
}: {
  database: Database;
  logger: Logger;
  sessionManager: SessionManager;
}): Promise<void> => {
  const employees = database.employees.listAll();

  for (const employee of employees) {
    if (employee.isActive) {
      continue;
    }

    try {
      const health = await sessionManager.getSessionHealth(employee.code);

      if (!health.isSessionActive) {
        continue;
      }

      database.employees.upsert({
        code: employee.code,
        isActive: true
      });
      logger.info('Employee marked active from WhatsApp runtime session', {
        code: employee.code
      });
    } catch (error) {
      logger.warn('Employee session activity reconciliation failed', {
        code: employee.code,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
};

export const startSessionActivitySyncLoop = ({
  database,
  intervalMs = DEFAULT_SESSION_ACTIVITY_SYNC_INTERVAL_MS,
  logger,
  sessionManager
}: {
  database: Database;
  intervalMs?: number;
  logger: Logger;
  sessionManager: SessionManager;
}): SessionActivitySyncLoop => {
  let isRunning = false;
  let isStopped = false;
  let activeRun: Promise<void> | null = null;

  const run = async (trigger: 'interval' | 'startup'): Promise<void> => {
    if (isStopped) {
      return;
    }

    if (isRunning) {
      logger.warn('Session activity sync pass skipped because previous pass is still running', {
        event: 'session_activity_sync_skipped',
        trigger
      });
      return;
    }

    isRunning = true;
    const startedAt = Date.now();

    logger.info('Session activity sync pass started', {
      event: 'session_activity_sync_started',
      intervalMs,
      trigger
    });

    activeRun = (async () => {
      try {
        await reconcileEmployeeActivityFromSessions({
          database,
          logger,
          sessionManager
        });
        logger.info('Session activity sync pass finished', {
          durationMs: Date.now() - startedAt,
          event: 'session_activity_sync_finished',
          trigger
        });
      } catch (error) {
        logger.error('Session activity sync pass failed', {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : 'Unknown error',
          event: 'session_activity_sync_failed',
          trigger
        });
      } finally {
        activeRun = null;
        isRunning = false;
      }
    })();

    await activeRun;
  };

  const intervalId = setInterval(() => {
    void run('interval');
  }, intervalMs);

  logger.info('Session activity sync loop initialized', {
    event: 'session_activity_loop_initialized',
    intervalMs
  });
  void run('startup');

  return {
    async stop(): Promise<void> {
      isStopped = true;
      clearInterval(intervalId);
      logger.info('Session activity sync loop stopping', {
        event: 'session_activity_loop_stopping'
      });
      await activeRun;
      logger.info('Session activity sync loop stopped', {
        event: 'session_activity_loop_stopped'
      });
    }
  };
};

export interface ChatSyncBatchSummary {
  activeRuntimeEmployeeCodes: string[];
  failedEmployeeCodes: string[];
  healthCheckFailureCount: number;
  inactiveRuntimeEmployeeCount: number;
  syncedEmployeeCodes: string[];
}

export const runChatSyncBatch = async ({
  database,
  employeeConcurrency,
  logger,
  signal,
  sessionManager,
  syncEmployee = async () => {}
}: {
  database: Database;
  employeeConcurrency: number;
  logger: Logger;
  signal?: AbortSignal;
  sessionManager: SessionManager;
  syncEmployee?: (
    employeeCode: string,
    options?: {
      signal?: AbortSignal;
    }
  ) => Promise<void>;
}): Promise<ChatSyncBatchSummary> => {
  const startedAt = Date.now();
  const employees = database.employees.listActive();
  const activeRuntimeEmployeeCodes: string[] = [];
  const syncedEmployeeCodes: string[] = [];
  const failedEmployeeCodes: string[] = [];
  let healthCheckFailureCount = 0;
  let inactiveRuntimeEmployeeCount = 0;

  logger.info('WhatsApp chat sync tick started', {
    candidateEmployeeCount: employees.length,
    employeeConcurrency,
    event: 'chat_sync_tick_started'
  });

  for (const employee of employees) {
    throwIfAborted(signal);

    try {
      const health = await sessionManager.getSessionHealth(employee.code);

      if (!health.isSessionActive) {
        inactiveRuntimeEmployeeCount += 1;
        continue;
      }

      activeRuntimeEmployeeCodes.push(employee.code);
    } catch (error) {
      healthCheckFailureCount += 1;
      logger.warn('WhatsApp chat sync health check failed', {
        employeeCode: employee.code,
        error: error instanceof Error ? error.message : 'Unknown error',
        event: 'chat_sync_health_check_failed'
      });
    }
  }

  await runWithConcurrency(
    activeRuntimeEmployeeCodes,
    employeeConcurrency,
    async (employeeCode) => {
      throwIfAborted(signal);

      try {
        await syncEmployee(employeeCode, {
          signal
        });
        syncedEmployeeCodes.push(employeeCode);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        failedEmployeeCodes.push(employeeCode);
        logger.error('WhatsApp chat sync employee failed', {
          employeeCode,
          error: error instanceof Error ? error.message : 'Unknown error',
          event: 'chat_sync_employee_failed'
        });
      }
    },
    {
      signal
    }
  );

  logger.info('WhatsApp chat sync tick finished', {
    activeRuntimeEmployeeCount: activeRuntimeEmployeeCodes.length,
    candidateEmployeeCount: employees.length,
    durationMs: Date.now() - startedAt,
    employeeConcurrency,
    event: 'chat_sync_tick_finished',
    failedEmployeeCount: failedEmployeeCodes.length,
    healthCheckFailureCount,
    inactiveRuntimeEmployeeCount,
    syncedEmployeeCount: syncedEmployeeCodes.length
  });

  return {
    activeRuntimeEmployeeCodes,
    failedEmployeeCodes,
    healthCheckFailureCount,
    inactiveRuntimeEmployeeCount,
    syncedEmployeeCodes
  };
};

export const startChatSyncScheduler = ({
  database,
  employeeConcurrency = DEFAULT_CHAT_SYNC_EMPLOYEE_CONCURRENCY,
  enabled,
  initialDelayMs = DEFAULT_CHAT_SYNC_INITIAL_DELAY_MS,
  intervalMs = DEFAULT_CHAT_SYNC_INTERVAL_MS,
  logger,
  sessionManager,
  shutdownTimeoutMs = DEFAULT_CHAT_SYNC_SHUTDOWN_TIMEOUT_MS,
  syncEmployee
}: {
  database: Database;
  employeeConcurrency?: number;
  enabled: boolean;
  initialDelayMs?: number;
  intervalMs?: number;
  logger: Logger;
  sessionManager: SessionManager;
  shutdownTimeoutMs?: number;
  syncEmployee?: (
    employeeCode: string,
    options?: {
      signal?: AbortSignal;
    }
  ) => Promise<void>;
}): ChatSyncScheduler => {
  let isRunning = false;
  let isStopped = false;
  let activeRun: Promise<void> | null = null;
  let activeAbortController: AbortController | null = null;
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let initialTimeoutId: ReturnType<typeof setTimeout> | undefined;

  if (!enabled) {
    logger.warn('WhatsApp chat sync scheduler disabled', {
      event: 'chat_sync_scheduler_disabled'
    });

    return {
      async stop(): Promise<void> {
        logger.info('WhatsApp chat sync scheduler stopped', {
          event: 'chat_sync_scheduler_stopped',
          enabled: false
        });
      }
    };
  }

  const run = async (trigger: 'initial' | 'interval'): Promise<void> => {
    if (isStopped) {
      return;
    }

    if (isRunning) {
      logger.warn('WhatsApp chat sync tick skipped because previous batch is still running', {
        event: 'chat_sync_tick_skipped',
        trigger
      });
      return;
    }

    isRunning = true;
    activeAbortController = new AbortController();

    activeRun = runChatSyncBatch({
      database,
      employeeConcurrency,
      logger,
      signal: activeAbortController.signal,
      sessionManager,
      syncEmployee
    })
      .then(() => undefined)
      .catch((error) => {
        if (isAbortError(error)) {
          logger.warn('WhatsApp chat sync tick aborted', {
            event: 'chat_sync_tick_aborted',
            trigger
          });
          return;
        }

        logger.error('WhatsApp chat sync tick failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          event: 'chat_sync_tick_failed',
          trigger
        });
      })
      .finally(() => {
        activeAbortController = null;
        activeRun = null;
        isRunning = false;
      });

    await activeRun;
  };

  logger.info('WhatsApp chat sync scheduler initialized', {
    employeeConcurrency,
    enabled,
    event: 'chat_sync_scheduler_initialized',
    initialDelayMs,
    intervalMs
  });

  initialTimeoutId = setTimeout(() => {
    if (isStopped) {
      return;
    }

    void run('initial');
    intervalId = setInterval(() => {
      void run('interval');
    }, intervalMs);
  }, initialDelayMs);

  return {
    async stop(): Promise<void> {
      isStopped = true;

      if (initialTimeoutId) {
        clearTimeout(initialTimeoutId);
      }

      if (intervalId) {
        clearInterval(intervalId);
      }

      logger.info('WhatsApp chat sync scheduler stopping', {
        event: 'chat_sync_scheduler_stopping'
      });
      activeAbortController?.abort();

      const completedBeforeTimeout = await withShutdownTimeout(
        activeRun,
        shutdownTimeoutMs
      );

      if (!completedBeforeTimeout) {
        logger.error(
          'WhatsApp chat sync scheduler stop timed out waiting for the in-flight batch',
          {
            event: 'chat_sync_scheduler_stop_timed_out',
            shutdownTimeoutMs
          }
        );
        throw new Error(
          `WhatsApp chat sync scheduler stop timed out after ${shutdownTimeoutMs}ms`
        );
      }

      logger.info('WhatsApp chat sync scheduler stopped', {
        event: 'chat_sync_scheduler_stopped',
        enabled
      });
    }
  };
};

export const shutdownResources = async ({
  chatSyncScheduler,
  database,
  healthTimer,
  logger,
  sessionActivitySyncLoop,
  server,
  sessionManager
}: {
  chatSyncScheduler?: ChatSyncScheduler;
  database: Database;
  healthTimer?: HealthLogger;
  logger: Logger;
  sessionActivitySyncLoop?: SessionActivitySyncLoop;
  server: HttpServer;
  sessionManager: SessionManager;
}): Promise<ShutdownFailure[]> => {
  const failures: ShutdownFailure[] = [];

  try {
    healthTimer?.stop();
  } catch (error) {
    failures.push({
      operation: 'health-timer',
      error: error instanceof Error ? error.message : 'Unknown shutdown error'
    });
  }

  try {
    await chatSyncScheduler?.stop();
  } catch (error) {
    failures.push({
      operation: 'chat-sync-scheduler',
      error: error instanceof Error ? error.message : 'Unknown shutdown error'
    });
  }

  if (failures.length > 0) {
    return failures;
  }

  try {
    await sessionActivitySyncLoop?.stop();
  } catch (error) {
    failures.push({
      operation: 'session-activity-sync',
      error: error instanceof Error ? error.message : 'Unknown shutdown error'
    });
  }

  if (failures.length > 0) {
    return failures;
  }

  try {
    await closeHttpServer(server);
  } catch (error) {
    failures.push({
      operation: 'http-server',
      error: error instanceof Error ? error.message : 'Unknown shutdown error'
    });
  }

  try {
    await sessionManager.shutdown();
  } catch (error) {
    failures.push({
      operation: 'whatsapp-sessions',
      error: error instanceof Error ? error.message : 'Unknown shutdown error'
    });
  }

  try {
    database.close();
  } catch (error) {
    failures.push({
      operation: 'database',
      error: error instanceof Error ? error.message : 'Unknown shutdown error'
    });
  }

  try {
    logger.close();
  } catch (error) {
    failures.push({
      operation: 'logger',
      error: error instanceof Error ? error.message : 'Unknown shutdown error'
    });
  }

  return failures;
};

export const createGracefulShutdown = ({
  chatSyncScheduler,
  database,
  healthTimer,
  logger,
  sessionActivitySyncLoop,
  server,
  sessionManager
}: {
  chatSyncScheduler?: ChatSyncScheduler;
  database: Database;
  healthTimer?: HealthLogger;
  logger: Logger;
  sessionActivitySyncLoop?: SessionActivitySyncLoop;
  server: HttpServer;
  sessionManager: SessionManager;
}) => {
  let isShuttingDown = false;

  return async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    const startedAt = Date.now();
    logger.info('Graceful shutdown started', {
      event: 'graceful_shutdown_started',
      signal
    });

    const failedOperations = await shutdownResources({
      chatSyncScheduler,
      database,
      healthTimer,
      logger,
      sessionActivitySyncLoop,
      server,
      sessionManager
    });

    if (failedOperations.length > 0) {
      logger.error('Graceful shutdown completed with errors', {
        durationMs: Date.now() - startedAt,
        event: 'graceful_shutdown_failed',
        failedOperations
      });
      process.exit(1);
      return;
    }

    logger.info('Graceful shutdown completed', {
      durationMs: Date.now() - startedAt,
      event: 'graceful_shutdown_completed'
    });
    process.exit(0);
  };
};

export const bootstrap = async (): Promise<void> => {
  loadEnvironment();
  const authPassword = requireAuthPassword();
  const logger = createLogger();
  const readiness = createRuntimeReadinessState();
  let database: Database | undefined;

  try {
    const port = Number(process.env.PORT ?? DEFAULT_PORT);
    const sessionActivitySyncIntervalMs = parsePositiveInteger(
      process.env.WHATSAPP_SESSION_ACTIVITY_SYNC_INTERVAL_MS,
      DEFAULT_SESSION_ACTIVITY_SYNC_INTERVAL_MS
    );
    const chatSyncEnabled = isTruthyProductionFlag(
      process.env.WHATSAPP_CHAT_SYNC_ENABLED
    );
    validateFirstModeProductionContract({
      chatSyncEnabled
    });
    database = createDatabase({
      logger
    });
    readiness.markDatabaseReady();
    loadEmployeeIds(
      database,
      process.env.WHATSAPP_EMPLOYEE_IDS,
      logger
    );
    const chatSyncIntervalMs = parsePositiveInteger(
      process.env.WHATSAPP_CHAT_SYNC_INTERVAL_MS,
      DEFAULT_CHAT_SYNC_INTERVAL_MS
    );
    const chatSyncInitialDelayMs = parsePositiveInteger(
      process.env.WHATSAPP_CHAT_SYNC_INITIAL_DELAY_MS,
      DEFAULT_CHAT_SYNC_INITIAL_DELAY_MS
    );
    const chatSyncEmployeeConcurrency = parsePositiveInteger(
      process.env.WHATSAPP_CHAT_SYNC_EMPLOYEE_CONCURRENCY,
      DEFAULT_CHAT_SYNC_EMPLOYEE_CONCURRENCY
    );
    const clientFactory = createWhatsappClientFactory({
      logger
    });
    const messageHandler = createMessageHandler({
      chats: database.chats,
      messages: database.messages,
      logger
    });
    const callHandler = createCallHandler({
      chats: database.chats,
      messages: database.messages,
      logger
    });
    const sessionManager = createSessionManager({
      callHandler,
      chats: database.chats,
      clientFactory,
      employees: database.employees,
      logger,
      messageHandler,
      qr: qrcode
    });
    const app = createApp({
      authPassword,
      chats: database.chats,
      employees: database.employees,
      logger,
      messages: database.messages,
      readiness,
      sessionManager
    });
    readiness.markHttpAppReady();
    const server = await startHttpServer(app, port, logger);
    const restoreSummary = await restorePersistedSessions({
      employees: database.employees,
      logger,
      sessionManager
    });
    readiness.markRestoreCompleted(restoreSummary);
    const sessionActivitySyncLoop = startSessionActivitySyncLoop({
      database,
      intervalMs: sessionActivitySyncIntervalMs,
      logger,
      sessionManager
    });
    readiness.markSessionActivityLoopReady();
    const chatSyncScheduler = startChatSyncScheduler({
      database,
      employeeConcurrency: chatSyncEmployeeConcurrency,
      enabled: chatSyncEnabled,
      initialDelayMs: chatSyncInitialDelayMs,
      intervalMs: chatSyncIntervalMs,
      logger,
      sessionManager,
      syncEmployee: async (employeeCode, options) => {
        if (!sessionManager.syncChats) {
          throw new Error('WhatsApp chat sync worker is not available');
        }

        await sessionManager.syncChats(employeeCode, options);
      }
    });
    readiness.markChatSyncSchedulerState({
      enabled: chatSyncEnabled,
      ready: chatSyncEnabled
    });
    const healthTimer = startHealthLogger({
      intervalMs: parsePositiveInteger(
        process.env.LOG_HEALTH_INTERVAL_MS,
        60_000
      ),
      logger
    });
    const shutdown = createGracefulShutdown({
      chatSyncScheduler,
      database,
      healthTimer,
      logger,
      sessionActivitySyncLoop,
      server,
      sessionManager
    });

    process.once('SIGINT', () => {
      void shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
  } catch (error) {
    database?.close();
    throw error;
  }
};

if (require.main === module) {
  void bootstrap().catch((error) => {
    const logger = createLogger();

    logger.error('Server bootstrap failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    process.exit(1);
  });
}
