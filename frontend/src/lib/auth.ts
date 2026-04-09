import type { NextResponse } from 'next/server';

export const AUTH_COOKIE_NAME = 'wm_auth_password';
export const AUTH_HEADER_NAME = 'X-User-Password';
export const INVALID_PASSWORD_ERROR = 'Invalid password';
export const PASSWORD_REQUIRED_ERROR = 'Password is required';
export const UNAUTHORIZED_ERROR = 'Unauthorized';
export const AUTH_ENDPOINT_UNREACHABLE_ERROR = 'Unable to reach auth endpoint';

const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax' as const,
  secure: false
};

export const isBlankAuthValue = (value: string | null | undefined): boolean =>
  value === undefined || value === null || value.trim() === '';

export const getCookieValue = (
  cookieHeader: string | null,
  name: string
): string | null => {
  if (!cookieHeader) {
    return null;
  }

  for (const chunk of cookieHeader.split(/;\s*/u)) {
    const separatorIndex = chunk.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = chunk.slice(0, separatorIndex).trim();

    if (key !== name) {
      continue;
    }

    return decodeURIComponent(chunk.slice(separatorIndex + 1));
  }

  return null;
};

export const getAuthPasswordFromRequest = (
  request: Pick<Request, 'headers'>
): string | null => getCookieValue(request.headers.get('cookie'), AUTH_COOKIE_NAME);

export const setAuthCookie = (response: NextResponse, password: string): void => {
  response.cookies.set({
    ...AUTH_COOKIE_OPTIONS,
    name: AUTH_COOKIE_NAME,
    value: password
  });
};

export const clearAuthCookie = (response: NextResponse): void => {
  response.cookies.set({
    ...AUTH_COOKIE_OPTIONS,
    maxAge: 0,
    name: AUTH_COOKIE_NAME,
    value: ''
  });
};
