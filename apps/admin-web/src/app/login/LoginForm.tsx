'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Lock, Mail, ShieldCheck } from 'lucide-react';
import { getCsrfHeaders } from '@/lib/csrf';

interface LoginState {
  readonly phase: 'idle' | 'submitting' | 'error';
  readonly error?: string;
}

/**
 * Borjie internal HQ login form.
 *
 * LitFin-pattern single-column card:
 *   - Small kicker (`BORJIE HQ`) + display heading + one-sentence sub
 *   - Tinted-bg inputs with icon-prefix at left-3.5
 *   - Full-width gold CTA in `signal-500` with right-arrow affordance
 *   - Trust microcopy footer with secured-with-256 + mono caption
 *
 * This is the *staff-only* legacy `/login` surface that talks to
 * `/api/platform/login` (cookie session, CSRF guarded). The newer
 * Supabase-backed `/sign-in` surface lives at `sign-in/sign-in-form.tsx`
 * and already follows the same idiom.
 */
export function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<LoginState>({ phase: 'idle' });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ phase: 'submitting' });
    try {
      const res = await fetch('/api/platform/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify({ email, password, next }),
      });
      if (res.ok) {
        window.location.href = next;
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setState({
        phase: 'error',
        error:
          body.error ??
          (res.status === 503
            ? 'Identity service is not wired yet.'
            : `Login failed (${res.status}).`),
      });
    } catch (error) {
      setState({
        phase: 'error',
        error: 'Could not reach the identity service.',
      });
    }
  }

  const isSubmitting = state.phase === 'submitting';

  return (
    <div className="w-full max-w-md">
      <header className="mb-10 text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-signal-500 to-signal-700 shadow-md">
          <span className="font-display text-xl font-bold tracking-tight text-neutral-950">
            B
          </span>
        </div>
        <p className="font-mono text-mini uppercase tracking-eyebrow-wide text-signal-500">
          Borjie HQ
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          Sign in to your console.
        </h1>
        <p className="mt-3 text-sm text-neutral-400">
          Staff-only platform access. Identity is verified against the
          Borjie operator directory.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md sm:p-10"
        noValidate
      >
        <div className="space-y-2">
          <label
            htmlFor="login-email"
            className="block text-sm font-medium text-foreground"
          >
            Staff email
          </label>
          <div className="relative">
            <Mail
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
            />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@borjie.co.tz"
              disabled={isSubmitting}
              className="w-full rounded-xl border border-border bg-background py-3 pl-11 pr-3 text-base text-foreground placeholder:text-neutral-500 transition-all focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-500/20 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="login-password"
            className="block text-sm font-medium text-foreground"
          >
            Password
          </label>
          <div className="relative">
            <Lock
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
            />
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-xl border border-border bg-background py-3 pl-11 pr-3 text-base text-foreground placeholder:text-neutral-500 transition-all focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-500/20 disabled:opacity-50"
            />
          </div>
        </div>

        {state.phase === 'error' && state.error ? (
          <p
            role="alert"
            aria-live="assertive"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 py-3.5 text-base font-semibold text-primary-foreground shadow-md transition-all duration-200 hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
          {!isSubmitting && (
            <ArrowRight
              aria-hidden="true"
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            />
          )}
        </button>

        <p className="flex items-center justify-center gap-1.5 pt-1 font-mono text-mini uppercase tracking-eyebrow-wide text-neutral-500">
          <ShieldCheck
            aria-hidden="true"
            className="h-3 w-3 text-signal-500"
          />
          Secured with TLS · 2FA enforced
        </p>
      </form>

      <Link
        href="/"
        className="mt-8 inline-flex items-center justify-center gap-1.5 text-center text-xs text-neutral-500 transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
        Back to home
      </Link>
    </div>
  );
}
