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
 * Honest states: loading skeleton while the descriptor fetches, a
 * non-blocking inline error notice on failure (degrade-safe — never a crash).
 */

import { type ReactElement } from 'react';

import { ArtifactRenderer } from '@/components/artifacts/ArtifactRenderer';
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
  // forecast → the genui preview tab (chart/table genui blocks). The projected
  // `tab` is the synthesized preview; GenUITabHost renders it directly.
  if (resolved.artifactKind === 'forecast' && resolved.tab) {
    return <GenUITabHost tab={resolved.tab} locale={locale} />;
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
