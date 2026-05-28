'use client';

/**
 * StepperBar — left rail with the 5-step mining literacy ladder
 * (ORIENT / LICENCE / ROYALTY / WORKFORCE / MARKETPLACE), each step
 * stamped with a `MasteryDial` SVG. Independent author against the
 * spec at Docs/DESIGN/LITFIN_STEPPER_LEARNING_SPEC.md §2 (Stepper bar)
 * — visual outcome is dimensionally identical to LitFin's
 * LearningSidebar, with Borjie navy/gold tokens substituted for LitFin
 * copper/teal.
 *
 * Bilingual sw / en (sw default, EN never says "Karibu"). Time-aware
 * copy is the parent's responsibility; this rail simply renders the
 * literacy ladder.
 *
 * Compact mode (icon strip) when `collapsed` is true so the rail can
 * survive narrow viewports without breaking the cockpit grid.
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { cn } from '@borjie/design-system';
import { MasteryDial } from './MasteryDial';

export type StepperLanguage = 'sw' | 'en';

export interface StepperStep {
  readonly id: string;
  readonly titleSw: string;
  readonly titleEn: string;
  readonly estimateMin: number;
  /** Mastery score in [0, 1] for the step. */
  readonly mastery: number;
  /** Step is fully complete (overrides mastery rendering). */
  readonly isComplete: boolean;
  /** Step is locked by prerequisites. */
  readonly isLocked: boolean;
}

export interface StepperBarProps {
  readonly language: StepperLanguage;
  /** 1-indexed current step. */
  readonly currentStep: number;
  /** When omitted the bar uses the default mining literacy ladder. */
  readonly steps?: ReadonlyArray<StepperStep>;
  /** Click handler when the owner selects a step. */
  readonly onSelectStep?: (index: number) => void;
  /** Container className for layout overrides. */
  readonly className?: string;
}

const DEFAULT_STEPS: ReadonlyArray<StepperStep> = [
  {
    id: 'ORIENT',
    titleSw: 'Tambua mali',
    titleEn: 'Orient your estate',
    estimateMin: 6,
    mastery: 0,
    isComplete: false,
    isLocked: false,
  },
  {
    id: 'LICENCE',
    titleSw: 'Leseni & EIA',
    titleEn: 'Licence and EIA',
    estimateMin: 8,
    mastery: 0,
    isComplete: false,
    isLocked: false,
  },
  {
    id: 'ROYALTY',
    titleSw: 'Mrabaha & Forodha',
    titleEn: 'Royalty and clearance',
    estimateMin: 10,
    mastery: 0,
    isComplete: false,
    isLocked: false,
  },
  {
    id: 'WORKFORCE',
    titleSw: 'Wafanyakazi & Mafunzo',
    titleEn: 'Workforce and training',
    estimateMin: 7,
    mastery: 0,
    isComplete: false,
    isLocked: false,
  },
  {
    id: 'MARKETPLACE',
    titleSw: 'Soko & Mauzo',
    titleEn: 'Marketplace and sales',
    estimateMin: 9,
    mastery: 0,
    isComplete: false,
    isLocked: false,
  },
];

interface CollapsedRowProps {
  readonly step: StepperStep;
  readonly index: number;
  readonly isActive: boolean;
  readonly language: StepperLanguage;
  readonly onSelect: (index: number) => void;
}

function CollapsedRow({
  step,
  index,
  isActive,
  language,
  onSelect,
}: CollapsedRowProps): ReactElement {
  const handleClick = useCallback(() => onSelect(index), [index, onSelect]);
  const title = language === 'sw' ? step.titleSw : step.titleEn;
  const stateSuffix = step.isComplete
    ? language === 'sw'
      ? ' (imekamilika)'
      : ' (complete)'
    : step.isLocked
      ? language === 'sw'
        ? ' (imefungwa)'
        : ' (locked)'
      : '';
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={step.isLocked}
      aria-label={`Step ${index + 1}: ${title}${stateSuffix}`}
      aria-current={isActive ? 'step' : undefined}
      data-testid={`stepper-collapsed-${step.id}`}
      className={cn(
        'w-6 h-6 rounded-full border-2 transition-all text-[9px] font-bold flex items-center justify-center',
        isActive
          ? 'border-warning bg-warning/20 text-warning'
          : step.isComplete
            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
            : !step.isLocked
              ? 'border-neutral-600 text-neutral-500 hover:border-neutral-400'
              : 'border-neutral-700/30 text-neutral-700 opacity-40',
      )}
    >
      {step.isComplete ? '✓' : index + 1}
    </button>
  );
}

interface ExpandedRowProps {
  readonly step: StepperStep;
  readonly index: number;
  readonly isActive: boolean;
  readonly language: StepperLanguage;
  readonly onSelect: (index: number) => void;
}

function ExpandedRow({
  step,
  index,
  isActive,
  language,
  onSelect,
}: ExpandedRowProps): ReactElement {
  const handleClick = useCallback(() => onSelect(index), [index, onSelect]);
  const title = language === 'sw' ? step.titleSw : step.titleEn;
  const masteryPercent = Math.round(step.mastery * 100);
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={step.isLocked}
      data-testid={`stepper-row-${step.id}`}
      aria-current={isActive ? 'step' : undefined}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left transition-all',
        isActive
          ? 'bg-warning/10 border-r-2 border-warning'
          : step.isLocked
            ? 'opacity-40 cursor-not-allowed'
            : 'hover:bg-white/[0.04]',
      )}
    >
      {step.isLocked ? (
        <div className="w-9 h-9 rounded-full bg-surface-raised flex items-center justify-center">
          <Lock aria-hidden="true" className="w-4 h-4 text-neutral-500" />
        </div>
      ) : (
        <MasteryDial
          score={step.mastery}
          isComplete={step.isComplete}
          size={36}
          strokeWidth={3}
        />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-medium truncate',
            isActive ? 'text-warning' : 'text-neutral-200',
          )}
        >
          {title}
        </p>
        <p className="text-xs truncate mt-0.5 text-neutral-500">
          {step.estimateMin} min
          {masteryPercent > 0 ? ` · ${masteryPercent}%` : ''}
        </p>
      </div>
    </button>
  );
}

export function StepperBar({
  language,
  currentStep,
  steps,
  onSelectStep,
  className,
}: StepperBarProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const effectiveSteps = steps && steps.length > 0 ? steps : DEFAULT_STEPS;
  const total = effectiveSteps.length;
  const activeIndex = Math.max(0, Math.min(total - 1, currentStep - 1));

  const handleSelect = useCallback(
    (index: number) => {
      if (onSelectStep) onSelectStep(index);
    },
    [onSelectStep],
  );

  const completedCount = useMemo(
    () => effectiveSteps.filter((s) => s.isComplete).length,
    [effectiveSteps],
  );

  const overallLabel =
    language === 'sw' ? 'Maendeleo' : 'Progress';
  const overallPercent = total > 0 ? (completedCount / total) * 100 : 0;

  if (collapsed) {
    return (
      <aside
        aria-label={language === 'sw' ? 'Hatua za mafunzo' : 'Learning steps'}
        className={cn(
          'flex flex-col items-center py-4 px-1 border-r border-white/[0.06] bg-surface/80',
          className,
        )}
        data-testid="home-chat-stepper-collapsed"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded-md transition-colors hover:bg-white/10 text-neutral-400"
          aria-label={language === 'sw' ? 'Panua' : 'Expand'}
        >
          <ChevronRight aria-hidden="true" className="w-4 h-4" />
        </button>
        <div className="mt-4 flex flex-col gap-2 items-center">
          {effectiveSteps.map((step, i) => (
            <CollapsedRow
              key={step.id}
              step={step}
              index={i}
              isActive={i === activeIndex}
              language={language}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label={language === 'sw' ? 'Hatua za mafunzo' : 'Learning steps'}
      className={cn(
        'w-64 flex-shrink-0 flex flex-col border-r border-white/[0.06] bg-surface/80 overflow-hidden',
        className,
      )}
      data-testid="home-chat-stepper"
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen aria-hidden="true" className="w-4 h-4 flex-shrink-0 text-warning" />
          <h2 className="text-sm font-semibold truncate text-foreground">
            {language === 'sw' ? 'Mafunzo ya umiliki' : 'Estate literacy'}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="p-1 rounded-md transition-colors hover:bg-white/10 text-neutral-400"
          aria-label={language === 'sw' ? 'Funga' : 'Collapse'}
        >
          <ChevronLeft aria-hidden="true" className="w-4 h-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto py-2">
        {effectiveSteps.map((step, i) => (
          <ExpandedRow
            key={step.id}
            step={step}
            index={i}
            isActive={i === activeIndex}
            language={language}
            onSelect={handleSelect}
          />
        ))}
      </div>

      <footer className="px-4 py-3 border-t border-white/[0.06]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-neutral-400">
            {overallLabel}
          </span>
          <span className="text-xs font-semibold text-warning">
            {completedCount}/{total}
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden bg-neutral-800">
          <div
            className="h-full rounded-full bg-warning transition-all duration-500"
            style={{ width: `${overallPercent}%` }}
          />
        </div>
      </footer>
    </aside>
  );
}
