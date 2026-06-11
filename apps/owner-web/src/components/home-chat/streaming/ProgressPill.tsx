'use client';

/**
 * ProgressPill — a thin, ALWAYS-VISIBLE 5-segment progress pill pinned to the
 * top of the transcript. It replaces the desktop-only `hidden md:flex`
 * StepperBar rail so the owner always sees where they are in the 5-step mining
 * literacy ladder (ORIENT · LICENCE · ROYALTY · WORKFORCE · MARKETPLACE) —
 * including on mobile, where the rail used to vanish.
 *
 * Each segment fills when its step is reached; the active step gets a subtle
 * ring. Localised EN/SW step labels flow through the shared data-b strings
 * (single language per active locale). The accessible name announces the
 * current step for screen readers.
 */

import type { ReactElement } from 'react';
import { cn } from '@borjie/design-system';
import { dataBStrings as S } from '@/i18n/strings/data-b';

export interface ProgressPillProps {
  readonly language: 'sw' | 'en';
  /** 1-indexed current step (1..5). */
  readonly currentStep: number;
  readonly className?: string;
}

const SEGMENTS: ReadonlyArray<{
  readonly id: string;
  readonly label: { readonly sw: string; readonly en: string };
}> = [
  { id: 'ORIENT', label: S.stepperOrientTitle },
  { id: 'LICENCE', label: S.stepperLicenceTitle },
  { id: 'ROYALTY', label: S.stepperRoyaltyTitle },
  { id: 'WORKFORCE', label: S.stepperWorkforceTitle },
  { id: 'MARKETPLACE', label: S.stepperMarketplaceTitle },
];

export function ProgressPill({
  language,
  currentStep,
  className,
}: ProgressPillProps): ReactElement {
  const total = SEGMENTS.length;
  const active = Math.max(1, Math.min(total, currentStep));
  const activeLabel =
    language === 'sw' ? SEGMENTS[active - 1]?.label.sw : SEGMENTS[active - 1]?.label.en;
  const progressWord =
    language === 'sw' ? S.stepperProgress.sw : S.stepperProgress.en;

  return (
    <div
      data-testid="home-chat-progress-pill"
      className={cn('flex items-center gap-2', className)}
      role="group"
      aria-label={`${progressWord} · ${active}/${total} · ${activeLabel ?? ''}`}
    >
      <div className="flex flex-1 items-center gap-1">
        {SEGMENTS.map((seg, idx) => {
          const stepNo = idx + 1;
          const reached = stepNo <= active;
          const isActive = stepNo === active;
          const segLabel = language === 'sw' ? seg.label.sw : seg.label.en;
          return (
            <span
              key={seg.id}
              title={segLabel}
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors duration-300',
                reached ? 'bg-warning' : 'bg-foreground/10',
                isActive && 'ring-1 ring-warning/50',
              )}
            />
          );
        })}
      </div>
      <span className="shrink-0 text-tiny font-medium tabular-nums text-neutral-400">
        {active}/{total}
      </span>
    </div>
  );
}
