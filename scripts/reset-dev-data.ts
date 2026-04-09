import fs from 'node:fs';
import { createDatabase, resolveDatabasePath } from '../src/database/database';
import type { Database } from '../src/database/types';
import type { Logger } from '../src/types/whatsapp';

interface SeedTimelineEntryBase {
  body: string;
  direction: 'incoming' | 'outgoing';
  externalMessageId: string;
  messageType: 'call' | 'chat';
  timestamp: number;
}

interface SeedChatMessageInput extends SeedTimelineEntryBase {
  ack?: number;
  messageType: 'chat';
}

interface SeedCallInput extends SeedTimelineEntryBase {
  callMediaType?: 'video' | 'voice';
  callStatus: 'incoming' | 'missed' | 'outgoing';
  messageType: 'call';
}

export type SeedTimelineEntryInput = SeedCallInput | SeedChatMessageInput;

export interface SeedChatInput {
  chatId: string;
  displayName: string;
  phoneNumber: string;
  timeline: SeedTimelineEntryInput[];
}

export const DEV_EMPLOYEE_CODE = 'dev-inactive';
export const DEV_EMPLOYEE_DISPLAY_NAME = 'Dev Inactive User';
export const DEV_EMPLOYEE_PHONE_NUMBER = '15550000001';
const DEV_CHAT_COUNT = 25;
const MIN_MESSAGES_PER_CHAT = 20;
const MAX_MESSAGES_PER_CHAT = 50;
const MIN_CALLS_PER_CHAT = 1;
const MAX_CALLS_PER_CHAT = 4;

const silentLogger: Logger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined
};

const seedDisplayNames = [
  'Alice Example',
  'Bob Example',
  'Carla Example',
  'David Example',
  'Emma Example',
  'Frank Example',
  'Grace Example',
  'Helen Example',
  'Ivan Example',
  'Julia Example',
  'Kevin Example',
  'Laura Example',
  'Mason Example',
  'Nina Example',
  'Owen Example',
  'Paula Example',
  'Quinn Example',
  'Rita Example',
  'Sam Example',
  'Tina Example',
  'Uma Example',
  'Victor Example',
  'Wendy Example',
  'Xavier Example',
  'Yara Example'
] as const;

const incomingBodies = [
  'Hi, I need an update on the shipment.',
  'Can you confirm the delivery window?',
  'Please send the revised invoice.',
  'I have a question about the last order.',
  'Could you share the current status?',
  'Is the payment already reflected on your side?',
  'We need to reschedule the pickup.',
  'Can you check the item availability?',
  'Please send me the tracking link.',
  'I am waiting for your confirmation.'
] as const;

const outgoingBodies = [
  'Checking it now. I will send details in a moment.',
  'Confirmed. I will update the order right away.',
  'Invoice is ready, sending it now.',
  'Status looks good from our side.',
  'I have shared the latest details above.',
  'Payment is confirmed in the system.',
  'Pickup was moved to the new requested slot.',
  'Availability is confirmed for this item.',
  'Sharing the tracking information now.',
  'Thanks, I will keep you posted.'
] as const;

const CALL_LABEL_BY_STATUS = {
  incoming: 'Incoming call',
  missed: 'Missed call',
  outgoing: 'Outgoing call'
} as const;
const CALL_STATUS_SEQUENCE = ['incoming', 'outgoing', 'missed'] as const;

const resolveMessageCount = (chatIndex: number): number => {
  const messageSpan = MAX_MESSAGES_PER_CHAT - MIN_MESSAGES_PER_CHAT + 1;
  return MIN_MESSAGES_PER_CHAT + ((chatIndex * 5) % messageSpan);
};

const buildPhoneNumber = (chatIndex: number): string =>
  `1555${String(1000000 + chatIndex).padStart(7, '0')}`;

const buildMessageBody = (
  direction: 'incoming' | 'outgoing',
  chatIndex: number,
  messageIndex: number
): string => {
  const source =
    direction === 'incoming'
      ? incomingBodies[(chatIndex + messageIndex) % incomingBodies.length]
      : outgoingBodies[(chatIndex + messageIndex) % outgoingBodies.length];

  return `${source} Ref ${chatIndex + 1}-${messageIndex + 1}.`;
};

const buildBaseTimeline = (
  chatIndex: number,
  chatBaseTimestamp: number
): SeedChatMessageInput[] => {
  const messageCount = resolveMessageCount(chatIndex);

  return Array.from({
    length: messageCount
  }, (_, messageIndex) => {
    const direction: 'incoming' | 'outgoing' = messageIndex % 2 === 0 ? 'incoming' : 'outgoing';

    return {
      ack: direction === 'outgoing' ? 2 + (messageIndex % 2) : undefined,
      body: buildMessageBody(direction, chatIndex, messageIndex),
      direction,
      externalMessageId: `wamid-dev-chat-${chatIndex + 1}-msg-${messageIndex + 1}`,
      messageType: 'chat',
      timestamp: chatBaseTimestamp + messageIndex * 3 * 60 * 1000
    };
  });
};

const resolveCallCount = (chatIndex: number): number => {
  const callSpan = MAX_CALLS_PER_CHAT - MIN_CALLS_PER_CHAT + 1;
  return MIN_CALLS_PER_CHAT + ((chatIndex * 3) % callSpan);
};

const resolveCallStatus = (
  chatIndex: number,
  callIndex: number
): SeedCallInput['callStatus'] =>
  CALL_STATUS_SEQUENCE[(chatIndex + callIndex) % CALL_STATUS_SEQUENCE.length] ?? 'incoming';

const buildCallEntry = ({
  callMediaType,
  chatIndex,
  callIndex,
  status,
  timestamp
}: {
  callMediaType?: 'video' | 'voice';
  chatIndex: number;
  callIndex: number;
  status: 'incoming' | 'missed' | 'outgoing';
  timestamp: number;
}): SeedCallInput => ({
  body: CALL_LABEL_BY_STATUS[status],
  callMediaType,
  callStatus: status,
  direction: status === 'outgoing' ? 'outgoing' : 'incoming',
  externalMessageId: `call:dev-chat-${chatIndex + 1}-${callIndex + 1}-${status}`,
  messageType: 'call',
  timestamp
});

const withSeededCalls = (
  chatIndex: number,
  timeline: SeedTimelineEntryInput[]
): SeedTimelineEntryInput[] => {
  const nextTimeline = [...timeline];
  const baseStartTimestamp = timeline[0]?.timestamp ?? Date.UTC(2026, 2, 1, 8, 0, 0);
  const lastTimestamp = timeline.at(-1)?.timestamp ?? baseStartTimestamp;
  const callCount = resolveCallCount(chatIndex);

  for (let callIndex = 0; callIndex < callCount; callIndex += 1) {
    const isLatestCall = chatIndex === 0 && callIndex === callCount - 1;
    const status = isLatestCall ? 'outgoing' : resolveCallStatus(chatIndex, callIndex);
    const timestamp = isLatestCall
      ? lastTimestamp + 2 * 60 * 1000
      : baseStartTimestamp + (callIndex + 1) * 11 * 60 * 1000 + chatIndex * 15 * 1000;

    nextTimeline.push(
      buildCallEntry({
        callMediaType: (chatIndex + callIndex) % 3 === 0 ? 'video' : 'voice',
        callIndex,
        chatIndex,
        status,
        timestamp
      })
    );
  }

  return nextTimeline.sort((left, right) => left.timestamp - right.timestamp);
};

export const createSeededChats = (): SeedChatInput[] =>
  Array.from({
    length: DEV_CHAT_COUNT
  }, (_, chatIndex) => {
    const phoneNumber = buildPhoneNumber(chatIndex);
    const chatId = `${phoneNumber}@c.us`;
    const chatBaseTimestamp = Date.UTC(2026, 2, 1 + chatIndex, 8 + (chatIndex % 8), 0, 0);
    const timeline = withSeededCalls(chatIndex, buildBaseTimeline(chatIndex, chatBaseTimestamp));

    return {
      chatId,
      displayName: seedDisplayNames[chatIndex] ?? `Seed Contact ${chatIndex + 1}`,
      phoneNumber,
      timeline
    };
  });

const removeDatabaseFile = (databasePath: string): void => {
  if (databasePath === ':memory:') {
    return;
  }

  for (const candidatePath of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
    fs.rmSync(candidatePath, {
      force: true
    });
  }
};

const fromJid = (direction: 'incoming' | 'outgoing', chatId: string): string =>
  direction === 'incoming' ? chatId : `${DEV_EMPLOYEE_PHONE_NUMBER}@c.us`;

const resolveToJid = (direction: 'incoming' | 'outgoing', chatId: string): string =>
  direction === 'incoming' ? `${DEV_EMPLOYEE_PHONE_NUMBER}@c.us` : chatId;

const seedChat = (
  chats: Database['chats'],
  messages: Database['messages'],
  chat: SeedChatInput
): void => {
  for (const entry of chat.timeline) {
    chats.upsertByEmployeeCode({
      employeeCode: DEV_EMPLOYEE_CODE,
      chatId: chat.chatId,
      displayName: chat.displayName,
      isPhoneNumberVerified: true,
      phoneNumber: chat.phoneNumber,
      lastMessageId: entry.externalMessageId,
      lastMessagePreview: entry.body,
      lastMessageTimestamp: entry.timestamp
    });

    messages.upsertByEmployeeCode({
      employeeCode: DEV_EMPLOYEE_CODE,
      chatId: chat.chatId,
      externalMessageId: entry.externalMessageId,
      sourceChatId: chat.chatId,
      direction: entry.direction,
      body: entry.body,
      messageType: entry.messageType,
      callMediaType: entry.messageType === 'call' ? entry.callMediaType ?? null : null,
      callStatus: entry.messageType === 'call' ? entry.callStatus : null,
      timestamp: entry.timestamp,
      fromJid: fromJid(entry.direction, chat.chatId),
      toJid: resolveToJid(entry.direction, chat.chatId),
      ack: entry.messageType === 'chat' ? entry.ack ?? null : null,
      ingestSource: 'live'
    });
  }
};

export const seedDevData = (database: Database): void => {
  database.employees.create({
    code: DEV_EMPLOYEE_CODE,
    displayName: DEV_EMPLOYEE_DISPLAY_NAME,
    phoneNumber: DEV_EMPLOYEE_PHONE_NUMBER,
    isActive: false,
    sessionDir: null
  });

  for (const chat of createSeededChats()) {
    seedChat(database.chats, database.messages, chat);
  }
};

export const main = (): void => {
  const databasePath = resolveDatabasePath();
  removeDatabaseFile(databasePath);

  const database = createDatabase({
    databasePath,
    logger: silentLogger
  });

  try {
    seedDevData(database);
  } finally {
    database.close();
  }

  console.log(
    `Dev database reset and seeded at ${databasePath} for employee ${DEV_EMPLOYEE_CODE}`
  );
};

if (require.main === module) {
  main();
}
