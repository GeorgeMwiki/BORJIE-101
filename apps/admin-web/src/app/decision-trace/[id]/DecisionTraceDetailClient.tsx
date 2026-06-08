'use client';

/**
 * DecisionTrace detail (admin replay UI) — INV-A / FIRE-2.
 *
 * Two trust tiers, mirroring the gateway:
 *   - METADATA header (always): id, action, outcome, tenant, timing, ids —
 *     `GET /mining/internal/decision-trace/:id`.
 *   - CONTENT (break-glass): inputs / branches / rationale / output /
 *     attributes — `GET /mining/internal/decision-trace/:id/content?tenant=`.
 *     Deny-by-default: the gateway returns 403 BREAK_GLASS_REQUIRED until the
 *     tenant has consented to a time-boxed grant. This UI lets an operator
 *     file the request (`POST /mining/internal/break-glass/requests`) and,
 *     once the tenant consents on owner-web, fetch the content (every read is
 *     hash-chain audited + tenant-visible).
 *
 * No SUPABASE_SERVICE_ROLE_KEY anywhere — auth is the platform-session cookie.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface TraceMeta {
  readonly id: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly startedAt: string;
  readonly finalisedAt: string;
  readonly durationMs: number;
  readonly outcome: string;
  readonly chosenBranchId: string | null;
  readonly userId: string | null;
  readonly requestId: string | null;
  readonly parentTraceId: string | null;
}

interface TraceContent extends TraceMeta {
  readonly inputs: Record<string, unknown>;
  readonly branches: ReadonlyArray<Record<string, unknown>>;
  readonly chosenRationale: string | null;
  readonly attributes: Record<string, unknown>;
  readonly output: unknown;
  readonly error: string | null;
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function DecisionTraceDetailClient({
  traceId,
  tenant,
}: {
  traceId: string;
  tenant: string | null;
}) {
  const [meta, setMeta] = useState<TraceMeta | null>(null);
  const [content, setContent] = useState<TraceContent | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [contentState, setContentState] = useState<
    'idle' | 'locked' | 'loading' | 'error'
  >('idle');
  const [contentMsg, setContentMsg] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await api.get<TraceMeta>(
        `/mining/internal/decision-trace/${encodeURIComponent(traceId)}`,
      );
      if (res.success && res.data) setMeta(res.data);
      else setMetaError(res.error ?? 'Trace not found');
    })();
  }, [traceId]);

  const fetchContent = useCallback(async () => {
    if (!tenant) {
      setContentState('error');
      setContentMsg('This is a platform-tier trace with no tenant scope.');
      return;
    }
    setContentState('loading');
    const res = await api.get<TraceContent>(
      `/mining/internal/decision-trace/${encodeURIComponent(
        traceId,
      )}/content?tenant=${encodeURIComponent(tenant)}`,
    );
    if (res.success && res.data) {
      setContent(res.data);
      setContentState('idle');
      setContentMsg(null);
    } else {
      setContentState('locked');
      setContentMsg(
        res.error ??
          'Break-glass required — the tenant must consent to a time-boxed grant before content is shown.',
      );
    }
  }, [traceId, tenant]);

  const requestAccess = useCallback(async () => {
    if (!tenant) return;
    setRequesting(true);
    const res = await api.post('/mining/internal/break-glass/requests', {
      tenantId: tenant,
      justificationCode: 'incident_response',
      reason: reason || `decision-trace replay ${traceId}`,
      scopes: ['decision_trace_content'],
    });
    setRequesting(false);
    if (res.success) {
      setContentMsg(
        'Break-glass request filed. The tenant will see it on their Trust Center and must consent before content unlocks. Retry once consented.',
      );
    } else {
      setContentMsg(res.error ?? 'Failed to file break-glass request');
    }
  }, [tenant, reason, traceId]);

  if (metaError) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
        {metaError}
      </div>
    );
  }
  if (!meta) {
    return <div className="text-sm text-neutral-400">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="text-xs">
        <Link href="/decision-trace" className="text-amber-400 hover:text-amber-200">
          ← Back to list
        </Link>
      </div>

      <section className="p-5 border border-neutral-700 rounded bg-neutral-900/40">
        <div className="flex flex-wrap justify-between gap-4">
          <Meta label="Action" value={meta.name} mono />
          <Meta label="Outcome" value={meta.outcome.toUpperCase()} mono />
          <Meta label="Tenant" value={meta.tenantId ?? 'platform'} mono />
          <Meta label="Duration" value={`${meta.durationMs}ms`} mono />
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono text-neutral-400">
          <div>id: {meta.id}</div>
          <div>started: {new Date(meta.startedAt).toISOString()}</div>
          <div>finalised: {new Date(meta.finalisedAt).toISOString()}</div>
          {meta.userId ? <div>userId: {meta.userId}</div> : null}
          {meta.requestId ? <div>requestId: {meta.requestId}</div> : null}
        </div>
      </section>

      {!content ? (
        <section className="p-5 border border-amber-700/40 rounded bg-amber-950/20 space-y-3">
          <h2 className="text-sm font-medium text-amber-300">
            Decision content is tenant business data
          </h2>
          <p className="text-xs text-neutral-400">
            Inputs, branches, rationale, and output cross the control-plane wall.
            They are shown only under an active, tenant-consented, time-boxed
            break-glass grant — every read is hash-chain audited and visible to
            the tenant.
          </p>
          {contentMsg && (
            <p className="text-xs text-amber-200">{contentMsg}</p>
          )}
          <div className="flex flex-wrap gap-2 items-end">
            <label className="flex flex-col text-xs text-neutral-400 flex-1 min-w-[16rem]">
              Justification / reason
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="incident ref / ticket id"
                className="mt-1 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-neutral-100"
              />
            </label>
            <button
              type="button"
              onClick={() => void requestAccess()}
              disabled={!tenant || requesting}
              className="rounded bg-amber-700 hover:bg-amber-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {requesting ? 'Filing…' : 'Request break-glass'}
            </button>
            <button
              type="button"
              onClick={() => void fetchContent()}
              disabled={!tenant || contentState === 'loading'}
              className="rounded border border-amber-700 px-4 py-2 text-sm text-amber-300 disabled:opacity-50"
            >
              {contentState === 'loading' ? 'Checking…' : 'Load content'}
            </button>
          </div>
          {!tenant && (
            <p className="text-xs text-neutral-500">
              Platform-tier trace — no tenant scope, no break-glass needed (and
              no tenant content to show).
            </p>
          )}
        </section>
      ) : (
        <>
          <Panel title="Inputs" body={json(content.inputs ?? {})} />
          <Panel
            title={`Branches considered (${content.branches?.length ?? 0})`}
            body={json(content.branches ?? [])}
          />
          {content.chosenRationale ? (
            <div className="text-xs text-neutral-400">
              Rationale: {content.chosenRationale}
            </div>
          ) : null}
          {content.error ? (
            <Panel title="Error" body={content.error} tone="error" />
          ) : null}
          <Panel title="Output" body={json(content.output ?? null)} />
          {content.attributes && Object.keys(content.attributes).length > 0 ? (
            <Panel title="Attributes" body={json(content.attributes)} />
          ) : null}
        </>
      )}
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className={`text-sm text-neutral-100 ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone?: 'error';
}) {
  return (
    <section>
      <h2
        className={`text-sm font-medium mb-2 ${
          tone === 'error' ? 'text-rose-300' : 'text-neutral-300'
        }`}
      >
        {title}
      </h2>
      <pre
        className={`text-xs rounded p-4 overflow-x-auto ${
          tone === 'error'
            ? 'bg-rose-950/40 border border-rose-800 text-rose-200'
            : 'bg-neutral-950 border border-neutral-800 text-neutral-200'
        }`}
      >
        {body}
      </pre>
    </section>
  );
}
