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
import { Button } from '@borjie/design-system';

import { pickByLocale, useLocale, type Locale } from '@/lib/locale';
import { localizeEnumLabel, DECISION_OUTCOME_LABELS } from '@/lib/internal/enum-labels';

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
  /** Optional title override (already resolved to the active locale). */
  readonly title?: string;
  /** Server-resolved locale seed so the first paint matches the page chrome. */
  readonly initialLocale?: Locale;
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
  initialLocale,
}: AuditTrailPanelProps) {
  const locale = useLocale(initialLocale);
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
          reason: pickByLocale(locale, {
            en: "The audit chain isn't reachable right now.",
            sw: 'Mnyororo wa ukaguzi haufikiki kwa sasa.',
          }),
          retryable: true,
        });
        return;
      }
      if (res.status === 401) {
        setState({
          kind: 'degraded',
          reason: pickByLocale(locale, {
            en: 'Your session timed out. Sign in again.',
            sw: 'Kipindi chako kimeisha muda. Ingia tena.',
          }),
          retryable: false,
        });
        return;
      }
      if (res.status === 403) {
        setState({
          kind: 'degraded',
          reason:
            scope === 'platform'
              ? pickByLocale(locale, {
                  en: 'Platform audit trails require PLATFORM_ADMIN or higher.',
                  sw: 'Nyayo za ukaguzi za jukwaa zinahitaji PLATFORM_ADMIN au zaidi.',
                })
              : pickByLocale(locale, {
                  en: "You don't have access to this thread's audit trail.",
                  sw: 'Huna ruhusa ya kufikia nyayo za ukaguzi za mazungumzo haya.',
                }),
          retryable: false,
        });
        return;
      }
      if (!res.ok) {
        setState({
          kind: 'degraded',
          reason: pickByLocale(locale, {
            en: `The audit service returned ${res.status}.`,
            sw: `Huduma ya ukaguzi ilirudisha ${res.status}.`,
          }),
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
          reason: pickByLocale(locale, {
            en: 'Unexpected response shape from the audit service.',
            sw: 'Umbo lisilotarajiwa la jibu kutoka huduma ya ukaguzi.',
          }),
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
            ? pickByLocale(locale, {
                en: `I couldn't reach the audit service: ${error.message}.`,
                sw: `Sikuweza kufikia huduma ya ukaguzi: ${error.message}.`,
              })
            : pickByLocale(locale, {
                en: "I couldn't reach the audit service.",
                sw: 'Sikuweza kufikia huduma ya ukaguzi.',
              }),
        retryable: true,
      });
    }
  }, [authHeaders, fetchUrl, scope, locale]);

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
    <section
      className="flex h-full flex-col"
      aria-label={pickByLocale(locale, { en: 'Audit trail', sw: 'Nyayo za ukaguzi' })}
    >
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <p className="font-mono text-caption uppercase tracking-widest text-signal-500">
            {scope === 'platform'
              ? pickByLocale(locale, {
                  en: 'Platform audit chain',
                  sw: 'Mnyororo wa ukaguzi wa jukwaa',
                })
              : pickByLocale(locale, {
                  en: 'Audit chain',
                  sw: 'Mnyororo wa ukaguzi',
                })}
          </p>
          <h2 className="mt-0.5 truncate font-display text-base font-medium tracking-tight">
            {title ??
              pickByLocale(locale, {
                en: 'This conversation',
                sw: 'Mazungumzo haya',
              })}
          </h2>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="gap-1 text-neutral-500"
          aria-label={pickByLocale(locale, {
            en: 'Reload audit trail',
            sw: 'Pakia upya nyayo za ukaguzi',
          })}
        >
          <RefreshCw className="h-3 w-3" />
          {pickByLocale(locale, { en: 'Reload', sw: 'Pakia upya' })}
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {state.kind === 'loading' && (
          <div className="flex items-center gap-2 px-5 py-6 text-xs text-neutral-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {pickByLocale(locale, {
              en: 'Loading the chain…',
              sw: 'Inapakia mnyororo…',
            })}
          </div>
        )}

        {state.kind === 'degraded' && (
          <div className="mx-5 my-5 rounded-md border border-danger/40 bg-danger-subtle/30 p-4 text-xs">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <div>
                <p className="font-medium text-foreground">
                  {pickByLocale(locale, {
                    en: 'Audit trail unavailable',
                    sw: 'Nyayo za ukaguzi hazipatikani',
                  })}
                </p>
                <p className="mt-1 text-neutral-500">{state.reason}</p>
                {state.retryable && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() => void load()}
                    className="mt-2 h-auto p-0 text-signal-500"
                  >
                    {pickByLocale(locale, {
                      en: 'Try again',
                      sw: 'Jaribu tena',
                    })}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {state.kind === 'ok' && state.records.length === 0 && (
          <div className="px-5 py-6 text-xs text-neutral-500">
            {pickByLocale(locale, {
              en: 'No audit entries have been recorded for this conversation yet.',
              sw: 'Hakuna maingizo ya ukaguzi yaliyorekodiwa kwa mazungumzo haya bado.',
            })}
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
                        <DecisionPill decision={r.decision} locale={locale} />
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
                  {isOpen && <RecordDetails record={r} locale={locale} />}
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
            <span className="tabular-nums">
              {state.records.length}{' '}
              {pickByLocale(locale, { en: 'entries', sw: 'maingizo' })}
            </span>
            <span>
              ·{' '}
              {pickByLocale(locale, {
                en: 'chain-linked',
                sw: 'imeunganishwa kwa mnyororo',
              })}
            </span>
          </span>
        </footer>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Subs
// ─────────────────────────────────────────────────────────────────────

function RecordDetails({
  record,
  locale,
}: {
  readonly record: AuditRecord;
  readonly locale: Locale;
}) {
  const evidenceJson = JSON.stringify(record.evidence ?? {}, null, 2);
  return (
    <dl className="mt-3 space-y-2 rounded-md border border-border bg-background p-3 text-meta">
      <DetailRow
        label={pickByLocale(locale, { en: 'Category', sw: 'Kategoria' })}
        value={record.actionCategory}
      />
      {record.subjectResourceUri && (
        <DetailRow
          label={pickByLocale(locale, { en: 'Subject', sw: 'Mada' })}
          value={record.subjectResourceUri}
          mono
        />
      )}
      {record.promptHash && (
        <DetailRow
          label={pickByLocale(locale, { en: 'Prompt hash', sw: 'Heshi ya kidokezo' })}
          value={record.promptHash}
          mono
          icon={<Fingerprint className="h-3 w-3 text-signal-500" />}
        />
      )}
      <DetailRow
        label={pickByLocale(locale, { en: 'Prev hash', sw: 'Heshi iliyotangulia' })}
        value={truncateHash(record.prevHash)}
        mono
        icon={<Link2 className="h-3 w-3 text-neutral-500" />}
      />
      <DetailRow
        label={pickByLocale(locale, { en: 'This hash', sw: 'Heshi hii' })}
        value={truncateHash(record.thisHash)}
        mono
        icon={<Link2 className="h-3 w-3 text-signal-500" />}
      />
      {record.signature && (
        <DetailRow
          label={pickByLocale(locale, { en: 'Signature', sw: 'Sahihi' })}
          value={truncateHash(record.signature)}
          mono
          icon={<ShieldCheck className="h-3 w-3 text-signal-500" />}
        />
      )}
      <div>
        <div className="font-mono text-micro-num uppercase tracking-widest text-neutral-500">
          {pickByLocale(locale, { en: 'Evidence', sw: 'Ushahidi' })}
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

function DecisionPill({
  decision,
  locale,
}: {
  readonly decision: string;
  readonly locale: Locale;
}) {
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
      {localizeEnumLabel(DECISION_OUTCOME_LABELS, decision, locale)}
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
