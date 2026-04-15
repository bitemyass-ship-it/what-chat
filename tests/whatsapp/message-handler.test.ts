describe('createMessageHandler', () => {
  const createLogger = () => ({
    close: jest.fn(),
    error: jest.fn(),
    health: jest.fn(),
    http: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  });

  it('should format incoming message', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const handler = createMessageHandler({ logger });

    await handler.handle('employee-1', {
      body: 'hello from customer',
      chatId: '123@c.us',
      from: '123@c.us',
      messageId: 'wamid-1',
      phoneNumber: '123'
    });

    expect(logger.info).toHaveBeenCalledWith(
      '[employee-1]\nFROM: 123\nCHAT_ID: 123@c.us\nTEXT: hello from customer'
    );
  });

  it('should handle empty messages safely', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const handler = createMessageHandler({ logger });

    await expect(
      handler.handle('employee-1', {
        body: '',
        from: '123@c.us'
      })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith('[employee-1] 123@c.us: [empty message]');
  });

  it('should persist empty-body messages when they have a stable id', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const chats = {
      upsertByEmployeeCode: jest.fn(() => ({ id: 99 }))
    };
    const messages = {
      upsertByEmployeeCode: jest.fn(() => ({ chatRecordId: 99 }))
    };
    const handler = createMessageHandler({
      chats,
      messages,
      logger
    });

    await handler.handle('employee-1', {
      body: '',
      chatId: '123@c.us',
      from: '123@c.us',
      messageId: 'wamid-1'
    });

    expect(messages.upsertByEmployeeCode).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeCode: 'employee-1',
        externalMessageId: 'wamid-1',
        body: '',
        sourceChatId: '123@c.us'
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[employee-1]\nFROM: 123\nCHAT_ID: 123@c.us\nTEXT: '
    );
  });

  it('should format outgoing message using recipient when available', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const handler = createMessageHandler({ logger });

    await handler.handle('employee-1', {
      body: 'hello from employee',
      chatId: '123@lid',
      from: 'employee@c.us',
      fromMe: true,
      phoneNumber: '123',
      to: '123@lid'
    });

    expect(logger.info).toHaveBeenCalledWith(
      '[employee-1]\nTO: 123\nCHAT_ID: 123@lid\nTEXT: hello from employee'
    );
  });

  it('should strip jid suffixes and leave only digits when phone number is not resolved', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const handler = createMessageHandler({ logger });

    await handler.handle('employee-1', {
      body: 'hello from employee',
      chatId: '66842309960@c.us',
      from: 'employee@c.us',
      fromMe: true,
      to: '66842309960@c.us'
    });

    expect(logger.info).toHaveBeenCalledWith(
      '[employee-1]\nTO: 66842309960\nCHAT_ID: 66842309960@c.us\nTEXT: hello from employee'
    );
  });

  it('should not derive a fake phone number from an unresolved lid chat id', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const chats = {
      upsertByEmployeeCode: jest.fn()
    };
    const handler = createMessageHandler({
      chats,
      logger
    });

    await handler.handle('employee-1', {
      body: 'hello from employee',
      chatId: '123456789@lid',
      from: 'employee@c.us',
      fromMe: true,
      to: '123456789@lid'
    });

    expect(chats.upsertByEmployeeCode).toHaveBeenCalledWith({
      employeeCode: 'employee-1',
      chatId: '123456789@lid',
      isPhoneNumberVerified: false,
      phoneNumber: undefined,
      lastMessageId: null,
      lastMessagePreview: 'hello from employee',
      lastMessageTimestamp: undefined
    });
    expect(logger.info).toHaveBeenCalledWith(
      '[employee-1]\nTO: 123456789@lid\nCHAT_ID: 123456789@lid\nTEXT: hello from employee'
    );
  });

  it('should persist chats through the database layer', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const chats = {
      upsertByEmployeeCode: jest.fn()
    };
    const handler = createMessageHandler({
      chats,
      logger
    });

    await handler.handle('employee-1', {
      body: 'hello from customer',
      chatId: '123@c.us',
      from: '123@c.us',
      phoneNumber: '123',
      timestamp: 171234567
    });

    expect(chats.upsertByEmployeeCode).toHaveBeenCalledWith({
      employeeCode: 'employee-1',
      chatId: '123@c.us',
      isPhoneNumberVerified: true,
      phoneNumber: '123',
      lastMessageId: null,
      lastMessagePreview: 'hello from customer',
      lastMessageTimestamp: 171234567
    });
  });

  it('should persist messages through the database layer after chat upsert', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const chats = {
      upsertByEmployeeCode: jest.fn(() => ({ id: 42 }))
    };
    const messages = {
      upsertByEmployeeCode: jest.fn(() => ({ id: 1, chatRecordId: 42 }))
    };
    const handler = createMessageHandler({
      chats,
      messages,
      logger
    });

    await handler.handle('employee-1', {
      body: 'hello from customer',
      chatId: '123@c.us',
      from: '123@c.us',
      messageId: 'wamid-1',
      phoneNumber: '123',
      timestamp: 171234567
    });

    expect(chats.upsertByEmployeeCode.mock.invocationCallOrder[0]).toBeLessThan(
      messages.upsertByEmployeeCode.mock.invocationCallOrder[0]
    );
    expect(messages.upsertByEmployeeCode).toHaveBeenCalledWith({
      employeeCode: 'employee-1',
      chatId: '123@c.us',
      externalMessageId: 'wamid-1',
      sourceChatId: '123@c.us',
      direction: 'incoming',
      body: 'hello from customer',
      messageType: undefined,
      timestamp: 171234567,
      fromJid: '123@c.us',
      toJid: null,
      authorJid: null,
      ack: undefined,
      hasMedia: undefined,
      isForwarded: undefined,
      forwardingScore: undefined,
      hasQuotedMsg: undefined,
      quotedMessageExternalId: undefined,
      ingestSource: 'live',
      rawPayloadJson: null
    });
  });

  it('should persist outgoing messages with outgoing direction', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const chats = {
      upsertByEmployeeCode: jest.fn(() => ({ id: 42 }))
    };
    const messages = {
      upsertByEmployeeCode: jest.fn(() => ({ id: 1, chatRecordId: 42 }))
    };
    const handler = createMessageHandler({
      chats,
      messages,
      logger
    });

    await handler.handle('employee-1', {
      body: 'hello from employee',
      chatId: '123@lid',
      from: 'employee@c.us',
      fromMe: true,
      messageId: 'wamid-out-1',
      to: '123@lid'
    });

    expect(messages.upsertByEmployeeCode).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeCode: 'employee-1',
        chatId: '123@lid',
        externalMessageId: 'wamid-out-1',
        sourceChatId: '123@lid',
        direction: 'outgoing',
        fromJid: 'employee@c.us',
        toJid: '123@lid'
      })
    );
  });

  it('should keep logging the message when chat persistence fails', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const chats = {
      upsertByEmployeeCode: jest.fn(() => {
        throw new Error('database unavailable');
      })
    };
    const handler = createMessageHandler({
      chats,
      logger
    });

    await handler.handle('employee-1', {
      body: 'hello from customer',
      chatId: '123@c.us',
      from: '123@c.us'
    });

    expect(logger.error).toHaveBeenCalledWith('WhatsApp chat persistence failed', {
      employeeId: 'employee-1',
      chatId: '123@c.us',
      error: 'database unavailable'
    });
    expect(logger.info).toHaveBeenCalledWith(
      '[employee-1]\nFROM: 123\nCHAT_ID: 123@c.us\nTEXT: hello from customer'
    );
  });

  it('should warn and skip message persistence when a stable message id is missing', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const chats = {
      upsertByEmployeeCode: jest.fn(() => ({ id: 42 }))
    };
    const messages = {
      upsertByEmployeeCode: jest.fn()
    };
    const handler = createMessageHandler({
      chats,
      messages,
      logger
    });

    await handler.handle('employee-1', {
      body: 'hello from customer',
      chatId: '123@c.us',
      from: '123@c.us'
    });

    expect(messages.upsertByEmployeeCode).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'WhatsApp message skipped persistence: missing stable message id',
      {
        employeeId: 'employee-1',
        chatId: '123@c.us'
      }
    );
  });

  it('should log message persistence failures separately from chat persistence', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const chats = {
      upsertByEmployeeCode: jest.fn(() => ({ id: 42 }))
    };
    const messages = {
      upsertByEmployeeCode: jest.fn(() => {
        throw new Error('message insert failed');
      })
    };
    const handler = createMessageHandler({
      chats,
      messages,
      logger
    });

    await handler.handle('employee-1', {
      body: 'hello from customer',
      chatId: '123@c.us',
      from: '123@c.us',
      messageId: 'wamid-1'
    });

    expect(logger.error).toHaveBeenCalledWith('WhatsApp message persistence failed', {
      employeeId: 'employee-1',
      chatId: '123@c.us',
      chatRecordId: 42,
      externalMessageId: 'wamid-1',
      error: 'message insert failed'
    });
    expect(logger.info).toHaveBeenCalledWith(
      '[employee-1]\nFROM: 123\nCHAT_ID: 123@c.us\nTEXT: hello from customer'
    );
  });

  it('should not persist an unknown chat id from a malformed payload', async () => {
    const { createMessageHandler } = require('../../src/whatsapp/message-handler');
    const logger = createLogger();
    const chats = {
      upsertByEmployeeCode: jest.fn()
    };
    const handler = createMessageHandler({
      chats,
      logger
    });

    await handler.handle('employee-1', {
      body: 'payload without sender',
      from: '   '
    });

    expect(chats.upsertByEmployeeCode).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[employee-1]\nFROM: unknown\nCHAT_ID: unknown\nTEXT: payload without sender'
    );
  });
});
