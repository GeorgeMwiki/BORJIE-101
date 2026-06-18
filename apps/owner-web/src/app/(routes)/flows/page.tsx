'use client';

/**
 * Business flows — the process compiler (slice 1).
 *
 * The owner installs a compiled flow (the golden "buyer inquiry" flow), which
 * materializes complementary tabs on every actor's surface at once (owner +
 * worker + buyer). They control the per-flow automation with a HUMAN-GATED
 * toggle (fail-closed to GATED) and approve parked responses.
 *
 * Live endpoints:
 *   POST /api/v1/mining/flows/install                    install + bind the flow
 *   GET  /api/v1/mining/flows                            installed flows + open count
 *   GET  /api/v1/workflow/flow-autonomy/buyer_inquiry    current automation posture
 *   POST /api/v1/workflow/flow-autonomy/buyer_inquiry/posture  flip auto|gated
 *   GET  /api/v1/mining/flows/inquiries/pending          responses awaiting approval
 *   POST /api/v1/mining/flows/inquiries/:id/approve      deliver a parked response
 */

import { useMemo, useState } from 'react';
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
import { Button } from '@borjie/design-system';
import { apiRequest, ApiError } from '@/lib/api-client';

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

export default function FlowsPage() {
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

  const installed = useMemo(
    () => (flows.data?.flows ?? []).some((f) => f.flowKey === FLOW_KEY),
    [flows.data],
  );
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

  return (
    <div className="space-y-8 px-8 py-8">
      <header className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          <Workflow className="h-3.5 w-3.5" />
          <span>Business flows · Process compiler</span>
        </div>
        <h1 className="font-display text-2xl font-medium text-foreground">
          Flows that run themselves — with your say-so
        </h1>
        <p className="max-w-2xl text-sm text-neutral-400">
          Install a compiled flow and it materializes the matching tab on every
          actor&apos;s surface — your control tab, the worker&apos;s queue, the
          buyer&apos;s inquiry view — at once. Automation is human-gated by
          default; flip it on only when you trust it.
        </p>
      </header>

      {/* The golden flow card */}
      <section className="rounded-2xl border border-border bg-surface/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <GitBranch className="mt-0.5 h-5 w-5 text-signal-500" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Buyer inquiry on a listing
              </h2>
              <p className="mt-1 max-w-xl text-xs text-neutral-400">
                Buyer asks about a listing → a response task appears in the worker
                queue → you review → the answer is delivered back to the buyer.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {['Buyer', 'Worker', 'Owner', 'Buyer'].map((a, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-full border border-border bg-surface px-2 py-0.5 text-tiny text-neutral-400"
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
                  ? `Installed · ${installResult.surfaces.length} ${
                      installResult.surfaces.length === 1 ? 'surface' : 'surfaces'
                    }`
                  : 'Installed'}
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
                Install flow
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
                Auto-respond to buyer inquiries
              </p>
              <p className="text-xs text-neutral-400">
                {isAuto
                  ? 'AUTO — worker responses are delivered to buyers immediately.'
                  : 'GATED (default) — every response waits for your approval.'}
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
            {isAuto ? 'Switch to gated' : 'Enable auto'}
          </button>
        </div>
      </section>

      {/* Inquiry queue — the worker draft-response leg.
          Read the inquiry, write a reply, send it: this completes the loop,
          advancing each run task_assigned → awaiting_owner_approval. */}
      <section data-testid="inquiry-queue">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Inquiry queue</h2>
            <p className="mt-0.5 text-xs text-neutral-400">
              Open buyer inquiries waiting for a reply. Send one and it moves to
              your approval queue below.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={queue.isFetching}
            onClick={() => queue.refetch()}
            aria-label="Refresh the inquiry queue"
            className="shrink-0 gap-1.5"
            leftIcon={<RotateCw className={`h-3.5 w-3.5 ${queue.isFetching ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        </div>

        {queue.isLoading ? (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border" data-testid="inquiry-queue-skeleton">
            {[0, 1].map((i) => (
              <li key={i} className="space-y-3 px-5 py-4">
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-surface" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-surface" />
                <div className="h-16 w-full animate-pulse rounded-xl bg-surface" />
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
              {queue.error instanceof ApiError ? queue.error.message : 'Could not load the inquiry queue.'}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => queue.refetch()}
              className="shrink-0 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/20 hover:text-destructive focus-visible:ring-destructive"
              leftIcon={<RotateCw className="h-3.5 w-3.5" />}
            >
              Retry
            </Button>
          </div>
        ) : queueRuns.length === 0 ? (
          <div
            className="rounded-2xl border border-border bg-surface/40 p-8 text-center"
            data-testid="inquiry-queue-empty"
          >
            <Inbox className="mx-auto h-8 w-8 text-neutral-500" />
            <p className="mt-2 text-sm font-medium text-foreground">No inquiries waiting for a reply</p>
            <p className="mt-1 text-xs text-neutral-400">
              When a buyer asks about a listing, the inquiry lands here for you to answer.
            </p>
          </div>
        ) : (
          <ul className="space-y-3" data-testid="inquiry-queue-list">
            {queueRuns.map((run) => {
              const draft = drafts[run.id] ?? '';
              const isSending = respond.isPending && respond.variables?.id === run.id;
              const justSent = sentRunId === run.id;
              const canSend = draft.trim().length > 0 && !isSending;
              return (
                <li
                  key={run.id}
                  className="rounded-2xl border border-border bg-surface/40 p-5"
                  data-testid="inquiry-queue-row"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        {String(run.payload?.message ?? 'Buyer inquiry')}
                      </p>
                      {run.payload?.listingTitle ? (
                        <p className="mt-0.5 text-xs text-neutral-400">
                          on {String(run.payload.listingTitle)}
                        </p>
                      ) : null}
                      {run.subjectRef ? (
                        <p className="mt-0.5 font-mono text-tiny text-neutral-500">
                          listing: {run.subjectRef}
                        </p>
                      ) : null}
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-tiny tabular-nums text-neutral-400">
                      {run.id}
                    </span>
                  </div>

                  <label htmlFor={`reply-${run.id}`} className="mt-3 block text-tiny font-medium uppercase tracking-eyebrow-wide text-neutral-500">
                    Your reply
                  </label>
                  <textarea
                    id={`reply-${run.id}`}
                    value={draft}
                    onChange={(e) => setDraft(run.id, e.target.value)}
                    disabled={isSending}
                    rows={3}
                    placeholder="Write a clear, helpful reply to the buyer…"
                    className="mt-1 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:opacity-50"
                  />

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    {justSent ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success" data-testid="inquiry-queue-sent">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Reply sent. Now awaiting your approval below.
                      </span>
                    ) : respond.isError && respond.variables?.id === run.id ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {respond.error instanceof ApiError ? respond.error.message : 'Could not send the reply.'}
                      </span>
                    ) : (
                      <span aria-hidden className="text-xs text-transparent">.</span>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      loading={isSending}
                      disabled={!canSend}
                      onClick={() => respond.mutate({ id: run.id, message: draft.trim() })}
                      className="shrink-0 gap-1.5"
                      leftIcon={<Send className="h-3.5 w-3.5" />}
                    >
                      Send reply
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Pending approvals (the gated path) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Responses awaiting your approval
        </h2>
        {pending.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : pending.isError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
            <p className="text-xs text-destructive">
              {pending.error instanceof ApiError ? pending.error.message : 'Could not load pending responses.'}
            </p>
          </div>
        ) : pendingRuns.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface/40 p-8 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-neutral-500" />
            <p className="mt-2 text-sm font-medium text-foreground">Nothing waiting</p>
            <p className="mt-1 text-xs text-neutral-400">
              Drafted responses appear here for your approval before they reach the buyer.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border">
            {pendingRuns.map((run) => (
              <li key={run.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">
                    {String(run.payload?.message ?? 'Buyer inquiry')}
                  </p>
                  {run.response?.message ? (
                    <p className="mt-1 text-xs text-neutral-400">
                      Drafted reply: {String(run.response.message)}
                    </p>
                  ) : null}
                  {run.subjectRef ? (
                    <p className="mt-0.5 font-mono text-tiny text-neutral-500">
                      listing: {run.subjectRef}
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
                  Approve &amp; deliver
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
