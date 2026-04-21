import type {
  CallHandler,
  CallPayload,
  Logger,
  MessageHandler,
  MessagePayload,
  QrTerminal,
  SessionHealth,
  SessionRuntimeStatus,
  SessionManager,
  WhatsappClientFactory,
  WhatsappSessionClient
} from '../types/whatsapp';
import type { ChatsRepository, EmployeesRepository } from '../database/types';
import {
  normalizePhoneDigits,
  resolveReliablePhoneNumber
} from '../utils/chat-identity';
import { createCallHandler } from './call-handler';
import {
  resolveMessageRemoteChatId,
  shouldIngestCallEvent,
  shouldIngestMessageEvent,
  shouldPollRuntimeChat
} from './ingest-filter';
import { createMessageHandler } from './message-handler';
import { resolveEmployeeSessionLocation } from './session-location';

interface CreateSessionManagerOptions {
  callHandler?: CallHandler;
  chats?: ChatsRepository;
  clientFactory: WhatsappClientFactory;
  employees?: EmployeesRepository;
  logger: Logger;
  messageHandler?: MessageHandler;
  qr: QrTerminal;
}

interface ActiveSession {
  client: WhatsappSessionClient;
  sessionKey: string;
  sessionStoragePath: string | null;
}

const extractPhoneNumberFromChatId = (chatId: string): string | undefined => {
  const match = chatId.match(/^(\d+)@(c\.us|s\.whatsapp\.net)$/u);

  if (!match) {
    return undefined;
  }

  return match[1];
};

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const readRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

const extractSerializedId = (value: unknown): string | undefined => {
  const directValue = readString(value);

  if (directValue) {
    return directValue;
  }

  const recordValue = readRecord(value);

  if (!recordValue) {
    return undefined;
  }

  return readString(recordValue._serialized) ?? readString(recordValue.id);
};

const extractMessageId = (message: Record<string, unknown>): string | undefined => {
  const directMessageId = readString(message.messageId);

  if (directMessageId) {
    return directMessageId;
  }

  const messageId = message.id;

  if (!messageId || typeof messageId !== 'object') {
    return undefined;
  }

  return extractSerializedId(messageId);
};

const extractQuotedMessageId = (
  message: Record<string, unknown>
): string | null | undefined => {
  if ('quotedMessageId' in message) {
    const quotedMessageId = message.quotedMessageId;

    if (quotedMessageId === null) {
      return null;
    }

    const directQuotedMessageId = readString(quotedMessageId);

    if (directQuotedMessageId) {
      return directQuotedMessageId;
    }
  }

  const quotedMsg = message.quotedMsg;

  if (!quotedMsg || typeof quotedMsg !== 'object') {
    return undefined;
  }

  const quotedId = (quotedMsg as Record<string, unknown>).id;

  if (!quotedId || typeof quotedId !== 'object') {
    return undefined;
  }

  return extractSerializedId(quotedId);
};

const normalizeIncomingMessagePayload = (
  message: unknown,
  overrides: Pick<MessagePayload, 'chatId' | 'phoneNumber'>
): MessagePayload => {
  const rawMessage = message as Record<string, unknown>;
  const payload = rawMessage as unknown as MessagePayload;

  return {
    ...payload,
    chatId: overrides.chatId,
    phoneNumber: overrides.phoneNumber,
    messageId: extractMessageId(rawMessage),
    author: readString(rawMessage.author),
    type: readString(rawMessage.type),
    ack: readNumber(rawMessage.ack),
    hasMedia: readBoolean(rawMessage.hasMedia),
    isForwarded: readBoolean(rawMessage.isForwarded),
    forwardingScore: readNumber(rawMessage.forwardingScore),
    quotedMessageId: extractQuotedMessageId(rawMessage),
    rawPayload: rawMessage
  };
};

const resolvePhoneNumber = async (
  client: WhatsappSessionClient,
  chatId: string
): Promise<string | undefined> => {
  const directPhoneNumber = extractPhoneNumberFromChatId(chatId);

  if (directPhoneNumber) {
    return directPhoneNumber;
  }

  if (!chatId.endsWith('@lid') || !client.getContactLidAndPhone) {
    return undefined;
  }

  const contacts = await client.getContactLidAndPhone([chatId]);
  return contacts.find((contact) => contact.lid === chatId)?.pn;
};

const CALL_OUTGOING_STATUS_VALUES = new Set([
  'initiated',
  'out',
  'outgoing',
  'placed'
]);
const CALL_INCOMING_STATUS_VALUES = new Set(['in', 'incoming']);
const CALL_MISSED_STATUS_VALUES = new Set([
  'missed',
  'no_answer',
  'not_answered',
  'unanswered'
]);

const getCallPayloadSources = (payload: Record<string, unknown>): Record<string, unknown>[] => {
  const nestedKeys = ['_data', 'call', 'callLog', 'data', 'details', 'event'];
  const sources = [payload];

  for (const key of nestedKeys) {
    const nestedValue = readRecord(payload[key]);

    if (nestedValue) {
      sources.push(nestedValue);
    }
  }

  return sources;
};

const getNestedCallPayloadSources = (
  payload: Record<string, unknown>
): Record<string, unknown>[] => getCallPayloadSources(payload).slice(1);

const readFirstStringField = (
  payload: Record<string, unknown>,
  fieldNames: string[]
): string | undefined => {
  for (const source of getCallPayloadSources(payload)) {
    for (const fieldName of fieldNames) {
      const value = readString(source[fieldName]);

      if (value) {
        return value;
      }
    }
  }

  return undefined;
};

const readFirstBooleanField = (
  payload: Record<string, unknown>,
  fieldNames: string[]
): boolean | undefined => {
  for (const source of getCallPayloadSources(payload)) {
    for (const fieldName of fieldNames) {
      const value = readBoolean(source[fieldName]);

      if (typeof value === 'boolean') {
        return value;
      }
    }
  }

  return undefined;
};

const readFirstNumberField = (
  payload: Record<string, unknown>,
  fieldNames: string[]
): number | undefined => {
  for (const source of getCallPayloadSources(payload)) {
    for (const fieldName of fieldNames) {
      const value = readNumber(source[fieldName]);

      if (typeof value === 'number') {
        return value;
      }
    }
  }

  return undefined;
};

const extractFirstSerializedField = (
  sources: Record<string, unknown>[],
  fieldNames: string[]
): string | undefined => {
  for (const source of sources) {
    for (const fieldName of fieldNames) {
      const value = extractSerializedId(source[fieldName]);

      if (value) {
        return value;
      }
    }
  }

  return undefined;
};

const extractCallId = (payload: Record<string, unknown>): string | undefined =>
  extractFirstSerializedField(getCallPayloadSources(payload), ['callId', 'call_id']) ??
  extractFirstSerializedField([payload], ['id', 'messageId', 'msgId']) ??
  extractFirstSerializedField(getNestedCallPayloadSources(payload), ['id', 'messageId', 'msgId']);

const extractCallIdForCallLog = (payload: Record<string, unknown>): string | undefined =>
  extractFirstSerializedField(getCallPayloadSources(payload), ['callId', 'call_id']) ??
  extractFirstSerializedField(getNestedCallPayloadSources(payload), ['id', 'messageId', 'msgId']);

const normalizeCallExternalId = (callId: string): string =>
  callId.startsWith('call:') ? callId : `call:${callId}`;

const resolveCallStatus = (
  payload: Record<string, unknown>,
  fromMe?: boolean
): CallPayload['status'] => {
  const explicitOutgoing = readFirstBooleanField(payload, ['outgoing', 'fromMe', 'isOutgoing']);

  if (explicitOutgoing === true) {
    return 'outgoing';
  }

  const statusLabel = readFirstStringField(payload, [
    'callResult',
    'callState',
    'callStatus',
    'state',
    'status'
  ])?.toLowerCase();

  if (statusLabel && CALL_OUTGOING_STATUS_VALUES.has(statusLabel)) {
    return 'outgoing';
  }

  const explicitMissed = readFirstBooleanField(payload, [
    'isMissed',
    'isMissedCall',
    'missed',
    'wasMissed'
  ]);

  if (explicitMissed === true) {
    return 'missed';
  }

  if (statusLabel && CALL_MISSED_STATUS_VALUES.has(statusLabel)) {
    return 'missed';
  }

  const explicitIncoming = readFirstBooleanField(payload, ['incoming', 'isIncoming']);

  if (explicitIncoming === true) {
    return 'incoming';
  }

  if (statusLabel && CALL_INCOMING_STATUS_VALUES.has(statusLabel)) {
    return 'incoming';
  }

  if (fromMe) {
    return 'outgoing';
  }

  return 'incoming';
};

const resolveCallIsVideo = (payload: Record<string, unknown>): boolean | undefined =>
  readFirstBooleanField(payload, ['isVideo', 'isVideoCall', 'video']);

const normalizeIncomingCallPayload = async (
  call: unknown,
  client: WhatsappSessionClient,
  resolvedChatId?: string
): Promise<CallPayload | undefined> => {
  const rawCall = call as Record<string, unknown>;
  const from = readString(rawCall.from) ?? readString(rawCall.peerJid);
  const to = readString(rawCall.to) ?? readString(rawCall.toJid);
  const fromMe = readBoolean(rawCall.fromMe) ?? readBoolean(rawCall.outgoing);
  const chatId = resolvedChatId ??
    readString(rawCall.chatId) ??
    readString(rawCall.peerJid) ??
    (fromMe ? to ?? from : from ?? to);
  const phoneNumber =
    typeof chatId === 'string' ? await resolvePhoneNumber(client, chatId) : undefined;
  const callId = extractCallId(rawCall);

  if (!callId) {
    return undefined;
  }

  return {
    callId: normalizeCallExternalId(callId),
    chatId,
    from,
    fromMe,
    isVideo: resolveCallIsVideo(rawCall),
    phoneNumber,
    rawPayload: rawCall,
    status: resolveCallStatus(rawCall, fromMe),
    timestamp:
      readNumber(rawCall.timestamp) ??
      readNumber(rawCall.offerTime) ??
      readFirstNumberField(rawCall, ['timestamp', 'offerTime', 'ts']),
    to
  };
};

const normalizeCallLogPayload = (message: MessagePayload): CallPayload | undefined => {
  const rawPayload = readRecord(message.rawPayload) ?? (message as unknown as Record<string, unknown>);
  const callId = extractCallIdForCallLog(rawPayload) ?? message.messageId;

  if (!callId) {
    return undefined;
  }

  return {
    callId: normalizeCallExternalId(callId),
    chatId: message.chatId,
    from: message.from,
    fromMe: message.fromMe,
    isVideo: resolveCallIsVideo(rawPayload),
    phoneNumber: message.phoneNumber,
    rawPayload,
    status: resolveCallStatus(rawPayload, message.fromMe),
    timestamp: message.timestamp ?? readFirstNumberField(rawPayload, ['timestamp', 'offerTime', 'ts']),
    to: message.to
  };
};

const destroySessionClient = async (
  client: WhatsappSessionClient
): Promise<void> => {
  await client.destroy();
};

const nowIso = (): string => new Date().toISOString();
const DEFAULT_CHAT_SYNC_MESSAGE_LIMIT = 50;
const POLLED_CALL_BODY_BY_STATUS: Record<CallPayload['status'], string> = {
  incoming: 'Incoming call',
  missed: 'Missed call',
  outgoing: 'Outgoing call'
};

const createAbortError = (message = 'WhatsApp chat sync aborted'): Error => {
  const error = new Error(message);

  error.name = 'AbortError';
  return error;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const resolveRuntimeChatDisplayName = (
  chat: Record<string, unknown>
): string | undefined =>
  readString(chat.name) ??
  readString(chat.formattedTitle) ??
  readString(chat.formattedName) ??
  readString(chat.shortName) ??
  readString(readRecord(chat.contact)?.name) ??
  readString(readRecord(chat.contact)?.pushname);

const resolveRuntimeChatKind = (
  chatId: string,
  chat: Record<string, unknown>
): string => {
  if (readBoolean(chat.isGroup) === true || chatId.endsWith('@g.us')) {
    return 'group';
  }

  if (chatId.endsWith('@broadcast')) {
    return 'broadcast';
  }

  if (chatId.endsWith('@newsletter')) {
    return 'newsletter';
  }

  return 'direct';
};

const resolveRuntimeChatPhone = (
  chatId: string
): {
  isPhoneNumberVerified: boolean;
  phoneNumber?: string;
} => {
  const directPhoneNumber = extractPhoneNumberFromChatId(chatId);

  if (directPhoneNumber) {
    return {
      isPhoneNumberVerified: true,
      phoneNumber: directPhoneNumber
    };
  }

  return {
    isPhoneNumberVerified: false,
    phoneNumber: resolveReliablePhoneNumber({
      chatId
    })
  };
};

interface SyncedMessageMetadata {
  externalMessageId?: string;
  preview?: string;
  timestamp?: number;
}

const selectLatestSyncedMessageMetadata = (
  current: SyncedMessageMetadata | undefined,
  next: SyncedMessageMetadata | undefined
): SyncedMessageMetadata | undefined => {
  if (!next) {
    return current;
  }

  if (!current) {
    return next;
  }

  if (typeof next.timestamp === 'number' && typeof current.timestamp !== 'number') {
    return next;
  }

  if (
    typeof next.timestamp === 'number' &&
    typeof current.timestamp === 'number' &&
    next.timestamp >= current.timestamp
  ) {
    return next;
  }

  return current;
};

const createDefaultSessionHealth = (employeeId: string): SessionHealth => ({
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
  whatsappState: null
});

const isConnectedWhatsappState = (state: string | null): boolean | null => {
  if (!state) {
    return null;
  }

  return state.toUpperCase() === 'CONNECTED';
};

const destroySessionClientBestEffort = async (
  employeeId: string,
  client: WhatsappSessionClient,
  logger: Logger
): Promise<void> => {
  try {
    await destroySessionClient(client);
  } catch (error) {
    logger.error('WhatsApp session cleanup failed', {
      employeeId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

const bindLifecycleHandlers = (
  employeeId: string,
  client: WhatsappSessionClient,
  logger: Logger,
  callHandler: CallHandler,
  messageHandler: MessageHandler,
  qr: QrTerminal,
  updateSessionHealth: (
    employeeId: string,
    patch: Partial<SessionHealth>,
    options?: {
      markCheckedAt?: boolean;
      markEventAt?: boolean;
    }
  ) => SessionHealth,
  onDisconnected: () => Promise<void>
): void => {
  const processMessage = async (message: unknown): Promise<void> => {
    const rawMessage = readRecord(message);

    if (!rawMessage) {
      return;
    }

    const filterDecision = shouldIngestMessageEvent(rawMessage);

    if (!filterDecision.shouldIngest || !filterDecision.remoteChatId) {
      return;
    }

    const chatId = filterDecision.remoteChatId;
    const phoneNumber = await resolvePhoneNumber(client, chatId);
    const normalizedMessage = normalizeIncomingMessagePayload(rawMessage, {
      chatId,
      phoneNumber
    });

    if (normalizedMessage.type === 'call_log') {
      const normalizedCall = normalizeCallLogPayload(normalizedMessage);

      if (!normalizedCall) {
        logger.warn('WhatsApp call log skipped persistence: missing stable call id', {
          employeeId,
          chatId
        });
        return;
      }

      try {
        await callHandler.handle(employeeId, normalizedCall);
      } catch (error) {
        logger.error('WhatsApp call handling failed', {
          employeeId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      return;
    }

    try {
      await messageHandler.handle(employeeId, normalizedMessage);
    } catch (error) {
      logger.error('WhatsApp message handling failed', {
        employeeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const processCall = async (call: unknown): Promise<void> => {
    const rawCall = readRecord(call);

    if (!rawCall) {
      return;
    }

    const filterDecision = shouldIngestCallEvent(rawCall);

    if (!filterDecision.shouldIngest || !filterDecision.remoteChatId) {
      return;
    }

    const normalizedCall = await normalizeIncomingCallPayload(
      rawCall,
      client,
      filterDecision.remoteChatId
    );

    if (!normalizedCall) {
      logger.warn('WhatsApp call skipped persistence: missing stable call id', {
        employeeId
      });
      return;
    }

    try {
      await callHandler.handle(employeeId, normalizedCall);
    } catch (error) {
      logger.error('WhatsApp call handling failed', {
        employeeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  client.on('qr', (code: unknown) => {
    if (typeof code !== 'string') {
      return;
    }

    updateSessionHealth(employeeId, {
      lastDisconnectReason: null,
      lastError: null,
      qrCode: code,
      runtimeStatus: 'waiting_for_qr'
    });
    qr.generate(code, { small: true });
    logger.info('WhatsApp QR received', { employeeId });
  });

  client.on('ready', () => {
    updateSessionHealth(employeeId, {
      lastDisconnectReason: null,
      lastError: null,
      lastReadyAt: nowIso(),
      qrCode: null,
      runtimeStatus: 'ready'
    });
    logger.info('WhatsApp session ready', { employeeId });
  });

  client.on('change_state', (state: unknown) => {
    if (typeof state !== 'string') {
      return;
    }

    updateSessionHealth(employeeId, {
      whatsappState: state
    });
    logger.info('WhatsApp session state changed', {
      employeeId,
      state
    });
  });

  client.on('message', async (message: unknown) => {
    await processMessage(message);
  });

  client.on('message_create', async (message: unknown) => {
    const payload = readRecord(message);

    if (readBoolean(payload?.fromMe) !== true) {
      return;
    }

    await processMessage(message);
  });

  client.on('call', async (call: unknown) => {
    await processCall(call);
  });

  client.on('auth_failure', (message: unknown) => {
    const errorMessage =
      typeof message === 'string' ? message : 'Unknown authentication error';

    updateSessionHealth(employeeId, {
      lastError: errorMessage,
      qrCode: null,
      runtimeStatus: 'auth_failed'
    });
    logger.warn('WhatsApp authentication failed', {
      employeeId,
      message: errorMessage
    });
  });

  client.on('disconnected', (reason: unknown) => {
    const disconnectReason =
      typeof reason === 'string' ? reason : 'Unknown disconnect reason';

    updateSessionHealth(employeeId, {
      lastDisconnectReason: disconnectReason,
      qrCode: null,
      runtimeStatus: 'disconnected'
    });
    void onDisconnected();
    logger.warn('WhatsApp session disconnected', {
      employeeId,
      reason: disconnectReason
    });
  });
};

export const createSessionManager = ({
  chats,
  clientFactory,
  employees,
  logger,
  callHandler = createCallHandler({ logger }),
  messageHandler = createMessageHandler({ logger }),
  qr
}: CreateSessionManagerOptions): SessionManager => {
  const sessions = new Map<string, ActiveSession>();
  const sessionHealth = new Map<string, SessionHealth>();
  const startSessionOperations = new Map<string, Promise<void>>();

  const resolveSessionConfig = (
    employeeId: string
  ): {
    sessionKey: string;
    sessionStoragePath: string | null;
  } => {
    if (!employees) {
      return {
        sessionKey: employeeId,
        sessionStoragePath: null
      };
    }

    const employee = employees.findByCode(employeeId);

    if (!employee) {
      throw new Error(`Employee not found: ${employeeId}`);
    }

    const phoneNumber = normalizePhoneDigits(employee.phoneNumber);

    if (!phoneNumber) {
      throw new Error(`Employee phone number is required to start WhatsApp session: ${employeeId}`);
    }

    const { sessionStoragePath } = resolveEmployeeSessionLocation(employee);

    if (!sessionStoragePath) {
      throw new Error(
        `Employee session storage path is required to start WhatsApp session: ${employeeId}`
      );
    }

    return {
      sessionKey: phoneNumber,
      sessionStoragePath
    };
  };

  const findEmployeeIdBySessionKey = (
    sessionKey: string,
    excludedEmployeeId?: string
  ): string | undefined => {
    for (const [employeeId, activeSession] of sessions.entries()) {
      if (
        employeeId !== excludedEmployeeId &&
        activeSession.sessionKey === sessionKey
      ) {
        return employeeId;
      }
    }

    return undefined;
  };

  const getMatchedActiveSession = (employeeId: string): ActiveSession | undefined => {
    const activeSession = sessions.get(employeeId);

    if (!activeSession || !employees) {
      return activeSession;
    }

    const employee = employees.findByCode(employeeId);
    const phoneNumber = normalizePhoneDigits(employee?.phoneNumber);
    const { sessionStoragePath } = employee
      ? resolveEmployeeSessionLocation(employee)
      : {
          sessionStoragePath: null
        };

    if (
      !phoneNumber ||
      !sessionStoragePath ||
      activeSession.sessionKey !== phoneNumber ||
      activeSession.sessionStoragePath !== sessionStoragePath
    ) {
      return undefined;
    }

    return activeSession;
  };

  const updateSessionHealth = (
    employeeId: string,
    patch: Partial<SessionHealth>,
    options: {
      markCheckedAt?: boolean;
      markEventAt?: boolean;
    } = {}
  ): SessionHealth => {
    const currentHealth =
      sessionHealth.get(employeeId) ?? createDefaultSessionHealth(employeeId);
    const nextHealth: SessionHealth = {
      ...currentHealth,
      ...patch
    };

    if (options.markCheckedAt) {
      nextHealth.lastCheckedAt = nowIso();
    }

    if (options.markEventAt ?? true) {
      nextHealth.lastEventAt = nowIso();
    }

    sessionHealth.set(employeeId, nextHealth);
    return nextHealth;
  };

  const buildSessionHealth = (employeeId: string): SessionHealth => {
    const currentHealth =
      sessionHealth.get(employeeId) ?? createDefaultSessionHealth(employeeId);
    const hasRuntimeSession = Boolean(getMatchedActiveSession(employeeId));
    const connectedByWhatsappState = isConnectedWhatsappState(
      currentHealth.whatsappState
    );

    return {
      ...currentHealth,
      hasRuntimeSession,
      isSessionActive:
        hasRuntimeSession &&
        (connectedByWhatsappState ?? currentHealth.runtimeStatus === 'ready')
    };
  };

  const probeWhatsappState = async (employeeId: string): Promise<SessionHealth> => {
    const activeSession = getMatchedActiveSession(employeeId);
    const client = activeSession?.client;

    if (!client || !client.getState) {
      const currentHealth = buildSessionHealth(employeeId);
      const runtimeStatus: SessionRuntimeStatus =
        currentHealth.hasRuntimeSession ||
        (currentHealth.runtimeStatus !== 'ready' &&
          currentHealth.runtimeStatus !== 'starting' &&
          currentHealth.runtimeStatus !== 'waiting_for_qr')
          ? currentHealth.runtimeStatus
          : 'not_started';

      return updateSessionHealth(
        employeeId,
        {
          hasRuntimeSession: currentHealth.hasRuntimeSession,
          isSessionActive: currentHealth.isSessionActive,
          qrCode: currentHealth.hasRuntimeSession ? currentHealth.qrCode : null,
          runtimeStatus,
          whatsappState: currentHealth.hasRuntimeSession
            ? currentHealth.whatsappState
            : null
        },
        {
          markCheckedAt: true,
          markEventAt: false
        }
      );
    }

    try {
      const whatsappState = await Promise.race([
        client.getState(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('getState timeout')), 4_000)
        )
      ]);
      const connectedByState = isConnectedWhatsappState(whatsappState);
      const currentHealth = buildSessionHealth(employeeId);
      const runtimeStatus: SessionRuntimeStatus =
        connectedByState === true ? 'ready' : currentHealth.runtimeStatus;
      const healthPatch: Partial<SessionHealth> = {
        hasRuntimeSession: true,
        isSessionActive:
          connectedByState ?? currentHealth.runtimeStatus === 'ready',
        runtimeStatus,
        whatsappState
      };

      if (connectedByState === true) {
        healthPatch.qrCode = null;
      }

      return updateSessionHealth(
        employeeId,
        healthPatch,
        {
          markCheckedAt: true,
          markEventAt: false
        }
      );
    } catch (error) {
      logger.warn('WhatsApp session health probe failed', {
        employeeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return updateSessionHealth(
        employeeId,
        {
          hasRuntimeSession: true,
          isSessionActive: buildSessionHealth(employeeId).isSessionActive
        },
        {
          markCheckedAt: true,
          markEventAt: false
        }
      );
    }
  };

  const syncPolledMessage = async ({
    client,
    employeeId,
    fallbackChatId,
    rawMessage,
    signal
  }: {
    client: WhatsappSessionClient;
    employeeId: string;
    fallbackChatId: string;
    rawMessage: unknown;
    signal?: AbortSignal;
  }): Promise<SyncedMessageMetadata | undefined> => {
    throwIfAborted(signal);

    const rawMessageRecord = readRecord(rawMessage);

    if (!rawMessageRecord) {
      return undefined;
    }

    const messageFilterInput: Record<string, unknown> =
      resolveMessageRemoteChatId(rawMessageRecord)
        ? rawMessageRecord
        : {
            ...rawMessageRecord,
            chatId: fallbackChatId
          };
    const filterDecision = shouldIngestMessageEvent(messageFilterInput);

    if (!filterDecision.shouldIngest || !filterDecision.remoteChatId) {
      return undefined;
    }

    const normalizedChatId = filterDecision.remoteChatId;
    const phoneNumber = await resolvePhoneNumber(client, normalizedChatId);
    const normalizedMessage: MessagePayload = {
      ...normalizeIncomingMessagePayload(rawMessageRecord, {
        chatId: normalizedChatId,
        phoneNumber
      }),
      ingestSource: 'poll'
    };

    if (normalizedMessage.type === 'call_log') {
      const normalizedCall = normalizeCallLogPayload(normalizedMessage);

      if (!normalizedCall) {
        logger.warn('WhatsApp polled call log skipped persistence: missing stable call id', {
          chatId: normalizedChatId,
          employeeId
        });
        return undefined;
      }

      await callHandler.handle(employeeId, {
        ...normalizedCall,
        ingestSource: 'poll'
      });

      return {
        externalMessageId: normalizedCall.callId,
        preview: POLLED_CALL_BODY_BY_STATUS[normalizedCall.status],
        timestamp: normalizedCall.timestamp
      };
    }

    await messageHandler.handle(employeeId, normalizedMessage);

    return {
      externalMessageId: normalizedMessage.messageId,
      preview:
        typeof normalizedMessage.body === 'string'
          ? normalizedMessage.body.trim()
          : '',
      timestamp: normalizedMessage.timestamp
    };
  };

  const syncChatsInternal = async (
    employeeId: string,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<void> => {
    const startedAt = Date.now();
    const activeSession = getMatchedActiveSession(employeeId);
    const client = activeSession?.client;

    if (!client) {
      throw new Error(`WhatsApp runtime session not active: ${employeeId}`);
    }

    if (!client.getChats) {
      throw new Error(`WhatsApp runtime client does not support chat sync: ${employeeId}`);
    }

    logger.info('WhatsApp employee chat sync started', {
      employeeId,
      event: 'chat_sync_employee_started'
    });

    try {
      throwIfAborted(options?.signal);
      const runtimeChats = await client.getChats();
      const synchronizedAt = nowIso();
      let syncedChatCount = 0;
      let syncedMessageCount = 0;

      for (const runtimeChat of runtimeChats) {
        throwIfAborted(options?.signal);

        const rawChat = readRecord(runtimeChat);

        if (!rawChat) {
          continue;
        }

        const chatFilterDecision = shouldPollRuntimeChat(rawChat);

        if (!chatFilterDecision.shouldIngest || !chatFilterDecision.remoteChatId) {
          continue;
        }

        const chatId = chatFilterDecision.remoteChatId;
        const fetchMessages =
          typeof rawChat.fetchMessages === 'function'
            ? (rawChat.fetchMessages.bind(rawChat) as (
                options?: { limit?: number }
              ) => Promise<unknown[]>)
            : undefined;
        let latestSyncedMessage: SyncedMessageMetadata | undefined;
        let messagesSyncCompleted = false;

        if (fetchMessages) {
          const polledMessages = await fetchMessages({
            limit: DEFAULT_CHAT_SYNC_MESSAGE_LIMIT
          });

          for (const rawMessage of polledMessages) {
            throwIfAborted(options?.signal);

            const syncedMessage = await syncPolledMessage({
              client,
              employeeId,
              fallbackChatId: chatId,
              rawMessage,
              signal: options?.signal
            });

            latestSyncedMessage = selectLatestSyncedMessageMetadata(
              latestSyncedMessage,
              syncedMessage
            );

            if (syncedMessage?.externalMessageId) {
              syncedMessageCount += 1;
            }
          }

          messagesSyncCompleted = true;
        }

        if (chats) {
          const { isPhoneNumberVerified, phoneNumber } = resolveRuntimeChatPhone(chatId);

          chats.upsertByEmployeeCode({
            employeeCode: employeeId,
            chatId,
            displayName: resolveRuntimeChatDisplayName(rawChat),
            chatKind: resolveRuntimeChatKind(chatId, rawChat),
            isArchived: readBoolean(rawChat.archived) ?? readBoolean(rawChat.isArchived),
            isPinned: readBoolean(rawChat.pinned) ?? readBoolean(rawChat.isPinned),
            unreadCount: readNumber(rawChat.unreadCount),
            lastMessageId: latestSyncedMessage?.externalMessageId,
            lastMessagePreview: latestSyncedMessage?.preview,
            lastMessageTimestamp:
              latestSyncedMessage?.timestamp ?? readNumber(rawChat.timestamp),
            lastMessagesSyncedAt: messagesSyncCompleted ? synchronizedAt : undefined,
            lastPolledAt: synchronizedAt,
            isPhoneNumberVerified,
            phoneNumber
          });
        }

        syncedChatCount += 1;
      }

      logger.info('WhatsApp employee chat sync finished', {
        durationMs: Date.now() - startedAt,
        employeeId,
        event: 'chat_sync_employee_finished',
        syncedChatCount,
        syncedMessageCount
      });
    } catch (error) {
      if (isAbortError(error)) {
        logger.warn('WhatsApp employee chat sync aborted', {
          durationMs: Date.now() - startedAt,
          employeeId,
          event: 'chat_sync_employee_aborted'
        });
      }

      throw error;
    }
  };

  const startSessionInternal = async (employeeId: string): Promise<void> => {
    const { sessionKey, sessionStoragePath } = resolveSessionConfig(employeeId);
    const existingSession = sessions.get(employeeId);

    if (
      existingSession &&
      existingSession.sessionKey === sessionKey &&
      existingSession.sessionStoragePath === sessionStoragePath
    ) {
      logger.warn('WhatsApp session already active', { employeeId });
      return;
    }

    if (existingSession) {
      logger.info('Restarting WhatsApp session after employee session config change', {
        employeeId,
        nextSessionKey: sessionKey,
        nextSessionStoragePath: sessionStoragePath,
        previousSessionKey: existingSession.sessionKey,
        previousSessionStoragePath: existingSession.sessionStoragePath
      });
      await destroySessionClient(existingSession.client);
      sessions.delete(employeeId);
    }

    const conflictingEmployeeId = findEmployeeIdBySessionKey(
      sessionKey,
      employeeId
    );

    if (conflictingEmployeeId) {
      const errorMessage =
        `WhatsApp session phone number is already connected to another employee: ${conflictingEmployeeId}`;

      updateSessionHealth(employeeId, {
        hasRuntimeSession: false,
        isSessionActive: false,
        lastError: errorMessage,
        qrCode: null,
        runtimeStatus: 'failed',
        whatsappState: null
      });
      throw new Error(errorMessage);
    }

    logger.info('Starting WhatsApp session', { employeeId });
    updateSessionHealth(employeeId, {
      hasRuntimeSession: true,
      isSessionActive: false,
      lastDisconnectReason: null,
      lastError: null,
      qrCode: null,
      runtimeStatus: 'starting',
      whatsappState: null
    });

    let client: WhatsappSessionClient | undefined;

    try {
      client = sessionStoragePath
        ? clientFactory.create(sessionKey, {
            sessionStoragePath
          })
        : clientFactory.create(sessionKey);
      const activeClient = client;
      sessions.set(employeeId, {
        client: activeClient,
        sessionKey,
        sessionStoragePath
      });
      bindLifecycleHandlers(
        employeeId,
        activeClient,
        logger,
        callHandler,
        messageHandler,
        qr,
        updateSessionHealth,
        async () => {
          sessions.delete(employeeId);
          updateSessionHealth(employeeId, {
            hasRuntimeSession: false,
            isSessionActive: false,
            qrCode: null
          });
          await destroySessionClientBestEffort(employeeId, activeClient, logger);
        }
      );
      await activeClient.initialize();
    } catch (error) {
      if (client) {
        try {
          await destroySessionClient(client);
        } catch (cleanupError) {
          logger.error('WhatsApp session cleanup failed after initialization error', {
            employeeId,
            error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error'
          });
        } finally {
          sessions.delete(employeeId);
        }
      }

      updateSessionHealth(employeeId, {
        hasRuntimeSession: false,
        isSessionActive: false,
        lastError: error instanceof Error ? error.message : 'Unknown error',
        qrCode: null,
        runtimeStatus: 'failed',
        whatsappState: null
      });

      logger.error('WhatsApp session failed to initialize', {
        employeeId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  };

  return {
    async getSessionHealth(employeeId: string): Promise<SessionHealth> {
      return probeWhatsappState(employeeId);
    },

    async shutdown(): Promise<void> {
      const activeSessions = Array.from(sessions.entries());
      const employeeIds = activeSessions.map(([employeeId]) => employeeId);

      logger.info('Shutting down WhatsApp sessions', { employeeIds });
      sessions.clear();
      for (const employeeId of employeeIds) {
        updateSessionHealth(employeeId, {
          hasRuntimeSession: false,
          isSessionActive: false,
          qrCode: null,
          runtimeStatus: 'stopped',
          whatsappState: null
        });
      }

      await Promise.allSettled(
        activeSessions.map(([employeeId, activeSession]) =>
          destroySessionClientBestEffort(employeeId, activeSession.client, logger)
        )
      );
    },

    async syncChats(
      employeeId: string,
      options?: {
        signal?: AbortSignal;
      }
    ): Promise<void> {
      await syncChatsInternal(employeeId, options);
    },

    async stopSession(employeeId: string): Promise<void> {
      const activeSession = sessions.get(employeeId);
      const client = activeSession?.client;

      if (!client) {
        logger.warn('WhatsApp session not active', { employeeId });
        return;
      }

      logger.info('Stopping WhatsApp session', { employeeId });
      await destroySessionClient(client);
      sessions.delete(employeeId);
      updateSessionHealth(employeeId, {
        hasRuntimeSession: false,
        isSessionActive: false,
        lastDisconnectReason: null,
        lastError: null,
        qrCode: null,
        runtimeStatus: 'stopped',
        whatsappState: null
      });
    },

    async startSession(employeeId: string): Promise<void> {
      const inFlightStart = startSessionOperations.get(employeeId);

      if (inFlightStart) {
        await inFlightStart;
        return;
      }

      let startOperation: Promise<void>;

      startOperation = startSessionInternal(employeeId).finally(() => {
        if (startSessionOperations.get(employeeId) === startOperation) {
          startSessionOperations.delete(employeeId);
        }
      });
      startSessionOperations.set(employeeId, startOperation);
      await startOperation;
    },

    async startAll(employeeIds: string[]): Promise<void> {
      logger.info('Starting WhatsApp sessions batch', { employeeIds });
      const results = await Promise.allSettled(
        employeeIds.map((employeeId) => this.startSession(employeeId))
      );
      const failedEmployeeIds = employeeIds.filter(
        (_employeeId, index) => results[index]?.status === 'rejected'
      );

      if (failedEmployeeIds.length === 0) {
        return;
      }

      const startedEmployeeIds = employeeIds.filter(
        (_employeeId, index) => results[index]?.status === 'fulfilled'
      );

      logger.warn('WhatsApp sessions batch completed with failures', {
        failedEmployeeIds,
        startedEmployeeIds
      });
    }
  };
};
