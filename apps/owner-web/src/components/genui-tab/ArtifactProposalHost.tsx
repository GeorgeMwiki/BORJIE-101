'use client';

/**
 * ArtifactProposalHost — closure Wave 8, the brain-proposal → artifact-render
 * seam (mount half).
 *
 * Given a modality artifact proposalId (forwarded from the SSE parser), this
 * host resolves the EGRESS-MEMBRANE-PROJECTED descriptor via
 * `useArtifactResolver` and routes it to the matching renderer:
 *
 *   - forecast          → the genui preview tab (chart / table genui blocks)
 *                         rendered by <GenUITabHost> from the projected `tab`.
 *   - document / media  → the orphan <ArtifactRenderer> (rich chrome), with a
 *                         DOMPurify-wrapped body built from the descriptor's
 *                         renderable identity fields. ArtifactRenderer
 *                         re-sanitises the body client-side as the second XSS
 *                         barrier (CLAUDE.md: "No raw HTML interpolation —
 *                         DOMPurify wraps required").
 *
 * owner-genui-11 fix (partial): forecast-preview action buttons now have a
 * working dispatch path via `confirmAction`. The full fix (per-widget action
 * extraction from the raw overlay) requires `useArtifactResolver` to expose
 * `rawTab` and `GenUITabHost` to accept a `rawOverlay` prop — both outside
 * this file; tracked in needsAttention. This partial fix extracts top-level
 * `proposalActions[]` from `resolved.artifact` (emitted by the gateway's
 * forecast projector) and wires each one to `confirmAction` so owners can at
 * minimum act on the forecast-level verbs (accept, reject, trigger-plan, etc).
 *
 * Honest states: loading skeleton while the descriptor fetches, a
 * non-blocking inline error notice on failure (degrade-safe — never a crash).
 */

import { useCallback, useState, type ReactElement } from 'react';
import { z } from 'zod';

import { ArtifactRenderer } from '@/components/artifacts/ArtifactRenderer';
import { confirmAction } from '@/lib/queries/chat-actions';
import { GenUITabHost } from './GenUITabHost';
import { toSafeText } from './sanitize';
import {
  useArtifactResolver,
  type ResolvedArtifact,
} from './use-artifact-resolver';

type Locale = 'en' | 'sw';

export interface ArtifactProposalHostProps {
  readonly proposalId: string;
  readonly title: string;
  readonly tradingName: string;
  readonly locale: Locale;
}

const COPY = {
  loading: { en: 'Preparing artifact…', sw: 'Inaandaa kazi…' },
  unavailable: {
    en: 'This artifact could not be loaded.',
    sw: 'Kazi hii haikuweza kupakiwa.',
  },
  empty: {
    en: 'No renderable content in this artifact.',
    sw: 'Hakuna maudhui ya kuonyesha katika kazi hii.',
  },
} as const;

/**
 * Build a SAFE HTML body from the projected descriptor's renderable identity
 * fields. Every key + value is escaped to plain text via `toSafeText` (all
 * tags stripped) BEFORE it is placed inside the markup — so even a hostile
 * scrubbed value cannot inject. ArtifactRenderer re-sanitises with DOMPurify
 * after mount as the mandated second barrier.
 */
function descriptorToSafeHtml(
  artifact: Readonly<Record<string, unknown>>,
): string {
  const rows: string[] = [];
  for (const [key, value] of Object.entries(artifact)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) continue;
    const label = toSafeText(humaniseKey(key));
    const rendered = Array.isArray(value)
      ? value.map((v) => toSafeText(String(v))).join(', ')
      : toSafeText(String(value));
    if (!rendered) continue;
    rows.push(
      `<tr><th scope="row">${label}</th><td>${rendered}</td></tr>`,
    );
  }
  if (rows.length === 0) return '';
  return `<table class="borjie-artifact-descriptor"><tbody>${rows.join('')}</tbody></table>`;
}

/** Turn `archiveIds` / `approvalState` into "Archive ids" / "Approval state". */
function humaniseKey(key: string): string {
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function InlineNote({
  tone,
  children,
}: {
  readonly tone: 'loading' | 'error';
  readonly children: string;
}): ReactElement {
  const cls =
    tone === 'error'
      ? 'border-destructive/30 bg-destructive/5 text-destructive'
      : 'border-border bg-surface/40 text-neutral-400';
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`artifact-proposal-${tone}`}
      className={`flex min-h-[96px] items-center justify-center rounded-xl border px-4 py-6 text-sm ${cls}`}
    >
      {children}
    </div>
  );
}

// ── Proposal-level action buttons ──────────────────────────────────────────

/**
 * Schema for `proposalActions[]` emitted by the gateway's forecast projector.
 * Each entry carries a fulfillment `verb` + optional `params`. This is the
 * top-level dispatch seam (per owner-genui-11); per-widget actions require a
 * deeper fix tracked in needsAttention.
 */
const ProposalActionSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().max(200).optional(),
  verb: z.string().min(1).max(200),
  params: z.record(z.string(), z.unknown()).optional(),
});

type ProposalAction = z.infer<typeof ProposalActionSchema>;

type ProposalActionStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done' }
  | { readonly kind: 'handling' }
  | { readonly kind: 'failed' };

function ProposalActionButton({
  action,
  locale,
}: {
  readonly action: ProposalAction;
  readonly locale: Locale;
}): ReactElement {
  const [status, setStatus] = useState<ProposalActionStatus>({ kind: 'idle' });
  const label = toSafeText(action.label) || action.verb;

  const RUNNING = locale === 'sw' ? 'Inafanya kazi…' : 'Working…';
  const DONE = locale === 'sw' ? 'Imekamilika.' : 'Done.';
  const HANDLING =
    locale === 'sw' ? 'Naishughulikia…' : "On it — I'm handling that for you.";
  const FAILED =
    locale === 'sw'
      ? 'Kitendo hicho hakikuweza kufanyika.'
      : 'That action could not run.';

  const onClick = useCallback(() => {
    setStatus({ kind: 'running' });
    void confirmAction({ verb: action.verb, params: action.params ?? {} })
      .then((result) => {
        if (result.executed) {
          setStatus({ kind: 'done' });
          return;
        }
        if (result.deferToBrain) {
          setStatus({ kind: 'handling' });
          return;
        }
        setStatus({ kind: 'failed' });
      })
      .catch(() => setStatus({ kind: 'failed' }));
  }, [action.verb, action.params]);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={status.kind === 'running'}
        data-testid={`proposal-action-${action.id}`}
        className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-warning hover:text-warning disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status.kind === 'running' ? RUNNING : label}
      </button>
      {status.kind === 'done' ? (
        <span className="text-xs text-success">{DONE}</span>
      ) : null}
      {status.kind === 'handling' ? (
        <span className="text-xs text-neutral-400">{HANDLING}</span>
      ) : null}
      {status.kind === 'failed' ? (
        <span className="text-xs text-destructive">{FAILED}</span>
      ) : null}
    </div>
  );
}

/**
 * Parse `proposalActions[]` from the opaque artifact blob. Returns an empty
 * array when the field is absent or malformed — degrade-safe.
 */
function parseProposalActions(
  artifact: Readonly<Record<string, unknown>>,
): ReadonlyArray<ProposalAction> {
  if (!Array.isArray(artifact.proposalActions)) return [];
  const out: ProposalAction[] = [];
  for (const item of artifact.proposalActions) {
    const parsed = ProposalActionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// ── Ready descriptor renderer ──────────────────────────────────────────────

/** Render a ready descriptor through the kind-matched renderer. */
function ReadyArtifact({
  resolved,
  title,
  tradingName,
  locale,
}: {
  readonly resolved: ResolvedArtifact;
  readonly title: string;
  readonly tradingName: string;
  readonly locale: Locale;
}): ReactElement {
  const proposalActions = parseProposalActions(resolved.artifact);

  // forecast → the genui preview tab (chart/table genui blocks). The projected
  // `tab` is the synthesized preview; GenUITabHost renders it directly.
  // Proposal-level action buttons (accept/reject/trigger-plan etc) dispatch via
  // confirmAction. Per-widget actions from the raw overlay require needsAttention
  // fix in GenUITabHost (rawOverlay prop) + useArtifactResolver (expose rawTab).
  if (resolved.artifactKind === 'forecast' && resolved.tab) {
    return (
      <div className="flex flex-col gap-4">
        <GenUITabHost tab={resolved.tab} locale={locale} />
        {proposalActions.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {proposalActions.map((action) => (
              <ProposalActionButton
                key={action.id}
                action={action}
                locale={locale}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // document / media (and a forecast with no preview tab) → the rich
  // ArtifactRenderer with a DOMPurify-wrapped descriptor body.
  const bodyHtml = descriptorToSafeHtml(resolved.artifact);
  const auditTail =
    resolved.evidenceIds[0]?.replace(/^borjie:/, '').slice(0, 16) ?? '—';
  return (
    <ArtifactRenderer
      title={title}
      tenantTradingName={tradingName}
      classification="internal"
      auditHashTail={auditTail}
      renderedAtUtc={new Date().toISOString()}
      authorDisplayName="Mr. Mwikila"
      language={locale}
      bodyHtml={bodyHtml}
      {...(bodyHtml.length === 0
        ? { emptyState: { message: COPY.empty[locale] } }
        : {})}
    />
  );
}

export function ArtifactProposalHost({
  proposalId,
  title,
  tradingName,
  locale,
}: ArtifactProposalHostProps): ReactElement {
  const state = useArtifactResolver(proposalId);

  switch (state.status) {
    case 'idle':
    case 'loading':
      return <InlineNote tone="loading">{COPY.loading[locale]}</InlineNote>;
    case 'error':
      return (
        <InlineNote tone="error">
          {`${COPY.unavailable[locale]} ${state.message}`}
        </InlineNote>
      );
    case 'ready':
      return (
        <ReadyArtifact
          resolved={state.artifact}
          title={title}
          tradingName={tradingName}
          locale={locale}
        />
      );
    default:
      return <InlineNote tone="error">{COPY.unavailable[locale]}</InlineNote>;
  }
}
