import { createDatabase } from '../../src/database/database';
import type { Database } from '../../src/database/types';
import type { Logger } from '../../src/types/whatsapp';
import { DEV_EMPLOYEE_CODE, seedDevData } from '../../scripts/reset-dev-data';

describe('reset-dev-data seed', () => {
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

  it('should seed incoming, outgoing and missed calls into the dev dataset', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });

    seedDevData(database);

    const chats = database.chats.listByEmployeeCode(DEV_EMPLOYEE_CODE);
    const timeline = chats.flatMap((chat) =>
      database?.messages.listByEmployeeCodeAndChatRecordId(DEV_EMPLOYEE_CODE, chat.id) ?? []
    );
    const calls = timeline.filter((message) => message.messageType === 'call');

    expect(
      timeline.some((message) => message.messageType === 'call' && message.callStatus === 'incoming')
    ).toBe(true);
    expect(
      timeline.some((message) => message.messageType === 'call' && message.callStatus === 'outgoing')
    ).toBe(true);
    expect(
      timeline.some((message) => message.messageType === 'call' && message.callStatus === 'missed')
    ).toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(chats.length);
    expect(
      chats.some((chat) =>
        ['Incoming call', 'Outgoing call', 'Missed call'].includes(
          chat.lastMessagePreview ?? ''
        )
      )
    ).toBe(true);
    expect(
      chats.every((chat) => {
        const chatMessages =
          database?.messages
            .listByEmployeeCodeAndChatRecordId(DEV_EMPLOYEE_CODE, chat.id)
            .filter((message) => message.messageType === 'chat') ?? [];

        return chatMessages.length >= 20 && chatMessages.length <= 50;
      })
    ).toBe(true);
  });
});
