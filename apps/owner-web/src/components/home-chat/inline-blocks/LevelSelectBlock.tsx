'use client';

/**
 * LevelSelectBlock — owner picks their experience level.
 *
 * Schema source: emitted by `public-chat.hono.ts` on a fresh chat (sw +
 * en variants) as `<ui_block>{"type":"level_select","topic":"...",
 * "options":[{id, label, detail}, ...]}</ui_block>`. Tapping an option
 * fires `onAction` so the host can post `__level:{id}` as the next
 * user message and the brain calibrates further turns.
 */

import type { ReactElement } from 'react';
import { GraduationCap } from 'lucide-react';

interface LevelOption {
  readonly id?: string;
  readonly label?: string;
  readonly detail?: string;
}

export interface LevelSelectBlock {
  readonly type: 'level_select';
  readonly topic?: string;
  readonly options?: ReadonlyArray<LevelOption>;
  readonly [extra: string]: unknown;
}

export interface LevelSelectBlockProps {
  readonly block: LevelSelectBlock;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: 'level_select';
    readonly payload: { readonly levelId: string; readonly label: string };
  }) => void;
}

export function LevelSelectBlock({
  block,
  locale,
  onAction,
}: LevelSelectBlockProps): ReactElement {
  const topic = typeof block.topic === 'string' ? block.topic : '';
  const options = Array.isArray(block.options)
    ? block.options.filter((o): o is LevelOption => Boolean(o)).slice(0, 4)
    : [];

  return (
    <div
      data-testid="inline-block-level-select"
      className="rounded-xl border border-info/40 bg-info/[0.05] p-3"
    >
      <div className="flex items-center gap-2 text-info">
        <GraduationCap className="h-4 w-4" aria-hidden="true" />
        <p className="text-tiny font-semibold uppercase tracking-wide">
          {locale === 'sw' ? 'Chagua kiwango chako' : 'Pick your level'}
        </p>
      </div>
      {topic ? (
        <p className="mt-1 text-tiny text-foreground/70">
          {locale === 'sw' ? 'Kuhusu' : 'Topic'}: {topic}
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-2">
        {options.map((opt, i) => {
          const id = typeof opt.id === 'string' ? opt.id : `level_${i}`;
          const label =
            typeof opt.label === 'string' ? opt.label : `Level ${i + 1}`;
          const detail = typeof opt.detail === 'string' ? opt.detail : '';
          return (
            <button
              key={id}
              type="button"
              onClick={() =>
                onAction?.({
                  action: 'level_select',
                  payload: { levelId: id, label },
                })
              }
              className="rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-warning/40 hover:bg-warning/[0.04]"
            >
              <p className="text-sm font-semibold text-foreground">{label}</p>
              {detail ? (
                <p className="mt-0.5 text-tiny text-foreground/70">{detail}</p>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
