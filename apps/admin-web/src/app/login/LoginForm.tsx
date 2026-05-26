'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Logomark } from '@borjie/design-system';
import { getCsrfHeaders } from '@/lib/csrf';

interface LoginState {
  readonly phase: 'idle' | 'submitting' | 'error';
  readonly error?: string;
}

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
      console.error('Login submit failed:', error);
      setState({
        phase: 'error',
        error: 'Could not reach the identity service.',
      });
    }
  }

  return (
    <div className="w-full max-w-sm platform-card">
      <div className="flex items-center gap-3 mb-6">
        <Logomark size={36} variant="premium" />
        <div>
          <div className="text-lg font-display text-foreground">Borjie</div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            HQ staff sign-in
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="label">
            Staff email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </div>

        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
        </div>

        {state.phase === 'error' && state.error ? (
          <div role="alert" aria-live="assertive" className="text-xs text-danger">
            {state.error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={state.phase === 'submitting'}
          className="btn-primary w-full"
        >
          {state.phase === 'submitting' ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-xs text-neutral-500 mt-6">
        Staff only. This surface is not reachable without a valid Borjie
        platform session.
      </p>
    </div>
  );
}
