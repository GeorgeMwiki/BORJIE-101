'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import type {
  ArtifactRendererProps,
  ArtifactClassification,
  ArtifactLanguage,
} from './ArtifactRendererImpl';

export type {
  ArtifactRendererProps,
  ArtifactClassification,
  ArtifactLanguage,
};

/**
 * Lazy, code-split wrapper around the artifact renderer.
 *
 * The impl pulls in DOMPurify (the client-side defense-in-depth XSS
 * sanitiser) plus the full artifact chrome. Splitting it behind
 * `next/dynamic({ ssr: false })` keeps DOMPurify out of every
 * route-entry bundle — it loads only when an artifact actually mounts
 * (drafts, briefs, scans, settlement statements, …). Render output is
 * identical once loaded; the fallback reserves height so deferring the
 * chunk causes no layout shift.
 *
 * Consumers import `{ ArtifactRenderer }` from here (or the barrel)
 * exactly as before — the laziness is internal.
 */
const LazyArtifactRenderer = dynamic(
  () => import('./ArtifactRendererImpl.js').then((m) => m.ArtifactRenderer),
  { ssr: false, loading: () => <ArtifactLoadingFallback /> },
);

export function ArtifactRenderer(props: ArtifactRendererProps): ReactElement {
  return <LazyArtifactRenderer {...props} />;
}

/**
 * Layout-stable placeholder shown while the artifact chunk loads.
 * Mirrors the impl's `borjie-artifact` frame (header band + body) so
 * the swap-in causes no shift.
 */
function ArtifactLoadingFallback(): ReactElement {
  return (
    <article
      className="borjie-artifact"
      aria-hidden="true"
      data-testid="artifact-loading-fallback"
    >
      <header className="borjie-artifact-header">
        <span className="borjie-artifact-wordmark" aria-hidden="true">
          Borjie
        </span>
      </header>
      <div className="borjie-artifact-skeleton" role="status" aria-live="polite">
        <div className="borjie-artifact-skeleton-row" />
        <div className="borjie-artifact-skeleton-row borjie-artifact-skeleton-row--short" />
        <div className="borjie-artifact-skeleton-row" />
        <div className="borjie-artifact-skeleton-row borjie-artifact-skeleton-row--long" />
      </div>
    </article>
  );
}
