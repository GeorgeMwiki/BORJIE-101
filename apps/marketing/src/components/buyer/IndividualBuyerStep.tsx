'use client';

import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  BUYER_COUNTRY_CODES,
  BUYER_CURRENCY_CODES,
  BUYER_LANGUAGE_CODES,
  type BuyerCountryCode,
  type BuyerCurrencyCode,
  type BuyerLanguageCode,
  type IndividualBuyerDraft,
} from './types';
import { Field } from './Field';
import { getMessages, type Locale } from '@/lib/i18n';

interface IndividualBuyerStepProps {
  readonly locale: Locale;
  readonly draft: IndividualBuyerDraft;
  readonly onChange: (draft: IndividualBuyerDraft) => void;
  readonly onBack: () => void;
  readonly onSubmit: (draft: IndividualBuyerDraft) => Promise<void> | void;
  readonly submitting: boolean;
  readonly serverError: string | null;
}

type FieldErrors = Readonly<Partial<Record<keyof IndividualBuyerDraft, string>>>;

/**
 * Step 2a — individual-buyer details form.
 *
 * Pure React state (no react-hook-form to keep the marketing bundle
 * slim). On submit we Zod-parse the draft client-side and surface any
 * field-level errors inline; on success we hand the draft to the
 * parent which POSTs to `/api/v1/buyers/signup`.
 */
export function IndividualBuyerStep({
  locale,
  draft,
  onChange,
  onBack,
  onSubmit,
  submitting,
  serverError,
}: IndividualBuyerStepProps) {
  const t = getMessages(locale).buyerSignupPage;
  const errs = t.errors;
  const [errors, setErrors] = useState<FieldErrors>({});

  const schema = z.object({
    fullName: z.string().min(2, errs.fullNameRequired),
    phoneE164: z
      .string()
      .regex(/^\+?[1-9][0-9]{6,19}$/u, errs.phoneInvalid),
    email: z.string().email(errs.emailInvalid),
  });

  function update<K extends keyof IndividualBuyerDraft>(
    key: K,
    value: IndividualBuyerDraft[K],
  ): void {
    onChange({ ...draft, [key]: value });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const parsed = schema.safeParse({
      fullName: draft.fullName,
      phoneE164: draft.phoneE164,
      email: draft.email,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (typeof path === 'string' && !(path in next)) {
          next[path] = issue.message;
        }
      }
      setErrors(next as FieldErrors);
      return;
    }
    setErrors({});
    await onSubmit(draft);
  }

  return (
    <form
      data-testid="buyer-individual-step"
      onSubmit={handleSubmit}
      noValidate
      className="space-y-5"
    >
      <header>
        <h2 className="font-display text-xl font-semibold text-foreground">
          {t.fields.fullName}
        </h2>
        <p className="text-xs text-foreground/60">{t.fields.fullNameEn}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="fullName"
          label={t.fields.fullName}
          subLabel={t.fields.fullNameEn}
          required
          error={errors.fullName}
        >
          <input
            id="fullName"
            data-testid="buyer-individual-fullName"
            autoComplete="name"
            value={draft.fullName}
            onChange={(e) => update('fullName', e.currentTarget.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="country"
          label={t.fields.country}
          subLabel={t.fields.countryEn}
          required
        >
          <select
            id="country"
            data-testid="buyer-individual-country"
            value={draft.country}
            onChange={(e) =>
              update('country', e.currentTarget.value as BuyerCountryCode)
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            {BUYER_COUNTRY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="phoneE164"
          label={t.fields.phone}
          subLabel={t.fields.phoneEn}
          required
          error={errors.phoneE164}
        >
          <input
            id="phoneE164"
            data-testid="buyer-individual-phone"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+255712345678"
            value={draft.phoneE164}
            onChange={(e) => update('phoneE164', e.currentTarget.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="email"
          label={t.fields.email}
          subLabel={t.fields.emailEn}
          required
          error={errors.email}
        >
          <input
            id="email"
            data-testid="buyer-individual-email"
            type="email"
            autoComplete="email"
            value={draft.email}
            onChange={(e) => update('email', e.currentTarget.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="preferredLanguage"
          label={t.fields.preferredLanguage}
          subLabel={t.fields.preferredLanguageEn}
          required
        >
          <select
            id="preferredLanguage"
            data-testid="buyer-individual-language"
            value={draft.preferredLanguage}
            onChange={(e) =>
              update(
                'preferredLanguage',
                e.currentTarget.value as BuyerLanguageCode,
              )
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            {BUYER_LANGUAGE_CODES.map((code) => (
              <option key={code} value={code}>
                {code === 'sw' ? 'Kiswahili' : 'English'}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="preferredCurrency"
          label={t.fields.preferredCurrency}
          subLabel={t.fields.preferredCurrencyEn}
          required
        >
          <select
            id="preferredCurrency"
            data-testid="buyer-individual-currency"
            value={draft.preferredCurrency}
            onChange={(e) =>
              update(
                'preferredCurrency',
                e.currentTarget.value as BuyerCurrencyCode,
              )
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            {BUYER_CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="nationalIdNumber"
          label={t.fields.nationalId}
          subLabel={t.fields.nationalIdEn}
        >
          <input
            id="nationalIdNumber"
            data-testid="buyer-individual-nationalId"
            value={draft.nationalIdNumber}
            onChange={(e) => update('nationalIdNumber', e.currentTarget.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>
      </div>

      {serverError ? (
        <div
          role="alert"
          data-testid="buyer-individual-server-error"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {serverError}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          data-testid="buyer-individual-back"
          className="rounded-md px-3 py-2 text-sm text-foreground/70 transition-colors duration-fast hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        >
          ‹ {t.actions.back}
        </button>
        <button
          type="submit"
          disabled={submitting}
          data-testid="buyer-individual-submit"
          className="rounded-md bg-signal-500 px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-fast ease-out hover:bg-signal-400 hover:shadow-md active:scale-[0.98] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        >
          {submitting ? t.actions.submitting : t.actions.submit}
        </button>
      </div>
    </form>
  );
}
