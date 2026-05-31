'use client';

/**
 * BusinessOwnerStep — Step 2b of the owner self-signup wizard.
 *
 * Form for BUSINESS kind. Same pattern as IndividualOwnerStep but
 * with the additional org / BRELA / TIN / owner-contact fields.
 */

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useT } from '@/i18n/t.client';
import type { TFn } from '@/i18n/resolve';
import type {
  BusinessDraft,
  CountryCode,
  CurrencyCode,
  LanguageCode,
} from './SignupWizard';

const COUNTRIES = ['TZ', 'KE', 'UG', 'NG', 'OTHER'] as const satisfies ReadonlyArray<CountryCode>;
const CURRENCIES = ['TZS', 'USD', 'KES', 'UGX', 'NGN'] as const satisfies ReadonlyArray<CurrencyCode>;
const LANGUAGES = ['sw', 'en'] as const satisfies ReadonlyArray<LanguageCode>;

function makeBusinessSchema(t: TFn) {
  return z.object({
    country: z.enum(COUNTRIES),
    orgName: z.string().min(2, t('signup.validation.orgNameRequired')),
    businessRegistrationNumber: z
      .string()
      .min(1, t('signup.validation.brelaRequired')),
    taxId: z.string().min(1, t('signup.validation.tinRequired')),
    ownerEmail: z.string().email(t('signup.validation.emailInvalid')),
    ownerFullName: z.string().min(2, t('signup.validation.ownerNameRequired')),
    ownerPhoneE164: z
      .string()
      .regex(/^\+?[1-9][0-9]{6,19}$/u, t('signup.validation.phoneInvalid')),
    miningLicenceNumber: z.string().optional(),
    vatNumber: z.string().optional(),
    defaultLanguage: z.enum(LANGUAGES),
    primaryCurrency: z.enum(CURRENCIES),
  });
}

type FormValues = z.infer<ReturnType<typeof makeBusinessSchema>>;

interface BusinessOwnerStepProps {
  readonly draft: BusinessDraft;
  readonly onChange: (draft: BusinessDraft) => void;
  readonly onNext: (draft: BusinessDraft) => void;
  readonly onBack: () => void;
}

export function BusinessOwnerStep({
  draft,
  onChange,
  onNext,
  onBack,
}: BusinessOwnerStepProps): JSX.Element {
  const t = useT();
  const schema = useMemo(() => makeBusinessSchema(t), [t]);
  const { register, handleSubmit, formState, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      country: draft.country,
      orgName: draft.orgName,
      businessRegistrationNumber: draft.businessRegistrationNumber,
      taxId: draft.taxId,
      ownerEmail: draft.ownerEmail,
      ownerFullName: draft.ownerFullName,
      ownerPhoneE164: draft.ownerPhoneE164,
      miningLicenceNumber: draft.miningLicenceNumber,
      vatNumber: draft.vatNumber,
      defaultLanguage: draft.defaultLanguage,
      primaryCurrency: draft.primaryCurrency,
    },
    mode: 'onBlur',
  });

  watch((values) => {
    onChange({
      kind: 'business',
      country: (values.country ?? 'TZ') as CountryCode,
      orgName: values.orgName ?? '',
      businessRegistrationNumber: values.businessRegistrationNumber ?? '',
      taxId: values.taxId ?? '',
      ownerEmail: values.ownerEmail ?? '',
      ownerFullName: values.ownerFullName ?? '',
      ownerPhoneE164: values.ownerPhoneE164 ?? '+255',
      miningLicenceNumber: values.miningLicenceNumber ?? '',
      vatNumber: values.vatNumber ?? '',
      defaultLanguage: (values.defaultLanguage ?? 'en') as LanguageCode,
      primaryCurrency: (values.primaryCurrency ?? 'TZS') as CurrencyCode,
    });
  });

  function submit(values: FormValues): void {
    onNext({
      kind: 'business',
      country: values.country,
      orgName: values.orgName,
      businessRegistrationNumber: values.businessRegistrationNumber,
      taxId: values.taxId,
      ownerEmail: values.ownerEmail,
      ownerFullName: values.ownerFullName,
      ownerPhoneE164: values.ownerPhoneE164,
      miningLicenceNumber: values.miningLicenceNumber ?? '',
      vatNumber: values.vatNumber ?? '',
      defaultLanguage: values.defaultLanguage,
      primaryCurrency: values.primaryCurrency,
    });
  }

  return (
    <form
      data-testid="signup-business-step"
      onSubmit={handleSubmit(submit)}
      className="space-y-4"
      noValidate
    >
      <header>
        <h2 className="font-display text-xl font-medium tracking-tight text-foreground">
          {t('signup.business.heading')}
        </h2>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="orgName"
          label={t('signup.field.orgName')}
          required
          {...(formState.errors.orgName?.message !== undefined ? { error: formState.errors.orgName.message } : {})}
        >
          <input
            id="orgName"
            data-testid="signup-business-orgName"
            {...register('orgName')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="country"
          label={t('signup.field.country')}
          required
          {...(formState.errors.country?.message !== undefined ? { error: formState.errors.country.message } : {})}
        >
          <select
            id="country"
            data-testid="signup-business-country"
            {...register('country')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="businessRegistrationNumber"
          label={t('signup.field.businessReg')}
          required
          {...(formState.errors.businessRegistrationNumber?.message !== undefined ? { error: formState.errors.businessRegistrationNumber.message } : {})}
        >
          <input
            id="businessRegistrationNumber"
            data-testid="signup-business-brela"
            {...register('businessRegistrationNumber')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="taxId"
          label={t('signup.field.taxId')}
          required
          {...(formState.errors.taxId?.message !== undefined ? { error: formState.errors.taxId.message } : {})}
        >
          <input
            id="taxId"
            data-testid="signup-business-tin"
            {...register('taxId')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="ownerFullName"
          label={t('signup.field.ownerName')}
          required
          {...(formState.errors.ownerFullName?.message !== undefined ? { error: formState.errors.ownerFullName.message } : {})}
        >
          <input
            id="ownerFullName"
            data-testid="signup-business-ownerFullName"
            autoComplete="name"
            {...register('ownerFullName')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="ownerPhoneE164"
          label={t('signup.field.ownerPhone')}
          required
          {...(formState.errors.ownerPhoneE164?.message !== undefined ? { error: formState.errors.ownerPhoneE164.message } : {})}
        >
          <input
            id="ownerPhoneE164"
            data-testid="signup-business-ownerPhone"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+255712345678"
            {...register('ownerPhoneE164')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="ownerEmail"
          label={t('signup.field.ownerEmail')}
          required
          {...(formState.errors.ownerEmail?.message !== undefined ? { error: formState.errors.ownerEmail.message } : {})}
        >
          <input
            id="ownerEmail"
            data-testid="signup-business-ownerEmail"
            autoComplete="email"
            type="email"
            {...register('ownerEmail')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="defaultLanguage"
          label={t('signup.field.language')}
          required
          {...(formState.errors.defaultLanguage?.message !== undefined ? { error: formState.errors.defaultLanguage.message } : {})}
        >
          <select
            id="defaultLanguage"
            data-testid="signup-business-language"
            {...register('defaultLanguage')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            <option value="sw">Kiswahili</option>
            <option value="en">English</option>
          </select>
        </Field>

        <Field
          id="primaryCurrency"
          label={t('signup.field.currency')}
          required
          {...(formState.errors.primaryCurrency?.message !== undefined ? { error: formState.errors.primaryCurrency.message } : {})}
        >
          <select
            id="primaryCurrency"
            data-testid="signup-business-currency"
            {...register('primaryCurrency')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="miningLicenceNumber"
          label={`${t('signup.field.miningLicenceBusiness')} ${t('signup.field.optional')}`}
          {...(formState.errors.miningLicenceNumber?.message !== undefined ? { error: formState.errors.miningLicenceNumber.message } : {})}
        >
          <input
            id="miningLicenceNumber"
            data-testid="signup-business-pml"
            {...register('miningLicenceNumber')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="vatNumber"
          label={`${t('signup.field.vat')} ${t('signup.field.optional')}`}
          {...(formState.errors.vatNumber?.message !== undefined ? { error: formState.errors.vatNumber.message } : {})}
        >
          <input
            id="vatNumber"
            data-testid="signup-business-vat"
            {...register('vatNumber')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          data-testid="signup-business-back"
          className="font-mono text-caption uppercase tracking-widest text-neutral-500 transition-colors duration-fast hover:text-foreground"
        >
          {t('signup.nav.back')}
        </button>
        <button
          type="submit"
          disabled={formState.isSubmitting}
          data-testid="signup-business-next"
          className="rounded-md bg-signal-500 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-fast ease-out hover:bg-signal-400 hover:shadow-md active:scale-[0.98] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
        >
          {t('signup.nav.next')}
        </button>
      </div>
    </form>
  );
}

function Field(props: {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  readonly error?: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={props.id}
        className="block text-xs font-medium text-foreground"
      >
        {props.label}
        {props.required ? <span className="text-signal-500"> *</span> : null}
      </label>
      {props.children}
      {props.error ? (
        <p role="alert" className="text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
