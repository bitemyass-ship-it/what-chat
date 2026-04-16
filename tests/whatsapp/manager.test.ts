import { createCallHandler } from '../../src/whatsapp/call-handler';
import { createDatabase } from '../../src/database/database';
import { createMessageHandler } from '../../src/whatsapp/message-handler';
import { createSessionManager } from '../../src/whatsapp/manager';
import type { EmployeesRepository } from '../../src/database/types';
import type {
  CallPayload,
  Logger,
  MessagePayload,
  WhatsappClientFactory,
  WhatsappSessionClient
} from '../../src/types/whatsapp';

describe('createSessionManager', () => {
  const createLogger = (): Logger => ({
    close: jest.fn(),
    error: jest.fn(),
    health: jest.fn(),
    http: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  });

  const createClient = () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const client: WhatsappSessionClient = {
      destroy: jest.fn().mockResolvedValue(undefined),
      getContactLidAndPhone: jest.fn().mockResolvedValue([]),
      getState: jest.fn().mockResolvedValue('CONNECTED'),
      initialize: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
      })
    };

    return { client, handlers };
  };

  const handlersToPromise = async (
    handlers: Map<string, (...args: unknown[]) => unknown>,
    event: string,
    ...args: unknown[]
  ): Promise<void> => {
    await handlers.get(event)?.(...args);
  };

  const flushLifecycleQueue = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const createEmployeesRepository = (
    phoneNumbersByEmployeeId: Record<string, string | null> = {}
  ): EmployeesRepository => ({
    count: jest.fn(() => Object.keys(phoneNumbersByEmployeeId).length),
    create: jest.fn(),
    deleteByCode: jest.fn(),
    findByCode: jest.fn((code: string) => {
      const phoneNumber =
        code in phoneNumbersByEmployeeId ? phoneNumbersByEmployeeId[code] : '380001112233';

      return {
        id: 1,
        code,
        displayName: null,
        phoneNumber,
        isActive: true,
        sessionDir: null,
        createdAt: '2026-03-29T19:00:00.000Z',
        updatedAt: '2026-03-29T19:00:00.000Z'
      };
    }),
    listActive: jest.fn(() => []),
    listAll: jest.fn(() => []),
    seedCodes: jest.fn(),
    upsert: jest.fn()
  });

  it('should initialize multiple clients', async () => {
    const first = createClient();
    const second = createClient();
    const factory: WhatsappClientFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(first.client)
        .mockReturnValueOnce(second.client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      },
      reconnect: {
        enabled: false
      }
    });

    await manager.startAll(['employee-1', 'employee-2']);

    expect(factory.create).toHaveBeenNthCalledWith(1, 'employee-1');
    expect(factory.create).toHaveBeenNthCalledWith(2, 'employee-2');
    expect(first.client.initialize).toHaveBeenCalledTimes(1);
    expect(second.client.initialize).toHaveBeenCalledTimes(1);
  });

  it('should create the runtime client using the employee phone number as session key', async () => {
    const { client } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      employees: createEmployeesRepository({
        anna: '+380 99 111 22 33'
      }),
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('anna');

    expect(factory.create).toHaveBeenCalledWith('380991112233', {
      sessionStoragePath: expect.stringContaining('session-380991112233')
    });
    expect(client.initialize).toHaveBeenCalledTimes(1);
  });

  it('should sync polled chats and messages through the active runtime session', async () => {
    const logger = createLogger();
    const database = createDatabase({
      databasePath: ':memory:',
      logger
    });
    const { client } = createClient();
    client.getChats = jest.fn().mockResolvedValue([
      {
        id: {
          _serialized: '123@c.us'
        },
        name: 'Alice',
        unreadCount: 2,
        fetchMessages: jest.fn().mockResolvedValue([
          {
            body: 'Hello from poll',
            from: '123@c.us',
            id: {
              _serialized: 'wamid.poll.1'
            },
            timestamp: 1712345678
          }
        ])
      }
    ]);
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };

    try {
      database.employees.create({
        code: 'anna',
        isActive: true,
        phoneNumber: '380991112233'
      });

      const manager = createSessionManager({
        callHandler: createCallHandler({
          chats: database.chats,
          logger,
          messages: database.messages
        }),
        chats: database.chats,
        clientFactory: factory,
        employees: database.employees,
        logger,
        messageHandler: createMessageHandler({
          chats: database.chats,
          logger,
          messages: database.messages
        }),
        qr: {
          generate: jest.fn()
        }
      });

      await manager.startSession('anna');
      expect(manager.syncChats).toBeDefined();
      await manager.syncChats?.('anna');

      const [chat] = database.chats.listByEmployeeCode('anna');

      expect(chat).toEqual(
        expect.objectContaining({
          chatId: '123@c.us',
          displayName: 'Alice',
          lastMessagePreview: 'Hello from poll',
          lastMessagesSyncedAt: expect.any(String),
          lastPolledAt: expect.any(String),
          unreadCount: 2
        })
      );

      const messages = database.messages.listByEmployeeCodeAndChatRecordId('anna', chat.id);

      expect(messages).toEqual([
        expect.objectContaining({
          body: 'Hello from poll',
          externalMessageId: 'wamid.poll.1',
          ingestSource: 'poll',
          sourceChatId: '123@c.us'
        })
      ]);
    } finally {
      database.close();
    }
  });

  it('should continue startup when one employee session fails to initialize', async () => {
    const first = createClient();
    const second = createClient();
    const failure = new Error('auth failed');

    (first.client.initialize as jest.Mock).mockRejectedValueOnce(failure);

    const factory: WhatsappClientFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(first.client)
        .mockReturnValueOnce(second.client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      },
      reconnect: {
        enabled: false
      }
    });

    await expect(manager.startAll(['employee-1', 'employee-2'])).resolves.toBeUndefined();

    expect(first.client.initialize).toHaveBeenCalledTimes(1);
    expect(second.client.initialize).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('WhatsApp session failed to initialize', {
      employeeId: 'employee-1',
      error: 'auth failed'
    });
    expect(logger.warn).toHaveBeenCalledWith('WhatsApp sessions batch completed with failures', {
      failedEmployeeIds: ['employee-1'],
      startedEmployeeIds: ['employee-2']
    });
  });

  it('should destroy the client when initialization fails', async () => {
    const { client } = createClient();
    const failure = new Error('auth failed');
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      },
      reconnect: {
        enabled: false
      }
    });

    (client.initialize as jest.Mock).mockRejectedValueOnce(failure);

    await expect(manager.startSession('employee-1')).rejects.toThrow('auth failed');

    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('should keep the failed session guard when initialization cleanup fails', async () => {
    const first = createClient();
    const second = createClient();
    const factory: WhatsappClientFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(first.client)
        .mockReturnValueOnce(second.client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    (first.client.initialize as jest.Mock).mockRejectedValueOnce(new Error('auth failed'));
    (first.client.destroy as jest.Mock).mockRejectedValueOnce(new Error('destroy failed'));

    await expect(manager.startSession('employee-1')).rejects.toThrow('auth failed');
    await expect(manager.startSession('employee-1')).resolves.toBeUndefined();

    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(second.client.initialize).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'WhatsApp session cleanup failed after initialization error',
      {
        employeeId: 'employee-1',
        error: 'destroy failed'
      }
    );

    await expect(manager.stopSession('employee-1')).resolves.toBeUndefined();
    await expect(manager.startSession('employee-1')).resolves.toBeUndefined();

    expect(first.client.destroy).toHaveBeenCalledTimes(2);
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(second.client.initialize).toHaveBeenCalledTimes(1);
  });

  it('should restart an active runtime session when the employee phone number changes', async () => {
    const first = createClient();
    const second = createClient();
    const factory: WhatsappClientFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(first.client)
        .mockReturnValueOnce(second.client)
    };
    const employees = createEmployeesRepository({
      'employee-1': '380991112233'
    });
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      employees,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('employee-1');
    (employees.findByCode as jest.Mock).mockReturnValue({
      id: 1,
      code: 'employee-1',
      displayName: null,
      phoneNumber: '380991112244',
      isActive: true,
      sessionDir: null,
      createdAt: '2026-03-29T19:00:00.000Z',
      updatedAt: '2026-03-29T19:00:00.000Z'
    });

    await manager.startSession('employee-1');

    expect(first.client.destroy).toHaveBeenCalledTimes(1);
    expect(factory.create).toHaveBeenNthCalledWith(1, '380991112233', {
      sessionStoragePath: expect.stringContaining('session-380991112233')
    });
    expect(factory.create).toHaveBeenNthCalledWith(2, '380991112244', {
      sessionStoragePath: expect.stringContaining('session-380991112244')
    });
    expect(second.client.initialize).toHaveBeenCalledTimes(1);
  });

  it('should join an in-flight session start for the same employee', async () => {
    const { client } = createClient();
    let resolveInitialize: (() => void) | undefined;
    const initializePromise = new Promise<void>((resolve) => {
      resolveInitialize = resolve;
    });
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      employees: createEmployeesRepository({
        anna: '380991112233'
      }),
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    (client.initialize as jest.Mock).mockReturnValueOnce(initializePromise);

    const firstStart = manager.startSession('anna');
    const secondStart = manager.startSession('anna');

    await flushLifecycleQueue();

    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(client.initialize).toHaveBeenCalledTimes(1);

    resolveInitialize?.();

    await expect(
      Promise.all([firstStart, secondStart])
    ).resolves.toEqual([undefined, undefined]);
    expect(factory.create).toHaveBeenCalledTimes(1);
  });

  it('should serialize browser initialization across different employees', async () => {
    const first = createClient();
    const second = createClient();
    let resolveInitialize: (() => void) | undefined;
    const initializePromise = new Promise<void>((resolve) => {
      resolveInitialize = resolve;
    });
    const factory: WhatsappClientFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(first.client)
        .mockReturnValueOnce(second.client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    (first.client.initialize as jest.Mock).mockReturnValueOnce(initializePromise);

    const firstStart = manager.startSession('employee-1');
    const secondStart = manager.startSession('employee-2');

    await flushLifecycleQueue();

    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(first.client.initialize).toHaveBeenCalledTimes(1);
    expect(second.client.initialize).not.toHaveBeenCalled();

    resolveInitialize?.();

    await expect(firstStart).resolves.toBeUndefined();
    await expect(secondStart).resolves.toBeUndefined();
    expect(second.client.initialize).toHaveBeenCalledTimes(1);
  });

  it('should wait for stop cleanup before restarting the same employee session', async () => {
    const first = createClient();
    const second = createClient();
    let resolveDestroy: (() => void) | undefined;
    const destroyPromise = new Promise<void>((resolve) => {
      resolveDestroy = resolve;
    });
    const factory: WhatsappClientFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(first.client)
        .mockReturnValueOnce(second.client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('employee-1');
    (first.client.destroy as jest.Mock).mockReturnValueOnce(destroyPromise);

    const stopOperation = manager.stopSession('employee-1');

    await flushLifecycleQueue();

    expect(first.client.destroy).toHaveBeenCalledTimes(1);

    const restartOperation = manager.startSession('employee-1');

    await flushLifecycleQueue();

    expect(factory.create).toHaveBeenCalledTimes(1);

    resolveDestroy?.();

    await expect(stopOperation).resolves.toBeUndefined();
    await expect(restartOperation).resolves.toBeUndefined();
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(second.client.initialize).toHaveBeenCalledTimes(1);
  });

  it('should ignore stale disconnect events from a replaced employee session', async () => {
    const first = createClient();
    const second = createClient();
    const factory: WhatsappClientFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(first.client)
        .mockReturnValueOnce(second.client)
    };
    const employees = createEmployeesRepository({
      'employee-1': '380991112233'
    });
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      employees,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('employee-1');
    (employees.findByCode as jest.Mock).mockReturnValue({
      id: 1,
      code: 'employee-1',
      displayName: null,
      phoneNumber: '380991112244',
      isActive: true,
      sessionDir: null,
      createdAt: '2026-03-29T19:00:00.000Z',
      updatedAt: '2026-03-29T19:00:00.000Z'
    });
    await manager.startSession('employee-1');

    await handlersToPromise(first.handlers, 'disconnected', 'NAVIGATION');

    await expect(manager.getSessionHealth('employee-1')).resolves.toEqual(
      expect.objectContaining({
        hasRuntimeSession: true,
        isSessionActive: true,
        runtimeStatus: 'ready',
        whatsappState: 'CONNECTED'
      })
    );
    expect(second.client.destroy).not.toHaveBeenCalled();
  });

  it('should reconnect after an unexpected disconnect only after cleanup completes', async () => {
    jest.useFakeTimers();

    try {
      const first = createClient();
      const second = createClient();
      const factory: WhatsappClientFactory = {
        create: jest
          .fn()
          .mockReturnValueOnce(first.client)
          .mockReturnValueOnce(second.client)
      };
      const logger = createLogger();
      const manager = createSessionManager({
        clientFactory: factory,
        logger,
        qr: {
          generate: jest.fn()
        },
        reconnect: {
          initialDelayMs: 25,
          maxAttempts: 1,
          maxDelayMs: 25
        }
      });

      await manager.startSession('employee-1');
      await handlersToPromise(first.handlers, 'disconnected', 'NAVIGATION');

      expect(first.client.destroy).toHaveBeenCalledTimes(1);
      expect(factory.create).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(25);
      await flushLifecycleQueue();

      expect(factory.create).toHaveBeenCalledTimes(2);
      expect(second.client.initialize).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should not create a replacement client when disconnect cleanup fails', async () => {
    const first = createClient();
    const second = createClient();
    const factory: WhatsappClientFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(first.client)
        .mockReturnValueOnce(second.client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      },
      reconnect: {
        enabled: false
      }
    });

    (first.client.destroy as jest.Mock).mockRejectedValueOnce(new Error('destroy failed'));

    await manager.startSession('employee-1');
    await handlersToPromise(first.handlers, 'disconnected', 'NAVIGATION');
    await manager.startSession('employee-1');

    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(second.client.initialize).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('WhatsApp session cleanup failed', {
      employeeId: 'employee-1',
      error: 'destroy failed'
    });
  });

  it('should reject starting a second runtime session for the same phone number', async () => {
    const first = createClient();
    const second = createClient();
    const factory: WhatsappClientFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(first.client)
        .mockReturnValueOnce(second.client)
    };
    const employees = createEmployeesRepository({
      anna: '380991112233',
      bob: '+380 99 111 22 33'
    });
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      employees,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('anna');
    await expect(manager.startSession('bob')).rejects.toThrow(
      'WhatsApp session phone number is already connected to another employee: anna'
    );

    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(second.client.initialize).not.toHaveBeenCalled();
  });

  it('should report no active runtime session for a new phone number until the user reconnects', async () => {
    const { client } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const employees = createEmployeesRepository({
      anna: '380991112233'
    });
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      employees,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('anna');
    (employees.findByCode as jest.Mock).mockReturnValue({
      id: 1,
      code: 'anna',
      displayName: null,
      phoneNumber: '380991112244',
      isActive: true,
      sessionDir: null,
      createdAt: '2026-03-29T19:00:00.000Z',
      updatedAt: '2026-03-29T19:00:00.000Z'
    });

    await expect(manager.getSessionHealth('anna')).resolves.toEqual(
      expect.objectContaining({
        employeeId: 'anna',
        hasRuntimeSession: false,
        isSessionActive: false,
        runtimeStatus: 'not_started',
        whatsappState: null
      })
    );
  });

  it('should register message listeners', async () => {
    const { client } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('employee-1');

    expect(client.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('message_create', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('call', expect.any(Function));
  });

  it('should route call events through the call handler', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const callHandler = {
      handle: jest.fn()
    };
    const manager = createSessionManager({
      callHandler,
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    } as never);

    await manager.startSession('employee-1');

    await handlers.get('call')?.({
      from: '123@c.us',
      id: 'call-1',
      isVideo: true,
      outgoing: false,
      timestamp: 1712345678
    });

    expect(callHandler.handle).toHaveBeenCalledWith(
      'employee-1',
      {
        callId: 'call:call-1',
        chatId: '123@c.us',
        from: '123@c.us',
        fromMe: false,
        isVideo: true,
        phoneNumber: '123',
        rawPayload: expect.objectContaining({
          from: '123@c.us',
          id: 'call-1'
        }),
        status: 'incoming',
        timestamp: 1712345678,
        to: undefined
      } satisfies CallPayload
    );
  });

  it('should route call_log messages through the call handler instead of the message handler', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const callHandler = {
      handle: jest.fn()
    };
    const messageHandler = {
      handle: jest.fn()
    };
    const manager = createSessionManager({
      callHandler,
      clientFactory: factory,
      logger,
      messageHandler,
      qr: {
        generate: jest.fn()
      }
    } as never);

    await manager.startSession('employee-1');

    await handlers.get('message')?.({
      from: '123@c.us',
      id: {
        _serialized: 'wamid-call-log-1'
      },
      timestamp: 1712345678,
      type: 'call_log'
    });

    expect(callHandler.handle).toHaveBeenCalledWith(
      'employee-1',
      expect.objectContaining({
        callId: 'call:wamid-call-log-1',
        chatId: '123@c.us',
        status: 'incoming'
      })
    );
    expect(messageHandler.handle).not.toHaveBeenCalled();
  });

  it('should prefer the nested call id over the top-level call_log message id', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const callHandler = {
      handle: jest.fn()
    };
    const manager = createSessionManager({
      callHandler,
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    } as never);

    await manager.startSession('employee-1');

    await handlers.get('message')?.({
      _data: {
        id: 'call-underlying-1',
        isMissed: true
      },
      from: '123@c.us',
      id: {
        _serialized: 'wamid-call-log-1'
      },
      timestamp: 1712345678,
      type: 'call_log'
    });

    expect(callHandler.handle).toHaveBeenCalledWith(
      'employee-1',
      expect.objectContaining({
        callId: 'call:call-underlying-1',
        status: 'missed'
      })
    );
  });

  it('should store the raw QR code while waiting for scan', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    (client.getState as jest.Mock).mockResolvedValueOnce('OPENING');

    await manager.startSession('employee-1');
    await handlers.get('qr')?.('raw-qr-code');

    await expect(manager.getSessionHealth('employee-1')).resolves.toEqual(
      expect.objectContaining({
        employeeId: 'employee-1',
        hasRuntimeSession: true,
        qrCode: 'raw-qr-code',
        runtimeStatus: 'waiting_for_qr',
        whatsappState: 'OPENING'
      })
    );
  });

  it('should clear the QR code when the session becomes ready', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('employee-1');
    await handlers.get('qr')?.('raw-qr-code');
    await handlers.get('ready')?.();

    await expect(manager.getSessionHealth('employee-1')).resolves.toEqual(
      expect.objectContaining({
        employeeId: 'employee-1',
        qrCode: null,
        runtimeStatus: 'ready'
      })
    );
  });

  it('should clear the QR code when the session disconnects', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      },
      reconnect: {
        enabled: false
      }
    });

    await manager.startSession('employee-1');
    await handlers.get('qr')?.('raw-qr-code');
    await handlers.get('disconnected')?.('NAVIGATION');

    await expect(manager.getSessionHealth('employee-1')).resolves.toEqual(
      expect.objectContaining({
        employeeId: 'employee-1',
        hasRuntimeSession: false,
        qrCode: null,
        runtimeStatus: 'disconnected'
      })
    );
  });

  it('should emit/log messages correctly', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const messageHandler = {
      handle: jest.fn()
    };
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      },
      messageHandler
    } as never);

    await manager.startSession('employee-1');

    const payload = {
      body: 'hello',
      from: '123@c.us'
    } satisfies MessagePayload;

    await handlers.get('message')?.(payload);

    expect(messageHandler.handle).toHaveBeenCalledWith(
      'employee-1',
      expect.objectContaining({
        body: 'hello',
        chatId: '123@c.us',
        from: '123@c.us',
        phoneNumber: '123',
        rawPayload: payload
      })
    );
  });

  it('should emit/log outgoing messages correctly', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const messageHandler = {
      handle: jest.fn()
    };
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      },
      messageHandler
    } as never);

    await manager.startSession('employee-1');

    const payload = {
      body: 'reply from employee',
      from: 'employee@c.us',
      fromMe: true,
      to: '123@lid'
    } satisfies MessagePayload;

    (client.getContactLidAndPhone as jest.Mock).mockResolvedValueOnce([
      {
        lid: '123@lid',
        pn: '18465431753532'
      }
    ]);

    await handlers.get('message_create')?.(payload);

    expect(client.getContactLidAndPhone).toHaveBeenCalledWith(['123@lid']);
    expect(messageHandler.handle).toHaveBeenCalledWith(
      'employee-1',
      expect.objectContaining({
        body: 'reply from employee',
        chatId: '123@lid',
        from: 'employee@c.us',
        fromMe: true,
        phoneNumber: '18465431753532',
        to: '123@lid',
        rawPayload: payload
      })
    );
  });

  it('should ignore non-outgoing message_create events to avoid duplicate logs', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const messageHandler = {
      handle: jest.fn()
    };
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      },
      messageHandler
    } as never);

    await manager.startSession('employee-1');

    const payload = {
      body: 'incoming copy',
      from: '123@c.us',
      fromMe: false
    } satisfies MessagePayload;

    await handlers.get('message_create')?.(payload);

    expect(messageHandler.handle).not.toHaveBeenCalled();
  });

  it('should destroy the client when the session disconnects', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      },
      reconnect: {
        enabled: false
      }
    });

    await manager.startSession('employee-1');
    await handlers.get('disconnected')?.('NAVIGATION');

    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('should report runtime session health for a ready employee session', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('employee-1');
    await handlers.get('ready')?.();

    await expect(manager.getSessionHealth('employee-1')).resolves.toEqual(
      expect.objectContaining({
        employeeId: 'employee-1',
        hasRuntimeSession: true,
        isSessionActive: true,
        lastCheckedAt: expect.any(String),
        lastEventAt: expect.any(String),
        lastReadyAt: expect.any(String),
        qrCode: null,
        runtimeStatus: 'ready',
        whatsappState: 'CONNECTED'
      })
    );
    expect(client.getState).toHaveBeenCalledTimes(1);
  });

  it('should report a disconnected health state after session disconnect', async () => {
    const { client, handlers } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      },
      reconnect: {
        enabled: false
      }
    });

    await manager.startSession('employee-1');
    await handlers.get('disconnected')?.('NAVIGATION');

    await expect(manager.getSessionHealth('employee-1')).resolves.toEqual(
      expect.objectContaining({
        employeeId: 'employee-1',
        hasRuntimeSession: false,
        isSessionActive: false,
        lastCheckedAt: expect.any(String),
        lastDisconnectReason: 'NAVIGATION',
        qrCode: null,
        runtimeStatus: 'disconnected'
      })
    );
  });

  it('should report inactive health when the health probe sees a non-connected state', async () => {
    const { client } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    (client.getState as jest.Mock).mockResolvedValueOnce('TIMEOUT');

    await manager.startSession('employee-1');
    await expect(manager.getSessionHealth('employee-1')).resolves.toEqual(
      expect.objectContaining({
        employeeId: 'employee-1',
        hasRuntimeSession: true,
        isSessionActive: false,
        lastCheckedAt: expect.any(String),
        qrCode: null,
        runtimeStatus: 'starting',
        whatsappState: 'TIMEOUT'
      })
    );
  });

  it('should destroy all active clients on shutdown', async () => {
    const first = createClient();
    const second = createClient();
    const factory: WhatsappClientFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(first.client)
        .mockReturnValueOnce(second.client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startAll(['employee-1', 'employee-2']);
    await manager.shutdown();

    expect(first.client.destroy).toHaveBeenCalledTimes(1);
    expect(second.client.destroy).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Shutting down WhatsApp sessions', {
      employeeIds: ['employee-1', 'employee-2']
    });
  });

  it('should stop a single active session', async () => {
    const { client } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('employee-1');
    await manager.stopSession('employee-1');

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Stopping WhatsApp session', {
      employeeId: 'employee-1'
    });
  });

  it('should not initialize the same runtime session twice', async () => {
    const { client } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('employee-1');
    await manager.startSession('employee-1');

    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(client.initialize).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('WhatsApp session already active', {
      employeeId: 'employee-1'
    });
  });

  it('should not schedule reconnect or start new clients when shutdown races with disconnect cleanup', async () => {
    jest.useFakeTimers();

    try {
      const first = createClient();
      const second = createClient();
      const factory: WhatsappClientFactory = {
        create: jest
          .fn()
          .mockReturnValueOnce(first.client)
          .mockReturnValueOnce(second.client)
      };
      const logger = createLogger();
      const manager = createSessionManager({
        clientFactory: factory,
        logger,
        qr: {
          generate: jest.fn()
        },
        reconnect: {
          initialDelayMs: 25,
          maxAttempts: 1,
          maxDelayMs: 25
        }
      });

      await manager.startSession('employee-1');

      // Kick off the disconnect cleanup, then immediately start shutdown
      // before the enqueued cleanup microtask has a chance to run.
      const disconnectPromise = first.handlers.get('disconnected')?.('NAVIGATION');
      const shutdownPromise = manager.shutdown();

      await Promise.all([disconnectPromise, shutdownPromise]);

      // Give any errantly scheduled reconnect timer a chance to fire.
      await jest.advanceTimersByTimeAsync(100);
      await flushLifecycleQueue();

      expect(factory.create).toHaveBeenCalledTimes(1);
      expect(second.client.initialize).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('should destroy pending clients and unblock shutdown when initialize hangs', async () => {
    const { client } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn().mockReturnValue(client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      },
      reconnect: {
        enabled: false
      },
      shutdownQueueDrainTimeoutMs: 50
    });

    let rejectInitialize: ((error: Error) => void) | undefined;

    (client.initialize as jest.Mock).mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectInitialize = reject;
      })
    );
    (client.destroy as jest.Mock).mockImplementationOnce(async () => {
      rejectInitialize?.(new Error('destroyed'));
    });

    const startPromise = manager.startSession('employee-1').catch(() => undefined);

    await flushLifecycleQueue();

    expect(client.initialize).toHaveBeenCalledTimes(1);
    expect(client.destroy).not.toHaveBeenCalled();

    await expect(manager.shutdown()).resolves.toBeUndefined();

    expect(client.destroy).toHaveBeenCalled();

    await startPromise;
  });

  it('should bound shutdown by timeout even if destroy does not unblock initialize', async () => {
    jest.useFakeTimers();

    try {
      const { client } = createClient();
      const factory: WhatsappClientFactory = {
        create: jest.fn().mockReturnValue(client)
      };
      const logger = createLogger();
      const manager = createSessionManager({
        clientFactory: factory,
        logger,
        qr: {
          generate: jest.fn()
        },
        reconnect: {
          enabled: false
        },
        shutdownQueueDrainTimeoutMs: 50
      });

      (client.initialize as jest.Mock).mockReturnValueOnce(new Promise<void>(() => undefined));
      (client.destroy as jest.Mock).mockReturnValueOnce(new Promise<void>(() => undefined));

      void manager.startSession('employee-1').catch(() => undefined);
      await flushLifecycleQueue();

      const shutdownPromise = manager.shutdown();
      let shutdownResolved = false;

      void shutdownPromise.then(() => {
        shutdownResolved = true;
      });

      await jest.advanceTimersByTimeAsync(50);
      await flushLifecycleQueue();

      expect(shutdownResolved).toBe(true);
      await expect(shutdownPromise).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'WhatsApp session lifecycle queue did not drain before shutdown timeout',
        expect.objectContaining({ employeeIds: ['employee-1'] })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('should reject queued starts waiting for an initialization slot on shutdown', async () => {
    const first = createClient();
    const second = createClient();
    const factory: WhatsappClientFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(first.client)
        .mockReturnValueOnce(second.client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      maxConcurrentInitializations: 1,
      qr: {
        generate: jest.fn()
      },
      reconnect: {
        enabled: false
      },
      shutdownQueueDrainTimeoutMs: 100
    });

    let resolveFirstInitialize: (() => void) | undefined;

    (first.client.initialize as jest.Mock).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFirstInitialize = resolve;
      })
    );
    (first.client.destroy as jest.Mock).mockImplementationOnce(async () => {
      resolveFirstInitialize?.();
    });

    void manager.startSession('employee-1').catch(() => undefined);
    const secondStart = manager.startSession('employee-2').catch(() => undefined);

    await flushLifecycleQueue();

    expect(first.client.initialize).toHaveBeenCalledTimes(1);
    expect(second.client.initialize).not.toHaveBeenCalled();

    await manager.shutdown();
    await secondStart;

    expect(second.client.initialize).not.toHaveBeenCalled();
  });

  it('should keep the session registered when stopSession cleanup fails', async () => {
    const { client } = createClient();
    const factory: WhatsappClientFactory = {
      create: jest.fn(() => client)
    };
    const logger = createLogger();
    const manager = createSessionManager({
      clientFactory: factory,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    await manager.startSession('employee-1');
    (client.destroy as jest.Mock).mockRejectedValueOnce(new Error('destroy failed'));

    await expect(manager.stopSession('employee-1')).rejects.toThrow('destroy failed');
    await manager.startSession('employee-1');

    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('WhatsApp session already active', {
      employeeId: 'employee-1'
    });
  });
});
