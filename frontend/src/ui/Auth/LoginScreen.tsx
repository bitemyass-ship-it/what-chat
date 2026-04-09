'use client';

import {
  startTransition,
  useState,
  type FormEvent
} from 'react';
import { useRouter } from 'next/navigation';

const parseLoginError = async (
  response: Response,
  fallbackMessage: string
): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: unknown };

    if (typeof payload.error === 'string' && payload.error.trim() !== '') {
      return payload.error.trim();
    }
  } catch {
    return fallbackMessage;
  }

  return fallbackMessage;
};

export default function LoginScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          password
        })
      });

      if (!response.ok) {
        setError(await parseLoginError(response, 'Unable to log in right now'));
        return;
      }

      setPassword('');
      startTransition(() => {
        router.push('/');
      });
    } catch {
      setError('Unable to log in right now');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.16),_transparent_34%),linear-gradient(180deg,_#f8f3eb_0%,_#efe5d6_100%)] px-5 py-8 md:px-10 md:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        <section className="w-full max-w-md rounded-[2.2rem] border border-stone-200/80 bg-white/85 p-8 shadow-card backdrop-blur md:p-10">
          <p className="text-xs uppercase tracking-[0.32em] text-slate-500">
            WhatsApp Monitor
          </p>
          <h1 className="mt-4 font-[family-name:var(--font-heading)] text-4xl font-semibold text-slatewarm-950">
            Log in
          </h1>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Enter the shared password to open the dashboard and employee pages.
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.24em] text-slate-500">
                Password
              </span>
              <input
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-[1.2rem] border border-stone-300 bg-white px-4 py-3 text-base text-slatewarm-950 outline-none transition-colors duration-200 placeholder:text-slate-400 focus:border-slatewarm-950"
                placeholder="Shared password"
                autoComplete="current-password"
              />
            </label>

            {error ? (
              <div className="rounded-[1.2rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center rounded-full bg-slatewarm-950 px-5 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-slatewarm-900 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isSubmitting ? 'Checking password...' : 'Log in'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
