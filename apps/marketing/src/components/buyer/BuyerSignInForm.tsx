'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Field } from './Field';
import { getMessages, type Locale } from '@/lib/i18n';

interface BuyerSignInFormProps {
  readonly locale: Locale;
  /**
   * Where to land the buyer after a successful sign-in. Defaults to
   * the owner-cockpit dashboard with `as=buyer` so persona-runtime
   * gates the UI to buyer-relevant surfaces.
   */
  readonly redirectTo?: string;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Buyer sign-in form for the marketing surface.
 *
 * Validates `{ email, password }` with Zod, then calls
 * `supabase.auth.signInWithPassword`. On success it does a hard
 * `window.location.assign` to the owner-cockpit dashboard URL because
 * the cockpit is on a different origin (port 3010 in dev) and the
 * Next.js router can only handle same-origin transitions.
 *
 * The Supabase SSR client writes cookies into the marketing-origin
 * jar; the cockpit reads its own SSR cookies once the buyer lands.
 * In a unified prod deployment both share a `.borjie.co.tz` cookie
 * domain so the session crosses origins seamlessly.
 *
 * Failure cases (wrong creds / network / provider down) render an
 * inline error message in the user's chosen locale.
 */
export function BuyerSignInForm({
  locale,
  redirectTo,
}: BuyerSignInFormProps) {
  const t = getMessages(locale).buyerSignInPage;
  const errs = t.errors;
  const params = useSearchParams();
  const fromSignup = params.get('from') === 'signup';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const schema = z.object({
    email: z.string().email(errs.emailRequired),
    password: z.string().min(1, errs.passwordRequired),
  });

  function targetUrl(): string {
    if (redirectTo && redirectTo.length > 0) return redirectTo;
    const fromEnv = process.env.NEXT_PUBLIC_OWNER_WEB_URL;
    const base =
      fromEnv && fromEnv.length > 0
        ? fromEnv.replace(/\/$/, '')
        : 'http://localhost:3010';
    return `${base}/dashboard?as=buyer`;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? errs.signInFailed;
      setPhase({ kind: 'error', message: first });
      return;
    }
    setPhase({ kind: 'submitting' });
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (error) {
        setPhase({ kind: 'error', message: error.message });
        return;
      }
      // Cross-origin redirect — the cockpit on :3010 owns its own
      // Next router; assigning location is the only correct exit.
      window.location.assign(targetUrl());
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : errs.signInFailed,
      });
    }
  }

  return (
    <form
      data-testid="buyer-signin-form"
      onSubmit={handleSubmit}
      noValidate
      className="space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md sm:p-10"
    >
      {fromSignup ? (
        <p
          role="status"
          data-testid="buyer-signin-from-signup"
          className="rounded-md border border-signal-500/30 bg-signal-500/10 p-3 text-sm text-foreground"
        >
          {t.fromSignup}
        </p>
      ) : null}

      <Field
        id="email"
        label={t.fields.email}
        subLabel={t.fields.emailEn}
        required
      >
        <input
          id="email"
          data-testid="buyer-signin-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        />
      </Field>

      <Field
        id="password"
        label={t.fields.password}
        subLabel={t.fields.passwordEn}
        required
      >
        <input
          id="password"
          data-testid="buyer-signin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        />
      </Field>

      {phase.kind === 'error' ? (
        <div
          role="alert"
          data-testid="buyer-signin-error"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {phase.message}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={phase.kind === 'submitting'}
        data-testid="buyer-signin-submit"
        className="w-full rounded-md bg-signal-500 px-4 py-3.5 text-base font-semibold text-primary-foreground shadow-md transition-all duration-fast ease-out hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
      >
        {phase.kind === 'submitting' ? t.actions.submitting : t.actions.submit}
      </button>
    </form>
  );
}
