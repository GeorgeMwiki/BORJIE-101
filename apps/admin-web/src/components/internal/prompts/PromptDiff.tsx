'use client';

import { useMemo } from 'react';

interface PromptDiffProps {
  readonly left: { readonly label: string; readonly body: string };
  readonly right: { readonly label: string; readonly body: string };
}

type Marker = 'eq' | 'add' | 'del';

interface DiffLine {
  readonly text: string;
  readonly marker: Marker;
}

/**
 * Two-pane line-diff. Pure JS — no jsdiff dep needed for the
 * line-level granularity the prompt registry shows. Highlights lines
 * present only on the left as `del` and lines only on the right as
 * `add`; lines present on both render as `eq`.
 */
function diffLines(a: string, b: string): { readonly left: ReadonlyArray<DiffLine>; readonly right: ReadonlyArray<DiffLine> } {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const aSet = new Set(aLines);
  const bSet = new Set(bLines);

  const left: DiffLine[] = aLines.map((text) => ({ text, marker: bSet.has(text) ? 'eq' : 'del' }));
  const right: DiffLine[] = bLines.map((text) => ({ text, marker: aSet.has(text) ? 'eq' : 'add' }));

  return { left, right };
}

const MARKER_STYLE: Record<Marker, string> = {
  eq: 'text-neutral-400',
  add: 'bg-success/10 text-success border-l-2 border-success/60 pl-2',
  del: 'bg-danger/10 text-danger border-l-2 border-danger/60 pl-2',
};

export function PromptDiff({ left, right }: PromptDiffProps): JSX.Element {
  const diff = useMemo(() => diffLines(left.body, right.body), [left.body, right.body]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border rounded-lg overflow-hidden">
      <div className="bg-surface">
        <header className="px-4 py-2 border-b border-border text-xs text-neutral-400">{left.label}</header>
        <pre className="p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
          {diff.left.map((line, i) => (
            <div key={`l-${i}`} className={MARKER_STYLE[line.marker]}>
              {line.text || ' '}
            </div>
          ))}
        </pre>
      </div>
      <div className="bg-surface">
        <header className="px-4 py-2 border-b border-border text-xs text-neutral-400">{right.label}</header>
        <pre className="p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
          {diff.right.map((line, i) => (
            <div key={`r-${i}`} className={MARKER_STYLE[line.marker]}>
              {line.text || ' '}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
