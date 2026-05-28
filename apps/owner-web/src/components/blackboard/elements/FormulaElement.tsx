'use client';

/**
 * FormulaElement — display a maths expression (LaTeX-lite, monospace
 * fallback) plus per-variable annotations. Chalk-on-board reveal
 * cadence: title fades in, expression types on at ~28 ms/char,
 * variables fan out beneath.
 *
 * KaTeX is intentionally NOT a hard dep here. The brain emits a
 * compact LaTeX-lite expression that reads cleanly in monospace
 * (`royalty = grade × tonnage × spot_price × rate`). A future wave
 * can plug KaTeX in by feature-detecting `katex` at module load.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { z } from 'zod';
import type { boardElementSchema, Bilingual } from '../types';

type FormulaPayload = Extract<z.infer<typeof boardElementSchema>, { type: 'formula' }>;

const TYPE_ON_MS_PER_CHAR = 28;

function pick(b: Bilingual | undefined, lang: 'sw' | 'en'): string | null {
  if (!b) return null;
  return lang === 'sw' ? b.sw : b.en;
}

export interface FormulaElementProps {
  readonly payload: FormulaPayload;
  readonly languagePreference: 'sw' | 'en';
}

export function FormulaElement({ payload, languagePreference }: FormulaElementProps): ReactElement {
  const totalMs = Math.min(payload.latex.length * TYPE_ON_MS_PER_CHAR, 2200);
  const label = pick(payload.label, languagePreference);
  const [shown, setShown] = useState(0);

  // Cursor-style type-on: reveal one character at a time.
  useEffect(() => {
    setShown(0);
    const step = TYPE_ON_MS_PER_CHAR;
    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      i += 1;
      setShown(Math.min(i, payload.latex.length));
      if (i < payload.latex.length) {
        window.setTimeout(tick, step);
      }
    };
    const handle = window.setTimeout(tick, step);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [payload.latex]);

  const visibleLatex = useMemo(() => payload.latex.slice(0, shown), [payload.latex, shown]);
  const ready = shown >= payload.latex.length;

  return (
    <article
      data-testid="board-element-formula"
      data-element-id={payload.id}
      className="rounded-xl border border-border bg-surface/60 px-4 py-3"
    >
      {label ? (
        <p className="mb-2 text-tiny font-semibold uppercase tracking-wide text-warning">
          {label}
        </p>
      ) : null}
      <pre
        aria-live="polite"
        className="font-mono text-base leading-relaxed text-foreground whitespace-pre-wrap break-words tracking-tight"
        style={{ minHeight: `${1.5 * Math.max(1, Math.ceil(payload.latex.length / 48))}rem` }}
      >
        {visibleLatex}
        {!ready ? (
          <span aria-hidden="true" className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-warning align-text-bottom" />
        ) : null}
      </pre>
      {ready && payload.variables && payload.variables.length > 0 ? (
        <dl
          className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-tiny sm:grid-cols-2"
          style={{ transitionDelay: `${totalMs}ms` }}
        >
          {payload.variables.map((v) => (
            <div key={v.symbol} className="flex gap-2">
              <dt className="font-mono font-semibold text-foreground">{v.symbol}</dt>
              <dd className="text-neutral-400">{pick(v.meaning, languagePreference)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}
