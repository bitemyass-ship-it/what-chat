import { createDatabase } from '../../src/database/database';
import type { Database } from '../../src/database/types';
import type { Logger } from '../../src/types/whatsapp';
import { createCallHandler } from '../../src/whatsapp/call-handler';

describe('createCallHandler', () => {
  const createLogger = (): Logger => ({
    close: jest.fn(),
    error: jest.fn(),
    health: jest.fn(),
    http: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  });

  let database: Database | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it.each([
    {
      body: 'Outgoing call',
      callMediaType: 'voice',
      direction: 'outgoing',
      status: 'outgoing' as const
    },
    {
      body: 'Incoming call',
      callMediaType: 'video',
      direction: 'incoming',
      status: 'incoming' as const
    },
    {
      body: 'Missed call',
      callMediaType: 'voice',
      direction: 'incoming',
      status: 'missed' as const
    }
  ])(
    'should persist $status call rows in the chat timeline',
    async ({ body, callMediaType, direction, status }) => {
      database = createDatabase({
        databasePath: ':memory:',
        logger: createLogger()
      });
      database.employees.create({ code: 'anna' });
      const handler = createCallHandler({
        chats: database.chats,
        messages: database.messages,
        logger: createLogger()
      });

      await handler.handle('anna', {
        callId: `call-${status}`,
        chatId: '123@c.us',
        from: '123@c.us',
        fromMe: status === 'outgoing',
        isVideo: callMediaType === 'video',
        status,
        timestamp: 1712345678,
        to: '15550000001@c.us'
      });

      expect(
        database.messages.findByEmployeeCodeAndExternalMessageId(
          'anna',
          `call:call-${status}`
        )
      ).toEqual(
        expect.objectContaining({
          body,
          callMediaType,
          callStatus: status,
          direction,
          externalMessageId: `call:call-${status}`,
          messageType: 'call'
        })
      );
      expect(database.chats.findByEmployeeCodeAndChatId('anna', '123@c.us')).toEqual(
        expect.objectContaining({
          lastMessageId: `call:call-${status}`,
          lastMessagePreview: body,
          lastMessageTimestamp: 1712345678
        })
      );
    }
  );

  it('should keep one persisted row when the same call arrives twice', async () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    database.employees.create({ code: 'anna' });
    const chat = database.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '123@c.us'
    });
    const handler = createCallHandler({
      chats: database.chats,
      messages: database.messages,
      logger: createLogger()
    });

    await handler.handle('anna', {
      callId: 'dup-1',
      chatId: '123@c.us',
      from: '123@c.us',
      status: 'incoming',
      timestamp: 1712345678
    });
    await handler.handle('anna', {
      callId: 'dup-1',
      chatId: '123@c.us',
      from: '123@c.us',
      isVideo: true,
      status: 'incoming',
      timestamp: 1712345680
    });

    expect(database.messages.countByEmployeeCodeAndChatRecordId('anna', chat.id)).toBe(1);
    expect(
      database.messages.findByEmployeeCodeAndExternalMessageId('anna', 'call:dup-1')
    ).toEqual(
      expect.objectContaining({
        callMediaType: 'video',
        timestamp: 1712345680
      })
    );
  });
});
