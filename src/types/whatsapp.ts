export interface MessagePayload {
  body: string;
  messageId?: string;
  chatId?: string;
  from: string;
  fromMe?: boolean;
  ingestSource?: 'live' | 'poll';
  author?: string;
  type?: string;
  ack?: number;
  hasMedia?: boolean;
  isForwarded?: boolean;
  forwardingScore?: number;
  quotedMessageId?: string | null;
  phoneNumber?: string;
  rawPayload?: unknown;
  timestamp?: number;
  to?: string;
}

export interface CallPayload {
  callId: string;
  chatId?: string;
  from?: string;
  fromMe?: boolean;
  ingestSource?: 'live' | 'poll';
  isVideo?: boolean;
  phoneNumber?: string;
  rawPayload?: unknown;
  status: 'incoming' | 'outgoing' | 'missed';
  timestamp?: number;
  to?: string;
}

export interface WhatsappRuntimeChat {
  archived?: boolean;
  fetchMessages?(options?: { limit?: number }): Promise<unknown[]>;
  formattedTitle?: string;
  id?: string | { _serialized?: string; id?: string };
  isArchived?: boolean;
  isGroup?: boolean;
  isPinned?: boolean;
  name?: string;
  pinned?: boolean;
  timestamp?: number;
  unreadCount?: number;
}

export interface WhatsappSessionClient {
  destroy(): Promise<void>;
  getContactLidAndPhone?(userIds: string[]): Promise<Array<{ lid: string; pn: string }>>;
  getChats?(): Promise<WhatsappRuntimeChat[]>;
  getState?(): Promise<string>;
  initialize(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export interface WhatsappClientFactory {
  create(
    sessionKey: string,
    options?: {
      sessionStoragePath?: string | null;
    }
  ): WhatsappSessionClient;
}

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface QrTerminal {
  generate(value: string, options: { small: boolean }): void;
}

export type SessionRuntimeStatus =
  | 'auth_failed'
  | 'disconnected'
  | 'failed'
  | 'not_started'
  | 'ready'
  | 'starting'
  | 'stopped'
  | 'waiting_for_qr';

export interface SessionHealth {
  employeeId: string;
  hasRuntimeSession: boolean;
  isSessionActive: boolean;
  lastCheckedAt: string | null;
  lastDisconnectReason: string | null;
  lastError: string | null;
  lastEventAt: string | null;
  lastReadyAt: string | null;
  qrCode: string | null;
  runtimeStatus: SessionRuntimeStatus;
  whatsappState: string | null;
}

export interface SessionManager {
  getSessionHealth(employeeId: string): Promise<SessionHealth>;
  shutdown(): Promise<void>;
  syncChats?(
    employeeId: string,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<void>;
  startSession(employeeId: string): Promise<void>;
  startAll(employeeIds: string[]): Promise<void>;
  stopSession(employeeId: string): Promise<void>;
}

export interface MessageHandler {
  handle(employeeId: string, message: MessagePayload): void | Promise<void>;
}

export interface CallHandler {
  handle(employeeId: string, call: CallPayload): void | Promise<void>;
}
