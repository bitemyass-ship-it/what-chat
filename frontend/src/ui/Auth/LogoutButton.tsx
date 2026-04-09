'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { redirectToLogin } from '@/lib/client-auth';

export default function LogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClick = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    await redirectToLogin(router);
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleClick();
      }}
      className="fixed bottom-5 left-5 z-50 inline-flex items-center justify-center rounded-full border border-stone-300 bg-white/90 px-5 py-3 text-sm font-medium text-slatewarm-950 shadow-card backdrop-blur transition-colors duration-200 hover:border-slatewarm-950 hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400"
      disabled={isSubmitting}
    >
      {isSubmitting ? 'Logging out...' : 'Log out'}
    </button>
  );
}
