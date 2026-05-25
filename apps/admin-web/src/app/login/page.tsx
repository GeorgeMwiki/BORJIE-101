import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Suspense fallback={<div className="text-sm text-neutral-500">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
