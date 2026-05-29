import { Suspense } from 'react';
import { SignInForm } from './sign-in-form';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Sign in — Borjie Console',
};

/**
 * Borjie internal HQ sign-in landing. LitFin-pattern: full-screen
 * centered single-column card with subtle aurora backdrop. Form
 * component owns the editorial weight (wordmark, heading, fields).
 */
export default function SignInPage() {
  return (
    <main
      className="relative min-h-screen overflow-hidden bg-background p-6"
      id="main-content"
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
          fallback={<div className="text-sm text-neutral-500">Loading…</div>}
        >
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
