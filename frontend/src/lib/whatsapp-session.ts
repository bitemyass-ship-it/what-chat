import {
  normalizeNullableText,
  parseEmployeeTimestamp
} from './employee-record';

export type WhatsappRuntimeStatus =
  | 'not_started'
  | 'starting'
  | 'waiting_for_qr'
  | 'ready'
  | 'auth_failed'
  | 'disconnected'
  | 'failed'
  | 'stopped';

export interface WhatsappSession {
  employeeId: string;
  hasRuntimeSession: boolean;
  whatsappActive: boolean;
  runtimeStatus: WhatsappRuntimeStatus;
  whatsappState: string | null;
  qrCode: string | null;
  lastError: string | null;
  lastDisconnectReason: string | null;
  lastEventAt: string | null;
  lastReadyAt: string | null;
  lastCheckedAt: string | null;
}

const WHATSAPP_RUNTIME_STATUS_LABELS: Record<WhatsappRuntimeStatus, string> = {
  not_started: 'Not started',
  starting: 'Starting',
  waiting_for_qr: 'Waiting for QR',
  ready: 'Connected',
  auth_failed: 'Auth failed',
  disconnected: 'Disconnected',
  failed: 'Failed',
  stopped: 'Stopped'
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isWhatsappRuntimeStatus = (
  value: unknown
): value is WhatsappRuntimeStatus =>
  typeof value === 'string' && value in WHATSAPP_RUNTIME_STATUS_LABELS;

export const deserializeWhatsappSession = (
  value: unknown
): WhatsappSession | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.employeeId !== 'string' || value.employeeId.trim() === '') {
    return null;
  }

  if (typeof value.hasRuntimeSession !== 'boolean') {
    return null;
  }

  if (typeof value.whatsappActive !== 'boolean') {
    return null;
  }

  if (!isWhatsappRuntimeStatus(value.runtimeStatus)) {
    return null;
  }

  return {
    employeeId: value.employeeId.trim(),
    hasRuntimeSession: value.hasRuntimeSession,
    whatsappActive: value.whatsappActive,
    runtimeStatus: value.runtimeStatus,
    whatsappState: normalizeNullableText(value.whatsappState),
    qrCode: normalizeNullableText(value.qrCode),
    lastError: normalizeNullableText(value.lastError),
    lastDisconnectReason: normalizeNullableText(value.lastDisconnectReason),
    lastEventAt: normalizeNullableText(value.lastEventAt),
    lastReadyAt: normalizeNullableText(value.lastReadyAt),
    lastCheckedAt: normalizeNullableText(value.lastCheckedAt)
  };
};

export const getWhatsappRuntimeStatusLabel = (
  status: WhatsappRuntimeStatus
): string => WHATSAPP_RUNTIME_STATUS_LABELS[status];

export const isWhatsappSessionConnected = (
  session: WhatsappSession | null
): boolean => session?.runtimeStatus === 'ready';

export const isWhatsappSessionPending = (
  session: WhatsappSession | null
): boolean =>
  session?.runtimeStatus === 'starting' ||
  session?.runtimeStatus === 'waiting_for_qr';

export const formatWhatsappSessionDateTime = (
  value: string | null
): string | null => {
  const parsedDate = parseEmployeeTimestamp(value);

  if (!parsedDate) {
    return null;
  }

  return `${new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  }).format(parsedDate)} UTC`;
};
