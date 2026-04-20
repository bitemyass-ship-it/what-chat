export interface EmployeeRecord {
  id: number;
  code: string;
  displayName: string | null;
  phoneNumber: string | null;
  isActive: boolean;
  sessionDir: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployeeInput {
  code: string;
  displayName?: string | null;
  phoneNumber?: string | null;
  isActive?: boolean;
  sessionDir?: string | null;
}

export interface UpsertEmployeeInput {
  code: string;
  displayName?: string | null;
  phoneNumber?: string | null;
  isActive?: boolean;
  sessionDir?: string | null;
}

export interface EmployeesRepository {
  count(): number;
  create(input: CreateEmployeeInput): EmployeeRecord;
  deleteByCode(code: string): boolean;
  findByCode(code: string): EmployeeRecord | undefined;
  listActive(): EmployeeRecord[];
  listAll(): EmployeeRecord[];
  upsert(input: UpsertEmployeeInput): EmployeeRecord;
}

export interface ChatRecord {
  id: number;
  employeeId: number;
  contactKey: string;
  chatId: string;
  displayName: string | null;
  chatKind: string;
  isArchived: boolean;
  isPinned: boolean;
  unreadCount: number;
  lastMessageId: string | null;
  lastMessagePreview: string | null;
  phoneNumber: string | null;
  lastPolledAt: string | null;
  lastMessagesSyncedAt: string | null;
  lastMessageTimestamp: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatAnalyticsRecord extends ChatRecord {
  firstMessageTimestamp: number | null;
  incomingMessages: number;
  outgoingMessages: number;
  totalMessages: number;
}

export interface PaginationOptions {
  limit: number;
  offset: number;
}

export interface UpsertChatByEmployeeCodeInput {
  employeeCode: string;
  chatId: string;
  displayName?: string | null;
  chatKind?: string;
  isPhoneNumberVerified?: boolean;
  isArchived?: boolean;
  isPinned?: boolean;
  unreadCount?: number;
  lastMessageId?: string | null;
  lastMessagePreview?: string | null;
  lastPolledAt?: string | null;
  lastMessagesSyncedAt?: string | null;
  phoneNumber?: string | null;
  lastMessageTimestamp?: number | null;
}

export interface ChatsRepository {
  countByEmployeeCode(employeeCode: string): number;
  findByEmployeeCodeAndChatId(employeeCode: string, chatId: string): ChatRecord | undefined;
  findByEmployeeCodeAndRecordId(employeeCode: string, chatRecordId: number): ChatRecord | undefined;
  listAnalyticsByEmployeeCode(
    employeeCode: string,
    options?: PaginationOptions
  ): ChatAnalyticsRecord[];
  listByEmployeeCode(employeeCode: string): ChatRecord[];
  upsertByEmployeeCode(input: UpsertChatByEmployeeCodeInput): ChatRecord;
}

export interface MessageRecord {
  id: number;
  employeeId: number;
  chatRecordId: number;
  externalMessageId: string;
  sourceChatId: string;
  direction: 'incoming' | 'outgoing' | 'system';
  body: string;
  messageType: string;
  callStatus: 'incoming' | 'outgoing' | 'missed' | null;
  callMediaType: 'voice' | 'video' | null;
  timestamp: number | null;
  fromJid: string | null;
  toJid: string | null;
  authorJid: string | null;
  ack: number | null;
  hasMedia: boolean;
  isForwarded: boolean;
  forwardingScore: number;
  hasQuotedMsg: boolean;
  quotedMessageExternalId: string | null;
  ingestSource: 'live' | 'poll';
  rawPayloadJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertMessageInput {
  employeeCode: string;
  chatId: string;
  externalMessageId: string;
  sourceChatId: string;
  direction: 'incoming' | 'outgoing' | 'system';
  body?: string;
  messageType?: string;
  callStatus?: 'incoming' | 'outgoing' | 'missed' | null;
  callMediaType?: 'voice' | 'video' | null;
  timestamp?: number | null;
  fromJid?: string | null;
  toJid?: string | null;
  authorJid?: string | null;
  ack?: number | null;
  hasMedia?: boolean;
  isForwarded?: boolean;
  forwardingScore?: number;
  hasQuotedMsg?: boolean;
  quotedMessageExternalId?: string | null;
  ingestSource?: 'live' | 'poll';
  rawPayloadJson?: string | null;
}

export interface MessagesRepository {
  countByEmployeeCodeAndChatRecordId(employeeCode: string, chatRecordId: number): number;
  findByEmployeeCodeAndExternalMessageId(
    employeeCode: string,
    externalMessageId: string
  ): MessageRecord | undefined;
  listByEmployeeCodeAndChatRecordId(
    employeeCode: string,
    chatRecordId: number,
    options?: Partial<PaginationOptions>
  ): MessageRecord[];
  upsertByEmployeeCode(input: UpsertMessageInput): MessageRecord;
}

export interface Database {
  close(): void;
  chats: ChatsRepository;
  employees: EmployeesRepository;
  messages: MessagesRepository;
}
