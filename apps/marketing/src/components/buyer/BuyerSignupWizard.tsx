'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BuyerKindStep } from './BuyerKindStep';
import { IndividualBuyerStep } from './IndividualBuyerStep';
import { BusinessBuyerStep } from './BusinessBuyerStep';
import { BuyerSignupSchema, compactIndividual } from './schema';
import type {
  BuyerAccountKind,
  BuyerSignupDraft,
  BuyerSignupError,
  BuyerSignupSuccess,
  BusinessBuyerDraft,
  IndividualBuyerDraft,
} from './types';
import { apiBaseUrl } from '@/lib/api';
import { getMessages, type Locale } from '@/lib/i18n';

interface BuyerSignupWizardProps {
  readonly locale: Locale;
}

interface WizardState {
  readonly step: 1 | 2;
  readonly draft: BuyerSignupDraft | null;
  readonly submitting: boolean;
  readonly serverError: string | null;
}

const INITIAL_INDIVIDUAL: IndividualBuyerDraft = {
  kind: 'individual',
  country: 'TZ',
  fullName: '',
  phoneE164: '+255',
  email: '',
  preferredCurrency: 'TZS',
  preferredLanguage: 'sw',
  nationalIdNumber: '',
};

const INITIAL_BUSINESS: BusinessBuyerDraft = {
  kind: 'business',
  country: 'TZ',
  orgName: '',
  businessKind: 'refiner',
  businessRegistrationNumber: '',
  taxId: '',
  contactFullName: '',
  contactPhoneE164: '+255',
  contactEmail: '',
  preferredCurrency: 'TZS',
  preferredLanguage: 'sw',
};

const INITIAL_STATE: WizardState = {
  step: 1,
  draft: null,
  submitting: false,
  serverError: null,
};

/**
 * Root client component for the buyer signup wizard.
 *
 * Two steps:
 *   1. BuyerKindStep         — pick INDIVIDUAL vs BUSINESS
 *   2. IndividualBuyerStep / BusinessBuyerStep — collect details + POST
 *
 * Posts to `${apiBaseUrl()}/api/v1/buyers/signup`. On 201 redirects to
 * `/buyers/sign-in?from=signup` so the buyer immediately authenticates;
 * the api-gateway has already minted the Supabase auth user and
 * triggered OTP, so the sign-in form lets the buyer settle the new
 * password and land on the cockpit.
 *
 * On 4xx we surface the server's `message`/`error` payload inline.
 * On 5xx we surface a generic "try again" error.
 */
export function BuyerSignupWizard({ locale }: BuyerSignupWizardProps) {
  const router = useRouter();
  const t = getMessages(locale).buyerSignupPage;
  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  function onKindChosen(kind: BuyerAccountKind): void {
    setState((prev) => ({
      ...prev,
      step: 2,
      serverError: null,
      draft:
        kind === 'individual'
          ? prev.draft?.kind === 'individual'
            ? prev.draft
            : INITIAL_INDIVIDUAL
          : prev.draft?.kind === 'business'
            ? prev.draft
            : INITIAL_BUSINESS,
    }));
  }

  function onDraftChange(draft: BuyerSignupDraft): void {
    setState((prev) => ({ ...prev, draft, serverError: null }));
  }

  function onBack(): void {
    setState((prev) => ({ ...prev, step: 1, serverError: null }));
  }

  function translateServerError(payload: BuyerSignupError): string {
    const errs = t.errors;
    if (payload.error === 'email_already_registered') {
      return errs.emailAlreadyRegistered;
    }
    if (payload.error === 'phone_already_registered') {
      return errs.phoneAlreadyRegistered;
    }
    if (payload.error === 'auth_provider_unavailable') {
      return errs.providerUnavailable;
    }
    if (payload.error === 'invalid_body' && payload.issues && payload.issues.length > 0) {
      const first = payload.issues[0];
      if (first) return `${first.path}: ${first.message}`;
    }
    if (payload.message) return payload.message;
    return errs.submitFailed;
  }

  async function submitDraft(draft: BuyerSignupDraft): Promise<void> {
    setState((prev) => ({ ...prev, submitting: true, serverError: null }));

    // Client-side zod parse against the same schema the server uses.
    // Strip empty optional nationalIdNumber from individual drafts.
    const payload =
      draft.kind === 'individual' ? compactIndividual(draft) : draft;
    const parsed = BuyerSignupSchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setState((prev) => ({
        ...prev,
        submitting: false,
        serverError:
          first !== undefined
            ? `${first.path.join('.')}: ${first.message}`
            : t.errors.submitFailed,
      }));
      return;
    }

    try {
      const res = await fetch(`${apiBaseUrl()}/api/v1/buyers/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const json = (await res.json()) as
        | BuyerSignupSuccess
        | BuyerSignupError;
      if (!res.ok) {
        setState((prev) => ({
          ...prev,
          submitting: false,
          serverError: translateServerError(json as BuyerSignupError),
        }));
        return;
      }
      if (!('tenantId' in json)) {
        setState((prev) => ({
          ...prev,
          submitting: false,
          serverError: t.errors.submitFailed,
        }));
        return;
      }
      // Success → redirect to sign-in with a flag the form can read to
      // show a "your account is created — sign in to continue" banner.
      router.replace('/buyers/sign-in?from=signup');
    } catch {
      setState((prev) => ({
        ...prev,
        submitting: false,
        serverError: t.errors.submitFailed,
      }));
    }
  }

  return (
    <section
      data-testid="buyer-signup-wizard"
      data-step={state.step}
      className="rounded-2xl border border-border bg-surface p-8 shadow-md sm:p-10"
    >
      <ol
        aria-label={`${t.steps.kind} › ${t.steps.details}`}
        className="mb-8 flex items-center justify-center gap-3 font-mono text-caption uppercase tracking-widest"
      >
        <li className="flex items-center gap-2">
          <span
            className={
              state.step === 1
                ? 'flex h-6 w-6 items-center justify-center rounded-full bg-signal-500 text-primary-foreground'
                : 'flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-raised text-neutral-400'
            }
          >
            1
          </span>
          <span className={state.step === 1 ? 'text-foreground' : 'text-neutral-500'}>
            {t.steps.kind}
          </span>
        </li>
        <li aria-hidden="true" className="h-px w-8 bg-border" />
        <li className="flex items-center gap-2">
          <span
            className={
              state.step === 2
                ? 'flex h-6 w-6 items-center justify-center rounded-full bg-signal-500 text-primary-foreground'
                : 'flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-raised text-neutral-400'
            }
          >
            2
          </span>
          <span className={state.step === 2 ? 'text-foreground' : 'text-neutral-500'}>
            {t.steps.details}
          </span>
        </li>
      </ol>

      {state.step === 1 && (
        <BuyerKindStep locale={locale} onPick={onKindChosen} />
      )}

      {state.step === 2 && state.draft?.kind === 'individual' && (
        <IndividualBuyerStep
          locale={locale}
          draft={state.draft}
          onChange={onDraftChange}
          onBack={onBack}
          onSubmit={submitDraft}
          submitting={state.submitting}
          serverError={state.serverError}
        />
      )}

      {state.step === 2 && state.draft?.kind === 'business' && (
        <BusinessBuyerStep
          locale={locale}
          draft={state.draft}
          onChange={onDraftChange}
          onBack={onBack}
          onSubmit={submitDraft}
          submitting={state.submitting}
          serverError={state.serverError}
        />
      )}
    </section>
  );
}
