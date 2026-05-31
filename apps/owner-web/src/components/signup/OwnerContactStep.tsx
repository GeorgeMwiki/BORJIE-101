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
import { getCsrfHeaders } from '@/lib/csrf';
import { useT } from '@/i18n/t.client';
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
  const t = useT();
  const [phase, setPhase] = useState<Phase>(
    tenantId !== null ? { kind: 'awaiting_otp' } : { kind: 'review' },
  );
  const [otp, setOtp] = useState('');

  async function submitSignup(): Promise<void> {
    setPhase({ kind: 'submitting' });
    try {
      const res = await fetch(`${apiBaseUrl()}/api/v1/orgs/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getCsrfHeaders() },
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
            : t('signup.contact.errorSignupFailed');
        setPhase({ kind: 'error', message });
        return;
      }
      if (!('tenantId' in json)) {
        setPhase({ kind: 'error', message: t('signup.contact.errorBadResponse') });
        return;
      }
      onSignupAccepted({ tenantId: json.tenantId, ownerUserId: json.ownerUserId });
      setPhase({ kind: 'awaiting_otp' });
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : t('signup.contact.errorNetwork'),
      });
    }
  }

  async function verifyOtp(): Promise<void> {
    const code = otp.trim();
    if (code.length < 4) {
      setPhase({ kind: 'error', message: t('signup.contact.errorOtpInvalid') });
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
        message: err instanceof Error ? err.message : t('signup.contact.errorOtpVerify'),
      });
    }
  }

  return (
    <div data-testid="signup-contact-step" className="space-y-6">
      <header>
        <h2 className="font-display text-xl font-medium tracking-tight text-foreground">
          {t('signup.wizard.stepConfirm')}
        </h2>
        <p className="mt-1 font-mono text-caption uppercase tracking-widest text-neutral-500">
          {t('signup.contact.heading')}
        </p>
      </header>

      <dl className="space-y-2 rounded-xl border border-border bg-surface-raised p-4 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="font-mono text-caption uppercase tracking-widest text-neutral-500">
            {t('signup.contact.labelType')}
          </dt>
          <dd className="text-foreground">{draft.kind}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="font-mono text-caption uppercase tracking-widest text-neutral-500">
            {t('signup.contact.labelSummary')}
          </dt>
          <dd className="text-foreground text-right">{summaryLine(draft)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="font-mono text-caption uppercase tracking-widest text-neutral-500">
            {t('signup.contact.labelOwner')}
          </dt>
          <dd className="text-foreground text-right">{ownerNameFor(draft)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="font-mono text-caption uppercase tracking-widest text-neutral-500">
            {t('signup.contact.labelPhone')}
          </dt>
          <dd className="text-foreground">{phoneFor(draft)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="font-mono text-caption uppercase tracking-widest text-neutral-500">
            {t('signup.contact.labelEmail')}
          </dt>
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
          className="w-full rounded-md bg-signal-500 px-4 py-3 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-fast ease-out hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        >
          {t('signup.contact.sendOtp')}
        </button>
      )}

      {phase.kind === 'submitting' && (
        <p
          className="text-sm text-neutral-400"
          data-testid="signup-contact-submitting"
        >
          {t('signup.contact.submitting')}
        </p>
      )}

      {(phase.kind === 'awaiting_otp' || phase.kind === 'verifying') && (
        <div className="space-y-3">
          <label
            htmlFor="otp"
            className="block text-xs font-medium text-foreground"
          >
            {t('signup.contact.otpLabel', { phone: phoneFor(draft) })}
          </label>
          <input
            id="otp"
            data-testid="signup-contact-otp"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full rounded-md border border-border bg-background px-3 py-3 text-base text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
          <button
            type="button"
            data-testid="signup-contact-verify"
            onClick={() => {
              void verifyOtp();
            }}
            disabled={phase.kind === 'verifying'}
            className="w-full rounded-md bg-signal-500 px-4 py-3 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-fast ease-out hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            {phase.kind === 'verifying'
              ? t('signup.contact.verifying')
              : t('signup.contact.verify')}
          </button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="space-y-2">
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="signup-contact-error"
          >
            {phase.message}
          </p>
          <button
            type="button"
            onClick={() => setPhase({ kind: 'review' })}
            className="text-xs text-neutral-400 underline-offset-2 hover:text-foreground hover:underline"
          >
            {t('signup.contact.tryAgain')}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        data-testid="signup-contact-back"
        className="font-mono text-caption uppercase tracking-widest text-neutral-500 transition-colors duration-fast hover:text-foreground"
      >
        {t('signup.nav.back')}
      </button>
    </div>
  );
}
