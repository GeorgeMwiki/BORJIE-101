'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { requirePublicBaseUrl } from '@/lib/env-guard';

const SignInSchema = z.object({
  email: z.string().email('Weka anwani halali ya barua pepe'),
  password: z.string().min(1, 'Nenosiri linahitajika'),
});

interface FormState {
  readonly phase: 'idle' | 'submitting' | 'error';
  readonly error?: string;
}

/**
 * Resolve the api-gateway base URL. The owner-web Next app is served
 * on a different origin (:3010) from the gateway (:4001) in dev, so an
 * absolute URL is required for cookies to land in the correct jar.
 * Production places both behind the same TLS apex via the reverse
 * proxy and the env var resolves to "" (relative).
 *
 * In production builds requirePublicBaseUrl throws when the env var is
 * missing — we want a loud boot failure, not silent localhost fetches.
 */
function gatewayBaseUrl(): string {
  return requirePublicBaseUrl(
    'NEXT_PUBLIC_API_GATEWAY_URL',
    'http://localhost:4001',
  ).replace(/\/$/, '');
}

/**
 * Swahili-first email + password sign-in for the owner cockpit.
 *
 * Posts to `/api/v1/auth/sign-in` (gateway) with `credentials: 'include'`
 * so the encrypted `borjie-session` HttpOnly cookie lands in the
 * owner-web jar. The cockpit's middleware reads the session on the
 * first /dashboard hit and rehydrates a Supabase user from the
 * cookie's access token — the browser never needs to carry the
 * Authorization header itself.
 */
export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<FormState>({ phase: 'idle' });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ phase: 'submitting' });
    const parsed = SignInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? 'Taarifa zisizo sahihi';
      setState({ phase: 'error', error: first });
      return;
    }
    try {
      const res = await fetch(`${gatewayBaseUrl()}/api/v1/auth/sign-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(parsed.data),
      });
      const json = (await res.json().catch(() => null)) as
        | { success: true }
        | { success: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !json?.success) {
        const failure = json && !json.success ? json : null;
        const msg =
          failure?.error?.message ??
          'Imeshindwa kuingia. Hakiki taarifa zako.';
        setState({ phase: 'error', error: msg });
        return;
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setState({
        phase: 'error',
        error:
          err instanceof Error
            ? err.message
            : 'Imeshindwa kuwasiliana na Borjie API.',
      });
    }
  }

  return (
    <div className="w-full max-w-md">
      <header className="mb-10 text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-signal-500 to-signal-700 shadow-md">
          <span className="font-display text-xl font-bold tracking-tight text-neutral-950">
            B
          </span>
        </div>
        <p className="font-mono text-caption uppercase tracking-widest text-signal-500">
          Owner Cockpit
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          Welcome back.
        </h1>
        <p className="mt-3 text-sm text-neutral-400">
          Ingia ili kuendelea kwenye cockpit yako.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md sm:p-10"
        noValidate
      >
        <div className="space-y-2">
          <label
            htmlFor="email"
            className="block text-sm font-medium text-foreground"
          >
            Barua pepe
            <span className="ml-2 font-mono text-caption uppercase tracking-widest text-neutral-500">
              Email
            </span>
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-neutral-500 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="password"
            className="block text-sm font-medium text-foreground"
          >
            Nenosiri
            <span className="ml-2 font-mono text-caption uppercase tracking-widest text-neutral-500">
              Password
            </span>
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-neutral-500 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </div>

        {state.phase === 'error' && state.error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={state.phase === 'submitting'}
          className="w-full rounded-md bg-signal-500 px-4 py-3.5 text-base font-semibold text-primary-foreground shadow-md transition-all duration-fast ease-out hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        >
          {state.phase === 'submitting' ? 'Inaingia…' : 'Ingia'}
        </button>
      </form>

      <p className="mt-8 text-center font-mono text-caption uppercase tracking-widest text-neutral-500">
        Audit chain · bilingual · Tanzania-resident
      </p>
    </div>
  );
}
