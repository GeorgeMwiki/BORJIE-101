'use client';

/**
 * BusinessOwnerStep — Step 2b of the owner self-signup wizard.
 *
 * Form for BUSINESS kind. Same pattern as IndividualOwnerStep but
 * with the additional org / BRELA / TIN / owner-contact fields.
 */

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type {
  BusinessDraft,
  CountryCode,
  CurrencyCode,
  LanguageCode,
} from './SignupWizard';

const COUNTRIES = ['TZ', 'KE', 'UG', 'NG', 'OTHER'] as const satisfies ReadonlyArray<CountryCode>;
const CURRENCIES = ['TZS', 'USD', 'KES', 'UGX', 'NGN'] as const satisfies ReadonlyArray<CurrencyCode>;
const LANGUAGES = ['sw', 'en'] as const satisfies ReadonlyArray<LanguageCode>;

const BusinessSchema = z.object({
  country: z.enum(COUNTRIES),
  orgName: z.string().min(2, 'Jina la kampuni linahitajika'),
  businessRegistrationNumber: z.string().min(1, 'Nambari ya BRELA inahitajika'),
  taxId: z.string().min(1, 'Nambari ya TIN inahitajika'),
  ownerEmail: z.string().email('Weka anwani halali ya barua pepe'),
  ownerFullName: z.string().min(2, 'Jina la mmiliki linahitajika'),
  ownerPhoneE164: z
    .string()
    .regex(/^\+?[1-9][0-9]{6,19}$/u, 'Weka simu sahihi (mfano +255712345678)'),
  miningLicenceNumber: z.string().optional(),
  vatNumber: z.string().optional(),
  defaultLanguage: z.enum(LANGUAGES),
  primaryCurrency: z.enum(CURRENCIES),
});

type FormValues = z.infer<typeof BusinessSchema>;

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
  const { register, handleSubmit, formState, watch } = useForm<FormValues>({
    resolver: zodResolver(BusinessSchema),
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
        <h2 className="text-lg font-medium text-foreground">
          Taarifa za kampuni yako
        </h2>
        <p className="text-xs text-neutral-500">Your company details</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="orgName"
          label="Jina la kampuni"
          subLabel="Company name"
          required
          {...(formState.errors.orgName?.message !== undefined ? { error: formState.errors.orgName.message } : {})}
        >
          <input
            id="orgName"
            data-testid="signup-business-orgName"
            {...register('orgName')}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
          />
        </Field>

        <Field
          id="country"
          label="Nchi"
          subLabel="Country"
          required
          {...(formState.errors.country?.message !== undefined ? { error: formState.errors.country.message } : {})}
        >
          <select
            id="country"
            data-testid="signup-business-country"
            {...register('country')}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
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
          label="Nambari ya BRELA"
          subLabel="Business reg #"
          required
          {...(formState.errors.businessRegistrationNumber?.message !== undefined ? { error: formState.errors.businessRegistrationNumber.message } : {})}
        >
          <input
            id="businessRegistrationNumber"
            data-testid="signup-business-brela"
            {...register('businessRegistrationNumber')}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
          />
        </Field>

        <Field
          id="taxId"
          label="Nambari ya TIN"
          subLabel="Tax ID"
          required
          {...(formState.errors.taxId?.message !== undefined ? { error: formState.errors.taxId.message } : {})}
        >
          <input
            id="taxId"
            data-testid="signup-business-tin"
            {...register('taxId')}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
          />
        </Field>

        <Field
          id="ownerFullName"
          label="Jina la mmiliki"
          subLabel="Owner full name"
          required
          {...(formState.errors.ownerFullName?.message !== undefined ? { error: formState.errors.ownerFullName.message } : {})}
        >
          <input
            id="ownerFullName"
            data-testid="signup-business-ownerFullName"
            autoComplete="name"
            {...register('ownerFullName')}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
          />
        </Field>

        <Field
          id="ownerPhoneE164"
          label="Simu ya mmiliki"
          subLabel="Owner phone (E.164)"
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
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
          />
        </Field>

        <Field
          id="ownerEmail"
          label="Barua pepe ya mmiliki"
          subLabel="Owner email"
          required
          {...(formState.errors.ownerEmail?.message !== undefined ? { error: formState.errors.ownerEmail.message } : {})}
        >
          <input
            id="ownerEmail"
            data-testid="signup-business-ownerEmail"
            autoComplete="email"
            type="email"
            {...register('ownerEmail')}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
          />
        </Field>

        <Field
          id="defaultLanguage"
          label="Lugha"
          subLabel="Language"
          required
          {...(formState.errors.defaultLanguage?.message !== undefined ? { error: formState.errors.defaultLanguage.message } : {})}
        >
          <select
            id="defaultLanguage"
            data-testid="signup-business-language"
            {...register('defaultLanguage')}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
          >
            <option value="sw">Kiswahili</option>
            <option value="en">English</option>
          </select>
        </Field>

        <Field
          id="primaryCurrency"
          label="Sarafu"
          subLabel="Currency"
          required
          {...(formState.errors.primaryCurrency?.message !== undefined ? { error: formState.errors.primaryCurrency.message } : {})}
        >
          <select
            id="primaryCurrency"
            data-testid="signup-business-currency"
            {...register('primaryCurrency')}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
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
          label="Leseni ya uchimbaji (PML/PL/ML)"
          subLabel="Mining licence (optional)"
          {...(formState.errors.miningLicenceNumber?.message !== undefined ? { error: formState.errors.miningLicenceNumber.message } : {})}
        >
          <input
            id="miningLicenceNumber"
            data-testid="signup-business-pml"
            {...register('miningLicenceNumber')}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
          />
        </Field>

        <Field
          id="vatNumber"
          label="Nambari ya VAT"
          subLabel="VAT (optional)"
          {...(formState.errors.vatNumber?.message !== undefined ? { error: formState.errors.vatNumber.message } : {})}
        >
          <input
            id="vatNumber"
            data-testid="signup-business-vat"
            {...register('vatNumber')}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-foreground"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          data-testid="signup-business-back"
          className="text-sm text-neutral-400 hover:text-foreground"
        >
          ‹ Rudi
        </button>
        <button
          type="submit"
          disabled={formState.isSubmitting}
          data-testid="signup-business-next"
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-60"
        >
          Endelea ›
        </button>
      </div>
    </form>
  );
}

function Field(props: {
  readonly id: string;
  readonly label: string;
  readonly subLabel: string;
  readonly required?: boolean;
  readonly error?: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label
        htmlFor={props.id}
        className="block text-xs font-medium text-neutral-300"
      >
        {props.label}
        {props.required ? <span className="text-amber-500"> *</span> : null}
        <span className="ml-2 text-[10px] uppercase tracking-wider text-neutral-500">
          {props.subLabel}
        </span>
      </label>
      {props.children}
      {props.error ? (
        <p role="alert" className="text-xs text-rose-400">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
