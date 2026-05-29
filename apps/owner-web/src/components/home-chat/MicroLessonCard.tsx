'use client';

/**
 * MicroLessonCard — lightweight teaching pane rendered when the brain
 * emits a `micro_lesson` ui_block (image / illustration slot, body
 * paragraph, and footer CTAs). Independent author against
 * Docs/DESIGN/LITFIN_STEPPER_LEARNING_SPEC.md §4 + §12 — sits next to
 * the heavier ConceptCard for short atomic explanations (BoT gold-
 * window timing, NEMC EIA cycle, LBMA fix mechanics, etc.).
 *
 * Borjie navy/gold palette; bilingual sw / en; no framer-motion.
 */

import type { ReactElement } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@borjie/design-system';

export interface MicroLessonCardBlock {
  readonly type: 'micro_lesson';
  readonly title?: string;
  readonly titleSw?: string;
  readonly body?: string;
  readonly bodySw?: string;
  readonly illustration?: string;
  readonly cta?: ReadonlyArray<{
    readonly label?: string;
    readonly labelSw?: string;
    readonly value: string;
  }>;
}

export interface MicroLessonCardProps {
  readonly block: MicroLessonCardBlock;
  readonly language: 'sw' | 'en';
  readonly onCta?: (value: string) => void;
}

export function MicroLessonCard({
  block,
  language,
  onCta,
}: MicroLessonCardProps): ReactElement {
  const isSw = language === 'sw';
  const title = (isSw && block.titleSw) || block.title || (isSw ? 'Somo dogo' : 'Micro lesson');
  const body = (isSw && block.bodySw) || block.body || '';
  const ctas = Array.isArray(block.cta) ? block.cta.slice(0, 3) : [];

  return (
    <section
      data-testid="home-chat-micro-lesson"
      className="my-3 rounded-2xl border border-warning/20 bg-surface/80 overflow-hidden animate-fade-up"
    >
      <header className="flex items-center gap-2 px-4 py-3 border-b border-foreground/[0.06] bg-warning/[0.04]">
        <Sparkles aria-hidden="true" className="h-4 w-4 text-warning" />
        <p className="text-tiny uppercase tracking-wide text-warning font-semibold">
          {language === 'sw' ? 'Somo dogo' : 'Micro lesson'}
        </p>
      </header>

      <div className="px-4 py-4 space-y-3">
        {block.illustration ? (
          <div
            aria-hidden="true"
            className="h-24 w-full rounded-xl border border-warning/15 bg-gradient-to-br from-warning/[0.08] via-warning/[0.04] to-transparent flex items-center justify-center text-4xl"
          >
            {block.illustration}
          </div>
        ) : null}

        <h3 className="text-sm font-semibold text-foreground leading-snug">{title}</h3>
        {body ? (
          <p className="text-data text-foreground/75 leading-relaxed whitespace-pre-wrap">
            {body}
          </p>
        ) : null}
      </div>

      {ctas.length > 0 ? (
        <footer className="border-t border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3 flex flex-wrap gap-2">
          {ctas.map((c, i) => {
            const label = (isSw && c.labelSw) || c.label || c.value;
            return (
              <button
                key={`${c.value}_${i}`}
                type="button"
                onClick={() => onCta?.(c.value)}
                className={cn(
                  'text-[12px] px-3.5 py-2 rounded-xl font-semibold border transition-all duration-200',
                  'border-warning/30 bg-warning/[0.08] text-warning hover:bg-warning/15 hover:border-warning/40',
                )}
              >
                {label}
              </button>
            );
          })}
        </footer>
      ) : null}
    </section>
  );
}
