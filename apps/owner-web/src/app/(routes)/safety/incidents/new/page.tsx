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
import { apiRequest, ApiError } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Validation schema (mirrors gateway incidentsCreateRoute body)
// ---------------------------------------------------------------------------

const IncidentCreateSchema = z.object({
  kind: z.enum(['safety', 'environmental', 'community', 'security']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  occurredAt: z.string().min(1, 'Date and time required'),
  description: z.string().min(5, 'Describe the incident (min 5 characters)').max(2000),
  siteId: z.string().optional(),
  location: z.string().max(200).optional(),
  fatalities: z.number().int().min(0).max(999),
  injuries: z.number().int().min(0).max(9999),
});

type IncidentCreateInput = z.infer<typeof IncidentCreateSchema>;

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

const KIND_OPTIONS = [
  { value: 'safety', label: 'Safety' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'community', label: 'Community' },
  { value: 'security', label: 'Security' },
] as const;

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low', class: 'text-neutral-300 border-border' },
  { value: 'medium', label: 'Medium', class: 'text-info border-info/40' },
  { value: 'high', label: 'High', class: 'text-warning border-warning/40' },
  { value: 'critical', label: 'Critical', class: 'text-destructive border-destructive/40' },
] as const;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewIncidentPage() {
  const [form, setForm] = useState<{
    kind: IncidentCreateInput['kind'];
    severity: IncidentCreateInput['severity'];
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

  function handleChange<K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setValidationErrors((prev) => {
      const { [key as keyof IncidentCreateInput]: _, ...rest } = prev;
      return rest;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmittedId(null);

    const parsed = IncidentCreateSchema.safeParse({
      kind: form.kind,
      severity: form.severity,
      occurredAt: form.occurredAt
        ? new Date(form.occurredAt).toISOString()
        : '',
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
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Safety
        </Link>
      </div>

      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>Safety · New incident</span>
        </div>
        <h1 className="font-display text-2xl font-medium text-foreground">
          Log new incident
        </h1>
        <p className="text-sm text-neutral-400">
          Critical and high-severity incidents trigger an immediate escalation
          to managers and the owner cockpit.
        </p>
      </header>

      {/* Success banner */}
      {submittedId ? (
        <div className="flex items-center gap-3 rounded-2xl border border-success/40 bg-success/10 p-4">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
          <div>
            <p className="text-sm font-semibold text-success">
              Incident logged
            </p>
            <p className="text-xs text-neutral-300">
              ID: <span className="font-mono">{submittedId}</span>. The
              escalation fan-out has been triggered.
            </p>
          </div>
          <Link
            href="/safety"
            className="ml-auto text-xs text-neutral-400 hover:text-foreground"
          >
            View safety board
          </Link>
        </div>
      ) : null}

      {/* Gateway error */}
      {mutation.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-xs text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to log the incident. Please try again.'}
          </p>
        </div>
      ) : null}

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-border bg-surface/40 p-6"
      >
        {/* Row: kind + severity */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-neutral-300">
              Incident kind
            </legend>
            <div className="flex flex-wrap gap-2">
              {KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleChange('kind', opt.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    form.kind === opt.value
                      ? 'border-signal-500/60 bg-signal-500/10 text-signal-500'
                      : 'border-border text-neutral-300 hover:border-signal-500/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-neutral-300">
              Severity
            </legend>
            <div className="flex flex-wrap gap-2">
              {SEVERITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleChange('severity', opt.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    form.severity === opt.value
                      ? `${opt.class} bg-opacity-10 font-semibold`
                      : 'border-border text-neutral-300 hover:border-border/80'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Occurred at */}
        <div className="space-y-1">
          <label
            htmlFor="inc-occurred-at"
            className="text-xs font-medium text-neutral-300"
          >
            Date &amp; time of incident
          </label>
          <input
            id="inc-occurred-at"
            type="datetime-local"
            value={form.occurredAt}
            onChange={(e) => handleChange('occurredAt', e.target.value)}
            required
            className="w-60 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-signal-500/50"
          />
          {validationErrors.occurredAt ? (
            <p className="text-xs text-destructive">
              {validationErrors.occurredAt}
            </p>
          ) : null}
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label
            htmlFor="inc-description"
            className="text-xs font-medium text-neutral-300"
          >
            Description
          </label>
          <textarea
            id="inc-description"
            value={form.description}
            onChange={(e) => handleChange('description', e.target.value)}
            rows={4}
            maxLength={2000}
            required
            placeholder="Describe what happened, where, and who was involved."
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-signal-500/50"
          />
          {validationErrors.description ? (
            <p className="text-xs text-destructive">
              {validationErrors.description}
            </p>
          ) : null}
        </div>

        {/* Site + location */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="inc-location"
              className="text-xs font-medium text-neutral-300"
            >
              Location{' '}
              <span className="text-neutral-500">(optional)</span>
            </label>
            <input
              id="inc-location"
              type="text"
              value={form.location}
              onChange={(e) => handleChange('location', e.target.value)}
              placeholder="e.g. Level 3 south shaft"
              maxLength={200}
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-signal-500/50"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="inc-site-id"
              className="text-xs font-medium text-neutral-300"
            >
              Site ID{' '}
              <span className="text-neutral-500">(optional)</span>
            </label>
            <input
              id="inc-site-id"
              type="text"
              value={form.siteId}
              onChange={(e) => handleChange('siteId', e.target.value)}
              placeholder="UUID or site code"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-signal-500/50"
            />
          </div>
        </div>

        {/* Fatalities + injuries */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="space-y-1">
            <label
              htmlFor="inc-fatalities"
              className="text-xs font-medium text-neutral-300"
            >
              Fatalities
            </label>
            <input
              id="inc-fatalities"
              type="number"
              min={0}
              max={999}
              value={form.fatalities}
              onChange={(e) => handleChange('fatalities', e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-signal-500/50"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="inc-injuries"
              className="text-xs font-medium text-neutral-300"
            >
              Injuries
            </label>
            <input
              id="inc-injuries"
              type="number"
              min={0}
              max={9999}
              value={form.injuries}
              onChange={(e) => handleChange('injuries', e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-signal-500/50"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 border-t border-border pt-4">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            Log incident
          </button>
          <Link
            href="/ask?prompt=incident"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Ask Mr. Mwikila
          </Link>
        </div>
      </form>
    </div>
  );
}
