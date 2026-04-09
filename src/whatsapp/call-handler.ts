import type { ChatsRepository, MessagesRepository } from '../database/types';
import type { CallHandler, CallPayload, Logger } from '../types/whatsapp';
import {
  normalizePhoneDigits,
  resolveReliablePhoneNumber
} from '../utils/chat-identity';

interface CreateCallHandlerOptions {
  chats?: ChatsRepository;
  messages?: MessagesRepository;
  logger: Logger;
}

const CALL_BODY_BY_STATUS = {
  incoming: 'Incoming call',
  missed: 'Missed call',
  outgoing: 'Outgoing call'
} as const;

const normalizeOptionalJid = (value?: string): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue === '' ? undefined : normalizedValue;
};

const resolveChatId = (call: CallPayload): string | undefined => {
  const explicitChatId = normalizeOptionalJid(call.chatId);

  if (explicitChatId) {
    return explicitChatId;
  }

  if (call.fromMe) {
    return normalizeOptionalJid(call.to) ?? normalizeOptionalJid(call.from);
  }

  return normalizeOptionalJid(call.from) ?? normalizeOptionalJid(call.to);
};

const normalizeCallId = (callId: string): string => {
  const normalizedCallId = callId.trim();

  if (normalizedCallId === '') {
    throw new Error('Call ID is required');
  }

  return normalizedCallId.startsWith('call:') ? normalizedCallId : `call:${normalizedCallId}`;
};

const resolveDirection = (
  status: CallPayload['status']
): 'incoming' | 'outgoing' => (status === 'outgoing' ? 'outgoing' : 'incoming');

const resolveCallMediaType = (
  isVideo?: boolean
): 'voice' | 'video' | undefined => {
  if (typeof isVideo !== 'boolean') {
    return undefined;
  }

  return isVideo ? 'video' : 'voice';
};

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

const resolveCallReliablePhoneNumber = (
  call: CallPayload,
  chatId: string
): { isPhoneNumberVerified: boolean; phoneNumber?: string } => {
  const explicitPhoneNumber = normalizePhoneDigits(call.phoneNumber);

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

export const createCallHandler = ({
  chats,
  messages,
  logger
}: CreateCallHandlerOptions): CallHandler => ({
  async handle(employeeId: string, call: CallPayload): Promise<void> {
    const chatId = resolveChatId(call);

    if (!chatId) {
      logger.warn('WhatsApp call skipped persistence: missing chat identity', {
        employeeId,
        rawPayload: serializeRawPayload(call.rawPayload)
      });
      return;
    }

    const externalMessageId = normalizeCallId(call.callId);
    const body = CALL_BODY_BY_STATUS[call.status];
    const direction = resolveDirection(call.status);
    const callMediaType = resolveCallMediaType(call.isVideo);
    const { isPhoneNumberVerified, phoneNumber } = resolveCallReliablePhoneNumber(
      call,
      chatId
    );
    let chatRecordId: number | undefined;

    if (chats) {
      try {
        const chat = chats.upsertByEmployeeCode({
          employeeCode: employeeId,
          chatId,
          lastMessageId: externalMessageId,
          lastMessagePreview: body,
          isPhoneNumberVerified,
          phoneNumber,
          lastMessageTimestamp: call.timestamp
        });
        chatRecordId = chat.id;
      } catch (error) {
        logger.error('WhatsApp call chat persistence failed', {
          employeeId,
          chatId,
          error: error instanceof Error ? error.message : 'Unknown database error'
        });
      }
    }

    if (messages) {
      try {
        const persistedMessage = messages.upsertByEmployeeCode({
          employeeCode: employeeId,
          chatId,
          externalMessageId,
          sourceChatId: chatId,
          direction,
          body,
          messageType: 'call',
          callStatus: call.status,
          callMediaType,
          timestamp: call.timestamp,
          fromJid: call.from,
          toJid: typeof call.to === 'string' ? call.to : null,
          ingestSource: call.ingestSource ?? 'live',
          rawPayloadJson: serializeRawPayload(call.rawPayload)
        });
        chatRecordId = persistedMessage.chatRecordId;
      } catch (error) {
        logger.error('WhatsApp call persistence failed', {
          employeeId,
          chatId,
          chatRecordId,
          externalMessageId,
          error: error instanceof Error ? error.message : 'Unknown database error'
        });
      }
    }

    logger.info('WhatsApp call ingested', {
      body,
      callMediaType: callMediaType ?? null,
      callStatus: call.status,
      chatId,
      employeeId,
      externalMessageId,
      phoneNumber: phoneNumber ?? null,
      timestamp: call.timestamp ?? null
    });
  }
});
