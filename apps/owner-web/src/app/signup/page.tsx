/**
 * /signup — Owner self-signup landing.
 *
 * Server Component. Redirects to `/` if the visitor already has a
 * Supabase session; otherwise renders the SignupWizard client island.
 *
 * LitFin-pattern editorial frame: small kicker, declarative heading,
 * one-sentence sub, wizard in generous card. Aurora + grid backdrop
 * mirrors the marketing surface so the surface reads as one product.
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
    <main
      id="main-content"
      className="relative min-h-screen overflow-hidden bg-background px-6 py-12 sm:py-20"
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 0%, hsl(var(--signal-500) / 0.10) 0%, transparent 60%)',
        }}
      />
      <div className="relative mx-auto w-full max-w-2xl">
        <header className="mb-10 text-center">
          <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-signal-500 to-signal-700 shadow-md">
            <span className="font-display text-xl font-bold tracking-tight text-neutral-950">
              B
            </span>
          </div>
          <p className="font-mono text-caption uppercase tracking-widest text-signal-500">
            Borjie Owner Cockpit
          </p>
          <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            Welcome to Borjie.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-neutral-400">
            Jisajili ili kuanza kusimamia mgodi wako. Welcome to Borjie — sign
            up to start managing your mining operation.
          </p>
        </header>
        <SignupWizard />
      </div>
    </main>
  );
}
