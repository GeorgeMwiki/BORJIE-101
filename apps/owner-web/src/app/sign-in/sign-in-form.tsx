'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useT } from '@/i18n/t.client';

interface FormState {
  readonly phase: 'idle' | 'submitting' | 'error';
  readonly error?: string;
}

/**
 * Swahili-first email + password sign-in for the owner cockpit.
 *
 * Signs in directly via the Supabase browser client
 * (`signInWithPassword`), which writes the `sb-*` SSR cookies that the
 * cockpit middleware, `getOwnerSession`, and the in-app chat widget all
 * read — the same proven path admin-web uses. (The previous gateway
 * `/api/v1/auth/sign-in` → encrypted `borjie-session` cookie was never
 * bridged into the Supabase SSR session the middleware gates on, so a
 * "successful" sign-in bounced /dashboard → /sign-in in a loop.)
 */
export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useT();
  const next = params.get('next') ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<FormState>({ phase: 'idle' });

  const schema = useMemo(
    () =>
      z.object({
        email: z.string().email(t('auth.signIn.errorInvalidEmail')),
        password: z.string().min(1, t('auth.signIn.errorPasswordRequired')),
      }),
    [t],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ phase: 'submitting' });
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      const first =
        parsed.error.issues[0]?.message ?? t('auth.signIn.errorInvalidInput');
      setState({ phase: 'error', error: first });
      return;
    }
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (error) {
        setState({
          phase: 'error',
          error: error.message ?? t('auth.signIn.errorSignInFailed'),
        });
        return;
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setState({
        phase: 'error',
        error:
          err instanceof Error ? err.message : t('auth.signIn.errorNetwork'),
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
          {t('auth.signIn.eyebrow')}
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {t('auth.signIn.heading')}
        </h1>
        <p className="mt-3 text-sm text-neutral-400">
          {t('auth.signIn.subheading')}
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
            {t('auth.signIn.emailLabel')}
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
            {t('auth.signIn.passwordLabel')}
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
          {state.phase === 'submitting'
            ? t('auth.signIn.submitting')
            : t('auth.signIn.submit')}
        </button>
      </form>

      <p className="mt-8 text-center font-mono text-caption uppercase tracking-widest text-neutral-500">
        {t('auth.signIn.footer')}
      </p>
    </div>
  );
}
