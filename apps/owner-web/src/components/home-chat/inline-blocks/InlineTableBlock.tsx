'use client';

/**
 * InlineTableBlock — paginated data table inline in the chat bubble.
 *
 * Schema source: `packages/owner-os-tabs/src/rich-inline-blocks.ts` →
 * `inlineTableSchema`. Default page size 8; the FE caps render at 50
 * visible rows. Row click fires `onAction` with the row id so the host
 * can open an in-chat drawer per row.
 *
 * LitFin rhythm: low-chrome border, tabular-nums numerics, status pills
 * for the `status_pill` kind.
 */

import { useMemo, useState, type ReactElement } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ColumnDef {
  readonly key?: string;
  readonly label?: { readonly en?: string; readonly sw?: string };
  readonly kind?:
    | 'text'
    | 'number'
    | 'date'
    | 'currency'
    | 'status_pill'
    | 'action';
}

export interface InlineTableBlock {
  readonly type: 'inline_table';
  readonly title?: { readonly en?: string; readonly sw?: string };
  readonly columns?: ReadonlyArray<ColumnDef>;
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
  readonly pageSize?: number;
  readonly emptyState?: { readonly en?: string; readonly sw?: string };
  readonly [extra: string]: unknown;
}

export interface InlineTableBlockProps {
  readonly block: InlineTableBlock;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: 'row_click';
    readonly payload: { readonly rowId: string };
  }) => void;
}

function localised(
  value: { readonly en?: string; readonly sw?: string } | undefined,
  locale: 'sw' | 'en',
  fallback: string,
): string {
  if (!value) return fallback;
  return (locale === 'sw' ? value.sw : value.en) ?? value.en ?? value.sw ?? fallback;
}

function renderCell(
  raw: unknown,
  kind: ColumnDef['kind'] | undefined,
  locale: 'sw' | 'en',
): ReactElement | string {
  if (raw === null || raw === undefined) return '—';
  if (kind === 'status_pill') {
    const text = String(raw);
    const tone = /red|fail|block/i.test(text)
      ? 'border-destructive/40 bg-destructive/[0.1] text-destructive'
      : /amber|warn|pending/i.test(text)
        ? 'border-warning/40 bg-warning/[0.1] text-warning'
        : 'border-emerald-500/40 bg-emerald-500/[0.1] text-emerald-300';
    return (
      <span
        className={`inline-flex rounded-full border px-2 py-0.5 text-tiny font-medium ${tone}`}
      >
        {text}
      </span>
    );
  }
  if (kind === 'currency') {
    const num = Number(raw);
    if (Number.isFinite(num)) {
      return (
        <span className="font-mono tabular-nums">
          {num.toLocaleString(locale === 'sw' ? 'sw-TZ' : 'en-US')}
        </span>
      );
    }
  }
  if (kind === 'number') {
    return <span className="font-mono tabular-nums">{String(raw)}</span>;
  }
  return String(raw);
}

export function InlineTableBlock({
  block,
  locale,
  onAction,
}: InlineTableBlockProps): ReactElement {
  const columns = Array.isArray(block.columns)
    ? block.columns.filter((c): c is ColumnDef => Boolean(c)).slice(0, 8)
    : [];
  const rows = Array.isArray(block.rows)
    ? block.rows.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object').slice(0, 50)
    : [];
  const pageSize =
    typeof block.pageSize === 'number' && block.pageSize > 0
      ? Math.min(block.pageSize, 50)
      : 8;
  const title = localised(block.title, locale, locale === 'sw' ? 'Jedwali' : 'Table');

  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);

  const visible = useMemo(
    () => rows.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [rows, safePage, pageSize],
  );

  if (rows.length === 0) {
    return (
      <div
        data-testid="inline-block-inline-table-empty"
        className="rounded-xl border border-border bg-surface/40 p-3 text-tiny text-foreground/60"
      >
        {localised(
          block.emptyState,
          locale,
          locale === 'sw' ? 'Hakuna data' : 'No rows to show',
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="inline-block-inline-table"
      className="overflow-hidden rounded-xl border border-border bg-surface/60"
    >
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <p className="text-tiny font-semibold uppercase tracking-wide text-foreground/70">
          {title}
        </p>
        <p className="text-tiny text-foreground/50">
          {rows.length} {locale === 'sw' ? 'safu' : 'rows'}
        </p>
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-background/60 text-tiny uppercase tracking-wide text-foreground/60">
            <tr>
              {columns.map((col, i) => (
                <th
                  key={col.key ?? `c_${i}`}
                  className="px-3 py-1.5 text-left font-medium"
                >
                  {localised(col.label, locale, col.key ?? '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, ri) => {
              const id =
                typeof row.id === 'string' ? row.id : `row_${safePage}_${ri}`;
              return (
                <tr
                  key={id}
                  onClick={() =>
                    onAction?.({ action: 'row_click', payload: { rowId: id } })
                  }
                  className="cursor-pointer border-t border-border/40 transition-colors hover:bg-surface"
                >
                  {columns.map((col, ci) => (
                    <td
                      key={col.key ?? `c_${ci}`}
                      className="px-3 py-1.5 text-foreground/85"
                    >
                      {renderCell(
                        col.key ? row[col.key] : undefined,
                        col.kind,
                        locale,
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-3 py-1.5">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage(Math.max(0, safePage - 1))}
            className="rounded-md p-1 text-foreground/70 transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <span className="text-tiny text-foreground/60">
            {safePage + 1}/{totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
            className="rounded-md p-1 text-foreground/70 transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
