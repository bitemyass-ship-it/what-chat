import type { EmployeeRecord } from '../database/types';
import { normalizePhoneDigits } from '../utils/chat-identity';
import { resolveSessionStoragePath } from './client';

export interface EmployeeSessionLocation {
  defaultSessionKey: string | null;
  sessionStoragePath: string | null;
}

const normalizeSessionDir = (
  sessionDir: string | null | undefined
): string | null => {
  if (typeof sessionDir !== 'string') {
    return null;
  }

  const normalizedSessionDir = sessionDir.trim();
  return normalizedSessionDir === '' ? null : normalizedSessionDir;
};

export const resolveEmployeeSessionLocation = (
  employee: Pick<EmployeeRecord, 'phoneNumber' | 'sessionDir'>
): EmployeeSessionLocation => {
  const sessionDir = normalizeSessionDir(employee.sessionDir);
  const defaultSessionKey = normalizePhoneDigits(employee.phoneNumber);

  if (sessionDir) {
    return {
      defaultSessionKey: defaultSessionKey || null,
      sessionStoragePath: sessionDir
    };
  }

  if (!defaultSessionKey) {
    return {
      defaultSessionKey: null,
      sessionStoragePath: null
    };
  }

  return {
    defaultSessionKey,
    sessionStoragePath: resolveSessionStoragePath({
      sessionKey: defaultSessionKey
    })
  };
};
