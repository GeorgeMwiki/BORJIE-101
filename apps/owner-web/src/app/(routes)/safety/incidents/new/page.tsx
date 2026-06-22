'use client';

/**
 * O-W-15-NEW — Log new safety incident.
 *
 * Wired to POST /api/v1/mining/incidents. On success the form resets and
 * shows the new incident id. The gateway validates + triggers the GMG
 * escalation fan-out (manager, owner on high/critical, compliance on critical).
 *
 * Fields mirror the `incidents` schema fields that are user-supplied:
 *   kind, severity, occurredAt, description, siteId, location,
 *   fatalities, injuries.
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Button, FormField, Input, Textarea, Alert } from '@borjie/design-system';
import { apiRequest, ApiError } from '@/lib/api-client';
import { useLocale, pickByLocale } from '@/lib/locale';
import type { Locale } from '@/lib/locale-shared';
import { routesBStrings as S } from '@/i18n/strings/routes-b';
import { incidentNewStrings as N } from '@/i18n/strings/incident-new-page';
import { INCIDENT_KINDS } from '@/safety/incidentKinds';

// ---------------------------------------------------------------------------
// Validation schema (mirrors gateway incidentsCreateRoute body)
// ---------------------------------------------------------------------------

// `INCIDENT_KINDS` is kept byte-aligned with the gateway IncidentKindEnum
// (services/api-gateway/src/routes/mining/_openapi/sales-incidents-schemas.ts).
const IncidentCreateSchema = z.object({
  kind: z.enum(INCIDENT_KINDS),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  occurredAt: z.string().min(1, 'Date and time required'),
  description: z.string().min(5, 'Describe the incident (min 5 characters)').max(2000),
  siteId: z.string().optional(),
  location: z.string().max(200).optional(),
  fatalities: z.number().int().min(0).max(999),
  injuries: z.number().int().min(0).max(9999),
});

type IncidentCreateInput = z.infer<typeof IncidentCreateSchema>;

type Severity = IncidentCreateInput['severity'];

/** Selected-state token classes per severity (semantic tokens only). */
const SEVERITY_SELECTED: Readonly<Record<Severity, string>> = {
  low: 'text-foreground border-border bg-surface font-semibold',
  medium: 'text-info border-info/40 bg-info-subtle font-semibold',
  high: 'text-warning border-warning/40 bg-warning-subtle font-semibold',
  critical: 'text-danger border-danger/40 bg-danger-subtle font-semibold',
};

const SEVERITY_ORDER: ReadonlyArray<Severity> = ['low', 'medium', 'high', 'critical'];

function severityLabel(value: Severity, locale: Locale): string {
  if (value === 'medium') return pickByLocale(locale, N.severityMedium);
  if (value === 'high') return pickByLocale(locale, N.severityHigh);
  if (value === 'critical') return pickByLocale(locale, N.severityCritical);
  return pickByLocale(locale, N.severityLow);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewIncidentPage() {
  const locale = useLocale();
  const kindOptions = INCIDENT_KINDS.map((value) => ({
    value,
    label: pickByLocale(locale, S.safety.incidentKind[value]),
  }));

  const [form, setForm] = useState<{
    kind: IncidentCreateInput['kind'];
    severity: Severity;
    occurredAt: string;
    description: string;
    siteId: string;
    location: string;
    fatalities: string;
    injuries: string;
  }>({
    kind: 'safety',
    severity: 'medium',
    occurredAt: new Date().toISOString().slice(0, 16),
    description: '',
    siteId: '',
    location: '',
    fatalities: '0',
    injuries: '0',
  });

  const [validationErrors, setValidationErrors] = useState<
    Partial<Record<keyof IncidentCreateInput, string>>
  >({});
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: IncidentCreateInput) =>
      apiRequest<{ id: string }>('/api/v1/mining/incidents', {
        method: 'POST',
        body: input,
      }),
    onSuccess: (data) => {
      const id =
        data && typeof data === 'object' && 'id' in data
          ? String((data as Record<string, unknown>).id)
          : 'new';
      setSubmittedId(id);
      setForm({
        kind: 'safety',
        severity: 'medium',
        occurredAt: new Date().toISOString().slice(0, 16),
        description: '',
        siteId: '',
        location: '',
        fatalities: '0',
        injuries: '0',
      });
      setValidationErrors({});
    },
  });

  function handleChange<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setValidationErrors((prev) => {
      const { [key as keyof IncidentCreateInput]: _omit, ...rest } = prev;
      return rest;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmittedId(null);

    const parsed = IncidentCreateSchema.safeParse({
      kind: form.kind,
      severity: form.severity,
      occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : '',
      description: form.description,
      siteId: form.siteId || undefined,
      location: form.location || undefined,
      fatalities: parseInt(form.fatalities, 10) || 0,
      injuries: parseInt(form.injuries, 10) || 0,
    });

    if (!parsed.success) {
      const errs: Partial<Record<keyof IncidentCreateInput, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof IncidentCreateInput;
        if (key) errs[key] = issue.message;
      }
      setValidationErrors(errs);
      return;
    }

    mutation.mutate(parsed.data);
  }

  return (
    <div className="space-y-8 px-8 py-8">
      {/* Back navigation */}
      <div>
        <Link
          href="/safety"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {pickByLocale(locale, N.back)}
        </Link>
      </div>

      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>{pickByLocale(locale, N.eyebrow)}</span>
        </div>
        <h1 className="font-display text-2xl font-medium text-foreground">
          {pickByLocale(locale, N.title)}
        </h1>
        <p className="text-sm text-muted-foreground">{pickByLocale(locale, N.intro)}</p>
      </header>

      {/* Success banner */}
      {submittedId ? (
        <div className="flex items-center gap-3 rounded-2xl border border-success/40 bg-success-subtle p-4">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
          <div>
            <p className="text-sm font-semibold text-success">
              {pickByLocale(locale, N.successTitle)}
            </p>
            <p className="text-xs text-muted-foreground">
              {pickByLocale(locale, N.successIdLabel)}:{' '}
              <span className="font-mono">{submittedId}</span>. {pickByLocale(locale, N.successBody)}
            </p>
          </div>
          <Link
            href="/safety"
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            {pickByLocale(locale, N.viewBoard)}
          </Link>
        </div>
      ) : null}

      {/* Gateway error */}
      {mutation.isError ? (
        <Alert variant="error">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : pickByLocale(locale, N.gatewayError)}
        </Alert>
      ) : null}

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-border bg-surface/40 p-6"
      >
        {/* Row: kind + severity */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-foreground">
              {pickByLocale(locale, N.fieldKind)}
            </legend>
            <div className="flex flex-wrap gap-2">
              {kindOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleChange('kind', opt.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    form.kind === opt.value
                      ? 'border-signal-500/60 bg-signal-500/10 text-signal-500'
                      : 'border-border text-muted-foreground hover:border-signal-500/40 hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-foreground">
              {pickByLocale(locale, N.fieldSeverity)}
            </legend>
            <div className="flex flex-wrap gap-2">
              {SEVERITY_ORDER.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleChange('severity', value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    form.severity === value
                      ? SEVERITY_SELECTED[value]
                      : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground'
                  }`}
                >
                  {severityLabel(value, locale)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Occurred at */}
        <FormField
          label={pickByLocale(locale, N.fieldOccurredAt)}
          htmlFor="inc-occurred-at"
          {...(validationErrors.occurredAt !== undefined
            ? { error: validationErrors.occurredAt }
            : {})}
        >
          <Input
            id="inc-occurred-at"
            type="datetime-local"
            value={form.occurredAt}
            onChange={(e) => handleChange('occurredAt', e.target.value)}
            required
            className="w-60"
          />
        </FormField>

        {/* Description */}
        <FormField
          label={pickByLocale(locale, N.fieldDescription)}
          htmlFor="inc-description"
          {...(validationErrors.description !== undefined
            ? { error: validationErrors.description }
            : {})}
        >
          <Textarea
            id="inc-description"
            value={form.description}
            onChange={(e) => handleChange('description', e.target.value)}
            rows={4}
            maxLength={2000}
            required
            placeholder={pickByLocale(locale, N.descriptionPlaceholder)}
          />
        </FormField>

        {/* Site + location */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            htmlFor="inc-location"
            label={`${pickByLocale(locale, N.fieldLocation)} ${pickByLocale(locale, N.optional)}`}
          >
            <Input
              id="inc-location"
              type="text"
              value={form.location}
              onChange={(e) => handleChange('location', e.target.value)}
              placeholder={pickByLocale(locale, N.locationPlaceholder)}
              maxLength={200}
            />
          </FormField>

          <FormField
            htmlFor="inc-site-id"
            label={`${pickByLocale(locale, N.fieldSiteId)} ${pickByLocale(locale, N.optional)}`}
          >
            <Input
              id="inc-site-id"
              type="text"
              value={form.siteId}
              onChange={(e) => handleChange('siteId', e.target.value)}
              placeholder={pickByLocale(locale, N.siteIdPlaceholder)}
            />
          </FormField>
        </div>

        {/* Fatalities + injuries */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <FormField label={pickByLocale(locale, N.fieldFatalities)} htmlFor="inc-fatalities">
            <Input
              id="inc-fatalities"
              type="number"
              min={0}
              max={999}
              value={form.fatalities}
              onChange={(e) => handleChange('fatalities', e.target.value)}
              className="font-mono"
            />
          </FormField>
          <FormField label={pickByLocale(locale, N.fieldInjuries)} htmlFor="inc-injuries">
            <Input
              id="inc-injuries"
              type="number"
              min={0}
              max={9999}
              value={form.injuries}
              onChange={(e) => handleChange('injuries', e.target.value)}
              className="font-mono"
            />
          </FormField>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={mutation.isPending} className="gap-2">
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            {pickByLocale(locale, N.submit)}
          </Button>
          <Link
            href="/ask?prompt=incident"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {pickByLocale(locale, N.askMwikila)}
          </Link>
        </div>
      </form>
    </div>
  );
}
