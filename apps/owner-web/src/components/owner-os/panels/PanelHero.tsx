'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import type { OwnerOSTabColor } from '@borjie/owner-os-tabs';

interface PanelHeroProps {
  readonly icon: LucideIcon;
  readonly color: OwnerOSTabColor;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly subtitleEn: string;
  readonly subtitleSw: string;
  readonly locale: 'sw' | 'en';
  readonly actions?: ReactNode;
  /** Optional contextual chip strip rendered to the right of the title. */
  readonly metaChips?: ReadonlyArray<{
    readonly labelEn: string;
    readonly labelSw: string;
    readonly tone?: 'neutral' | 'positive' | 'warning' | 'urgent';
  }>;
}

const COLOR_CLASS: Record<OwnerOSTabColor, string> = {
  navy: 'border-info/40 text-info bg-info/10',
  gold: 'border-warning/40 text-warning bg-warning/10',
  cream: 'border-neutral-500/40 text-neutral-200 bg-surface/40',
  signal: 'border-signal-500/40 text-signal-500 bg-signal-500/10',
  warning: 'border-warning/40 text-warning bg-warning/10',
  success: 'border-success/40 text-success bg-success/10',
  destructive: 'border-destructive/40 text-destructive bg-destructive/10',
  info: 'border-info/40 text-info bg-info/10',
  neutral: 'border-border text-foreground bg-surface/40',
};

const CHIP_TONE: Record<NonNullable<NonNullable<PanelHeroProps['metaChips']>[number]['tone']>, string> =
  {
    neutral: 'border-border text-neutral-300 bg-surface/40',
    positive: 'border-success/40 text-success bg-success/10',
    warning: 'border-warning/40 text-warning bg-warning/10',
    urgent: 'border-destructive/40 text-destructive bg-destructive/10',
  };

/**
 * Compressed page-hero for tab bodies. Matches LitFin / Borjie rhythm
 * (eyebrow + display + Swahili gloss + intent body + actions strip) but
 * with tab-body padding (no full-page padding) and an icon affordance
 * to mirror the tab pill the owner clicked to open it.
 */
export function PanelHero({
  icon: Icon,
  color,
  titleEn,
  titleSw,
  subtitleEn,
  subtitleSw,
  locale,
  actions,
  metaChips,
}: PanelHeroProps): ReactElement {
  const isSw = locale === 'sw';
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div className="flex items-start gap-3 min-w-0">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${COLOR_CLASS[color]}`}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-medium tracking-tight text-foreground">
            {isSw ? titleSw : titleEn}
          </h2>
          <p className="mt-0.5 text-xs italic text-neutral-500">
            {isSw ? titleEn : titleSw}
          </p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-neutral-300">
            {isSw ? subtitleSw : subtitleEn}
          </p>
          {metaChips && metaChips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {metaChips.map((chip, i) => (
                <span
                  key={`${chip.labelEn}_${i}`}
                  className={`rounded-full border px-2 py-0.5 text-tiny font-medium ${
                    CHIP_TONE[chip.tone ?? 'neutral']
                  }`}
                >
                  {isSw ? chip.labelSw : chip.labelEn}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
