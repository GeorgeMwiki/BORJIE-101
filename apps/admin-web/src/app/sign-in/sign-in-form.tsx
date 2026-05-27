'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const SignInSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type SignInInput = z.infer<typeof SignInSchema>;

interface FormState {
  readonly phase: 'idle' | 'submitting' | 'error';
  readonly error?: string;
}

/**
 * Email + password sign-in form for the Borjie Console.
 *
 * LitFin-pattern single-column card: gradient wordmark above, kicker
 * + declarative heading, generous spacing, full-width primary CTA in
 * signal-gold. Trust microcopy below.
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
      const first = parsed.error.issues[0]?.message ?? 'Invalid input';
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
            : 'Could not reach Supabase Auth',
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
          Borjie Console
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          Welcome back.
        </h1>
        <p className="mt-3 text-sm text-neutral-400">
          Sign in to the internal Borjie HQ.
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
            Email
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
            Password
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
          {state.phase === 'submitting' ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-8 text-center font-mono text-caption uppercase tracking-widest text-neutral-500">
        Borjie internal · staff only · 2FA enforced
      </p>
    </div>
  );
}
