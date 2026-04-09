import type { ChatsRepository, MessagesRepository } from '../database/types';
import type { Logger, MessageHandler, MessagePayload } from '../types/whatsapp';
import {
  normalizePhoneDigits,
  resolveReliablePhoneNumber
} from '../utils/chat-identity';

interface CreateMessageHandlerOptions {
  chats?: ChatsRepository;
  messages?: MessagesRepository;
  logger: Logger;
}

const normalizeBody = (message: MessagePayload): string => {
  if (typeof message.body !== 'string') {
    return '';
  }

  return message.body.trim();
};

const normalizeFrom = (message: MessagePayload): string => {
  if (typeof message.from !== 'string' || message.from.trim() === '') {
    return 'unknown';
  }

  return message.from;
};

const normalizeTo = (message: MessagePayload): string => {
  if (typeof message.to !== 'string' || message.to.trim() === '') {
    return normalizeFrom(message);
  }

  return message.to;
};

const normalizeChatId = (message: MessagePayload): string => {
  if (typeof message.chatId === 'string' && message.chatId.trim() !== '') {
    return message.chatId;
  }

  return message.fromMe ? normalizeTo(message) : normalizeFrom(message);
};

const shouldPersistChat = (chatId: string): boolean => chatId !== 'unknown';

const normalizeMessageId = (message: MessagePayload): string | undefined => {
  if (typeof message.messageId !== 'string') {
    return undefined;
  }

  const normalizedMessageId = message.messageId.trim();
  return normalizedMessageId === '' ? undefined : normalizedMessageId;
};

const resolveDirection = (
  message: MessagePayload
): 'incoming' | 'outgoing' | 'system' => (message.fromMe ? 'outgoing' : 'incoming');

const serializeRawPayload = (rawPayload: unknown): string | null => {
  if (typeof rawPayload === 'undefined') {
    return null;
  }

  try {
    return JSON.stringify(rawPayload);
  } catch {
    return null;
  }
};

const resolveHasQuotedMessage = (message: MessagePayload): boolean | undefined => {
  if (typeof message.quotedMessageId !== 'string') {
    return undefined;
  }

  return message.quotedMessageId.trim() !== '';
};

const resolveMessageReliablePhoneNumber = (
  message: MessagePayload,
  chatId: string
): { isPhoneNumberVerified: boolean; phoneNumber?: string } => {
  const explicitPhoneNumber = normalizePhoneDigits(message.phoneNumber);

  if (explicitPhoneNumber) {
    return {
      isPhoneNumberVerified: true,
      phoneNumber: explicitPhoneNumber
    };
  }

  return {
    isPhoneNumberVerified: false,
    phoneNumber: resolveReliablePhoneNumber({
      chatId
    })
  };
};

const formatStructuredMessage = ({
  body,
  chatId,
  counterparty,
  employeeId,
  fromMe,
  timestamp
}: {
  body: string;
  chatId: string;
  counterparty: string;
  employeeId: string;
  fromMe?: boolean;
  timestamp?: number;
}): string => {
  const directionLabel = fromMe ? 'TO' : 'FROM';

  const lines = [
    `[${employeeId}]`,
    `${directionLabel}: ${counterparty}`,
    `CHAT_ID: ${chatId}`,
    `TEXT: ${body}`
  ];

  if (typeof timestamp === 'number') {
    lines.push(`TIME: ${timestamp}`);
  }

  return lines.join('\n');
};

export const createMessageHandler = ({
  chats,
  messages,
  logger
}: CreateMessageHandlerOptions): MessageHandler => ({
  async handle(employeeId: string, message: MessagePayload): Promise<void> {
    const body = normalizeBody(message);
    const from = normalizeFrom(message);
    const chatId = normalizeChatId(message);
    const messageId = normalizeMessageId(message);
    const direction = resolveDirection(message);
    const { isPhoneNumberVerified, phoneNumber } = resolveMessageReliablePhoneNumber(
      message,
      chatId
    );
    let chatRecordId: number | undefined;

    if (chats && shouldPersistChat(chatId)) {
      try {
        const chat = chats.upsertByEmployeeCode({
          employeeCode: employeeId,
          chatId,
          lastMessageId: messageId ?? null,
          lastMessagePreview: body,
          isPhoneNumberVerified,
          phoneNumber,
          lastMessageTimestamp: message.timestamp
        });
        chatRecordId = chat.id;
      } catch (error) {
        logger.error('WhatsApp chat persistence failed', {
          employeeId,
          chatId,
          error: error instanceof Error ? error.message : 'Unknown database error'
        });
      }
    }

    if (messages && !messageId && shouldPersistChat(chatId)) {
      logger.warn('WhatsApp message skipped persistence: missing stable message id', {
        employeeId,
        chatId
      });
    }

    if (messages && messageId && shouldPersistChat(chatId)) {
      try {
        const persistedMessage = messages.upsertByEmployeeCode({
          employeeCode: employeeId,
          chatId,
          externalMessageId: messageId,
          sourceChatId: chatId,
          direction,
          body,
          messageType: message.type,
          timestamp: message.timestamp,
          fromJid: message.from,
          toJid: typeof message.to === 'string' ? message.to : null,
          authorJid: typeof message.author === 'string' ? message.author : null,
          ack: message.ack,
          hasMedia: message.hasMedia,
          isForwarded: message.isForwarded,
          forwardingScore: message.forwardingScore,
          hasQuotedMsg: resolveHasQuotedMessage(message),
          quotedMessageExternalId: message.quotedMessageId,
          ingestSource: message.ingestSource ?? 'live',
          rawPayloadJson: serializeRawPayload(message.rawPayload)
        });
        chatRecordId = persistedMessage.chatRecordId;
      } catch (error) {
        logger.error('WhatsApp message persistence failed', {
          employeeId,
          chatId,
          chatRecordId,
          externalMessageId: messageId,
          error: error instanceof Error ? error.message : 'Unknown database error'
        });
      }
    }

    if (body === '') {
      logger.warn(`[${employeeId}] ${from}: [empty message]`);

      if (!messageId) {
        return;
      }
    }

    logger.info(
      formatStructuredMessage({
        body,
        chatId,
        counterparty: phoneNumber ?? chatId,
        employeeId,
        fromMe: message.fromMe,
        timestamp: message.timestamp
      })
    );
  }
});
