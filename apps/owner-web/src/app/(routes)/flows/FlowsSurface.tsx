'use client';

/**
 * Business flows — the process compiler (slice 1).
 *
 * The owner installs a compiled flow (the golden "buyer inquiry" flow), which
 * materializes complementary tabs on every actor's surface at once (owner +
 * worker + buyer). They control the per-flow automation with a HUMAN-GATED
 * toggle (fail-closed to GATED) and approve parked responses.
 *
 * Locale-strict: ALL copy resolves through `useT(initialLocale)` (the single
 * locale source). The server wrapper (`page.tsx`) resolves the borjie_locale
 * cookie and seeds `initialLocale` so the first client paint matches the SSR
 * `<html lang>` chrome (no EN-under-SW split-brain).
 *
 * Live endpoints:
 *   POST /api/v1/mining/flows/install                    install + bind the flow
 *   GET  /api/v1/mining/flows                            installed flows + open count
 *   GET  /api/v1/workflow/flow-autonomy/buyer_inquiry    current automation posture
 *   POST /api/v1/workflow/flow-autonomy/buyer_inquiry/posture  flip auto|gated
 *   GET  /api/v1/mining/flows/inquiries/pending          responses awaiting approval
 *   POST /api/v1/mining/flows/inquiries/:id/approve      deliver a parked response
 */

import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Inbox,
  Loader2,
  RotateCw,
  Send,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Skeleton, Textarea } from '@borjie/design-system';
import { apiRequest, ApiError } from '@/lib/api-client';
import { useT } from '@/i18n/t.client';
import type { TFn } from '@/i18n/resolve';
import type { Locale } from '@/lib/locale';

const FLOW_KEY = 'buyer_inquiry';

interface FlowsSummary {
  readonly flows: ReadonlyArray<{ flowKey: string; name: string; status: string }>;
  readonly openRunCount: number;
}
interface InstallResult {
  readonly flowKey: string;
  readonly structuralTabId: string;
  readonly surfaces: ReadonlyArray<string>;
}
interface PosturePref {
  readonly flowId?: string;
  readonly posture?: 'auto' | 'gated';
  readonly confirmationState?: string;
}
interface PendingRun {
  readonly id: string;
  readonly subjectRef: string | null;
  readonly payload?: Record<string, unknown>;
  readonly response?: Record<string, unknown> | null;
  readonly updatedAt?: string;
}
interface QueueRun {
  readonly id: string;
  readonly state: string;
  readonly subjectRef: string | null;
  readonly payload?: Record<string, unknown>;
  readonly response?: Record<string, unknown> | null;
  readonly createdAt?: string;
}

function useFlows() {
  return useQuery({
    queryKey: ['mining', 'flows', 'summary'],
    queryFn: ({ signal }) => apiRequest<FlowsSummary>('/api/v1/mining/flows', { signal }),
    staleTime: 30_000,
  });
}
function usePosture() {
  return useQuery({
    queryKey: ['workflow', 'flow-autonomy', FLOW_KEY],
    queryFn: ({ signal }) =>
      apiRequest<PosturePref | null>(`/api/v1/workflow/flow-autonomy/${FLOW_KEY}`, { signal }),
    staleTime: 15_000,
  });
}
function usePending() {
  return useQuery({
    queryKey: ['mining', 'flows', 'pending'],
    queryFn: ({ signal }) =>
      apiRequest<ReadonlyArray<PendingRun>>('/api/v1/mining/flows/inquiries/pending', { signal }),
    select: (raw): ReadonlyArray<PendingRun> => (Array.isArray(raw) ? raw : []),
    staleTime: 10_000,
  });
}
function useInquiryQueue() {
  return useQuery({
    queryKey: ['mining', 'flows', 'queue'],
    queryFn: ({ signal }) =>
      apiRequest<ReadonlyArray<QueueRun>>('/api/v1/mining/flows/inquiries/queue', { signal }),
    select: (raw): ReadonlyArray<QueueRun> => (Array.isArray(raw) ? raw : []),
    staleTime: 10_000,
  });
}

interface FlowsSurfaceProps {
  readonly initialLocale?: Locale;
}

export function FlowsSurface({ initialLocale }: FlowsSurfaceProps = {}) {
  const t = useT(initialLocale);
  const qc = useQueryClient();
  const flows = useFlows();
  const posture = usePosture();
  const pending = usePending();
  const queue = useInquiryQueue();

  // The per-run reply drafts, keyed by run id — never mutated in place.
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  // The id of the run whose reply was just sent, so we can confirm in-row.
  const [sentRunId, setSentRunId] = useState<string | null>(null);
  // The real install response, so the badge reads the materialized surface
  // count rather than a hardcoded claim.
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);

  const installed = (flows.data?.flows ?? []).some((f) => f.flowKey === FLOW_KEY);
  const isAuto = posture.data?.posture === 'auto' && posture.data?.confirmationState === 'confirmed';

  const install = useMutation({
    mutationFn: () =>
      apiRequest<InstallResult>('/api/v1/mining/flows/install', { method: 'POST', body: {} }),
    onSuccess: (result) => setInstallResult(result),
    onSettled: () => qc.invalidateQueries({ queryKey: ['mining', 'flows', 'summary'] }),
  });
  const setPosture = useMutation({
    mutationFn: (next: 'auto' | 'gated') =>
      apiRequest<unknown>(`/api/v1/workflow/flow-autonomy/${FLOW_KEY}/posture`, {
        method: 'POST',
        body: { posture: next },
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['workflow', 'flow-autonomy', FLOW_KEY] }),
  });
  const approve = useMutation({
    mutationFn: (id: string) =>
      apiRequest<unknown>(`/api/v1/mining/flows/inquiries/${id}/approve`, { method: 'POST', body: {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['mining', 'flows', 'pending'] }),
  });
  // The worker draft-response leg — the call that completes the broken loop.
  // A reply parks the run for owner approval (or auto-delivers when the flow
  // is AUTO), advancing it task_assigned → awaiting_owner_approval. On success
  // we refetch BOTH the queue (the run leaves it) and the pending list (it
  // arrives there), so the run visibly moves into the approve flow.
  const respond = useMutation({
    mutationFn: ({ id, message }: { readonly id: string; readonly message: string }) =>
      apiRequest<unknown>(`/api/v1/mining/flows/inquiries/${id}/respond`, {
        method: 'POST',
        body: { message },
      }),
    onSuccess: (_data, { id }) => {
      setSentRunId(id);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['mining', 'flows', 'queue'] }),
        qc.invalidateQueries({ queryKey: ['mining', 'flows', 'pending'] }),
        qc.invalidateQueries({ queryKey: ['mining', 'flows', 'summary'] }),
      ]),
  });

  const setDraft = (id: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [id]: value }));

  const pendingRuns = pending.data ?? [];
  const queueRuns = queue.data ?? [];

  // Locale-aware actor chips for the golden flow (Buyer → Worker → Owner → Buyer).
  const actorChips = [
    t('flows.actorBuyer'),
    t('flows.actorWorker'),
    t('flows.actorOwner'),
    t('flows.actorBuyer'),
  ];

  return (
    <div className="space-y-8 px-8 py-8">
      <header className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          <Workflow className="h-3.5 w-3.5" />
          <span>{t('flows.eyebrow')}</span>
        </div>
        <h1 className="font-display text-2xl font-medium text-foreground">
          {t('flows.title')}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('flows.intro')}</p>
      </header>

      {/* The golden flow card */}
      <section className="rounded-2xl border border-border bg-surface/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <GitBranch className="mt-0.5 h-5 w-5 text-signal-500" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {t('flows.goldenFlowTitle')}
              </h2>
              <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                {t('flows.goldenFlowDesc')}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {actorChips.map((a, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-full border border-border bg-surface px-2 py-0.5 text-tiny text-muted-foreground"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {installed ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-3 py-1 text-xs font-medium text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {installResult
                  ? t('flows.installedWithSurfaces', {
                      count: installResult.surfaces.length,
                    })
                  : t('flows.installed')}
              </span>
            ) : (
              <Button
                type="button"
                size="sm"
                loading={install.isPending}
                disabled={install.isPending}
                onClick={() => install.mutate()}
                leftIcon={<Sparkles className="h-3.5 w-3.5" />}
              >
                {t('flows.installFlow')}
              </Button>
            )}
          </div>
        </div>

        {/* The human-gated automation toggle */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className={`h-4 w-4 ${isAuto ? 'text-warning' : 'text-success'}`} />
            <div>
              <p className="text-sm font-medium text-foreground">
                {t('flows.autoToggleLabel')}
              </p>
              <p className="text-xs text-muted-foreground">
                {isAuto ? t('flows.autoStateAuto') : t('flows.autoStateGated')}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={setPosture.isPending || posture.isLoading}
            onClick={() => setPosture.mutate(isAuto ? 'gated' : 'auto')}
            className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold disabled:opacity-50 ${
              isAuto
                ? 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20'
                : 'border-border text-foreground hover:bg-surface'
            }`}
          >
            {setPosture.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isAuto ? t('flows.switchToGated') : t('flows.enableAuto')}
          </button>
        </div>
      </section>

      {/* Inquiry queue — the worker draft-response leg.
          Read the inquiry, write a reply, send it: this completes the loop,
          advancing each run task_assigned → awaiting_owner_approval. */}
      <section data-testid="inquiry-queue">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('flows.queueHeading')}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('flows.queueSubtitle')}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={queue.isFetching}
            onClick={() => queue.refetch()}
            aria-label={t('flows.refreshQueueAria')}
            className="shrink-0 gap-1.5"
            leftIcon={<RotateCw className={`h-3.5 w-3.5 ${queue.isFetching ? 'animate-spin' : ''}`} />}
          >
            {t('flows.refresh')}
          </Button>
        </div>

        {queue.isLoading ? (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border" data-testid="inquiry-queue-skeleton">
            {[0, 1].map((i) => (
              <li key={i} className="space-y-3 px-5 py-4">
                <Skeleton className="h-3.5 w-2/3 rounded" />
                <Skeleton className="h-3 w-1/3 rounded" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </li>
            ))}
          </ul>
        ) : queue.isError ? (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4"
            data-testid="inquiry-queue-error"
          >
            <p className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {queue.error instanceof ApiError ? queue.error.message : t('flows.queueLoadFailed')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => queue.refetch()}
              className="shrink-0 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/20 hover:text-destructive focus-visible:ring-destructive"
              leftIcon={<RotateCw className="h-3.5 w-3.5" />}
            >
              {t('flows.retry')}
            </Button>
          </div>
        ) : queueRuns.length === 0 ? (
          <div
            className="rounded-2xl border border-border bg-surface/40 p-8 text-center"
            data-testid="inquiry-queue-empty"
          >
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-foreground">{t('flows.queueEmptyTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('flows.queueEmptyBody')}</p>
          </div>
        ) : (
          <ul className="space-y-3" data-testid="inquiry-queue-list">
            {queueRuns.map((run) => (
              <QueueRow
                key={run.id}
                run={run}
                t={t}
                draft={drafts[run.id] ?? ''}
                isSending={respond.isPending && respond.variables?.id === run.id}
                justSent={sentRunId === run.id}
                respondError={
                  respond.isError && respond.variables?.id === run.id
                    ? respond.error instanceof ApiError
                      ? respond.error.message
                      : t('flows.respondFailed')
                    : null
                }
                onDraftChange={(value) => setDraft(run.id, value)}
                onSend={(message) => respond.mutate({ id: run.id, message })}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Pending approvals (the gated path) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          {t('flows.pendingHeading')}
        </h2>
        {pending.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('flows.loading')}
          </div>
        ) : pending.isError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
            <p className="text-xs text-destructive">
              {pending.error instanceof ApiError ? pending.error.message : t('flows.pendingLoadFailed')}
            </p>
          </div>
        ) : pendingRuns.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface/40 p-8 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-foreground">{t('flows.pendingEmptyTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('flows.pendingEmptyBody')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border">
            {pendingRuns.map((run) => (
              <li key={run.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">
                    {String(run.payload?.message ?? t('flows.buyerInquiryFallback'))}
                  </p>
                  {run.response?.message ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('flows.draftedReply', { message: String(run.response.message) })}
                    </p>
                  ) : null}
                  {run.subjectRef ? (
                    <p className="mt-0.5 font-mono text-tiny text-muted-foreground">
                      {t('flows.listingRef', { ref: run.subjectRef })}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="success"
                  size="sm"
                  loading={approve.isPending}
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(run.id)}
                  className="shrink-0 gap-1.5"
                  leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                >
                  {t('flows.approveDeliver')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface QueueRowProps {
  readonly run: QueueRun;
  readonly t: TFn;
  readonly draft: string;
  readonly isSending: boolean;
  readonly justSent: boolean;
  readonly respondError: string | null;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: (message: string) => void;
}

function QueueRow({
  run,
  t,
  draft,
  isSending,
  justSent,
  respondError,
  onDraftChange,
  onSend,
}: QueueRowProps) {
  const canSend = draft.trim().length > 0 && !isSending;
  return (
    <li
      className="rounded-2xl border border-border bg-surface/40 p-5"
      data-testid="inquiry-queue-row"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-foreground">
            {String(run.payload?.message ?? t('flows.buyerInquiryFallback'))}
          </p>
          {run.payload?.listingTitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('flows.onListing', { title: String(run.payload.listingTitle) })}
            </p>
          ) : null}
          {run.subjectRef ? (
            <p className="mt-0.5 font-mono text-tiny text-muted-foreground">
              {t('flows.listingRef', { ref: run.subjectRef })}
            </p>
          ) : null}
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-tiny tabular-nums text-muted-foreground">
          {run.id}
        </span>
      </div>

      <label htmlFor={`reply-${run.id}`} className="mt-3 block text-tiny font-medium uppercase tracking-eyebrow-wide text-muted-foreground">
        {t('flows.yourReply')}
      </label>
      <Textarea
        id={`reply-${run.id}`}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        disabled={isSending}
        rows={3}
        placeholder={t('flows.replyPlaceholder')}
        className="mt-1 resize-y"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {justSent ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success" data-testid="inquiry-queue-sent">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('flows.replySent')}
          </span>
        ) : respondError ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {respondError}
          </span>
        ) : (
          <span aria-hidden className="text-xs text-transparent">.</span>
        )}
        <Button
          type="button"
          size="sm"
          loading={isSending}
          disabled={!canSend}
          onClick={() => onSend(draft.trim())}
          className="shrink-0 gap-1.5"
          leftIcon={<Send className="h-3.5 w-3.5" />}
        >
          {t('flows.sendReply')}
        </Button>
      </div>
    </li>
  );
}
