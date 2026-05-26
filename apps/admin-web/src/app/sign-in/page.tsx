import { Suspense } from 'react';
import { SignInForm } from './sign-in-form';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Sign in — Borjie Console',
};

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Suspense
        fallback={<div className="text-sm text-neutral-500">Loading…</div>}
      >
        <SignInForm />
      </Suspense>
    </div>
  );
}
