'use client';

/**
 * 33. decision-trace — renders the kernel's own provenance + reasoning
 * trail. One row per (observation | inference | tool-call | decision |
 * output) step, with rationale, optional evidence links, and a
 * confidence dot. Used for kernel-transparency surfaces ("Why did Mr.
 * Mwikila propose this?").
 */

import type { AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { DecisionTracePartSchema } from '../schemas';

export type DecisionTraceProps = AgUiUiPartByKind<'decision-trace'>;

const KIND_LABELS = {
  observation: 'Observed',
  inference: 'Inferred',
  'tool-call': 'Tool',
  decision: 'Decision',
  output: 'Output',
} as const;

const KIND_COLOURS = {
  observation: 'bg-sky-100 text-sky-900',
  inference: 'bg-violet-100 text-violet-900',
  'tool-call': 'bg-amber-100 text-amber-900',
  decision: 'bg-emerald-100 text-emerald-900',
  output: 'bg-foreground/10 text-foreground',
} as const;

const CONFIDENCE_DOT = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-destructive',
} as const;

export function DecisionTrace(props: DecisionTraceProps): JSX.Element {
  const parsed = DecisionTracePartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="decision-trace"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }

  return (
    <Frame kind="decision-trace" {...(props.title ? { title: props.title } : {})}>
      {props.summary ? (
        <div className="mb-2 rounded border border-border bg-surface-sunken p-2 text-xs text-foreground">
          {props.summary}
        </div>
      ) : null}
      <ol className="m-0 list-none space-y-2 p-0">
        {props.steps.map((s, i) => (
          <li key={s.id} className="rounded border border-border bg-surface p-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${KIND_COLOURS[s.kind]}`}
              >
                {KIND_LABELS[s.kind]}
              </span>
              <span className="text-xs font-medium text-foreground">{s.title}</span>
              {s.confidence ? (
                <span
                  aria-label={`confidence ${s.confidence}`}
                  className={`ml-auto h-2 w-2 rounded-full ${CONFIDENCE_DOT[s.confidence]}`}
                />
              ) : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{s.rationale}</div>
            {s.evidence && s.evidence.length > 0 ? (
              <ul className="mt-1 list-none space-y-0.5 p-0 text-[11px]">
                {s.evidence.map((e, ei) => (
                  <li key={ei}>
                    {e.uri ? (
                      <a
                        href={e.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-foreground"
                      >
                        {e.label}
                      </a>
                    ) : (
                      <span className="text-foreground">{e.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </Frame>
  );
}
