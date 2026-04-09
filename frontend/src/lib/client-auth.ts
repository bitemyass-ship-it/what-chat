'use client';

import { startTransition } from 'react';

interface RouterLike {
  push?(href: string): void;
  refresh(): void;
  replace?(href: string): void;
}

export const redirectToLogin = async (router: RouterLike): Promise<void> => {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      cache: 'no-store'
    });
  } catch {
    // Best effort only. Navigation to the login gate must still happen.
  }

  startTransition(() => {
    if (router.replace) {
      router.replace('/');
    } else {
      router.push?.('/');
    }

    router.refresh();
  });
};

export const handleUnauthorizedClientResponse = async (
  response: Response,
  router: RouterLike
): Promise<boolean> => {
  if (response.status !== 401) {
    return false;
  }

  await redirectToLogin(router);
  return true;
};
