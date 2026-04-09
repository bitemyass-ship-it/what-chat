import { AUTH_HEADER_NAME, isBlankAuthValue } from './auth';

const DEFAULT_DEV_API_BASE_URL = 'http://localhost:3050';

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/u, '');

const logEmployeeApiError = (
  message: string,
  meta?: Record<string, unknown>
): void => {
  console.error(message, meta ?? {});
};

export const resolveEmployeesApiBaseUrl = (): string | null => {
  const configuredValue = process.env.EMPLOYEES_API_BASE_URL?.trim();

  if (configuredValue) {
    try {
      return trimTrailingSlashes(new URL(configuredValue).toString());
    } catch (error) {
      logEmployeeApiError('Employee API base URL is invalid', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    return DEFAULT_DEV_API_BASE_URL;
  }

  logEmployeeApiError('Employee API base URL is missing in production');
  return null;
};

interface FetchAuthenticatedBackendOptions {
  apiBaseUrl?: string | null;
  authPassword: string | null;
  body?: BodyInit;
  contentType?: string | null;
  fetchImpl?: typeof fetch;
  method: 'GET' | 'PATCH' | 'POST' | 'DELETE';
  path: string;
  timeoutMs: number;
}

export const fetchAuthenticatedBackend = async ({
  apiBaseUrl = resolveEmployeesApiBaseUrl(),
  authPassword,
  body,
  contentType,
  fetchImpl = fetch,
  method,
  path,
  timeoutMs
}: FetchAuthenticatedBackendOptions): Promise<Response | 'config_error' | 'unauthorized'> => {
  if (!apiBaseUrl) {
    return 'config_error';
  }

  if (isBlankAuthValue(authPassword)) {
    return 'unauthorized';
  }

  if (authPassword === null) {
    return 'unauthorized';
  }

  const headers = new Headers();
  headers.set(AUTH_HEADER_NAME, authPassword);

  if (contentType) {
    headers.set('content-type', contentType);
  }

  return fetchImpl(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs)
  });
};
