'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';

import { apiBaseUrl } from '@/lib/api';
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { getMessages, type Locale } from '@/lib/i18n';

interface OwnerSignInFormProps {
  readonly locale: Locale;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | {
      readonly kind: 'error';
      readonly field?: 'email' | 'password' | 'form';
      readonly message: string;
    };

/**
 * Owner sign-in form for the public marketing surface.
 *
 * Posts `{ email, password }` to `/api/v1/auth/sign-in` with
 * `credentials: 'include'` so the encrypted `borjie-session` HttpOnly
 * cookie lands in the marketing-origin jar. On success the visitor is
 * hard-redirected to `NEXT_PUBLIC_OWNER_WEB_ORIGIN/dashboard` because
 * the owner cockpit lives on a different origin in dev (`:3010`) and
 * the Next.js router only handles same-origin transitions.
 *
 * Field-scoped errors render inline (no toast) so the failure point is
 * visually anchored next to the input that produced it. The structured
 * gateway response (`error.code` + optional `error.field`) drives the
 * mapping.
 */
export function OwnerSignInForm({ locale }: OwnerSignInFormProps) {
  const t = getMessages(locale).ownerSignInPage;
  const params = useSearchParams();
  const fromSignup = params.get('from') === 'signup';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const schema = z.object({
    email: z.string().email(t.errors.emailRequired),
    password: z.string().min(1, t.errors.passwordRequired),
  });

  function targetUrl(): string {
    // requirePublicBaseUrl throws in prod when env unset — avoids silent
    // redirect to localhost from the deployed marketing site.
    const base = requirePublicBaseUrl(
      'NEXT_PUBLIC_OWNER_WEB_ORIGIN',
      'http://localhost:3010',
    ).replace(/\/$/, '');
    return `${base}/dashboard`;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path?.[0] === 'password' ? 'password' : 'email';
      setPhase({
        kind: 'error',
        field,
        message: issue?.message ?? t.errors.signInFailed,
      });
      return;
    }
    setPhase({ kind: 'submitting' });
    try {
      const res = await fetch(`${apiBaseUrl()}/api/v1/auth/sign-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(parsed.data),
      });
      const json = (await res.json().catch(() => null)) as
        | { success: true }
        | { success: false; error: { code: string; message: string; field?: string } }
        | null;
      if (res.ok && json?.success) {
        // Cross-origin redirect — the cockpit on a different origin
        // owns its own Next router; assigning location is the only
        // correct exit.
        window.location.assign(targetUrl());
        return;
      }
      const failure = json && !json.success ? json : null;
      const code = failure?.error?.code ?? 'UNKNOWN';
      const msg = failure?.error?.message ?? t.errors.signInFailed;
      const fieldHint = failure?.error?.field;
      const field =
        code === 'INVALID_CREDENTIALS'
          ? 'password'
          : fieldHint === 'email' || fieldHint === 'password'
            ? (fieldHint as 'email' | 'password')
            : 'form';
      setPhase({ kind: 'error', field, message: msg });
    } catch (err) {
      setPhase({
        kind: 'error',
        field: 'form',
        message: err instanceof Error ? err.message : t.errors.signInFailed,
      });
    }
  }

  const fieldError = (target: 'email' | 'password'): string | null => {
    if (phase.kind !== 'error') return null;
    return phase.field === target ? phase.message : null;
  };

  const formError =
    phase.kind === 'error' && phase.field === 'form' ? phase.message : null;

  return (
    <form
      data-testid="owner-signin-form"
      onSubmit={handleSubmit}
      noValidate
      className="space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md sm:p-10"
    >
      {fromSignup ? (
        <p
          role="status"
          data-testid="owner-signin-from-signup"
          className="rounded-md border border-signal-500/30 bg-signal-500/10 p-3 text-sm text-foreground"
        >
          {t.fromSignup}
        </p>
      ) : null}

      <div className="space-y-2">
        <label
          htmlFor="owner-signin-email"
          className="block text-sm font-medium text-foreground"
        >
          {t.fields.email}
          <span className="ml-2 font-mono text-caption uppercase tracking-widest text-neutral-500">
            {t.fields.emailEn}
          </span>
        </label>
        <input
          id="owner-signin-email"
          data-testid="owner-signin-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          aria-invalid={fieldError('email') ? true : undefined}
          aria-describedby={fieldError('email') ? 'owner-signin-email-error' : undefined}
          className="w-full rounded-md border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        />
        {fieldError('email') ? (
          <p
            id="owner-signin-email-error"
            role="alert"
            data-testid="owner-signin-email-error"
            className="text-sm text-destructive"
          >
            {fieldError('email')}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="owner-signin-password"
          className="block text-sm font-medium text-foreground"
        >
          {t.fields.password}
          <span className="ml-2 font-mono text-caption uppercase tracking-widest text-neutral-500">
            {t.fields.passwordEn}
          </span>
        </label>
        <input
          id="owner-signin-password"
          data-testid="owner-signin-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          aria-invalid={fieldError('password') ? true : undefined}
          aria-describedby={fieldError('password') ? 'owner-signin-password-error' : undefined}
          className="w-full rounded-md border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        />
        {fieldError('password') ? (
          <p
            id="owner-signin-password-error"
            role="alert"
            data-testid="owner-signin-password-error"
            className="text-sm text-destructive"
          >
            {fieldError('password')}
          </p>
        ) : null}
      </div>

      {formError ? (
        <div
          role="alert"
          data-testid="owner-signin-form-error"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {formError}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={phase.kind === 'submitting'}
        data-testid="owner-signin-submit"
        className="w-full rounded-md bg-signal-500 px-4 py-3.5 text-base font-semibold text-primary-foreground shadow-md transition-all duration-fast ease-out hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
      >
        {phase.kind === 'submitting' ? t.actions.submitting : t.actions.submit}
      </button>
    </form>
  );
}
