'use client';

/**
 * OwnerContactStep — Step 3 of the owner self-signup wizard.
 *
 * Reviews the draft, calls `POST /api/v1/orgs/signup` (server mints
 * the tenant + owner user + Supabase auth user + persona binding),
 * then prompts the user for the phone OTP. On OTP verify success
 * the wizard root redirects to `/`.
 */

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { SignupDraft } from './SignupWizard';

interface OwnerContactStepProps {
  readonly draft: SignupDraft;
  readonly tenantId: string | null;
  readonly onSignupAccepted: (input: {
    readonly tenantId: string;
    readonly ownerUserId: string;
  }) => void;
  readonly onVerified: () => Promise<void>;
  readonly onBack: () => void;
}

type Phase =
  | { readonly kind: 'review' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'awaiting_otp' }
  | { readonly kind: 'verifying' }
  | { readonly kind: 'error'; readonly message: string };

function phoneFor(draft: SignupDraft): string {
  return draft.kind === 'individual' ? draft.phoneE164 : draft.ownerPhoneE164;
}

function emailFor(draft: SignupDraft): string {
  return draft.kind === 'individual' ? draft.email : draft.ownerEmail;
}

function ownerNameFor(draft: SignupDraft): string {
  return draft.kind === 'individual' ? draft.fullName : draft.ownerFullName;
}

function summaryLine(draft: SignupDraft): string {
  if (draft.kind === 'individual') {
    return `${draft.fullName} · ${draft.country} · ${draft.primaryCurrency}`;
  }
  return `${draft.orgName} · ${draft.country} · ${draft.primaryCurrency} · ${draft.ownerFullName}`;
}

function apiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const fromEnv = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, '');
  }
  return '';
}

export function OwnerContactStep({
  draft,
  tenantId,
  onSignupAccepted,
  onVerified,
  onBack,
}: OwnerContactStepProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>(
    tenantId !== null ? { kind: 'awaiting_otp' } : { kind: 'review' },
  );
  const [otp, setOtp] = useState('');

  async function submitSignup(): Promise<void> {
    setPhase({ kind: 'submitting' });
    try {
      const res = await fetch(`${apiBaseUrl()}/api/v1/orgs/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = (await res.json()) as
        | {
            readonly tenantId: string;
            readonly ownerUserId: string;
            readonly kind: string;
            readonly signupStatus: string;
            readonly otpRequired: boolean;
          }
        | { readonly error: string; readonly message?: string };
      if (!res.ok) {
        const message =
          'error' in json
            ? `${json.error}${json.message ? ': ' + json.message : ''}`
            : 'Imeshindwa kujisajili';
        setPhase({ kind: 'error', message });
        return;
      }
      if (!('tenantId' in json)) {
        setPhase({ kind: 'error', message: 'Jibu lisilo sahihi kutoka kwa seva' });
        return;
      }
      onSignupAccepted({ tenantId: json.tenantId, ownerUserId: json.ownerUserId });
      setPhase({ kind: 'awaiting_otp' });
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Imeshindwa kuwasiliana na seva',
      });
    }
  }

  async function verifyOtp(): Promise<void> {
    const code = otp.trim();
    if (code.length < 4) {
      setPhase({ kind: 'error', message: 'Weka nambari halali ya OTP' });
      return;
    }
    setPhase({ kind: 'verifying' });
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.verifyOtp({
        phone: phoneFor(draft),
        token: code,
        type: 'sms',
      });
      if (error) {
        setPhase({ kind: 'error', message: error.message });
        return;
      }
      await onVerified();
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Imeshindwa kuthibitisha OTP',
      });
    }
  }

  return (
    <div data-testid="signup-contact-step" className="space-y-5">
      <header>
        <h2 className="text-lg font-medium text-foreground">Thibitisha</h2>
        <p className="text-xs text-neutral-500">Confirm and verify</p>
      </header>

      <dl className="space-y-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-3 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-400">Aina</dt>
          <dd className="text-foreground">{draft.kind}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-400">Muhtasari</dt>
          <dd className="text-foreground text-right">{summaryLine(draft)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-400">Mmiliki</dt>
          <dd className="text-foreground text-right">{ownerNameFor(draft)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-400">Simu</dt>
          <dd className="text-foreground">{phoneFor(draft)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-400">Barua pepe</dt>
          <dd className="text-foreground">{emailFor(draft)}</dd>
        </div>
      </dl>

      {phase.kind === 'review' && (
        <button
          type="button"
          data-testid="signup-contact-submit"
          onClick={() => {
            void submitSignup();
          }}
          className="w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400"
        >
          Tuma OTP kwa simu yangu · Send OTP to my phone
        </button>
      )}

      {phase.kind === 'submitting' && (
        <p className="text-sm text-neutral-400" data-testid="signup-contact-submitting">
          Inatuma…
        </p>
      )}

      {(phase.kind === 'awaiting_otp' || phase.kind === 'verifying') && (
        <div className="space-y-3">
          <label
            htmlFor="otp"
            className="block text-xs font-medium text-neutral-300"
          >
            OTP iliyotumwa kwa {phoneFor(draft)}
            <span className="ml-2 text-[10px] uppercase tracking-wider text-neutral-500">
              OTP code
            </span>
          </label>
          <input
            id="otp"
            data-testid="signup-contact-otp"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
          />
          <button
            type="button"
            data-testid="signup-contact-verify"
            onClick={() => {
              void verifyOtp();
            }}
            disabled={phase.kind === 'verifying'}
            className="w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-60"
          >
            {phase.kind === 'verifying' ? 'Inathibitisha…' : 'Thibitisha · Verify'}
          </button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-rose-400" data-testid="signup-contact-error">
            {phase.message}
          </p>
          <button
            type="button"
            onClick={() => setPhase({ kind: 'review' })}
            className="text-xs text-neutral-400 underline"
          >
            Jaribu tena · Try again
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        data-testid="signup-contact-back"
        className="text-xs text-neutral-400 hover:text-foreground"
      >
        ‹ Rudi
      </button>
    </div>
  );
}
