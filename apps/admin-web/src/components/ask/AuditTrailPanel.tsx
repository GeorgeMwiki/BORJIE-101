'use client';

/**
 * AuditTrailPanel — reads the cryptographic audit chain for a thread
 * and renders every chain entry as a timeline row.
 *
 * Displays: sequence id, occurred-at, action-kind, decision, actor,
 * prev-hash ↔ this-hash links (truncated), expandable evidence.
 *
 * No mock data. When the gateway returns 503, renders a degraded
 * state — never fakes entries.
 *
 * Typography / colours are all token-based; this component lives in
 * the estate-manager-app now but could be promoted into the shared
 * design-system once the admin-web adopts it (the two
 * apps share schema — the only difference is `scope=platform`).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';

export interface AuditRecord {
  readonly id: string;
  readonly sequenceId: number;
  readonly occurredAt: string;
  readonly tenantId: string;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly actionKind: string;
  readonly actionCategory: string;
  readonly subjectResourceUri: string | null;
  readonly aiModelVersion: string | null;
  readonly promptHash: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly decision: string;
  readonly prevHash: string;
  readonly thisHash: string;
  readonly signature: string | null;
}

export interface AuditTrailPanelProps {
  readonly threadId: string;
  /** 'tenant' (Head-of-Estates view) or 'platform' (HQ view). */
  readonly scope: 'tenant' | 'platform';
  /** Full URL to /api/v1/intelligence/thread/<id>/audit. Includes
   *  query params (scope, limit) baked in by the caller. */
  readonly fetchUrl: string;
  /** Authorization headers the panel needs to send. */
  readonly authHeaders?: Readonly<Record<string, string>>;
  /** Optional title override. */
  readonly title?: string;
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly records: ReadonlyArray<AuditRecord> }
  | { readonly kind: 'degraded'; readonly reason: string; readonly retryable: boolean };

export function AuditTrailPanel({
  threadId,
  scope,
  fetchUrl,
  authHeaders,
  title,
}: AuditTrailPanelProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(fetchUrl, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json', ...(authHeaders ?? {}) },
      });
      if (res.status === 503) {
        setState({
          kind: 'degraded',
          reason: "The audit chain isn't reachable right now.",
          retryable: true,
        });
        return;
      }
      if (res.status === 401) {
        setState({
          kind: 'degraded',
          reason: 'Your session timed out. Sign in again.',
          retryable: false,
        });
        return;
      }
      if (res.status === 403) {
        setState({
          kind: 'degraded',
          reason:
            scope === 'platform'
              ? 'Platform audit trails require PLATFORM_ADMIN or higher.'
              : "You don't have access to this thread's audit trail.",
          retryable: false,
        });
        return;
      }
      if (!res.ok) {
        setState({
          kind: 'degraded',
          reason: `The audit service returned ${res.status}.`,
          retryable: true,
        });
        return;
      }
      const body = (await res.json()) as {
        readonly success: boolean;
        readonly data?: { readonly records: ReadonlyArray<AuditRecord> };
      };
      if (!body.success || !body.data) {
        setState({
          kind: 'degraded',
          reason: 'Unexpected response shape from the audit service.',
          retryable: true,
        });
        return;
      }
      setState({ kind: 'ok', records: body.data.records });
    } catch (error) {
      setState({
        kind: 'degraded',
        reason:
          error instanceof Error
            ? `I couldn't reach the audit service: ${error.message}.`
            : "I couldn't reach the audit service.",
        retryable: true,
      });
    }
  }, [authHeaders, fetchUrl, scope]);

  useEffect(() => {
    void load();
  }, [load, threadId]);

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="flex h-full flex-col" aria-label="Audit trail">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <p className="font-mono text-caption uppercase tracking-widest text-signal-500">
            {scope === 'platform' ? 'Platform audit chain' : 'Audit chain'}
          </p>
          <h2 className="mt-0.5 truncate font-display text-base font-medium tracking-tight">
            {title ?? 'This conversation'}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-caption-lg font-medium text-neutral-500 transition-colors duration-fast hover:bg-surface-raised hover:text-foreground"
          aria-label="Reload audit trail"
        >
          <RefreshCw className="h-3 w-3" />
          Reload
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {state.kind === 'loading' && (
          <div className="flex items-center gap-2 px-5 py-6 text-xs text-neutral-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading the chain…
          </div>
        )}

        {state.kind === 'degraded' && (
          <div className="mx-5 my-5 rounded-md border border-danger/40 bg-danger-subtle/30 p-4 text-xs">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <div>
                <p className="font-medium text-foreground">
                  Audit trail unavailable
                </p>
                <p className="mt-1 text-neutral-500">{state.reason}</p>
                {state.retryable && (
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="mt-2 text-caption-lg font-semibold text-signal-500 underline-offset-2 hover:underline"
                  >
                    Try again
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {state.kind === 'ok' && state.records.length === 0 && (
          <div className="px-5 py-6 text-xs text-neutral-500">
            No audit entries have been recorded for this conversation yet.
          </div>
        )}

        {state.kind === 'ok' && state.records.length > 0 && (
          <ol className="divide-y divide-border">
            {state.records.map((r) => {
              const isOpen = expanded.has(r.id);
              return (
                <li key={r.id} className="px-5 py-3">
                  <button
                    type="button"
                    onClick={() => toggle(r.id)}
                    className="group flex w-full items-start justify-between gap-3 text-left"
                    aria-expanded={isOpen}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 font-mono text-caption uppercase tracking-widest text-neutral-500">
                        <span className="tabular-nums">#{r.sequenceId}</span>
                        <span>·</span>
                        <span>{formatTime(r.occurredAt)}</span>
                        <DecisionPill decision={r.decision} />
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-foreground">
                        {humaniseAction(r.actionKind)}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-caption text-neutral-500">
                        {r.actorKind}
                        {r.actorId ? ` · ${r.actorId}` : ''}
                        {r.aiModelVersion ? ` · ${r.aiModelVersion}` : ''}
                      </p>
                    </div>
                    <span className="mt-1 text-neutral-500 transition-transform duration-fast group-hover:text-foreground">
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </span>
                  </button>
                  {isOpen && <RecordDetails record={r} />}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {state.kind === 'ok' && state.records.length > 0 && (
        <footer className="border-t border-border px-5 py-3 text-micro-num uppercase tracking-widest text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3 text-signal-500" />
            <span className="tabular-nums">{state.records.length} entries</span>
            <span>· chain-linked</span>
          </span>
        </footer>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Subs
// ─────────────────────────────────────────────────────────────────────

function RecordDetails({ record }: { readonly record: AuditRecord }) {
  const evidenceJson = JSON.stringify(record.evidence ?? {}, null, 2);
  return (
    <dl className="mt-3 space-y-2 rounded-md border border-border bg-background p-3 text-meta">
      <DetailRow label="Category" value={record.actionCategory} />
      {record.subjectResourceUri && (
        <DetailRow label="Subject" value={record.subjectResourceUri} mono />
      )}
      {record.promptHash && (
        <DetailRow
          label="Prompt hash"
          value={record.promptHash}
          mono
          icon={<Fingerprint className="h-3 w-3 text-signal-500" />}
        />
      )}
      <DetailRow
        label="Prev hash"
        value={truncateHash(record.prevHash)}
        mono
        icon={<Link2 className="h-3 w-3 text-neutral-500" />}
      />
      <DetailRow
        label="This hash"
        value={truncateHash(record.thisHash)}
        mono
        icon={<Link2 className="h-3 w-3 text-signal-500" />}
      />
      {record.signature && (
        <DetailRow
          label="Signature"
          value={truncateHash(record.signature)}
          mono
          icon={<ShieldCheck className="h-3 w-3 text-signal-500" />}
        />
      )}
      <div>
        <div className="font-mono text-micro-num uppercase tracking-widest text-neutral-500">
          Evidence
        </div>
        <pre className="mt-1 max-h-40 overflow-auto rounded border border-border bg-surface-sunken p-2 font-mono text-caption-lg text-foreground">
          {evidenceJson}
        </pre>
      </div>
    </dl>
  );
}

function DetailRow({
  label,
  value,
  mono,
  icon,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="min-w-thumb font-mono text-micro-num uppercase tracking-widest text-neutral-500">
        {label}
      </dt>
      <dd
        className={
          mono
            ? 'flex items-center gap-1 truncate font-mono text-foreground'
            : 'truncate text-foreground'
        }
      >
        {icon}
        <span className="truncate">{value}</span>
      </dd>
    </div>
  );
}

function DecisionPill({ decision }: { readonly decision: string }) {
  const normalized = decision.toLowerCase();
  let Icon: typeof Check;
  let classes: string;
  if (normalized.includes('execut') || normalized.includes('approv') || normalized === 'allow') {
    Icon = Check;
    classes = 'bg-success-subtle text-success';
  } else if (
    normalized.includes('reject') ||
    normalized === 'deny' ||
    normalized.includes('error')
  ) {
    Icon = X;
    classes = 'bg-danger-subtle text-danger';
  } else {
    Icon = ChevronRight;
    classes = 'bg-surface-raised text-neutral-500';
  }
  return (
    <span
      className={[
        'ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[0.58rem]',
        classes,
      ].join(' ')}
    >
      <Icon className="h-2.5 w-2.5" />
      {decision}
    </span>
  );
}

function humaniseAction(kind: string): string {
  // `ci.tool_call.graph_lookup_node` → "Tool call · graph lookup node"
  if (!kind.startsWith('ci.')) return kind;
  const trimmed = kind.slice('ci.'.length);
  const [head, ...rest] = trimmed.split('.');
  const tail = rest.join('.').replace(/_/g, ' ');
  const headWords = (head ?? '').replace(/_/g, ' ');
  return tail ? `${capitalize(headWords)} · ${tail}` : capitalize(headWords);
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncateHash(hash: string): string {
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
