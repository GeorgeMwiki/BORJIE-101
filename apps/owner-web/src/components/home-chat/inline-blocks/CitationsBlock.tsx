'use client';

/**
 * CitationsBlock — inline citations rendered as numbered pills with a
 * side-panel that opens on click.
 *
 * Schema source: `packages/owner-os-tabs/src/citations-block.ts` →
 * `citationsBlockSchema`. Roadmap R1.
 *
 * The brain emits this block whenever a claim is sourced from the
 * intelligence corpus, LMBM cells, the web, or an attached document.
 * Each pill maps 1:1 to a `CitationRef` (cite-1, cite-2 …). Tapping a
 * pill opens a panel that displays the title, the excerpt verbatim, and
 * an "Open source" link when `sourceUrl` is set.
 */

import { useState, type ReactElement } from 'react';
import { BookOpen, ExternalLink, FileText, Globe, X } from 'lucide-react';

export interface CitationRefBlock {
  readonly id?: string;
  readonly source?: string;
  readonly title?: string;
  readonly excerpt?: string;
  readonly sourceUrl?: string;
  readonly kind?: 'corpus' | 'lmbm' | 'web' | 'doc';
}

export interface CitationsBlock {
  readonly type: 'citations_block';
  readonly headline?: { readonly en?: string; readonly sw?: string };
  readonly citations?: ReadonlyArray<CitationRefBlock>;
  readonly [extra: string]: unknown;
}

export interface CitationsBlockProps {
  readonly block: CitationsBlock;
  readonly locale: 'sw' | 'en';
}

const KIND_ICON: Readonly<
  Record<NonNullable<CitationRefBlock['kind']>, typeof BookOpen>
> = {
  corpus: BookOpen,
  lmbm: FileText,
  web: Globe,
  doc: FileText,
};

const KIND_LABEL_EN: Readonly<
  Record<NonNullable<CitationRefBlock['kind']>, string>
> = {
  corpus: 'Corpus',
  lmbm: 'LMBM',
  web: 'Web',
  doc: 'Document',
};

const KIND_LABEL_SW: Readonly<
  Record<NonNullable<CitationRefBlock['kind']>, string>
> = {
  corpus: 'Hifadhi',
  lmbm: 'LMBM',
  web: 'Tovuti',
  doc: 'Hati',
};

function safeKind(
  raw: unknown,
): NonNullable<CitationRefBlock['kind']> {
  return raw === 'lmbm' || raw === 'web' || raw === 'doc' ? raw : 'corpus';
}

export function CitationsBlock({
  block,
  locale,
}: CitationsBlockProps): ReactElement | null {
  const citations = Array.isArray(block.citations) ? block.citations : [];
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (citations.length === 0) return null;

  const headline =
    locale === 'sw'
      ? (block.headline?.sw ?? 'Vyanzo')
      : (block.headline?.en ?? 'Sources');

  const closeLabel = locale === 'sw' ? 'Funga' : 'Close';
  const openLabel = locale === 'sw' ? 'Fungua chanzo' : 'Open source';
  const active = activeIndex !== null ? citations[activeIndex] : null;
  const activeKind = active ? safeKind(active.kind) : 'corpus';
  const ActiveIcon = KIND_ICON[activeKind];
  const activeKindLabel =
    locale === 'sw' ? KIND_LABEL_SW[activeKind] : KIND_LABEL_EN[activeKind];

  return (
    <div
      data-testid="inline-block-citations"
      className="rounded-xl border border-border bg-surface/40 px-3 py-2"
    >
      <div className="text-tiny font-medium uppercase tracking-wide text-foreground/60">
        {headline}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {citations.map((citation, idx) => {
          const id =
            typeof citation.id === 'string' && citation.id.length > 0
              ? citation.id
              : `cite-${idx + 1}`;
          const label = `cite-${idx + 1}`;
          const Icon = KIND_ICON[safeKind(citation.kind)];
          return (
            <button
              key={`${id}-${idx}`}
              type="button"
              data-testid={`citation-pill-${idx + 1}`}
              onClick={() => setActiveIndex(idx)}
              className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/[0.08] px-2 py-0.5 text-tiny font-medium text-warning hover:bg-warning/20 focus:outline-none focus:ring-2 focus:ring-warning/40"
              aria-label={`${label}: ${citation.title ?? id}`}
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {active ? (
        <div
          data-testid="citation-panel"
          className="mt-3 rounded-lg border border-border bg-background/70 p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <ActiveIcon
                className="mt-0.5 h-4 w-4 flex-none text-warning"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-tiny uppercase tracking-wide text-foreground/60">
                  {activeKindLabel}
                </div>
                <div className="break-words text-sm font-semibold text-foreground">
                  {active.title ?? active.source ?? `cite-${activeIndex! + 1}`}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveIndex(null)}
              className="flex-none rounded-md p-1 text-foreground/60 hover:bg-surface/60"
              aria-label={closeLabel}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {active.excerpt ? (
            <p
              data-testid="citation-excerpt"
              className="mt-2 break-words text-sm leading-relaxed text-foreground/80"
            >
              {active.excerpt}
            </p>
          ) : null}
          {active.source ? (
            <div className="mt-2 break-words font-mono text-tiny text-foreground/60">
              {active.source}
            </div>
          ) : null}
          {typeof active.sourceUrl === 'string' && active.sourceUrl.length > 0 ? (
            <a
              data-testid="citation-source-link"
              href={active.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-tiny font-medium text-warning hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {openLabel}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
