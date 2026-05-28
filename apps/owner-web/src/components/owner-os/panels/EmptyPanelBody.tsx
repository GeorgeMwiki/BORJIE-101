'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

interface EmptyPanelBodyProps {
  readonly icon: LucideIcon;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly bodyEn: string;
  readonly bodySw: string;
  readonly contractEn: string;
  readonly contractSw: string;
  readonly locale: 'sw' | 'en';
}

/**
 * Empty-state body for panels whose BFF has not landed yet. Renders the
 * LitFin empty-state rhythm (large icon, title, 2-sentence body, plus a
 * "contract" line that names the API the panel will hit once shipped)
 * so the owner sees scope intent and the next eng team has a clear hook.
 */
export function EmptyPanelBody({
  icon: Icon,
  titleEn,
  titleSw,
  bodyEn,
  bodySw,
  contractEn,
  contractSw,
  locale,
}: EmptyPanelBodyProps): ReactElement {
  const isSw = locale === 'sw';
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center"
      data-testid="owner-os-panel-empty"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-warning/30 bg-warning/10 text-warning">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <h3 className="font-display text-base text-foreground">
          {isSw ? titleSw : titleEn}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-400">
          {isSw ? bodySw : bodyEn}
        </p>
      </div>
      <p className="rounded-md border border-border bg-surface/60 px-3 py-1.5 font-mono text-tiny text-neutral-400">
        {isSw ? contractSw : contractEn}
      </p>
    </div>
  );
}
