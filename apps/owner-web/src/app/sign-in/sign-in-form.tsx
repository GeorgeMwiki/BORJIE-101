'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const SignInSchema = z.object({
  email: z.string().email('Weka anwani halali ya barua pepe'),
  password: z.string().min(1, 'Nenosiri linahitajika'),
});

type SignInInput = z.infer<typeof SignInSchema>;

interface FormState {
  readonly phase: 'idle' | 'submitting' | 'error';
  readonly error?: string;
}

/**
 * Swahili-first email + password sign-in for the owner cockpit.
 *
 * Validates with Zod, then calls `supabase.auth.signInWithPassword`.
 * On success, redirects to the `next` query param (or `/`) and lets
 * Next.js middleware re-validate the session. Supabase SSR cookies
 * are written by the browser client via `@supabase/ssr`'s document
 * cookie writer, so server components see the new session on the
 * next navigation without an extra round trip.
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
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      } satisfies SignInInput);
      if (error) {
        setState({ phase: 'error', error: error.message });
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
            : 'Imeshindwa kuwasiliana na Supabase Auth',
      });
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-lg">
      <header className="mb-6">
        <h1 className="text-lg font-medium text-foreground">
          Borjie Owner Cockpit
        </h1>
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          Ingia
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label
            htmlFor="email"
            className="block text-xs font-medium text-neutral-300 mb-1"
          >
            Barua pepe
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground placeholder:text-neutral-500 focus:border-amber-500 focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-xs font-medium text-neutral-300 mb-1"
          >
            Nenosiri
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground placeholder:text-neutral-500 focus:border-amber-500 focus:outline-none"
          />
        </div>

        {state.phase === 'error' && state.error ? (
          <p role="alert" className="text-sm text-rose-400">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={state.phase === 'submitting'}
          className="w-full rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.phase === 'submitting' ? 'Inaingia…' : 'Ingia'}
        </button>
      </form>
    </div>
  );
}
