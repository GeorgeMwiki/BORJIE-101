import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Sign in — Borjie HQ',
};

/**
 * Legacy `/login` landing (staff platform session).
 *
 * LitFin-pattern: full-screen centered card with a soft gold aurora at
 * the top of the canvas. The form component owns its own visual rhythm
 * (wordmark, kicker, heading, fields, trust microcopy).
 */
export default function LoginPage() {
  return (
    <main
      id="main-content"
      className="relative min-h-screen overflow-hidden bg-background p-6"
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 10%, hsl(var(--signal-500) / 0.12) 0%, transparent 60%)',
        }}
      />
      <div className="relative flex min-h-shell items-center justify-center">
        <Suspense
          fallback={
            <div className="text-sm text-neutral-500">Loading…</div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
