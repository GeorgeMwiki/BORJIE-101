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
import { apiRequest, ApiError } from '@/lib/api-client';
import {
  routesAStrings as S,
  renewalStartSummary,
} from '@/i18n/strings/routes-a';

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
  no_action: S.renewalClient.stageNoAction.sw,
  reminder: S.renewalClient.stageReminder.sw,
  drafting: S.renewalClient.stageDrafting.sw,
  awaiting_owner: S.renewalClient.stageAwaitingOwner.sw,
  submitted: S.renewalClient.stageSubmitted.sw,
  renewed: S.renewalClient.stageRenewed.sw,
};
const STAGE_LABEL_EN: Readonly<Record<LicenceRenewalView['stage'], string>> = {
  no_action: S.renewalClient.stageNoAction.en,
  reminder: S.renewalClient.stageReminder.en,
  drafting: S.renewalClient.stageDrafting.en,
  awaiting_owner: S.renewalClient.stageAwaitingOwner.en,
  submitted: S.renewalClient.stageSubmitted.en,
  renewed: S.renewalClient.stageRenewed.en,
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
    // apiRequest prepends the gateway base, attaches the Supabase Bearer,
    // and unwraps the {success,data} envelope — so `data` here is the inner
    // payload. Re-wrap into the local ApiResponse contract callers expect.
    // Conditional spread keeps `body` absent rather than `undefined` under
    // `exactOptionalPropertyTypes: true` (tsconfig.base.json).
    const data = await apiRequest<T>(`/api/v1${path}`, {
      method,
      ...(body ? { body } : {}),
    });
    return { success: true, data };
  } catch (err) {
    // apiRequest throws ApiError (with .status) on any non-2xx; its message
    // carries the gateway error body, matching the prior `res.error` surface.
    return {
      success: false,
      error:
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Network error',
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
        summary: renewalStartSummary(isSwahili, view?.licence.number ?? ''),
      },
    );
    setLoading(false);
    if (res.success) {
      setMessage(isSwahili ? S.renewalClient.draftOpened.sw : S.renewalClient.draftOpened.en);
      await load();
    } else {
      setError(res.error ?? 'Failed to start renewal');
    }
  }, [licenceId, isSwahili, view?.licence.number, load]);

  const submit = useCallback(async () => {
    if (!submissionRef.trim()) {
      setError(
        isSwahili
          ? S.renewalClient.submissionRefRequired.sw
          : S.renewalClient.submissionRefRequired.en,
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
        isSwahili
          ? S.renewalClient.renewalSubmitted.sw
          : S.renewalClient.renewalSubmitted.en,
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
        {isSwahili ? S.renewalClient.loading.sw : S.renewalClient.loading.en}
      </div>
    );
  }
  if (!view) {
    return (
      <div className="rounded-2xl border border-rose-700/40 bg-rose-950/30 p-6 text-sm text-rose-200">
        {error ??
          (isSwahili
            ? S.renewalClient.licenceNotFound.sw
            : S.renewalClient.licenceNotFound.en)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 md:grid-cols-3">
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili ? S.renewalClient.kind.sw : S.renewalClient.kind.en}
          </p>
          <p className="text-lg font-semibold text-slate-100">
            {view.licence.kind}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili ? S.renewalClient.number.sw : S.renewalClient.number.en}
          </p>
          <p className="text-lg font-semibold text-slate-100">
            {view.licence.number}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili ? S.renewalClient.mineral.sw : S.renewalClient.mineral.en}
          </p>
          <p className="text-lg font-semibold text-slate-100">
            {view.licence.mineral}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili ? S.renewalClient.expiry.sw : S.renewalClient.expiry.en}
          </p>
          <p className="text-base font-medium text-slate-100">
            {view.licence.expiryDate ?? '—'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili
              ? S.renewalClient.daysRemaining.sw
              : S.renewalClient.daysRemaining.en}
          </p>
          <p className="text-base font-medium text-slate-100">
            {view.daysUntilExpiry ?? '—'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">
            {isSwahili ? S.renewalClient.stage.sw : S.renewalClient.stage.en}
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
            {isSwahili
              ? S.renewalClient.startDraftHeading.sw
              : S.renewalClient.startDraftHeading.en}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {isSwahili
              ? S.renewalClient.startDraftBody.sw
              : S.renewalClient.startDraftBody.en}
          </p>
          <button
            onClick={() => void start()}
            disabled={loading}
            className="mt-4 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400 disabled:opacity-50"
          >
            {isSwahili
              ? S.renewalClient.startRenewalCta.sw
              : S.renewalClient.startRenewalCta.en}
          </button>
        </section>
      )}

      {(view.stage === 'drafting' || view.stage === 'awaiting_owner') && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-base font-semibold text-slate-100">
            {isSwahili
              ? S.renewalClient.submitToRegulatorHeading.sw
              : S.renewalClient.submitToRegulatorHeading.en}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {isSwahili
              ? S.renewalClient.submitToRegulatorBody.sw
              : S.renewalClient.submitToRegulatorBody.en}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-300">
              {isSwahili
                ? S.renewalClient.submissionReferenceLabel.sw
                : S.renewalClient.submissionReferenceLabel.en}
              <input
                value={submissionRef}
                onChange={(e) => setSubmissionRef(e.target.value)}
                placeholder="NEMC-REF-2026-…"
                className="mt-1 w-full rounded-md border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="text-sm text-slate-300">
              {isSwahili
                ? S.renewalClient.renewalDocUrlLabel.sw
                : S.renewalClient.renewalDocUrlLabel.en}
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
              {isSwahili
                ? S.renewalClient.submitRenewalCta.sw
                : S.renewalClient.submitRenewalCta.en}
            </button>
          </div>
        </section>
      )}

      {(view.stage === 'submitted' || view.stage === 'renewed') && (
        <section className="rounded-2xl border border-emerald-800 bg-emerald-950/30 p-6 text-sm text-emerald-200">
          {isSwahili
            ? S.renewalClient.renewalComplete.sw
            : S.renewalClient.renewalComplete.en}
        </section>
      )}
    </div>
  );
}
