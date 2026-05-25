'use client';

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';

interface DataTableProps<T> {
  readonly columns: ReadonlyArray<ColumnDef<T, unknown>>;
  readonly rows: ReadonlyArray<T>;
  readonly emptyState?: ReactNode;
  readonly onRowClick?: (row: T) => void;
  readonly initialSort?: SortingState;
  readonly ariaLabel: string;
}

/**
 * Thin shell around TanStack Table that gives every internal screen
 * the same sortable header behaviour, hover-row affordance, and
 * keyboard activation for row clicks. Kept agnostic of mutations —
 * those live in per-screen action columns.
 */
export function DataTable<T>({
  columns,
  rows,
  emptyState,
  onRowClick,
  initialSort,
  ariaLabel,
}: DataTableProps<T>): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);

  const table = useReactTable({
    data: rows as T[],
    columns: columns as ColumnDef<T, unknown>[],
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="rounded-lg border border-border bg-surface overflow-x-auto">
      <table className="w-full text-sm" aria-label={ariaLabel}>
        <thead className="border-b border-border bg-surface-sunken">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="text-left text-xs uppercase tracking-wider text-neutral-500">
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th key={header.id} className="px-4 py-3 font-medium">
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === 'asc' ? (
                          <ArrowUp className="w-3 h-3" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-xs text-neutral-500">
                {emptyState ?? 'No results.'}
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-border last:border-0 ${
                  onRowClick ? 'cursor-pointer hover:bg-surface-sunken' : ''
                }`}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row.original);
                        }
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-neutral-300">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
