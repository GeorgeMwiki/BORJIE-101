'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { Button } from '@borjie/design-system';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { sanitizeNext } from '@/lib/safe-next';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

type SignInInput = { readonly email: string; readonly password: string };

/**
 * Map a raw Supabase Auth error to a localized, user-facing message.
 *
 * Supabase returns English-only strings (e.g. "Invalid login credentials")
 * on `error.message`; rendering that verbatim paints English on a Swahili
 * console — a zero-mix canon violation. We classify the error and return a
 * string in the ACTIVE locale only. The raw `error.message` is kept for
 * logs, never for the banner.
 */
export function localizeAuthError(rawMessage: string, locale: Locale): string {
  const m = rawMessage.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid')) {
    return pickByLocale(locale, {
      en: 'Incorrect email or password.',
      sw: 'Barua pepe au nenosiri si sahihi.',
    });
  }
  if (m.includes('email not confirmed') || m.includes('not confirmed')) {
    return pickByLocale(locale, {
      en: 'Confirm your email before signing in.',
      sw: 'Thibitisha barua pepe yako kabla ya kuingia.',
    });
  }
  if (m.includes('rate') || m.includes('too many')) {
    return pickByLocale(locale, {
      en: 'Too many attempts. Try again shortly.',
      sw: 'Majaribio mengi mno. Jaribu tena baada ya muda.',
    });
  }
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to')) {
    return pickByLocale(locale, {
      en: 'Network problem. Check your connection and retry.',
      sw: 'Tatizo la mtandao. Angalia muunganisho wako kisha ujaribu tena.',
    });
  }
  // Unknown auth failure — a single generic localized message, never the
  // raw English string.
  return pickByLocale(locale, {
    en: 'Could not sign in. Please try again.',
    sw: 'Imeshindwa kuingia. Tafadhali jaribu tena.',
  });
}

interface FormState {
  readonly phase: 'idle' | 'submitting' | 'error';
  readonly error?: string;
}

export interface SignInFormProps {
  /**
   * Server-resolved locale, passed down from SignInPage so useLocale seeds
   * the first client render to the SAME language the SSR chrome used.
   * Otherwise useLocale defaults to EN and renders a one-frame EN body
   * under SW chrome (the first-paint split-brain — zero-mix canon
   * violation).
   */
  readonly initialLocale?: Locale;
}

/**
 * Email + password sign-in form for the Borjie Console.
 *
 * Single-column card pattern: gradient wordmark above, kicker
 * + declarative heading, generous spacing, full-width primary CTA in
 * signal-gold. Trust microcopy below.
 */
export function SignInForm({ initialLocale }: SignInFormProps = {}) {
  const locale = useLocale(initialLocale);
  const router = useRouter();
  const params = useSearchParams();
  // Build the zod schema with locale-aware messages so the EN/SW pivot reaches
  // even the validation toasts (rather than the visitor getting "Enter a valid
  // email address" on a Swahili surface).
  const SignInSchema = z.object({
    email: z
      .string()
      .email(
        pickByLocale(locale, {
          en: 'Enter a valid email address',
          sw: 'Weka barua pepe sahihi',
        }),
      ),
    password: z
      .string()
      .min(
        1,
        pickByLocale(locale, {
          en: 'Password is required',
          sw: 'Nenosiri linahitajika',
        }),
      ),
  });
  // Guard against open-redirect: only same-origin absolute paths survive.
  const next = sanitizeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<FormState>({ phase: 'idle' });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ phase: 'submitting' });
    const parsed = SignInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const first =
        parsed.error.issues[0]?.message ??
        pickByLocale(locale, { en: 'Invalid input', sw: 'Maelezo si sahihi' });
      setState({ phase: 'error', error: first });
      return;
    }
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      } satisfies SignInInput);
      if (error) {
        // Log the raw English string for diagnostics; render a localized
        // message so the banner never mixes English onto an SW console.
        console.error('Console sign-in failed:', error.message);
        setState({
          phase: 'error',
          error: localizeAuthError(error.message, locale),
        });
        return;
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      // Keep the raw failure for logs; never render `err.message` (an
      // English exception string) onto a possibly-SW console.
      if (err instanceof Error) {
        console.error('Console sign-in threw:', err.message);
      }
      setState({
        phase: 'error',
        error: pickByLocale(locale, {
          en: 'Could not reach the sign-in service. Try again.',
          sw: 'Imeshindwa kufikia huduma ya kuingia. Jaribu tena.',
        }),
      });
    }
  }

  return (
    <div className="w-full max-w-md">
      <header className="mb-10 text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-signal-500 to-signal-700 shadow-md">
          <span className="font-display text-xl font-bold tracking-tight text-neutral-950">
            B
          </span>
        </div>
        <p className="font-mono text-caption uppercase tracking-widest text-signal-500">
          {pickByLocale(locale, { en: 'Borjie Console', sw: 'Konsoli ya Borjie' })}
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {pickByLocale(locale, { en: 'Welcome back.', sw: 'Karibu tena.' })}
        </h1>
        <p className="mt-3 text-sm text-neutral-400">
          {pickByLocale(locale, {
            en: 'Sign in to the internal Borjie HQ.',
            sw: 'Ingia kwenye Makao Makuu ya ndani ya Borjie.',
          })}
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md sm:p-10"
        noValidate
      >
        <div className="space-y-2">
          <label
            htmlFor="email"
            className="block text-sm font-medium text-foreground"
          >
            {pickByLocale(locale, { en: 'Email', sw: 'Barua pepe' })}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-neutral-500 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="password"
            className="block text-sm font-medium text-foreground"
          >
            {pickByLocale(locale, { en: 'Password', sw: 'Nenosiri' })}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-neutral-500 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </div>

        {state.phase === 'error' && state.error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {state.error}
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={state.phase === 'submitting'}
          disabled={state.phase === 'submitting'}
          className="bg-signal-500 py-3.5 text-base font-semibold text-primary-foreground shadow-md hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] focus-visible:ring-signal-500"
        >
          {state.phase === 'submitting'
            ? pickByLocale(locale, { en: 'Signing in…', sw: 'Inaingia…' })
            : pickByLocale(locale, { en: 'Sign in', sw: 'Ingia' })}
        </Button>
      </form>

      <p className="mt-8 text-center font-mono text-caption uppercase tracking-widest text-neutral-500">
        {pickByLocale(locale, {
          en: 'Borjie internal · staff only · encrypted in transit',
          sw: 'Borjie ya ndani · wafanyakazi pekee · imesimbwa wakati wa usafirishaji',
        })}
      </p>
    </div>
  );
}
