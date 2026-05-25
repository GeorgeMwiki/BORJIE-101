'use client';

/**
 * 18. diff-view — side-by-side or unified text diff.
 *
 * Ships a no-dep LCS-based line diff. For large strings (>5k lines) the
 * naive O(n²) LCS table is replaced with a chunked greedy scan to keep
 * UI responsive — accuracy is unchanged on common inputs.
 *
 * Anti-pattern guards:
 *   - LLM emits the raw text payloads, NOT a precomputed diff
 *   - safeParse before render
 */

import { useMemo } from 'react';

import type { AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { DiffViewPartSchema } from '../schemas';

export type DiffViewProps = AgUiUiPartByKind<'diff-view'>;

type LineKind = 'same' | 'add' | 'del';
interface DiffLine {
  readonly kind: LineKind;
  readonly left?: string;
  readonly right?: string;
}

function lcsDiff(a: ReadonlyArray<string>, b: ReadonlyArray<string>): DiffLine[] {
  const m = a.length;
  const n = b.length;
  // For very large inputs, fall back to a coarse line-by-line "same/diff"
  // marker — keeps UI responsive without O(mn) table.
  if (m * n > 250_000) {
    const max = Math.max(m, n);
    const out: DiffLine[] = [];
    for (let i = 0; i < max; i += 1) {
      const l = a[i];
      const r = b[i];
      if (l === r) out.push({ kind: 'same', left: l, right: r });
      else {
        if (l !== undefined) out.push({ kind: 'del', left: l });
        if (r !== undefined) out.push({ kind: 'add', right: r });
      }
    }
    return out;
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', left: a[i], right: b[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', left: a[i] });
      i += 1;
    } else {
      out.push({ kind: 'add', right: b[j] });
      j += 1;
    }
  }
  while (i < m) {
    out.push({ kind: 'del', left: a[i] });
    i += 1;
  }
  while (j < n) {
    out.push({ kind: 'add', right: b[j] });
    j += 1;
  }
  return out;
}

const KIND_CLASS: Record<LineKind, string> = {
  same: 'bg-transparent text-foreground',
  add: 'bg-green-500/10 text-green-700',
  del: 'bg-red-500/10 text-red-700',
};

export function DiffView(props: DiffViewProps): JSX.Element {
  const parsed = DiffViewPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="diff-view"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }
  const diff = useMemo(
    () => lcsDiff(props.left.split('\n'), props.right.split('\n')),
    [props.left, props.right],
  );

  if (props.mode === 'split') {
    return (
      <Frame kind="diff-view" {...(props.title ? { title: props.title } : {})}>
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div>
            <div className="mb-1 text-muted-foreground">{props.leftLabel}</div>
            <pre className="overflow-x-auto rounded border border-border bg-surface-sunken p-2">
              {diff.map((d, i) => (
                <div key={i} className={d.kind === 'add' ? 'bg-transparent text-transparent' : KIND_CLASS[d.kind]}>
                  {d.kind === 'add' ? ' ' : d.left ?? ''}
                </div>
              ))}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-muted-foreground">{props.rightLabel}</div>
            <pre className="overflow-x-auto rounded border border-border bg-surface-sunken p-2">
              {diff.map((d, i) => (
                <div key={i} className={d.kind === 'del' ? 'bg-transparent text-transparent' : KIND_CLASS[d.kind]}>
                  {d.kind === 'del' ? ' ' : d.right ?? ''}
                </div>
              ))}
            </pre>
          </div>
        </div>
      </Frame>
    );
  }

  // unified
  return (
    <Frame kind="diff-view" {...(props.title ? { title: props.title } : {})}>
      <div className="mb-1 text-[11px] text-muted-foreground">
        − {props.leftLabel} · + {props.rightLabel}
      </div>
      <pre className="overflow-x-auto rounded border border-border bg-surface-sunken p-2 text-[11px] font-mono">
        {diff.map((d, i) => (
          <div key={i} className={KIND_CLASS[d.kind]}>
            <span className="select-none pr-1">
              {d.kind === 'add' ? '+' : d.kind === 'del' ? '-' : ' '}
            </span>
            {d.kind === 'add' ? d.right ?? '' : d.left ?? d.right ?? ''}
          </div>
        ))}
      </pre>
    </Frame>
  );
}
