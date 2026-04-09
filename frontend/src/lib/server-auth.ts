import 'server-only';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME } from './auth';

export const getServerAuthPassword = async (): Promise<string | null> => {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
};
