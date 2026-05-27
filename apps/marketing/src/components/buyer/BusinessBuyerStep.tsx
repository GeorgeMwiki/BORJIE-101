'use client';

import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  BUYER_BUSINESS_KINDS,
  BUYER_COUNTRY_CODES,
  BUYER_CURRENCY_CODES,
  BUYER_LANGUAGE_CODES,
  type BusinessBuyerDraft,
  type BuyerBusinessKind,
  type BuyerCountryCode,
  type BuyerCurrencyCode,
  type BuyerLanguageCode,
} from './types';
import { Field } from './Field';
import { getMessages, type Locale } from '@/lib/i18n';

interface BusinessBuyerStepProps {
  readonly locale: Locale;
  readonly draft: BusinessBuyerDraft;
  readonly onChange: (draft: BusinessBuyerDraft) => void;
  readonly onBack: () => void;
  readonly onSubmit: (draft: BusinessBuyerDraft) => Promise<void> | void;
  readonly submitting: boolean;
  readonly serverError: string | null;
}

type FieldErrors = Readonly<Partial<Record<keyof BusinessBuyerDraft, string>>>;

/**
 * Step 2b — business-buyer details form.
 *
 * Same pattern as `IndividualBuyerStep` but with the additional
 * BRELA / TIN / contact-person fields the API requires when
 * `kind === 'business'`.
 */
export function BusinessBuyerStep({
  locale,
  draft,
  onChange,
  onBack,
  onSubmit,
  submitting,
  serverError,
}: BusinessBuyerStepProps) {
  const t = getMessages(locale).buyerSignupPage;
  const errs = t.errors;
  const [errors, setErrors] = useState<FieldErrors>({});

  const schema = z.object({
    orgName: z.string().min(2, errs.orgNameRequired),
    businessKind: z.enum(BUYER_BUSINESS_KINDS, {
      errorMap: () => ({ message: errs.businessKindRequired }),
    }),
    businessRegistrationNumber: z.string().min(1, errs.businessRegRequired),
    taxId: z.string().min(1, errs.taxIdRequired),
    contactFullName: z.string().min(2, errs.fullNameRequired),
    contactPhoneE164: z
      .string()
      .regex(/^\+?[1-9][0-9]{6,19}$/u, errs.phoneInvalid),
    contactEmail: z.string().email(errs.emailInvalid),
  });

  function update<K extends keyof BusinessBuyerDraft>(
    key: K,
    value: BusinessBuyerDraft[K],
  ): void {
    onChange({ ...draft, [key]: value });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const parsed = schema.safeParse({
      orgName: draft.orgName,
      businessKind: draft.businessKind,
      businessRegistrationNumber: draft.businessRegistrationNumber,
      taxId: draft.taxId,
      contactFullName: draft.contactFullName,
      contactPhoneE164: draft.contactPhoneE164,
      contactEmail: draft.contactEmail,
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
      data-testid="buyer-business-step"
      onSubmit={handleSubmit}
      noValidate
      className="space-y-5"
    >
      <header>
        <h2 className="font-display text-xl font-semibold text-foreground">
          {t.fields.orgName}
        </h2>
        <p className="text-xs text-foreground/60">{t.fields.orgNameEn}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="orgName"
          label={t.fields.orgName}
          subLabel={t.fields.orgNameEn}
          required
          error={errors.orgName}
        >
          <input
            id="orgName"
            data-testid="buyer-business-orgName"
            autoComplete="organization"
            value={draft.orgName}
            onChange={(e) => update('orgName', e.currentTarget.value)}
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
            data-testid="buyer-business-country"
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
          id="businessKind"
          label={t.fields.businessKind}
          subLabel={t.fields.businessKindEn}
          required
          error={errors.businessKind}
        >
          <select
            id="businessKind"
            data-testid="buyer-business-kind"
            value={draft.businessKind}
            onChange={(e) =>
              update(
                'businessKind',
                e.currentTarget.value as BuyerBusinessKind,
              )
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            {BUYER_BUSINESS_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t.businessKinds[kind]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="businessRegistrationNumber"
          label={t.fields.businessRegistrationNumber}
          subLabel={t.fields.businessRegistrationNumberEn}
          required
          error={errors.businessRegistrationNumber}
        >
          <input
            id="businessRegistrationNumber"
            data-testid="buyer-business-brela"
            value={draft.businessRegistrationNumber}
            onChange={(e) =>
              update('businessRegistrationNumber', e.currentTarget.value)
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="taxId"
          label={t.fields.taxId}
          subLabel={t.fields.taxIdEn}
          required
          error={errors.taxId}
        >
          <input
            id="taxId"
            data-testid="buyer-business-tin"
            value={draft.taxId}
            onChange={(e) => update('taxId', e.currentTarget.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="contactFullName"
          label={t.fields.contactFullName}
          subLabel={t.fields.contactFullNameEn}
          required
          error={errors.contactFullName}
        >
          <input
            id="contactFullName"
            data-testid="buyer-business-contact-name"
            autoComplete="name"
            value={draft.contactFullName}
            onChange={(e) => update('contactFullName', e.currentTarget.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="contactPhoneE164"
          label={t.fields.contactPhone}
          subLabel={t.fields.contactPhoneEn}
          required
          error={errors.contactPhoneE164}
        >
          <input
            id="contactPhoneE164"
            data-testid="buyer-business-contact-phone"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+255712345678"
            value={draft.contactPhoneE164}
            onChange={(e) =>
              update('contactPhoneE164', e.currentTarget.value)
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="contactEmail"
          label={t.fields.contactEmail}
          subLabel={t.fields.contactEmailEn}
          required
          error={errors.contactEmail}
        >
          <input
            id="contactEmail"
            data-testid="buyer-business-contact-email"
            type="email"
            autoComplete="email"
            value={draft.contactEmail}
            onChange={(e) => update('contactEmail', e.currentTarget.value)}
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
            data-testid="buyer-business-language"
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
            data-testid="buyer-business-currency"
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
      </div>

      {serverError ? (
        <div
          role="alert"
          data-testid="buyer-business-server-error"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {serverError}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          data-testid="buyer-business-back"
          className="rounded-md px-3 py-2 text-sm text-foreground/70 transition-colors duration-fast hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        >
          ‹ {t.actions.back}
        </button>
        <button
          type="submit"
          disabled={submitting}
          data-testid="buyer-business-submit"
          className="rounded-md bg-signal-500 px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-fast ease-out hover:bg-signal-400 hover:shadow-md active:scale-[0.98] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        >
          {submitting ? t.actions.submitting : t.actions.submit}
        </button>
      </div>
    </form>
  );
}
