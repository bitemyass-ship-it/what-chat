import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../../src/database/database';
import { CHATS_SCHEMA_SQL, EMPLOYEES_SCHEMA_SQL } from '../../src/database/schema';
import type { Database } from '../../src/database/types';
import type { Logger } from '../../src/types/whatsapp';

describe('chats repository', () => {
  const createLogger = (): Logger => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  });

  let database: Database | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it('should save chats linked to an employee', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    const employee = database.employees.create({ code: 'anna' });

    const chat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      displayName: 'Customer Anna',
      chatKind: 'direct',
      isArchived: true,
      isPinned: true,
      unreadCount: 4,
      lastMessageId: 'wamid-1',
      lastMessagePreview: 'hello',
      phoneNumber: '123',
      lastMessageTimestamp: 171234567
    });

    expect(chat).toEqual(
      expect.objectContaining({
        employeeId: employee.id,
        chatId: '123@c.us',
        displayName: 'Customer Anna',
        chatKind: 'direct',
        isArchived: true,
        isPinned: true,
        unreadCount: 4,
        lastMessageId: 'wamid-1',
        lastMessagePreview: 'hello',
        phoneNumber: '123',
        lastMessageTimestamp: 171234567
      })
    );
  });

  it('should ignore fake phone numbers derived from lid aliases', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });

    const chat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123456789@lid',
      phoneNumber: '123456789'
    });

    expect(chat).toEqual(
      expect.objectContaining({
        chatId: '123456789@lid',
        phoneNumber: null
      })
    );
  });

  it('should list only chats belonging to the requested employee', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });

    database.employees.create({ code: 'anna' });
    database.employees.create({ code: 'bob' });

    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '222@c.us'
    });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '111@c.us'
    });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'bob',
      chatId: '999@c.us'
    });

    expect(database.chats.listByEmployeeCode('anna')).toEqual([
      expect.objectContaining({
        chatId: '111@c.us'
      }),
      expect.objectContaining({
        chatId: '222@c.us'
      })
    ]);
  });

  it('should keep the newest message timestamp and preserve phone number when absent in updates', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });

    database.employees.create({ code: 'anna' });

    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      phoneNumber: '123',
      lastMessageTimestamp: 200
    });

    const chat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      lastMessageTimestamp: 100
    });

    expect(chat).toEqual(
      expect.objectContaining({
        phoneNumber: '123',
        lastMessageTimestamp: 200
      })
    );
  });

  it('should preserve stronger chat metadata when a stale replay arrives', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });

    database.employees.create({ code: 'anna' });

    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      displayName: 'Primary customer',
      chatKind: 'group',
      lastMessageId: 'wamid-2',
      lastMessagePreview: 'new preview',
      lastMessageTimestamp: 200
    });

    const replayedChat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      lastMessagePreview: '',
      lastMessageTimestamp: 100
    });

    expect(replayedChat).toEqual(
      expect.objectContaining({
        displayName: 'Primary customer',
        chatKind: 'group',
        lastMessageId: 'wamid-2',
        lastMessagePreview: 'new preview',
        lastMessageTimestamp: 200
      })
    );
  });

  it('should not overwrite a stored phone number with a weaker lid value', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });

    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '999999@lid',
      isPhoneNumberVerified: true,
      phoneNumber: '380991112233'
    });

    const chat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '999999@lid',
      phoneNumber: '999999'
    });

    expect(chat).toEqual(
      expect.objectContaining({
        phoneNumber: '380991112233'
      })
    );
  });

  it('should deduplicate one contact across lid and c.us aliases for the same employee', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });

    const firstChat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '999999@lid',
      isPhoneNumberVerified: true,
      phoneNumber: '380991112233'
    });

    const secondChat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us'
    });

    expect(firstChat.id).toBe(secondChat.id);
    expect(database.chats.listByEmployeeCode('anna')).toHaveLength(1);
    expect(database.chats.findByEmployeeCodeAndChatId('anna', '999999@lid')).toEqual(
      expect.objectContaining({
        id: secondChat.id,
        phoneNumber: '380991112233'
      })
    );
    expect(
      database.chats.findByEmployeeCodeAndChatId('anna', '380991112233@c.us')
    ).toEqual(
      expect.objectContaining({
        id: secondChat.id,
        phoneNumber: '380991112233'
      })
    );
  });

  it('should reject chats for unknown employees', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });

    expect(() =>
      database?.chats.upsertByEmployeeCode({
        employeeCode: 'missing',
        chatId: '123@c.us'
      })
    ).toThrow('Employee not found: missing');
  });

  it('should count chats for an employee', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });
    database.employees.create({ code: 'bob' });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '111@c.us'
    });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '222@c.us'
    });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'bob',
      chatId: '999@c.us'
    });

    expect(database.chats.countByEmployeeCode('anna')).toBe(2);
    expect(database.chats.countByEmployeeCode('bob')).toBe(1);
    expect(database.chats.countByEmployeeCode('missing')).toBe(0);
  });

  it('should list paginated analytics rows with deterministic backend ordering', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });

    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: 'chat-b@c.us',
      lastMessageTimestamp: 200
    });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: 'chat-a@c.us',
      lastMessageTimestamp: 200
    });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: 'chat-c@c.us',
      lastMessageTimestamp: 100
    });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: 'chat-null@c.us'
    });

    database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: 'chat-a@c.us',
      externalMessageId: 'wamid-a-1',
      sourceChatId: 'chat-a@c.us',
      direction: 'incoming',
      body: 'hello',
      timestamp: 150
    });
    database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: 'chat-a@c.us',
      externalMessageId: 'wamid-a-2',
      sourceChatId: 'chat-a@c.us',
      direction: 'outgoing',
      body: 'world',
      timestamp: 200
    });
    database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: 'chat-c@c.us',
      externalMessageId: 'wamid-c-1',
      sourceChatId: 'chat-c@c.us',
      direction: 'system',
      body: 'system',
      timestamp: 100
    });
    database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: 'chat-a@c.us',
      externalMessageId: 'call:a-1',
      sourceChatId: 'chat-a@c.us',
      direction: 'incoming',
      body: 'Missed call',
      messageType: 'call',
      callStatus: 'missed',
      timestamp: 250
    });

    expect(
      database.chats.listAnalyticsByEmployeeCode('anna', {
        limit: 2,
        offset: 1
      })
    ).toEqual([
      expect.objectContaining({
        id: 2,
        chatId: 'chat-a@c.us',
        firstMessageTimestamp: 150,
        totalMessages: 2,
        incomingMessages: 1,
        outgoingMessages: 1
      }),
      expect.objectContaining({
        id: 3,
        chatId: 'chat-c@c.us',
        firstMessageTimestamp: 100,
        totalMessages: 0,
        incomingMessages: 0,
        outgoingMessages: 0
      })
    ]);
  });

  it('should resume an interrupted legacy chats migration without duplicating data', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-monitor-migration-'));
    const databasePath = path.join(tempDirectory, 'app.sqlite');
    const connection = new DatabaseSync(databasePath);

    connection.exec(EMPLOYEES_SCHEMA_SQL);
    connection.exec(CHATS_SCHEMA_SQL);
    connection.exec(`
      CREATE TABLE chats_legacy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        chat_id TEXT NOT NULL,
        phone_number TEXT,
        last_message_timestamp INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    connection
      .prepare(`
        INSERT INTO employees (code, is_active)
        VALUES ('anna', 1)
      `)
      .run();
    connection
      .prepare(`
        INSERT INTO chats (
          employee_id,
          contact_key,
          chat_id,
          phone_number,
          last_message_timestamp
        )
        VALUES (1, 'phone:380991112233', '999999@lid', '380991112233', 200)
      `)
      .run();
    connection
      .prepare(`
        INSERT INTO chat_aliases (
          chat_record_id,
          employee_id,
          alias_chat_id
        )
        VALUES (1, 1, '999999@lid')
      `)
      .run();
    connection
      .prepare(`
        INSERT INTO chats_legacy (
          employee_id,
          chat_id,
          phone_number,
          last_message_timestamp
        )
        VALUES (1, '999999@lid', '380991112233', 200)
      `)
      .run();
    connection.close();

    database = createDatabase({
      databasePath,
      logger: createLogger()
    });

    expect(database.chats.listByEmployeeCode('anna')).toHaveLength(1);
    expect(
      database.chats.findByEmployeeCodeAndChatId('anna', '999999@lid')
    ).toEqual(
      expect.objectContaining({
        phoneNumber: '380991112233',
        lastMessageTimestamp: 200
      })
    );

    const verificationConnection = new DatabaseSync(databasePath);
    expect(
      verificationConnection
        .prepare(`
          SELECT COUNT(*) AS total
          FROM sqlite_master
          WHERE type = 'table'
            AND name = 'chats_legacy'
        `)
        .get() as { total: number }
    ).toEqual({ total: 0 });
    verificationConnection.close();
  });
});
