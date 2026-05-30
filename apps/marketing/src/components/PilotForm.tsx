'use client';

import { useState } from 'react';
import { ArrowRight, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';
import { getCsrfHeaders } from '@/lib/csrf';

type Status = { kind: 'idle' } | { kind: 'submitting' } | { kind: 'success' } | { kind: 'error'; message: string };

/**
 * PilotForm — client-side application form for the pilot programme.
 *
 * Submits to /api/pilot-apply which proxies to the api-gateway
 * marketing route. We never mutate React state; every transition
 * builds a new status object (see the global immutability rule).
 */
export function PilotForm({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).pilotPage;
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === 'submitting') return;
    setStatus({ kind: 'submitting' });

    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get('name') ?? '').trim(),
      company: String(form.get('company') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      phone: String(form.get('phone') ?? '').trim(),
      portfolioSize: Number(form.get('portfolioSize') ?? 0),
      mineralFocus: String(form.get('mineralFocus') ?? '').trim(),
    };

    try {
      const res = await fetch('/api/pilot-apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getCsrfHeaders() },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || 'submit_failed');
      }
      setStatus({ kind: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'submit_failed';
      setStatus({ kind: 'error', message });
    }
  }

  if (status.kind === 'success') {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-signal-500/40 bg-signal-500/5 p-8">
        <CheckCircle2 className="h-10 w-10 text-signal-500" aria-hidden="true" />
        <p className="font-display text-2xl font-medium tracking-tight">{t.success}</p>
        <p className="text-sm text-foreground/70">pilot@borjie.co.tz</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field id="name" label={t.fields.name} type="text" autoComplete="name" required />
      <Field id="company" label={t.fields.company} type="text" autoComplete="organization" required />
      <Field id="email" label={t.fields.email} type="email" autoComplete="email" required />
      <Field id="phone" label={t.fields.phone} type="tel" autoComplete="tel" placeholder="+255 7XX XXX XXX" required />
      <Field id="portfolioSize" label={t.fields.portfolioSize} type="number" inputMode="numeric" min={1} required />

      <div>
        <label
          htmlFor="mineralFocus"
          className="font-mono text-meta uppercase tracking-widest text-foreground/70"
        >
          {t.fields.mineralFocus}
        </label>
        <select
          id="mineralFocus"
          name="mineralFocus"
          required
          defaultValue=""
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-signal-500 focus:outline-none"
        >
          <option value="" disabled>—</option>
          {t.minerals.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {status.kind === 'error' && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t.error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={status.kind === 'submitting'}
        className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-signal-500 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-base ease-out hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] disabled:opacity-60"
      >
        {status.kind === 'submitting' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            {t.submit}
            <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete,
  inputMode,
  min,
  placeholder,
  required,
}: {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly autoComplete?: string;
  readonly inputMode?: 'numeric' | 'text';
  readonly min?: number;
  readonly placeholder?: string;
  readonly required?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="font-mono text-meta uppercase tracking-widest text-foreground/70"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        min={min}
        placeholder={placeholder}
        required={required}
        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/60 focus:border-signal-500 focus:outline-none"
      />
    </div>
  );
}
