'use client';

/**
 * NewTenantForm — the provisioning modal behind the tenant-directory
 * "New tenant" primary action. Posts to the live
 * `POST /api/v1/mining/internal/tenants` route (SUPER_ADMIN / ADMIN gated
 * upstream) via `useProvisionTenant`.
 *
 * Residual-doctrine discipline applied here:
 *   - The write CHECKS its result: the success toast + close fire ONLY in the
 *     mutation's resolved path. A rejected mutation routes to the error Alert —
 *     a failed create can never read as "created".
 *   - Inputs are validated client-side (mirroring the gateway
 *     `ProvisionTenantSchema`) before the request, with field-level error copy.
 *   - SINGLE LANGUAGE PER LOCALE: every string resolves via `pickByLocale`;
 *     EN and SW are at full parity (no mixed-language render).
 */

import { useId, useState } from 'react';
import {
  Modal,
  Button,
  Input,
  Alert,
  FormField,
} from '@borjie/design-system';
import {
  useProvisionTenant,
  type ProvisionTenantInput,
} from '@/lib/internal/queries/tenants';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { Toast } from '../Toast';

const S = {
  title: { en: 'Provision a tenant', sw: 'Sajili mteja' },
  description: {
    en: 'Create a new tenant on the platform. They start in a pending state until activated.',
    sw: 'Unda mteja mpya kwenye jukwaa. Wataanza katika hali inayosubiri hadi watakapowezeshwa.',
  },
  nameLabel: { en: 'Tenant name', sw: 'Jina la mteja' },
  namePlaceholder: { en: 'Acme Mining Ltd', sw: 'Acme Mining Ltd' },
  slugLabel: { en: 'Slug', sw: 'Kitambulisho' },
  slugPlaceholder: { en: 'acme-mining', sw: 'acme-mining' },
  slugHint: {
    en: 'Lowercase letters, numbers and hyphens only.',
    sw: 'Herufi ndogo, namba na vistari pekee.',
  },
  emailLabel: { en: 'Primary email', sw: 'Barua pepe kuu' },
  emailPlaceholder: { en: 'owner@acme.example', sw: 'owner@acme.example' },
  phoneLabel: { en: 'Primary phone (optional)', sw: 'Simu kuu (hiari)' },
  phonePlaceholder: { en: '+255 700 000 000', sw: '+255 700 000 000' },
  countryLabel: { en: 'Country (ISO-2)', sw: 'Nchi (ISO-2)' },
  cancel: { en: 'Cancel', sw: 'Ghairi' },
  submit: { en: 'Create tenant', sw: 'Unda mteja' },
  submitting: { en: 'Creating…', sw: 'Inaunda…' },
  created: { en: 'Tenant provisioned', sw: 'Mteja amesajiliwa' },
  errNameRequired: { en: 'Name is required.', sw: 'Jina linahitajika.' },
  errSlugInvalid: {
    en: 'Slug must be 2–120 lowercase letters, numbers or hyphens.',
    sw: 'Kitambulisho lazima kiwe herufi ndogo 2–120, namba au vistari.',
  },
  errEmailInvalid: {
    en: 'Enter a valid email address.',
    sw: 'Weka anwani halali ya barua pepe.',
  },
  errCountryInvalid: {
    en: 'Country must be a 2-letter ISO code.',
    sw: 'Nchi lazima iwe msimbo wa ISO wa herufi 2.',
  },
} as const;

const SLUG_RE = /^[a-z0-9-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_RE = /^[A-Za-z]{2}$/;

interface FieldErrors {
  readonly name?: string;
  readonly slug?: string;
  readonly primaryEmail?: string;
  readonly country?: string;
}

function validate(
  input: ProvisionTenantInput,
  locale: Locale,
): FieldErrors {
  const errors: Record<string, string> = {};
  if (input.name.trim().length === 0) {
    errors.name = pickByLocale(locale, S.errNameRequired);
  }
  if (input.slug.length < 2 || input.slug.length > 120 || !SLUG_RE.test(input.slug)) {
    errors.slug = pickByLocale(locale, S.errSlugInvalid);
  }
  if (!EMAIL_RE.test(input.primaryEmail)) {
    errors.primaryEmail = pickByLocale(locale, S.errEmailInvalid);
  }
  if (input.country !== undefined && input.country !== '' && !COUNTRY_RE.test(input.country)) {
    errors.country = pickByLocale(locale, S.errCountryInvalid);
  }
  return errors;
}

export function NewTenantForm({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const provision = useProvisionTenant();
  const formId = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setSlug('');
    setEmail('');
    setPhone('');
    setCountry('');
    setFieldErrors({});
    setSubmitError(null);
  };

  const close = () => {
    if (provision.isPending) return;
    setOpen(false);
    reset();
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    const input: ProvisionTenantInput = {
      name: name.trim(),
      slug: slug.trim(),
      primaryEmail: email.trim(),
      ...(phone.trim() ? { primaryPhone: phone.trim() } : {}),
      ...(country.trim() ? { country: country.trim().toUpperCase() } : {}),
    };
    const errors = validate(input, locale);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    try {
      // The write is awaited and its rejection is caught: the success
      // affordance below runs ONLY when the mutation resolves ok.
      await provision.mutateAsync(input);
      setToast(pickByLocale(locale, S.created));
      setOpen(false);
      reset();
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : pickByLocale(locale, {
              en: 'Provisioning failed.',
              sw: 'Usajili umeshindwa.',
            }),
      );
    }
  };

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        {pickByLocale(locale, { en: 'New tenant', sw: 'Mteja mpya' })}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={pickByLocale(locale, S.title)}
        description={pickByLocale(locale, S.description)}
        size="md"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          {submitError && <Alert variant="error">{submitError}</Alert>}

          <FormField
            label={pickByLocale(locale, S.nameLabel)}
            name={`${formId}-name`}
            {...(fieldErrors.name ? { error: fieldErrors.name } : {})}
          >
            <Input
              id={`${formId}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={pickByLocale(locale, S.namePlaceholder)}
              autoComplete="off"
            />
          </FormField>

          <FormField
            label={pickByLocale(locale, S.slugLabel)}
            name={`${formId}-slug`}
            hint={pickByLocale(locale, S.slugHint)}
            {...(fieldErrors.slug ? { error: fieldErrors.slug } : {})}
          >
            <Input
              id={`${formId}-slug`}
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder={pickByLocale(locale, S.slugPlaceholder)}
              autoComplete="off"
            />
          </FormField>

          <FormField
            label={pickByLocale(locale, S.emailLabel)}
            name={`${formId}-email`}
            {...(fieldErrors.primaryEmail
              ? { error: fieldErrors.primaryEmail }
              : {})}
          >
            <Input
              id={`${formId}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={pickByLocale(locale, S.emailPlaceholder)}
              autoComplete="off"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField
              label={pickByLocale(locale, S.phoneLabel)}
              name={`${formId}-phone`}
            >
              <Input
                id={`${formId}-phone`}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={pickByLocale(locale, S.phonePlaceholder)}
                autoComplete="off"
              />
            </FormField>

            <FormField
              label={pickByLocale(locale, S.countryLabel)}
              name={`${formId}-country`}
              {...(fieldErrors.country ? { error: fieldErrors.country } : {})}
            >
              <Input
                id={`${formId}-country`}
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="TZ"
                autoComplete="off"
              />
            </FormField>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={close}
              disabled={provision.isPending}
            >
              {pickByLocale(locale, S.cancel)}
            </Button>
            <Button type="submit" size="sm" disabled={provision.isPending}>
              {provision.isPending
                ? pickByLocale(locale, S.submitting)
                : pickByLocale(locale, S.submit)}
            </Button>
          </div>
        </form>
      </Modal>

      <Toast message={toast} tone="success" onDismiss={() => setToast(null)} />
    </>
  );
}
