'use client';

/**
 * SimpleElements — text / image / highlight / arrow / sketch.
 *
 * Each primitive is small enough that grouping them keeps the file
 * count tight while preserving one-component-per-primitive separation.
 */

import type { ReactElement } from 'react';
import Image from 'next/image';
import type { z } from 'zod';
import type { boardElementSchema, Bilingual } from '../types';

type TextPayload = Extract<z.infer<typeof boardElementSchema>, { type: 'text' }>;
type ImagePayload = Extract<z.infer<typeof boardElementSchema>, { type: 'image' }>;
type HighlightPayload = Extract<z.infer<typeof boardElementSchema>, { type: 'highlight' }>;
type ArrowPayload = Extract<z.infer<typeof boardElementSchema>, { type: 'arrow' }>;
type SketchPayload = Extract<z.infer<typeof boardElementSchema>, { type: 'sketch' }>;

function pick(b: Bilingual, lang: 'sw' | 'en'): string {
  return lang === 'sw' ? b.sw : b.en;
}
function pickOpt(b: Bilingual | undefined, lang: 'sw' | 'en'): string | null {
  if (!b) return null;
  return lang === 'sw' ? b.sw : b.en;
}

// ─── Text ───────────────────────────────────────────────────────────

export function TextElement({
  payload,
  languagePreference,
}: {
  readonly payload: TextPayload;
  readonly languagePreference: 'sw' | 'en';
}): ReactElement {
  const weight = payload.weight ?? 'normal';
  const cls =
    weight === 'headline'
      ? 'text-lg font-semibold text-foreground'
      : weight === 'emphasis'
        ? 'text-base font-medium text-warning'
        : 'text-sm text-foreground';
  return (
    <article
      data-testid="board-element-text"
      data-text-weight={weight}
      data-element-id={payload.id}
      className="rounded-xl border border-border bg-surface/60 px-4 py-3"
    >
      <p className={`${cls} whitespace-pre-wrap leading-relaxed`}>
        {pick(payload.body, languagePreference)}
      </p>
    </article>
  );
}

// ─── Image ──────────────────────────────────────────────────────────

export function ImageElement({
  payload,
  languagePreference,
}: {
  readonly payload: ImagePayload;
  readonly languagePreference: 'sw' | 'en';
}): ReactElement {
  return (
    <article
      data-testid="board-element-image"
      data-element-id={payload.id}
      className="overflow-hidden rounded-xl border border-border bg-surface/60"
    >
      <div className="relative h-48 w-full bg-neutral-900">
        <Image
          src={payload.src}
          alt={pick(payload.caption, languagePreference)}
          fill
          sizes="(max-width: 768px) 100vw, 500px"
          className="object-cover"
          unoptimized
        />
      </div>
      <figcaption className="px-3 py-2 text-tiny text-neutral-300">
        {pick(payload.caption, languagePreference)}
        {payload.attribution ? (
          <span className="ml-1 text-neutral-500">— {payload.attribution}</span>
        ) : null}
      </figcaption>
    </article>
  );
}

// ─── Highlight ──────────────────────────────────────────────────────

const HIGHLIGHT_TONE: Record<string, string> = {
  positive: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  critical: 'border-destructive/40 bg-destructive/10 text-destructive',
  neutral: 'border-border bg-surface/40 text-foreground',
};

export function HighlightElement({
  payload,
  languagePreference,
}: {
  readonly payload: HighlightPayload;
  readonly languagePreference: 'sw' | 'en';
}): ReactElement {
  const note = pickOpt(payload.note, languagePreference);
  return (
    <article
      data-testid="board-element-highlight"
      data-tone={payload.tone}
      data-target={payload.targetId}
      data-element-id={payload.id}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
        HIGHLIGHT_TONE[payload.tone] ?? HIGHLIGHT_TONE.neutral
      }`}
    >
      <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
      <span className="flex-1">{note ?? '(highlight)'}</span>
      <span className="text-tiny opacity-70">→ {payload.targetId}</span>
    </article>
  );
}

// ─── Arrow ──────────────────────────────────────────────────────────

const ARROW_COLOR: Record<string, string> = {
  positive: 'text-success',
  negative: 'text-destructive',
  neutral: 'text-warning',
};

export function ArrowElement({
  payload,
  languagePreference,
}: {
  readonly payload: ArrowPayload;
  readonly languagePreference: 'sw' | 'en';
}): ReactElement {
  const color = ARROW_COLOR[payload.sentiment ?? 'neutral'] ?? ARROW_COLOR.neutral;
  const label = pickOpt(payload.label, languagePreference);
  return (
    <article
      data-testid="board-element-arrow"
      data-element-id={payload.id}
      className={`flex items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm ${color}`}
    >
      <span className="text-tiny font-mono opacity-70">{payload.fromId}</span>
      <span aria-hidden="true" className="text-base">{'→'}</span>
      <span className="text-tiny font-mono opacity-70">{payload.toId}</span>
      {label ? <span className="ml-2 flex-1 text-foreground">{label}</span> : null}
    </article>
  );
}

// ─── Sketch ─────────────────────────────────────────────────────────

export function SketchElement({
  payload,
  languagePreference,
}: {
  readonly payload: SketchPayload;
  readonly languagePreference: 'sw' | 'en';
}): ReactElement {
  const label = pickOpt(payload.label, languagePreference);
  return (
    <article
      data-testid="board-element-sketch"
      data-element-id={payload.id}
      className="rounded-xl border border-border bg-surface/60 px-3 py-3"
    >
      <svg
        viewBox="0 0 320 180"
        className="h-32 w-full"
        role="img"
        aria-label={label ?? 'Sketch'}
      >
        <path
          d={payload.svgPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-warning"
        />
      </svg>
      {label ? <p className="mt-2 text-tiny text-neutral-300">{label}</p> : null}
    </article>
  );
}
