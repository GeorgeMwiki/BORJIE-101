'use client';

/**
 * InlineDashboardBlock — composed mini-dashboard (recursive).
 *
 * Schema source: `packages/owner-os-tabs/src/rich-inline-blocks.ts` →
 * `inlineDashboardSchema`. Lays out 1-8 child blocks in one of three
 * layouts: grid_2x2, grid_3x2, strip_horizontal. Children are rendered
 * via the dispatcher passed in as `renderChild` (no circular imports).
 */

import type { ReactElement } from 'react';

type Layout = 'grid_2x2' | 'grid_3x2' | 'strip_horizontal';

export interface InlineDashboardBlock {
  readonly type: 'inline_dashboard';
  readonly title?: { readonly en?: string; readonly sw?: string };
  readonly layout?: Layout;
  readonly cells?: ReadonlyArray<Record<string, unknown> & { type?: string }>;
  readonly refreshIntervalSeconds?: number;
  readonly [extra: string]: unknown;
}

export interface InlineDashboardBlockProps {
  readonly block: InlineDashboardBlock;
  readonly locale: 'sw' | 'en';
  readonly depth?: number;
  readonly renderChild: (
    child: Record<string, unknown> & { type?: string },
    depth: number,
  ) => ReactElement | null;
}

const LAYOUT_CLASS: Readonly<Record<Layout, string>> = {
  grid_2x2: 'grid grid-cols-1 gap-2 sm:grid-cols-2',
  grid_3x2: 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3',
  strip_horizontal: 'flex gap-2 overflow-x-auto pb-1',
};

function localised(
  value: { readonly en?: string; readonly sw?: string } | undefined,
  locale: 'sw' | 'en',
  fallback: string,
): string {
  if (!value) return fallback;
  return (locale === 'sw' ? value.sw : value.en) ?? value.en ?? value.sw ?? fallback;
}

export function InlineDashboardBlock({
  block,
  locale,
  depth = 0,
  renderChild,
}: InlineDashboardBlockProps): ReactElement {
  const title = localised(
    block.title,
    locale,
    locale === 'sw' ? 'Dashibodi' : 'Dashboard',
  );
  const layout: Layout = block.layout ?? 'grid_2x2';
  const cells = Array.isArray(block.cells) ? block.cells.slice(0, 8) : [];
  const nextDepth = depth + 1;
  const layoutCls = LAYOUT_CLASS[layout];

  return (
    <div
      data-testid="inline-block-inline-dashboard"
      className="rounded-xl border border-border bg-surface/60 p-3"
    >
      <p className="text-tiny font-semibold uppercase tracking-wide text-foreground/70">
        {title}
      </p>
      <div className={`mt-3 ${layoutCls}`}>
        {nextDepth > 3 ? (
          <p className="text-tiny text-foreground/60">
            {locale === 'sw'
              ? 'Kina cha juu zaidi cha 3 kimefikiwa.'
              : 'Max nesting depth (3) reached.'}
          </p>
        ) : (
          cells.map((cell, i) => (
            <div
              key={i}
              className={
                layout === 'strip_horizontal' ? 'min-w-[220px] shrink-0' : ''
              }
            >
              {renderChild(cell, nextDepth)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
