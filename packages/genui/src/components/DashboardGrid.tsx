'use client';

/**
 * 12. dashboard-grid — 12-column composite layout.
 *
 * Each cell holds a nested AgUiUiPart that is rendered via the
 * `renderChild` prop (the AdaptiveRenderer passes itself in to avoid
 * a circular import). Cells stack to a single column on small screens.
 */

import type { AgUiUiPart, AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { DashboardGridPartSchema } from '../schemas';

export type DashboardGridProps = AgUiUiPartByKind<'dashboard-grid'> & {
  readonly renderChild: (part: AgUiUiPart) => JSX.Element;
};

const COL_SPAN: Record<number, string> = {
  1: 'md:col-span-1',
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
  5: 'md:col-span-5',
  6: 'md:col-span-6',
  7: 'md:col-span-7',
  8: 'md:col-span-8',
  9: 'md:col-span-9',
  10: 'md:col-span-10',
  11: 'md:col-span-11',
  12: 'md:col-span-12',
};

export function DashboardGrid(props: DashboardGridProps): JSX.Element {
  const { renderChild, ...payload } = props;
  const parsed = DashboardGridPartSchema.safeParse(payload);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="dashboard-grid"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }
  return (
    <Frame kind="dashboard-grid" {...(payload.title ? { title: payload.title } : {})}>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
        {payload.cells.map((cell, i) => {
          const spanClass = COL_SPAN[cell.span] ?? 'md:col-span-12';
          return (
            <div key={i} className={spanClass} data-dashboard-cell={i}>
              {renderChild(cell.part)}
            </div>
          );
        })}
      </div>
    </Frame>
  );
}
