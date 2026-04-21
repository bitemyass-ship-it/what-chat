export interface WhatsappEventFilterDecision {
  shouldIngest: boolean;
  reason?: string;
  remoteChatId?: string;
}

const DIRECT_PERSONAL_CHAT_ID_PATTERN = /^\d+@(c\.us|s\.whatsapp\.net|lid)$/u;

const SYSTEM_MESSAGE_TYPES = new Set([
  'broadcast_notification',
  'debug',
  'e2e_notification',
  'gp2',
  'group_notification',
  'newsletter_notification',
  'notification',
  'notification_template',
  'protocol'
]);

const readString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue === '' ? undefined : normalizedValue;
};

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const readRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

const getPayloadSources = (
  payload: Record<string, unknown>
): Record<string, unknown>[] => {
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

const readFirstStringField = (
  payload: Record<string, unknown>,
  fieldNames: string[]
): string | undefined => {
  for (const source of getPayloadSources(payload)) {
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
  for (const source of getPayloadSources(payload)) {
    for (const fieldName of fieldNames) {
      const value = readBoolean(source[fieldName]);

      if (typeof value === 'boolean') {
        return value;
      }
    }
  }

  return undefined;
};

const extractIdRemote = (payload: Record<string, unknown>): string | undefined => {
  for (const source of getPayloadSources(payload)) {
    const id = readRecord(source.id);
    const remote = readString(id?.remote);

    if (remote) {
      return remote;
    }
  }

  return undefined;
};

const extractRuntimeChatId = (
  chat: Record<string, unknown>
): string | undefined => {
  const id = chat.id;
  const directId = readString(id);

  if (directId) {
    return directId;
  }

  const idRecord = readRecord(id);
  return readString(idRecord?._serialized) ??
    readString(idRecord?.id) ??
    readString(chat.chatId);
};

const hasExplicitNonTargetFlag = (payload: Record<string, unknown>): boolean =>
  readFirstBooleanField(payload, ['isStatus']) === true ||
  readFirstBooleanField(payload, ['broadcast']) === true ||
  readFirstBooleanField(payload, ['isChannel']) === true ||
  readFirstBooleanField(payload, ['isGroup']) === true;

export const isDirectPersonalChatId = (chatId: unknown): boolean => {
  const normalizedChatId = readString(chatId);
  return typeof normalizedChatId === 'string' &&
    DIRECT_PERSONAL_CHAT_ID_PATTERN.test(normalizedChatId);
};

export const resolveMessageRemoteChatId = (
  message: Record<string, unknown>
): string | undefined => {
  const explicitChatId = readString(message.chatId);

  if (explicitChatId) {
    return explicitChatId;
  }

  const fromMe = readBoolean(message.fromMe);

  if (fromMe === true) {
    return readString(message.to) ?? extractIdRemote(message);
  }

  if (fromMe === false) {
    return readString(message.from) ?? extractIdRemote(message);
  }

  const from = readString(message.from);
  const to = readString(message.to);
  const idRemote = extractIdRemote(message);

  return [from, to, idRemote].find((jid) => isDirectPersonalChatId(jid)) ??
    from ??
    to ??
    idRemote;
};

export const resolveCallRemoteChatId = (
  call: Record<string, unknown>
): string | undefined => {
  const explicitChatId = readFirstStringField(call, ['chatId']);

  if (explicitChatId) {
    return explicitChatId;
  }

  const peerJid = readFirstStringField(call, ['peerJid']);

  if (peerJid) {
    return peerJid;
  }

  const from = readFirstStringField(call, ['from', 'fromJid']);
  const to = readFirstStringField(call, ['to', 'toJid']);
  const fromMe =
    readFirstBooleanField(call, ['fromMe']) ??
    readFirstBooleanField(call, ['outgoing', 'isOutgoing']);

  if (fromMe === true) {
    return to ?? from;
  }

  if (fromMe === false) {
    return from ?? to;
  }

  return [from, to].find((jid) => isDirectPersonalChatId(jid)) ?? from ?? to;
};

export const isSystemMessageType = (type: unknown): boolean => {
  const normalizedType = readString(type)?.toLowerCase();
  return typeof normalizedType === 'string' && SYSTEM_MESSAGE_TYPES.has(normalizedType);
};

export const shouldIngestMessageEvent = (
  message: Record<string, unknown>
): WhatsappEventFilterDecision => {
  const remoteChatId = resolveMessageRemoteChatId(message);
  const messageType = readFirstStringField(message, ['type']);

  if (hasExplicitNonTargetFlag(message)) {
    return {
      shouldIngest: false,
      reason: 'explicit_non_target_flag',
      remoteChatId
    };
  }

  if (!isDirectPersonalChatId(remoteChatId)) {
    return {
      shouldIngest: false,
      reason: 'non_direct_personal_chat',
      remoteChatId
    };
  }

  if (isSystemMessageType(messageType)) {
    return {
      shouldIngest: false,
      reason: 'system_message_type',
      remoteChatId
    };
  }

  return {
    shouldIngest: true,
    remoteChatId
  };
};

export const shouldIngestCallEvent = (
  call: Record<string, unknown>
): WhatsappEventFilterDecision => {
  const remoteChatId = resolveCallRemoteChatId(call);

  if (hasExplicitNonTargetFlag(call)) {
    return {
      shouldIngest: false,
      reason: 'explicit_non_target_flag',
      remoteChatId
    };
  }

  if (!isDirectPersonalChatId(remoteChatId)) {
    return {
      shouldIngest: false,
      reason: 'non_direct_personal_chat',
      remoteChatId
    };
  }

  return {
    shouldIngest: true,
    remoteChatId
  };
};

export const shouldPollRuntimeChat = (
  chat: Record<string, unknown>
): WhatsappEventFilterDecision => {
  const remoteChatId = extractRuntimeChatId(chat);

  if (hasExplicitNonTargetFlag(chat)) {
    return {
      shouldIngest: false,
      reason: 'explicit_non_target_flag',
      remoteChatId
    };
  }

  if (!isDirectPersonalChatId(remoteChatId)) {
    return {
      shouldIngest: false,
      reason: 'non_direct_personal_chat',
      remoteChatId
    };
  }

  return {
    shouldIngest: true,
    remoteChatId
  };
};
