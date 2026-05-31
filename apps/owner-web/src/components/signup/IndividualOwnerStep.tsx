'use client';

/**
 * IndividualOwnerStep — Step 2a of the owner self-signup wizard.
 *
 * Form for INDIVIDUAL kind. react-hook-form + zod-resolver. Persists
 * to parent state on every keystroke (via `onChange`) so the parent
 * can write to localStorage and the user can refresh without loss.
 */

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useT } from '@/i18n/t.client';
import type { TFn } from '@/i18n/resolve';
import type {
  CountryCode,
  CurrencyCode,
  IndividualDraft,
  LanguageCode,
} from './SignupWizard';

const COUNTRIES = ['TZ', 'KE', 'UG', 'NG', 'OTHER'] as const satisfies ReadonlyArray<CountryCode>;
const CURRENCIES = ['TZS', 'USD', 'KES', 'UGX', 'NGN'] as const satisfies ReadonlyArray<CurrencyCode>;
const LANGUAGES = ['sw', 'en'] as const satisfies ReadonlyArray<LanguageCode>;

function makeIndividualSchema(t: TFn) {
  return z.object({
    country: z.enum(COUNTRIES),
    fullName: z.string().min(2, t('signup.validation.fullNameRequired')),
    phoneE164: z
      .string()
      .regex(/^\+?[1-9][0-9]{6,19}$/u, t('signup.validation.phoneInvalid')),
    email: z.string().email(t('signup.validation.emailInvalid')),
    miningLicenceNumber: z.string().optional(),
    nationalIdNumber: z.string().optional(),
    defaultLanguage: z.enum(LANGUAGES),
    primaryCurrency: z.enum(CURRENCIES),
  });
}

type FormValues = z.infer<ReturnType<typeof makeIndividualSchema>>;

interface IndividualOwnerStepProps {
  readonly draft: IndividualDraft;
  readonly onChange: (draft: IndividualDraft) => void;
  readonly onNext: (draft: IndividualDraft) => void;
  readonly onBack: () => void;
}

export function IndividualOwnerStep({
  draft,
  onChange,
  onNext,
  onBack,
}: IndividualOwnerStepProps): JSX.Element {
  const t = useT();
  const schema = useMemo(() => makeIndividualSchema(t), [t]);
  const { register, handleSubmit, formState, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      country: draft.country,
      fullName: draft.fullName,
      phoneE164: draft.phoneE164,
      email: draft.email,
      miningLicenceNumber: draft.miningLicenceNumber,
      nationalIdNumber: draft.nationalIdNumber,
      defaultLanguage: draft.defaultLanguage,
      primaryCurrency: draft.primaryCurrency,
    },
    mode: 'onBlur',
  });

  watch((values) => {
    const next: IndividualDraft = {
      kind: 'individual',
      country: (values.country ?? 'TZ') as CountryCode,
      fullName: values.fullName ?? '',
      phoneE164: values.phoneE164 ?? '+255',
      email: values.email ?? '',
      miningLicenceNumber: values.miningLicenceNumber ?? '',
      nationalIdNumber: values.nationalIdNumber ?? '',
      defaultLanguage: (values.defaultLanguage ?? 'en') as LanguageCode,
      primaryCurrency: (values.primaryCurrency ?? 'TZS') as CurrencyCode,
    };
    onChange(next);
  });

  function submit(values: FormValues): void {
    onNext({
      kind: 'individual',
      country: values.country,
      fullName: values.fullName,
      phoneE164: values.phoneE164,
      email: values.email,
      miningLicenceNumber: values.miningLicenceNumber ?? '',
      nationalIdNumber: values.nationalIdNumber ?? '',
      defaultLanguage: values.defaultLanguage,
      primaryCurrency: values.primaryCurrency,
    });
  }

  return (
    <form
      data-testid="signup-individual-step"
      onSubmit={handleSubmit(submit)}
      className="space-y-4"
      noValidate
    >
      <header>
        <h2 className="font-display text-xl font-medium tracking-tight text-foreground">
          {t('signup.individual.heading')}
        </h2>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="fullName"
          label={t('signup.field.fullName')}
          required
          {...(formState.errors.fullName?.message !== undefined ? { error: formState.errors.fullName.message } : {})}
        >
          <input
            id="fullName"
            data-testid="signup-individual-fullName"
            autoComplete="name"
            {...register('fullName')}
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
            data-testid="signup-individual-country"
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
          id="phoneE164"
          label={t('signup.field.phone')}
          required
          {...(formState.errors.phoneE164?.message !== undefined ? { error: formState.errors.phoneE164.message } : {})}
        >
          <input
            id="phoneE164"
            data-testid="signup-individual-phone"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+255712345678"
            {...register('phoneE164')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="email"
          label={t('signup.field.email')}
          required
          {...(formState.errors.email?.message !== undefined ? { error: formState.errors.email.message } : {})}
        >
          <input
            id="email"
            data-testid="signup-individual-email"
            autoComplete="email"
            type="email"
            {...register('email')}
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
            data-testid="signup-individual-language"
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
            data-testid="signup-individual-currency"
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
          label={`${t('signup.field.miningLicence')} ${t('signup.field.optional')}`}
          {...(formState.errors.miningLicenceNumber?.message !== undefined ? { error: formState.errors.miningLicenceNumber.message } : {})}
        >
          <input
            id="miningLicenceNumber"
            data-testid="signup-individual-pml"
            {...register('miningLicenceNumber')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>

        <Field
          id="nationalIdNumber"
          label={`${t('signup.field.nationalId')} ${t('signup.field.optional')}`}
          {...(formState.errors.nationalIdNumber?.message !== undefined ? { error: formState.errors.nationalIdNumber.message } : {})}
        >
          <input
            id="nationalIdNumber"
            data-testid="signup-individual-nida"
            {...register('nationalIdNumber')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-caption uppercase tracking-widest text-neutral-500 transition-colors duration-fast hover:text-foreground"
          data-testid="signup-individual-back"
        >
          {t('signup.nav.back')}
        </button>
        <button
          type="submit"
          disabled={formState.isSubmitting}
          data-testid="signup-individual-next"
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
