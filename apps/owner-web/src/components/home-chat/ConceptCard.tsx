'use client';

/**
 * ConceptCard — full-fidelity render of a brain-emitted concept_card
 * ui_block. Independent author against Docs/DESIGN/LITFIN_STEPPER_LEARNING_SPEC.md
 * §4 — visually matches LitFin's progressive-exploration concept card
 * (header + bloom bar + mastery progress + per-point exploration +
 * Deep dive / Go wider actions) using Borjie navy / gold tokens.
 *
 * No framer-motion (owner-web doesn't ship it); animation uses the
 * design-system's `animate-fade-up`, `animate-shimmer`, and pure CSS
 * `transition-all duration-X` utilities so the entry / hover micro
 * matches LitFin's vocabulary within the bounds of CSS animation.
 *
 * The `onDeepDive` / `onGoWider` callbacks emit a next-turn message
 * that the parent forwards to `/api/v1/brain/teach`. The renderer is
 * stateful (selectedIndex + exploredIndices) so the owner can drill
 * point-by-point without losing the map of where they are.
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { BookOpen, ChevronDown, ChevronUp, GraduationCap, Search, Expand, CheckCircle2, Zap } from 'lucide-react';
import { cn } from '@borjie/design-system';

export type BloomLevel =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyze'
  | 'evaluate'
  | 'create';

export interface ConceptCardBlock {
  readonly type: 'concept_card';
  readonly title?: string;
  readonly titleSw?: string;
  readonly description?: string;
  readonly descriptionSw?: string;
  readonly keyPoints?: ReadonlyArray<string>;
  readonly category?: string;
  readonly icon?: string;
  readonly bloomLevel?: BloomLevel | string;
  readonly masteryPercent?: number;
  readonly relatedConcepts?: ReadonlyArray<string>;
  readonly exploredKeyPoints?: ReadonlyArray<string | number>;
  readonly conceptId?: string;
}

export interface ConceptCardProps {
  readonly block: ConceptCardBlock;
  readonly language: 'sw' | 'en';
  /** Fired when the owner asks the brain to deepen a point. */
  readonly onDeepDive?: (payload: { readonly title: string; readonly point: string | null }) => void;
  /** Fired when the owner asks the brain to widen a point. */
  readonly onGoWider?: (payload: { readonly title: string; readonly point: string | null }) => void;
  /** Fired when the owner taps a related concept chip. */
  readonly onRelatedClick?: (concept: string) => void;
}

interface BloomMeta {
  readonly key: BloomLevel;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly bar: string;
  readonly chip: string;
}

const BLOOM_LEVELS: ReadonlyArray<BloomMeta> = [
  { key: 'remember',   labelEn: 'Remember',   labelSw: 'Kumbuka',   bar: 'bg-neutral-500', chip: 'text-neutral-500 ring-neutral-500/20' },
  { key: 'understand', labelEn: 'Understand', labelSw: 'Elewa',     bar: 'bg-info',        chip: 'text-info ring-info/20' },
  { key: 'apply',      labelEn: 'Apply',      labelSw: 'Tumia',     bar: 'bg-info/70',     chip: 'text-info/80 ring-info/20' },
  { key: 'analyze',    labelEn: 'Analyze',    labelSw: 'Chambua',   bar: 'bg-warning',     chip: 'text-warning ring-warning/20' },
  { key: 'evaluate',   labelEn: 'Evaluate',   labelSw: 'Pima',      bar: 'bg-warning/80',  chip: 'text-warning ring-warning/20' },
  { key: 'create',     labelEn: 'Create',     labelSw: 'Tengeneza', bar: 'bg-emerald-500', chip: 'text-emerald-500 ring-emerald-500/20' },
];

function findBloom(level: ConceptCardBlock['bloomLevel']): { readonly meta: BloomMeta; readonly index: number } | null {
  if (!level) return null;
  const idx = BLOOM_LEVELS.findIndex((l) => l.key === level);
  if (idx < 0) return null;
  const meta = BLOOM_LEVELS[idx];
  if (!meta) return null;
  return { meta, index: idx };
}

type PointStatus = 'unexplored' | 'selected' | 'explored';

function difficultyPill(bloomIndex: number): string {
  if (bloomIndex <= 1) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/15';
  if (bloomIndex <= 3) return 'bg-warning/10 text-warning border-warning/15';
  return 'bg-destructive/10 text-destructive border-destructive/15';
}

function difficultyLabel(bloomIndex: number, language: 'sw' | 'en'): string {
  if (bloomIndex <= 1) return language === 'sw' ? 'Msingi' : 'Basic';
  if (bloomIndex <= 3) return language === 'sw' ? 'Wastani' : 'Intermediate';
  return language === 'sw' ? 'Mtaalamu' : 'Advanced';
}

function masteryFillClass(percent: number): string {
  if (percent >= 80) return 'bg-gradient-to-r from-emerald-500 to-green-400';
  if (percent >= 50) return 'bg-gradient-to-r from-warning to-warning/70';
  return 'bg-gradient-to-r from-warning to-warning/60';
}

function seedExplored(
  keyPoints: ReadonlyArray<string>,
  hint: ReadonlyArray<string | number> | undefined,
): ReadonlyArray<number> {
  if (!hint || hint.length === 0) return [];
  const out: number[] = [];
  for (const value of hint) {
    if (typeof value === 'number') {
      if (value >= 0 && value < keyPoints.length) out.push(value);
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      const idx = keyPoints.findIndex((p) => p.trim() === trimmed);
      if (idx >= 0) out.push(idx);
    }
  }
  return out;
}

export function ConceptCard({
  block,
  language,
  onDeepDive,
  onGoWider,
  onRelatedClick,
}: ConceptCardProps): ReactElement {
  const isSw = language === 'sw';
  const title = (isSw && block.titleSw) || block.title || (isSw ? 'Dhana' : 'Concept');
  const description = (isSw && block.descriptionSw) || block.description || '';
  const keyPoints = block.keyPoints ?? [];
  const bloom = findBloom(block.bloomLevel);
  const masteryPercent = typeof block.masteryPercent === 'number' && block.masteryPercent >= 0 && block.masteryPercent <= 100
    ? block.masteryPercent
    : null;

  const initialExplored = useMemo(
    () => seedExplored(keyPoints, block.exploredKeyPoints),
    [block.exploredKeyPoints, keyPoints],
  );
  const [exploredIndices, setExploredIndices] = useState<ReadonlyArray<number>>(initialExplored);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const visiblePoints = expanded ? keyPoints : keyPoints.slice(0, 3);
  const hiddenCount = Math.max(0, keyPoints.length - 3);
  const totalPoints = keyPoints.length;
  const exploredCount = exploredIndices.length;
  const allExplored = totalPoints > 0 && exploredCount >= totalPoints;

  const getStatus = useCallback(
    (i: number): PointStatus => {
      if (exploredIndices.includes(i)) return 'explored';
      if (selectedIndex === i) return 'selected';
      return 'unexplored';
    },
    [exploredIndices, selectedIndex],
  );

  const handlePointClick = useCallback(
    (i: number) => {
      setSelectedIndex((prev) => (prev === i ? null : i));
    },
    [],
  );

  const markExplored = useCallback(
    (i: number) => {
      setExploredIndices((prev) => (prev.includes(i) ? prev : [...prev, i]));
    },
    [],
  );

  const handleDeepDive = useCallback(() => {
    const point = selectedIndex !== null ? keyPoints[selectedIndex] ?? null : null;
    if (selectedIndex !== null) markExplored(selectedIndex);
    if (onDeepDive) onDeepDive({ title, point });
  }, [keyPoints, markExplored, onDeepDive, selectedIndex, title]);

  const handleGoWider = useCallback(() => {
    const point = selectedIndex !== null ? keyPoints[selectedIndex] ?? null : null;
    if (selectedIndex !== null) markExplored(selectedIndex);
    if (onGoWider) onGoWider({ title, point });
  }, [keyPoints, markExplored, onGoWider, selectedIndex, title]);

  const selectedPointText = selectedIndex !== null ? keyPoints[selectedIndex] ?? null : null;

  return (
    <article
      data-testid="home-chat-concept-card"
      className="relative rounded-2xl border border-warning/30 overflow-hidden my-3 shadow-xl shadow-warning/10 bg-surface dark:bg-surface-raised animate-fade-up"
    >
      <div className="h-[3px] w-full bg-gradient-to-r from-warning via-warning/80 to-warning/60" />
      <div className="absolute inset-0 bg-gradient-to-br from-warning/[0.08] via-transparent to-warning/[0.04] pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-transparent pointer-events-none" />

      <div className="relative p-5">
        <div className="flex items-start gap-3.5 mb-4">
          <div className="relative h-10 w-10 rounded-xl bg-gradient-to-br from-warning to-warning/70 flex items-center justify-center shrink-0 shadow-lg shadow-warning/25">
            {block.icon ? (
              <span className="text-lg" aria-hidden="true">{block.icon}</span>
            ) : (
              <BookOpen aria-hidden="true" className="h-[18px] w-[18px] text-primary-foreground" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h4 className="text-[15px] font-bold tracking-tight leading-snug text-foreground">
                {title}
              </h4>
              {block.category ? (
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-warning/10 text-warning font-semibold border border-warning/15 uppercase tracking-wide">
                  {block.category}
                </span>
              ) : null}
              {bloom ? (
                <span
                  className={cn(
                    'text-[10px] px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wide border',
                    difficultyPill(bloom.index),
                  )}
                >
                  {difficultyLabel(bloom.index, language)}
                </span>
              ) : null}
            </div>
            {description ? (
              <p className="text-[13px] text-foreground/70 leading-relaxed line-clamp-3">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        {bloom ? (
          <div className="mb-4 p-3 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted-foreground/70 font-semibold uppercase tracking-widest">
                {language === 'sw' ? "Daraja la kufikiri" : "Bloom's level"}
              </span>
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full ring-1', bloom.meta.chip)}>
                {language === 'sw' ? bloom.meta.labelSw : bloom.meta.labelEn}
              </span>
            </div>
            <div className="flex gap-1.5 h-2">
              {BLOOM_LEVELS.map((level, i) => (
                <div
                  key={level.key}
                  className={cn(
                    'flex-1 rounded-full transition-colors duration-300',
                    i <= bloom.index ? level.bar : 'bg-foreground/[0.08]',
                  )}
                  aria-hidden="true"
                />
              ))}
            </div>
          </div>
        ) : null}

        {masteryPercent !== null ? (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted-foreground/70 font-semibold uppercase tracking-widest">
                {language === 'sw' ? 'Umahiri' : 'Mastery'}
              </span>
              <span className="text-xs font-bold tabular-nums text-foreground">
                {masteryPercent}%
              </span>
            </div>
            <div className="h-2.5 bg-foreground/[0.08] rounded-full overflow-hidden border border-foreground/[0.06]">
              <div
                className={cn('h-full rounded-full transition-all duration-500', masteryFillClass(masteryPercent))}
                style={{ width: `${masteryPercent}%` }}
              />
            </div>
          </div>
        ) : null}

        {exploredCount > 0 ? (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted-foreground/70 font-semibold uppercase tracking-widest">
                {language === 'sw' ? 'Maendeleo ya uchunguzi' : 'Exploration progress'}
              </span>
              <span className="text-[10px] font-bold tabular-nums text-warning">
                {exploredCount}/{totalPoints}
              </span>
            </div>
            <div className="flex gap-1.5">
              {keyPoints.map((_, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className={cn(
                    'flex-1 h-2 rounded-full transition-colors duration-300',
                    exploredIndices.includes(i)
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                      : selectedIndex === i
                        ? 'bg-warning/60'
                        : 'bg-foreground/[0.08]',
                  )}
                />
              ))}
            </div>
          </div>
        ) : null}

        {keyPoints.length > 0 ? (
          <div className="space-y-2 mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-muted-foreground/70 font-bold uppercase tracking-[0.15em]">
                {language === 'sw' ? 'Maeneo muhimu' : 'Key points'}
              </span>
              {selectedIndex !== null ? (
                <span className="text-[10px] text-warning font-medium inline-flex items-center gap-1">
                  <Zap aria-hidden="true" className="h-2.5 w-2.5" />
                  {language === 'sw' ? 'Chagua hatua' : 'Choose action'}
                </span>
              ) : null}
            </div>

            {visiblePoints.map((point, i) => {
              const status = getStatus(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handlePointClick(i)}
                  data-testid={`concept-card-point-${i}`}
                  data-status={status}
                  className={cn(
                    'w-full flex items-start gap-3 text-left rounded-xl px-3 py-2.5 transition-all duration-200 border',
                    status === 'selected'
                      ? 'border-warning/40 bg-warning/10 shadow-md shadow-warning/10 ring-1 ring-warning/15'
                      : status === 'explored'
                        ? 'border-emerald-500/15 bg-emerald-500/[0.05] opacity-70'
                        : 'border-foreground/[0.06] hover:border-warning/20 hover:bg-warning/[0.06] bg-foreground/[0.03]',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-5 w-5 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-all duration-200',
                      status === 'explored'
                        ? 'bg-emerald-500/15 border border-emerald-500/25'
                        : status === 'selected'
                          ? 'bg-gradient-to-br from-warning/30 to-warning/20 border-2 border-warning/50'
                          : 'bg-gradient-to-br from-warning/15 to-warning/10 border border-warning/20',
                    )}
                  >
                    {status === 'explored' ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    ) : status === 'selected' ? (
                      <span className="h-2 w-2 rounded-full bg-warning animate-pulse" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-br from-warning to-warning/70" />
                    )}
                  </span>
                  <span
                    className={cn(
                      'text-[13px] leading-relaxed transition-colors duration-200',
                      status === 'explored'
                        ? 'text-muted-foreground/60 line-through decoration-emerald-500/30'
                        : status === 'selected'
                          ? 'text-foreground font-medium'
                          : 'text-foreground/80',
                    )}
                  >
                    {point}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="flex items-center gap-1.5 text-[11px] text-warning/80 hover:text-warning font-semibold mb-3 transition-colors duration-200 px-1"
          >
            {expanded ? (
              <>
                <ChevronUp aria-hidden="true" className="h-3 w-3" />
                {language === 'sw' ? 'Onyesha kidogo' : 'Show less'}
              </>
            ) : (
              <>
                <ChevronDown aria-hidden="true" className="h-3 w-3" />
                +{hiddenCount} {language === 'sw' ? 'maeneo zaidi' : 'more points'}
              </>
            )}
          </button>
        ) : null}

        {allExplored ? (
          <div className="mb-3 p-3 rounded-xl bg-gradient-to-r from-emerald-500/8 to-emerald-500/8 border border-emerald-500/15 animate-fade-up">
            <div className="flex items-center gap-2.5">
              <span className="h-7 w-7 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              </span>
              <span className="text-[13px] font-semibold text-emerald-400">
                {language === 'sw' ? 'Maeneo yote yamefunzwa' : 'All points explored'}
              </span>
            </div>
          </div>
        ) : null}

        {block.relatedConcepts && block.relatedConcepts.length > 0 ? (
          <div className="pt-3.5 mt-2 border-t border-foreground/[0.08]">
            <span className="text-[10px] text-muted-foreground/70 font-bold uppercase tracking-[0.15em]">
              {language === 'sw' ? 'Vinavyohusiana' : 'Related'}
            </span>
            <div className="flex flex-wrap gap-2 mt-2">
              {block.relatedConcepts.map((concept) => (
                <button
                  key={concept}
                  type="button"
                  onClick={() => onRelatedClick?.(concept)}
                  className="text-[11px] px-3 py-1.5 rounded-xl border border-warning/15 text-warning bg-warning/[0.06] hover:bg-warning/10 hover:border-warning/25 transition-all duration-200 font-semibold"
                >
                  {concept}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="pt-3.5 mt-2 border-t border-foreground/[0.08]">
          {selectedPointText ? (
            <div className="mb-3 px-3 py-2 rounded-xl bg-warning/[0.08] border border-warning/15 animate-fade-up">
              <div className="flex items-center gap-2">
                <Zap aria-hidden="true" className="h-3 w-3 text-warning shrink-0" />
                <span className="text-[11px] text-warning font-semibold truncate">
                  {language === 'sw' ? 'Inachunguzwa' : 'Exploring'}:{' '}
                  <span className="text-warning/80 font-normal">{selectedPointText}</span>
                </span>
              </div>
            </div>
          ) : null}

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={handleDeepDive}
              data-testid="concept-card-deep-dive"
              className={cn(
                'flex-1 text-[12px] px-4 py-2.5 rounded-xl font-semibold border transition-all duration-200 inline-flex items-center justify-center gap-2',
                selectedIndex !== null
                  ? 'border-warning/40 bg-warning/15 text-warning hover:bg-warning/20'
                  : 'border-warning/15 bg-warning/[0.08] text-warning/80 hover:bg-warning/15 hover:border-warning/25',
              )}
            >
              <Search aria-hidden="true" className="h-3.5 w-3.5" />
              {language === 'sw' ? 'Chunguza zaidi' : 'Deep dive'}
            </button>
            <button
              type="button"
              onClick={handleGoWider}
              data-testid="concept-card-go-wider"
              className={cn(
                'flex-1 text-[12px] px-4 py-2.5 rounded-xl font-semibold border transition-all duration-200 inline-flex items-center justify-center gap-2',
                selectedIndex !== null
                  ? 'border-warning/40 bg-warning/15 text-warning hover:bg-warning/20'
                  : 'border-warning/15 bg-warning/[0.08] text-warning/80 hover:bg-warning/15 hover:border-warning/25',
              )}
            >
              <Expand aria-hidden="true" className="h-3.5 w-3.5" />
              {language === 'sw' ? 'Panua' : 'Go wider'}
            </button>
          </div>

          <div className="flex items-center gap-2 mt-3 pt-2">
            <span className="h-6 w-6 rounded-full bg-gradient-to-br from-warning to-warning/70 flex items-center justify-center shadow-sm shadow-warning/20">
              <GraduationCap aria-hidden="true" className="h-3 w-3 text-primary-foreground" />
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">
              {language === 'sw' ? 'Mwalimu Borjie' : 'Borjie Teach'}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
