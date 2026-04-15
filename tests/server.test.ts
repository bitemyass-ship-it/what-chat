import { createDatabase } from '../src/database/database';
import {
  loadEmployeeIds,
  restorePersistedSessions,
  reconcileEmployeeActivityFromSessions,
  startChatSyncScheduler
} from '../src/server';
import type { Server as HttpServer } from 'node:http';
import { shutdownResources } from '../src/server';
import type { Database } from '../src/database/types';
import type { Logger } from '../src/types/whatsapp';
import type { SessionManager } from '../src/types/whatsapp';
import { requireAuthPassword } from '../src/utils/env';
import { resolveSessionStoragePath } from '../src/whatsapp/client';

describe('shutdownResources', () => {
  const createMockLogger = (): Logger => ({
    close: jest.fn(),
    error: jest.fn(),
    health: jest.fn(),
    http: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  });

  it('should stop both loops before http and whatsapp shutdown complete', async () => {
    const callOrder: string[] = [];
    const chatSyncScheduler = {
      stop: jest.fn(async () => {
        callOrder.push('chat-sync:start');
        await Promise.resolve();
        callOrder.push('chat-sync:end');
      })
    };
    const sessionActivitySyncLoop = {
      stop: jest.fn(async () => {
        callOrder.push('session-activity:start');
        await Promise.resolve();
        callOrder.push('session-activity:end');
      })
    };
    const server = {
      close: jest.fn((handler: (error?: Error | null) => void) => {
        callOrder.push('http:start');
        callOrder.push('http:end');
        handler(null);
      })
    } as unknown as HttpServer;
    const sessionManager: SessionManager = {
      getSessionHealth: jest.fn(),
      shutdown: jest.fn(async () => {
        callOrder.push('whatsapp:start');
        await Promise.resolve();
        callOrder.push('whatsapp:end');
      }),
      startAll: jest.fn(),
      startSession: jest.fn(),
      stopSession: jest.fn()
    };
    const database = {
      chats: {} as Database['chats'],
      close: jest.fn(() => {
        callOrder.push('database:close');
      }),
      employees: {} as Database['employees'],
      messages: {} as Database['messages']
    } as Database;

    const logger = createMockLogger();
    const failures = await shutdownResources({
      chatSyncScheduler,
      database,
      logger,
      sessionActivitySyncLoop,
      server,
      sessionManager
    });

    expect(failures).toEqual([]);
    expect(callOrder).toEqual([
      'chat-sync:start',
      'chat-sync:end',
      'session-activity:start',
      'session-activity:end',
      'http:start',
      'http:end',
      'whatsapp:start',
      'whatsapp:end',
      'database:close'
    ]);
    expect(logger.close).toHaveBeenCalled();
  });

  it('should stop teardown when chat sync scheduler shutdown fails', async () => {
    const server = {
      close: jest.fn()
    } as unknown as HttpServer;
    const sessionManager: SessionManager = {
      getSessionHealth: jest.fn(),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn(),
      stopSession: jest.fn()
    };
    const database = {
      chats: {} as Database['chats'],
      close: jest.fn(),
      employees: {} as Database['employees'],
      messages: {} as Database['messages']
    } as Database;

    const failures = await shutdownResources({
      chatSyncScheduler: {
        stop: jest.fn(async () => {
          throw new Error('chat sync stop timed out');
        })
      },
      database,
      logger: createMockLogger(),
      sessionActivitySyncLoop: {
        stop: jest.fn()
      },
      server,
      sessionManager
    });

    expect(failures).toEqual([
      {
        operation: 'chat-sync-scheduler',
        error: 'chat sync stop timed out'
      }
    ]);
    expect(server.close).not.toHaveBeenCalled();
    expect(sessionManager.shutdown).not.toHaveBeenCalled();
    expect(database.close).not.toHaveBeenCalled();
  });
});

describe('startChatSyncScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should start the first chat sync batch only after the configured initial delay', async () => {
    const logger: Logger = {
      close: jest.fn(),
      error: jest.fn(),
      health: jest.fn(),
      http: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    const syncEmployee = jest.fn().mockResolvedValue(undefined);
    const sessionManager: SessionManager = {
      getSessionHealth: jest.fn().mockResolvedValue({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        lastCheckedAt: '2026-04-09T10:00:00.000Z',
        lastDisconnectReason: null,
        lastError: null,
        lastEventAt: '2026-04-09T10:00:00.000Z',
        lastReadyAt: '2026-04-09T10:00:00.000Z',
        qrCode: null,
        runtimeStatus: 'ready',
        whatsappState: 'CONNECTED'
      }),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn(),
      stopSession: jest.fn()
    };
    const database = {
      chats: {} as Database['chats'],
      close: jest.fn(),
      employees: {
        listActive: jest.fn(() => [
          {
            code: 'anna',
            createdAt: '2026-04-09T10:00:00.000Z',
            displayName: 'Anna',
            id: 1,
            isActive: true,
            phoneNumber: '380991112233',
            sessionDir: null,
            updatedAt: '2026-04-09T10:00:00.000Z'
          }
        ]),
        listAll: jest.fn(() => []),
        count: jest.fn(() => 0),
        create: jest.fn(),
        deleteByCode: jest.fn(),
        findByCode: jest.fn(),
        seedCodes: jest.fn(),
        upsert: jest.fn()
      } as Database['employees'],
      messages: {} as Database['messages']
    } as Database;

    const scheduler = startChatSyncScheduler({
      database,
      enabled: true,
      initialDelayMs: 250,
      intervalMs: 5_000,
      logger,
      sessionManager,
      syncEmployee
    });

    await jest.advanceTimersByTimeAsync(249);
    expect(syncEmployee).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(sessionManager.getSessionHealth).toHaveBeenCalledWith('anna');
    expect(syncEmployee).toHaveBeenCalledWith(
      'anna',
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );

    await scheduler.stop();
  });

  it('should abort the in-flight chat sync batch when the scheduler stops', async () => {
    const logger: Logger = {
      close: jest.fn(),
      error: jest.fn(),
      health: jest.fn(),
      http: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    const syncEmployee = jest.fn(
      async (
        _employeeCode: string,
        options?: {
          signal?: AbortSignal;
        }
      ) =>
        new Promise<void>((resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');

            error.name = 'AbortError';
            reject(error);
          });
        })
    );
    const sessionManager: SessionManager = {
      getSessionHealth: jest.fn().mockResolvedValue({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        lastCheckedAt: '2026-04-09T10:00:00.000Z',
        lastDisconnectReason: null,
        lastError: null,
        lastEventAt: '2026-04-09T10:00:00.000Z',
        lastReadyAt: '2026-04-09T10:00:00.000Z',
        qrCode: null,
        runtimeStatus: 'ready',
        whatsappState: 'CONNECTED'
      }),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn(),
      stopSession: jest.fn()
    };
    const database = {
      chats: {} as Database['chats'],
      close: jest.fn(),
      employees: {
        listActive: jest.fn(() => [
          {
            code: 'anna',
            createdAt: '2026-04-09T10:00:00.000Z',
            displayName: 'Anna',
            id: 1,
            isActive: true,
            phoneNumber: '380991112233',
            sessionDir: null,
            updatedAt: '2026-04-09T10:00:00.000Z'
          }
        ]),
        listAll: jest.fn(() => []),
        count: jest.fn(() => 0),
        create: jest.fn(),
        deleteByCode: jest.fn(),
        findByCode: jest.fn(),
        seedCodes: jest.fn(),
        upsert: jest.fn()
      } as Database['employees'],
      messages: {} as Database['messages']
    } as Database;

    const scheduler = startChatSyncScheduler({
      database,
      enabled: true,
      initialDelayMs: 1,
      intervalMs: 5_000,
      logger,
      sessionManager,
      shutdownTimeoutMs: 100,
      syncEmployee
    });

    await jest.advanceTimersByTimeAsync(1);
    await scheduler.stop();

    expect(syncEmployee).toHaveBeenCalledWith(
      'anna',
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });
});

describe('loadEmployeeIds', () => {
  const createLogger = (): Logger => ({
    close: jest.fn(),
    error: jest.fn(),
    health: jest.fn(),
    http: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  });

  it('should ignore legacy env values after the database is already populated', () => {
    const logger = createLogger();
    const database = createDatabase({
      databasePath: ':memory:',
      logger
    });

    try {
      database.employees.create({ code: 'anna' });
      database.employees.create({ code: 'bob', isActive: false });

      const employeeIds = loadEmployeeIds(database, 'charlie,david', logger);

      expect(employeeIds).toEqual(['anna']);
      expect(database.employees.listAll().map((employee) => employee.code)).toEqual([
        'anna',
        'bob'
      ]);
      expect(logger.info).not.toHaveBeenCalledWith(
        'Seeded employees from legacy environment variable',
        expect.anything()
      );
    } finally {
      database.close();
    }
  });
});

describe('requireAuthPassword', () => {
  it('should return the configured shared password when it is present', () => {
    expect(
      requireAuthPassword({
        AUTH_PASSWORD: 'super-secret-password'
      })
    ).toBe('super-secret-password');
  });

  it('should fail when AUTH_PASSWORD is missing', () => {
    expect(() => requireAuthPassword({})).toThrow('AUTH_PASSWORD is required');
  });

  it('should fail when AUTH_PASSWORD is blank after trimming', () => {
    expect(() =>
      requireAuthPassword({
        AUTH_PASSWORD: '   '
      })
    ).toThrow('AUTH_PASSWORD is required');
  });
});

describe('restorePersistedSessions', () => {
  const createLogger = (): Logger => ({
    close: jest.fn(),
    error: jest.fn(),
    health: jest.fn(),
    http: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  });

  it('should restore only active employees with persisted session storage and keep failures non-fatal', async () => {
    const logger = createLogger();
    const database = createDatabase({
      databasePath: ':memory:',
      logger
    });
    const sessionManager: SessionManager = {
      getSessionHealth: jest.fn(),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn(async (employeeCode: string) => {
        if (employeeCode === 'dave') {
          throw new Error('auth failed');
        }
      }),
      stopSession: jest.fn()
    };
    const persistedDefaultPath = resolveSessionStoragePath({
      sessionKey: '380991112233'
    });
    const persistedOverridePath = '/persisted/session-override';
    const storageExists = jest.fn(
      async (sessionStoragePath: string): Promise<boolean> =>
        sessionStoragePath === persistedDefaultPath ||
        sessionStoragePath === persistedOverridePath
    );

    try {
      database.employees.create({
        code: 'anna',
        isActive: true,
        phoneNumber: '380991112233'
      });
      database.employees.create({
        code: 'bob',
        isActive: false,
        phoneNumber: '380991112244'
      });
      database.employees.create({
        code: 'carol',
        isActive: true,
        phoneNumber: null
      });
      database.employees.create({
        code: 'dave',
        isActive: true,
        phoneNumber: '380991112255',
        sessionDir: persistedOverridePath
      });

      const summary = await restorePersistedSessions({
        employees: database.employees,
        logger,
        sessionManager,
        storageExists
      });

      expect(storageExists).toHaveBeenCalledWith(persistedDefaultPath);
      expect(storageExists).toHaveBeenCalledWith(persistedOverridePath);
      expect(sessionManager.startSession).toHaveBeenCalledTimes(2);
      expect(sessionManager.startSession).toHaveBeenCalledWith('anna');
      expect(sessionManager.startSession).toHaveBeenCalledWith('dave');
      expect(summary).toEqual({
        attemptedEmployeeCodes: ['anna', 'dave'],
        failedEmployeeCodes: ['dave'],
        restoredEmployeeCodes: ['anna'],
        skippedEmployeeCodes: ['bob', 'carol']
      });
      expect(logger.error).toHaveBeenCalledWith('WhatsApp session restore failed', {
        employeeCode: 'dave',
        error: 'auth failed'
      });
      expect(logger.info).toHaveBeenCalledWith('Session restore skipped', {
        event: 'session_restore_skipped',
        employeeCode: 'bob',
        reason: 'employee_inactive'
      });
      expect(logger.info).toHaveBeenCalledWith('Session restore skipped', {
        event: 'session_restore_skipped',
        employeeCode: 'carol',
        reason: 'session_path_unresolvable'
      });
    } finally {
      database.close();
    }
  });

  it('should log session_storage_not_found when storageExists returns false', async () => {
    const logger = createLogger();
    const database = createDatabase({
      databasePath: ':memory:',
      logger
    });
    const sessionManager: SessionManager = {
      getSessionHealth: jest.fn(),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn(),
      stopSession: jest.fn()
    };
    const expectedPath = resolveSessionStoragePath({ sessionKey: '380991112266' });
    const storageExists = jest.fn(async () => false);

    try {
      database.employees.create({
        code: 'eve',
        isActive: true,
        phoneNumber: '380991112266'
      });

      const summary = await restorePersistedSessions({
        employees: database.employees,
        logger,
        sessionManager,
        storageExists
      });

      expect(storageExists).toHaveBeenCalledWith(expectedPath);
      expect(sessionManager.startSession).not.toHaveBeenCalled();
      expect(summary).toEqual({
        attemptedEmployeeCodes: [],
        failedEmployeeCodes: [],
        restoredEmployeeCodes: [],
        skippedEmployeeCodes: ['eve']
      });
      expect(logger.info).toHaveBeenCalledWith('Session restore skipped', {
        event: 'session_restore_skipped',
        employeeCode: 'eve',
        reason: 'session_storage_not_found',
        sessionStoragePath: expectedPath
      });
    } finally {
      database.close();
    }
  });
});

describe('reconcileEmployeeActivityFromSessions', () => {
  const createLogger = (): Logger => ({
    close: jest.fn(),
    error: jest.fn(),
    health: jest.fn(),
    http: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  });

  it('should mark an employee active when the runtime WhatsApp session is connected', async () => {
    const logger = createLogger();
    const database = createDatabase({
      databasePath: ':memory:',
      logger
    });
    const sessionManager: SessionManager = {
      getSessionHealth: jest.fn().mockResolvedValue({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        lastCheckedAt: '2026-03-30T10:00:00.000Z',
        lastDisconnectReason: null,
        lastError: null,
        lastEventAt: '2026-03-30T10:00:00.000Z',
        lastReadyAt: '2026-03-30T10:00:00.000Z',
        qrCode: null,
        runtimeStatus: 'ready',
        whatsappState: 'CONNECTED'
      }),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn(),
      stopSession: jest.fn()
    };

    try {
      database.employees.create({
        code: 'anna',
        isActive: false,
        phoneNumber: '380991112233'
      });

      await reconcileEmployeeActivityFromSessions({
        database,
        logger,
        sessionManager
      });

      expect(database.employees.findByCode('anna')).toEqual(
        expect.objectContaining({
          code: 'anna',
          isActive: true
        })
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Employee marked active from WhatsApp runtime session',
        {
          code: 'anna'
        }
      );
    } finally {
      database.close();
    }
  });

  it('should leave the employee inactive when there is no active runtime session', async () => {
    const logger = createLogger();
    const database = createDatabase({
      databasePath: ':memory:',
      logger
    });
    const sessionManager: SessionManager = {
      getSessionHealth: jest.fn().mockResolvedValue({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: false,
        lastCheckedAt: '2026-03-30T10:00:00.000Z',
        lastDisconnectReason: null,
        lastError: null,
        lastEventAt: '2026-03-30T10:00:00.000Z',
        lastReadyAt: null,
        qrCode: 'raw-qr-code',
        runtimeStatus: 'waiting_for_qr',
        whatsappState: null
      }),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn(),
      stopSession: jest.fn()
    };

    try {
      database.employees.create({
        code: 'anna',
        isActive: false,
        phoneNumber: '380991112233'
      });

      await reconcileEmployeeActivityFromSessions({
        database,
        logger,
        sessionManager
      });

      expect(database.employees.findByCode('anna')).toEqual(
        expect.objectContaining({
          code: 'anna',
          isActive: false
        })
      );
      expect(logger.info).not.toHaveBeenCalledWith(
        'Employee marked active from WhatsApp runtime session',
        expect.anything()
      );
    } finally {
      database.close();
    }
  });
});
