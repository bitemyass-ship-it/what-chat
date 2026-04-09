import fs from 'node:fs/promises';
import { createDatabase } from '../../src/database/database';
import { createEmployeesController } from '../../src/controllers/employees-controller';
import type { CreateEmployeeInput, Database, EmployeeRecord } from '../../src/database/types';
import type { Logger, SessionHealth, SessionManager } from '../../src/types/whatsapp';

describe('employees controller', () => {
  const buildSessionHealth = (
    overrides: Partial<SessionHealth> & Pick<SessionHealth, 'employeeId'> = {
      employeeId: 'unknown'
    }
  ): SessionHealth => {
    const { employeeId, ...rest } = overrides;

    return {
      employeeId,
      hasRuntimeSession: false,
      isSessionActive: false,
      lastCheckedAt: null,
      lastDisconnectReason: null,
      lastError: null,
      lastEventAt: null,
      lastReadyAt: null,
      qrCode: null,
      runtimeStatus: 'not_started',
      whatsappState: null,
      ...rest
    };
  };

  const buildEmployeeRecord = (
    overrides: Partial<EmployeeRecord> & Pick<EmployeeRecord, 'code'>
  ): EmployeeRecord => ({
    id: overrides.id ?? 1,
    code: overrides.code,
    displayName: overrides.displayName ?? null,
    phoneNumber: overrides.phoneNumber ?? null,
    isActive: overrides.isActive ?? false,
    sessionDir: overrides.sessionDir ?? null,
    createdAt: overrides.createdAt ?? '2026-03-31 08:10:00',
    updatedAt: overrides.updatedAt ?? '2026-03-31 08:10:00'
  });

  const createLogger = (): Logger => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  });

  const createResponse = () => {
    const response = {
      json: jest.fn(),
      send: jest.fn(),
      status: jest.fn()
    };

    response.status.mockReturnValue(response);
    response.json.mockReturnValue(response);
    response.send.mockReturnValue(response);

    return response;
  };

  let database: Database | undefined;
  let logger: Logger | undefined;
  let removeSessionDirectorySpy: jest.SpiedFunction<typeof fs.rm> | undefined;
  let sessionManager: SessionManager | undefined;

  beforeEach(() => {
    removeSessionDirectorySpy = jest.spyOn(fs, 'rm').mockResolvedValue(undefined);
  });

  afterEach(() => {
    removeSessionDirectorySpy?.mockRestore();
    removeSessionDirectorySpy = undefined;
    database?.close();
    database = undefined;
    logger = undefined;
    sessionManager = undefined;
  });

  const createController = () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    logger = createLogger();
    sessionManager = {
      getSessionHealth: jest.fn().mockResolvedValue(buildSessionHealth()),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn(),
      stopSession: jest.fn()
    };

    return createEmployeesController({
      chats: database.chats,
      employees: database.employees,
      logger,
      messages: database.messages,
      sessionManager
    });
  };

  it('should list employees', () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({ code: 'bob' });
    database?.employees.create({ code: 'anna', displayName: 'Anna' });

    controller.list({} as never, response as never, jest.fn());

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith([
      expect.objectContaining({
        code: 'anna',
        displayName: 'Anna'
      }),
      expect.objectContaining({
        code: 'bob'
      })
    ]);
  });

  it('should return analytics chat rows for an existing employee', () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      displayName: 'Anna'
    });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us',
      displayName: 'Anna Thread',
      phoneNumber: '380991112233',
      isPhoneNumberVerified: true,
      lastMessagePreview: 'Latest Anna preview',
      lastMessageTimestamp: 171234567
    });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: 'fallback@lid',
      displayName: null,
      isPhoneNumberVerified: false
    });
    database?.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us',
      externalMessageId: 'wamid-incoming',
      sourceChatId: '380991112233@c.us',
      direction: 'incoming',
      body: 'Incoming hello',
      timestamp: 171234560
    });
    database?.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us',
      externalMessageId: 'wamid-outgoing',
      sourceChatId: '380991112233@c.us',
      direction: 'outgoing',
      body: 'Outgoing hello',
      timestamp: 171234567
    });
    database?.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us',
      externalMessageId: 'wamid-system',
      sourceChatId: '380991112233@c.us',
      direction: 'system',
      body: 'System note'
    });

    controller.getChats(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      items: [
        {
          chatRecordId: 1,
          displayName: 'Anna Thread',
          phoneNumber: '380991112233',
          rawChatLabel: '380991112233@c.us',
          firstMessageAt: new Date(171234560000).toISOString(),
          lastMessageAt: new Date(171234567000).toISOString(),
          lastMessagePreview: 'Latest Anna preview',
          totalMessages: 2,
          incomingMessages: 1,
          outgoingMessages: 1
        },
        {
          chatRecordId: 2,
          displayName: null,
          phoneNumber: null,
          rawChatLabel: 'fallback@lid',
          firstMessageAt: null,
          lastMessageAt: null,
          lastMessagePreview: null,
          totalMessages: 0,
          incomingMessages: 0,
          outgoingMessages: 0
        }
      ],
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1
    });
  });

  it('should paginate employee chats and keep backend sort order stable', () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      displayName: 'Anna'
    });

    for (let chatNumber = 1; chatNumber <= 21; chatNumber += 1) {
      const lastMessageTimestamp = chatNumber <= 2 ? 3_000 : 2_000 - chatNumber;

      database?.chats.upsertByEmployeeCode({
        employeeCode: 'anna',
        chatId: `chat-${chatNumber}@c.us`,
        displayName: `Chat ${chatNumber}`,
        lastMessageTimestamp
      });
    }

    controller.getChats(
      {
        params: {
          code: 'anna'
        },
        query: {
          page: '1',
          pageSize: '20'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      items: expect.arrayContaining([
        expect.objectContaining({
          chatRecordId: 1,
          rawChatLabel: 'chat-1@c.us'
        }),
        expect.objectContaining({
          chatRecordId: 2,
          rawChatLabel: 'chat-2@c.us'
        })
      ]),
      page: 1,
      pageSize: 20,
      total: 21,
      totalPages: 2
    });

    const firstPayload = response.json.mock.calls[0]?.[0] as {
      items: Array<{ chatRecordId: number; rawChatLabel: string }>;
    };

    expect(firstPayload.items).toHaveLength(20);
    expect(firstPayload.items[0]).toEqual(
      expect.objectContaining({
        chatRecordId: 1,
        rawChatLabel: 'chat-1@c.us'
      })
    );
    expect(firstPayload.items[1]).toEqual(
      expect.objectContaining({
        chatRecordId: 2,
        rawChatLabel: 'chat-2@c.us'
      })
    );
    expect(firstPayload.items[19]).toEqual(
      expect.objectContaining({
        chatRecordId: 20,
        rawChatLabel: 'chat-20@c.us'
      })
    );
  });

  it('should return an empty page when employee chats page is outside the available range', () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      displayName: 'Anna'
    });

    for (let chatNumber = 1; chatNumber <= 31; chatNumber += 1) {
      database?.chats.upsertByEmployeeCode({
        employeeCode: 'anna',
        chatId: `chat-${chatNumber}@c.us`,
        lastMessageTimestamp: chatNumber
      });
    }

    controller.getChats(
      {
        params: {
          code: 'anna'
        },
        query: {
          page: '9'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      items: [],
      page: 9,
      pageSize: 20,
      total: 31,
      totalPages: 2
    });
  });

  it('should reject invalid employee chats page query values', () => {
    const controller = createController();
    const response = createResponse();

    controller.getChats(
      {
        params: {
          code: 'anna'
        },
        query: {
          page: '0'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'page query parameter must be a positive integer'
    });
  });

  it('should reject invalid employee chats pageSize query values', () => {
    const controller = createController();
    const response = createResponse();

    controller.getChats(
      {
        params: {
          code: 'anna'
        },
        query: {
          pageSize: '10'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'pageSize query parameter must be 20'
    });
  });

  it('should return 404 when employee chats are requested for an unknown employee', () => {
    const controller = createController();
    const response = createResponse();

    controller.getChats(
      {
        params: {
          code: 'missing'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Employee not found: missing'
    });
  });

  it('should return persisted messages for a known employee chat', () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      displayName: 'Anna'
    });
    const chat = database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us',
      displayName: 'Anna Thread',
      phoneNumber: '380991112233',
      isPhoneNumberVerified: true
    });
    database?.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us',
      externalMessageId: 'wamid-outgoing',
      sourceChatId: '380991112233@c.us',
      direction: 'outgoing',
      body: 'Latest message',
      messageType: 'chat',
      timestamp: 171234568
    });
    database?.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us',
      externalMessageId: 'wamid-incoming',
      sourceChatId: '380991112233@c.us',
      direction: 'incoming',
      body: 'Older message',
      messageType: 'image',
      timestamp: 171234567
    });

    controller.getChatMessages(
      {
        params: {
          code: 'anna',
          chatRecordId: String(chat?.id)
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      items: [
        {
          messageId: 1,
          externalMessageId: 'wamid-outgoing',
          timestamp: new Date(171234568000).toISOString(),
          direction: 'outgoing',
          body: 'Latest message',
          messageType: 'chat'
        },
        {
          messageId: 2,
          externalMessageId: 'wamid-incoming',
          timestamp: new Date(171234567000).toISOString(),
          direction: 'incoming',
          body: 'Older message',
          messageType: 'image'
        }
      ],
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1
    });
  });

  it('should paginate employee chat messages and preserve backend ordering', () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      displayName: 'Anna'
    });
    const chat = database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us'
    });

    for (let messageNumber = 1; messageNumber <= 21; messageNumber += 1) {
      database?.messages.upsertByEmployeeCode({
        employeeCode: 'anna',
        chatId: '380991112233@c.us',
        externalMessageId: `wamid-${messageNumber}`,
        sourceChatId: '380991112233@c.us',
        direction: messageNumber % 2 === 0 ? 'incoming' : 'outgoing',
        body: `Message ${messageNumber}`,
        messageType: 'chat',
        timestamp: messageNumber <= 2 ? 3_000 : 2_000 - messageNumber
      });
    }

    controller.getChatMessages(
      {
        params: {
          code: 'anna',
          chatRecordId: String(chat?.id)
        },
        query: {
          page: '1',
          pageSize: '20'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);

    const firstPayload = response.json.mock.calls[0]?.[0] as {
      items: Array<{ externalMessageId: string; messageId: number }>;
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };

    expect(firstPayload.page).toBe(1);
    expect(firstPayload.pageSize).toBe(20);
    expect(firstPayload.total).toBe(21);
    expect(firstPayload.totalPages).toBe(2);
    expect(firstPayload.items).toHaveLength(20);
    expect(firstPayload.items[0]).toEqual(
      expect.objectContaining({
        messageId: 2,
        externalMessageId: 'wamid-2'
      })
    );
    expect(firstPayload.items[1]).toEqual(
      expect.objectContaining({
        messageId: 1,
        externalMessageId: 'wamid-1'
      })
    );
    expect(firstPayload.items[19]).toEqual(
      expect.objectContaining({
        messageId: 20,
        externalMessageId: 'wamid-20'
      })
    );
  });

  it('should return an empty page when employee chat messages page is outside the available range', () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      displayName: 'Anna'
    });
    const chat = database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us'
    });

    for (let messageNumber = 1; messageNumber <= 11; messageNumber += 1) {
      database?.messages.upsertByEmployeeCode({
        employeeCode: 'anna',
        chatId: '380991112233@c.us',
        externalMessageId: `wamid-${messageNumber}`,
        sourceChatId: '380991112233@c.us',
        direction: 'incoming',
        body: `Message ${messageNumber}`,
        messageType: 'chat',
        timestamp: messageNumber
      });
    }

    controller.getChatMessages(
      {
        params: {
          code: 'anna',
          chatRecordId: String(chat?.id)
        },
        query: {
          page: '8'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      items: [],
      page: 8,
      pageSize: 20,
      total: 11,
      totalPages: 1
    });
  });

  it('should return 404 when chat messages are requested for an unknown chat record', () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      displayName: 'Anna'
    });

    controller.getChatMessages(
      {
        params: {
          code: 'anna',
          chatRecordId: '999'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Chat not found: 999'
    });
  });

  it('should reject invalid employee chat messages page query values', () => {
    const controller = createController();
    const response = createResponse();

    controller.getChatMessages(
      {
        params: {
          code: 'anna',
          chatRecordId: '1'
        },
        query: {
          page: '0'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'page query parameter must be a positive integer'
    });
  });

  it('should reject invalid employee chat messages pageSize query values', () => {
    const controller = createController();
    const response = createResponse();

    controller.getChatMessages(
      {
        params: {
          code: 'anna',
          chatRecordId: '1'
        },
        query: {
          pageSize: '10'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'pageSize query parameter must be 20'
    });
  });

  it('should return 404 when messages are requested for an unknown employee', () => {
    const controller = createController();
    const response = createResponse();

    controller.getChatMessages(
      {
        params: {
          code: 'missing',
          chatRecordId: '1'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Employee not found: missing'
    });
  });

  it('should create an employee from display name only', async () => {
    const controller = createController();
    const response = createResponse();

    await controller.create(
      {
        body: {
          displayName: 'Anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'anna',
        displayName: 'Anna',
        isActive: false,
        phoneNumber: null,
        sessionDir: null
      })
    );
    expect(database?.employees.findByCode('anna')).toEqual(
      expect.objectContaining({
        code: 'anna',
        displayName: 'Anna',
        isActive: false,
        phoneNumber: null,
        sessionDir: null
      })
    );
    expect(sessionManager?.startSession).not.toHaveBeenCalled();
  });

  it('should trim display name before saving', async () => {
    const controller = createController();
    const response = createResponse();

    await controller.create(
      {
        body: {
          displayName: '  Anna Petrova  '
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'anna-petrova',
        displayName: 'Anna Petrova'
      })
    );
  });

  it('should reject missing displayName', async () => {
    const controller = createController();
    const response = createResponse();

    await controller.create(
      {
        body: {}
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'displayName is required'
    });
  });

  it('should reject empty displayName', async () => {
    const controller = createController();
    const response = createResponse();

    await controller.create(
      {
        body: {
          displayName: '   '
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'displayName cannot be empty'
    });
  });

  it('should reject non-string displayName', async () => {
    const controller = createController();
    const response = createResponse();

    await controller.create(
      {
        body: {
          displayName: 123
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'displayName must be a string'
    });
  });

  it.each([
    ['code', { code: 'anna' }, 'code is not allowed'],
    ['phoneNumber', { phoneNumber: '380991112233' }, 'phoneNumber is not allowed'],
    ['isActive', { isActive: true }, 'isActive is not allowed'],
    ['sessionDir', { sessionDir: 'sessions/anna' }, 'sessionDir is not allowed']
  ])(
    'should reject forbidden create field %s',
    async (_fieldName, forbiddenPayload, expectedError) => {
      const controller = createController();
      const response = createResponse();

      await controller.create(
        {
          body: {
            displayName: 'Anna',
            ...forbiddenPayload
          }
        } as never,
        response as never,
        jest.fn()
      );

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith({
        error: expectedError
      });
    }
  );

  it('should transliterate Cyrillic display names into employee codes', async () => {
    const controller = createController();
    const response = createResponse();

    await controller.create(
      {
        body: {
          displayName: 'Анна Петрова'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'anna-petrova',
        displayName: 'Анна Петрова'
      })
    );
  });

  it('should return an employee by code', () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({ code: 'anna', displayName: 'Anna' });

    controller.getByCode(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'anna',
        displayName: 'Anna'
      })
    );
  });

  it('should return employee session health by code', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({ code: 'anna', isActive: true });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        lastCheckedAt: '2026-03-29T20:00:00.000Z',
        lastEventAt: '2026-03-29T19:59:00.000Z',
        lastReadyAt: '2026-03-29T19:58:00.000Z',
        runtimeStatus: 'ready',
        whatsappState: 'CONNECTED'
      })
    );

    await controller.getHealth(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      whatsappActive: true
    });
  });

  it('should update an employee and stop the runtime session when deactivated', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      displayName: 'Anna',
      phoneNumber: '380991112233'
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        runtimeStatus: 'ready'
      })
    );

    await controller.update(
      {
        body: {
          displayName: 'Team Anna',
          isActive: false
        },
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'anna',
        displayName: 'Team Anna',
        phoneNumber: '380991112233',
        isActive: false
      })
    );
    expect(sessionManager?.stopSession).toHaveBeenCalledWith('anna');
    expect(removeSessionDirectorySpy).toHaveBeenCalledWith(
      expect.stringContaining('session-380991112233'),
      expect.objectContaining({
        force: true,
        recursive: true
      })
    );
  });

  it('should stop the runtime session when an active employee phone number changes', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      displayName: 'Anna',
      phoneNumber: '380991112233'
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        runtimeStatus: 'ready'
      })
    );

    await controller.update(
      {
        body: {
          phoneNumber: '+380 99 111 22 44'
        },
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'anna',
        phoneNumber: '+380 99 111 22 44',
        isActive: false
      })
    );
    expect(sessionManager?.stopSession).toHaveBeenCalledWith('anna');
    expect(sessionManager?.startSession).not.toHaveBeenCalled();
    expect(removeSessionDirectorySpy).not.toHaveBeenCalled();
  });

  it('should rollback employee update when stopSession fails during deactivation', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      displayName: 'Anna',
      isActive: true
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        runtimeStatus: 'ready'
      })
    );
    (sessionManager?.stopSession as jest.Mock).mockRejectedValueOnce(
      new Error('destroy failed')
    );

    await controller.update(
      {
        body: {
          isActive: false
        },
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Failed to update WhatsApp session state'
    });
    expect(database?.employees.findByCode('anna')).toEqual(
      expect.objectContaining({
        code: 'anna',
        isActive: true
      })
    );
    expect(sessionManager?.startSession).not.toHaveBeenCalled();
  });

  it('should delete an employee with existing chats', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      phoneNumber: '380991112233'
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        runtimeStatus: 'ready'
      })
    );
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '999999@lid',
      isPhoneNumberVerified: true,
      phoneNumber: '380991112233'
    });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us'
    });

    await controller.remove(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(204);
    expect(database?.employees.findByCode('anna')).toBeUndefined();
    expect(database?.chats.countByEmployeeCode('anna')).toBe(0);
    expect(sessionManager?.stopSession).toHaveBeenCalledWith('anna');
    expect(removeSessionDirectorySpy).toHaveBeenCalled();
  });

  it('should stop a leaked runtime session before deleting an inactive employee', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      isActive: false,
      phoneNumber: '380991112233'
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        runtimeStatus: 'waiting_for_qr',
        qrCode: 'raw-qr-code'
      })
    );

    await controller.remove(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(204);
    expect(sessionManager?.stopSession).toHaveBeenCalledWith('anna');
    expect(removeSessionDirectorySpy).toHaveBeenCalled();
    expect(database?.employees.findByCode('anna')).toBeUndefined();
  });

  it('should not delete an employee when stopSession fails', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({ code: 'anna' });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        runtimeStatus: 'ready'
      })
    );
    (sessionManager?.stopSession as jest.Mock).mockRejectedValueOnce(
      new Error('destroy failed')
    );

    await controller.remove(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Failed to delete employee'
    });
    expect(database?.employees.findByCode('anna')).toEqual(
      expect.objectContaining({
        code: 'anna',
        isActive: true
      })
    );
    expect(sessionManager?.startSession).not.toHaveBeenCalled();
  });

  it('should restart a stopped runtime session when delete fails after stop even for inactive employees', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      isActive: false,
      phoneNumber: '380991112233'
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        runtimeStatus: 'waiting_for_qr'
      })
    );
    removeSessionDirectorySpy?.mockRejectedValueOnce(new Error('rm failed'));

    await controller.remove(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Failed to delete employee'
    });
    expect(sessionManager?.stopSession).toHaveBeenCalledWith('anna');
    expect(sessionManager?.startSession).toHaveBeenCalledWith('anna');
    expect(database?.employees.findByCode('anna')).toEqual(
      expect.objectContaining({
        code: 'anna',
        isActive: false
      })
    );
  });

  it('should rollback disable when deleting the stored WhatsApp session directory fails', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      isActive: true,
      phoneNumber: '380991112233'
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        runtimeStatus: 'ready'
      })
    );
    removeSessionDirectorySpy?.mockRejectedValueOnce(new Error('rm failed'));

    await controller.update(
      {
        body: {
          isActive: false
        },
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(database?.employees.findByCode('anna')).toEqual(
      expect.objectContaining({
        code: 'anna',
        isActive: true
      })
    );
    expect(sessionManager?.startSession).toHaveBeenCalledWith('anna');
  });

  it('should enable an employee without starting the runtime session in the profile PATCH flow', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      isActive: false,
      phoneNumber: '380991112233'
    });

    await controller.update(
      {
        body: {
          isActive: true
        },
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'anna',
        isActive: true
      })
    );
    expect(sessionManager?.startSession).not.toHaveBeenCalled();
    expect(sessionManager?.stopSession).not.toHaveBeenCalled();
  });

  it('should allocate suffixed employee codes for duplicate display names', async () => {
    const controller = createController();
    const firstResponse = createResponse();
    const secondResponse = createResponse();
    const thirdResponse = createResponse();

    await controller.create(
      {
        body: {
          displayName: 'Anna'
        }
      } as never,
      firstResponse as never,
      jest.fn()
    );
    await controller.create(
      {
        body: {
          displayName: 'Anna'
        }
      } as never,
      secondResponse as never,
      jest.fn()
    );
    await controller.create(
      {
        body: {
          displayName: 'Anna'
        }
      } as never,
      thirdResponse as never,
      jest.fn()
    );

    expect(firstResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'anna'
      })
    );
    expect(secondResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'anna-2'
      })
    );
    expect(thirdResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'anna-3'
      })
    );
  });

  it('should retry with the next candidate when create hits a unique constraint race', async () => {
    logger = createLogger();
    sessionManager = {
      getSessionHealth: jest.fn().mockResolvedValue(buildSessionHealth()),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn(),
      stopSession: jest.fn()
    };

    const createMock = jest
      .fn<EmployeeRecord, [CreateEmployeeInput]>()
      .mockImplementationOnce(() => {
        throw new Error('UNIQUE constraint failed: employees.code');
      })
      .mockImplementationOnce((input) =>
        buildEmployeeRecord({
          code: input.code,
          displayName: input.displayName ?? null,
          phoneNumber: input.phoneNumber ?? null,
          isActive: input.isActive ?? false,
          sessionDir: input.sessionDir ?? null
        })
      );

    const controller = createEmployeesController({
      chats: {
        countByEmployeeCode: jest.fn(),
        findByEmployeeCodeAndChatId: jest.fn(),
        findByEmployeeCodeAndRecordId: jest.fn(),
        listAnalyticsByEmployeeCode: jest.fn(),
        listByEmployeeCode: jest.fn(),
        upsertByEmployeeCode: jest.fn()
      },
      employees: {
        count: jest.fn(),
        create: createMock,
        deleteByCode: jest.fn(),
        findByCode: jest.fn(() => undefined),
        listActive: jest.fn(),
        listAll: jest.fn(),
        seedCodes: jest.fn(),
        upsert: jest.fn()
      },
      logger,
      messages: {
        countByEmployeeCodeAndChatRecordId: jest.fn(),
        findByEmployeeCodeAndExternalMessageId: jest.fn(),
        listByEmployeeCodeAndChatRecordId: jest.fn(),
        upsertByEmployeeCode: jest.fn()
      },
      sessionManager
    });
    const response = createResponse();

    await controller.create(
      {
        body: {
          displayName: 'Anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({
      code: 'anna-2',
      createdAt: '2026-03-31 08:10:00',
      displayName: 'Anna',
      id: 1,
      isActive: false,
      phoneNumber: null,
      sessionDir: null,
      updatedAt: '2026-03-31 08:10:00'
    });
    expect(createMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        code: 'anna'
      })
    );
    expect(createMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        code: 'anna-2'
      })
    );
  });

  it('should return 404 for unknown employee update', async () => {
    const controller = createController();
    const response = createResponse();

    await controller.update(
      {
        body: {
          displayName: 'Missing'
        },
        params: {
          code: 'missing'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Employee not found: missing'
    });
  });

  it('should return 400 for invalid patch payload even when employee is missing', async () => {
    const controller = createController();
    const response = createResponse();

    await controller.update(
      {
        body: {
          code: 'anna'
        },
        params: {
          code: 'missing'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'code in body must match route parameter'
    });
  });

  it('should return a stable conflict response when unique code allocation is exhausted', async () => {
    logger = createLogger();
    sessionManager = {
      getSessionHealth: jest.fn().mockResolvedValue(buildSessionHealth()),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn(),
      stopSession: jest.fn()
    };

    const controller = createEmployeesController({
      chats: {
        countByEmployeeCode: jest.fn(),
        findByEmployeeCodeAndChatId: jest.fn(),
        findByEmployeeCodeAndRecordId: jest.fn(),
        listAnalyticsByEmployeeCode: jest.fn(),
        listByEmployeeCode: jest.fn(),
        upsertByEmployeeCode: jest.fn()
      },
      employees: {
        count: jest.fn(),
        create: jest.fn(() => {
          throw new Error('UNIQUE constraint failed: employees.code');
        }),
        deleteByCode: jest.fn(),
        findByCode: jest.fn(() => undefined),
        listActive: jest.fn(),
        listAll: jest.fn(),
        seedCodes: jest.fn(),
        upsert: jest.fn()
      },
      logger,
      messages: {
        countByEmployeeCodeAndChatRecordId: jest.fn(),
        findByEmployeeCodeAndExternalMessageId: jest.fn(),
        listByEmployeeCodeAndChatRecordId: jest.fn(),
        upsertByEmployeeCode: jest.fn()
      },
      sessionManager
    });
    const response = createResponse();

    await controller.create(
      {
        body: {
          displayName: 'Anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Unable to allocate unique employee code'
    });
  });

  it('should return 500 and hide internal errors from employee reads', () => {
    logger = createLogger();
    sessionManager = {
      getSessionHealth: jest.fn().mockResolvedValue(buildSessionHealth()),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn(),
      stopSession: jest.fn()
    };

    const controller = createEmployeesController({
      chats: {
        countByEmployeeCode: jest.fn(),
        findByEmployeeCodeAndChatId: jest.fn(),
        findByEmployeeCodeAndRecordId: jest.fn(),
        listAnalyticsByEmployeeCode: jest.fn(),
        listByEmployeeCode: jest.fn(),
        upsertByEmployeeCode: jest.fn()
      },
      employees: {
        count: jest.fn(),
        create: jest.fn(),
        deleteByCode: jest.fn(),
        findByCode: jest.fn(() => {
          throw new Error('database is closed');
        }),
        listActive: jest.fn(),
        listAll: jest.fn(),
        seedCodes: jest.fn(),
        upsert: jest.fn()
      },
      logger,
      messages: {
        countByEmployeeCodeAndChatRecordId: jest.fn(),
        findByEmployeeCodeAndExternalMessageId: jest.fn(),
        listByEmployeeCodeAndChatRecordId: jest.fn(),
        upsertByEmployeeCode: jest.fn()
      },
      sessionManager
    });
    const response = createResponse();

    controller.getByCode(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Failed to read employee'
    });
    expect(logger.error).toHaveBeenCalledWith('Employee lookup failed', {
      code: 'anna',
      error: 'database is closed'
    });
  });
});
