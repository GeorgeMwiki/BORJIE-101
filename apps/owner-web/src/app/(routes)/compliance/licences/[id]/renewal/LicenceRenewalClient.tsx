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
import { Button, FormField, Input, Skeleton, Alert } from '@borjie/design-system';
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
    return <Skeleton className="h-40 rounded-2xl border border-border" />;
  }
  if (!view) {
    return (
      <Alert variant="error">
        {error ??
          (isSwahili
            ? S.renewalClient.licenceNotFound.sw
            : S.renewalClient.licenceNotFound.en)}
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 rounded-2xl border border-border bg-surface/40 p-6 md:grid-cols-3">
        <div>
          <p className="text-xs uppercase text-muted-foreground">
            {isSwahili ? S.renewalClient.kind.sw : S.renewalClient.kind.en}
          </p>
          <p className="text-lg font-semibold text-foreground">
            {view.licence.kind}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">
            {isSwahili ? S.renewalClient.number.sw : S.renewalClient.number.en}
          </p>
          <p className="text-lg font-semibold text-foreground">
            {view.licence.number}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">
            {isSwahili ? S.renewalClient.mineral.sw : S.renewalClient.mineral.en}
          </p>
          <p className="text-lg font-semibold text-foreground">
            {view.licence.mineral}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">
            {isSwahili ? S.renewalClient.expiry.sw : S.renewalClient.expiry.en}
          </p>
          <p className="text-base font-medium text-foreground">
            {view.licence.expiryDate ?? '—'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">
            {isSwahili
              ? S.renewalClient.daysRemaining.sw
              : S.renewalClient.daysRemaining.en}
          </p>
          <p className="text-base font-medium text-foreground">
            {view.daysUntilExpiry ?? '—'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">
            {isSwahili ? S.renewalClient.stage.sw : S.renewalClient.stage.en}
          </p>
          <p className="text-base font-medium text-signal-300">
            {stageLabel[view.stage]}
          </p>
        </div>
      </section>

      {error && <Alert variant="error">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      {(view.stage === 'no_action' || view.stage === 'reminder') && (
        <section className="rounded-2xl border border-border bg-surface/40 p-6">
          <h2 className="text-base font-semibold text-foreground">
            {isSwahili
              ? S.renewalClient.startDraftHeading.sw
              : S.renewalClient.startDraftHeading.en}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSwahili
              ? S.renewalClient.startDraftBody.sw
              : S.renewalClient.startDraftBody.en}
          </p>
          <Button
            size="sm"
            onClick={() => void start()}
            disabled={loading}
            className="mt-4"
          >
            {isSwahili
              ? S.renewalClient.startRenewalCta.sw
              : S.renewalClient.startRenewalCta.en}
          </Button>
        </section>
      )}

      {(view.stage === 'drafting' || view.stage === 'awaiting_owner') && (
        <section className="rounded-2xl border border-border bg-surface/40 p-6">
          <h2 className="text-base font-semibold text-foreground">
            {isSwahili
              ? S.renewalClient.submitToRegulatorHeading.sw
              : S.renewalClient.submitToRegulatorHeading.en}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSwahili
              ? S.renewalClient.submitToRegulatorBody.sw
              : S.renewalClient.submitToRegulatorBody.en}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <FormField
              label={
                isSwahili
                  ? S.renewalClient.submissionReferenceLabel.sw
                  : S.renewalClient.submissionReferenceLabel.en
              }
            >
              <Input
                value={submissionRef}
                onChange={(e) => setSubmissionRef(e.target.value)}
                placeholder="NEMC-REF-2026-…"
              />
            </FormField>
            <FormField
              label={
                isSwahili
                  ? S.renewalClient.renewalDocUrlLabel.sw
                  : S.renewalClient.renewalDocUrlLabel.en
              }
            >
              <Input
                value={renewalDocUrl}
                onChange={(e) => setRenewalDocUrl(e.target.value)}
                placeholder="https://…"
              />
            </FormField>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={loading}
            >
              {isSwahili
                ? S.renewalClient.submitRenewalCta.sw
                : S.renewalClient.submitRenewalCta.en}
            </Button>
          </div>
        </section>
      )}

      {(view.stage === 'submitted' || view.stage === 'renewed') && (
        <section className="rounded-2xl border border-success/40 bg-success-subtle p-6 text-sm text-success">
          {isSwahili
            ? S.renewalClient.renewalComplete.sw
            : S.renewalClient.renewalComplete.en}
        </section>
      )}
    </div>
  );
}
