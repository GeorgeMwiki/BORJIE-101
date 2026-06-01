'use client';

import type { ReactElement, ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { ownerOsPanelsStrings as S } from '@/i18n/strings/owner-os-panels';

/**
 * Generic loading / error / empty / rows table for owner-os panels that
 * landed on live BFF data (Wave PANELS-WIRE).
 *
 * One component owns the four states every wired panel shares so each
 * panel body stays tiny:
 *   - `isLoading` → spinner caption
 *   - `isError`   → error card with an optional retry affordance
 *   - empty rows  → empty-state (real "no data", never fabricated)
 *   - rows        → a simple, accessible table
 *
 * Bilingual copy is locale-resolved at the call site (`isSw`) so this
 * component holds no Swahili literal; the generic captions come from the
 * guard-exempt strings table.
 */

export interface PanelColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: Row) => ReactNode;
  /** Right-align (numeric columns). */
  readonly alignRight?: boolean;
}

interface PanelDataTableProps<Row> {
  readonly isSw: boolean;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly rows: ReadonlyArray<Row>;
  readonly columns: ReadonlyArray<PanelColumn<Row>>;
  readonly rowKey: (row: Row) => string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** Optional CTA rendered under the empty-state body. */
  readonly emptyAction?: ReactNode;
  /** Optional retry handler shown on the error card. */
  readonly onRetry?: () => void;
}

export function PanelDataTable<Row>({
  isSw,
  isLoading,
  isError,
  rows,
  columns,
  rowKey,
  emptyTitle,
  emptyBody,
  emptyAction,
  onRetry,
}: PanelDataTableProps<Row>): ReactElement {
  if (isLoading) {
    return (
      <div
        role="status"
        data-testid="owner-os-panel-loading"
        className="flex items-center justify-center rounded-2xl border border-border bg-surface/30 px-6 py-10 text-sm text-neutral-400"
      >
        {isSw ? S.shared.loading.sw : S.shared.loading.en}
      </div>
    );
  }
  if (isError) {
    return (
      <div
        role="alert"
        data-testid="owner-os-panel-error"
        className="flex flex-col items-center gap-3 rounded-2xl border border-danger/30 bg-danger/5 px-6 py-10 text-center"
      >
        <h3 className="font-display text-base text-foreground">
          {isSw ? S.shared.errorTitle.sw : S.shared.errorTitle.en}
        </h3>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-neutral-400">
          {isSw ? S.shared.errorBody.sw : S.shared.errorBody.en}
        </p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-foreground hover:bg-surface"
          >
            {isSw ? S.shared.retry.sw : S.shared.retry.en}
          </button>
        ) : null}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div
        role="status"
        data-testid="owner-os-panel-empty"
        className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center"
      >
        <div
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-neutral-400"
        >
          <Inbox className="h-6 w-6" />
        </div>
        <h3 className="font-display text-base text-foreground">{emptyTitle}</h3>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-neutral-400">
          {emptyBody}
        </p>
        {emptyAction ? <div className="mt-1">{emptyAction}</div> : null}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface/30">
      <table className="w-full text-left text-sm" data-testid="owner-os-panel-table">
        <thead>
          <tr className="border-b border-border text-tiny uppercase tracking-wide text-neutral-500">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-2.5 font-medium ${col.alignRight ? 'text-right' : ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-border/50 last:border-0 hover:bg-surface/60"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-4 py-2.5 text-foreground ${col.alignRight ? 'text-right tabular-nums' : ''}`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
