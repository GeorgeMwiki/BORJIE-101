/**
 * /signup — Owner self-signup landing.
 *
 * Server Component. Redirects to `/` if the visitor already has a
 * Supabase session; otherwise renders the SignupWizard client island.
 *
 * The signup wizard itself is fully client-driven because each step
 * persists form state to localStorage for refresh-resilience and the
 * final step talks to the Supabase browser client for OTP entry.
 */

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SignupWizard } from '@/components/signup/SignupWizard';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Jisajili — Borjie Owner Cockpit',
};

export default async function SignupPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) {
    redirect('/');
  }
  return (
    <main className="min-h-screen bg-background px-6 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-[0.18em] text-amber-500">
            Borjie
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">
            Karibu Borjie
          </h1>
          <p className="mt-2 text-sm text-neutral-400">
            Jisajili ili kuanza kusimamia mgodi wako. Welcome to Borjie —
            sign up to start managing your mining operation.
          </p>
        </header>
        <SignupWizard />
      </div>
    </main>
  );
}
