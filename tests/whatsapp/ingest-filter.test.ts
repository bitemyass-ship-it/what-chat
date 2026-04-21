import {
  isDirectPersonalChatId,
  isSystemMessageType,
  resolveCallRemoteChatId,
  resolveMessageRemoteChatId,
  shouldIngestCallEvent,
  shouldIngestMessageEvent,
  shouldPollRuntimeChat
} from '../../src/whatsapp/ingest-filter';

describe('WhatsApp ingest filter', () => {
  it.each([
    '995555000111@c.us',
    '995555000111@s.whatsapp.net',
    '123456789012345@lid'
  ])('should accept direct personal chat id %s', (chatId) => {
    expect(isDirectPersonalChatId(chatId)).toBe(true);
  });

  it.each([
    '120363000000000000@g.us',
    'status@broadcast',
    '123456789@broadcast',
    '123456789@newsletter',
    'unknown',
    '',
    123,
    'customer@c.us',
    '123'
  ])('should reject non-target chat id %s', (chatId) => {
    expect(isDirectPersonalChatId(chatId)).toBe(false);
  });

  it('should resolve incoming message remote id from chatId, from, then id.remote', () => {
    expect(
      resolveMessageRemoteChatId({
        chatId: '111@c.us',
        from: '222@c.us',
        fromMe: false,
        id: {
          remote: '333@c.us'
        }
      })
    ).toBe('111@c.us');

    expect(
      resolveMessageRemoteChatId({
        from: '222@c.us',
        fromMe: false,
        id: {
          remote: '333@c.us'
        }
      })
    ).toBe('222@c.us');

    expect(
      resolveMessageRemoteChatId({
        fromMe: false,
        id: {
          remote: '333@c.us'
        }
      })
    ).toBe('333@c.us');
  });

  it('should resolve outgoing message remote id from chatId, to, then id.remote', () => {
    expect(
      resolveMessageRemoteChatId({
        from: 'employee@c.us',
        fromMe: true,
        id: {
          remote: '333@c.us'
        },
        to: '222@c.us'
      })
    ).toBe('222@c.us');

    expect(
      resolveMessageRemoteChatId({
        from: 'employee@c.us',
        fromMe: true,
        id: {
          remote: '333@c.us'
        }
      })
    ).toBe('333@c.us');
  });

  it('should reject group messages even when author is a direct jid', () => {
    expect(
      shouldIngestMessageEvent({
        author: '995555000111@c.us',
        from: '120363000000000000@g.us',
        fromMe: false,
        type: 'chat'
      })
    ).toEqual(
      expect.objectContaining({
        remoteChatId: '120363000000000000@g.us',
        shouldIngest: false
      })
    );
  });

  it.each([
    'broadcast_notification',
    'debug',
    'e2e_notification',
    'gp2',
    'group_notification',
    'newsletter_notification',
    'notification',
    'notification_template',
    'protocol'
  ])('should reject system message type %s', (type) => {
    expect(isSystemMessageType(type)).toBe(true);
    expect(
      shouldIngestMessageEvent({
        from: '995555000111@c.us',
        fromMe: false,
        type
      })
    ).toEqual(
      expect.objectContaining({
        reason: 'system_message_type',
        shouldIngest: false
      })
    );
  });

  it.each(['chat', 'image', 'unknown', 'revoked', 'ciphertext', undefined])(
    'should accept non-system direct message type %s',
    (type) => {
      expect(
        shouldIngestMessageEvent({
          from: '995555000111@c.us',
          fromMe: false,
          type
        })
      ).toEqual(
        expect.objectContaining({
          remoteChatId: '995555000111@c.us',
          shouldIngest: true
        })
      );
    }
  );

  it('should accept call_log only for direct personal chats', () => {
    expect(
      shouldIngestMessageEvent({
        from: '995555000111@c.us',
        fromMe: false,
        type: 'call_log'
      }).shouldIngest
    ).toBe(true);

    expect(
      shouldIngestMessageEvent({
        from: '120363000000000000@g.us',
        fromMe: false,
        type: 'call_log'
      }).shouldIngest
    ).toBe(false);
  });

  it.each([
    {
      from: 'status@broadcast',
      fromMe: false,
      isStatus: true,
      type: 'image'
    },
    {
      broadcast: true,
      from: '995555000111@c.us',
      fromMe: false,
      type: 'chat'
    },
    {
      from: '123456789@newsletter',
      fromMe: false,
      type: 'chat'
    },
    {
      from: '995555000111@c.us',
      fromMe: false,
      isChannel: true,
      type: 'chat'
    }
  ])('should reject status, broadcast, and channel messages', (message) => {
    expect(shouldIngestMessageEvent(message).shouldIngest).toBe(false);
  });

  it('should resolve call remote id from chatId, peerJid, direction, then direct peer', () => {
    expect(
      resolveCallRemoteChatId({
        chatId: '111@c.us',
        from: '222@c.us',
        peerJid: '333@c.us'
      })
    ).toBe('111@c.us');

    expect(
      resolveCallRemoteChatId({
        from: '222@c.us',
        peerJid: '333@c.us'
      })
    ).toBe('333@c.us');

    expect(
      resolveCallRemoteChatId({
        from: 'employee@c.us',
        fromMe: true,
        to: '444@lid'
      })
    ).toBe('444@lid');

    expect(
      resolveCallRemoteChatId({
        from: 'employee@c.us',
        to: '555@s.whatsapp.net'
      })
    ).toBe('555@s.whatsapp.net');
  });

  it('should reject group calls even when another field looks direct', () => {
    expect(
      shouldIngestCallEvent({
        from: '995555000111@c.us',
        isGroup: true,
        peerJid: '120363000000000000@g.us'
      })
    ).toEqual(
      expect.objectContaining({
        shouldIngest: false
      })
    );
  });

  it('should accept direct calls and reject non-direct call peers', () => {
    expect(
      shouldIngestCallEvent({
        id: 'call-1',
        peerJid: '995555000111@c.us'
      }).shouldIngest
    ).toBe(true);

    expect(
      shouldIngestCallEvent({
        id: 'call-2',
        peerJid: '120363000000000000@g.us'
      }).shouldIngest
    ).toBe(false);
  });

  it.each([
    {
      id: {
        _serialized: '995555000111@c.us'
      }
    },
    {
      chatId: '995555000111@s.whatsapp.net'
    },
    {
      id: {
        id: '123456789012345@lid'
      }
    }
  ])('should poll direct runtime chat %#', (chat) => {
    expect(shouldPollRuntimeChat(chat).shouldIngest).toBe(true);
  });

  it.each([
    {
      id: {
        _serialized: '120363000000000000@g.us'
      }
    },
    {
      id: {
        _serialized: 'status@broadcast'
      }
    },
    {
      chatId: '123456789@broadcast'
    },
    {
      chatId: '123456789@newsletter'
    },
    {
      chatId: '995555000111@c.us',
      isGroup: true
    }
  ])('should not poll non-target runtime chat %#', (chat) => {
    expect(shouldPollRuntimeChat(chat).shouldIngest).toBe(false);
  });
});
