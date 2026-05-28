'use client';

/**
 * InlineSectionBlock — collapsible grouping of inline blocks (recursive).
 *
 * Schema source: `packages/owner-os-tabs/src/rich-inline-blocks.ts` →
 * `inlineSectionSchema`. Wraps 1-8 child blocks under a collapsible
 * header. Renders children via the central dispatcher passed in as
 * `renderChild` (avoids the circular import that comes with importing
 * the dispatcher directly).
 */

import { useState, type ReactElement } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface InlineSectionBlock {
  readonly type: 'inline_section';
  readonly title?: { readonly en?: string; readonly sw?: string };
  readonly defaultOpen?: boolean;
  readonly blocks?: ReadonlyArray<Record<string, unknown> & { type?: string }>;
  readonly [extra: string]: unknown;
}

export interface InlineSectionBlockProps {
  readonly block: InlineSectionBlock;
  readonly locale: 'sw' | 'en';
  readonly depth?: number;
  readonly renderChild: (
    child: Record<string, unknown> & { type?: string },
    depth: number,
  ) => ReactElement | null;
}

function localised(
  value: { readonly en?: string; readonly sw?: string } | undefined,
  locale: 'sw' | 'en',
  fallback: string,
): string {
  if (!value) return fallback;
  return (locale === 'sw' ? value.sw : value.en) ?? value.en ?? value.sw ?? fallback;
}

export function InlineSectionBlock({
  block,
  locale,
  depth = 0,
  renderChild,
}: InlineSectionBlockProps): ReactElement {
  const title = localised(
    block.title,
    locale,
    locale === 'sw' ? 'Sehemu' : 'Section',
  );
  const [open, setOpen] = useState(block.defaultOpen !== false);
  const children = Array.isArray(block.blocks) ? block.blocks.slice(0, 8) : [];
  const nextDepth = depth + 1;

  return (
    <section
      data-testid="inline-block-inline-section"
      className="overflow-hidden rounded-xl border border-border bg-surface/40"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface/80"
      >
        <span className="text-tiny font-semibold uppercase tracking-wide text-foreground/80">
          {title}
        </span>
        {open ? (
          <ChevronDown
            className="h-3.5 w-3.5 text-foreground/60"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className="h-3.5 w-3.5 text-foreground/60"
            aria-hidden="true"
          />
        )}
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border/60 px-3 py-3">
          {nextDepth > 3 ? (
            <p className="text-tiny text-foreground/60">
              {locale === 'sw'
                ? 'Kina cha juu zaidi cha 3 kimefikiwa.'
                : 'Max nesting depth (3) reached.'}
            </p>
          ) : (
            children.map((child, i) => (
              <div key={i}>{renderChild(child, nextDepth)}</div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
