'use client';

/**
 * SignupWizard — root client component for the owner self-signup flow.
 *
 * Three steps:
 *   1. SignupKindStep   — pick INDIVIDUAL vs BUSINESS
 *   2a. IndividualOwnerStep  — fullName, phone, email, optional PML / NIDA
 *   2b. BusinessOwnerStep    — orgName, BRELA, TIN, owner contact, optional PML / VAT
 *   3. OwnerContactStep — review + send + verify OTP, then redirect to /
 *
 * State is held in this component and persisted to `localStorage` so a
 * refresh during signup does not lose the form. The wizard never
 * touches the Supabase service-role key — only the public anon key
 * for OTP entry. The tenants/users rows are minted server-side by
 * `POST /api/v1/orgs/signup`.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { SignupKindStep } from './SignupKindStep';
import { IndividualOwnerStep } from './IndividualOwnerStep';
import { BusinessOwnerStep } from './BusinessOwnerStep';
import { OwnerContactStep } from './OwnerContactStep';

export type AccountKind = 'individual' | 'business';

export type CountryCode = 'TZ' | 'KE' | 'UG' | 'NG' | 'OTHER';
export type CurrencyCode = 'TZS' | 'USD' | 'KES' | 'UGX' | 'NGN';
export type LanguageCode = 'sw' | 'en';

export interface IndividualDraft {
  readonly kind: 'individual';
  readonly country: CountryCode;
  readonly fullName: string;
  readonly phoneE164: string;
  readonly email: string;
  readonly miningLicenceNumber: string;
  readonly nationalIdNumber: string;
  readonly defaultLanguage: LanguageCode;
  readonly primaryCurrency: CurrencyCode;
}

export interface BusinessDraft {
  readonly kind: 'business';
  readonly country: CountryCode;
  readonly orgName: string;
  readonly businessRegistrationNumber: string;
  readonly taxId: string;
  readonly ownerEmail: string;
  readonly ownerFullName: string;
  readonly ownerPhoneE164: string;
  readonly miningLicenceNumber: string;
  readonly vatNumber: string;
  readonly defaultLanguage: LanguageCode;
  readonly primaryCurrency: CurrencyCode;
}

export type SignupDraft = IndividualDraft | BusinessDraft;

interface WizardState {
  readonly step: 1 | 2 | 3;
  readonly draft: SignupDraft | null;
  readonly tenantId: string | null;
  readonly ownerUserId: string | null;
}

const STORAGE_KEY = 'borjie.signup.draft.v1';

const INITIAL_STATE: WizardState = {
  step: 1,
  draft: null,
  tenantId: null,
  ownerUserId: null,
};

function loadPersistedState(): WizardState {
  if (typeof window === 'undefined') return INITIAL_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_STATE;
    const parsed = JSON.parse(raw) as Partial<WizardState>;
    if (
      parsed &&
      (parsed.step === 1 || parsed.step === 2 || parsed.step === 3)
    ) {
      return {
        step: parsed.step,
        draft: parsed.draft ?? null,
        tenantId: parsed.tenantId ?? null,
        ownerUserId: parsed.ownerUserId ?? null,
      };
    }
  } catch {
    // localStorage may be unavailable; fall through to initial state.
  }
  return INITIAL_STATE;
}

function persistState(state: WizardState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage quota or private mode — ignore.
  }
}

function clearPersistedState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function SignupWizard(): JSX.Element {
  const router = useRouter();
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadPersistedState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    persistState(state);
  }, [state, hydrated]);

  function onKindChosen(kind: AccountKind): void {
    setState((prev) => ({
      ...prev,
      step: 2,
      draft:
        kind === 'individual'
          ? {
              kind: 'individual',
              country: 'TZ',
              fullName: prev.draft?.kind === 'individual' ? prev.draft.fullName : '',
              phoneE164: prev.draft?.kind === 'individual' ? prev.draft.phoneE164 : '+255',
              email: prev.draft?.kind === 'individual' ? prev.draft.email : '',
              miningLicenceNumber:
                prev.draft?.kind === 'individual' ? prev.draft.miningLicenceNumber : '',
              nationalIdNumber:
                prev.draft?.kind === 'individual' ? prev.draft.nationalIdNumber : '',
              defaultLanguage: 'en',
              primaryCurrency: 'TZS',
            }
          : {
              kind: 'business',
              country: 'TZ',
              orgName: prev.draft?.kind === 'business' ? prev.draft.orgName : '',
              businessRegistrationNumber:
                prev.draft?.kind === 'business' ? prev.draft.businessRegistrationNumber : '',
              taxId: prev.draft?.kind === 'business' ? prev.draft.taxId : '',
              ownerEmail: prev.draft?.kind === 'business' ? prev.draft.ownerEmail : '',
              ownerFullName:
                prev.draft?.kind === 'business' ? prev.draft.ownerFullName : '',
              ownerPhoneE164:
                prev.draft?.kind === 'business' ? prev.draft.ownerPhoneE164 : '+255',
              miningLicenceNumber:
                prev.draft?.kind === 'business' ? prev.draft.miningLicenceNumber : '',
              vatNumber: prev.draft?.kind === 'business' ? prev.draft.vatNumber : '',
              defaultLanguage: 'en',
              primaryCurrency: 'TZS',
            },
    }));
  }

  function onDraftComplete(draft: SignupDraft): void {
    setState((prev) => ({ ...prev, step: 3, draft }));
  }

  function onSignupAccepted(input: {
    readonly tenantId: string;
    readonly ownerUserId: string;
  }): void {
    setState((prev) => ({
      ...prev,
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
    }));
  }

  async function onVerified(): Promise<void> {
    clearPersistedState();
    const supabase = createSupabaseBrowserClient();
    // Refresh session cookies on the way out so the home page server
    // component picks up the freshly-minted auth state.
    await supabase.auth.getSession();
    router.replace('/');
    router.refresh();
  }

  function onBack(): void {
    setState((prev) => ({
      ...prev,
      step: prev.step === 3 ? 2 : 1,
    }));
  }

  if (!hydrated) {
    return (
      <div
        data-testid="signup-wizard-loading"
        className="rounded-2xl border border-border bg-surface p-8"
      >
        <p className="text-sm text-neutral-400">Inapakia…</p>
      </div>
    );
  }

  return (
    <section
      data-testid="signup-wizard"
      data-step={state.step}
      className="rounded-2xl border border-border bg-surface p-8 shadow-md sm:p-10"
    >
      <ol
        aria-label="Hatua za kujisajili"
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
          <span
            className={state.step === 1 ? 'text-foreground' : 'text-neutral-500'}
          >
            Aina
          </span>
        </li>
        <li aria-hidden="true" className="h-px w-6 bg-border" />
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
          <span
            className={state.step === 2 ? 'text-foreground' : 'text-neutral-500'}
          >
            Taarifa
          </span>
        </li>
        <li aria-hidden="true" className="h-px w-6 bg-border" />
        <li className="flex items-center gap-2">
          <span
            className={
              state.step === 3
                ? 'flex h-6 w-6 items-center justify-center rounded-full bg-signal-500 text-primary-foreground'
                : 'flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-raised text-neutral-400'
            }
          >
            3
          </span>
          <span
            className={state.step === 3 ? 'text-foreground' : 'text-neutral-500'}
          >
            Thibitisha
          </span>
        </li>
      </ol>

      {state.step === 1 && <SignupKindStep onPick={onKindChosen} />}
      {state.step === 2 && state.draft?.kind === 'individual' && (
        <IndividualOwnerStep
          draft={state.draft}
          onChange={(draft) => setState((prev) => ({ ...prev, draft }))}
          onNext={onDraftComplete}
          onBack={onBack}
        />
      )}
      {state.step === 2 && state.draft?.kind === 'business' && (
        <BusinessOwnerStep
          draft={state.draft}
          onChange={(draft) => setState((prev) => ({ ...prev, draft }))}
          onNext={onDraftComplete}
          onBack={onBack}
        />
      )}
      {state.step === 3 && state.draft !== null && (
        <OwnerContactStep
          draft={state.draft}
          tenantId={state.tenantId}
          onSignupAccepted={onSignupAccepted}
          onVerified={onVerified}
          onBack={onBack}
        />
      )}
    </section>
  );
}
