'use client';

/**
 * ArtifactRenderer — wave ARTIFACT-RICHNESS.
 *
 * Wraps a server-rendered artifact body (HTML produced by the
 * api-gateway's `services/artifact-richness` pipeline) and mounts
 * it inside the cockpit with consistent chrome:
 *
 *   - Borjie wordmark header band
 *   - classification badge
 *   - audit hash tail + ISO timestamp footer
 *   - bilingual sw/en disclaimer
 *   - print-friendly CSS pass
 *   - loading / empty / failure states
 *
 * The HTML coming from the API is already sanitized server-side
 * (markdown-to-html escapes leaves, the richness pipeline only
 * splices vetted markup via known marker tokens). We still wrap
 * the dangerously-set HTML in a sandboxed container with a
 * `role="document"` so screen readers can skim it as one unit.
 *
 * Empty / failure states use the same bilingual copy the
 * server-side `empty-states.ts` emits, so a partial server
 * response can be augmented client-side without divergence.
 */

import { useMemo } from 'react';

export type ArtifactClassification = 'public' | 'internal' | 'confidential';
export type ArtifactLanguage = 'sw' | 'en';

export interface ArtifactRendererProps {
  readonly title: string;
  readonly tenantTradingName: string;
  readonly classification: ArtifactClassification;
  readonly auditHashTail: string;
  readonly renderedAtUtc: string;
  readonly authorDisplayName: string;
  readonly language: ArtifactLanguage;
  /** Pre-rendered HTML body (from `services/artifact-richness`). */
  readonly bodyHtml: string;
  /** Optional pre-rendered TOC HTML — shown above the body. */
  readonly tocHtml?: string | null;
  /** Optional pre-rendered footnotes HTML — shown below the body. */
  readonly footnotesHtml?: string | null;
  /** When true, render the loading skeleton instead of the body. */
  readonly isLoading?: boolean;
  /** When set, render the empty-state copy + retry CTA. */
  readonly emptyState?: {
    readonly message: string;
    readonly onRetry?: () => void;
    readonly retryLabel?: string;
  };
}

const CLASSIFICATION_LABEL_EN: Record<ArtifactClassification, string> = {
  public: 'Public',
  internal: 'Internal',
  confidential: 'Confidential',
};

const CLASSIFICATION_LABEL_SW: Record<ArtifactClassification, string> = {
  public: 'Hadharani',
  internal: 'Ndani ya Kampuni',
  confidential: 'Siri',
};

const DISCLAIMER_EN = 'AI-generated. Decisions are yours.';
const DISCLAIMER_SW = 'Imeundwa na akili-bandia. Maamuzi ni yako.';

const LOADING_SW = 'Inapakia…';
const LOADING_EN = 'Loading…';

const RETRY_SW = 'Jaribu tena';
const RETRY_EN = 'Retry';

export function ArtifactRenderer(props: ArtifactRendererProps): JSX.Element {
  const classificationLabel = useMemo(
    () =>
      props.language === 'sw'
        ? CLASSIFICATION_LABEL_SW[props.classification]
        : CLASSIFICATION_LABEL_EN[props.classification],
    [props.classification, props.language],
  );

  const disclaimer = props.language === 'sw' ? DISCLAIMER_SW : DISCLAIMER_EN;
  const loadingLabel = props.language === 'sw' ? LOADING_SW : LOADING_EN;
  const retryLabel =
    props.emptyState?.retryLabel ??
    (props.language === 'sw' ? RETRY_SW : RETRY_EN);

  return (
    <article
      className="borjie-artifact"
      role="document"
      aria-label={props.title}
      data-classification={props.classification}
    >
      <header className="borjie-artifact-header">
        <span className="borjie-artifact-wordmark" aria-hidden="true">
          Borjie
        </span>
        <span className="borjie-artifact-meta">
          <span className="borjie-artifact-tenant">{props.tenantTradingName}</span>
          <span className="borjie-artifact-sep"> | </span>
          <span className="borjie-artifact-title">{props.title}</span>
        </span>
        <span
          className={`borjie-artifact-classification borjie-artifact-classification--${props.classification}`}
          aria-label={classificationLabel}
        >
          {classificationLabel}
        </span>
      </header>

      {props.isLoading ? (
        <ArtifactSkeleton label={loadingLabel} />
      ) : props.emptyState ? (
        <EmptyState
          message={props.emptyState.message}
          onRetry={props.emptyState.onRetry}
          retryLabel={retryLabel}
        />
      ) : (
        <ArtifactBody
          bodyHtml={props.bodyHtml}
          tocHtml={props.tocHtml ?? null}
          footnotesHtml={props.footnotesHtml ?? null}
        />
      )}

      <footer className="borjie-artifact-footer">
        <span>
          {props.tenantTradingName} | {classificationLabel} |{' '}
          {props.renderedAtUtc} | audit:{props.auditHashTail}
        </span>
        <span className="borjie-artifact-disclaimer">{disclaimer}</span>
      </footer>
    </article>
  );
}

function ArtifactBody(props: {
  readonly bodyHtml: string;
  readonly tocHtml: string | null;
  readonly footnotesHtml: string | null;
}): JSX.Element {
  return (
    <main className="borjie-artifact-body">
      {props.tocHtml ? (
        <div
          className="borjie-artifact-toc-host"
          dangerouslySetInnerHTML={{ __html: props.tocHtml }}
        />
      ) : null}
      <div
        className="borjie-artifact-body-host"
        dangerouslySetInnerHTML={{ __html: props.bodyHtml }}
      />
      {props.footnotesHtml ? (
        <div
          className="borjie-artifact-footnotes-host"
          dangerouslySetInnerHTML={{ __html: props.footnotesHtml }}
        />
      ) : null}
    </main>
  );
}

function ArtifactSkeleton(props: { readonly label: string }): JSX.Element {
  return (
    <div
      className="borjie-artifact-skeleton"
      role="status"
      aria-live="polite"
      aria-label={props.label}
    >
      <div className="borjie-artifact-skeleton-row" />
      <div className="borjie-artifact-skeleton-row borjie-artifact-skeleton-row--short" />
      <div className="borjie-artifact-skeleton-row" />
      <div className="borjie-artifact-skeleton-row borjie-artifact-skeleton-row--long" />
      <span className="borjie-artifact-sr-only">{props.label}</span>
    </div>
  );
}

function EmptyState(props: {
  readonly message: string;
  readonly onRetry?: () => void;
  readonly retryLabel: string;
}): JSX.Element {
  return (
    <div className="borjie-artifact-empty" role="status">
      <p>{props.message}</p>
      {props.onRetry ? (
        <button type="button" onClick={props.onRetry} className="borjie-artifact-retry">
          {props.retryLabel}
        </button>
      ) : null}
    </div>
  );
}
