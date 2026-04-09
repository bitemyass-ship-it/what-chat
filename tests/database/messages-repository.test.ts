import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../../src/database/database';
import { CHATS_SCHEMA_SQL, EMPLOYEES_SCHEMA_SQL, MESSAGES_SCHEMA_SQL } from '../../src/database/schema';
import { createChatsRepository } from '../../src/database/chats-repository';
import { createEmployeesRepository } from '../../src/database/employees-repository';
import type { Database } from '../../src/database/types';
import type { Logger } from '../../src/types/whatsapp';

describe('messages repository', () => {
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

  it('should insert one message linked to the canonical chat', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });
    const chat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us'
    });

    const message = database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-1',
      sourceChatId: '123@c.us',
      direction: 'incoming',
      body: 'hello'
    });

    expect(message).toEqual(
      expect.objectContaining({
        chatRecordId: chat.id,
        externalMessageId: 'wamid-1',
        body: 'hello',
        direction: 'incoming'
      })
    );
  });

  it('should keep one row when the same external message id is upserted twice', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us'
    });

    const firstMessage = database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-1',
      sourceChatId: '123@c.us',
      direction: 'incoming',
      body: '',
      messageType: 'chat'
    });
    const secondMessage = database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-1',
      sourceChatId: '123@c.us',
      direction: 'incoming',
      body: 'hello',
      ack: 2,
      rawPayloadJson: '{"kind":"full"}'
    });

    expect(secondMessage.id).toBe(firstMessage.id);
    expect(secondMessage.body).toBe('hello');
    expect(secondMessage.ack).toBe(2);
    expect(database.messages.countByEmployeeCodeAndChatRecordId('anna', firstMessage.chatRecordId)).toBe(1);
  });

  it('should resolve canonical chat record across aliases', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });
    const canonicalChat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '999999@lid',
      isPhoneNumberVerified: true,
      phoneNumber: '380991112233'
    });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us'
    });

    const message = database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us',
      externalMessageId: 'wamid-1',
      sourceChatId: '380991112233@c.us',
      direction: 'incoming'
    });

    expect(message.chatRecordId).toBe(canonicalChat.id);
  });

  it('should preserve existing messages when canonical chats merge', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });
    const sourceChat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '999999@lid'
    });
    const targetChat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us'
    });
    database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '999999@lid',
      externalMessageId: 'wamid-1',
      sourceChatId: '999999@lid',
      direction: 'incoming',
      body: 'before merge'
    });

    const mergedChat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '999999@lid',
      isPhoneNumberVerified: true,
      phoneNumber: '380991112233'
    });

    expect(targetChat.id).not.toBe(sourceChat.id);
    expect(mergedChat.id).toBe(targetChat.id);
    expect(
      database.messages.findByEmployeeCodeAndExternalMessageId('anna', 'wamid-1')
    ).toEqual(
      expect.objectContaining({
        chatRecordId: mergedChat.id,
        body: 'before merge'
      })
    );
    expect(database.messages.countByEmployeeCodeAndChatRecordId('anna', mergedChat.id)).toBe(1);
  });

  it('should not downgrade ack on repeated upserts with stale payloads', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us'
    });

    database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-1',
      sourceChatId: '123@c.us',
      direction: 'outgoing',
      ack: 2
    });
    const replayedMessage = database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-1',
      sourceChatId: '123@c.us',
      direction: 'outgoing',
      ack: 1,
      ingestSource: 'poll'
    });

    expect(replayedMessage.ack).toBe(2);
  });

  it('should preserve stronger persisted message fields during replay from another ingest source', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us'
    });

    database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-1',
      sourceChatId: '123@c.us',
      direction: 'incoming',
      body: 'hello',
      messageType: 'image',
      timestamp: 200,
      hasMedia: true,
      isForwarded: true,
      forwardingScore: 2,
      hasQuotedMsg: true,
      quotedMessageExternalId: 'wamid-0',
      ingestSource: 'live',
      rawPayloadJson: '{"kind":"live"}'
    });
    const replayedMessage = database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-1',
      sourceChatId: '123@c.us',
      direction: 'incoming',
      body: '',
      messageType: 'chat',
      timestamp: 100,
      hasMedia: false,
      isForwarded: false,
      forwardingScore: 1,
      hasQuotedMsg: false,
      ingestSource: 'poll'
    });

    expect(replayedMessage).toEqual(
      expect.objectContaining({
        body: 'hello',
        messageType: 'image',
        timestamp: 200,
        hasMedia: true,
        isForwarded: true,
        forwardingScore: 2,
        hasQuotedMsg: true,
        quotedMessageExternalId: 'wamid-0',
        ingestSource: 'live',
        rawPayloadJson: '{"kind":"live"}'
      })
    );
  });

  it('should read and write call metadata fields', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });
    database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us'
    });

    const persistedCall = database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'call:abc',
      sourceChatId: '123@c.us',
      direction: 'incoming',
      body: 'Missed call',
      messageType: 'call',
      callStatus: 'missed',
      callMediaType: 'video',
      timestamp: 200
    });

    expect(persistedCall).toEqual(
      expect.objectContaining({
        body: 'Missed call',
        callMediaType: 'video',
        callStatus: 'missed',
        messageType: 'call'
      })
    );
  });

  it('should include call rows in the mixed timeline ordering', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });
    const chat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us'
    });

    database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-1',
      sourceChatId: '123@c.us',
      direction: 'incoming',
      body: 'before',
      messageType: 'chat',
      timestamp: 100
    });
    database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'call:1',
      sourceChatId: '123@c.us',
      direction: 'incoming',
      body: 'Incoming call',
      messageType: 'call',
      callStatus: 'incoming',
      timestamp: 150
    });
    database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-2',
      sourceChatId: '123@c.us',
      direction: 'outgoing',
      body: 'after',
      messageType: 'chat',
      timestamp: 200
    });

    expect(
      database.messages
        .listByEmployeeCodeAndChatRecordId('anna', chat.id)
        .map((message) => message.externalMessageId)
    ).toEqual(['wamid-2', 'call:1', 'wamid-1']);
  });

  it('should list paginated chat messages with null timestamps last and id-desc tie breaker', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });
    const chat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us'
    });

    const firstTiedMessage = database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-tie-1',
      sourceChatId: '123@c.us',
      direction: 'incoming',
      timestamp: 200
    });
    const secondTiedMessage = database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-tie-2',
      sourceChatId: '123@c.us',
      direction: 'outgoing',
      timestamp: 200
    });
    const olderMessage = database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-older',
      sourceChatId: '123@c.us',
      direction: 'incoming',
      timestamp: 100
    });
    const nullTimestampMessage = database.messages.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us',
      externalMessageId: 'wamid-null',
      sourceChatId: '123@c.us',
      direction: 'system',
      timestamp: null
    });

    expect(
      database.messages.listByEmployeeCodeAndChatRecordId('anna', chat.id, {
        limit: 3,
        offset: 1
      })
    ).toEqual([
      expect.objectContaining({
        id: firstTiedMessage.id,
        externalMessageId: 'wamid-tie-1'
      }),
      expect.objectContaining({
        id: olderMessage.id,
        externalMessageId: 'wamid-older'
      }),
      expect.objectContaining({
        id: nullTimestampMessage.id,
        externalMessageId: 'wamid-null'
      })
    ]);

    expect(secondTiedMessage.id).toBeGreaterThan(firstTiedMessage.id);
  });

  it('should cascade delete messages when removing an employee', () => {
    const connection = new DatabaseSync(':memory:');

    connection.exec('PRAGMA foreign_keys = ON;');
    connection.exec(EMPLOYEES_SCHEMA_SQL);
    connection.exec(CHATS_SCHEMA_SQL);
    connection.exec(MESSAGES_SCHEMA_SQL);

    const employees = createEmployeesRepository(connection);
    const chats = createChatsRepository(connection);
    employees.create({ code: 'anna' });
    chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us'
    });
    connection
      .prepare(`
        INSERT INTO messages (
          employee_id,
          chat_record_id,
          external_message_id,
          source_chat_id,
          direction
        )
        VALUES (1, 1, 'wamid-1', '123@c.us', 'incoming')
      `)
      .run();

    expect(employees.deleteByCode('anna')).toBe(true);
    expect(
      (connection.prepare('SELECT COUNT(*) AS total FROM messages').get() as { total: number }).total
    ).toBe(0);

    connection.close();
  });
});
