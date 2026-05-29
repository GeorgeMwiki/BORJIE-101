'use client';

/**
 * Client surface for the licence renewal flow (issue #194 chain C-B).
 *
 * Maps to:
 *   GET  /api/v1/compliance/licences/:id/renewal-status
 *   POST /api/v1/compliance/licences/:id/start-renewal
 *   POST /api/v1/compliance/licences/:id/submit-renewal
 *
 * Bilingual sw/en labels. Errors render inline; success toasts use
 * the small `message` slot. No external state library — local hooks
 * only, like the cockpit-hub client.
 */

import { useCallback, useEffect, useState } from 'react';

interface LicenceRenewalView {
  readonly licence: {
    readonly id: string;
    readonly number: string;
    readonly kind: string;
    readonly mineral: string;
    readonly status: string;
    readonly expiryDate: string | null;
    readonly fees: Record<string, unknown>;
  };
  readonly openEvent:
    | {
        readonly id: string;
        readonly status: string;
        readonly payload: Record<string, unknown>;
        readonly evidenceIds: readonly string[];
      }
    | null;
  readonly daysUntilExpiry: number | null;
  readonly stage:
    | 'no_action'
    | 'reminder'
    | 'drafting'
    | 'awaiting_owner'
    | 'submitted'
    | 'renewed';
}

const STAGE_LABEL_SW: Readonly<Record<LicenceRenewalView['stage'], string>> = {
  no_action: 'Hakuna hatua',
  reminder: 'Kukumbushwa',
  drafting: 'Rasimu inaandikwa',
  awaiting_owner: 'Inasubiri mmiliki',
  submitted: 'Imewasilishwa',
  renewed: 'Imeshapyishwa',
};
const STAGE_LABEL_EN: Readonly<Record<LicenceRenewalView['stage'], string>> = {
  no_action: 'No action',
  reminder: 'Reminder',
  drafting: 'Drafting',
  awaiting_owner: 'Awaiting owner',
  submitted: 'Submitted',
  renewed: 'Renewed',
};

interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

async function gatewayFetch<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      // Conditional spread keeps `body` absent rather than `undefined`
      // under `exactOptionalPropertyTypes: true` (tsconfig.base.json).
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json()) as ApiResponse<T>;
    return json;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

interface Props {
  readonly licenceId: string;
  readonly isSwahili: boolean;
}

export function LicenceRenewalClient({ licenceId, isSwahili }: Props) {
  const [view, setView] = useState<LicenceRenewalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submissionRef, setSubmissionRef] = useState('');
  const [renewalDocUrl, setRenewalDocUrl] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await gatewayFetch<LicenceRenewalView>(
      'GET',
      `/compliance/licences/${licenceId}/renewal-status`,
    );
    setLoading(false);
    if (res.success && res.data) {
      setView(res.data);
    } else {
      setError(res.error ?? 'Failed to load renewal status');
    }
  }, [licenceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const start = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    const res = await gatewayFetch<unknown>(
      'POST',
      `/compliance/licences/${licenceId}/start-renewal`,
      {
        summary: isSwahili
          ? `Upyaji wa leseni ${view?.licence.number ?? ''} umeanza`
          : `Renewal for ${view?.licence.number ?? 'licence'} started`,
      },
    );
    setLoading(false);
    if (res.success) {
      setMessage(isSwahili ? 'Rasimu imefunguliwa' : 'Draft opened');
      await load();
    } else {
      setError(res.error ?? 'Failed to start renewal');
    }
  }, [licenceId, isSwahili, view?.licence.number, load]);

  const submit = useCallback(async () => {
    if (!submissionRef.trim()) {
      setError(
        isSwahili
          ? 'Tafadhali ingiza kumbukumbu ya uwasilishaji'
          : 'Submission reference required',
      );
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    const body: Record<string, string> = {
      submissionReference: submissionRef.trim(),
    };
    if (renewalDocUrl.trim()) body.renewalDocUrl = renewalDocUrl.trim();
    const res = await gatewayFetch<unknown>(
      'POST',
      `/compliance/licences/${licenceId}/submit-renewal`,
      body,
    );
    setLoading(false);
    if (res.success) {
      setMessage(
        isSwahili ? 'Upyaji umewasilishwa' : 'Renewal submitted to regulator',
      );
      setSubmissionRef('');
      setRenewalDocUrl('');
      await load();
    } else {
      setError(res.error ?? 'Failed to submit renewal');
    }
  }, [licenceId, submissionRef, renewalDocUrl, isSwahili, load]);

  const stageLabel = isSwahili ? STAGE_LABEL_SW : STAGE_LABEL_EN;

  if (loading && !view) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-sm text-slate-400">
        {isSwahili ? 'Inapakia…' : 'Loading…'}
      </div>
    );
  }
  if (!view) {
    return (
      <div className="rounded-2xl border border-rose-700/40 bg-rose-950/30 p-6 text-sm text-rose-200">
        {error ??
          (isSwahili ? 'Leseni haijapatikana' : 'Licence not found')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 md:grid-cols-3">
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili ? 'Aina' : 'Kind'}
          </p>
          <p className="text-lg font-semibold text-slate-100">
            {view.licence.kind}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili ? 'Namba' : 'Number'}
          </p>
          <p className="text-lg font-semibold text-slate-100">
            {view.licence.number}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili ? 'Madini' : 'Mineral'}
          </p>
          <p className="text-lg font-semibold text-slate-100">
            {view.licence.mineral}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili ? 'Tarehe ya kumalizika' : 'Expiry'}
          </p>
          <p className="text-base font-medium text-slate-100">
            {view.licence.expiryDate ?? '—'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili ? 'Siku zilizobaki' : 'Days remaining'}
          </p>
          <p className="text-base font-medium text-slate-100">
            {view.daysUntilExpiry ?? '—'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili ? 'Hatua' : 'Stage'}
          </p>
          <p className="text-base font-medium text-signal-300">
            {stageLabel[view.stage]}
          </p>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-rose-700/40 bg-rose-950/30 px-4 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-200">
          {message}
        </div>
      )}

      {(view.stage === 'no_action' || view.stage === 'reminder') && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-base font-semibold text-slate-100">
            {isSwahili ? 'Anzisha rasimu' : 'Start the renewal draft'}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {isSwahili
              ? 'Mr. Mwikila ataandaa rasimu ya hati za upyaji kulingana na maelezo ya leseni.'
              : "Mr. Mwikila will assemble the renewal docs from the licence's profile."}
          </p>
          <button
            onClick={() => void start()}
            disabled={loading}
            className="mt-4 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400 disabled:opacity-50"
          >
            {isSwahili ? 'Anzisha upyaji' : 'Start renewal'}
          </button>
        </section>
      )}

      {(view.stage === 'drafting' || view.stage === 'awaiting_owner') && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-base font-semibold text-slate-100">
            {isSwahili
              ? 'Wasilisha kwa msimamizi'
              : 'Submit to the regulator'}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {isSwahili
              ? 'Andika nambari ya kumbukumbu ya msimamizi na (hiari) URL ya hati ya upyaji.'
              : 'Enter the regulator reference and (optional) the renewal document URL.'}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-300">
              {isSwahili ? 'Kumbukumbu' : 'Submission reference'}
              <input
                value={submissionRef}
                onChange={(e) => setSubmissionRef(e.target.value)}
                placeholder="NEMC-REF-2026-…"
                className="mt-1 w-full rounded-md border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="text-sm text-slate-300">
              {isSwahili ? 'URL ya hati' : 'Renewal doc URL'}
              <input
                value={renewalDocUrl}
                onChange={(e) => setRenewalDocUrl(e.target.value)}
                placeholder="https://…"
                className="mt-1 w-full rounded-md border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
              />
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => void submit()}
              disabled={loading}
              className="rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400 disabled:opacity-50"
            >
              {isSwahili ? 'Wasilisha' : 'Submit renewal'}
            </button>
          </div>
        </section>
      )}

      {(view.stage === 'submitted' || view.stage === 'renewed') && (
        <section className="rounded-2xl border border-emerald-800 bg-emerald-950/30 p-6 text-sm text-emerald-200">
          {isSwahili
            ? 'Upyaji umekamilika. Hati imewekwa kwenye `licences.fees.renewal_doc_url`.'
            : 'Renewal complete. Document stamped onto `licences.fees.renewal_doc_url`.'}
        </section>
      )}
    </div>
  );
}
